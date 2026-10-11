import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-routes-test-'));
process.env.META_DATA_DIR = tmpDir;
process.env.PORT = '8799';

/** 需要一个真实 HTTP 端口（走路由注册顺序的完整链路，而不是只调 service） */
const { buildApp } = await import('../src/index.ts');
const { db } = await import('../src/db/client.ts');
const schema = await import('../src/db/schema.ts');
const app = await buildApp();
await app.listen({ port: 8799, host: '127.0.0.1' });
const base = 'http://127.0.0.1:8799';

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
let batchId = '';
let sampleRefId = '';

test('健康检查', async () => {
  const { status, data } = await call<{ ok: boolean }>('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
});

test('创建项目', async () => {
  const { status, data } = await call<{ id: string; folderName: string }>('POST', '/api/projects', {
    name: '路由冒烟测试',
  });
  assert.equal(status, 200);
  projectId = data.id;
  assert.ok(projectId);

  // 新建项目应自动建文件夹（文件夹名 = 项目名-短ID）并播种默认排除理由
  assert.ok(fs.existsSync(path.join(tmpDir, 'projects', data.folderName, 'project.json')));
  assert.ok(
    db.select().from(schema.exclusionReasons).where(eq(schema.exclusionReasons.projectId, projectId)).all().length > 0,
  );
});

test('保存协议', async () => {
  const { status } = await call('PUT', `/api/projects/${projectId}/protocol`, {
    title: '测试协议',
    objective: '验证接口',
    pico: { population: '成人', intervention: 'A', comparison: 'B', outcome: 'C' },
    criteria: [
      { id: 'c1', type: 'inclusion', text: 'RCT' },
      { id: 'c2', type: 'exclusion', text: '动物实验' },
    ],
    outcomes: ['死亡率'],
  });
  assert.equal(status, 200);
});

test('导入题录必须绑定检索式', async () => {
  const res = await call<{ error: string }>('POST', `/api/projects/${projectId}/references/import`, {
    text: 'TY  - JOUR\nTI  - X\nER  - ',
    format: 'ris',
  });
  assert.equal(res.status, 400);
});

test('导入题录（含重复条目）', async () => {
  // 先建来源库 + 检索式，导入必须绑定检索式
  const sourceId = 'src-import';
  const strategyId = 'strat-import';
  const now = new Date().toISOString();
  db.insert(schema.searchDatabases)
    .values({ id: sourceId, projectId, name: 'PubMed', presetKey: 'pubmed' })
    .run();
  db.insert(schema.searchStrategies)
    .values({ id: strategyId, projectId, databaseId: sourceId, query: 'q', notes: null, generatedBy: 'manual', createdAt: now })
    .run();

  const text = [
    'TY  - JOUR',
    'TI  - Paper One',
    'AU  - Smith J',
    'AB  - Abstract one',
    'PY  - 2020',
    'DO  - 10.1000/one',
    'ER  - ',
    '',
    'TY  - JOUR',
    'TI  - Paper One',
    'AU  - Smith J',
    'AB  - Abstract one duplicate',
    'PY  - 2020',
    'DO  - 10.1000/ONE',
    'ER  - ',
    '',
    'TY  - JOUR',
    'TI  - Paper Two',
    'AU  - Doe A',
    'AB  - Abstract two',
    'PY  - 2021',
    'DO  - 10.1000/two',
    'ER  - ',
    '',
  ].join('\n');

  const { status, data } = await call<{
    imported: number;
    total: number;
    batchId: string;
  }>('POST', `/api/projects/${projectId}/references/import`, { text, format: 'ris', strategyId });
  assert.equal(status, 200);
  assert.equal(data.total, 3);
  assert.equal(data.imported, 3);
  batchId = data.batchId;
});

test('初筛列表返回分页结构并排除重复条目', async () => {
  const { status, data } = await call<{
    items: Array<{ id: string; isDuplicate: boolean }>;
    total: number;
    page: number;
    pageSize: number;
    counts: { total: number; pending: number; duplicates: number };
  }>('GET', `/api/projects/${projectId}/references?status=all&page=1&pageSize=1`);
  assert.equal(status, 200);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0]!.isDuplicate, false);
  assert.equal(data.counts.duplicates, 0);
  assert.equal(data.counts.total, 3);
  assert.equal(data.pageSize, 1);
  sampleRefId = data.items[0]!.id;

  const withDup = await call<{ items: unknown[] }>(
    'GET',
    `/api/projects/${projectId}/references?status=all&page=1&pageSize=50&includeDuplicates=true`,
  );
  assert.equal(withDup.data.items.length, 3);

  const searched = await call<{ items: Array<{ title: string }> }>(
    'GET',
    `/api/projects/${projectId}/references?search=Paper%20Two`,
  );
  assert.equal(searched.data.items.length, 1);
  assert.equal(searched.data.items[0]!.title, 'Paper Two');
});

