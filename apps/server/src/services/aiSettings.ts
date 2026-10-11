import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { projectAiSettings } from '../db/schema';
import { getProtocol } from './protocol';
import { listStrategies } from './strategies';

export interface AiSettings {
  projectId: string;
  screeningProviderId: string | null;
  screeningSystemPrompt: string | null;
  fulltextSystemPrompt: string | null;
  extractionSystemPrompt: string | null;
  updatedAt: string;
}

export interface AiSettingsInput {
  screeningProviderId?: string | null;
  screeningSystemPrompt?: string | null;
  fulltextSystemPrompt?: string | null;
  extractionSystemPrompt?: string | null;
}

export function getAiSettings(projectId: string): AiSettings | null {
  const row = db
    .select()
    .from(projectAiSettings)
    .where(eq(projectAiSettings.projectId, projectId))
    .get();
  if (!row) return null;
  return {
    projectId: row.projectId,
    screeningProviderId: row.screeningProviderId,
    screeningSystemPrompt: row.screeningSystemPrompt,
    fulltextSystemPrompt: row.fulltextSystemPrompt,
    extractionSystemPrompt: row.extractionSystemPrompt,
    updatedAt: row.updatedAt,
  };
}

export function saveAiSettings(projectId: string, input: AiSettingsInput): AiSettings {
  const now = new Date().toISOString();
  db.insert(projectAiSettings)
    .values({
      projectId,
      screeningProviderId: input.screeningProviderId ?? null,
      screeningSystemPrompt: input.screeningSystemPrompt ?? null,
      fulltextSystemPrompt: input.fulltextSystemPrompt ?? null,
      extractionSystemPrompt: input.extractionSystemPrompt ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projectAiSettings.projectId,
      set: {
        screeningProviderId: input.screeningProviderId ?? null,
        screeningSystemPrompt: input.screeningSystemPrompt ?? null,
        fulltextSystemPrompt: input.fulltextSystemPrompt ?? null,
        extractionSystemPrompt: input.extractionSystemPrompt ?? null,
        updatedAt: now,
      },
    })
    .run();
  return getAiSettings(projectId)!;
}

/** 根据协议 + 检索式 + 方法学常识生成初筛系统提示词初稿 */
export function generateScreeningPrompt(projectId: string): string {
  const proto = getProtocol(projectId);
  const strategies = listStrategies(projectId);

  const lines: string[] = [];
  lines.push('你是一名系统评价/Meta 分析的文献初筛助手。请仅凭题目与摘要判断每篇文献是否应进入全文筛选。');

  if (proto) {
    lines.push('');
    lines.push('【研究问题（PICO）】');
    lines.push(`- 研究对象(P)：${proto.pico.population || '未提供'}`);
    lines.push(`- 干预(I)：${proto.pico.intervention || '未提供'}`);
    lines.push(`- 对照(C)：${proto.pico.comparison || '未提供'}`);
    lines.push(`- 结局(O)：${proto.pico.outcome || '未提供'}`);
    if (proto.pico.studyDesign) lines.push(`- 研究设计：${proto.pico.studyDesign}`);

    const inc = proto.criteria.filter((c) => c.type === 'inclusion').map((c) => c.text);
    const exc = proto.criteria.filter((c) => c.type === 'exclusion').map((c) => c.text);
    lines.push('');
    lines.push('【纳入标准】');
    lines.push(inc.length ? inc.map((x) => `- ${x}`).join('\n') : '- 未提供');
    lines.push('');
    lines.push('【排除标准】');
    lines.push(exc.length ? exc.map((x) => `- ${x}`).join('\n') : '- 未提供');
    if (proto.outcomes.length) {
      lines.push('');
      lines.push('【结局指标】');
      lines.push(proto.outcomes.map((o) => `- ${o}`).join('\n'));
    }
  } else {
    lines.push('');
    lines.push('【研究问题】未制定协议，请提醒研究者先完成协议。');
  }

  if (strategies.length) {
    lines.push('');
    lines.push('【本项目检索式（用于理解研究范围与同义词）】');
    for (const s of strategies) lines.push(`- ${s.databaseName}：${s.query}`);
  }

  lines.push('');
  lines.push('【判断规则】');
  lines.push('对每篇文献给出三态判断之一：include（纳入）/ exclude（排除）/ undecided（待定），并给出简短理由。');
  lines.push('规则：明确符合且无排除因素给 include；明确违反或命中排除标准给 exclude；信息不足给 undecided。');

  return lines.join('\n');
}

