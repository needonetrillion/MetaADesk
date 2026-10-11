import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSITIONS,
  REGRESSIONS,
  canTransition,
  assertTransition,
  isRegression,
  isScreeningOpen,
  nextStatuses,
  statusRank,
  type ReferenceStatus,
} from '../src/index.ts';

const ALL: ReferenceStatus[] = [
  'imported',
  'screening_tas',
  'tas_included',
  'tas_excluded',
  'fulltext_pending',
  'fulltext_uploaded',
  'ft_included',
  'ft_excluded',
  'extracted',
];

test('正常推进路径合法', () => {
  assert.equal(canTransition('imported', 'screening_tas'), true);
  assert.equal(canTransition('imported', 'tas_included'), true);
  assert.equal(canTransition('imported', 'tas_excluded'), true);
  assert.equal(canTransition('screening_tas', 'tas_included'), true);
  assert.equal(canTransition('tas_included', 'fulltext_pending'), true);
  assert.equal(canTransition('fulltext_pending', 'fulltext_uploaded'), true);
  assert.equal(canTransition('fulltext_uploaded', 'ft_included'), true);
  assert.equal(canTransition('ft_included', 'extracted'), true);
});

test('跨阶段跳跃推进一律非法', () => {
  assert.equal(canTransition('imported', 'fulltext_pending'), false);
  assert.equal(canTransition('imported', 'extracted'), false);
  assert.equal(canTransition('screening_tas', 'extracted'), false);
  assert.equal(canTransition('tas_included', 'ft_included'), false);
  assert.equal(canTransition('fulltext_uploaded', 'extracted'), false);
  assert.equal(canTransition('extracted', 'tas_included'), false);
});

test('撤回排除与重新上传属于显式允许的回退', () => {
  assert.equal(canTransition('tas_excluded', 'screening_tas'), true);
  assert.equal(canTransition('ft_excluded', 'fulltext_uploaded'), true);
  assert.equal(canTransition('ft_included', 'fulltext_uploaded'), true);
  assert.equal(canTransition('fulltext_uploaded', 'fulltext_pending'), true);
  // 未声明的回退仍然非法
  assert.equal(canTransition('extracted', 'screening_tas'), false);
  assert.equal(canTransition('tas_included', 'imported'), false);
});

test('发现判断错误时允许同阶段改判（纳入→排除）', () => {
  assert.equal(canTransition('tas_included', 'tas_excluded'), true);
  assert.equal(canTransition('ft_included', 'ft_excluded'), true);
  assert.equal(canTransition('ft_excluded', 'ft_included'), true);
});

test('自迁移幂等', () => {
  for (const s of ALL) assert.equal(canTransition(s, s), true);
});

test('assertTransition 对非法迁移抛错', () => {
  assert.throws(() => assertTransition('imported', 'extracted'), /非法的状态迁移/);
  assert.doesNotThrow(() => assertTransition('imported', 'screening_tas'));
});

test('isRegression 能识别回退与推进', () => {
  assert.equal(isRegression('ft_included', 'fulltext_uploaded'), true);
  assert.equal(isRegression('imported', 'screening_tas'), false);
  assert.equal(isRegression('tas_included', 'tas_included'), false);
});

test('nextStatuses 只返回推进方向', () => {
  assert.deepEqual(nextStatuses('imported'), [
    'screening_tas',
    'tas_included',
    'tas_excluded',
  ]);
  assert.deepEqual(nextStatuses('extracted'), []);
});

test('AI 建议只作用于初筛未拍板的文献', () => {
  assert.equal(isScreeningOpen('imported'), true);
  assert.equal(isScreeningOpen('screening_tas'), true);
  assert.equal(isScreeningOpen('tas_included'), false);
  assert.equal(isScreeningOpen('tas_excluded'), false);
  assert.equal(isScreeningOpen('extracted'), false);
});

test('状态秩单调且分组正确', () => {
  assert.ok(statusRank('imported') < statusRank('screening_tas'));
  assert.ok(statusRank('tas_included') < statusRank('fulltext_pending'));
  assert.ok(statusRank('fulltext_uploaded') < statusRank('extracted'));
  assert.equal(statusRank('ft_included'), statusRank('ft_excluded'));
});

test('状态机没有自相矛盾的声明', () => {
  for (const s of ALL) {
    for (const to of TRANSITIONS[s]) {
      assert.ok(!REGRESSIONS[s].includes(to), `${s} → ${to} 同时出现在推进与回退中`);
    }
  }
});
