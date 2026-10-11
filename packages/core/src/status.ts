import type { ReferenceStatus } from './types';

/**
 * 文献状态机。
 *
 * 约定：
 * - `TRANSITIONS` 描述「允许的推进方向」。判定本身可以一步完成（导入后直接纳入/排除），
 *   所以同阶段内以及相邻阶段间的推进都允许；跨阶段跳跃（如已导入 → 已提取）一律禁止。
 * - `REGRESSIONS` 描述「人工主动回退」的方向，例如撤回排除、重新上传全文。
 *   这类迁移是业务上允许的，但必须显式声明，避免代码里随意写 status 造成流程倒退。
 */
export const TRANSITIONS: Record<ReferenceStatus, ReferenceStatus[]> = {
  imported: ['screening_tas', 'tas_included', 'tas_excluded'],
  screening_tas: ['tas_included', 'tas_excluded', 'fulltext_pending'],
  tas_included: ['fulltext_pending', 'tas_excluded'], // 可推进全文，也可发现误判后改判排除
  tas_excluded: ['screening_tas', 'tas_included'], // 撤回排除 / 改判纳入
  fulltext_pending: ['fulltext_uploaded', 'ft_included', 'ft_excluded'],
  fulltext_uploaded: ['ft_included', 'ft_excluded'],
  ft_included: ['extracted', 'ft_excluded'], // 可提取，也可发现误判后改判排除
  ft_excluded: ['fulltext_uploaded', 'ft_included'], // 撤回排除 / 改判纳入
  extracted: [],
};

/** 允许的人工回退迁移（业务上主动发起的“重来”动作） */
export const REGRESSIONS: Record<ReferenceStatus, ReferenceStatus[]> = {
  imported: [],
  screening_tas: ['imported'],
  tas_included: [],
  tas_excluded: [],
  fulltext_pending: ['tas_included'],
  fulltext_uploaded: ['fulltext_pending'],
  ft_included: ['fulltext_uploaded', 'fulltext_pending'],
  ft_excluded: ['fulltext_pending'],
  // 重新上传全文属于「重来」：允许回到待转换，并清掉基于旧全文的提取结果
  extracted: ['ft_included', 'fulltext_pending'],
};

/** 状态在流程中的先后次序（用于判断是否倒退） */
const STATUS_RANK: Record<ReferenceStatus, number> = {
  imported: 0,
  screening_tas: 1,
  tas_excluded: 2,
  tas_included: 2,
  fulltext_pending: 3,
  fulltext_uploaded: 4,
  ft_excluded: 5,
  ft_included: 5,
  extracted: 6,
};

/** 状态所在的流程阶段 */
export type StatusStage = 'screening' | 'fulltext' | 'extraction';

const STATUS_STAGE: Record<ReferenceStatus, StatusStage> = {
  imported: 'screening',
  screening_tas: 'screening',
  tas_excluded: 'screening',
  tas_included: 'screening',
  fulltext_pending: 'fulltext',
  fulltext_uploaded: 'fulltext',
  ft_excluded: 'fulltext',
  ft_included: 'fulltext',
  extracted: 'extraction',
};

/** 终态 */
export const TERMINAL_STATUSES: ReferenceStatus[] = [
  'tas_excluded',
  'ft_excluded',
  'extracted',
];

/** 题摘初筛阶段尚未拍板的状态（AI 建议只允许作用在这些文献上） */
export const SCREENING_OPEN_STATUSES: ReferenceStatus[] = [
  'imported',
  'screening_tas',
];

/** 状态在流程中的序号，越大越靠后 */
export function statusRank(status: ReferenceStatus): number {
  return STATUS_RANK[status] ?? 0;
}

/** 状态所属阶段 */
export function statusStage(status: ReferenceStatus): StatusStage {
  return STATUS_STAGE[status] ?? 'screening';
}

export function isScreeningOpen(status: ReferenceStatus): boolean {
  return SCREENING_OPEN_STATUSES.includes(status);
}

export function isTerminal(status: ReferenceStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** 是否为倒退迁移（含同阶段内的回退） */
export function isRegression(from: ReferenceStatus, to: ReferenceStatus): boolean {
  return statusRank(to) < statusRank(from);
}

/**
 * 是否允许 from → to。
 * 正常推进按 TRANSITIONS，主动回退按 REGRESSIONS，两者都未声明则禁止。
 */
export function canTransition(
  from: ReferenceStatus,
  to: ReferenceStatus,
): boolean {
  if (from === to) return true;
  if ((TRANSITIONS[from] ?? []).includes(to)) return true;
  return (REGRESSIONS[from] ?? []).includes(to);
}

/** 不允许的迁移直接抛错，交给调用方转成 400 */
export function assertTransition(
  from: ReferenceStatus,
  to: ReferenceStatus,
): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `非法的状态迁移：${STATUS_LABELS[from]}（${from}）→ ${STATUS_LABELS[to]}（${to}）`,
    );
  }
}

/** 下一步可选状态 */
export function nextStatuses(from: ReferenceStatus): ReferenceStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** 中文状态标签 */
export const STATUS_LABELS: Record<ReferenceStatus, string> = {
  imported: '已导入',
  screening_tas: '初筛中',
  tas_included: '初筛纳入',
  tas_excluded: '初筛排除',
  fulltext_pending: '待全文',
  fulltext_uploaded: '全文已上传',
  ft_included: '全文纳入',
  ft_excluded: '全文排除',
  extracted: '已提取',
};
