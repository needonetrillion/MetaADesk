import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Decision, ReferenceStatus } from '@meta/core';
import { isScreeningOpen } from '@meta/core';
import type { ParsedRecord } from '@meta/importer';
import { db, inTransaction, type DbLike } from '../db/client';
import {
  documents,
  extractions,
  figures,
  importBatches,
  pairedEntries,
  rawExtractions,
  references,
  screenDecisions,
  searchDatabases,
  treatmentClassifications,
} from '../db/schema';
import { removeReferenceDir } from './files';
import {
  suggestFulltextExcerpt,
  suggestReference,
  suggestReferencesBatch,
  type ScreeningSuggestion,
} from './ai';
import { getProtocol } from './protocol';
import { getAiSettings } from './aiSettings';
import { setReferenceStatus, setReferenceStatusTx } from './transitions';

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function getReference(id: string) {
  return db.select().from(references).where(eq(references.id, id)).get();
}

export interface ReferenceDetail {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  journal?: string;
  year?: number;
  doi?: string;
  pmid?: string;
  url?: string;
  sourceName?: string;
}

/** 单条文献完整题录（含来源库名） */
export function getReferenceDetail(id: string): ReferenceDetail | null {
  const row = getReference(id);
  if (!row) return null;
  let sourceName: string | undefined;
  if (row.sourceDatabaseId) {
    sourceName =
      db
        .select({ name: searchDatabases.name })
        .from(searchDatabases)
        .where(eq(searchDatabases.id, row.sourceDatabaseId))
        .get()?.name ?? undefined;
  }
  return {
    id: row.id,
    title: row.title,
    authors: safeParse<string[]>(row.authors, []),
    abstract: row.abstract,
    journal: row.journal ?? undefined,
    year: row.year ?? undefined,
    doi: row.doi ?? undefined,
    pmid: row.pmid ?? undefined,
    url: row.url ?? undefined,
    sourceName,
  };
}

export interface ImportSummary {
  imported: number;
  total: number;
  batchId: string;
}

export interface ImportOptions {
  strategyId?: string;
  databaseId?: string;
  format?: string;
}

/**
 * 导入题录：只落库、标来源与 import_order，不做任何去重。
 * 整个过程在一个事务里完成，中途异常不会留下半截批次。
 */
export function importReferences(
  projectId: string,
  parsed: ParsedRecord[],
  options: ImportOptions = {},
): ImportSummary {
  const now = new Date().toISOString();
  const batchId = randomUUID();
  const imported = parsed.length;

  inTransaction((tx) => {
    const maxRow = tx
      .select({ m: sql<number>`coalesce(max(${references.importOrder}), 0)` })
      .from(references)
      .get();
    let nextOrder = (Number(maxRow?.m ?? 0)) + 1;

    for (const p of parsed) {
      tx.insert(references)
        .values({
          id: randomUUID(),
          projectId,
          title: p.title || '（无标题）',
          authors: JSON.stringify(p.authors),
          abstract: p.abstract,
          year: p.year ?? null,
          journal: p.journal ?? null,
          doi: p.doi ?? null,
          pmid: p.pmid ?? null,
          url: p.url ?? null,
          sourceDatabaseId: options.databaseId ?? null,
          sourceQueryId: options.strategyId ?? null,
          importBatchId: batchId,
          importOrder: nextOrder++,
          dedupGroupId: randomUUID(),
          isDuplicate: 0,
          status: 'imported',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    tx.insert(importBatches)
      .values({
        id: batchId,
        projectId,
        strategyId: options.strategyId ?? null,
        databaseId: options.databaseId ?? null,
        format: options.format ?? null,
        importedCount: imported,
        duplicateCount: 0,
        totalCount: imported,
        createdAt: now,
      })
      .run();
  });

  return { imported, total: imported, batchId };
}

export interface ImportBatch {
  id: string;
  projectId: string;
  strategyId?: string;
  databaseId?: string;
  databaseName?: string;
  format?: string;
  importedCount: number;
  duplicateCount: number;
  totalCount: number;
  createdAt: string;
}

/** 导入批次列表（含数据库名） */
export function listImportBatches(projectId: string): ImportBatch[] {
  const rows = db
    .select()
    .from(importBatches)
    .where(eq(importBatches.projectId, projectId))
    .orderBy(desc(importBatches.createdAt))
    .all();
  const dbs = db.select().from(searchDatabases).all();
  const nameById = new Map(dbs.map((d) => [d.id, d.name]));
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    strategyId: r.strategyId ?? undefined,
    databaseId: r.databaseId ?? undefined,
    databaseName: r.databaseId ? (nameById.get(r.databaseId) ?? undefined) : undefined,
    format: r.format ?? undefined,
    importedCount: r.importedCount,
    duplicateCount: r.duplicateCount,
    totalCount: r.totalCount,
    createdAt: r.createdAt,
  }));
}

