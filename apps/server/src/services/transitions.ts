import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { ReferenceStatus } from '@meta/core';
import {
  assertTransition,
  isRegression,
  statusRank,
} from '@meta/core';
import { db, type DbLike } from '../db/client';
import { extractions, references, screenDecisions } from '../db/schema';

/**
 * 文献状态迁移的唯一入口。
 *
 * 背景：状态机（@meta/core 的 canTransition）此前是死代码，各 service 直接写 status，
 * 导致「接受 AI 判定把已提取文献打回初筛」「重复上传 PDF 让流程倒退」这类问题。
 * 这里统一收口：
 *   1. 迁移必须先通过状态机校验（非法迁移直接抛错 → 路由转 400）；
 *   2. 倒退迁移时同步清理已失效的派生数据（提取结果 / 全文判定），避免脏数据。
 */

/** 全文判定所在的秩（达到则视为已做出过全文判定） */
const FT_DECIDED_RANK = statusRank('ft_included');
const EXTRACTED_RANK = statusRank('extracted');

/** 在事务内清理因状态回退而失效的派生数据 */
function clearDerived(tx: DbLike, refId: string, to: ReferenceStatus): void {
  const toRank = statusRank(to);
  if (toRank < EXTRACTED_RANK) {
    // 不再是「已提取」，旧的提取结果已失效（例如重新上传了 PDF）
    tx.delete(extractions).where(eq(extractions.referenceId, refId)).run();
  }
  if (toRank < FT_DECIDED_RANK) {
    // 退回全文判定之前，只清掉「全文阶段」的判定，保留题摘初筛的判定记录
    tx.delete(screenDecisions)
      .where(
        and(
          eq(screenDecisions.referenceId, refId),
          eq(screenDecisions.stage, 'fulltext'),
        ),
      )
      .run();
  }
}

/** 在事务内执行状态迁移（内部使用，调用方需保证已在事务中） */
export function setReferenceStatusTx(
  tx: DbLike,
  referenceId: string,
  to: ReferenceStatus,
  options: { clearDerived?: boolean } = {},
): ReferenceStatus {
  const row = tx
    .select({ status: references.status })
    .from(references)
    .where(eq(references.id, referenceId))
    .get();
  if (!row) throw new Error('文献不存在');

  const from = row.status as ReferenceStatus;
  assertTransition(from, to);
  const regression = isRegression(from, to);

  if (from === to) {
    // 状态不变：不写库；仅当显式要求清理时（例如重新上传全文）才清理派生数据
    if (regression && options.clearDerived) clearDerived(tx, referenceId, to);
    return from;
  }

  if (regression) clearDerived(tx, referenceId, to);

  tx.update(references)
    .set({ status: to, updatedAt: new Date().toISOString() })
    .where(eq(references.id, referenceId))
    .run();
  return to;
}

/** 状态迁移（自带事务） */
export function setReferenceStatus(
  referenceId: string,
  to: ReferenceStatus,
  options: { clearDerived?: boolean } = {},
): ReferenceStatus {
  return db.transaction((tx) =>
    setReferenceStatusTx(tx, referenceId, to, options),
  );
}

/** 供路由/服务层复用的 id 生成 */
export const newId = (): string => randomUUID();
