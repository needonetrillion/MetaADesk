import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-kroute-test-'));
process.env.META_DATA_DIR = tmpDir;
process.env.PORT = '8797';

const { buildApp } = await import('../src/index.ts');
const { extractTextFromBuffer } = await import('../src/routes/agent-knowledge.ts');
const app = await buildApp();
await app.listen({ port: 8797, host: '127.0.0.1' });
const base = 'http://127.0.0.1:8797';

after(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractTextFromBuffer 对 md/txt 返回解码文本', async () => {
  const text = await extractTextFromBuffer(Buffer.from('# 标题\n正文'), 'guide.md');
  assert.match(text, /正文/);
});

test('知识上传(multipart)→列表→删除', async () => {
  const md = '# 指南\n\n' + '内容段落。'.repeat(400);
  const fd = new FormData();
  fd.append('file', new Blob([md], { type: 'text/markdown' }), 'guide.md');
  fd.append('name', '筛查指南');
  fd.append('description', '用于测试的知识文档');

  const up = await fetch(`${base}/api/agent/knowledge`, { method: 'POST', body: fd });
  assert.equal(up.status, 200);
  const created = (await up.json()) as { id: string; chunkCount: number };
  assert.ok(created.id);
  assert.ok(created.chunkCount >= 2, `chunkCount=${created.chunkCount}`);

  const list = (await (await fetch(`${base}/api/agent/knowledge`)).json()) as Array<{ id: string }>;
  assert.ok(list.some((x) => x.id === created.id));

  const del = await fetch(`${base}/api/agent/knowledge/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);

  const after = (await (await fetch(`${base}/api/agent/knowledge`)).json()) as Array<{ id: string }>;
  assert.ok(!after.some((x) => x.id === created.id));
});
