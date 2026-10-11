import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-rawtest-'));
process.env.META_DATA_DIR = tmpDir;

const { db } = await import('../src/db/client.ts');
const schema = await import('../src/db/schema.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('数据提取三张表可创建并可读写', () => {
  const now = new Date().toISOString();
  db.insert(schema.rawExtractions)
    .values({ id: 'r1', referenceId: 'ref1', data: '{"study":{}}', createdAt: now, updatedAt: now })
    .run();
  db.insert(schema.treatmentClassifications)
    .values({ id: 'c1', referenceId: 'ref1', data: '{"groups":[]}', createdAt: now, updatedAt: now })
    .run();
  db.insert(schema.pairedEntries)
    .values({ id: 'p1', referenceId: 'ref1', data: '{"entries":[]}', createdAt: now, updatedAt: now })
    .run();
  assert.equal(db.select().from(schema.rawExtractions).all().length, 1);
  assert.equal(db.select().from(schema.treatmentClassifications).all().length, 1);
  assert.equal(db.select().from(schema.pairedEntries).all().length, 1);
});
