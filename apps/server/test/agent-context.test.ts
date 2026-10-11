import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-agent-context-test-'));
process.env.META_DATA_DIR = tmpDir;

const { saveProtocol } = await import('../src/services/protocol.ts');
const { addSource } = await import('../src/services/sources.ts');
const { createStrategy } = await import('../src/services/strategies.ts');
const { saveTemplate } = await import('../src/services/extraction.ts');
const { seedDefaultExclusionReasons } = await import('../src/services/exclusionReasons.ts');
const { buildContext } = await import('../src/services/agent.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('buildContext 包含项目级全局信息', () => {
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

  const source = addSource('p1', { presetKey: 'pubmed', name: 'PubMed' });
  createStrategy('p1', { databaseId: source.id, query: 'q-pubmed', generatedBy: 'manual' });
  saveTemplate('p1', [{ key: 'design', label: '研究设计' }]);
  seedDefaultExclusionReasons('p1');

  const ctx = buildContext('p1');
  assert.match(ctx, /PubMed/);
  assert.match(ctx, /q-pubmed/);
  assert.match(ctx, /原始命中/);
  assert.match(ctx, /研究对象不符/);
  assert.match(ctx, /design/);
});
