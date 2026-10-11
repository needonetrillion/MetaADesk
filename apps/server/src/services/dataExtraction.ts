import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import {
  pairedEntries,
  rawExtractions,
  references,
  treatmentClassifications,
} from '../db/schema';
import { extractRawData, suggestPairing } from './ai';
import { readMarkdown } from './documents';
import { getAiSettings } from './aiSettings';
import { getFieldSettings } from './extractionFieldSettings';
import { getProtocol } from './protocol';
import { setReferenceStatus } from './transitions';

/** 组级：一个处理组 = 一组字段值（字段 key 由字段设置定义，name/isControl 为保留 key） */
export interface RawArm {
  id: string;
  values: Record<string, string>;
}

/** 结局级：每组每个结局 = 结局名（来自协议） + 一组数值字段 */
export interface RawOutcome {
  id: string;
  armId: string;
  outcome: string;
  values: Record<string, string>;
}

export interface RawExtraction {
  study: Record<string, string>;
  arms: RawArm[];
  outcomes: RawOutcome[];
}

export interface TreatmentGroup {
  name: string;
  type: 'experiment' | 'control' | 'other';
}

export interface Pairing {
  treatment: string;
  control: string;
}

export interface TreatmentClassification {
  groups: TreatmentGroup[];
  pairings: Pairing[];
}

export interface PairedEntry {
  id: string;
  treatment: string;
  control: string;
  outcome: string;
  treatmentN?: string;
  controlN?: string;
  treatmentMean?: string;
  controlMean?: string;
  treatmentSd?: string;
  controlSd?: string;
  unit?: string;
  timePoint?: string;
  sharedControl: boolean;
}

type JsonTable = typeof rawExtractions | typeof treatmentClassifications | typeof pairedEntries;

function upsertJson(table: JsonTable, referenceId: string, data: unknown): void {
  const now = new Date().toISOString();
  const existing = db.select().from(table).where(eq(table.referenceId, referenceId)).get();
  const payload = JSON.stringify(data);
  if (existing) {
    db.update(table).set({ data: payload, updatedAt: now }).where(eq(table.id, existing.id)).run();
  } else {
    db.insert(table)
      .values({ id: randomUUID(), referenceId, data: payload, createdAt: now, updatedAt: now })
      .run();
  }
}

function readJson<T>(table: JsonTable, referenceId: string): T | null {
  const row = db.select().from(table).where(eq(table.referenceId, referenceId)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.data) as T;
  } catch {
    return null;
  }
}

function validateRaw(data: RawExtraction): void {
  if (!Array.isArray(data.arms)) throw new Error('arms 必须是数组');
  if (!Array.isArray(data.outcomes)) throw new Error('outcomes 必须是数组');
  const armIds = new Set(data.arms.map((a) => a.id));
  for (const o of data.outcomes) {
    if (!armIds.has(o.armId)) throw new Error(`结局引用了不存在的处理组：${o.armId}`);
  }
}

export function getRawExtraction(referenceId: string): RawExtraction | null {
  return readJson<RawExtraction>(rawExtractions, referenceId);
}

export function saveRawExtraction(referenceId: string, data: RawExtraction): RawExtraction {
  validateRaw(data);
  upsertJson(rawExtractions, referenceId, data);
  return data;
}

export async function runRawExtraction(referenceId: string): Promise<RawExtraction> {
  const ref = db.select().from(references).where(eq(references.id, referenceId)).get();
  if (!ref) throw new Error('文献不存在');
  const { markdown } = readMarkdown(referenceId);
  const proto = getProtocol(ref.projectId);
  const settings = getAiSettings(ref.projectId);
  const fieldSettings = getFieldSettings(ref.projectId);

  const draft = await extractRawData({
    markdown,
    outcomes: proto?.outcomes ?? [],
    systemPrompt: settings?.extractionSystemPrompt ?? undefined,
    fieldSettings,
  });

  const arms: RawArm[] = draft.arms.map((values, i) => ({ id: `arm_${i + 1}`, values }));
  const outcomes: RawOutcome[] = (draft.outcomes ?? [])
    .filter((o) => Number.isInteger(o.armIndex) && o.armIndex >= 0 && o.armIndex < arms.length)
    .map((o, i) => ({ id: `outcome_${i + 1}`, armId: arms[o.armIndex]!.id, outcome: o.outcome, values: o.values }));

  const data = saveRawExtraction(referenceId, { study: draft.study, arms, outcomes });
  setReferenceStatus(referenceId, 'extracted');
  return data;
}

function armName(arm: RawArm): string {
  return arm.values?.['name'] ?? arm.values?.['处理名称'] ?? arm.id;
}

function validateClassification(data: TreatmentClassification, raw: RawExtraction): void {
  const names = new Set(raw.arms.map(armName));
  for (const g of data.groups) {
    if (!names.has(g.name)) throw new Error(`分类引用了不存在的处理组：${g.name}`);
  }
  const typeByName = new Map(data.groups.map((g) => [g.name, g.type]));
  for (const p of data.pairings) {
    if (!names.has(p.treatment) || !names.has(p.control)) throw new Error('配对引用了不存在的处理组');
    if (typeByName.get(p.treatment) !== 'experiment') throw new Error(`配对中 ${p.treatment} 不是实验组`);
    if (typeByName.get(p.control) !== 'control') throw new Error(`配对中 ${p.control} 不是对照组`);
  }
}

