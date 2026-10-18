import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { SCHEMA_SQL } from './ddl';
import * as schema from './schema';

/** 数据目录（可用环境变量 META_DATA_DIR 覆盖）。
 * 兼容 esbuild CJS 打包（__dirname）与 tsx ESM 开发（import.meta.url）。 */
const serverRoot =
  typeof __dirname !== 'undefined'
    ? __dirname
    : fileURLToPath(new URL('../../', import.meta.url));

export const DATA_DIR =
  process.env.META_DATA_DIR ?? path.resolve(serverRoot, '../../data');

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const MARKDOWN_DIR = path.join(DATA_DIR, 'markdown');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(MARKDOWN_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'meta.db');

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.exec(SCHEMA_SQL);

// 幂等迁移：为已存在的 references 表补 import_batch_id 列（新建库已由 DDL 包含）
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${ddl}`);
  }
}
ensureColumn('references', 'import_batch_id', 'TEXT');
// 幂等迁移：为已存在且可能有数据的表补新列。
// 注意：这里用可空列，避免 ALTER TABLE ADD COLUMN ... NOT NULL 在有历史行时报错；
// 新建库由 DDL 创建时按 NOT NULL。历史测试数据会在最终验证前清空。
ensureColumn('search_databases', 'project_id', 'TEXT');
ensureColumn('search_databases', 'preset_key', 'TEXT');
ensureColumn('references', 'import_order', 'INTEGER');
ensureColumn('screen_decisions', 'reason_note', 'TEXT');
ensureColumn('projects', 'folder_name', 'TEXT');
ensureColumn('project_ai_settings', 'fulltext_system_prompt', 'TEXT');
ensureColumn('project_ai_settings', 'extraction_system_prompt', 'TEXT');
// 回填历史项目：文件夹名默认沿用其项目 ID（即旧 UUID 目录）
sqlite.exec('UPDATE projects SET folder_name = id WHERE folder_name IS NULL');

// 依赖迁移新列的索引：必须在 ensureColumn 之后再建
sqlite.exec(`
CREATE INDEX IF NOT EXISTS idx_references_import_order ON "references" (import_order);
CREATE INDEX IF NOT EXISTS idx_databases_project ON search_databases (project_id);
`);

export const db = drizzle(sqlite, { schema });

/**
 * 「db 实例或事务对象」的公共类型：只取两者共有的查询构造方法。
 * 这样既能传 `db`，也能传 `db.transaction(tx => ...)` 里的 tx。
 */
export type DbLike = Pick<typeof db, 'select' | 'selectDistinct' | 'insert' | 'update' | 'delete'>;

/** 在单个 SQLite 事务中执行（同步驱动） */
export function inTransaction<T>(fn: (tx: DbLike) => T): T {
  return db.transaction((tx) => fn(tx));
}

export { sqlite };
