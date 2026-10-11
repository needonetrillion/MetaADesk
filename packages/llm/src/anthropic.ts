import type { z } from 'zod';
import { postJSON, resolveHttpOptions } from './http';
import { completeJSONWith } from './json';
import type {
  ChatMessage,
  CompletionOptions,
  LLMClient,
  ProviderConfig,
} from './types';

/** Anthropic Messages API 客户端 */
export function createAnthropicClient(config: ProviderConfig): LLMClient {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/v1/messages`;

  async function call(
    messages: ChatMessage[],
    opts?: CompletionOptions,
  ): Promise<string> {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const rest = messages.filter((m) => m.role !== 'system');
    const { timeoutMs, retries } = resolveHttpOptions(config, opts);

    const data = (await postJSON({
      endpoint,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: config.model,
        system: system || undefined,
        messages: rest,
        max_tokens: opts?.maxTokens ?? 4096,
        temperature: opts?.temperature ?? config.temperature ?? 0,
      },
      timeoutMs,
      retries,
      label: `${config.name || 'Anthropic'}(${config.model})`,
      signal: opts?.signal,
    })) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const text = data.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    if (!text) throw new Error('LLM 返回内容为空');
    return text;
  }

  return {
    id: config.id,
    complete: (messages, opts) => call(messages, opts),
    completeJSON: <T,>(
      messages: ChatMessage[],
      schema: z.ZodType<T>,
      opts?: CompletionOptions,
    ) => completeJSONWith((msgs) => call(msgs, opts), messages, schema),
  };
}
