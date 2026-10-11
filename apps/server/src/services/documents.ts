import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Document as DocumentEntity, ReferenceStatus } from '@meta/core';
import { statusRank } from '@meta/core';
import { createMinerUClient } from '@meta/mineru';
import { db, inTransaction } from '../db/client';
import { documents, references } from '../db/schema';
import { getSettings } from './settings';
import { setReferenceStatusTx } from './transitions';
import { pdfPath as refPdfPath, markdownPath as refMdPath, referenceDir } from './files';

/** MinerU 转换超时（秒），前端轮询上限与此保持一致 */
export const MINERU_TIMEOUT_SECONDS = 900;

/** 全文判定之前的秩（低于此值说明该文献还没做过全文判定） */
const FT_DECIDED_RANK = statusRank('ft_included');

function toEntity(row: (typeof documents.$inferSelect) | undefined): DocumentEntity | null {
  if (!row) return null;
  return {
    id: row.id,
    referenceId: row.referenceId,
    pdfPath: row.pdfPath,
    markdownPath: row.markdownPath ?? undefined,
    mineruTaskId: row.mineruTaskId ?? undefined,
    state: row.state as DocumentEntity['state'],
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getDocument(referenceId: string): DocumentEntity | null {
  const row = db
    .select()
    .from(documents)
    .where(eq(documents.referenceId, referenceId))
    .orderBy(desc(documents.createdAt))
    .get();
  return toEntity(row);
}

function getReferenceProjectId(referenceId: string): string {
  const ref = db
    .select({ projectId: references.projectId })
    .from(references)
    .where(eq(references.id, referenceId))
    .get();
  if (!ref) throw new Error('文献不存在');
  return ref.projectId;
}

/** 该文献的 PDF 在项目文件夹内的路径 */
export function resolvePdfPath(referenceId: string): string {
  return refPdfPath(getReferenceProjectId(referenceId), referenceId);
}

/** 该文献的 Markdown 在项目文件夹内的路径 */
export function resolveMarkdownPath(referenceId: string): string {
  return refMdPath(getReferenceProjectId(referenceId), referenceId);
}

/** 该文献的图片目录 */
export function resolveImagesDir(referenceId: string): string {
  return path.join(referenceDir(getReferenceProjectId(referenceId), referenceId), 'images');
}

/**
 * 保存上传的 PDF，创建/重置文档记录（每篇文献一份）。
 *
 * 已进入全文纳入/已提取的文献重新上传 PDF 属于「重来」：允许，但会清掉失效的
 * 全文判定与提取结果，状态统一回到 fulltext_pending（旧实现无条件写状态，既不清理也不校验）。
 */
export function createDocument(referenceId: string, pdfPath: string): DocumentEntity {
  const now = new Date().toISOString();
  inTransaction((tx) => {
    const ref = tx
      .select({ status: references.status })
      .from(references)
      .where(eq(references.id, referenceId))
      .get();
    if (!ref) throw new Error('文献不存在');

    const existing = tx
      .select()
      .from(documents)
      .where(eq(documents.referenceId, referenceId))
      .get();

    if (existing) {
      tx.update(documents)
        .set({
          pdfPath,
          state: 'pending',
          markdownPath: null,
          mineruTaskId: null,
          error: null,
          updatedAt: now,
        })
        .where(eq(documents.id, existing.id))
        .run();
    } else {
      tx.insert(documents)
        .values({
          id: randomUUID(),
          referenceId,
          pdfPath,
          state: 'pending',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    // 重新上传视为「回到待转换」；状态机只允许从初筛纳入/全文阶段回退到这里
    setReferenceStatusTx(tx, referenceId, 'fulltext_pending', {
      clearDerived: true,
    });
  });
  return getDocument(referenceId)!;
}

function updateDocumentState(
  id: string,
  patch: Partial<{ state: string; markdownPath: string | null; mineruTaskId: string | null; error: string | null }>,
): void {
  db.update(documents)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(documents.id, id))
    .run();
}

/** 转换是否仍然有效（用户可能在转换过程中重新上传/重新触发） */
function isConversionCurrent(id: string): boolean {
  const row = db
    .select({ state: documents.state })
    .from(documents)
    .where(eq(documents.id, id))
    .get();
  return row?.state === 'converting';
}

/** 后台执行 MinerU 转换 */
async function runConversion(referenceId: string, doc: DocumentEntity): Promise<void> {
  try {
    const settings = getSettings();
    const client = createMinerUClient({
      token: settings.mineruToken,
      baseUrl: settings.mineruBaseUrl,
    });
    const result = await client.extractFile(doc.pdfPath, {
      language: 'en',
      table: true,
      formula: true,
      timeout: MINERU_TIMEOUT_SECONDS,
    });

    // 期间用户可能重新上传了 PDF 或重新触发了转换，此时丢弃过期的结果
    if (!isConversionCurrent(doc.id)) return;

    if (result.state === 'done' && result.markdown) {
      let markdown = result.markdown;

      // 保存 MinerU 提取出的图片，并把 Markdown 中的图片路径改写为可访问的接口
      if (result.images?.length) {
        const imgDir = resolveImagesDir(referenceId);
        fs.mkdirSync(imgDir, { recursive: true });
        for (const img of result.images) {
          const imgPath = path.join(imgDir, img.name);
          fs.writeFileSync(imgPath, Buffer.from(img.data));
          const url = `/api/references/${referenceId}/document/images/${img.name}`;
          markdown = markdown.replaceAll(`images/${img.name}`, url);
          if (img.path && img.path !== `images/${img.name}`) {
            markdown = markdown.replaceAll(img.path, url);
          }
        }
      }

      const mdPath = resolveMarkdownPath(referenceId);
      fs.mkdirSync(path.dirname(mdPath), { recursive: true });
      fs.writeFileSync(mdPath, markdown, 'utf8');
      updateDocumentState(doc.id, {
        state: 'done',
        markdownPath: mdPath,
        mineruTaskId: result.taskId ?? null,
      });
      setReferenceStatus(referenceId, 'fulltext_uploaded');
    } else {
      updateDocumentState(doc.id, {
        state: 'failed',
        error: result.error ?? 'MinerU 转换未返回 Markdown',
      });
    }
  } catch (err) {
    updateDocumentState(doc.id, {
      state: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function setReferenceStatus(referenceId: string, status: ReferenceStatus): void {
  const ref = db
    .select({ status: references.status })
    .from(references)
    .where(eq(references.id, referenceId))
    .get();
  if (!ref) return;
  // 已经通过人工判定推进过流程的文献，转换完成不再覆盖其状态
  if (statusRank(ref.status as ReferenceStatus) >= FT_DECIDED_RANK) return;
  try {
    inTransaction((tx) => setReferenceStatusTx(tx, referenceId, status));
  } catch {
    // 状态迁移非法（例如人工已改判）时忽略，避免把转换结果记录成失败
  }
}

/** 触发转换（异步，立即返回当前状态） */
export function convertDocument(referenceId: string): DocumentEntity {
  const doc = getDocument(referenceId);
  if (!doc) throw new Error('尚未上传全文 PDF');
  const settings = getSettings();
  if (!settings.mineruToken) {
    throw new Error('请先在「设置」中配置 MinerU Token');
  }
  updateDocumentState(doc.id, { state: 'converting', error: null });
  void runConversion(referenceId, doc);
  return getDocument(referenceId)!;
}

/** 批量转换当前项目下所有“待转换/失败”的全文 */
export function convertAllDocuments(projectId: string): { started: number } {
  const settings = getSettings();
  if (!settings.mineruToken) {
    throw new Error('请先在「设置」中配置 MinerU Token');
  }

  const rows = db
    .select({ referenceId: documents.referenceId, state: documents.state })
    .from(documents)
    .innerJoin(references, eq(references.id, documents.referenceId))
    .where(
      and(
        eq(references.projectId, projectId),
        inArray(documents.state, ['pending', 'failed']),
      ),
    )
    .all();

  for (const row of rows) {
    convertDocument(row.referenceId);
  }
  return { started: rows.length };
}

export function readMarkdown(referenceId: string): { markdown: string; state: string } {
  const doc = getDocument(referenceId);
  if (!doc) throw new Error('尚未上传全文');
  if (!doc.markdownPath) throw new Error('全文尚未转换完成');
  const markdown = fs.readFileSync(doc.markdownPath, 'utf8');
  return { markdown, state: doc.state };
}

/**
 * 启动时清理「僵死」的转换任务。
 *
 * runConversion 是纯内存的 Promise：服务重启后，处于 converting 的记录永远不会有人再更新它，
 * 前端就会一直显示「转换中」。这里把它们标记为失败并提示重试。
 */
export function recoverStaleConversions(): number {
  const stale = db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.state, 'converting'))
    .all();
  if (stale.length === 0) return 0;
  db.update(documents)
    .set({
      state: 'failed',
      error: '服务重启导致转换中断，请点击「重试」重新转换',
      updatedAt: new Date().toISOString(),
    })
    .where(
      inArray(
        documents.id,
        stale.map((d) => d.id),
      ),
    )
    .run();
  return stale.length;
}

/** 批量查询文档状态（供前端轮询一次性刷新） */
export function listDocumentStates(referenceIds: string[]): Array<{
  referenceId: string;
  state: string;
  error?: string;
}> {
  if (referenceIds.length === 0) return [];
  const rows = db
    .select({
      referenceId: documents.referenceId,
      state: documents.state,
      error: documents.error,
    })
    .from(documents)
    .where(inArray(documents.referenceId, referenceIds))
    .all();
  return rows.map((r) => ({
    referenceId: r.referenceId,
    state: r.state,
    error: r.error ?? undefined,
  }));
}
