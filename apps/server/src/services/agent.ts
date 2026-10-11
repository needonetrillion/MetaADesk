import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { agentConversations } from '../db/schema';
import { generateProtocolDraft, generateSearchQuery } from './ai';
import { listExtractions, proposeTemplate, getTemplate } from './extraction';
import { listExclusionReasons } from './exclusionReasons';
import { getActiveLLM } from './llm';
import { getProtocol } from './protocol';
import { countScreening, listFulltext } from './references';
import { SEARCH_SKILLS } from './searchSkills';
import { listProjectSources, selectStrategyTargets, ensureProjectSource, PRESET_DATABASES } from './sources';
import { sourceStats } from './stats';
import { listStrategies } from './strategies';
import { buildResourceIndex, resourceContext, selectResourcesPrompt } from './agentResources';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 读取某项目的对话历史（跨刷新持久化） */
export function getConversation(projectId: string): AgentMessage[] {
  const row = db
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.projectId, projectId))
    .get();
  if (!row) return [];
  try {
    return JSON.parse(row.messages) as AgentMessage[];
  } catch {
    return [];
  }
}

/** 保存某项目的对话历史 */
export function saveConversation(projectId: string, messages: AgentMessage[]): void {
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.projectId, projectId))
    .get();
  const data = JSON.stringify(messages);
  if (existing) {
    db.update(agentConversations)
      .set({ messages: data, updatedAt: now })
      .where(eq(agentConversations.id, existing.id))
      .run();
  } else {
    db.insert(agentConversations)
      .values({ id: randomUUID(), projectId, messages: data, updatedAt: now })
      .run();
  }
}

export interface AgentProposal {
  kind: 'protocol' | 'search_query' | 'search_strategy' | 'screening_prompt' | 'extraction_table';
  title: string;
  payload: Record<string, unknown>;
}

const actionSchema = z.object({
  reply: z.string(),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('none') }),
    z.object({ type: z.literal('propose_protocol'), researchQuestion: z.string() }),
    z.object({ type: z.literal('propose_search_query'), databaseName: z.string().min(1) }),
    z.object({
      type: z.literal('propose_search_strategy'),
      databaseNames: z.array(z.string().min(1)),
    }),
    z.object({ type: z.literal('propose_screening_prompt'), prompt: z.string().min(1) }),
    z.object({ type: z.literal('propose_extraction_table') }),
  ]),
});

