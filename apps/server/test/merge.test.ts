import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-merge-test-'));
process.env.META_DATA_DIR = tmpDir;

const { importReferences } = await import('../src/services/references.ts');
const { mergeDuplicates } = await import('../src/services/merge.ts');
const { db } = await import('../src/db/client.ts');
const { references, screenDecisions } = await import('../src/db/schema.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function allRefs() {
  return db
    .select()
    .from(references)
    .where(eq(references.projectId, 'p1'))
    .all()
    .sort((a, b) => a.importOrder - b.importOrder);
}

test('mergeDuplicates 分组、幂等、主条目删除后补位', () => {
  const rec = (doi: string) => ({
    title: 'Same Paper',
    authors: [] as string[],
    abstract: '',
    doi,
    sourceFormat: 'ris' as const,
  });
  importReferences('p1', [rec('10.1/x')]);
  importReferences('p1', [rec('10.1/x')]);

  const before = allRefs();
  assert.equal(before.length, 2);
  const first = before[0]!;
  const second = before[1]!;

  // 给最早导入的主条目一条人工判定，验证合并不会碰它
  const now = new Date().toISOString();
  db.insert(screenDecisions)
    .values({
      id: randomUUID(),
      referenceId: first.id,
      stage: 'title_abstract',
      decision: 'include',
      aiSuggestion: null,
      aiReason: null,
      reasons: '[]',
      note: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const r1 = mergeDuplicates('p1');
  assert.equal(r1.groups, 1);
  assert.equal(r1.duplicates, 1);

  const merged = allRefs();
  assert.equal(merged[0]!.isDuplicate, 0);
  assert.equal(merged[1]!.isDuplicate, 1);
  assert.equal(merged[0]!.dedupGroupId, merged[1]!.dedupGroupId);

  // 判定保留
  const dec = db.select().from(screenDecisions).where(eq(screenDecisions.referenceId, first.id)).get()!;
  assert.equal(dec.decision, 'include');

  // 幂等
  const r2 = mergeDuplicates('p1');
  assert.deepEqual(r1, r2);

  // 删除主条目后补位：次早成为主条目，但保留自身状态
  db.delete(references).where(eq(references.id, first.id)).run();
  mergeDuplicates('p1');
  const promoted = db.select().from(references).where(eq(references.id, second.id)).get()!;
  assert.equal(promoted.isDuplicate, 0);
  assert.equal(promoted.status, 'imported');
});

test('同名文献需第一作者与期刊一致才合并', () => {
  const rec = (authors: string[], journal?: string) => ({
    title: 'Composting and ammonia',
    authors,
    abstract: '',
    journal,
    sourceFormat: 'ris' as const,
  });
  importReferences('p2', [rec(['Smith J'], 'Nature')]);
  importReferences('p2', [rec(['Smith J'], 'Nature')]);
  importReferences('p2', [rec(['Doe A'], 'Nature')]);
  importReferences('p2', [rec(['Smith J'], 'Science')]);

  const r = mergeDuplicates('p2');
  assert.equal(r.groups, 3);
  assert.equal(r.duplicates, 1);
});
