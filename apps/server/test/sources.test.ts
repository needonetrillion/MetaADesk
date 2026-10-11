import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-sources-test-'));
process.env.META_DATA_DIR = tmpDir;

const { addSource, listProjectSources, selectStrategyTargets } = await import('../src/services/sources.ts');
const { db } = await import('../src/db/client.ts');
const { searchStrategies } = await import('../src/db/schema.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('来源库按项目隔离', () => {
  const a = addSource('pa', { presetKey: 'pubmed', name: 'PubMed' });
  assert.equal(a.projectId, 'pa');

  const pa = listProjectSources('pa');
  assert.equal(pa.length, 1);
  assert.equal(pa[0]!.presetKey, 'pubmed');
  assert.equal(listProjectSources('pb').length, 0);
});

test('selectStrategyTargets 只返回还没有检索式的来源库', () => {
  const withStrategy = addSource('p2', { presetKey: 'pubmed', name: 'PubMed' });
  const withoutStrategy = addSource('p2', { presetKey: 'wos', name: 'WoS' });
  const now = new Date().toISOString();
  db.insert(searchStrategies)
    .values({
      id: randomUUID(),
      projectId: 'p2',
      databaseId: withStrategy.id,
      query: 'q',
      notes: null,
      generatedBy: 'manual',
      createdAt: now,
    })
    .run();

  const targets = selectStrategyTargets('p2');
  assert.deepEqual(targets.map((t) => t.id), [withoutStrategy.id]);
});
