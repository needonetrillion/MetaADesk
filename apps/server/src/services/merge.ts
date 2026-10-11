import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { dedupKeyOf } from '@meta/importer';
import { db, inTransaction } from '../db/client';
import { references } from '../db/schema';

export interface MergeResult {
  groups: number;
  duplicates: number;
}

/**
 * 去重合并：按 DOI(小写) → 归一化标题 分组，组内按 import_order 升序，
 * 第一为主条目（is_duplicate=0），其余为重复（is_duplicate=1），共享一个 dedup_group_id。
 * 只改这两个标记，不触碰 status / 判定 / 全文 / 提取。
 */
export function mergeDuplicates(projectId: string): MergeResult {
  const rows = db
    .select({
      id: references.id,
      doi: references.doi,
      title: references.title,
      authors: references.authors,
      journal: references.journal,
      importOrder: references.importOrder,
      dedupGroupId: references.dedupGroupId,
    })
    .from(references)
    .where(eq(references.projectId, projectId))
    .all();

  const groups = new Map<string, typeof rows>();
  rows.forEach((row, idx) => {
    let firstAuthor: string | undefined;
    try {
      const authors = JSON.parse(row.authors) as unknown;
      if (Array.isArray(authors) && typeof authors[0] === 'string') {
        firstAuthor = authors[0];
      }
    } catch {
      firstAuthor = undefined;
    }
    const key = dedupKeyOf(
      {
        doi: row.doi ?? undefined,
        title: row.title,
        firstAuthor,
        journal: row.journal ?? undefined,
      },
      idx,
    );
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  });

  let groupCount = 0;
  let duplicateCount = 0;

  inTransaction((tx) => {
    for (const members of groups.values()) {
      members.sort((a, b) => (a.importOrder ?? 0) - (b.importOrder ?? 0));
      const canonical = members[0]!;
      const groupId = canonical.dedupGroupId ?? randomUUID();
      groupCount++;

      members.forEach((member, i) => {
        const isDuplicate = i === 0 ? 0 : 1;
        if (isDuplicate) duplicateCount++;
        tx.update(references)
          .set({ dedupGroupId: groupId, isDuplicate })
          .where(eq(references.id, member.id))
          .run();
      });
    }
  });

  return { groups: groupCount, duplicates: duplicateCount };
}
