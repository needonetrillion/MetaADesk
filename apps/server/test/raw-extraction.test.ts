import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-rawext-test-'));
process.env.META_DATA_DIR = tmpDir;

const svc = await import('../src/services/dataExtraction.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('原始提取保存读回与 armId 校验', () => {
  const data = {
    study: { title: 'T', firstAuthor: 'Smith' },
    arms: [{ id: 'a1', values: { name: '5%沸石', time: '第1茬' } }],
    outcomes: [{ id: 'o1', armId: 'a1', outcome: 'NH3排放', values: { mean: '12' } }],
  };
  svc.saveRawExtraction('ref1', data);
  const got = svc.getRawExtraction('ref1');
  assert.ok(got);
  assert.equal(got.arms[0]!.values.time, '第1茬');
  assert.equal(got.outcomes[0]!.values.mean, '12');
  assert.equal(got.outcomes[0]!.outcome, 'NH3排放');

  // armId 指向不存在的组 → 抛错
  assert.throws(() =>
    svc.saveRawExtraction('ref2', {
      study: {},
      arms: [{ id: 'a1', values: { name: 'x' } }],
      outcomes: [{ id: 'o1', armId: 'missing', outcome: 'y', values: {} }],
    }),
  );
});
