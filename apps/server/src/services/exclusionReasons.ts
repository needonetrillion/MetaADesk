import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { EXCLUSION_REASONS, EXCLUSION_REASON_LABELS } from '@meta/core';
import { db, inTransaction } from '../db/client';
import { exclusionReasons } from '../db/schema';
import { getActiveLLM } from './llm';
import { getProtocol } from './protocol';

export interface ExclusionReasonRow {
  id: string;
  code: string;
  label: string;
  isBuiltin: boolean;
  sortOrder: number;
}

export interface ExclusionReasonInput {
  id?: string;
  code?: string;
  label: string;
  isBuiltin?: boolean;
  sortOrder?: number;
}

/** 播种一套 PRISMA 默认排除理由 */
export function seedDefaultExclusionReasons(projectId: string): void {
  const existing = listExclusionReasons(projectId);
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  inTransaction((tx) => {
    EXCLUSION_REASONS.forEach((code, i) => {
      tx.insert(exclusionReasons)
        .values({
          id: randomUUID(),
          projectId,
          code,
          label: EXCLUSION_REASON_LABELS[code],
          isBuiltin: 1,
          sortOrder: i,
          createdAt: now,
        })
        .run();
    });
  });
}

export function listExclusionReasons(projectId: string): ExclusionReasonRow[] {
  return db
    .select({
      id: exclusionReasons.id,
      code: exclusionReasons.code,
      label: exclusionReasons.label,
      isBuiltin: exclusionReasons.isBuiltin,
      sortOrder: exclusionReasons.sortOrder,
    })
    .from(exclusionReasons)
    .where(eq(exclusionReasons.projectId, projectId))
    .orderBy(asc(exclusionReasons.sortOrder))
    .all()
    .map((r) => ({ ...r, isBuiltin: r.isBuiltin === 1 }));
}

/** 全量替换本项目排除理由（事务内） */
export function saveExclusionReasons(projectId: string, reasons: ExclusionReasonInput[]): void {
  const now = new Date().toISOString();
  inTransaction((tx) => {
    tx.delete(exclusionReasons).where(eq(exclusionReasons.projectId, projectId)).run();
    reasons.forEach((r, i) => {
      tx.insert(exclusionReasons)
        .values({
          id: r.id ?? randomUUID(),
          projectId,
          code: r.code?.trim() || `custom_${randomUUID()}`,
          label: r.label,
          isBuiltin: r.isBuiltin ? 1 : 0,
          sortOrder: r.sortOrder ?? i,
          createdAt: now,
        })
        .run();
    });
  });
}

/** AI 根据协议排除标准，建议一批大概率会用到的排除理由标签 */
export async function suggestExclusionReasons(projectId: string): Promise<string[]> {
  const proto = getProtocol(projectId);
  const client = getActiveLLM();
  const schema = z.object({ reasons: z.array(z.string()) });
  const exc = proto?.criteria
    .filter((c) => c.type === 'exclusion')
    .map((c) => c.text)
    .join('；');
  const out = await client.completeJSON(
    [
      {
        role: 'user',
        content: [
          '你是一名系统评价/Meta 分析研究者。请根据下面的项目排除标准，提炼 8~12 个最可能用到的「排除理由」标签（简短中文，每条不超过 12 字，如「研究设计不符」「干预措施不符」）。',
          `排除标准：${exc || '未提供，请给出通用的常见排除理由'}`,
          '请只输出 JSON：{"reasons":["理由1","理由2",...]}',
        ].join('\n'),
      },
    ],
    schema,
  );
  return out.reasons;
}
