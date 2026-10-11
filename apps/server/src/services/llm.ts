import { createLLMClient, type LLMClient } from '@meta/llm';
import { getSettings } from './settings';

export class NoProviderError extends Error {
  constructor() {
    super('尚未配置大模型 Provider，请先在「设置」中添加并设为默认');
    this.name = 'NoProviderError';
  }
}

/** 取当前生效的 LLM 客户端（优先显式 providerId，否则 activeProviderId，最后第一个） */
export function getActiveLLM(providerId?: string | null): LLMClient {
  const settings = getSettings();
  const provider =
    (providerId ? settings.providers.find((p) => p.id === providerId) : undefined) ??
    settings.providers.find((p) => p.id === settings.activeProviderId) ??
    settings.providers[0];
  if (!provider) throw new NoProviderError();
  return createLLMClient(provider);
}

/** 取「筛选专用」LLM 客户端（优先显式 providerId，否则项目/全局筛选模型，最后回退默认） */
export function getScreeningLLM(providerId?: string | null): LLMClient {
  const settings = getSettings();
  const provider =
    (providerId ? settings.providers.find((p) => p.id === providerId) : undefined) ??
    settings.providers.find((p) => p.id === settings.screeningProviderId) ??
    settings.providers.find((p) => p.id === settings.activeProviderId) ??
    settings.providers[0];
  if (!provider) throw new NoProviderError();
  return createLLMClient(provider);
}