export function buildContext(projectId: string): string {
  const proto = getProtocol(projectId);
  const strategies = listStrategies(projectId);
  const screeningCounts = countScreening(projectId);
  const fulltext = listFulltext(projectId);
  const extractions = listExtractions(projectId);
  const dbs = listProjectSources(projectId);
  const stats = sourceStats(projectId);
  const template = getTemplate(projectId) ?? [];
  const reasons = listExclusionReasons(projectId);

  const screeningTotal = screeningCounts.total;
  const pending = screeningCounts.pending;
  const tasIncluded = screeningCounts.included;
  const tasExcluded = screeningCounts.excluded;
  const ftIncluded = fulltext.filter((f) => f.status === 'ft_included').length;
  const extracted = extractions.length;

  const lines: string[] = [];
  lines.push('【当前项目状态】');
  if (proto) {
    lines.push(`- 协议标题：${proto.title || '（未填写）'}`);
    lines.push(
      `- PICO：P=${proto.pico.population || '—'} / I=${proto.pico.intervention || '—'} / C=${proto.pico.comparison || '—'} / O=${proto.pico.outcome || '—'}`,
    );
    const inc = proto.criteria.filter((c) => c.type === 'inclusion').map((c) => c.text);
    const exc = proto.criteria.filter((c) => c.type === 'exclusion').map((c) => c.text);
    lines.push(`- 纳入标准：${inc.length ? inc.join('；') : '（未填写）'}`);
    lines.push(`- 排除标准：${exc.length ? exc.join('；') : '（未填写）'}`);
    lines.push(`- 结局指标：${proto.outcomes.length ? proto.outcomes.join('；') : '（未填写）'}`);
  } else {
    lines.push('- 尚未制定协议');
  }

  lines.push('');
  lines.push('【检索式（全文）】');
  if (strategies.length) {
    for (const s of strategies) {
      lines.push(`- ${s.databaseName}：${s.query}${s.notes ? `（备注：${s.notes}）` : ''}`);
    }
  } else {
    lines.push('- 尚无检索式');
  }

  lines.push('');
  lines.push('【数据提取表字段】');
  if (template.length) {
    for (const f of template) {
      lines.push(`- ${f.key}（${f.label}）${f.description ? `：${f.description}` : ''}`);
    }
  } else {
    lines.push('- 尚未定义');
  }

  lines.push('');
  lines.push('【各来源库文献条目】');
  if (stats.length) {
    for (const s of stats) {
      lines.push(
        `- ${s.name}：原始命中 ${s.rawImported} · 唯一贡献 ${s.uniqueKept} · 重复剔除 ${s.duplicateRemoved}`,
      );
    }
  } else {
    lines.push('- 尚无来源库');
  }

  lines.push('');
  lines.push('【排除理由列表】');
  lines.push(reasons.length ? reasons.map((r) => r.label).join('、') : '- 尚未配置');

  lines.push('');
  lines.push(
    `- 初筛：共 ${screeningTotal} 篇（待筛 ${pending}，纳入 ${tasIncluded}，排除 ${tasExcluded}）` +
      (screeningCounts.duplicates ? `，另有去重剔除 ${screeningCounts.duplicates} 篇` : ''),
  );
  lines.push(`- 全文：纳入 ${ftIncluded} 篇；已提取 ${extracted} 篇`);

  // 下一步建议（引导用）
  let next = '流程推进中';
  if (!proto) next = '尚未制定协议，建议先完成「① 协议制定」的 PICO 与纳入排除标准';
  else if (strategies.length === 0) next = '协议已就绪，建议设计检索策略（可让我帮你）';
  else if (screeningTotal === 0) next = '检索式已就绪，建议到各库检索并把题录导入「③ 初筛」';
  else if (pending > 0) next = `初筛还有 ${pending} 篇待判定，建议继续「③ 初筛」`;
  else if (tasIncluded > 0 && ftIncluded === 0) next = '初筛已纳入文献，建议进入「④ 全文」上传并判定';
  else if (ftIncluded > 0 && extracted === 0) next = `有 ${ftIncluded} 篇全文纳入，建议进入「⑤ 提取」生成提取表并逐篇提取`;
  else if (extracted > 0) next = `已提取 ${extracted} 篇，可进入「⑥ 结果」查看与导出`;
  lines.push(`- 下一步建议：${next}`);

  lines.push('');
  lines.push('【可用数据库（用于生成检索式）】');
  for (const d of dbs) lines.push(`- ${d.id}：${d.name}`);
  lines.push('');
  lines.push('【已加载的检索式 skills（各库语法要点，生成时会自动套用）】');
  for (const s of SEARCH_SKILLS) {
    lines.push(`- ${s.name}：${s.orWithinField}`);
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = [
  '你是本 Meta 分析系统的全局智能助手，能“感知”当前项目的全部内容，并与研究者持续对话。',
  '你的职责：了解研究者真实目的，给出合理建议，并在需要时替研究者“设计检索策略、设计数据提取表、起草协议”。',
  '',
  '【铁律】你只能通过 action 字段真正“执行”生成任务；绝对禁止只在 reply 里用文字声称“已生成/已写入”，否则任务不会真正执行。生成类请求必须产出对应的 action。',
  '',
  'action 选择规则：',
  '1) 起草/生成协议（研究问题→PICO、纳入排除标准）→ propose_protocol，researchQuestion 填研究问题。',
  '2) 为「某一个数据库」生成检索式 → propose_search_query，databaseName 填数据库名称（如 PubMed）。',
  '3) 要求「设计整体检索策略」或「为多个数据库生成检索式」→ propose_search_strategy，databaseNames 填数据库名称数组。系统会自动把这些库加入当前项目。',
  '4) 设计/生成数据提取表（字段表）→ propose_extraction_table。',
  '5) 生成/设置初筛系统提示词 → propose_screening_prompt，prompt 填完整提示词文本。',
  '6) 其余（提问、解释、闲聊）→ none，用 reply 直接回答。',
  '7) reply 用简体中文，简洁专业；生成任务时 reply 简要说明将产出什么方案，等研究者确认。',
].join('\n');

const resourceSelectSchema = z.object({ load: z.array(z.string()) });

export async function agentChat(
  projectId: string,
  messages: AgentMessage[],
  signal?: AbortSignal,
): Promise<{ reply: string; proposals: AgentProposal[] }> {
  const client = getActiveLLM();
  const context = buildContext(projectId);

  // 两段式按需加载：先让 LLM 选出要加载的技能/知识，再注入完整内容
  let resourceCtx = '';
  const index = buildResourceIndex();
  if (index.length > 0) {
    const query =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    try {
      const selected = await client.completeJSON(
        [{ role: 'user', content: selectResourcesPrompt(index, query) }],
        resourceSelectSchema,
        { signal },
      );
      resourceCtx = resourceContext(selected.load, query);
    } catch {
      // 资源选择失败不影响主对话，降级为不加载任何资源
      resourceCtx = '';
    }
  }

  const systemContent = [SYSTEM_PROMPT, resourceCtx, context].filter(Boolean).join('\n\n');

  const out = await client.completeJSON(
    [
      { role: 'system', content: systemContent },
      ...messages,
    ],
    actionSchema,
    { signal },
  );

  const proposals: AgentProposal[] = [];
  if (out.action.type === 'propose_protocol') {
    const draft = await generateProtocolDraft(out.action.researchQuestion);
    proposals.push({
      kind: 'protocol',
      title: '协议草案（待确认）',
      payload: draft as unknown as Record<string, unknown>,
    });
  } else if (out.action.type === 'propose_search_query') {
    const proto = getProtocol(projectId);
    const databaseName = out.action.databaseName;
    const preset = PRESET_DATABASES.find(
      (p) => p.name.toLowerCase() === databaseName.toLowerCase(),
    );
    const source = ensureProjectSource(projectId, {
      name: databaseName,
      presetKey: preset?.presetKey,
      url: preset?.url,
      note: preset?.note,
    });
    if (proto) {
      const q = await generateSearchQuery({
        databaseId: source.id,
        databaseName: source.name,
        pico: proto.pico,
      });
      proposals.push({
        kind: 'search_query',
        title: `检索式 · ${source.name}（待确认）`,
        payload: {
          databaseId: source.id,
          databaseName: source.name,
          query: q.query,
          notes: q.notes ?? '',
        },
      });
    }
  } else if (out.action.type === 'propose_search_strategy') {
    try {
      const p = await buildSearchStrategyProposal(
        projectId,
        undefined,
        out.action.databaseNames,
      );
      if (p) proposals.push(p);
    } catch (err) {
      if (err instanceof Error) {
        return { reply: err.message, proposals: [] };
      }
      throw err;
    }
  } else if (out.action.type === 'propose_screening_prompt') {
    proposals.push({
      kind: 'screening_prompt',
      title: '初筛系统提示词（待确认）',
      payload: { prompt: out.action.prompt },
    });
  } else if (out.action.type === 'propose_extraction_table') {
    const fields = await proposeTemplate(projectId);
    proposals.push({
      kind: 'extraction_table',
      title: '数据提取表（待确认）',
      payload: { fields },
    });
  }

  return { reply: out.reply, proposals };
}

/** 生成多库检索策略方案（支持按名称自动添加来源库） */
async function buildSearchStrategyProposal(
  projectId: string,
  databaseIds?: string[],
  databaseNames?: string[],
): Promise<AgentProposal | null> {
  const proto = getProtocol(projectId);
  if (!proto) return null;

  let sourceList: Array<{ id: string; name: string }> = [];
  if (databaseNames?.length) {
    sourceList = databaseNames.map((name) => {
      const preset = PRESET_DATABASES.find((p) => p.name.toLowerCase() === name.toLowerCase());
      const s = ensureProjectSource(projectId, {
        name,
        presetKey: preset?.presetKey,
        url: preset?.url,
        note: preset?.note,
      });
      return { id: s.id, name: s.name };
    });
  } else if (databaseIds?.length) {
    sourceList = listProjectSources(projectId)
      .filter((s) => databaseIds.includes(s.id))
      .map((s) => ({ id: s.id, name: s.name }));
  } else {
    sourceList = selectStrategyTargets(projectId).map((s) => ({ id: s.id, name: s.name }));
    if (sourceList.length === 0) {
      const existing = listProjectSources(projectId);
      if (existing.length === 0) {
        // 项目还没有来源库：自动加入默认预设库
        sourceList = PRESET_DATABASES.map((p) => {
          const s = ensureProjectSource(projectId, p);
          return { id: s.id, name: s.name };
        });
      } else {
        throw new Error('当前所有来源库都已有检索式，无需重复生成');
      }
    }
  }

  const queries: Array<{
    databaseId: string;
    databaseName: string;
    query: string;
    notes: string;
  }> = [];
  for (const source of sourceList) {
    const q = await generateSearchQuery({
      databaseId: source.id,
      databaseName: source.name,
      pico: proto.pico,
    });
    queries.push({
      databaseId: source.id,
      databaseName: source.name,
      query: q.query,
      notes: q.notes ?? '',
    });
  }
  if (!queries.length) return null;
  return {
    kind: 'search_strategy',
    title: `检索策略（${queries.length} 库，待确认）`,
    payload: { queries },
  };
}

/** 一键直达：不依赖 LLM 意图路由，直接产出方案（供前端快捷按钮调用） */
export async function quickAction(
  projectId: string,
  type: 'search_strategy' | 'extraction_table',
): Promise<AgentProposal[]> {
  if (type === 'search_strategy') {
    const p = await buildSearchStrategyProposal(projectId);
    return p ? [p] : [];
  }
  const fields = await proposeTemplate(projectId);
  return [
    { kind: 'extraction_table', title: '数据提取表（待确认）', payload: { fields } },
  ];
}
