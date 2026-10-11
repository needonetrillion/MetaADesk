import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postJSON } from '../src/http.ts';

test('postJSON 接受外部 AbortSignal 并中止请求', async () => {
  const ctrl = new AbortController();
  const p = postJSON({
    endpoint: 'http://127.0.0.1:1/chat',
    headers: {},
    body: {},
    timeoutMs: 5000,
    retries: 0,
    signal: ctrl.signal,
  });
  ctrl.abort();
  await assert.rejects(p, (e: unknown) => (e as Error).name === 'AbortError');
});
