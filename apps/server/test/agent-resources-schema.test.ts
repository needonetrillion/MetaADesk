import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ares-test-'));
process.env.META_DATA_DIR = tmpDir;

const { db } = await import('../src/db/client.ts');
const schema = await import('../src/db/schema.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('技能/知识三张表可创建并可读写', () => {
  const now = new Date().toISOString();
  db.insert(schema.agentSkills)
    .values({ id: 's1', name: 'n', description: 'd', content: 'c', createdAt: now, updatedAt: now })
    .run();
  db.insert(schema.agentKnowledge)
    .values({ id: 'k1', name: 'n', description: 'd', format: 'md', sourcePath: null, createdAt: now })
    .run();
  db.insert(schema.agentKnowledgeChunks)
    .values({ id: 'c1', knowledgeId: 'k1', chunkIndex: 0, text: 't' })
    .run();
  assert.equal(db.select().from(schema.agentSkills).all().length, 1);
  assert.equal(db.select().from(schema.agentKnowledge).all().length, 1);
  assert.equal(db.select().from(schema.agentKnowledgeChunks).all().length, 1);
});