/** 根据协议 + 检索式 + 方法学常识生成全文 AI 提示词初稿 */
export function generateFulltextPrompt(projectId: string): string {
  const proto = getProtocol(projectId);
  const strategies = listStrategies(projectId);

  const lines: string[] = [];
  lines.push('你是一名系统评价/Meta 分析的全文筛选助手。请阅读文献全文（Markdown 或文本），判断该研究是否应纳入数据提取。');

  if (proto) {
    lines.push('');
    lines.push('【研究问题（PICO）】');
    lines.push(`- 研究对象(P)：${proto.pico.population || '未提供'}`);
    lines.push(`- 干预(I)：${proto.pico.intervention || '未提供'}`);
    lines.push(`- 对照(C)：${proto.pico.comparison || '未提供'}`);
    lines.push(`- 结局(O)：${proto.pico.outcome || '未提供'}`);
    if (proto.pico.studyDesign) lines.push(`- 研究设计：${proto.pico.studyDesign}`);

    const inc = proto.criteria.filter((c) => c.type === 'inclusion').map((c) => c.text);
    const exc = proto.criteria.filter((c) => c.type === 'exclusion').map((c) => c.text);
    lines.push('');
    lines.push('【纳入标准】');
    lines.push(inc.length ? inc.map((x) => `- ${x}`).join('\n') : '- 未提供');
    lines.push('');
    lines.push('【排除标准】');
    lines.push(exc.length ? exc.map((x) => `- ${x}`).join('\n') : '- 未提供');
    if (proto.outcomes.length) {
      lines.push('');
      lines.push('【结局指标】');
      lines.push(proto.outcomes.map((o) => `- ${o}`).join('\n'));
    }
  } else {
    lines.push('');
    lines.push('【研究问题】未制定协议，请提醒研究者先完成协议。');
  }

  if (strategies.length) {
    lines.push('');
    lines.push('【本项目检索式（用于理解研究范围与同义词）】');
    for (const s of strategies) lines.push(`- ${s.databaseName}：${s.query}`);
  }

  lines.push('');
  lines.push('【判断规则】');
  lines.push('对每篇全文给出三态判断之一：include（纳入）/ exclude（排除）/ undecided（待定），并给出简短理由。');
  lines.push('规则：全文确凿符合纳入标准且无排除因素给 include；确凿违反或命中排除标准给 exclude；信息不足给 undecided。');

  return lines.join('\n');
}

/** 根据协议 + 方法论生成数据提取提示词初稿（通用，字段由「字段提取设置」定义） */
export function generateExtractionPrompt(projectId: string): string {
  const proto = getProtocol(projectId);
  const lines: string[] = [];
  lines.push('你是一名系统评价/Meta 分析的数据提取助手。请阅读文献全文，按提供的字段分段逐项提取，忠实于原文，不猜测、不编造；读不出或仅出现在图表中的数值一律留空。');

  lines.push('');
  lines.push('提取层级：');
  lines.push('- 文献信息：每篇一条。');
  lines.push('- 背景信息：每个处理组一条，并标注该组为「实验组 / 对照组 / 其它」。');
  lines.push('- 结局信息：每个处理组 × 每个目标结局一条。');

  if (proto?.outcomes.length) {
    lines.push('');
    lines.push('【目标结局】');
    lines.push(proto.outcomes.map((o) => `- ${o}`).join('\n'));
  }

  lines.push('');
  lines.push('【输出格式】请只输出 JSON：');
  lines.push('{"study":{"字段key":"值"},"arms":[{"字段key":"值",...}],"outcomes":[{"armIndex":0,"values":{"字段key":"值",...}}]}');
  lines.push('字段key 由「字段提取设置」中的分段字段定义，armIndex 为处理组在 arms 中的序号（从 0 开始）。');

  return lines.join('\n');
}
