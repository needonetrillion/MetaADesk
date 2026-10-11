import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-rename-test-'));
process.env.META_DATA_DIR = tmpDir;
process.env.PORT = '8798';

const { buildApp } = await import('../src/index.ts');
const { db } = await import('../src/db/client.ts');
const schema = await import('../src/db/schema.ts');
const app = await buildApp();
await app.listen({ port: 8798, host: '127.0.0.1' });
const base = 'http://127.0.0.1:8798';

after(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function call<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
}

let projectId = '';
let folderName = '';

test('创建项目：文件夹名 = 项目名-短ID，非法字符被清洗', async () => {
  const { status, data } = await call<{ id: string; name: string; folderName: string }>(
    'POST',
    '/api/projects',
    { name: '沸石/堆肥:研究' },
  );
  assert.equal(status, 200);
  projectId = data.id;
  folderName = data.folderName;
  assert.ok(folderName.startsWith('沸石_堆肥_研究-'), `folderName=${folderName}`);
  assert.ok(fs.existsSync(path.join(tmpDir, 'projects', folderName, 'project.json')));
});

test('重命名项目：name 与 folderName 同步、磁盘目录改名、短ID不变', async () => {
  const oldFolder = folderName;
  const { status, data } = await call<{ name: string; folderName: string }>(
    'PATCH',
    `/api/projects/${projectId}`,
    { name: '新名字ABC' },
  );
  assert.equal(status, 200);
  assert.equal(data.name, '新名字ABC');
  assert.ok(data.folderName.startsWith('新名字ABC-'), `folderName=${data.folderName}`);
  assert.equal(data.folderName.split('-').pop(), oldFolder.split('-').pop());

  assert.ok(fs.existsSync(path.join(tmpDir, 'projects', data.folderName, 'project.json')));
  assert.ok(!fs.existsSync(path.join(tmpDir, 'projects', oldFolder)));

  const row = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  assert.equal(row!.name, '新名字ABC');
  assert.equal(row!.folderName, data.folderName);
  folderName = data.folderName;
});
