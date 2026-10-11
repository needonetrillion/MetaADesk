import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-targets-test-'));
process.env.META_DATA_DIR = tmpDir;

const { db } = await import('../src/db/client.ts');
const { references, screenDecisions } = await import('../src/db/schema.ts');
const { selectScreeningTargets } = await import('../src/services/references.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedRef(id: string, order: number): void {
  const now = new Date().toISOString();
  db.insert(references)
    .values({
      id,
      projectId: 'p1',
      title: id,
      authors: '[]',
      abstract: '',
      doi: null,
      pmid: null,
      url: null,
      sourceDatabaseId: null,
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
}

function seedSuggestion(refId: string): void {
  const now = new Date().toISOString();
  db.insert(screenDecisions)
    .values({
      id: randomUUID(),
      referenceId: refId,
      stage: 'title_abstract',
      decision: 'undecided',
      aiSuggestion: 'include',
      aiReason: 'r',
      reasons: '[]',
      note: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

test('selectScreeningTargets 跳过已有建议 / 全部重判 / 显式选择', () => {
  seedRef('A', 1);
  seedRef('B', 2);
  seedRef('C', 3);
  seedSuggestion('B');
  seedSuggestion('C');

  assert.deepEqual(selectScreeningTargets('p1', {}).map((x) => x.id), ['A']);
  assert.deepEqual(selectScreeningTargets('p1', { force: true }).map((x) => x.id), ['A', 'B', 'C']);
  assert.deepEqual(selectScreeningTargets('p1', { referenceIds: ['B'] }).map((x) => x.id), ['B']);
});
