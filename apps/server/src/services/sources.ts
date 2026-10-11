import { randomUUID } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { searchDatabases, searchStrategies } from '../db/schema';

export interface SourceInput {
  presetKey?: string;
  name: string;
  url?: string;
  note?: string;
}

export interface ProjectSource {
  id: string;
  projectId: string;
  name: string;
  url?: string;
  note?: string;
  presetKey?: string;
  strategyCount: number;
}

/** 预设来源库清单（仅作“按需加入项目”的模板，不自动种入数据库） */
export const PRESET_DATABASES: SourceInput[] = [
  { presetKey: 'pubmed', name: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/', note: 'MeSH + [tiab]' },
  { presetKey: 'scopus', name: 'Scopus', url: 'https://www.scopus.com/', note: 'TITLE-ABS-KEY(...)' },
  { presetKey: 'wos', name: 'Web of Science', url: 'https://www.webofscience.com/', note: 'TS=(...)' },
  { presetKey: 'cnki', name: 'CNKI (中国知网)', url: 'https://www.cnki.net/', note: 'SU=(...)' },
  { presetKey: 'wanfang', name: '万方', url: 'https://www.wanfangdata.com.cn/', note: '主题:(...)' },
];

export function addSource(projectId: string, input: SourceInput): ProjectSource {
  const id = randomUUID();
  db.insert(searchDatabases)
    .values({
      id,
      projectId,
      name: input.name,
      url: input.url ?? null,
      note: input.note ?? null,
      presetKey: input.presetKey ?? null,
    })
    .run();
  return toProjectSource(projectId, id, input.name, input.url, input.note, input.presetKey);
}

/** 若同名来源库已存在则复用，否则自动添加（供 Agent 自动添加库） */
export function ensureProjectSource(projectId: string, input: SourceInput): ProjectSource {
  const existing = db
    .select()
    .from(searchDatabases)
    .where(and(eq(searchDatabases.projectId, projectId), eq(searchDatabases.name, input.name)))
    .get();
  if (existing) {
    return toProjectSource(
      projectId,
      existing.id,
      existing.name,
      existing.url ?? undefined,
      existing.note ?? undefined,
      existing.presetKey ?? undefined,
    );
  }
  return addSource(projectId, input);
}

/** 新建项目时默认预置的来源库（按名称匹配 PRESET_DATABASES） */
const DEFAULT_SOURCE_NAMES = ['PubMed', 'Web of Science', 'CNKI (中国知网)', '万方'];

/** 为项目自动加入默认来源库（已存在的同名库跳过） */
export function seedDefaultSources(projectId: string): ProjectSource[] {
  const existingNames = new Set(listProjectSources(projectId).map((s) => s.name));
  return PRESET_DATABASES.filter((p) => DEFAULT_SOURCE_NAMES.includes(p.name) && !existingNames.has(p.name))
    .map((p) => addSource(projectId, p));
}

export function listProjectSources(projectId: string): ProjectSource[] {
  const rows = db
    .select()
    .from(searchDatabases)
    .where(eq(searchDatabases.projectId, projectId))
    .all();

  const strategyCounts = new Map<string, number>();
  if (rows.length) {
    const counts = db
      .select({ databaseId: searchStrategies.databaseId, c: count() })
      .from(searchStrategies)
      .where(eq(searchStrategies.projectId, projectId))
      .groupBy(searchStrategies.databaseId)
      .all();
    for (const row of counts) strategyCounts.set(row.databaseId, row.c);
  }

  return rows.map((r) =>
    toProjectSource(
      projectId,
      r.id,
      r.name,
      r.url ?? undefined,
      r.note ?? undefined,
      r.presetKey ?? undefined,
      strategyCounts.get(r.id) ?? 0,
    ),
  );
}

/** 当前项目里“已添加且还没有检索式”的来源库（供 Agent 设计整体检索策略使用） */
export function selectStrategyTargets(projectId: string): ProjectSource[] {
  return listProjectSources(projectId).filter((s) => s.strategyCount === 0);
}

function toProjectSource(
  projectId: string,
  id: string,
  name: string,
  url: string | undefined,
  note: string | undefined,
  presetKey: string | undefined,
  strategyCount = 0,
): ProjectSource {
  return { id, projectId, name, ...(url ? { url } : {}), ...(note ? { note } : {}), ...(presetKey ? { presetKey } : {}), strategyCount };
}
