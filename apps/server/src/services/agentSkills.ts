import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { agentSkills } from '../db/schema';

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillInput {
  name: string;
  description: string;
  content: string;
}

function normalize(input: SkillInput): SkillInput {
  const name = input.name.trim();
  if (!name) throw new Error('技能名不能为空');
  const description = input.description.trim();
  if (!description) throw new Error('技能描述不能为空');
  return {
    name,
    description,
    content: input.content.trim(),
  };
}

export function listSkills(): AgentSkill[] {
  return db.select().from(agentSkills).orderBy(desc(agentSkills.updatedAt)).all();
}

export function createSkill(input: SkillInput): AgentSkill {
  const n = normalize(input);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    name: n.name,
    description: n.description,
    content: n.content,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(agentSkills).values(row).run();
  return row;
}

export function updateSkill(id: string, input: SkillInput): AgentSkill {
  const n = normalize(input);
  const existing = db.select().from(agentSkills).where(eq(agentSkills.id, id)).get();
  if (!existing) throw new Error('技能不存在');
  const updatedAt = new Date().toISOString();
  db.update(agentSkills)
    .set({ name: n.name, description: n.description, content: n.content, updatedAt })
    .where(eq(agentSkills.id, id))
    .run();
  return { ...existing, ...n, updatedAt };
}

export function deleteSkill(id: string): void {
  db.delete(agentSkills).where(eq(agentSkills.id, id)).run();
}
