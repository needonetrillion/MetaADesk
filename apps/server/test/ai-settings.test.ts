import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ai-settings-test-'));
process.env.META_DATA_DIR = tmpDir;

const { getAiSettings, saveAiSettings, generateScreeningPrompt, generateFulltextPrompt } = await import('../src/services/aiSettings.ts');
const { saveProtocol } = await import('../src/services/protocol.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('项目级初筛 AI 设置：默认、保存读回、提示词生成', () => {
  assert.equal(getAiSettings('p1'), null);

  saveAiSettings('p1', { screeningProviderId: 'prov-s', screeningSystemPrompt: 'PROMPT-A' });
  assert.equal(getAiSettings('p1')!.screeningSystemPrompt, 'PROMPT-A');
  assert.equal(getAiSettings('p1')!.screeningProviderId, 'prov-s');

  saveProtocol('p1', {
    title: 'T',
    objective: 'O',
    pico: { population: 'P', intervention: 'I', comparison: 'C', outcome: 'O' },
    criteria: [
      { id: 'c1', type: 'inclusion', text: 'RCT' },
      { id: 'c2', type: 'exclusion', text: '动物实验' },
    ],
    outcomes: ['死亡率'],
  });

  const p = generateScreeningPrompt('p1');
  assert.match(p, /纳入/);
  assert.match(p, /排除/);
  assert.match(p, /待定/);
});

test('全文 AI 提示词：保存读回与自动生成', () => {
  saveAiSettings('p1', { fulltextSystemPrompt: 'FULL-PROMPT' });
  assert.equal(getAiSettings('p1')!.fulltextSystemPrompt, 'FULL-PROMPT');

  const p = generateFulltextPrompt('p1');
  assert.match(p, /全文/);
  assert.match(p, /数据提取/);
});