/** 清理某批文献关联的本地文件（删除记录之前调用） */
function removeReferenceFiles(refIds: string[]): void {
  if (refIds.length === 0) return;
  const docs = db
    .select({ pdfPath: documents.pdfPath, markdownPath: documents.markdownPath })
    .from(documents)
    .where(inArray(documents.referenceId, refIds))
    .all();
  for (const d of docs) {
    if (d.pdfPath) fs.rmSync(d.pdfPath, { force: true });
    if (d.markdownPath) fs.rmSync(d.markdownPath, { force: true });
  }
}

/** 删除一批文献（含其判定/文档/图表/提取及文件），单事务内完成 */
function deleteReferences(ids: string[]): void {
  if (ids.length === 0) return;
  const refs = db
    .select({ id: references.id, projectId: references.projectId })
    .from(references)
    .where(inArray(references.id, ids))
    .all();
  for (const r of refs) removeReferenceDir(r.projectId, r.id);
  removeReferenceFiles(ids);
  inTransaction((tx) => {
    tx.delete(rawExtractions).where(inArray(rawExtractions.referenceId, ids)).run();
    tx.delete(treatmentClassifications).where(inArray(treatmentClassifications.referenceId, ids)).run();
    tx.delete(pairedEntries).where(inArray(pairedEntries.referenceId, ids)).run();
    tx.delete(documents).where(inArray(documents.referenceId, ids)).run();
    tx.delete(screenDecisions).where(inArray(screenDecisions.referenceId, ids)).run();
    tx.delete(figures).where(inArray(figures.referenceId, ids)).run();
    tx.delete(extractions).where(inArray(extractions.referenceId, ids)).run();
    tx.delete(references).where(inArray(references.id, ids)).run();
  });
}

/** 撤销一个导入批次（删除该批次新增的文献） */
export function deleteImportBatch(batchId: string): { deleted: number } {
  const refs = db
    .select({ id: references.id })
    .from(references)
    .where(eq(references.importBatchId, batchId))
    .all();
  const ids = refs.map((r) => r.id);
  removeReferenceFiles(ids);
  inTransaction((tx) => {
    if (ids.length) {
      tx.delete(documents).where(inArray(documents.referenceId, ids)).run();
      tx.delete(screenDecisions).where(inArray(screenDecisions.referenceId, ids)).run();
      tx.delete(figures).where(inArray(figures.referenceId, ids)).run();
      tx.delete(extractions).where(inArray(extractions.referenceId, ids)).run();
      tx.delete(references).where(inArray(references.id, ids)).run();
    }
    tx.delete(importBatches).where(eq(importBatches.id, batchId)).run();
  });
  return { deleted: ids.length };
}

/** 删除单篇文献（误导入等） */
export function deleteReference(id: string): void {
  deleteReferences([id]);
}

/** 批量删除文献 */
export function deleteReferencesByIds(ids: string[]): { deleted: number } {
  deleteReferences(ids);
  return { deleted: ids.length };
}

