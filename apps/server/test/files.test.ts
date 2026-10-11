import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-files-test-'));
process.env.META_DATA_DIR = tmpDir;

const files = await import('../src/services/files.ts');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('项目文件目录与文献子目录按预期创建和删除', () => {
  const now = new Date().toISOString();
  files.ensureProjectDir('p1', { name: '测试', createdAt: now });

  assert.ok(fs.existsSync(files.projectDir('p1')));
  assert.ok(fs.existsSync(path.join(files.projectDir('p1'), 'project.json')));
  assert.ok(files.pdfPath('p1', 'r1').endsWith('projects/p1/data/r1/source.pdf'));
  assert.ok(files.markdownPath('p1', 'r1').endsWith('projects/p1/data/r1/markdown.md'));

  // 文献目录按需创建与删除
  const pdf = files.pdfPath('p1', 'r1');
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  fs.writeFileSync(pdf, 'x');
  files.removeReferenceDir('p1', 'r1');
  assert.ok(!fs.existsSync(path.dirname(pdf)));

  files.removeProjectDir('p1');
  assert.ok(!fs.existsSync(files.projectDir('p1')));
});
