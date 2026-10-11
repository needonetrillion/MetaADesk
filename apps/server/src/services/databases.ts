import type { SearchDatabase } from '@meta/core';
import { db } from '../db/client';
import { searchDatabases } from '../db/schema';

/**
 * 预设来源库不再启动时全局种入。
 * 每个项目通过 `services/sources.ts` 的 `addSource` 按需加入预设或自定义来源库。
 */
export function ensureDefaultDatabases(): void {
  // no-op：来源库已改为项目级，按需添加
}

/** 过渡接口：返回全部来源库行（Plan 2 会把 Agent 切换到项目级来源列表） */
export function listDatabases(): SearchDatabase[] {
  return db
    .select()
    .from(searchDatabases)
    .all()
    .map((d) => ({
      id: d.id,
      name: d.name,
      url: d.url ?? undefined,
      note: d.note ?? undefined,
    }));
}