export interface ScreeningItem {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  status: ReferenceStatus;
  isDuplicate: boolean;
  dedupGroupId?: string;
  importBatchId?: string;
  sourceName?: string;
  decision?: Decision;
  aiSuggestion?: Decision;
  aiReason?: string;
  reasons: string[];
  note?: string;
  createdAt: string;
}

export type ScreeningFilter = 'all' | 'pending' | 'included' | 'excluded';

/** 初筛状态计数（始终基于去重后口径） */
export interface ScreeningCounts {
  total: number;
  pending: number;
  included: number;
  excluded: number;
  duplicates: number;
}

const SCREENING_PENDING: ReferenceStatus[] = ['imported', 'screening_tas'];

function statusCondition(filter: ScreeningFilter) {
  if (filter === 'pending') return inArray(references.status, SCREENING_PENDING);
  if (filter === 'included') return eq(references.status, 'tas_included');
  if (filter === 'excluded') return eq(references.status, 'tas_excluded');
  return undefined;
}

/**
 * 初筛状态计数。
 * 注意：重复条目（is_duplicate = 1）不进初筛口径，只单独计数，符合 PRISMA「去重后筛选」。
 */
export function countScreening(projectId: string): ScreeningCounts {
  const rows = db
    .select({ status: references.status, isDuplicate: references.isDuplicate })
    .from(references)
    .where(eq(references.projectId, projectId))
    .all();
  const counts: ScreeningCounts = {
    total: 0,
    pending: 0,
    included: 0,
    excluded: 0,
    duplicates: 0,
  };
  for (const r of rows) {
    if (r.isDuplicate) {
      counts.duplicates++;
      continue;
    }
    counts.total++;
    if (SCREENING_PENDING.includes(r.status as ReferenceStatus)) counts.pending++;
    else if (r.status === 'tas_included') counts.included++;
    else if (r.status === 'tas_excluded') counts.excluded++;
  }
  return counts;
}

export interface ScreeningPage {
  items: ScreeningItem[];
  total: number; // 当前筛选条件下的条数
  page: number;
  pageSize: number;
  counts: ScreeningCounts;
}

export interface ListScreeningOptions {
  filter?: ScreeningFilter;
  /** 关键词：标题 / 摘要 / DOI / PMID 模糊匹配 */
  search?: string;
  page?: number;
  pageSize?: number;
  /** 是否连带列出重复条目（默认否） */
  includeDuplicates?: boolean;
}

/**
 * 初筛列表：服务端筛选 + 分页，默认排除重复条目。
 * 摘要等大字段只对当前页返回，避免几千条题录时首屏 payload 过大。
 */
