import { eq, inArray } from 'drizzle-orm';
import { db, inTransaction, type DbLike } from '../db/client';
import {
  documents,
  extractions,
  figures,
  importBatches,
  references,
  screenDecisions,
  searchDatabases,
  searchStrategies,
} from '../db/schema';
import { removeReferenceDir } from './files';

/** 在事务内删除文献的下游数据与文献本身 */
function deleteReferenceRows(tx: DbLike, ids: string[]): void {
  if (ids.length === 0) return;
  tx.delete(documents).where(inArray(documents.referenceId, ids)).run();
  tx.delete(screenDecisions).where(inArray(screenDecisions.referenceId, ids)).run();
  tx.delete(figures).where(inArray(figures.referenceId, ids)).run();
  tx.delete(extractions).where(inArray(extractions.referenceId, ids)).run();
  tx.delete(references).where(inArray(references.id, ids)).run();
}

/** 删除检索式及其导入的条目、下游数据、批次与文件 */
export function deleteStrategyCascade(strategyId: string): { deletedReferences: number } {
  const strat = db
    .select({ id: searchStrategies.id })
    .from(searchStrategies)
    .where(eq(searchStrategies.id, strategyId))
    .get();
  if (!strat) return { deletedReferences: 0 };

  const refs = db
    .select({ id: references.id, projectId: references.projectId })
    .from(references)
    .where(eq(references.sourceQueryId, strategyId))
    .all();
  const ids = refs.map((r) => r.id);

  // 文件删除在事务外
  for (const r of refs) removeReferenceDir(r.projectId, r.id);

  inTransaction((tx) => {
    deleteReferenceRows(tx, ids);
    tx.delete(importBatches).where(eq(importBatches.strategyId, strategyId)).run();
    tx.delete(searchStrategies).where(eq(searchStrategies.id, strategyId)).run();
  });

  return { deletedReferences: ids.length };
}

/** 删除来源库及其所有检索式、条目、下游数据、批次与文件 */
export function deleteSourceCascade(
  projectId: string,
  sourceId: string,
): { deletedStrategies: number; deletedReferences: number } {
  const strategies = db
    .select({ id: searchStrategies.id })
    .from(searchStrategies)
    .where(eq(searchStrategies.databaseId, sourceId))
    .all();
  const strategyIds = strategies.map((s) => s.id);

  const refs = db
    .select({ id: references.id, projectId: references.projectId })
    .from(references)
    .where(eq(references.sourceDatabaseId, sourceId))
    .all();
  const ids = refs.map((r) => r.id);

  for (const r of refs) removeReferenceDir(r.projectId, r.id);

  inTransaction((tx) => {
    deleteReferenceRows(tx, ids);
    if (strategyIds.length) {
      tx.delete(importBatches).where(inArray(importBatches.strategyId, strategyIds)).run();
      tx.delete(searchStrategies).where(eq(searchStrategies.databaseId, sourceId)).run();
    }
    tx.delete(searchDatabases).where(eq(searchDatabases.id, sourceId)).run();
  });

  return { deletedStrategies: strategies.length, deletedReferences: ids.length };
}
