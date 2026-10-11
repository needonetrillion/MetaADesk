import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ChatMessage, LLMClient } from './types';

/** 从模型返回的文本中稳健地抽取 JSON（剥除 markdown 围栏等） */
export function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  // 去掉 ```json ... ``` 围栏
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fence ? fence[1]! : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('模型输出中未找到 JSON 对象');
  }
  return JSON.parse(body.slice(start, end + 1));
}

export function buildJSONSystemPrompt<T>(schema: z.ZodType<T>): string {
  const jsonSchema = zodToJsonSchema(schema);
  return [
    '你必须只输出一个 JSON 对象作为回答，不要输出任何 JSON 之外的文字、解释或 markdown 围栏。',
    '该 JSON 必须符合以下 JSON Schema：',
    JSON.stringify(jsonSchema),
    '如果某个字段信息缺失，用空字符串 "" 或空数组 [] 填充，不要编造。',
  ].join('\n');
}

/**
 * 结构化输出的通用实现：先按 prompt 让模型吐 JSON，
 * 再用 zod 校验；校验失败则把错误反馈给模型重试。
 *
 * 注意：网络/超时/限流错误由底层客户端（postJSON）自行重试，这里只重试「格式不合规」，
 * 避免把同一次网络抖动放大成 N 倍请求。
 */
export async function completeJSONWith<T>(
  complete: (messages: ChatMessage[]) => Promise<string>,
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  maxRetries = 2,
): Promise<T> {
  // 合并：把调用方传入的 system 提示与「输出 JSON」的约束合并为一条 system 消息
  const jsonSystem = buildJSONSystemPrompt(schema);
  const leadingSystem = messages[0]?.role === 'system' ? messages[0].content : '';
  const rest = messages[0]?.role === 'system' ? messages.slice(1) : messages;
  const base: ChatMessage[] = [
    {
      role: 'system',
      content: leadingSystem ? `${jsonSystem}\n\n${leadingSystem}` : jsonSystem,
    },
    ...rest,
  ];

  let attempt = 0;
  let lastError = '';
  let lastCompletion: string | null = null;
  while (attempt <= maxRetries) {
    const retryMessages: ChatMessage[] = [
      {
        role: 'assistant',
        content: lastCompletion ?? '(上一次输出未通过校验，请重新输出正确的 JSON)',
      },
      {
        role: 'user',
        content: `你上一次的输出格式不正确：${lastError}\n请只重新输出符合要求的 JSON 对象。`,
      },
    ];
    const toSend: ChatMessage[] =
      attempt === 0 ? base : [...base, ...retryMessages];
    const raw = await complete(toSend);
    lastCompletion = raw.slice(0, 2000);
    try {
      const json = extractJSON(raw);
      const parsed = schema.parse(json);
      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      attempt += 1;
    }
  }
  throw new Error(`结构化输出在 ${maxRetries + 1} 次尝试后仍无效：${lastError}`);
}

/** 给任意实现打上 id */
export function tagged(id: string, client: Omit<LLMClient, 'id'>): LLMClient {
  return { id, ...client };
}
