import { listSkills } from './agentSkills';
import {
  getChunksByKnowledgeIds,
  listKnowledge,
  retrieveChunks,
} from './agentKnowledge';

export interface ResourceIndexItem {
  id: string;
  type: 'skill' | 'knowledge';
  name: string;
  description: string;
}

/** 全局技能 + 知识文档的索引清单（只含名称与描述，供按需选择） */
export function buildResourceIndex(): ResourceIndexItem[] {
  const skills = listSkills().map((s) => ({
    id: s.id,
    type: 'skill' as const,
    name: s.name,
    description: s.description,
  }));
  const knowledge = listKnowledge().map((k) => ({
    id: k.id,
    type: 'knowledge' as const,
    name: k.name,
    description: k.description,
  }));
  return [...skills, ...knowledge];
}

/** Pass1 的提示词：让 LLM 只输出需要加载的资源 id 列表 */
export function selectResourcesPrompt(index: ResourceIndexItem[], query: string): string {
  const lines = index
    .map((r) => `- id=${r.id} [${r.type}] ${r.name}：${r.description}`)
    .join('\n');
  return [
    '你是资源选择器。根据用户的问题，从下面的技能/知识索引中，选出真正需要加载的资源（id 列表）。',
    '没有相关资源就返回空数组。',
    '',
    '用户问题：' + query,
    '',
    '资源索引：',
    lines || '（无）',
    '',
    '请只输出 JSON：{"load":["<id>", ...]}',
  ].join('\n');
}

/** Pass2 的内容：选中技能的完整正文 + 选中知识的最相关块 */
export function resourceContext(ids: string[], query: string, k = 4): string {
  const skills = listSkills();
  const knowledgeList = listKnowledge();
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const knowledgeById = new Map(knowledgeList.map((x) => [x.id, x]));

  const parts: string[] = [];
  const skillIds = ids.filter((id) => skillById.has(id));
  const knowledgeIds = ids.filter((id) => knowledgeById.has(id));

  for (const id of skillIds) {
    const s = skillById.get(id)!;
    parts.push(`【技能】${s.name}\n${s.content}`);
  }

  if (knowledgeIds.length) {
    const chunks = getChunksByKnowledgeIds(knowledgeIds);
    for (const c of retrieveChunks(query, chunks, k)) {
      const name = knowledgeById.get(c.knowledgeId)?.name ?? '';
      parts.push(`【知识·${name}】\n${c.text}`);
    }
  }

  return parts.join('\n\n');
}
