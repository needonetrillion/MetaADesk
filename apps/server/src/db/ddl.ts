/**
 * 手写 DDL，与 schema.ts 保持一致。
 * 启动时用 CREATE TABLE IF NOT EXISTS 幂等建表，避免引入额外迁移工具链。
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  folder_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS protocols (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  pico TEXT NOT NULL DEFAULT '{}',
  criteria TEXT NOT NULL DEFAULT '[]',
  outcomes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_databases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  note TEXT,
  preset_key TEXT
);

CREATE TABLE IF NOT EXISTS search_strategies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  query TEXT NOT NULL,
  notes TEXT,
  generated_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "references" (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '[]',
  abstract TEXT NOT NULL DEFAULT '',
  year INTEGER,
  journal TEXT,
  doi TEXT,
  pmid TEXT,
  url TEXT,
  source_database_id TEXT,
  source_query_id TEXT,
  import_batch_id TEXT,
  import_order INTEGER NOT NULL,
  dedup_group_id TEXT,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS screen_decisions (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  decision TEXT NOT NULL,
  ai_suggestion TEXT,
  ai_reason TEXT,
  reasons TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  reason_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL,
  pdf_path TEXT NOT NULL,
  markdown_path TEXT,
  mineru_task_id TEXT,
  state TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS figures (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  caption TEXT,
  location TEXT,
  status TEXT NOT NULL,
  extracted_value_note TEXT
);

CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  strategy_id TEXT,
  database_id TEXT,
  format TEXT,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extraction_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exclusion_reasons (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_ai_settings (
  project_id TEXT PRIMARY KEY,
  screening_provider_id TEXT,
  screening_system_prompt TEXT,
  fulltext_system_prompt TEXT,
  extraction_system_prompt TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_references_project ON "references" (project_id);
CREATE INDEX IF NOT EXISTS idx_references_dedup_group ON "references" (dedup_group_id);
CREATE INDEX IF NOT EXISTS idx_references_source_database ON "references" (source_database_id);
CREATE INDEX IF NOT EXISTS idx_references_source_query ON "references" (source_query_id);
CREATE INDEX IF NOT EXISTS idx_exclusion_reasons_project ON exclusion_reasons (project_id);
CREATE INDEX IF NOT EXISTS idx_references_import_batch ON "references" (import_batch_id);
CREATE INDEX IF NOT EXISTS idx_decisions_reference ON screen_decisions (reference_id);
CREATE INDEX IF NOT EXISTS idx_documents_reference ON documents (reference_id);
CREATE INDEX IF NOT EXISTS idx_extractions_reference ON extractions (reference_id);
CREATE INDEX IF NOT EXISTS idx_figures_reference ON figures (reference_id);
CREATE INDEX IF NOT EXISTS idx_batches_project ON import_batches (project_id);
CREATE INDEX IF NOT EXISTS idx_templates_project ON extraction_templates (project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON agent_conversations (project_id);

CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_knowledge (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  format TEXT NOT NULL,
  source_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_knowledge_chunks (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_chunks ON agent_knowledge_chunks (knowledge_id);

CREATE TABLE IF NOT EXISTS raw_extractions (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_extractions_ref ON raw_extractions (reference_id);

CREATE TABLE IF NOT EXISTS treatment_classifications (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_classifications_ref ON treatment_classifications (reference_id);

CREATE TABLE IF NOT EXISTS paired_entries (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_paired_entries_ref ON paired_entries (reference_id);

CREATE TABLE IF NOT EXISTS extraction_field_settings (
  project_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
