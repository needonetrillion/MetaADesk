import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-import-test-'));
process.env.META_DATA_DIR = tmpDir;

const { importReferences } = await import('../src/services/references.ts');
const { db } = await import('../src/db/client.ts');
const { references } = await import('../src/db/schema.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('导入不去重并分配递增 import_order', () => {
  const rec = (doi: string) => ({
    title: 'Same Paper',
    authors: [] as string[],
    abstract: '',
    doi,
    sourceFormat: 'ris' as const,
  });

  const a = importReferences('p1', [rec('10.1/x')]);
  const b = importReferences('p1', [rec('10.1/x')]);

  assert.equal(a.imported, 1);
  assert.equal(b.imported, 1);
  assert.equal((a as Record<string, unknown>).duplicates, undefined);
  assert.equal((b as Record<string, unknown>).duplicates, undefined);

  const rows = db
    .select()
    .from(references)
    .where(eq(references.projectId, 'p1'))
    .all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.isDuplicate === 0));
  assert.equal(new Set(rows.map((r) => r.importOrder)).size, 2);
});
