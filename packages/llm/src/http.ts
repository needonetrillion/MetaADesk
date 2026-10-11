import type {
  CompletionOptions,
  ProviderConfig,
} from './types';
import { DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS } from './types';

/** 可重试的 HTTP 状态码：限流与 5xx */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export interface FetchJSONOptions extends CompletionOptions {
  /** 用于日志/报错的客户端标识 */
  label?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 判断错误是否值得重试：网络错误 / 超时 / 可重试状态码 */
function isRetryable(err: unknown): boolean {
  if (err instanceof RetryableHttpError) return RETRYABLE_STATUS.has(err.status);
  if (err instanceof Error) {
    // AbortSignal.timeout 触发；undici 网络错误
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
    if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(err.message)) {
      return true;
    }
  }
  return false;
}

/** 携带状态码的 HTTP 错误，便于上层判断是否可重试 */
export class RetryableHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = 'RetryableHttpError';
    this.status = status;
    this.body = body;
  }
}

export interface HttpCallOptions {
  endpoint: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  retries: number;
  label?: string;
  signal?: AbortSignal;
}

/** 合并超时信号与外部取消信号 */
function requestSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  const any = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([timeout, external]);
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (external.aborted || timeout.aborted) ctrl.abort();
  else {
    external.addEventListener('abort', abort, { once: true });
    timeout.addEventListener('abort', abort, { once: true });
  }
  return ctrl.signal;
}

/**
 * 带超时与指数退避重试的 POST JSON 请求。
 * 超时用 AbortSignal.timeout；可传入外部 signal 用于用户取消。
 */
export async function postJSON(options: HttpCallOptions): Promise<unknown> {
  const { endpoint, headers, body, timeoutMs, retries, label, signal } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
      await sleep(backoff + Math.floor(Math.random() * 250));
    }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: requestSignal(timeoutMs, signal),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new RetryableHttpError(res.status, text);
      }
      return (await res.json()) as unknown;
    } catch (err) {
      lastError = err;
      // 用户主动取消：不重试，立即抛出
      if (signal?.aborted && err instanceof Error && err.name === 'AbortError') throw err;
      if (attempt >= retries || !isRetryable(err)) throw err;
      if (label) {
        console.warn(
          `[llm] ${label} 第 ${attempt + 1} 次请求失败，准备重试：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 解析超时与重试次数（请求级 > Provider 配置 > 默认值） */
export function resolveHttpOptions(
  config: ProviderConfig,
  opts?: CompletionOptions,
): { timeoutMs: number; retries: number } {
  return {
    timeoutMs: opts?.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: opts?.retries ?? DEFAULT_RETRIES,
  };
}
