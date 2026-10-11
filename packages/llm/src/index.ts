import { createAnthropicClient } from './anthropic';
import { createOpenAICompatibleClient } from './openai';
import type { LLMClient, ProviderConfig } from './types';

export * from './types';
export { extractJSON, buildJSONSystemPrompt } from './json';
export { postJSON, RetryableHttpError, resolveHttpOptions } from './http';

/** 根据配置创建对应协议的 LLM 客户端 */
export function createLLMClient(config: ProviderConfig): LLMClient {
  switch (config.kind) {
    case 'openai-compatible':
      return createOpenAICompatibleClient(config);
    case 'anthropic':
      return createAnthropicClient(config);
    default: {
      const never: never = config.kind;
      throw new Error(`不支持的 Provider 类型: ${String(never)}`);
    }
  }
}
