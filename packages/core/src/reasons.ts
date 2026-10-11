/** 排除理由编码（对齐 PRISMA 常见排除类别） */
export const EXCLUSION_REASONS = [
  'wrong_population',
  'wrong_intervention',
  'wrong_comparison',
  'wrong_outcome',
  'wrong_study_design',
  'wrong_publication_type',
  'duplicate',
  'non_human',
  'no_fulltext',
  'insufficient_data',
  'other',
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  wrong_population: '研究对象不符',
  wrong_intervention: '干预措施不符',
  wrong_comparison: '对照设置不符',
  wrong_outcome: '结局指标不符',
  wrong_study_design: '研究设计不符',
  wrong_publication_type: '文献类型不符（综述/评论/会议摘要等）',
  duplicate: '重复文献',
  non_human: '非人体研究',
  no_fulltext: '无法获取全文',
  insufficient_data: '数据不完整',
  other: '其他',
};
