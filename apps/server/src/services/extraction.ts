import { randomUUID } from 'node:crypto';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { ExtractionFieldDef } from '@meta/core';
import { db, inTransaction } from '../db/client';
import {
  documents,
  extractionTemplates,
  extractions,
  figures,
  references,
} from '../db/schema';
import { extractData, proposeExtractionTemplate } from './ai';
import { readMarkdown } from './documents';
import { getProtocol } from './protocol';
import { setReferenceStatusTx } from './transitions';

export interface FigureInfo {
  id: string;
  index: number;
  caption?: string;
  location?: string;
  status: string;
  extractedValueNote?: string;
}

export interface ExtractionResult {
  referenceId: string;
  values: Record<string, string>;
  figures: FigureInfo[];
  completedAt?: string;
}

export interface ResultsRow {
  referenceId: string;
  title: string;
  year?: number;
  journal?: string;
  values: Record<string, string>;
  figures: FigureInfo[];
}

/** 默认字段表（未手动定义时的兜底） */
export function defaultTemplate(outcomes: string[]): ExtractionFieldDef[] {
  const fields: ExtractionFieldDef[] = [
    { key: 'design', label: '研究设计', description: '如 RCT、队列研究、病例对照等' },
    { key: 'sample_size', label: '样本量' },
    { key: 'population', label: '研究对象', description: '人群特征、纳入人群' },
    { key: 'country', label: '国家/地区' },
    { key: 'follow_up', label: '随访时长' },
    { key: 'intervention', label: '干预措施', description: '剂量、疗程等细节' },
    { key: 'comparison', label: '对照', description: '对照组设置' },
  ];
  if (outcomes.length > 0) {
    outcomes.forEach((o, i) => {
      const prefix = `outcome_${i + 1}`;
      fields.push({ key: `${prefix}_measure`, label: `${o}·效应量类型` });
      fields.push({ key: `${prefix}_value`, label: `${o}·效应值/结果` });
      fields.push({ key: `${prefix}_ci`, label: `${o}·置信区间` });
    });
  } else {
    fields.push({ key: 'outcome_measure', label: '结局·效应量类型' });
    fields.push({ key: 'outcome_value', label: '结局·效应值/结果' });
  }
  return fields;
}

export function getTemplate(projectId: string): ExtractionFieldDef[] | null {
  const row = db
    .select()
    .from(extractionTemplates)
    .where(eq(extractionTemplates.projectId, projectId))
    .get();
  if (!row) return null;
  try {
    return JSON.parse(row.fields) as ExtractionFieldDef[];
  } catch {
    return null;
  }
}

export interface SaveTemplateResult {
  fields: ExtractionFieldDef[];
  /** 因字段 key 变更而被迁移的历史提取记录数 */
  migrated: number;
  /** 字段 key 变更明细（旧 key → 新 key） */
  renamed: Array<{ from: string; to: string }>;
}

/**
 * 保存字段表。
 *
 * 旧实现只覆盖模板：历史提取结果按 key 存储，一旦把 key 改名（例如 outcome_1_value →
 * outcome_1_effect），旧数据在 CSV/结果页就会凭空消失。这里在保存时把已存数据迁移到新 key。
 */