export function listScreening(
  projectId: string,
  options: ListScreeningOptions = {},
): ScreeningPage {
  const filter = options.filter ?? 'all';
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(500, Math.max(1, Math.floor(options.pageSize ?? 50)));
  const includeDuplicates = options.includeDuplicates ?? false;

  const conditions = [eq(references.projectId, projectId)];
  if (!includeDuplicates) conditions.push(eq(references.isDuplicate, 0));
  const statusWhere = statusCondition(filter);
  if (statusWhere) conditions.push(statusWhere);
  const search = options.search?.trim();
  if (search) {
    const like = `%${search}%`;
    conditions.push(
      sql`(${references.title} LIKE ${like} OR ${references.abstract} LIKE ${like} OR ${references.doi} LIKE ${like} OR ${references.pmid} LIKE ${like})`,
    );
  }
  const where = and(...conditions);

  const totalRow = db
    .select({ c: sql<number>`count(*)` })
    .from(references)
    .where(where)
    .get();
  const total = Number(totalRow?.c ?? 0);

  const rows = db
    .select()
    .from(references)
    .where(where)
    .orderBy(desc(references.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const items = attachDecisions(rows);

  return { items, total, page, pageSize, counts: countScreening(projectId) };
}

/** 给当前页文献挂上题摘初筛判定 */
function attachDecisions(
  rows: Array<typeof references.$inferSelect>,
): ScreeningItem[] {
  const ids = rows.map((r) => r.id);
  const decisions = ids.length
    ? db
        .select()
        .from(screenDecisions)
        .where(
          and(
            inArray(screenDecisions.referenceId, ids),
            eq(screenDecisions.stage, 'title_abstract'),
          ),
        )
        .all()
    : [];
  const decisionByRef = new Map(decisions.map((d) => [d.referenceId, d]));

  const sourceIds = [...new Set(rows.map((r) => r.sourceDatabaseId).filter(Boolean))] as string[];
  const sourceNameById = new Map<string, string>();
  if (sourceIds.length) {
    const sources = db
      .select({ id: searchDatabases.id, name: searchDatabases.name })
      .from(searchDatabases)
      .where(inArray(searchDatabases.id, sourceIds))
      .all();
    for (const s of sources) sourceNameById.set(s.id, s.name);
  }

  return rows.map((r) => {
    const d = decisionByRef.get(r.id);
    return {
      id: r.id,
      title: r.title,
      authors: safeParse<string[]>(r.authors, []),
      abstract: r.abstract,
      year: r.year ?? undefined,
      journal: r.journal ?? undefined,
      doi: r.doi ?? undefined,
      pmid: r.pmid ?? undefined,
      status: r.status as ReferenceStatus,
      isDuplicate: r.isDuplicate === 1,
      dedupGroupId: r.dedupGroupId ?? undefined,
      importBatchId: r.importBatchId ?? undefined,
      sourceName: r.sourceDatabaseId ? (sourceNameById.get(r.sourceDatabaseId) ?? undefined) : undefined,
      decision: (d?.decision as Decision | null | undefined) ?? undefined,
      aiSuggestion: (d?.aiSuggestion as Decision | null | undefined) ?? undefined,
      aiReason: d?.aiReason ?? undefined,
      reasons: safeParse<string[]>(d?.reasons ?? '[]', []),
      note: d?.note ?? undefined,
      createdAt: r.createdAt,
    };
  });
}

function upsertDecision(
  referenceId: string,
  stage: 'title_abstract' | 'fulltext',
  patch: Partial<{
    decision: Decision;
    aiSuggestion: Decision;
    aiReason: string;
    reasons: string[];
    note: string;
  }>,
  conn: DbLike = db,
): void {
  const now = new Date().toISOString();
  const existing = conn
    .select()
    .from(screenDecisions)
    .where(
      and(
        eq(screenDecisions.referenceId, referenceId),
        eq(screenDecisions.stage, stage),
      ),
    )
    .get();

  if (existing) {
    conn
      .update(screenDecisions)
      .set({
        ...(patch.decision !== undefined ? { decision: patch.decision } : {}),
        ...(patch.aiSuggestion !== undefined ? { aiSuggestion: patch.aiSuggestion } : {}),
        ...(patch.aiReason !== undefined ? { aiReason: patch.aiReason } : {}),
        ...(patch.reasons !== undefined ? { reasons: JSON.stringify(patch.reasons) } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        updatedAt: now,
      })
      .where(eq(screenDecisions.id, existing.id))
      .run();
  } else {
    conn
      .insert(screenDecisions)
      .values({
        id: randomUUID(),
        referenceId,
        stage,
        decision: patch.decision ?? 'undecided',
        aiSuggestion: patch.aiSuggestion ?? null,
        aiReason: patch.aiReason ?? null,
        reasons: patch.reasons ? JSON.stringify(patch.reasons) : '[]',
        note: patch.note ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

/**
 * 人工判定：更新判定 + 同步文献状态。
 * 允许修正此前结论（含撤回纳入 → 排除），但状态迁移仍必须合法。
 */
export function applyHumanDecision(
  referenceId: string,
  input: { decision: Decision; reasons: string[]; note?: string },
): { status: ReferenceStatus } {
  const ref = getReference(referenceId);
  if (!ref) throw new Error('文献不存在');
  const status: ReferenceStatus =
    input.decision === 'include'
      ? 'tas_included'
      : input.decision === 'exclude'
        ? 'tas_excluded'
        : 'screening_tas';
  return inTransaction((tx) => {
    upsertDecision(
      referenceId,
      'title_abstract',
      {
        decision: input.decision,
        reasons: input.reasons,
        note: input.note,
      },
      tx,
    );
    const applied = setReferenceStatusTx(tx, referenceId, status, {
      clearDerived: true,
    });
    return { status: applied };
  });
}

/** 单篇 AI 建议（并持久化 aiSuggestion） */
export async function suggestOne(
  referenceId: string,
): Promise<ScreeningSuggestion> {
  const ref = getReference(referenceId);
  if (!ref) throw new Error('文献不存在');
  const proto = getProtocol(ref.projectId);
  if (!proto) throw new Error('请先制定协议（至少填写纳入/排除标准）再使用 AI 建议');
  const settings = getAiSettings(ref.projectId);
  const s = await suggestReference(
    proto.criteria,
    { title: ref.title, abstract: ref.abstract },
    {
      systemPrompt: settings?.screeningSystemPrompt ?? undefined,
      providerId: settings?.screeningProviderId ?? null,
    },
  );
  upsertDecision(referenceId, 'title_abstract', { aiSuggestion: s.decision, aiReason: s.reason });
  return s;
}

export interface BatchSuggestFailure {
  referenceId: string;
  error: string;
}

export interface BatchSuggestResult {
  suggestions: Array<{ referenceId: string } & ScreeningSuggestion>;
  failed: BatchSuggestFailure[];
  /** 未参与本次建议的文献（重复条目 / 已进入全文及提取阶段 / 已有建议被跳过） */
  skipped: number;
  total: number;
}

/** 批量建议时允许被 AI 覆盖的初筛状态（已推进到全文/提取的文献不动） */
const AI_TARGET_STATUSES: ReferenceStatus[] = ['imported', 'screening_tas'];

export interface ScreeningTarget {
  id: string;
  title: string;
  abstract: string;
}

/**
 * 选择批量初筛目标：非重复、初筛开放状态。
 * - 未显式指定时：默认跳过已有 AI 建议，force=true 时全部重判；
 * - 显式指定 referenceIds 时：尊重选择，仍只取非重复/开放状态。
 */
export function selectScreeningTargets(
  projectId: string,
  opts: { force?: boolean; referenceIds?: string[] } = {},
): ScreeningTarget[] {
  const refs = db
    .select({
      id: references.id,
      title: references.title,
      abstract: references.abstract,
      status: references.status,
      isDuplicate: references.isDuplicate,
      importOrder: references.importOrder,
    })
    .from(references)
    .where(eq(references.projectId, projectId))
    .all();

  const requested = opts.referenceIds && opts.referenceIds.length ? new Set(opts.referenceIds) : null;
  const eligible = refs.filter(
    (r) =>
      r.isDuplicate !== 1 &&
      AI_TARGET_STATUSES.includes(r.status as ReferenceStatus) &&
      (!requested || requested.has(r.id)),
  );

  const ids = eligible.map((r) => r.id);
  const suggestedRows = ids.length
    ? db
        .select({ referenceId: screenDecisions.referenceId, aiSuggestion: screenDecisions.aiSuggestion })
        .from(screenDecisions)
        .where(
          and(
            inArray(screenDecisions.referenceId, ids),
            eq(screenDecisions.stage, 'title_abstract'),
          ),
        )
        .all()
    : [];
  const hasSuggestion = new Set(
    suggestedRows.filter((d) => d.aiSuggestion != null).map((d) => d.referenceId),
  );

  return eligible
    .filter((r) => (requested ? true : opts.force || !hasSuggestion.has(r.id)))
    .sort((a, b) => a.importOrder - b.importOrder)
    .map((r) => ({ id: r.id, title: r.title, abstract: r.abstract }));
}

/**
 * 批量 AI 建议（按 chunkSize 篇一组调用 LLM），并持久化。
 *
 * - 使用项目级初筛模型与提示词（未配置时继承全局/内置）；
 * - 默认跳过已有 AI 建议，force=true 时全部重判；
 * - 每个分块独立 try/catch，单块失败不丢已完成分块的结果。
 */
export async function suggestBatch(
  projectId: string,
  referenceIds?: string[],
  chunkSize = 20,
  force = false,
): Promise<BatchSuggestResult> {
  const proto = getProtocol(projectId);
  if (!proto) throw new Error('请先制定协议（至少填写纳入/排除标准）再使用 AI 建议');

  const settings = getAiSettings(projectId);
  const targets = selectScreeningTargets(projectId, { force, referenceIds });
  const eligibleCount = selectScreeningTargets(projectId, { force: true, referenceIds }).length;
  const skipped = Math.max(0, eligibleCount - targets.length);

  const CHUNK = Math.min(50, Math.max(1, chunkSize));
  const suggestions: Array<{ referenceId: string } & ScreeningSuggestion> = [];
  const failed: BatchSuggestFailure[] = [];

  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    try {
      const out = await suggestReferencesBatch(
        proto.criteria,
        chunk.map((t) => ({ title: t.title, abstract: t.abstract })),
        {
          systemPrompt: settings?.screeningSystemPrompt ?? undefined,
          providerId: settings?.screeningProviderId ?? null,
        },
      );
      inTransaction((tx) => {
        chunk.forEach((t, j) => {
          const s = out[j];
          if (!s) return;
          upsertDecision(
            t.id,
            'title_abstract',
            { aiSuggestion: s.decision, aiReason: s.reason },
            tx,
          );
          suggestions.push({ referenceId: t.id, decision: s.decision, reason: s.reason });
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const t of chunk) failed.push({ referenceId: t.id, error: message });
    }
  }

  return { suggestions, failed, skipped, total: targets.length };
}

/** 全文人工判定 */
export function applyFulltextDecision(
  referenceId: string,
  input: { decision: Decision; reasons: string[]; note?: string },
): { status: ReferenceStatus } {
  const ref = getReference(referenceId);
  if (!ref) throw new Error('文献不存在');
  const status: ReferenceStatus =
    input.decision === 'include'
      ? 'ft_included'
      : input.decision === 'exclude'
        ? 'ft_excluded'
        : 'fulltext_uploaded';
  return inTransaction((tx) => {
    upsertDecision(
      referenceId,
      'fulltext',
      {
        decision: input.decision,
        reasons: input.reasons,
        note: input.note,
      },
      tx,
    );
    const applied = setReferenceStatusTx(tx, referenceId, status, {
      clearDerived: true,
    });
    return { status: applied };
  });
}

/** 全文 AI 建议 */
export async function suggestFulltext(
  referenceId: string,
  fullText: string,
): Promise<ScreeningSuggestion> {
  const ref = getReference(referenceId);
  if (!ref) throw new Error('文献不存在');
  const proto = getProtocol(ref.projectId);
  if (!proto) throw new Error('请先制定协议（至少填写纳入/排除标准）再使用 AI 建议');
  const settings = getAiSettings(ref.projectId);
  const s = await suggestFulltextExcerpt(
    proto.criteria,
    fullText,
    {
      systemPrompt: settings?.fulltextSystemPrompt ?? undefined,
      providerId: settings?.screeningProviderId ?? null,
    },
  );
  upsertDecision(referenceId, 'fulltext', { aiSuggestion: s.decision, aiReason: s.reason });
  return s;
}

export interface FulltextItem {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  doi?: string;
  status: ReferenceStatus;
  decision?: Decision;
  aiSuggestion?: Decision;
  aiReason?: string;
  reasons: string[];
  note?: string;
  documentState?: string;
  documentError?: string;
}

const FULLTEXT_STATUSES: ReferenceStatus[] = [
  'tas_included',
  'fulltext_pending',
  'fulltext_uploaded',
  'ft_included',
  'ft_excluded',
  'extracted',
];

/** 全文流程候选列表（初筛纳入之后） */
export function listFulltext(projectId: string): FulltextItem[] {
  const refs = db
    .select()
    .from(references)
    .where(eq(references.projectId, projectId))
    .orderBy(desc(references.createdAt))
    .all();
  const targets = refs.filter((r) =>
    (FULLTEXT_STATUSES as string[]).includes(r.status),
  );
  const ids = targets.map((r) => r.id);

  const decs = ids.length
    ? db.select().from(screenDecisions).where(inArray(screenDecisions.referenceId, ids)).all()
    : [];
  const ftDecByRef = new Map<string, (typeof decs)[number]>();
  for (const d of decs) {
    if (d.stage === 'fulltext') ftDecByRef.set(d.referenceId, d);
  }

  const docs = ids.length
    ? db.select().from(documents).where(inArray(documents.referenceId, ids)).all()
    : [];
  const docByRef = new Map(docs.map((d) => [d.referenceId, d]));

  return targets.map((r) => {
    const d = ftDecByRef.get(r.id);
    const doc = docByRef.get(r.id);
    return {
      id: r.id,
      title: r.title,
      authors: safeParse<string[]>(r.authors, []),
      year: r.year ?? undefined,
      journal: r.journal ?? undefined,
      doi: r.doi ?? undefined,
      status: r.status as ReferenceStatus,
      decision: (d?.decision as Decision | null | undefined) ?? undefined,
      aiSuggestion: (d?.aiSuggestion as Decision | null | undefined) ?? undefined,
      aiReason: d?.aiReason ?? undefined,
      reasons: safeParse<string[]>(d?.reasons ?? '[]', []),
      note: d?.note ?? undefined,
      documentState: doc?.state ?? undefined,
      documentError: doc?.error ?? undefined,
    };
  });
}

/**
 * 接受 AI 判定：把 aiSuggestion 落为人工 decision（纳入/排除/待定），支持指定范围。
 *
 * 只作用于仍处于初筛阶段的文献：已进入全文 / 已提取的文献即使残留初筛 AI 建议也不会被打回，
 * 否则「接受全部 AI 判定」会把流程倒退（旧实现的 bug）。
 */
export function acceptAiSuggestions(
  projectId: string,
  referenceIds?: string[],
): { accepted: number; skipped: number } {
  const refs = db
    .select({ id: references.id, status: references.status, isDuplicate: references.isDuplicate })
    .from(references)
    .where(eq(references.projectId, projectId))
    .all();
  const requested = referenceIds && referenceIds.length ? new Set(referenceIds) : null;
  const candidates = refs.filter(
    (r) => !requested || requested.has(r.id),
  );
  const eligible = candidates.filter(
    (r) => r.isDuplicate !== 1 && isScreeningOpen(r.status as ReferenceStatus),
  );
  const skipped = candidates.length - eligible.length;
  const ids = eligible.map((r) => r.id);

  const decs = ids.length
    ? db
        .select()
        .from(screenDecisions)
        .where(
          and(
            inArray(screenDecisions.referenceId, ids),
            eq(screenDecisions.stage, 'title_abstract'),
          ),
        )
        .all()
    : [];

  let accepted = 0;
  inTransaction((tx) => {
    for (const d of decs) {
      if (
        d.aiSuggestion !== 'include' &&
        d.aiSuggestion !== 'exclude' &&
        d.aiSuggestion !== 'undecided'
      ) {
        continue;
      }
      const status: ReferenceStatus =
        d.aiSuggestion === 'include'
          ? 'tas_included'
          : d.aiSuggestion === 'exclude'
            ? 'tas_excluded'
            : 'screening_tas';
      upsertDecision(
        d.referenceId,
        'title_abstract',
        { decision: d.aiSuggestion, note: d.aiReason ?? undefined },
        tx,
      );
      setReferenceStatusTx(tx, d.referenceId, status, { clearDerived: true });
      accepted++;
    }
  });
  return { accepted, skipped: Math.max(0, skipped) };
}
