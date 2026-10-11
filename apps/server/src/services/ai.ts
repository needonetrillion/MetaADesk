import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Criterion, ExtractionFieldDef } from '@meta/core';
import { getActiveLLM, getScreeningLLM } from './llm';
import { getSearchSkill } from './searchSkills';

/** AI 生成的协议草案结构 */
export const protocolDraftSchema = z.object({
  title: z.string(),
  objective: z.string(),
  pico: z.object({
    population: z.string(),
    intervention: z.string(),
    comparison: z.string(),
    outcome: z.string(),
    studyDesign: z.string().optional(),
  }),
  criteria: z.array(
    z.object({
      type: z.enum(['inclusion', 'exclusion']),
      text: z.string(),
    }),
  ),
  outcomes: z.array(z.string()),
});

export interface ProtocolDraft {
  title: string;
  objective: string;
  pico: {
    population: string;
    intervention: string;
    comparison: string;
    outcome: string;
    studyDesign?: string;
  };
  criteria: Array<{ id: string; type: 'inclusion' | 'exclusion'; text: string }>;
  outcomes: string[];
}

/** 根据研究问题，用 LLM 起草协议 */
export async function generateProtocolDraft(
  researchQuestion: string,
): Promise<ProtocolDraft> {
  const client = getActiveLLM();
  const draft = await client.completeJSON(
    [
      {
        role: 'system',
        content:
          '你是一名循证医学与系统评价/Meta 分析方法学专家。请根据研究者提供的研究问题，起草一份研究方案(protocol)草稿。',
      },
      {
        role: 'user',
        content: `研究问题：${researchQuestion}\n\n请给出：1) 研究标题；2) 研究目的；3) PICO 要素（研究对象 P、干预 I、对照 C、结局 O，以及可选的研究设计）；4) 纳入标准与排除标准各若干条；5) 主要/次要结局指标列表。`,
      },
    ],
    protocolDraftSchema,
  );

  return {
    ...draft,
    criteria: draft.criteria.map((c) => ({ id: randomUUID(), ...c })),
  };
}

/** AI 生成的检索式结构 */
export const searchQuerySchema = z.object({
  query: z.string(),
  notes: z.string().optional(),
});

export interface SearchQueryResult {
  query: string;
  notes?: string;
}

