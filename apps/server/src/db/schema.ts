import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** 应用设置（单行存储 JSON） */
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  data: text('data').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  folderName: text('folder_name'),
  createdAt: text('created_at').notNull(),
});

export const protocols = sqliteTable('protocols', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  objective: text('objective').notNull().default(''),
  pico: text('pico').notNull().default('{}'),
  criteria: text('criteria').notNull().default('[]'),
  outcomes: text('outcomes').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const searchDatabases = sqliteTable('search_databases', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  url: text('url'),
  note: text('note'),
  presetKey: text('preset_key'),
});

export const searchStrategies = sqliteTable('search_strategies', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  databaseId: text('database_id').notNull(),
  query: text('query').notNull(),
  notes: text('notes'),
  generatedBy: text('generated_by').notNull(),
  createdAt: text('created_at').notNull(),
});

export const references = sqliteTable('references', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  authors: text('authors').notNull().default('[]'),
  abstract: text('abstract').notNull().default(''),
  year: integer('year'),
  journal: text('journal'),
  doi: text('doi'),
  pmid: text('pmid'),
  url: text('url'),
  sourceDatabaseId: text('source_database_id'),
  sourceQueryId: text('source_query_id'),
  importBatchId: text('import_batch_id'),
  importOrder: integer('import_order').notNull(),
  dedupGroupId: text('dedup_group_id'),
  isDuplicate: integer('is_duplicate').notNull().default(0),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const screenDecisions = sqliteTable('screen_decisions', {
  id: text('id').primaryKey(),
  referenceId: text('reference_id').notNull(),
  stage: text('stage').notNull(),
  decision: text('decision').notNull(),
  aiSuggestion: text('ai_suggestion'),
  aiReason: text('ai_reason'),
  reasons: text('reasons').notNull().default('[]'),
  note: text('note'),
  reasonNote: text('reason_note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  referenceId: text('reference_id').notNull(),
  pdfPath: text('pdf_path').notNull(),
  markdownPath: text('markdown_path'),
  mineruTaskId: text('mineru_task_id'),
  state: text('state').notNull(),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const figures = sqliteTable('figures', {
  id: text('id').primaryKey(),
  referenceId: text('reference_id').notNull(),
  documentId: text('document_id').notNull(),
  index: integer('idx').notNull(),
  caption: text('caption'),
  location: text('location'),
  status: text('status').notNull(),
  extractedValueNote: text('extracted_value_note'),
});

export const extractions = sqliteTable('extractions', {
  id: text('id').primaryKey(),
  referenceId: text('reference_id').notNull(),
  fields: text('fields').notNull().default('[]'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const importBatches = sqliteTable('import_batches', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  strategyId: text('strategy_id'),
  databaseId: text('database_id'),
  format: text('format'),
  importedCount: integer('imported_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  totalCount: integer('total_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const extractionTemplates = sqliteTable('extraction_templates', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  fields: text('fields').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agentConversations = sqliteTable('agent_conversations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  messages: text('messages').notNull().default('[]'),
  updatedAt: text('updated_at').notNull(),
});

export const exclusionReasons = sqliteTable('exclusion_reasons', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  code: text('code').notNull(),
  label: text('label').notNull(),
  isBuiltin: integer('is_builtin').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const projectAiSettings = sqliteTable('project_ai_settings', {
  projectId: text('project_id').primaryKey(),
  screeningProviderId: text('screening_provider_id'),
  screeningSystemPrompt: text('screening_system_prompt'),
  fulltextSystemPrompt: text('fulltext_system_prompt'),
  extractionSystemPrompt: text('extraction_system_prompt'),
  updatedAt: text('updated_at').notNull(),
});

export const agentSkills = sqliteTable('agent_skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agentKnowledge = sqliteTable('agent_knowledge', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  format: text('format').notNull(),
  sourcePath: text('source_path'),
  createdAt: text('created_at').notNull(),
});

export const agentKnowledgeChunks = sqliteTable('agent_knowledge_chunks', {
  id: text('id').primaryKey(),
  knowledgeId: text('knowledge_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  text: text('text').notNull(),
});

export const rawExtractions = sqliteTable('raw_extractions', {
  id: text('id').primaryKey(),
  referenceId: text('reference_id').notNull(),
  data: text('data').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const treatmentClassifications = sqliteTable('treatment_classifications', {
  id: text('id').primaryKey(),
  referenceId: text('reference_id').notNull(),
  data: text('data').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const pairedEntries = sqliteTable('paired_entries', {
  id: text('id').primaryKey(),
  referenceId: text('reference_id').notNull(),
  data: text('data').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const extractionFieldSettings = sqliteTable('extraction_field_settings', {
  projectId: text('project_id').primaryKey(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
});
