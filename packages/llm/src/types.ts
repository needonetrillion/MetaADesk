import type { z } from 'zod';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** 单次请求超时（毫秒），默认 DEFAULT_TIMEOUT_MS */
  timeoutMs?: number;
  /** 网络/限流等可重试错误的额外重试次数，默认 DEFAULT_RETRIES */
  retries?: number;
  /** 外部取消信号（例如用户点“停止”） */
  signal?: AbortSignal;
}

/** 默认单次请求超时：2 分钟。避免请求挂起把 HTTP 路由一起拖死 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** 默认可重试次数（指数退避） */
export const DEFAULT_RETRIES = 2;

/** 统一的 LLM 客户端接口，屏蔽各家差异 */
export interface LLMClient {
  readonly id: string;
  /** 普通对话补全，返回文本 */
  complete(messages: ChatMessage[], opts?: CompletionOptions): Promise<string>;
  /** 结构化输出：要求模型返回符合 schema 的 JSON，并做校验重试 */
  completeJSON<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    opts?: CompletionOptions,
  ): Promise<T>;
}

export type ProviderKind = 'openai-compatible' | 'anthropic';

/** Provider 配置（持久化在设置里） */
export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  /** 该 Provider 的请求超时（毫秒），留空用默认值 */
  timeoutMs?: number;
}

/** 预设 Provider，便于在设置页一键选择 */
export interface ProviderPreset {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  needsKey: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    needsKey: true,
  },
  {
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    needsKey: true,
  },
  {
    name: '通义千问 (DashScope)',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    needsKey: true,
  },
  {
    name: 'Ollama (本地)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3',
    needsKey: false,
  },
  {
    name: 'LM Studio',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    needsKey: false,
  },
];
