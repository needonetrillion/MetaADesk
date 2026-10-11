import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-paired-test-'));
process.env.META_DATA_DIR = tmpDir;

const svc = await import('../src/services/dataExtraction.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seed() {
  svc.saveRawExtraction('ref1', {
    study: { title: 'T' },
    arms: [
      { id: 'a1', values: { name: '5%沸石', isControl: '否' } },
      { id: 'a2', values: { name: '10%沸石', isControl: '否' } },
      { id: 'a3', values: { name: '空白对照', isControl: '是' } },
    ],
    outcomes: [
      { id: 'o1', armId: 'a1', outcome: 'NH3排放', values: { mean: '12', sd: '2', n: '3' } },
      { id: 'o2', armId: 'a2', outcome: 'NH3排放', values: { mean: '10', sd: '2', n: '3' } },
      { id: 'o3', armId: 'a3', outcome: 'NH3排放', values: { mean: '20', sd: '3', n: '3' } },
    ],
  });
}

test('分类保存校验：配对引用了不存在的组或类型不符抛错', () => {
  seed();
  assert.throws(() =>
    svc.saveClassification('ref1', {
      groups: [{ name: '5%沸石', type: 'experiment' }, { name: '空白对照', type: 'control' }],
      pairings: [{ treatment: '不存在', control: '空白对照' }],
    }),
  );
  assert.throws(() =>
    svc.saveClassification('ref1', {
      groups: [{ name: '空白对照', type: 'control' }],
      pairings: [{ treatment: '空白对照', control: '空白对照' }],
    }),
  );
});

test('成对条目：一个对照组配多个实验组，均标记共享对照组', () => {
  seed();
  svc.saveClassification('ref1', {
    groups: [
      { name: '5%沸石', type: 'experiment' },
      { name: '10%沸石', type: 'experiment' },
      { name: '空白对照', type: 'control' },
    ],
    pairings: [
      { treatment: '5%沸石', control: '空白对照' },
      { treatment: '10%沸石', control: '空白对照' },
    ],
  });
  const entries = svc.generatePairedEntries('ref1');
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.sharedControl === true));
  assert.equal(entries[0]!.treatmentMean, '12');
  assert.equal(entries[0]!.controlMean, '20');
});

test('多个对照组各自配对（羊粪/牛粪），sharedControl=false 且配对正确', () => {
  svc.saveRawExtraction('ref2', {
    study: {},
    arms: [
      { id: 'a1', values: { name: '沸石羊粪', isControl: '否' } },
      { id: 'a2', values: { name: '沸石牛粪', isControl: '否' } },
      { id: 'a3', values: { name: '空白羊粪', isControl: '是' } },
      { id: 'a4', values: { name: '空白牛粪', isControl: '是' } },
    ],
    outcomes: [
      { id: 'o1', armId: 'a1', outcome: 'NH3排放', values: { mean: '10' } },
      { id: 'o2', armId: 'a2', outcome: 'NH3排放', values: { mean: '12' } },
      { id: 'o3', armId: 'a3', outcome: 'NH3排放', values: { mean: '20' } },
      { id: 'o4', armId: 'a4', outcome: 'NH3排放', values: { mean: '22' } },
    ],
  });
  svc.saveClassification('ref2', {
    groups: [
      { name: '沸石羊粪', type: 'experiment' },
      { name: '沸石牛粪', type: 'experiment' },
      { name: '空白羊粪', type: 'control' },
      { name: '空白牛粪', type: 'control' },
    ],
    pairings: [
      { treatment: '沸石羊粪', control: '空白羊粪' },
      { treatment: '沸石牛粪', control: '空白牛粪' },
    ],
  });
  const entries = svc.generatePairedEntries('ref2');
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.sharedControl === false));
  const sheep = entries.find((e) => e.treatment === '沸石羊粪');
  assert.equal(sheep?.control, '空白羊粪');
  assert.equal(sheep?.treatmentMean, '10');
  assert.equal(sheep?.controlMean, '20');
});

test('成对 CSV 导出含标题与转义', async () => {
  // 造一条含逗号/引号的文献标题，验证 CSV 转义
  const now = new Date().toISOString();
  const { db } = await import('../src/db/client.ts');
  const schema = await import('../src/db/schema.ts');
  db.insert(schema.references)
    .values({
      id: 'ref-csv', projectId: 'p1', title: '含,逗号"引号', authors: '[]', abstract: '',
      importOrder: 1, status: 'ft_included', createdAt: now, updatedAt: now,
    })
    .run();
  svc.savePairedEntries('ref-csv', [{
    id: 'e1', treatment: '5%沸石', control: '空白对照', outcome: 'NH3排放',
    treatmentMean: '12', controlMean: '20', sharedControl: false,
  }]);
  const csv = svc.exportPairedCSV('p1');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"含,逗号""引号"/);
});