/** 根据 PICO + 目标数据库，用 LLM 生成检索式（按各库 skill 规则，克制同义词） */
export async function generateSearchQuery(params: {
  databaseId?: string;
  databaseName: string;
  pico: {
    population: string;
    intervention: string;
    comparison: string;
    outcome: string;
    studyDesign?: string;
  };
}): Promise<SearchQueryResult> {
  const client = getActiveLLM();
  const skill = getSearchSkill(params.databaseId ?? '', params.databaseName);
  const skillBlock = skill
    ? [
        `字段限定写法：${skill.fieldSyntax}`,
        `布尔与截词：${skill.operators}`,
        `同一字段内同义词的 OR 写法：${skill.orWithinField}`,
        `完整示例：${skill.example}`,
        `生成注意：${skill.guidance}`,
        skill.verifyNote ? `核对提醒：${skill.verifyNote}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '按该数据库惯用的字段限定与主题词语法构建。';

  return client.completeJSON(
    [
      {
        role: 'system',
        content:
          '你是一名系统评价检索策略专家。任务是生成「可直接粘贴到该数据库检索框使用」的检索式。必须严格遵守给定数据库的字段代码与运算符语法，不得臆造字段写法。',
      },
      {
        role: 'user',
        content: [
          `目标数据库：${params.databaseName}`,
          '',
          '【该数据库检索规则（必须严格遵守）】',
          skillBlock,
          '',
          '【研究要素（PICO）】',
          `- 研究对象(P)：${params.pico.population || '（未提供）'}`,
          `- 干预(I)：${params.pico.intervention || '（未提供）'}`,
          `- 对照(C)：${params.pico.comparison || '（未提供）'}`,
          `- 结局(O)：${params.pico.outcome || '（未提供）'}`,
          params.pico.studyDesign ? `- 研究设计：${params.pico.studyDesign}` : '',
          '',
          '【克制要求】每个概念(P/I/O)只保留 3–5 个最核心同义词，不要堆砌几十个；对照(C)若为空或不重要可省略；研究设计用数据库过滤器而非塞进检索式。',
          '只输出最终检索式（query）与一句简短说明（notes）。',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    searchQuerySchema,
  );
}

/** 单篇筛选建议结构 */
export const screeningSchema = z.object({
  decision: z.enum(['include', 'exclude', 'undecided']),
  reason: z.string(),
});

export interface ScreeningSuggestion {
  decision: 'include' | 'exclude' | 'undecided';
  reason: string;
}

function criteriaText(criteria: Criterion[]): { inc: string; exc: string } {
  const inc =
    criteria
      .filter((c) => c.type === 'inclusion')
      .map((c) => `- ${c.text}`)
      .join('\n') || '- （未提供）';
  const exc =
    criteria
      .filter((c) => c.type === 'exclusion')
      .map((c) => `- ${c.text}`)
      .join('\n') || '- （未提供）';
  return { inc, exc };
}

function screeningSystemPrompt(): string {
  return '你是一名系统评价/Meta 分析的文献筛选助手。请仅凭题目与摘要，按给定纳入/排除标准判断。判断严谨保守：明确符合且无排除因素才给 include；明确违反或命中排除标准给 exclude；信息不足给 undecided。';
}

/** 单篇筛选建议 */
export async function suggestReference(
  criteria: Criterion[],
  ref: { title: string; abstract: string },
  opts?: { systemPrompt?: string; providerId?: string | null },
): Promise<ScreeningSuggestion> {
  const client = getScreeningLLM(opts?.providerId ?? null);
  const { inc, exc } = criteriaText(criteria);
  return client.completeJSON(
    [
      { role: 'system', content: opts?.systemPrompt || screeningSystemPrompt() },
      {
        role: 'user',
        content: [
          '【纳入标准】',
          inc,
          '',
          '【排除标准】',
          exc,
          '',
          `【文献题目】${ref.title}`,
          `【摘要】${ref.abstract || '（无摘要）'}`,
        ].join('\n'),
      },
    ],
    screeningSchema,
  );
}

/** 批量筛选建议（单次 LLM 调用） */
const screeningBatchSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      decision: z.enum(['include', 'exclude', 'undecided']),
      reason: z.string(),
    }),
  ),
});

export async function suggestReferencesBatch(
  criteria: Criterion[],
  refs: Array<{ title: string; abstract: string }>,
  opts?: { systemPrompt?: string; providerId?: string | null },
): Promise<ScreeningSuggestion[]> {
  const client = getScreeningLLM(opts?.providerId ?? null);
  const { inc, exc } = criteriaText(criteria);
  const listing = refs
    .map(
      (r, i) =>
        `文献 ${i + 1}：\n题目：${r.title}\n摘要：${r.abstract || '（无摘要）'}`,
    )
    .join('\n\n');

  const out = await client.completeJSON(
    [
      { role: 'system', content: opts?.systemPrompt || screeningSystemPrompt() },
      {
        role: 'user',
        content: [
          '以下是若干篇文献，请逐篇判断是否应纳入全文筛选。',
          '【纳入标准】',
          inc,
          '',
          '【排除标准】',
          exc,
          '',
          '请在 results 中为每篇返回对应 index 的结论。',
          '',
          listing,
        ].join('\n'),
      },
    ],
    screeningBatchSchema,
  );

  const byIndex = new Map(out.results.map((r) => [r.index, r]));
  return refs.map((_, i) => {
    const r = byIndex.get(i + 1);
    return {
      decision: r?.decision ?? 'undecided',
      reason: r?.reason ?? '（模型未返回该条目）',
    };
  });
}

/** 全文筛选建议：基于全文 Markdown 片段判断 */
export async function suggestFulltextExcerpt(
  criteria: Criterion[],
  fullText: string,
  opts?: { systemPrompt?: string; providerId?: string | null },
): Promise<ScreeningSuggestion> {
  const client = getScreeningLLM(opts?.providerId ?? null);
  const { inc, exc } = criteriaText(criteria);
  const excerpt = fullText.slice(0, 16000);
  return client.completeJSON(
    [
      {
        role: 'system',
        content:
          opts?.systemPrompt ||
          '你是一名系统评价/Meta 分析的全文筛选助手。请阅读提供的全文片段，结合纳入/排除标准，判断该研究是否应纳入数据提取。判断严谨保守：确凿符合且无排除因素给 include；确凿违反或命中排除标准给 exclude；信息不足给 undecided。',
      },
      {
        role: 'user',
        content: [
          '【纳入标准】',
          inc,
          '',
          '【排除标准】',
          exc,
          '',
          '【全文（Markdown 片段，可能被截断）】',
          excerpt,
        ].join('\n'),
      },
    ],
    screeningSchema,
  );
}

/** 数据提取字段表（模板）建议结构 */
export const extractionTemplateSchema = z.object({
  fields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      description: z.string().optional(),
    }),
  ),
});

export interface ExtractionTemplateDraft {
  fields: ExtractionFieldDef[];
}

/** 参考协议结局指标，建议一张数据提取字段表 */
export async function proposeExtractionTemplate(params: {
  outcomes: string[];
  studyDesign?: string;
}): Promise<ExtractionTemplateDraft> {
  const client = getActiveLLM();
  const outcomesText =
    params.outcomes.length > 0
      ? params.outcomes.map((o, i) => `${i + 1}. ${o}`).join('\n')
      : '（未指定）';
  return client.completeJSON(
    [
      {
        role: 'system',
        content:
          '你是一名 Meta 分析数据提取表设计助手。请设计一张结构化「数据提取字段表」，字段 key 用英文 snake_case，label 用中文，description 用一句话说明该字段含义。',
      },
      {
        role: 'user',
        content: [
          '请为以下研究设计数据提取字段表，包含两部分：',
          '1) 研究基本信息字段（设计类型、样本量、人群、国家、随访时长、干预/对照细节、结局测量方法等）；',
          '2) 每个结局指标对应的数据字段（效应量类型、效应值/结果、置信区间、P 值等）。',
          '',
          `【研究设计】${params.studyDesign || '未指定'}`,
          '【结局指标】',
          outcomesText,
        ].join('\n'),
      },
    ],
    extractionTemplateSchema,
  );
}

/** 数据提取结果结构：按模板字段填值 + 图表 */
export const extractionSchema = z.object({
  values: z.record(z.string(), z.string()),
  figures: z.array(
    z.object({
      index: z.number().int(),
      caption: z.string().optional(),
      needsExtraction: z.boolean(),
    }),
  ),
});

export interface ExtractionDraft {
  values: Record<string, string>;
  figures: Array<{ index: number; caption?: string; needsExtraction: boolean }>;
}

/** 按字段表模板从全文 Markdown 提取结构化数据 */
export async function extractData(params: {
  fields: ExtractionFieldDef[];
  markdown: string;
}): Promise<ExtractionDraft> {
  const client = getActiveLLM();
  const excerpt = params.markdown.slice(0, 30000);
  const fieldList = params.fields
    .map((f) => `- ${f.key}（${f.label}）${f.description ? `：${f.description}` : ''}`)
    .join('\n');

  return client.completeJSON(
    [
      {
        role: 'system',
        content:
          '你是一名 Meta 分析数据提取助手。请从研究全文(Markdown)中，按给定的字段表逐字段提取数据，填到 values（key 对应字段表的 key）。只提取文中明确出现的文字/表格数据；图表(Figure)中的数值不要臆测，只标注编号与标题、needsExtraction 置 true。缺失信息填空字符串，不要编造。',
      },
      {
        role: 'user',
        content: [
          '【提取字段表】',
          fieldList,
          '',
          '请为每个字段给出 value（文本），并在 figures 中列出需要人工提取数据的图表。',
          '',
          '【全文（Markdown，可能被截断）】',
          excerpt,
        ].join('\n'),
      },
    ],
    extractionSchema,
  );
}

const rawExtractionSchema = z.object({
  study: z.record(z.string(), z.string()),
  arms: z.array(z.record(z.string(), z.string())),
  outcomes: z.array(
    z.object({
      armIndex: z.number(),
      outcome: z.string(),
      values: z.record(z.string(), z.string()),
    }),
  ),
});

/** 第 1 步：AI 按三层结构提取原始数据（研究级/组级/结局级） */
export async function extractRawData(params: {
  markdown: string;
  outcomes: string[];
  systemPrompt?: string;
  fieldSettings?: { sections: Array<{ name: string; level: string; appliesTo?: string; repeatPerOutcome?: boolean; fields: Array<{ label: string; description?: string }> }> };
}): Promise<{ study: Record<string, string>; arms: Array<Record<string, string>>; outcomes: Array<{ armIndex: number; outcome: string; values: Record<string, string> }> }> {
  const client = getActiveLLM();
  const excerpt = params.markdown.slice(0, 30000);
  const system =
    params.systemPrompt ||
    '你是 Meta 分析数据提取助手。请从全文提取：文献信息、每个处理组的背景（含时间/茬次、处理名称、剂量）、以及目标结局的数值（n/均值/SD）。只提目标结局；图表读不出的数值留空，不要臆测。';
  const fieldLines: string[] = [];
  const fs = params.fieldSettings?.sections ?? [];
  for (const sec of fs) {
    const cond = sec.appliesTo === 'experiment' ? '（仅实验组/非对照组，空白对照不填）' : sec.appliesTo === 'control' ? '（仅对照组）' : '';
    const rep = sec.repeatPerOutcome ? '（每个结局重复一组）' : '';
    fieldLines.push(`【${sec.name}】${cond}${rep}：${sec.fields.map((f) => `${f.label}${f.description ? `（${f.description}）` : ''}`).join('、')}`);
  }
  return client.completeJSON(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          '【目标结局】',
          params.outcomes.length ? params.outcomes.map((o) => `- ${o}`).join('\n') : '- 未提供',
          '',
          ...fieldLines,
          '',
          '【全文（Markdown，可能被截断）】',
          excerpt,
        ].join('\n'),
      },
    ],
    rawExtractionSchema,
  );
}

const pairingSchema = z.object({
  groups: z.array(z.object({ name: z.string(), type: z.enum(['experiment', 'control', 'other']) })),
  pairings: z.array(z.object({ treatment: z.string(), control: z.string() })),
});

/** 第 2 步：AI 根据处理组 + 协议 I/C 建议实验组/对照组分类与配对 */
export async function suggestPairing(params: {
  arms: Array<{ name: string; groupType?: 'experiment' | 'control' | 'other'; dose?: string }>;
  pico?: { intervention?: string; comparison?: string };
  systemPrompt?: string;
}): Promise<{ groups: Array<{ name: string; type: 'experiment' | 'control' | 'other' }>; pairings: Array<{ treatment: string; control: string }> }> {
  const client = getActiveLLM();
  const armList = params.arms.map((a) => `- ${a.name}${a.dose ? `（${a.dose}）` : ''}`).join('\n');
  return client.completeJSON(
    [
      { role: 'system', content: params.systemPrompt || '你是 Meta 分析助手。请把处理组分类为实验组/对照组，并给出配对。' },
      {
        role: 'user',
        content: [
          '【处理组】',
          armList,
          '',
          '【干预 I / 对照 C】',
          `干预：${params.pico?.intervention || '未提供'}`,
          `对照：${params.pico?.comparison || '未提供'}`,
          '',
          '请输出 JSON：{"groups":[{"name":"...","type":"experiment|control|other"}],"pairings":[{"treatment":"...","control":"..."}]}',
        ].join('\n'),
      },
    ],
    pairingSchema,
  );
}
