import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Criterion, PICO, Protocol } from '@meta/core';
import { db } from '../db/client';
import { protocols } from '../db/schema';

export interface ProtocolInput {
  title: string;
  objective: string;
  pico: PICO;
  criteria: Criterion[];
  outcomes: string[];
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function getProtocol(projectId: string): Protocol | null {
  const row = db
    .select()
    .from(protocols)
    .where(eq(protocols.projectId, projectId))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    objective: row.objective,
    pico: parseJson<PICO>(row.pico, {
      population: '',
      intervention: '',
      comparison: '',
      outcome: '',
    }),
    criteria: parseJson<Criterion[]>(row.criteria, []),
    outcomes: parseJson<string[]>(row.outcomes, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function saveProtocol(
  projectId: string,
  input: ProtocolInput,
): Protocol {
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(protocols)
    .where(eq(protocols.projectId, projectId))
    .get();

  const values = {
    title: input.title,
    objective: input.objective,
    pico: JSON.stringify(input.pico),
    criteria: JSON.stringify(input.criteria),
    outcomes: JSON.stringify(input.outcomes),
    updatedAt: now,
  };

  if (existing) {
    db.update(protocols).set(values).where(eq(protocols.id, existing.id)).run();
  } else {
    db.insert(protocols)
      .values({ id: randomUUID(), projectId, ...values, createdAt: now })
      .run();
  }
  return getProtocol(projectId)!;
}

/** 生成可注册用的协议文本（PROSPERO 风格草稿） */
export function formatProtocolText(p: Protocol): string {
  const lines: string[] = [];
  lines.push(`# ${p.title}`, '');
  lines.push('## 研究目的');
  lines.push(p.objective || '（未填写）', '');
  lines.push('## PICO 要素');
  lines.push(`- 研究对象 (P)：${p.pico.population || '（未填写）'}`);
  lines.push(`- 干预措施 (I)：${p.pico.intervention || '（未填写）'}`);
  lines.push(`- 对照 (C)：${p.pico.comparison || '（未填写）'}`);
  lines.push(`- 结局指标 (O)：${p.pico.outcome || '（未填写）'}`);
  if (p.pico.studyDesign) lines.push(`- 研究设计：${p.pico.studyDesign}`);
  lines.push('');
  lines.push('## 纳入标准');
  const inclusions = p.criteria.filter((c) => c.type === 'inclusion');
  if (inclusions.length === 0) lines.push('- （未填写）');
  else for (const c of inclusions) lines.push(`- ${c.text}`);
  lines.push('');
  lines.push('## 排除标准');
  const exclusions = p.criteria.filter((c) => c.type === 'exclusion');
  if (exclusions.length === 0) lines.push('- （未填写）');
  else for (const c of exclusions) lines.push(`- ${c.text}`);
  lines.push('');
  lines.push('## 结局指标');
  if (p.outcomes.length === 0) lines.push('- （未填写）');
  else for (const o of p.outcomes) lines.push(`- ${o}`);
  return lines.join('\n');
}
