import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-know-test-'));
process.env.META_DATA_DIR = tmpDir;

const knowledge = await import('../src/services/agentKnowledge.ts');
const { db } = await import('../src/db/client.ts');
const schema = await import('../src/db/schema.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('chunkText 切块且块间有重叠', () => {
  const chunks = knowledge.chunkText('a'.repeat(2000), 600, 100);
  assert.ok(chunks.length >= 3, `chunks=${chunks.length}`);
  for (const c of chunks) assert.ok(c.length <= 600, `len=${c.length}`);
  // 相邻块有重叠：第一块的结尾 100 字 = 第二块的开头 100 字
  assert.equal(chunks[0]!.slice(-100), chunks[1]!.slice(0, 100));
});

test('retrieveChunks 按相关度取 Top-K', () => {
  const chunks = [
    { id: 'a', knowledgeId: 'k', chunkIndex: 0, text: 'zeolite zeolite zeolite' },
    { id: 'b', knowledgeId: 'k', chunkIndex: 1, text: 'no match here' },
    { id: 'c', knowledgeId: 'k', chunkIndex: 2, text: 'zeolite' },
  ];
  const r = knowledge.retrieveChunks('zeolite', chunks, 2);
  assert.deepEqual(r.map((x) => x.id), ['a', 'c']);
});

test('retrieveChunks 支持中文整句关键词检索', () => {
  const chunks = [
    { id: 'a', knowledgeId: 'k', chunkIndex: 0, text: '沸石可以减少堆肥过程中的氨挥发。' },
    { id: 'b', knowledgeId: 'k', chunkIndex: 1, text: '完全不相关的内容。' },
  ];
  const r = knowledge.retrieveChunks('堆肥时怎么减少氨挥发', chunks, 2);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.id, 'a');
});

test('addKnowledge 切块入库，list/delete 及块清理正确', () => {
  const k = knowledge.addKnowledge({
    name: '指南',
    description: 'desc',
    text: 'word '.repeat(400),
    format: 'md',
  });
  const list = knowledge.listKnowledge();
  assert.equal(list.length, 1);
  assert.ok(list[0]!.chunkCount >= 2, `chunkCount=${list[0]!.chunkCount}`);
  assert.equal(knowledge.getChunksByKnowledgeIds([k.id]).length, list[0]!.chunkCount);

  knowledge.deleteKnowledge(k.id);
  assert.equal(knowledge.listKnowledge().length, 0);
  assert.equal(db.select().from(schema.agentKnowledgeChunks).all().length, 0);
});
