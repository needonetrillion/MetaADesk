import type {
  Criterion,
  PICO,
  Protocol,
  SearchDatabase,
  SearchStrategy,
} from '@meta/core';

export type { Criterion, PICO, Protocol, SearchDatabase, SearchStrategy };

export interface ProviderConfig {
  id: string;
  name: string;
  kind: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface AppSettings {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  screeningProviderId: string | null;
  mineruToken: string;
  mineruBaseUrl?: string;
}

export interface ProviderPreset {
  name: string;
  kind: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  model: string;
  needsKey: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  referenceCount: number;
}

/** 检索式（含数据库名称，便于展示） */
export interface StrategyWithDatabase extends SearchStrategy {
  databaseName: string;
  importedCount: number;
}

/** AI 生成检索式结果 */
export interface SearchQueryResult {
  query: string;
  notes?: string;
  databaseId: string;
  databaseName: string;
}

/** AI 生成的协议草案 */
export interface ProtocolDraft {
  title: string;
  objective: string;
  pico: PICO;
  criteria: Criterion[];
  outcomes: string[];
}

/** 协议导出文本 */
export interface ProtocolExport {
  title: string;
  text: string;
}

/** 初筛列表项（文献 + 题摘判定） */
export interface ScreeningItem {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  status: string;
  isDuplicate: boolean;
  dedupGroupId?: string;
  importBatchId?: string;
  sourceName?: string;
  decision?: 'include' | 'exclude' | 'undecided';
  aiSuggestion?: 'include' | 'exclude' | 'undecided';
  aiReason?: string;
  reasons: string[];
  note?: string;
  createdAt: string;
}

/** 初筛状态计数（去重后口径，重复条目单独计数） */
export interface ScreeningCounts {
  total: number;
  pending: number;
  included: number;
  excluded: number;
  duplicates: number;
}

/** 初筛分页响应 */
export interface ScreeningPage {
  items: ScreeningItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: ScreeningCounts;
}

/** 批量 AI 建议结果（含部分失败信息） */
export interface BatchSuggestResult {
  suggestions: Array<{
    referenceId: string;
    decision: 'include' | 'exclude' | 'undecided';
    reason: string;
  }>;
  failed: Array<{ referenceId: string; error: string }>;
  skipped: number;
  total: number;
}

/** 批量接受 AI 判定结果 */
export interface AcceptAiResult {
  accepted: number;
  skipped: number;
}

export interface ImportSummary {
  imported: number;
  duplicates: number;
  total: number;
  batchId: string;
}

export interface ImportBatch {
  id: string;
  projectId: string;
  strategyId?: string;
  databaseId?: string;
  databaseName?: string;
  format?: string;
  importedCount: number;
  duplicateCount: number;
  totalCount: number;
  createdAt: string;
}

export interface ScreeningSuggestion {
  decision: 'include' | 'exclude' | 'undecided';
  reason: string;
}

/** 文档（PDF → Markdown）状态 */
export interface DocumentInfo {
  id: string;
  referenceId: string;
  pdfPath: string;
  markdownPath?: string;
  mineruTaskId?: string;
  state: 'pending' | 'converting' | 'done' | 'failed';
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** 全文流程候选条目 */
export interface FulltextItem {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  doi?: string;
  status: string;
  decision?: 'include' | 'exclude' | 'undecided';
  aiSuggestion?: 'include' | 'exclude' | 'undecided';
  aiReason?: string;
  reasons: string[];
  note?: string;
  documentState?: string;
  documentError?: string;
}

export interface ExtractionFieldDef {
  key: string;
  label: string;
  description?: string;
}

/** 保存字段表的结果（含 key 变更导致的历史数据迁移信息） */
export interface SaveTemplateResult {
  fields: ExtractionFieldDef[];
  migrated: number;
  renamed: Array<{ from: string; to: string }>;
}

/** 项目级来源库 */
export interface ProjectSource {
  id: string;
  projectId: string;
  name: string;
  url?: string;
  note?: string;
  presetKey?: string;
  strategyCount: number;
}

/** 来源库命中统计 */
export interface SourceStat {
  sourceId: string;
  name: string;
  rawImported: number;
  uniqueKept: number;
  duplicateRemoved: number;
}

/** 项目级初筛 AI 设置 */
export interface AiSettings {
  projectId: string;
  screeningProviderId: string | null;
  screeningSystemPrompt: string | null;
  fulltextSystemPrompt: string | null;
  extractionSystemPrompt: string | null;
  updatedAt: string;
}

/** PRISMA 排除理由计数 */
export interface ReasonCount {
  code: string;
  label: string;
  count: number;
}

/** 单个筛选阶段的排除理由汇总 */
export interface StageReasonSummary {
  stage: 'title_abstract' | 'fulltext';
  excluded: number;
  reasons: ReasonCount[];
  withoutReason: number;
}

/** PRISMA 流程与排除理由汇总 */
export interface PrismaSummary {
  flow: {
    total: number;
    duplicatesRemoved: number;
    screened: number;
    tasExcluded: number;
    tasIncluded: number;
    fulltextAssessed: number;
    ftExcluded: number;
    ftIncluded: number;
    extracted: number;
    awaitingScreening: number;
    awaitingFulltext: number;
    awaitingExtraction: number;
  };
  exclusion: {
    titleAbstract: StageReasonSummary;
    fulltext: StageReasonSummary;
  };
}

/** 批量文档状态（前端轮询） */
export interface DocumentStatesResponse {
  mineruTimeoutSeconds: number;
  documents: Array<{ referenceId: string; state: string; error?: string }>;
}

export interface FigureInfo {
  id: string;
  index: number;
  caption?: string;
  location?: string;
  status: string;
  extractedValueNote?: string;
}

export interface ExtractionResult {
  referenceId: string;
  values: Record<string, string>;
  figures: FigureInfo[];
  completedAt?: string;
}

export interface ResultsRow {
  referenceId: string;
  title: string;
  year?: number;
  journal?: string;
  values: Record<string, string>;
  figures: FigureInfo[];
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentProtocolProposal {
  kind: 'protocol';
  title: string;
  payload: ProtocolDraft;
}

export interface AgentSearchQueryProposal {
  kind: 'search_query';
  title: string;
  payload: {
    databaseId: string;
    databaseName: string;
    query: string;
    notes: string;
  };
}

export interface AgentSearchStrategyProposal {
  kind: 'search_strategy';
  title: string;
  payload: {
    queries: Array<{
      databaseId: string;
      databaseName: string;
      query: string;
      notes: string;
    }>;
  };
}

export interface AgentExtractionTableProposal {
  kind: 'extraction_table';
  title: string;
  payload: {
    fields: ExtractionFieldDef[];
  };
}

export interface AgentScreeningPromptProposal {
  kind: 'screening_prompt';
  title: string;
  payload: {
    prompt: string;
  };
}

export type AgentProposal =
  | AgentProtocolProposal
  | AgentSearchQueryProposal
  | AgentSearchStrategyProposal
  | AgentExtractionTableProposal
  | AgentScreeningPromptProposal;

export interface AgentChatResponse {
  reply: string;
  proposals: AgentProposal[];
}

export interface SearchSkill {
  id: string;
  name: string;
  fieldSyntax: string;
  operators: string;
  orWithinField: string;
  example: string;
  guidance: string;
  verifyNote?: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentKnowledge {
  id: string;
  name: string;
  description: string;
  format: string;
  chunkCount: number;
  createdAt: string;
}

export interface ReferenceDetail {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  journal?: string;
  year?: number;
  doi?: string;
  pmid?: string;
  url?: string;
  sourceName?: string;
}

export interface ExclusionReason {
  id: string;
  code: string;
  label: string;
  isBuiltin: boolean;
  sortOrder: number;
}

export interface RawArm {
  id: string;
  values: Record<string, string>;
}
export interface RawOutcome {
  id: string;
  armId: string;
  outcome: string;
  values: Record<string, string>;
}
export interface RawExtraction {
  study: Record<string, string>;
  arms: RawArm[];
  outcomes: RawOutcome[];
}
export interface TreatmentGroup {
  name: string;
  type: 'experiment' | 'control' | 'other';
}
export interface Pairing {
  treatment: string;
  control: string;
}
export interface TreatmentClassification {
  groups: TreatmentGroup[];
  pairings: Pairing[];
}
export interface PairedEntry {
  id: string;
  treatment: string;
  control: string;
  outcome: string;
  treatmentN?: string;
  controlN?: string;
  treatmentMean?: string;
  controlMean?: string;
  treatmentSd?: string;
  controlSd?: string;
  unit?: string;
  timePoint?: string;
  sharedControl: boolean;
}

export interface FieldDef {
  key: string;
  label: string;
  description?: string;
}
export interface FieldSection {
  id: string;
  name: string;
  level: 'study' | 'arm' | 'outcome';
  appliesTo?: 'all' | 'experiment' | 'control';
  repeatPerOutcome?: boolean;
  outcomes?: string[];
  fields: FieldDef[];
}
export interface FieldSettings {
  sections: FieldSection[];
}
