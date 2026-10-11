import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-refdetail-test-'));
process.env.META_DATA_DIR = tmpDir;

const { getReferenceDetail } = await import('../src/services/references.ts');
const { db } = await import('../src/db/client.ts');
const { references, searchDatabases } = await import('../src/db/schema.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('getReferenceDetail 返回完整题录与来源库名，缺失返回 null', () => {
  const now = new Date().toISOString();
  db.insert(searchDatabases)
    .values({ id: 'db1', projectId: 'p1', name: 'PubMed', presetKey: 'pubmed' })
    .run();
  db.insert(references)
    .values({
      id: 'r1',
      projectId: 'p1',
      title: 'Composting and ammonia',
      authors: JSON.stringify(['Smith J', 'Doe A']),
      abstract: 'We studied ammonia emission.',
      year: 2020,
      journal: 'Bioresource Technology',
      doi: '10.1000/abc',
      pmid: '12345',
      url: 'https://example.com/a',
      sourceDatabaseId: 'db1',
      sourceQueryId: null,
      importBatchId: null,
      importOrder: 1,
      dedupGroupId: randomUUID(),
      isDuplicate: 0,
      status: 'imported',
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const d = getReferenceDetail('r1');
  assert.ok(d);
  assert.equal(d.title, 'Composting and ammonia');
  assert.deepEqual(d.authors, ['Smith J', 'Doe A']);
  assert.equal(d.abstract, 'We studied ammonia emission.');
  assert.equal(d.year, 2020);
  assert.equal(d.journal, 'Bioresource Technology');
  assert.equal(d.doi, '10.1000/abc');
  assert.equal(d.pmid, '12345');
  assert.equal(d.url, 'https://example.com/a');
  assert.equal(d.sourceName, 'PubMed');

  assert.equal(getReferenceDetail('missing'), null);
});
