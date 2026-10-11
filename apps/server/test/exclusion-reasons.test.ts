import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-reasons-test-'));
process.env.META_DATA_DIR = tmpDir;

const {
  listExclusionReasons,
  saveExclusionReasons,
  seedDefaultExclusionReasons,
} = await import('../src/services/exclusionReasons.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('项目级排除理由：播种、替换、隔离', () => {
  seedDefaultExclusionReasons('p1');
  assert.ok(listExclusionReasons('p1').length > 0);

  saveExclusionReasons('p1', [{ code: 'custom_1', label: '自定义理由' }]);
  assert.ok(listExclusionReasons('p1').some((r) => r.label === '自定义理由'));
  assert.equal(listExclusionReasons('p2').length, 0);
});
