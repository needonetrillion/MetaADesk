import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-res-test-'));
process.env.META_DATA_DIR = tmpDir;

const skills = await import('../src/services/agentSkills.ts');
const knowledge = await import('../src/services/agentKnowledge.ts');
const res = await import('../src/services/agentResources.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const skillId = skills.createSkill({
  name: '检索式专家',
  description: '生成数据库检索式',
  content: '技能规则：优先用 RCT 与随机对照。',
}).id;
const knowledgeId = knowledge.addKnowledge({
  name: '堆肥指南',
  description: '堆肥方法学指南',
  text: '沸石 zeolite 可减少氨挥发。'.repeat(50),
  format: 'md',
}).id;

test('buildResourceIndex 返回技能与知识索引', () => {
  const index = res.buildResourceIndex();
  const s = index.find((x) => x.id === skillId);
  const k = index.find((x) => x.id === knowledgeId);
  assert.ok(s && s.type === 'skill');
  assert.ok(k && k.type === 'knowledge');
  assert.ok(s!.name && s!.description);
});

test('selectResourcesPrompt 包含查询与资源名称', () => {
  const p = res.selectResourcesPrompt(res.buildResourceIndex(), '设计检索式');
  assert.match(p, /设计检索式/);
  assert.match(p, /检索式专家/);
  assert.match(p, /堆肥指南/);
});

test('selectResourcesPrompt 包含每个资源的 id（供 Pass1 返回）', () => {
  const index = res.buildResourceIndex();
  const p = res.selectResourcesPrompt(index, '设计检索式');
  for (const item of index) {
    assert.ok(p.includes(item.id), `prompt 缺少资源 id: ${item.id}`);
  }
});

test('resourceContext 注入选中技能正文与命中知识块', () => {
  const ctx = res.resourceContext([skillId, knowledgeId], 'zeolite');
  assert.match(ctx, /优先用 RCT/);
  assert.match(ctx, /zeolite/);
});

test('resourceContext 对不存在的 id 不抛错且不注入技能正文', () => {
  const ctx = res.resourceContext(['不存在的id'], 'x');
  assert.ok(!ctx.includes('优先用 RCT'));
});
