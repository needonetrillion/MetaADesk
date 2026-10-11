import type { Criterion, PICO } from '@meta/core';
import type {
  AcceptAiResult,
  AgentChatResponse,
  AgentKnowledge,
  AgentMessage,
  AgentProposal,
  AgentSkill,
  AiSettings,
  AppSettings,
  BatchSuggestResult,
  DocumentInfo,
  DocumentStatesResponse,
  ExclusionReason,
  ExtractionFieldDef,
  ExtractionResult,
  FulltextItem,
  ImportBatch,
  ImportSummary,
  PrismaSummary,
  Project,
  ProjectSource,
  PairedEntry,
  RawExtraction,
  TreatmentClassification,
  FieldSettings,
  Protocol,
  ProtocolDraft,
  ProtocolExport,
  ProviderConfig,
  ProviderPreset,
  ReferenceDetail,
  ResultsRow,
  SaveTemplateResult,
  ScreeningPage,
  ScreeningSuggestion,
  SearchDatabase,
  SearchQueryResult,
  SearchSkill,
  SourceStat,
  StrategyWithDatabase,
} from './types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'error' in data && data.error) ||
      `请求失败 (HTTP ${res.status})`;
    throw new Error(String(msg));
  }
  return data as T;
}

function jsonOptions(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const api = {
  // —— 设置 ——
  getSettings: () => request<AppSettings>('/api/settings'),
  putSettings: (s: AppSettings) =>
    request<AppSettings>('/api/settings', jsonOptions('PUT', s)),
  getPresets: () => request<ProviderPreset[]>('/api/settings/presets'),
  testLLM: (p: ProviderConfig) =>
    request<{ ok: boolean; reply?: string; error?: string }>(
      '/api/settings/test-llm',
      jsonOptions('POST', p),
    ),
  testMineru: (t?: { token?: string; baseUrl?: string }) =>
    request<{ ok: boolean; message: string }>(
      '/api/settings/test-mineru',
      jsonOptions('POST', t ?? {}),
    ),

  // —— 项目 ——
  getProjects: () => request<Project[]>('/api/projects'),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (name: string, description?: string) =>
    request<Project>(
      '/api/projects',
      jsonOptions('POST', { name, description }),
    ),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  renameProject: (id: string, name: string) =>
    request<Project>(
      `/api/projects/${id}`,
      jsonOptions('PATCH', { name }),
    ),

  // —— Agent 技能 / 知识 ——
  listSkills: () => request<AgentSkill[]>('/api/agent/skills'),
  createSkill: (input: { name: string; description: string; content: string }) =>
    request<AgentSkill>('/api/agent/skills', jsonOptions('POST', input)),
  updateSkill: (id: string, input: { name: string; description: string; content: string }) =>
    request<AgentSkill>(`/api/agent/skills/${id}`, jsonOptions('PUT', input)),
  deleteSkill: (id: string) =>
    request<{ ok: boolean }>(`/api/agent/skills/${id}`, { method: 'DELETE' }),
  listKnowledge: () => request<AgentKnowledge[]>('/api/agent/knowledge'),
  uploadKnowledge: (name: string, description: string, file: File) => {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('description', description);
    fd.append('file', file);
    return request<AgentKnowledge>('/api/agent/knowledge', { method: 'POST', body: fd });
  },
  deleteKnowledge: (id: string) =>
    request<{ ok: boolean }>(`/api/agent/knowledge/${id}`, { method: 'DELETE' }),

  // —— 排除理由 ——
  getExclusionReasons: (projectId: string) =>
    request<ExclusionReason[]>(`/api/projects/${projectId}/exclusion-reasons`),
  saveExclusionReasons: (projectId: string, reasons: Array<{ id?: string; label: string }>) =>
    request<ExclusionReason[]>(
      `/api/projects/${projectId}/exclusion-reasons`,
      jsonOptions('PUT', { reasons }),
    ),
  suggestExclusionReasons: (projectId: string) =>
    request<{ reasons: string[] }>(
      `/api/projects/${projectId}/exclusion-reasons/suggest`,
      jsonOptions('POST', {}),
    ),

  // —— 数据库 ——
  getDatabases: (projectId: string) =>
    request<ProjectSource[]>(`/api/projects/${projectId}/databases`),
  getDatabasePresets: () =>
    request<Array<{ presetKey?: string; name: string; url?: string; note?: string }>>(
      '/api/databases/presets',
    ),
  addDatabase: (
    projectId: string,
    d: { presetKey?: string; name: string; url?: string; note?: string },
  ) => request<ProjectSource>(`/api/projects/${projectId}/databases`, jsonOptions('POST', d)),
  deleteDatabase: (projectId: string, sourceId: string) =>
    request<{ deletedStrategies: number; deletedReferences: number }>(
      `/api/projects/${projectId}/databases/${sourceId}`,
      { method: 'DELETE' },
    ),
  getSearchSkills: () => request<SearchSkill[]>('/api/search-skills'),

  // —— 协议 ——
  getProtocol: (projectId: string) =>
    request<Protocol | null>(`/api/projects/${projectId}/protocol`),
  putProtocol: (
    projectId: string,
    p: {
      title: string;
      objective: string;
      pico: PICO;
      criteria: Criterion[];
      outcomes: string[];
    },
  ) =>
    request<Protocol>(
      `/api/projects/${projectId}/protocol`,
      jsonOptions('PUT', p),
    ),
  generateProtocol: (projectId: string, researchQuestion: string) =>
    request<ProtocolDraft>(
      `/api/projects/${projectId}/protocol/generate`,
      jsonOptions('POST', { researchQuestion }),
    ),
  exportProtocol: (projectId: string) =>
    request<ProtocolExport>(`/api/projects/${projectId}/protocol/export`),

  // —— 检索式 ——
  getStrategies: (projectId: string) =>
    request<StrategyWithDatabase[]>(`/api/projects/${projectId}/strategies`),
  createStrategy: (
    projectId: string,
    s: {
      databaseId: string;
      query: string;
      notes?: string;
      generatedBy: 'ai' | 'manual';
    },
  ) =>
    request<StrategyWithDatabase>(
      `/api/projects/${projectId}/strategies`,
      jsonOptions('POST', s),
    ),
  updateStrategy: (id: string, s: { query: string; notes?: string }) =>
    request<{ ok: boolean }>(
      `/api/strategies/${id}`,
      jsonOptions('PUT', s),
    ),
  deleteStrategy: (id: string) =>
    request<{ ok: boolean }>(`/api/strategies/${id}`, { method: 'DELETE' }),
  generateStrategy: (projectId: string, databaseId: string) =>
    request<SearchQueryResult>(
      `/api/projects/${projectId}/strategies/generate`,
      jsonOptions('POST', { databaseId }),
    ),

  // —— 初筛 ——
  importReferences: (
    projectId: string,
    text: string,
    opts?: { format?: 'ris' | 'medline' | 'bibtex'; strategyId?: string; databaseId?: string },
  ) =>
    request<ImportSummary>(
      `/api/projects/${projectId}/references/import`,
      jsonOptions('POST', { text, ...opts }),
    ),
  getImportBatches: (projectId: string) =>
    request<ImportBatch[]>(`/api/projects/${projectId}/import-batches`),
  deleteImportBatch: (id: string) =>
    request<{ deleted: number }>(`/api/import-batches/${id}`, { method: 'DELETE' }),
  deleteReference: (id: string) =>
    request<{ ok: boolean }>(`/api/references/${id}`, { method: 'DELETE' }),
  deleteReferencesBatch: (ids: string[]) =>
    request<{ deleted: number }>('/api/references/batch-delete', jsonOptions('POST', { ids })),
  importReferencesFile: (projectId: string, file: File, strategyId?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    const qs = strategyId ? `?strategyId=${encodeURIComponent(strategyId)}` : '';
    return request<ImportSummary>(
      `/api/projects/${projectId}/references/import-file${qs}`,
      { method: 'POST', body: fd },
    );
  },
  getReferenceDetail: (id: string) => request<ReferenceDetail>(`/api/references/${id}`),
  getReferences: (
    projectId: string,
    opts?: {
      status?: string;
      search?: string;
      page?: number;
      pageSize?: number;
      includeDuplicates?: boolean;
    },
  ) => {
    const qs = new URLSearchParams();
    qs.set('status', opts?.status ?? 'all');
    if (opts?.search) qs.set('search', opts.search);
    if (opts?.page) qs.set('page', String(opts.page));
    if (opts?.pageSize) qs.set('pageSize', String(opts.pageSize));
    if (opts?.includeDuplicates) qs.set('includeDuplicates', 'true');
    return request<ScreeningPage>(
      `/api/projects/${projectId}/references?${qs.toString()}`,
    );
  },
  decideReference: (
    id: string,
    d: { decision: 'include' | 'exclude' | 'undecided'; reasons: string[]; note?: string },
  ) => request<{ status: string }>(`/api/references/${id}/decision`, jsonOptions('POST', d)),
  suggestReference: (id: string) =>
    request<ScreeningSuggestion>(`/api/references/${id}/suggest`, jsonOptions('POST', {})),
  suggestBatch: (projectId: string, referenceIds?: string[], chunkSize?: number, force = false) =>
    request<BatchSuggestResult>(
      `/api/projects/${projectId}/screening/suggest-batch`,
      jsonOptions('POST', { referenceIds, chunkSize, force }),
    ),
  mergeScreening: (projectId: string) =>
    request<{ groups: number; duplicates: number }>(
      `/api/projects/${projectId}/screening/merge`,
      jsonOptions('POST', {}),
    ),
  acceptAiSuggestions: (projectId: string, referenceIds?: string[]) =>
    request<AcceptAiResult>(
      `/api/projects/${projectId}/screening/accept-ai`,
      jsonOptions('POST', { referenceIds }),
    ),

  // —— 全文 ——
  getFulltext: (projectId: string) =>
    request<FulltextItem[]>(`/api/projects/${projectId}/fulltext`),
  uploadDocument: (referenceId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<DocumentInfo>(`/api/references/${referenceId}/document`, {
      method: 'POST',
      body: fd,
    });
  },
  getDocument: (referenceId: string) =>
    request<DocumentInfo | null>(`/api/references/${referenceId}/document`),
  convertDocument: (referenceId: string) =>
    request<DocumentInfo>(
      `/api/references/${referenceId}/document/convert`,
      jsonOptions('POST', {}),
    ),
  convertAllDocuments: (projectId: string) =>
    request<{ started: number }>(
      `/api/projects/${projectId}/documents/convert-all`,
      jsonOptions('POST', {}),
    ),
  getMarkdown: (referenceId: string) =>
    request<{ markdown: string; state: string }>(
      `/api/references/${referenceId}/document/markdown`,
    ),
  fulltextDecision: (
    referenceId: string,
    d: { decision: 'include' | 'exclude' | 'undecided'; reasons: string[]; note?: string },
  ) =>
    request<{ status: string }>(
      `/api/references/${referenceId}/fulltext/decision`,
      jsonOptions('POST', d),
    ),
  fulltextSuggest: (referenceId: string) =>
    request<ScreeningSuggestion>(
      `/api/references/${referenceId}/fulltext/suggest`,
      jsonOptions('POST', {}),
    ),

  // —— 数据提取与结果 ——
  getRawExtraction: (referenceId: string) =>
    request<RawExtraction | null>(`/api/references/${referenceId}/raw-extraction`),
  saveRawExtraction: (referenceId: string, data: RawExtraction) =>
    request<RawExtraction>(`/api/references/${referenceId}/raw-extraction`, jsonOptions('PUT', data)),
  runRawExtraction: (referenceId: string) =>
    request<RawExtraction>(`/api/references/${referenceId}/raw-extraction/run`, jsonOptions('POST', {})),
  clearExtraction: (referenceId: string) =>
    request<{ ok: boolean }>(`/api/references/${referenceId}/extraction`, { method: 'DELETE' }),
  getClassification: (referenceId: string) =>
    request<TreatmentClassification | null>(`/api/references/${referenceId}/classification`),
  saveClassification: (referenceId: string, data: TreatmentClassification) =>
    request<TreatmentClassification>(`/api/references/${referenceId}/classification`, jsonOptions('PUT', data)),
  suggestClassification: (referenceId: string) =>
    request<TreatmentClassification>(`/api/references/${referenceId}/classification/suggest`, jsonOptions('POST', {})),
  getPairedEntries: (referenceId: string) =>
    request<{ entries: PairedEntry[] }>(`/api/references/${referenceId}/paired-entries`),
  savePairedEntries: (referenceId: string, entries: PairedEntry[]) =>
    request<{ ok: boolean }>(`/api/references/${referenceId}/paired-entries`, jsonOptions('PUT', { entries })),
  generatePairedEntries: (referenceId: string) =>
    request<{ entries: PairedEntry[] }>(`/api/references/${referenceId}/paired-entries/generate`, jsonOptions('POST', {})),
  listPairedEntries: (projectId: string) =>
    request<Array<{ referenceId: string; title: string; entries: PairedEntry[] }>>(`/api/projects/${projectId}/paired-entries`),
  exportPairedCSV: (projectId: string) => `/api/projects/${projectId}/paired-entries/export.csv`,
  getFieldSettings: (projectId: string) =>
    request<FieldSettings>(`/api/projects/${projectId}/extraction-field-settings`),
  saveFieldSettings: (projectId: string, data: FieldSettings) =>
    request<FieldSettings>(`/api/projects/${projectId}/extraction-field-settings`, jsonOptions('PUT', data)),
  generateFieldSettings: (projectId: string) =>
    request<FieldSettings>(`/api/projects/${projectId}/extraction-field-settings/generate`, jsonOptions('POST', {})),
  extractReference: (referenceId: string) =>
    request<ExtractionResult>(
      `/api/references/${referenceId}/extract`,
      jsonOptions('POST', {}),
    ),
  getExtraction: (referenceId: string) =>
    request<ExtractionResult | null>(`/api/references/${referenceId}/extraction`),
  getExtractionTemplate: (projectId: string) =>
    request<ExtractionFieldDef[] | null>(`/api/projects/${projectId}/extraction-template`),
  putExtractionTemplate: (projectId: string, fields: ExtractionFieldDef[]) =>
    request<SaveTemplateResult>(
      `/api/projects/${projectId}/extraction-template`,
      jsonOptions('PUT', { fields }),
    ),
  proposeExtractionTemplate: (projectId: string) =>
    request<ExtractionFieldDef[]>(
      `/api/projects/${projectId}/extraction-template/propose`,
      jsonOptions('POST', {}),
    ),
  updateFigure: (id: string, f: { status?: string; extractedValueNote?: string }) =>
    request<{ ok: boolean }>(`/api/figures/${id}`, jsonOptions('PUT', f)),
  getExtractions: (projectId: string) =>
    request<ResultsRow[]>(`/api/projects/${projectId}/extractions`),
  getPrismaSummary: (projectId: string) =>
    request<PrismaSummary>(`/api/projects/${projectId}/results/prisma`),
  getSourceStats: (projectId: string) =>
    request<SourceStat[]>(`/api/projects/${projectId}/stats/sources`),
  exportResults: (projectId: string) =>
    request<{ csv: string }>(`/api/projects/${projectId}/results/export`),
  getDocumentStates: (referenceIds: string[]) =>
    request<DocumentStatesResponse>(
      '/api/documents/states',
      jsonOptions('POST', { referenceIds }),
    ),

  // —— 项目级初筛 AI 设置 ——
  getAiSettings: (projectId: string) =>
    request<AiSettings | null>(`/api/projects/${projectId}/ai-settings`),
  saveAiSettings: (
    projectId: string,
    input: {
      screeningProviderId?: string | null;
      screeningSystemPrompt?: string | null;
      fulltextSystemPrompt?: string | null;
      extractionSystemPrompt?: string | null;
    },
  ) => request<AiSettings>(`/api/projects/${projectId}/ai-settings`, jsonOptions('PUT', input)),
  generateScreeningPrompt: (projectId: string) =>
    request<{ prompt: string }>(
      `/api/projects/${projectId}/ai-settings/generate-prompt`,
      jsonOptions('POST', {}),
    ),
  generateFulltextPrompt: (projectId: string) =>
    request<{ prompt: string }>(
      `/api/projects/${projectId}/ai-settings/generate-fulltext-prompt`,
      jsonOptions('POST', {}),
    ),
  generateExtractionPrompt: (projectId: string) =>
    request<{ prompt: string }>(
      `/api/projects/${projectId}/ai-settings/generate-extraction-prompt`,
      jsonOptions('POST', {}),
    ),

  // —— 项目 Agent ——
  getAgentHistory: (projectId: string) =>
    request<{ messages: AgentMessage[] }>(`/api/projects/${projectId}/agent/history`),
  putAgentHistory: (projectId: string, messages: AgentMessage[]) =>
    request<{ ok: boolean }>(
      `/api/projects/${projectId}/agent/history`,
      jsonOptions('PUT', { messages }),
    ),
  agentChat: (projectId: string, messages: AgentMessage[], signal?: AbortSignal) =>
    request<AgentChatResponse>(
      `/api/projects/${projectId}/agent/chat`,
      { ...jsonOptions('POST', { messages }), signal },
    ),
  agentQuick: (projectId: string, type: 'search_strategy' | 'extraction_table') =>
    request<{ proposals: AgentProposal[] }>(
      `/api/projects/${projectId}/agent/quick`,
      jsonOptions('POST', { type }),
    ),
};
