import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-timeout-test-'));
process.env.META_DATA_DIR = tmpDir;
process.env.PORT = '8800';

const { buildApp } = await import('../src/index.ts');
const app = await buildApp();
await app.listen({ port: 8800, host: '127.0.0.1' });
const base = 'http://127.0.0.1:8800';

after(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('PUT /api/settings 保留 provider 的 timeoutMs', async () => {
  const provider = {
    id: 'p1',
    name: 'T',
    kind: 'openai-compatible',
    baseUrl: 'http://x',
    apiKey: '',
    model: 'm',
    timeoutMs: 30000,
  };
  const payload = {
    providers: [provider],
    activeProviderId: null,
    screeningProviderId: null,
    mineruToken: '',
    mineruBaseUrl: 'https://mineru.net/api/v4',
  };

  const put = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(put.status, 200);

  const got = (await (await fetch(`${base}/api/settings`)).json()) as {
    providers: Array<{ timeoutMs?: number }>;
  };
  assert.equal(got.providers[0]!.timeoutMs, 30000);
});
