import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { SearchStrategy } from '@meta/core';
import { db } from '../db/client';
import { importBatches, searchDatabases, searchStrategies } from '../db/schema';
import { deleteStrategyCascade } from './delete';

export interface StrategyWithDatabase extends SearchStrategy {
  databaseName: string;
  importedCount: number;
}

export function listStrategies(projectId: string): StrategyWithDatabase[] {
  const rows = db
    .select()
    .from(searchStrategies)
    .where(eq(searchStrategies.projectId, projectId))
    .orderBy(desc(searchStrategies.createdAt))
    .all();
  return rows.map((r) => {
    const d = db
      .select()
      .from(searchDatabases)
      .where(eq(searchDatabases.id, r.databaseId))
      .get();
    const importSum = db
      .select({ total: sql<number>`coalesce(sum(${importBatches.importedCount}), 0)` })
      .from(importBatches)
      .where(eq(importBatches.strategyId, r.id))
      .get();
    return {
      id: r.id,
      projectId: r.projectId,
      databaseId: r.databaseId,
      query: r.query,
      notes: r.notes ?? undefined,
      generatedBy: r.generatedBy as 'ai' | 'manual',
      createdAt: r.createdAt,
      databaseName: d?.name ?? r.databaseId,
      importedCount: Number(importSum?.total ?? 0),
    };
  });
}

export function createStrategy(
  projectId: string,
  input: {
    databaseId: string;
    query: string;
    notes?: string;
    generatedBy: 'ai' | 'manual';
  },
): StrategyWithDatabase {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.insert(searchStrategies)
    .values({
      id,
      projectId,
      databaseId: input.databaseId,
      query: input.query,
      notes: input.notes ?? null,
      generatedBy: input.generatedBy,
      createdAt,
    })
    .run();
  const d = db
    .select()
    .from(searchDatabases)
    .where(eq(searchDatabases.id, input.databaseId))
    .get();
  return {
    id,
    projectId,
    databaseId: input.databaseId,
    query: input.query,
    notes: input.notes,
    generatedBy: input.generatedBy,
    createdAt,
    databaseName: d?.name ?? input.databaseId,
    importedCount: 0,
  };
}

export function updateStrategy(
  id: string,
  input: { query: string; notes?: string },
): void {
  db.update(searchStrategies)
    .set({ query: input.query, notes: input.notes ?? null })
    .where(eq(searchStrategies.id, id))
    .run();
}

export function deleteStrategy(id: string): { deletedReferences: number } {
  return deleteStrategyCascade(id);
}
