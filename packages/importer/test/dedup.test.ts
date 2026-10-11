import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDedupGroups,
  dedupKeyOf,
  makeDedupGroupId,
  normalizeTitle,
} from '../src/index.ts';

test('normalizeTitle 去掉标点与空白并保留中日韩字符', () => {
  assert.equal(normalizeTitle('  A Randomized, Trial!  '), 'arandomizedtrial');
  assert.equal(normalizeTitle('Meta 分析：疗效'), 'meta分析疗效');
});

test('dedupKeyOf 优先 DOI，其次标题+第一作者+期刊，最后各自成组', () => {
  assert.equal(dedupKeyOf({ doi: ' 10.1/ABC ', title: 'x' }), 'doi:10.1/abc');
  assert.equal(dedupKeyOf({ title: 'Same Title' }), 'title:sametitle|au:|j:');
  assert.equal(dedupKeyOf({ title: '   ' }, 3), 'nokey:3');
});

test('dedupKeyOf 标题相同但第一作者或期刊不同时不合并', () => {
  const base = { title: 'Same Title', firstAuthor: 'Smith J', journal: 'Nature' };
  // 归一化后仍一致（大小写/标点差异）
  assert.equal(
    dedupKeyOf(base),
    dedupKeyOf({ title: 'same title!', firstAuthor: 'Smith, J.', journal: 'nature' }),
  );
  // 第一作者不同 → 不同 key
  assert.notEqual(
    dedupKeyOf(base),
    dedupKeyOf({ title: 'Same Title', firstAuthor: 'Doe A', journal: 'Nature' }),
  );
  // 期刊不同 → 不同 key
  assert.notEqual(
    dedupKeyOf(base),
    dedupKeyOf({ title: 'Same Title', firstAuthor: 'Smith J', journal: 'Science' }),
  );
});

test('buildDedupGroups 按 key 聚合且保留首个条目为 canonical', () => {
  const groups = buildDedupGroups([
    { doi: '10.1/a', title: 'A' },
    { title: 'Same Title' },
    { doi: '10.1/A', title: 'A duplicate' },
    { title: 'same   title!' },
  ]);
  assert.equal(groups.length, 2);
  const first = groups[0]!;
  assert.deepEqual(first.itemIndices, [0, 2]);
  assert.equal(first.canonicalIndex, 0);
  const second = groups[1]!;
  assert.deepEqual(second.itemIndices, [1, 3]);
  assert.equal(second.canonicalIndex, 1);
});

test('同一批内 DOI 命中与标题命中不会被并成一组（各按各自 key 归组）', () => {
  const groups = buildDedupGroups([
    { doi: '10.2/b', title: 'B' },
    { title: 'B' },
  ]);
  assert.equal(groups.length, 2);
});

test('批内 groupId 由调用方替换为全局唯一 id，避免跨批次撞号', () => {
  const seen = new Set<string>();
  let seq = 0;
  // 模拟真实的 uniqueId（uuid / 自增 id）：同样的 seed 在不同批次也必须得到不同结果
  const uniqueId = (_seed: string) => {
    const id = `uuid-${++seq}`;
    assert.ok(!seen.has(id), `重复的 groupId: ${id}`);
    seen.add(id);
    return id;
  };

  // 两次独立导入各自都会产生 g1，但持久化的 id 必须不同
  for (const _batch of [1, 2]) {
    const groups = buildDedupGroups([{ doi: '10.1/a', title: 'A' }]);
    for (const g of groups) {
      for (const idx of g.itemIndices) {
        makeDedupGroupId(g.groupId, idx, uniqueId);
      }
    }
  }
  assert.equal(seen.size, 2);
});
