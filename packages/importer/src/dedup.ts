import type { DedupGroup } from './types';

/** 归一化标题：小写、去除标点与空白（保留中日韩字符） */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, (c) => ` ${c} `)
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, '')
    .trim();
}

export interface DedupItem {
  doi?: string;
  title: string;
  /** 第一作者（可选，用于无 DOI 时进一步区分同名文献） */
  firstAuthor?: string;
  /** 期刊（可选，用于无 DOI 时进一步区分同名文献） */
  journal?: string;
}

/** 归一化单个字段：小写、去标点与空白（保留中日韩字符） */
function normalizeToken(value?: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, '');
}

/**
 * 去重 key：优先 DOI（小写）；无 DOI 时按「归一化标题 + 第一作者 + 期刊」，
 * 三者都参与比较（缺哪个用空串）。标题也没有则各自成组。
 */
export function dedupKeyOf(item: DedupItem, index = 0): string {
  const doi = item.doi?.trim().toLowerCase();
  if (doi) return `doi:${doi}`;
  const t = normalizeTitle(item.title);
  if (t) {
    return `title:${t}|au:${normalizeToken(item.firstAuthor)}|j:${normalizeToken(item.journal)}`;
  }
  return `nokey:${index}`; // 无法去重则各自成组
}

/**
 * 生成去重组 id。
 * 注意：groupId 会被持久化到 `references.dedup_group_id`，必须是**全局唯一**的，
 * 不能使用批次内自增编号（g1/g2…），否则不同批次的不相干文献会撞到同一个组。
 * 调用方需传入一个能生成唯一 id 的函数（uuid / 雪花 id 等）。
 */
export function makeDedupGroupId(
  key: string,
  index: number,
  uniqueId: (seed: string) => string,
): string {
  return uniqueId(`${key}#${index}`);
}

/**
 * 去重：优先按 DOI（小写），无 DOI 时按归一化标题。
 * 返回按 key 聚合的分组（批内使用；groupId 需由调用方按 `index` 替换为全局唯一 id）。
 */
export function buildDedupGroups(items: DedupItem[]): DedupGroup[] {
  const groups = new Map<string, number[]>();

  items.forEach((item, idx) => {
    const key = dedupKeyOf(item, idx);
    const arr = groups.get(key);
    if (arr) arr.push(idx);
    else groups.set(key, [idx]);
  });

  return Array.from(groups.values()).map((itemIndices, gi) => ({
    groupId: `g${gi + 1}`,
    canonicalIndex: itemIndices[0]!,
    itemIndices,
  }));
}
