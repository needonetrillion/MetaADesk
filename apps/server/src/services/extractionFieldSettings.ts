import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { extractionFieldSettings } from '../db/schema';
import { getProtocol } from './protocol';

export interface FieldDef {
  key: string;
  label: string;
  description?: string;
}

export interface FieldSection {
  id: string;
  name: string;
  level: 'study' | 'arm' | 'outcome';
  appliesTo?: 'all' | 'experiment' | 'control';
  repeatPerOutcome?: boolean;
  /** outcome 级：该段重复提取的目标结局列表（来自协议） */
  outcomes?: string[];
  fields: FieldDef[];
}

export interface FieldSettings {
  sections: FieldSection[];
}

function field(key: string, label: string, description?: string): FieldDef {
  return description ? { key, label, description } : { key, label };
}

export function defaultFieldSettings(): FieldSettings {
  return {
    sections: [
      {
        id: 'paper',
        name: '论文相关',
        level: 'study',
        fields: [
          field('title', '标题'),
          field('firstAuthor', '第一作者'),
          field('year', '发表年份'),
          field('studyType', '文献类型'),
        ],
      },
      {
        id: 'background',
        name: '背景信息',
        level: 'arm',
        appliesTo: 'all',
        fields: [
          field('location', '实验地点'),
          field('name', '处理名称'),
          field('isControl', '是否对照组', '是/否'),
        ],
      },
      {
        id: 'outcome',
        name: '实验结局相关',
        level: 'outcome',
        repeatPerOutcome: true,
        outcomes: [],
        fields: [
          field('mean', 'mean'),
          field('sd', 'SD'),
          field('se', 'SE'),
          field('n', 'n重复次数'),
        ],
      },
    ],
  };
}

export function getFieldSettings(projectId: string): FieldSettings {
  const row = db
    .select()
    .from(extractionFieldSettings)
    .where(eq(extractionFieldSettings.projectId, projectId))
    .get();
  if (!row) return defaultFieldSettings();
  try {
    const parsed = JSON.parse(row.data) as Partial<FieldSettings>;
    return { sections: Array.isArray(parsed.sections) ? parsed.sections : defaultFieldSettings().sections };
  } catch {
    return defaultFieldSettings();
  }
}

export function saveFieldSettings(projectId: string, data: FieldSettings): FieldSettings {
  const now = new Date().toISOString();
  db.insert(extractionFieldSettings)
    .values({ projectId, data: JSON.stringify(data), updatedAt: now })
    .onConflictDoUpdate({
      target: extractionFieldSettings.projectId,
      set: { data: JSON.stringify(data), updatedAt: now },
    })
    .run();
  return data;
}

/** 根据协议生成默认字段设置（结局段列出协议的目标结局） */
export function generateFieldSettings(projectId: string): FieldSettings {
  const proto = getProtocol(projectId);
  const settings = defaultFieldSettings();
  if (proto?.outcomes.length) {
    const outcomeSection = settings.sections.find((s) => s.id === 'outcome');
    if (outcomeSection) {
      outcomeSection.outcomes = proto.outcomes;
    }
  }
  return settings;
}

export function newSectionId(): string {
  return `sec_${randomUUID().slice(0, 8)}`;
}
