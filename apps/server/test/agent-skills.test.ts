import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-skills-test-'));
process.env.META_DATA_DIR = tmpDir;

const skills = await import('../src/services/agentSkills.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('技能创建/列表/更新/删除', () => {
  const s = skills.createSkill({ name: '检索式专家', description: '生成检索式', content: '规则' });
  assert.ok(s.id);
  assert.equal(s.name, '检索式专家');
  assert.equal(skills.listSkills().length, 1);

  const u = skills.updateSkill(s.id, { name: '检索式专家2', description: 'd', content: '新规则' });
  assert.equal(u.name, '检索式专家2');
  assert.equal(u.content, '新规则');

  skills.deleteSkill(s.id);
  assert.equal(skills.listSkills().length, 0);
});

test('空技能名被拒绝', () => {
  assert.throws(() => skills.createSkill({ name: '  ', description: 'd', content: 'c' }));
});

test('空技能描述被拒绝', () => {
  assert.throws(() => skills.createSkill({ name: '检索式专家', description: '  ', content: 'c' }));
});

test('更新不存在的技能抛错', () => {
  assert.throws(() => skills.updateSkill('missing', { name: 'x', description: 'd', content: 'c' }));
});
