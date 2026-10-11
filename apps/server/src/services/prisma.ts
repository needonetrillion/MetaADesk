import { and, eq, inArray } from 'drizzle-orm';
import {
  EXCLUSION_REASONS,
  EXCLUSION_REASON_LABELS,
  type ReferenceStatus,
} from '@meta/core';
import { db } from '../db/client';
import { references, screenDecisions } from '../db/schema';

export interface ReasonCount {
  code: string;
  label: string;
  count: number;
}

/** 某个筛选阶段的排除理由汇总 */
export interface StageReasonSummary {
  stage: 'title_abstract' | 'fulltext';
  excluded: number;
  reasons: ReasonCount[];
  /** 已排除但未填写理由的条数 */
  withoutReason: number;
}

export interface PrismaSummary {
  /** 各阶段文献数 */
  flow: {
    total: number; // 库内全部记录
    duplicatesRemoved: number; // 去重剔除
    screened: number; // 进入题摘初筛（去重后）
    tasExcluded: number;
    tasIncluded: number;
    fulltextAssessed: number; // 已上传全文/已做全文判定的总数
    ftExcluded: number;
    ftIncluded: number;
    extracted: number;
    awaitingScreening: number; // 还没拍板的初筛
    awaitingFulltext: number; // 初筛纳入但还没上传/判定
    awaitingExtraction: number; // 全文纳入但还没提取
  };
  exclusion: {
    titleAbstract: StageReasonSummary;
    fulltext: StageReasonSummary;
  };
}

/**
 * PRISMA 流程与排除理由汇总。
 *
 * 之前系统只「采集」排除理由（判定时可选），但没有汇总输出；这里补齐这类系统的核心交付物：
 * 流程各阶段计数 + 按排除理由分类的计数。
 */
export function buildPrismaSummary(projectId: string): PrismaSummary {
  const refs = db
    .select({
      id: references.id,
      status: references.status,
      isDuplicate: references.isDuplicate,
    })
    .from(references)
    .where(eq(references.projectId, projectId))
    .all();

  const flow: PrismaSummary['flow'] = {
    total: refs.length,
    duplicatesRemoved: 0,
    screened: 0,
    tasExcluded: 0,
    tasIncluded: 0,
    fulltextAssessed: 0,
    ftExcluded: 0,
    ftIncluded: 0,
    extracted: 0,
    awaitingScreening: 0,
    awaitingFulltext: 0,
    awaitingExtraction: 0,
  };

  for (const r of refs) {
    if (r.isDuplicate) {
      flow.duplicatesRemoved++;
      continue;
    }
    const status = r.status as ReferenceStatus;
    flow.screened++;
    switch (status) {
      case 'imported':
      case 'screening_tas':
        flow.awaitingScreening++;
        break;
      case 'tas_excluded':
        flow.tasExcluded++;
        break;
      case 'tas_included':
        flow.tasIncluded++;
        flow.awaitingFulltext++;
        break;
      case 'fulltext_pending':
        flow.fulltextAssessed++;
        flow.awaitingFulltext++;
        break;
      case 'fulltext_uploaded':
        flow.fulltextAssessed++;
        break;
      case 'ft_excluded':
        flow.fulltextAssessed++;
        flow.ftExcluded++;
        break;
      case 'ft_included':
        flow.fulltextAssessed++;
        flow.ftIncluded++;
        flow.awaitingExtraction++;
        break;
      case 'extracted':
        flow.fulltextAssessed++;
        flow.ftIncluded++;
        flow.extracted++;
        break;
      default:
        break;
    }
  }

  return {
    flow,
    exclusion: {
      titleAbstract: summarizeStage(projectId, 'title_abstract'),
      fulltext: summarizeStage(projectId, 'fulltext'),
    },
  };
}

/** 统计某阶段已排除文献的排除理由分布 */
function summarizeStage(
  projectId: string,
  stage: 'title_abstract' | 'fulltext',
): StageReasonSummary {
  const excludedStatuses: ReferenceStatus[] =
    stage === 'title_abstract' ? ['tas_excluded'] : ['ft_excluded'];

  const excluded = db
    .select({ id: references.id, isDuplicate: references.isDuplicate })
    .from(references)
    .where(
      and(
        eq(references.projectId, projectId),
        inArray(references.status, excludedStatuses),
      ),
    )
    .all();
  const excludedIds = excluded.filter((r) => !r.isDuplicate).map((r) => r.id);

  const counts = new Map<string, number>();
  let withoutReason = 0;

  if (excludedIds.length) {
    const decisions = db
      .select({
        referenceId: screenDecisions.referenceId,
        decision: screenDecisions.decision,
        reasons: screenDecisions.reasons,
      })
      .from(screenDecisions)
      .where(
        and(
          inArray(screenDecisions.referenceId, excludedIds),
          eq(screenDecisions.stage, stage),
        ),
      )
      .all();

    const withDecision = new Set(decisions.map((d) => d.referenceId));
    for (const id of excludedIds) {
      if (!withDecision.has(id)) withoutReason++;
    }

    for (const d of decisions) {
      // 只统计人工最终判定为排除的条目
      if (d.decision !== 'exclude') {
        withoutReason++;
        continue;
      }
      let reasons: string[] = [];
      try {
        reasons = JSON.parse(d.reasons) as string[];
      } catch {
        reasons = [];
      }
      if (reasons.length === 0) {
        withoutReason++;
        continue;
      }
      for (const code of reasons) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }

  const labels = EXCLUSION_REASON_LABELS as Record<string, string>;
  const reasons: ReasonCount[] = EXCLUSION_REASONS.map((code) => ({
    code,
    label: labels[code] ?? code,
    count: counts.get(code) ?? 0,
  })).filter((r) => r.count > 0);

  // 库中出现过的未知编码也一并列出，避免静默丢数据
  for (const [code, count] of counts) {
    if (!reasons.some((r) => r.code === code)) {
      reasons.push({ code, label: labels[code] ?? code, count });
    }
  }

  return {
    stage,
    excluded: excludedIds.length,
    reasons: reasons.sort((a, b) => b.count - a.count),
    withoutReason,
  };
}