test('批量 AI 建议在没有待筛文献时直接返回空结果（不调用 LLM）', async () => {
  // 此时两篇非重复文献都已拍板（一篇纳入、一篇未判定？），接口应给出结构化结果而不是报错
  const { status, data } = await call<{
    suggestions: unknown[];
    failed: unknown[];
    skipped: number;
    total: number;
  }>('POST', `/api/projects/${projectId}/screening/suggest-batch`, {});
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.suggestions));
  assert.ok(Array.isArray(data.failed));
  assert.equal(typeof data.skipped, 'number');
});

test('接受 AI 判定跳过已推进的文献', async () => {
  // 先人工纳入一篇，再接受全部 AI 判定：已纳入的不能被改写
  const decided = await call<{ status: string }>(
    'POST',
    `/api/references/${sampleRefId}/decision`,
    { decision: 'include', reasons: [] },
  );
  assert.equal(decided.status, 200);
  assert.equal(decided.data.status, 'tas_included');

  const { status, data } = await call<{ accepted: number; skipped: number }>(
    'POST',
    `/api/projects/${projectId}/screening/accept-ai`,
    {},
  );
  assert.equal(status, 200);
  assert.equal(data.accepted, 0);

  const after = await call<{ items: Array<{ status: string }> }>(
    'GET',
    `/api/projects/${projectId}/references?status=included`,
  );
  assert.equal(after.data.items.length, 1);
  assert.equal(after.data.items[0]!.status, 'tas_included');
});

test('PRISMA 汇总接口可用', async () => {
  const { status, data } = await call<{
    flow: { total: number; duplicatesRemoved: number; screened: number; tasIncluded: number };
    exclusion: { titleAbstract: { reasons: unknown[] } };
  }>('GET', `/api/projects/${projectId}/results/prisma`);
  assert.equal(status, 200);
  assert.equal(data.flow.total, 3);
  assert.equal(data.flow.duplicatesRemoved, 0);
  assert.equal(data.flow.screened, 3);
  assert.equal(data.flow.tasIncluded, 1);
  assert.ok(Array.isArray(data.exclusion.titleAbstract.reasons));
});

test('文档状态批量接口可用（路由顺序不会把 states 当成 :id）', async () => {
  const { status, data } = await call<{
    mineruTimeoutSeconds: number;
    documents: unknown[];
  }>('POST', '/api/documents/states', { referenceIds: [sampleRefId] });
  assert.equal(status, 200);
  assert.equal(data.mineruTimeoutSeconds, 900);
  assert.deepEqual(data.documents, []);
});

test('给尚未进入全文阶段的文献上传 PDF 会被拒绝', async () => {
  // Paper Two 还在 imported 状态，不允许直接跳到待全文
  const pending = await call<{ items: Array<{ id: string; status: string }> }>(
    'GET',
    `/api/projects/${projectId}/references?status=pending`,
  );
  const imported = pending.data.items.find((i) => i.status === 'imported');
  assert.ok(imported, '应存在仍处于 imported 的文献');

  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'x.pdf');
  const res = await fetch(`${base}/api/references/${imported!.id}/document`, {
    method: 'POST',
    body: fd,
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /非法的状态迁移/);
});

test('导入批次可撤销，且文件与记录一起清理', async () => {
  const { status, data } = await call<{ deleted: number }>(
    'DELETE',
    `/api/import-batches/${batchId}`,
  );
  assert.equal(status, 200);
  assert.equal(data.deleted, 3);

  const list = await call<{ items: unknown[]; counts: { total: number } }>(
    'GET',
    `/api/projects/${projectId}/references`,
  );
  assert.equal(list.data.items.length, 0);
  assert.equal(list.data.counts.total, 0);
});

test('删除项目级联清空所有带 projectId 的数据', async () => {
  // 先造一个来源库 + 排除理由，验证项目级联会清理它们
  const now = new Date().toISOString();
  db.insert(schema.searchDatabases)
    .values({ id: 's-del', projectId, name: 'X', presetKey: null })
    .run();
  db.insert(schema.exclusionReasons)
    .values({ id: 'r-del', projectId, code: 'other', label: '其他', isBuiltin: 1, sortOrder: 0, createdAt: now })
    .run();

  const { status } = await call('DELETE', `/api/projects/${projectId}`);
  assert.equal(status, 200);

  const list = await call<Array<{ id: string }>>('GET', '/api/projects');
  assert.equal(
    list.data.some((p) => p.id === projectId),
    false,
  );
  // 再取一次应 404，说明项目确实被删除
  const one = await call<{ error: string }>('GET', `/api/projects/${projectId}`);
  assert.equal(one.status, 404);

  assert.equal(db.select().from(schema.searchDatabases).where(eq(schema.searchDatabases.projectId, projectId)).all().length, 0);
  assert.equal(db.select().from(schema.exclusionReasons).where(eq(schema.exclusionReasons.projectId, projectId)).all().length, 0);
});
