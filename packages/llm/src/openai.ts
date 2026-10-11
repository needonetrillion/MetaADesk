import type { z } from 'zod';
import { postJSON, resolveHttpOptions } from './http';
import { completeJSONWith } from './json';
import type {
  ChatMessage,
  CompletionOptions,
  LLMClient,
  ProviderConfig,
} from './types';

/** OpenAI 兼容协议客户端（DeepSeek / OpenAI / Qwen / Ollama 通用） */
export function createOpenAICompatibleClient(config: ProviderConfig): LLMClient {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  async function call(
    messages: ChatMessage[],
    opts?: CompletionOptions,
  ): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const { timeoutMs, retries } = resolveHttpOptions(config, opts);

    const data = (await postJSON({
      endpoint,
      headers,
      body: {
        model: config.model,
        messages,
        temperature: opts?.temperature ?? config.temperature ?? 0,
        ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        stream: false,
      },
      timeoutMs,
      retries,
      label: `${config.name || 'LLM'}(${config.model})`,
      signal: opts?.signal,
    })) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LLM 返回内容为空或格式异常');
    }
    return content;
  }

  return {
    id: config.id,
    complete: (messages, opts) => call(messages, opts),
    completeJSON: <T,>(
      messages: ChatMessage[],
      schema: z.ZodType<T>,
      opts?: CompletionOptions,
    ) =>
      completeJSONWith(
        (msgs) => call(msgs, opts),
        messages,
        schema,
      ),
  };
}
