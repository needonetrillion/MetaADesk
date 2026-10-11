import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-stats-test-'));
process.env.META_DATA_DIR = tmpDir;

const { db } = await import('../src/db/client.ts');
const { references, searchDatabases } = await import('../src/db/schema.ts');
const { mergeDuplicates } = await import('../src/services/merge.ts');
const { sourceStats } = await import('../src/services/stats.ts');
const { buildPrismaSummary } = await import('../src/services/prisma.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function insertRef(sourceId: string, doi: string, order: number): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(references)
    .values({
      id,
      projectId: 'p1',
      title: `T ${doi}`,
      authors: '[]',
      abstract: '',
      doi,
      pmid: null,
      url: null,
      sourceDatabaseId: sourceId,
      sourceQueryId: null,
      importBatchId: null,
      importOrder: order,
      dedupGroupId: randomUUID(),
      isDuplicate: 0,
      status: 'imported',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

test('sourceStats 与 PRISMA 汇总按去重后口径计算', () => {
  const pub = randomUUID();
  const emb = randomUUID();
  db.insert(searchDatabases).values({ id: pub, projectId: 'p1', name: 'PubMed', presetKey: 'pubmed' }).run();
  db.insert(searchDatabases).values({ id: emb, projectId: 'p1', name: 'Embase', presetKey: null }).run();

  insertRef(pub, '10.1/x', 1);
  insertRef(pub, '10.1/y', 2);
  insertRef(emb, '10.1/x', 3);

  mergeDuplicates('p1');

  const stats = sourceStats('p1');
  const pubStat = stats.find((s) => s.sourceId === pub)!;
  const embStat = stats.find((s) => s.sourceId === emb)!;
  assert.equal(pubStat.rawImported, 2);
  assert.equal(pubStat.uniqueKept, 2);
  assert.equal(embStat.rawImported, 1);
  assert.equal(embStat.uniqueKept, 0);

  const flow = buildPrismaSummary('p1').flow;
  assert.equal(flow.duplicatesRemoved, 1);
  assert.equal(flow.screened, 2);
});