export function saveTemplate(
  projectId: string,
  fields: ExtractionFieldDef[],
): SaveTemplateResult {
  const now = new Date().toISOString();
  const previous = getTemplate(projectId) ?? [];
  const mapped = mapRenamedFields(previous, fields);

  const existing = db
    .select()
    .from(extractionTemplates)
    .where(eq(extractionTemplates.projectId, projectId))
    .get();
  if (existing) {
    db.update(extractionTemplates)
      .set({ fields: JSON.stringify(fields), updatedAt: now })
      .where(eq(extractionTemplates.id, existing.id))
      .run();
  } else {
    db.insert(extractionTemplates)
      .values({
        id: randomUUID(),
        projectId,
        fields: JSON.stringify(fields),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const migrated = mapped.length ? migrateExtractionValues(projectId, mapped) : 0;
  return { fields, migrated, renamed: mapped };
}

/** 按位置推断被改名的字段 key（旧 → 新） */
function mapRenamedFields(
  previous: ExtractionFieldDef[],
  next: ExtractionFieldDef[],
): Array<{ from: string; to: string }> {
  const nextKeys = new Set(next.map((f) => f.key));
  const renamed: Array<{ from: string; to: string }> = [];
  const limit = Math.min(previous.length, next.length);
  for (let i = 0; i < limit; i++) {
    const from = previous[i]!.key;
    const to = next[i]!.key;
    if (from !== to) renamed.push({ from, to });
  }
  // 旧 key 在新模板中已彻底消失：说明是按位置改名而不是新增字段
  return renamed.filter((r) => !nextKeys.has(r.from));
}

/** 把历史提取值从旧 key 迁移到新 key，返回受影响的记录数 */
function migrateExtractionValues(
  projectId: string,
  renamed: Array<{ from: string; to: string }>,
): number {
  const refs = db
    .select({ id: references.id })
    .from(references)
    .where(eq(references.projectId, projectId))
    .all();
  const refIds = refs.map((r) => r.id);
  if (refIds.length === 0) return 0;

  const rows = db
    .select()
    .from(extractions)
    .where(inArray(extractions.referenceId, refIds))
    .all();

  const now = new Date().toISOString();
  let migrated = 0;

  for (const row of rows) {
    let payload: { values?: Record<string, string> };
    try {
      payload = JSON.parse(row.fields) as { values?: Record<string, string> };
    } catch {
      continue;
    }
    const values = payload.values ?? {};
    let changed = false;
    for (const { from, to } of renamed) {
      if (Object.prototype.hasOwnProperty.call(values, from)) {
        if (values[to] === undefined && from !== to) {
          values[to] = values[from]!;
        }
        delete values[from];
        changed = true;
      }
    }
    if (!changed) continue;
    db.update(extractions)
      .set({ fields: JSON.stringify({ ...payload, values }), updatedAt: now })
      .where(eq(extractions.id, row.id))
      .run();
    migrated++;
  }
  return migrated;
}

export function getOrCreateTemplate(projectId: string): ExtractionFieldDef[] {
  const existing = getTemplate(projectId);
  if (existing && existing.length > 0) return existing;
  const proto = getProtocol(projectId);
  const fields = defaultTemplate(proto?.outcomes ?? []);
  saveTemplate(projectId, fields);
  return fields;
}

/** AI 建议字段表（不落库，供确认） */
export async function proposeTemplate(projectId: string): Promise<ExtractionFieldDef[]> {
  const proto = getProtocol(projectId);
  if (!proto) throw new Error('请先制定协议（至少填写结局指标）');
  const draft = await proposeExtractionTemplate({
    outcomes: proto.outcomes,
    studyDesign: proto.pico.studyDesign,
  });
  return draft.fields;
}

export function getExtraction(referenceId: string): ExtractionResult | null {
  const ex = db
    .select()
    .from(extractions)
    .where(eq(extractions.referenceId, referenceId))
    .get();
  if (!ex) return null;
  const payload = JSON.parse(ex.fields) as { values?: Record<string, string> };
  const figRows = db
    .select()
    .from(figures)
    .where(eq(figures.referenceId, referenceId))
    .orderBy(asc(figures.index))
    .all();
  return {
    referenceId,
    values: payload.values ?? {},
    figures: figRows.map((f) => ({
      id: f.id,
      index: f.index,
      caption: f.caption ?? undefined,
      location: f.location ?? undefined,
      status: f.status,
      extractedValueNote: f.extractedValueNote ?? undefined,
    })),
    completedAt: ex.completedAt ?? undefined,
  };
}

/** 执行 AI 数据提取：按字段表模板填值 */
export async function runExtraction(referenceId: string): Promise<ExtractionResult> {
  const ref = db
    .select()
    .from(references)
    .where(eq(references.id, referenceId))
    .get();
  if (!ref) throw new Error('文献不存在');
  const { markdown } = readMarkdown(referenceId);
  const fields = getOrCreateTemplate(ref.projectId);
  const doc = db
    .select()
    .from(documents)
    .where(eq(documents.referenceId, referenceId))
    .get();
  if (!doc) throw new Error('缺少全文文档记录');

  const draft = await extractData({ fields, markdown });

  const now = new Date().toISOString();
  const payload = JSON.stringify({ values: draft.values });

  // 提取结果、图表、状态推进在一个事务里落库，避免中途失败留下半截数据
  inTransaction((tx) => {
    const existing = tx
      .select()
      .from(extractions)
      .where(eq(extractions.referenceId, referenceId))
      .get();
    if (existing) {
      tx.update(extractions)
        .set({ fields: payload, completedAt: now, updatedAt: now })
        .where(eq(extractions.id, existing.id))
        .run();
    } else {
      tx.insert(extractions)
        .values({
          id: randomUUID(),
          referenceId,
          fields: payload,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    tx.delete(figures).where(eq(figures.referenceId, referenceId)).run();
    for (const f of draft.figures) {
      tx.insert(figures)
        .values({
          id: randomUUID(),
          referenceId,
          documentId: doc.id,
          index: f.index,
          caption: f.caption ?? null,
          location: `第 ${f.index} 幅图`,
          status: f.needsExtraction ? 'pending' : 'skipped',
          extractedValueNote: null,
        })
        .run();
    }

    setReferenceStatusTx(tx, referenceId, 'extracted');
  });

  return getExtraction(referenceId)!;
}

export function updateFigure(
  id: string,
  input: { status?: string; extractedValueNote?: string },
): void {
  db.update(figures)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.extractedValueNote !== undefined
        ? { extractedValueNote: input.extractedValueNote }
        : {}),
    })
    .where(eq(figures.id, id))
    .run();
}

/** 结果汇总：所有已提取的文献 + 字段表 */
export function listExtractions(projectId: string): ResultsRow[] {
  const refs = db
    .select()
    .from(references)
    .where(eq(references.projectId, projectId))
    .orderBy(desc(references.createdAt))
    .all();
  const refIds = refs.map((r) => r.id);
  const exRows = refIds.length
    ? db.select().from(extractions).where(inArray(extractions.referenceId, refIds)).all()
    : [];
  const figRows = refIds.length
    ? db.select().from(figures).where(inArray(figures.referenceId, refIds)).all()
    : [];

  const exByRef = new Map(exRows.map((e) => [e.referenceId, e]));
  const figsByRef = new Map<string, typeof figRows>();
  for (const f of figRows) {
    const arr = figsByRef.get(f.referenceId) ?? [];
    arr.push(f);
    figsByRef.set(f.referenceId, arr);
  }

  return refs
    .filter((r) => exByRef.has(r.id))
    .map((r) => {
      const e = exByRef.get(r.id)!;
      const payload = JSON.parse(e.fields) as { values?: Record<string, string> };
      const figs = (figsByRef.get(r.id) ?? [])
        .sort((a, b) => a.index - b.index)
        .map((f) => ({
          id: f.id,
          index: f.index,
          caption: f.caption ?? undefined,
          location: f.location ?? undefined,
          status: f.status,
          extractedValueNote: f.extractedValueNote ?? undefined,
        }));
      return {
        referenceId: r.id,
        title: r.title,
        year: r.year ?? undefined,
        journal: r.journal ?? undefined,
        values: payload.values ?? {},
        figures: figs,
      };
    });
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** 导出 CSV（列 = 字段表，带 BOM） */
export function exportResultsCSV(projectId: string): string {
  const rows = listExtractions(projectId);
  const fields = getTemplate(projectId) ?? [];
  const header = ['标题', '年份', ...fields.map((f) => f.label), '图表(待人工提取)'];
  const lines: string[] = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    const figText = r.figures
      .filter((f) => f.status === 'pending')
      .map((f) => `图${f.index}${f.caption ? ' ' + f.caption : ''}`)
      .join(' | ');
    const cells = [
      r.title,
      r.year?.toString() ?? '',
      ...fields.map((f) => r.values[f.key] ?? ''),
      figText,
    ];
    lines.push(cells.map(csvEscape).join(','));
  }
  return '\uFEFF' + lines.join('\n');
}
