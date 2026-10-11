import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { references, searchDatabases } from '../db/schema';

export interface SourceStat {
  sourceId: string;
  name: string;
  rawImported: number;
  uniqueKept: number;
  duplicateRemoved: number;
}

/** 每个来源库的命中统计（原始命中 / 唯一贡献 / 重复剔除） */
export function sourceStats(projectId: string): SourceStat[] {
  const sources = db
    .select({ id: searchDatabases.id, name: searchDatabases.name })
    .from(searchDatabases)
    .where(eq(searchDatabases.projectId, projectId))
    .all();

  const rows = db
    .select({
      sourceDatabaseId: references.sourceDatabaseId,
      isDuplicate: references.isDuplicate,
    })
    .from(references)
    .where(eq(references.projectId, projectId))
    .all();

  const raw = new Map<string, number>();
  const unique = new Map<string, number>();
  for (const row of rows) {
    if (!row.sourceDatabaseId) continue;
    raw.set(row.sourceDatabaseId, (raw.get(row.sourceDatabaseId) ?? 0) + 1);
    if (row.isDuplicate === 0) {
      unique.set(row.sourceDatabaseId, (unique.get(row.sourceDatabaseId) ?? 0) + 1);
    }
  }

  return sources.map((s) => {
    const rawImported = raw.get(s.id) ?? 0;
    const uniqueKept = unique.get(s.id) ?? 0;
    return { sourceId: s.id, name: s.name, rawImported, uniqueKept, duplicateRemoved: rawImported - uniqueKept };
  });
}