export function getClassification(referenceId: string): TreatmentClassification | null {
  return readJson<TreatmentClassification>(treatmentClassifications, referenceId);
}

export function saveClassification(referenceId: string, data: TreatmentClassification): TreatmentClassification {
  const raw = getRawExtraction(referenceId);
  if (!raw) throw new Error('请先完成原始提取');
  validateClassification(data, raw);
  upsertJson(treatmentClassifications, referenceId, data);
  return data;
}

export async function suggestClassification(referenceId: string): Promise<TreatmentClassification> {
  const raw = getRawExtraction(referenceId);
  if (!raw) throw new Error('请先完成原始提取');
  const ref = db.select().from(references).where(eq(references.id, referenceId)).get();
  const proto = getProtocol(ref!.projectId);
  const settings = getAiSettings(ref!.projectId);
  return suggestPairing({
    arms: raw.arms.map((a) => ({ name: armName(a), groupType: (a.values?.['isControl'] === '否' ? 'experiment' : a.values?.['isControl'] === '是' ? 'control' : 'other') as 'experiment' | 'control' | 'other' })),
    pico: proto?.pico,
    systemPrompt: settings?.extractionSystemPrompt ?? undefined,
  });
}

export function generatePairedEntries(referenceId: string): PairedEntry[] {
  const raw = getRawExtraction(referenceId);
  const cls = getClassification(referenceId);
  if (!raw || !cls) return [];
  const armById = new Map(raw.arms.map((a) => [a.id, a]));
  const outcomeByArm = new Map<string, RawOutcome[]>();
  for (const o of raw.outcomes) {
    const arr = outcomeByArm.get(o.armId) ?? [];
    arr.push(o);
    outcomeByArm.set(o.armId, arr);
  }
  const controlCount = new Map<string, number>();
  for (const p of cls.pairings) controlCount.set(p.control, (controlCount.get(p.control) ?? 0) + 1);

  const entries: PairedEntry[] = [];
  for (const p of cls.pairings) {
    const treatArm = raw.arms.find((a) => armName(a) === p.treatment);
    const controlArm = raw.arms.find((a) => armName(a) === p.control);
    if (!treatArm || !controlArm) continue;
    const treatOutcomes = outcomeByArm.get(treatArm.id) ?? [];
    const controlOutcomes = outcomeByArm.get(controlArm.id) ?? [];
    for (const to of treatOutcomes) {
      const toName = to.outcome;
      const co = controlOutcomes.find((x) => x.outcome === toName);
      entries.push({
        id: randomUUID(),
        treatment: p.treatment,
        control: p.control,
        outcome: toName,
        treatmentN: to.values?.['n'],
        controlN: co?.values?.['n'],
        treatmentMean: to.values?.['mean'],
        controlMean: co?.values?.['mean'],
        treatmentSd: to.values?.['sd'] ?? to.values?.['se'],
        controlSd: co?.values?.['sd'] ?? co?.values?.['se'],
        unit: to.values?.['unit'],
        timePoint: to.values?.['timePoint'],
        sharedControl: (controlCount.get(p.control) ?? 0) > 1,
      });
    }
  }
  return entries;
}

export function getPairedEntries(referenceId: string): PairedEntry[] {
  return readJson<{ entries: PairedEntry[] }>(pairedEntries, referenceId)?.entries ?? [];
}

/** 清空某篇文献的提取数据，并把状态从「已提取」退回「全文纳入」 */
export function clearExtraction(referenceId: string): { ok: boolean } {
  db.delete(rawExtractions).where(eq(rawExtractions.referenceId, referenceId)).run();
  db.delete(treatmentClassifications).where(eq(treatmentClassifications.referenceId, referenceId)).run();
  db.delete(pairedEntries).where(eq(pairedEntries.referenceId, referenceId)).run();
  setReferenceStatus(referenceId, 'ft_included');
  return { ok: true };
}

export function savePairedEntries(referenceId: string, entries: PairedEntry[]): void {
  upsertJson(pairedEntries, referenceId, { entries });
}

export function listPairedEntries(projectId: string): Array<{ referenceId: string; title: string; entries: PairedEntry[] }> {
  const refs = db.select().from(references).where(eq(references.projectId, projectId)).all();
  const result: Array<{ referenceId: string; title: string; entries: PairedEntry[] }> = [];
  for (const r of refs) {
    const entries = getPairedEntries(r.id);
    if (entries.length) result.push({ referenceId: r.id, title: r.title, entries });
  }
  return result;
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function exportPairedCSV(projectId: string): string {
  const rows = listPairedEntries(projectId);
  const header = ['文献', '实验组', '对照组', '结局', '实验组N', '对照组N', '实验组均值', '对照组均值', '实验组SD/SE', '对照组SD/SE', '单位', '时间点', '共享对照组'];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    for (const e of r.entries) {
      lines.push([
        r.title, e.treatment, e.control, e.outcome, e.treatmentN ?? '', e.controlN ?? '',
        e.treatmentMean ?? '', e.controlMean ?? '', e.treatmentSd ?? '', e.controlSd ?? '',
        e.unit ?? '', e.timePoint ?? '', e.sharedControl ? '是' : '否',
      ].map(csvEscape).join(','));
    }
  }
  return '\uFEFF' + lines.join('\n');
}
