import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-schema-test-'));
process.env.META_DATA_DIR = tmpDir;

const { sqlite, db } = await import('../src/db/client.ts');
const { exclusionReasons } = await import('../src/db/schema.ts');

function columnsOf(table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('新数据模型列与 exclusion_reasons 表存在', () => {
  assert.ok(columnsOf('search_databases').includes('project_id'));
  assert.ok(columnsOf('search_databases').includes('preset_key'));
  assert.ok(columnsOf('references').includes('import_order'));
  assert.ok(columnsOf('screen_decisions').includes('reason_note'));

  const now = new Date().toISOString();
  db.insert(exclusionReasons)
    .values({
      id: 'r1',
      projectId: 'p1',
      code: 'other',
      label: '其他',
      isBuiltin: 1,
      sortOrder: 0,
      createdAt: now,
    })
    .run();
  assert.equal(
    (sqlite.prepare('SELECT count(*) AS c FROM exclusion_reasons').get() as { c: number }).c,
    1,
  );
});
