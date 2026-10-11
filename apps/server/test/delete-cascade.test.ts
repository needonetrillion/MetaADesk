import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-delete-test-'));
process.env.META_DATA_DIR = tmpDir;

const { deleteStrategyCascade, deleteSourceCascade } = await import('../src/services/delete.ts');
const { db } = await import('../src/db/client.ts');
const { references, screenDecisions, searchDatabases, searchStrategies } = await import('../src/db/schema.ts');
const files = await import('../src/services/files.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRef(input: { sourceId: string; strategyId: string | null; projectId?: string }): string {
  const projectId = input.projectId ?? 'p1';
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(references)
    .values({
      id,
      projectId,
      title: '标题',
      authors: '[]',
      abstract: '',
      doi: null,
      pmid: null,
      url: null,
      sourceDatabaseId: input.sourceId,
      sourceQueryId: input.strategyId,
      importBatchId: null,
      importOrder: Math.floor(Math.random() * 1_000_000),
      dedupGroupId: randomUUID(),
      isDuplicate: 0,
      status: 'imported',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

test('删除检索式与来源库级联清理条目与文件', () => {
  // 场景 1：删检索式
  const sourceA = randomUUID();
  const strategyA = randomUUID();
  const now = new Date().toISOString();
  db.insert(searchDatabases)
    .values({ id: sourceA, projectId: 'p1', name: 'PubMed', presetKey: 'pubmed' })
    .run();
  db.insert(searchStrategies)
    .values({
      id: strategyA,
      projectId: 'p1',
      databaseId: sourceA,
      query: 'q',
      notes: null,
      generatedBy: 'manual',
      createdAt: now,
    })
    .run();
  const refA = makeRef({ sourceId: sourceA, strategyId: strategyA });
  fs.mkdirSync(path.dirname(files.pdfPath('p1', refA)), { recursive: true });
  fs.writeFileSync(files.pdfPath('p1', refA), 'x');
  db.insert(screenDecisions)
    .values({
      id: randomUUID(),
      referenceId: refA,
      stage: 'title_abstract',
      decision: 'undecided',
      aiSuggestion: null,
      aiReason: null,
      reasons: '[]',
      note: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const r = deleteStrategyCascade(strategyA);
  assert.equal(r.deletedReferences, 1);
  assert.equal(db.select().from(references).where(eq(references.id, refA)).all().length, 0);
  assert.equal(fs.existsSync(files.pdfPath('p1', refA)), false);

  // 场景 2：删来源库
  const sourceB = randomUUID();
  const strategyB = randomUUID();
  db.insert(searchDatabases)
    .values({ id: sourceB, projectId: 'p1', name: 'Embase', presetKey: null })
    .run();
  db.insert(searchStrategies)
    .values({
      id: strategyB,
      projectId: 'p1',
      databaseId: sourceB,
      query: 'q2',
      notes: null,
      generatedBy: 'manual',
      createdAt: now,
    })
    .run();
  makeRef({ sourceId: sourceB, strategyId: strategyB });
  makeRef({ sourceId: sourceB, strategyId: strategyB });

  const s = deleteSourceCascade('p1', sourceB);
  assert.equal(s.deletedStrategies, 1);
  assert.equal(s.deletedReferences, 2);
  assert.equal(db.select().from(references).where(eq(references.sourceDatabaseId, sourceB)).all().length, 0);
  assert.equal(db.select().from(searchStrategies).where(eq(searchStrategies.databaseId, sourceB)).all().length, 0);
  assert.equal(db.select().from(searchDatabases).where(eq(searchDatabases.id, sourceB)).all().length, 0);
});
