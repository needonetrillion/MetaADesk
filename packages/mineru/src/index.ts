import { MinerU } from 'mineru-open-sdk';
import { AuthError, TaskNotFoundError } from 'mineru-open-sdk';
import type { ExtractOptions, ExtractResult } from 'mineru-open-sdk';

/** 直接复用官方 SDK 的类型，保证与 API 完全对齐 */
export type { ExtractOptions, ExtractResult } from 'mineru-open-sdk';
export { progressPercent, progressToString } from 'mineru-open-sdk';
export { AuthError, TaskNotFoundError, MinerUError } from 'mineru-open-sdk';

export type MinerUTaskResult = ExtractResult;
export type MinerUExtractOptions = ExtractOptions;

export interface MinerUConfig {
  token: string;
  baseUrl?: string;
}

export interface MinerUClient {
  /** 提交单个本地文件，返回 batch id（异步） */
  submitFile(path: string, options?: MinerUExtractOptions): Promise<string>;
  /** 轮询 batch，返回各任务结果 */
  getBatch(batchId: string): Promise<MinerUTaskResult[]>;
  /** 阻塞式提取（内部处理上传 + 轮询），适合单篇 */
  extractFile(
    path: string,
    options?: MinerUExtractOptions,
  ): Promise<MinerUTaskResult>;
}

/**
 * 封装官方 mineru-open-sdk。
 * 官方 SDK 会自动处理本地文件上传、zip 下载与解析。
 */
export function createMinerUClient(config: MinerUConfig): MinerUClient {
  const client = new MinerU(config.token, config.baseUrl);
  return {
    submitFile: (path, options) => client.submit(path, options),
    getBatch: (batchId) => client.getBatch(batchId),
    extractFile: (path, options) => client.extract(path, options),
  };
}

/** 连通性检测：用「不存在的 batch id」探测 Token 是否有效，不产生任何费用 */
export async function testMineruConnection(config: MinerUConfig): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!config.token) {
    return { ok: false, message: '请先填写 MinerU API Token' };
  }
  try {
    await createMinerUClient(config).getBatch('connectivity-check-invalid-batch-id');
    return { ok: true, message: '连接正常' };
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, message: 'Token 无效或已过期' };
    }
    if (err instanceof TaskNotFoundError) {
      return { ok: true, message: 'Token 有效，MinerU 服务连接正常' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/401|403|A0202|A0211/i.test(msg)) {
      return { ok: false, message: 'Token 无效或已过期' };
    }
    if (/60012|not found|不存在/i.test(msg)) {
      return { ok: true, message: 'Token 有效，MinerU 服务连接正常' };
    }
    return { ok: false, message: `连接失败：${msg}` };
  }
}
