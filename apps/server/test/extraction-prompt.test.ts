import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-exprompt-test-'));
process.env.META_DATA_DIR = tmpDir;

const { saveAiSettings, getAiSettings, generateExtractionPrompt } = await import('../src/services/aiSettings.ts');
const { saveProtocol } = await import('../src/services/protocol.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('提取提示词保存读回与自动生成', () => {
  saveAiSettings('p1', { extractionSystemPrompt: 'EXTRACT-P' });
  assert.equal(getAiSettings('p1')!.extractionSystemPrompt, 'EXTRACT-P');

  saveProtocol('p1', {
    title: 'T',
    objective: 'O',
    pico: { population: 'P', intervention: 'I', comparison: 'C', outcome: 'O' },
    criteria: [],
    outcomes: ['NH3排放'],
  });
  const p = generateExtractionPrompt('p1');
  assert.match(p, /文献信息/);
  assert.match(p, /实验组/);
  assert.match(p, /对照组/);
  assert.match(p, /NH3排放/);
  assert.match(p, /armIndex/);
});
