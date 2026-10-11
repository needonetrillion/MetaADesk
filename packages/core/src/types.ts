/**
 * 领域核心类型定义。
 * 这里定义贯穿整个 Meta 分析流程的实体，供 server / web / 各 package 共用。
 */

export type ID = string;

/** 文献在流程中所处的状态 */
export type ReferenceStatus =
  | 'imported' // 已导入题录，待初筛
  | 'screening_tas' // 题摘初筛中
  | 'tas_included' // 初筛纳入 → 待全文
  | 'tas_excluded' // 初筛排除（终态，可撤回）
  | 'fulltext_pending' // 待上传全文 PDF
  | 'fulltext_uploaded' // 全文已上传 / 已转 Markdown
  | 'ft_included' // 全文纳入 → 待数据提取
  | 'ft_excluded' // 全文排除（终态，可撤回）
  | 'extracted'; // 数据已提取（终态）

/** 筛选阶段 */
export type ScreeningStage = 'title_abstract' | 'fulltext';

/** 判定结果 */
export type Decision = 'include' | 'exclude' | 'undecided';

/** PICO 要素 */
export interface PICO {
  population: string;
  intervention: string;
  comparison: string;
  outcome: string;
  studyDesign?: string;
}

/** 纳入 / 排除标准条目 */
export interface Criterion {
  id: ID;
  type: 'inclusion' | 'exclusion';
  text: string;
}

/** 研究方案（协议） */
export interface Protocol {
  id: ID;
  projectId: ID;
  title: string;
  objective: string;
  pico: PICO;
  criteria: Criterion[];
  outcomes: string[]; // 主要 / 次要结局指标
  createdAt: string;
  updatedAt: string;
}

/** 检索数据库 */
export interface SearchDatabase {
  id: ID;
  name: string; // 如 PubMed / Embase / Cochrane / Web of Science
  url?: string;
  note?: string;
}

/** 某个数据库对应的检索式 */
export interface SearchStrategy {
  id: ID;
  projectId: ID;
  databaseId: ID;
  query: string; // 最终检索式
  notes?: string;
  generatedBy: 'ai' | 'manual';
  createdAt: string;
}

/** 文献条目（题录） */
export interface Reference {
  id: ID;
  projectId: ID;
  title: string;
  authors: string[];
  abstract: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  url?: string;
  sourceDatabaseId?: ID; // 来源数据库
  sourceQueryId?: ID; // 来自哪个检索式
  importBatchId?: ID; // 来自哪次导入批次
  dedupGroupId?: ID; // 去重组
  isDuplicate?: boolean; // 是否为重复条目
  status: ReferenceStatus;
  createdAt: string;
  updatedAt: string;
}

/** 单条筛选判定（初筛 / 全文筛） */
export interface ScreenDecision {
  id: ID;
  referenceId: ID;
  stage: ScreeningStage;
  decision: Decision; // 人工最终决定
  aiSuggestion?: Decision; // AI 建议
  aiReason?: string; // AI 给出的理由
  reasons: string[]; // 排除理由编码（见 EXCLUSION_REASONS）
  note?: string; // 人工备注
  createdAt: string;
  updatedAt: string;
}

/** 全文文档（PDF → Markdown） */
export interface Document {
  id: ID;
  referenceId: ID;
  pdfPath: string; // 本地 PDF 路径
  markdownPath?: string; // MinerU 转换后的 Markdown 路径
  mineruTaskId?: string;
  state: 'pending' | 'converting' | 'done' | 'failed';
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** 识别的图表（用于提示人工提取） */
export interface Figure {
  id: ID;
  referenceId: ID;
  documentId: ID;
  index: number; // 第几幅图
  caption?: string;
  location?: string; // 在原文中的位置描述
  status: 'pending' | 'extracted' | 'skipped';
  extractedValueNote?: string; // 人工用工具提取后记录的数值
}

/** 提取的数据字段 */
export interface ExtractionField {
  key: string;
  label: string;
  value: string;
  source?: 'text' | 'table' | 'figure';
  figureId?: ID;
}

/** 数据提取字段表（模板）中的字段定义 */
export interface ExtractionFieldDef {
  key: string;
  label: string;
  description?: string;
}

/** 某篇文献的数据提取结果 */
export interface Extraction {
  id: ID;
  referenceId: ID;
  fields: ExtractionField[];
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
