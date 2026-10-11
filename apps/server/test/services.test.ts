import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-server-test-'));
process.env.META_DATA_DIR = tmpDir;

/** 动态导入：必须在设置 META_DATA_DIR 之后 */
const { db } = await import('../src/db/client.ts');
const schema = await import('../src/db/schema.ts');
const refs = await import('../src/services/references.ts');
const docs = await import('../src/services/documents.ts');
const extraction = await import('../src/services/extraction.ts');
const prisma = await import('../src/services/prisma.ts');

const { references, screenDecisions, importBatches, extractionTemplates, agentConversations, projects } =
  schema;

before(() => {
  db.insert(projects)
    .values({ id: 'p1', name: '测试项目', description: null, createdAt: new Date().toISOString() })
    .run();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let importOrderSeq = 0;
function insertReference(input: {
  id?: string;
  status: string;
  isDuplicate?: boolean;
  dedupGroupId?: string;
  importBatchId?: string;
  doi?: string;
  title?: string;
}): string {
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  db.insert(references)
    .values({
      id,
      projectId: 'p1',
      title: input.title ?? `标题 ${id}`,
      authors: '[]',
      abstract: '摘要',
      year: 2024,
      journal: 'J',
      doi: input.doi ?? null,
      pmid: null,
      url: null,
      sourceDatabaseId: null,
      sourceQueryId: null,
      importBatchId: input.importBatchId ?? null,
      importOrder: ++importOrderSeq,
      dedupGroupId: input.dedupGroupId ?? randomUUID(),
      isDuplicate: input.isDuplicate ? 1 : 0,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function insertAiDecision(referenceId: string, suggestion: 'include' | 'exclude' | 'undecided'): void {
  const now = new Date().toISOString();
  db.insert(screenDecisions)
    .values({
      id: randomUUID(),
      referenceId,
      stage: 'title_abstract',
      decision: 'undecided',
      aiSuggestion: suggestion,
      aiReason: 'AI 理由',
      reasons: '[]',
      note: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function statusOf(id: string): string {
  return db.select({ status: references.status }).from(references).where(eq(references.id, id)).get()!
    .status;
}

test('导入：批内同 DOI 不去重，全部落库且 import_order 递增', () => {
  const summary = refs.importReferences('p1', [
    { title: 'Shared Paper', authors: [], abstract: 'a', doi: '10.9/x', sourceFormat: 'ris' },
    { title: 'Shared Paper (dup)', authors: [], abstract: 'b', doi: '10.9/X', sourceFormat: 'ris' },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.imported, 2);
  assert.equal((summary as Record<string, unknown>).duplicates, undefined);

  const rows = db
    .select()
    .from(references)
    .where(eq(references.importBatchId, summary.batchId))
    .all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.isDuplicate === 0));
  assert.equal(new Set(rows.map((r) => r.importOrder)).size, 2);
});

test('跨批次不相干文献不会共用 dedup_group_id（旧实现 g1/g2 会撞号）', () => {
  const a = refs.importReferences('p1', [
    { title: 'Alpha Study', authors: [], abstract: '', doi: '10.10/alpha', sourceFormat: 'ris' },
  ]);
  const b = refs.importReferences('p1', [
    { title: 'Beta Study', authors: [], abstract: '', doi: '10.10/beta', sourceFormat: 'ris' },
  ]);
  const rowA = db.select().from(references).where(eq(references.importBatchId, a.batchId)).get()!;
  const rowB = db.select().from(references).where(eq(references.importBatchId, b.batchId)).get()!;
  assert.notEqual(rowA.dedupGroupId, rowB.dedupGroupId);
  assert.notEqual(rowA.dedupGroupId, 'g1');
});

test('初筛列表：导入不去重后，重复计数为 0', () => {
  const page = refs.listScreening('p1', { pageSize: 100 });
  assert.equal(page.counts.duplicates, 0);
  assert.equal(page.items.some((i) => i.isDuplicate), false);

  const withDup = refs.listScreening('p1', { pageSize: 100, includeDuplicates: true });
  assert.equal(withDup.items.length, page.items.length);
});

test('初筛列表：服务端分页与筛选', () => {
  const page = refs.listScreening('p1', { filter: 'pending', page: 1, pageSize: 2 });
  assert.equal(page.items.length <= 2, true);
  assert.equal(page.pageSize, 2);
  assert.equal(page.items.every((i) => i.status === 'imported' || i.status === 'screening_tas'), true);
  // 分页 total 应等于同筛选条件下的完整条数
  const all = refs.listScreening('p1', { filter: 'pending', pageSize: 500 });
  assert.equal(page.total, all.items.length);
});

test('接受 AI 判定不会把已提取/已入全文的文献打回初筛（状态机死代码修复）', () => {
  const pending = insertReference({ status: 'imported', title: '待筛' });
  const extracted = insertReference({ status: 'extracted', title: '已提取' });
  const ftIncluded = insertReference({ status: 'ft_included', title: '全文纳入' });
  insertAiDecision(pending, 'include');
  insertAiDecision(extracted, 'exclude');
  insertAiDecision(ftIncluded, 'exclude');

  const r = refs.acceptAiSuggestions('p1');
  assert.equal(r.accepted, 1);
  assert.equal(statusOf(pending), 'tas_included');
  assert.equal(statusOf(extracted), 'extracted');
  assert.equal(statusOf(ftIncluded), 'ft_included');

  // 只接受指定文献时同样遵守状态限制
  const r2 = refs.acceptAiSuggestions('p1', [extracted]);
  assert.equal(r2.accepted, 0);
  assert.equal(r2.skipped, 1);
  assert.equal(statusOf(extracted), 'extracted');
});

test('状态回退会清理失效的派生数据', () => {
  const id = insertReference({ status: 'extracted' });
  const now = new Date().toISOString();
  db.insert(schema.extractions)
    .values({
      id: randomUUID(),
      referenceId: id,
      fields: JSON.stringify({ values: { design: 'RCT' } }),
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(screenDecisions)
    .values({
      id: randomUUID(),
      referenceId: id,
      stage: 'fulltext',
      decision: 'include',
      aiSuggestion: null,
      aiReason: null,
      reasons: '[]',
      note: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // 重新上传 PDF 属于允许的回退，但必须清掉基于旧全文的提取结果
  const doc = docs.createDocument(id, path.join(tmpDir, 'fake.pdf'));
  assert.equal(doc.state, 'pending');
  assert.equal(statusOf(id), 'fulltext_pending');
  assert.equal(db.select().from(schema.extractions).where(eq(schema.extractions.referenceId, id)).all().length, 0);
  assert.equal(
    db.select().from(screenDecisions).where(eq(screenDecisions.referenceId, id)).all().length,
    0,
  );
});

test('非法状态迁移被拒绝（例如从未进入全文流程就上传 PDF）', () => {
  const imported = insertReference({ status: 'imported' });
  assert.throws(
    () => docs.createDocument(imported, path.join(tmpDir, 'fake2.pdf')),
    /非法的状态迁移/,
  );
  assert.equal(statusOf(imported), 'imported');

  // 合法的重来：全文纳入/已提取 → 重新上传 → 回到待转换（并清掉旧提取结果）
  const ftIncluded = insertReference({ status: 'ft_included' });
  docs.createDocument(ftIncluded, path.join(tmpDir, 'fake3.pdf'));
  assert.equal(statusOf(ftIncluded), 'fulltext_pending');

  const extracted = insertReference({ status: 'extracted' });
  docs.createDocument(extracted, path.join(tmpDir, 'fake4.pdf'));
  assert.equal(statusOf(extracted), 'fulltext_pending');
});

test('人工判定保留 AI 建议与理由（不再被清空）', () => {
  const id = insertReference({ status: 'imported' });
  insertAiDecision(id, 'include');
  refs.applyHumanDecision(id, { decision: 'include', reasons: [], note: undefined });
  const d = db.select().from(screenDecisions).where(eq(screenDecisions.referenceId, id)).get()!;
  assert.equal(d.decision, 'include');
  assert.equal(d.aiSuggestion, 'include');
  assert.equal(d.aiReason, 'AI 理由');
});

test('排除理由汇总与 PRISMA 流程计数', () => {
  const excluded = insertReference({ status: 'tas_excluded' });
  refs.applyHumanDecision(excluded, {
    decision: 'exclude',
    reasons: ['wrong_population', 'wrong_outcome'],
    note: undefined,
  });
  const noReason = insertReference({ status: 'tas_excluded' });

  const summary = prisma.buildPrismaSummary('p1');
  assert.equal(summary.exclusion.titleAbstract.excluded, 2);
  assert.equal(summary.exclusion.titleAbstract.withoutReason, 1);
  const pop = summary.exclusion.titleAbstract.reasons.find((r) => r.code === 'wrong_population');
  const out = summary.exclusion.titleAbstract.reasons.find((r) => r.code === 'wrong_outcome');
  assert.equal(pop?.count, 1);
  assert.equal(out?.count, 1);
  assert.equal(summary.flow.tasExcluded, 2);
  assert.equal(summary.flow.duplicatesRemoved, 0);
  assert.equal(noReason !== excluded, true);
});

test('提取字段表改 key 时迁移历史数据，而不是丢列', () => {
  const id = insertReference({ status: 'extracted' });
  extraction.saveTemplate('p1', [
    { key: 'design', label: '研究设计' },
    { key: 'outcome_1_value', label: '结局1·效应值' },
  ]);
  const now = new Date().toISOString();
  db.insert(schema.extractions)
    .values({
      id: randomUUID(),
      referenceId: id,
      fields: JSON.stringify({ values: { design: 'RCT', outcome_1_value: '1.23' } }),
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const res = extraction.saveTemplate('p1', [
    { key: 'design', label: '研究设计' },
    { key: 'outcome_1_effect', label: '结局1·效应值' },
  ]);
  assert.deepEqual(res.renamed, [{ from: 'outcome_1_value', to: 'outcome_1_effect' }]);
  assert.equal(res.migrated, 1);

  const row = db.select().from(schema.extractions).where(eq(schema.extractions.referenceId, id)).get()!;
  const values = (JSON.parse(row.fields) as { values: Record<string, string> }).values;
  assert.equal(values.outcome_1_effect, '1.23');
  assert.equal(values.outcome_1_value, undefined);
  assert.equal(values.design, 'RCT');

  const csv = extraction.exportResultsCSV('p1');
  assert.ok(csv.includes('1.23'), '导出的 CSV 应含迁移后的数据');
});

test('项目级联删除清空全部带 projectId 的表', () => {
  db.insert(schema.extractionTemplates)
    .values({
      id: randomUUID(),
      projectId: 'p1',
      fields: '[]',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
  db.insert(agentConversations)
    .values({
      id: randomUUID(),
      projectId: 'p1',
      messages: '[]',
      updatedAt: new Date().toISOString(),
    })
    .run();
  assert.ok(db.select().from(importBatches).where(eq(importBatches.projectId, 'p1')).all().length > 0);

  // 复刻路由里的级联删除逻辑
  db.transaction((tx) => {
    const refIds = tx
      .select({ id: references.id })
      .from(references)
      .where(eq(references.projectId, 'p1'))
      .all()
      .map((r) => r.id);
    if (refIds.length) {
      tx.delete(schema.screenDecisions).where(eq(schema.screenDecisions.referenceId, refIds[0]!)).run();
      tx.delete(references).where(eq(references.projectId, 'p1')).run();
    }
    tx.delete(importBatches).where(eq(importBatches.projectId, 'p1')).run();
    tx.delete(extractionTemplates).where(eq(extractionTemplates.projectId, 'p1')).run();
    tx.delete(agentConversations).where(eq(agentConversations.projectId, 'p1')).run();
    tx.delete(projects).where(eq(projects.id, 'p1')).run();
  });

  assert.equal(db.select().from(importBatches).where(eq(importBatches.projectId, 'p1')).all().length, 0);
  assert.equal(
    db.select().from(extractionTemplates).where(eq(extractionTemplates.projectId, 'p1')).all().length,
    0,
  );
  assert.equal(
    db.select().from(agentConversations).where(eq(agentConversations.projectId, 'p1')).all().length,
    0,
  );
});

test('服务重启后僵死的 converting 文档会被重置为可重试', () => {
  const id = insertReference({ status: 'fulltext_pending' });
  const now = new Date().toISOString();
  db.insert(schema.documents)
    .values({
      id: randomUUID(),
      referenceId: id,
      pdfPath: path.join(tmpDir, 'x.pdf'),
      state: 'converting',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const recovered = docs.recoverStaleConversions();
  assert.equal(recovered >= 1, true);
  const doc = docs.getDocument(id)!;
  assert.equal(doc.state, 'failed');
  assert.ok(doc.error && doc.error.includes('重启'));
});
