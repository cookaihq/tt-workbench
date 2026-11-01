'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture } = require('./fixtures.cjs');
const { createPublishRequest } = require('../../github/publish-request.cjs');
const url = 'https://api.github.com/repos/example/workbench/releases';
test('限流后写入与结果核对共享完整冷却，跨进程恢复先核对持久截止时间', async t => {
  const h = await fixture(t), stateFile = path.join(h.vault, 'request-state.json');
  let time = Date.parse('2026-10-31T00:00:00Z'), calls = 0;
  const options = { repository: 'example/workbench', token: 'synthetic-token', stateFile, now: () => time, fetch: async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }); } };
  const request = await createPublishRequest(options);
  await assert.rejects(request(url, { method: 'POST', json: { draft: true } }), { code: 'PUBLISH_COOLDOWN', retryAfter: '2026-10-31T00:02:00.000Z' });
  await assert.rejects(request(url), { code: 'PUBLISH_COOLDOWN' });
  const raw = await fs.readFile(stateFile, 'utf8'); assert.ok(!raw.includes('synthetic-token'));
  const resumed = await createPublishRequest({ ...options, fetch: async () => { calls++; return new Response('[]'); } });
  time += 119999; await assert.rejects(resumed(url), { code: 'PUBLISH_COOLDOWN' }); assert.equal(calls, 1);
  time++; assert.deepEqual(await resumed(url), []); assert.equal(calls, 2);
});
test('HTTP 日期、限流重置与无效 Retry-After 都产生有界且不提前的冷却', async () => {
  const time = Date.parse('2026-10-31T00:00:00Z');
  for (const [status, headers, expected] of [
    [503, { 'retry-after': 'Sat, 31 Oct 2026 00:03:00 GMT' }, '2026-10-31T00:03:00.000Z'],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(time / 1000 + 180) }, '2026-10-31T00:03:00.000Z'],
    [429, { 'retry-after': 'invalid' }, '2026-10-31T00:01:00.000Z']
  ]) {
    let calls = 0;
    const request = await createPublishRequest({ repository: 'example/workbench', now: () => time, fetch: async () => { calls++; return new Response('{}', { status, headers }); } });
    await assert.rejects(request(url), { code: 'PUBLISH_COOLDOWN', retryAfter: expected });
    await assert.rejects(request(url), { code: 'PUBLISH_COOLDOWN' }); assert.equal(calls, 1);
  }
});
test('总预算覆盖多次请求；网络写入失败不自动重放；重定向不外传凭据', async () => {
  let time = 1000, calls = 0;
  const request = await createPublishRequest({ repository: 'example/workbench', token: 'synthetic-token', now: () => time, budget: 100, fetch: async (_url, options) => { calls++; assert.equal(options.headers.Authorization, 'Bearer synthetic-token'); throw Error('connection lost'); } });
  await assert.rejects(request(url, { method: 'POST', json: {} }), /connection lost/); assert.equal(calls, 1);
  time = 1100; await assert.rejects(request(url), { code: 'PUBLISH_TIMEOUT' }); assert.equal(calls, 1);
  const redirected = await createPublishRequest({ repository: 'example/workbench', token: 'synthetic-token', fetch: async (target, options) => {
    if (target === url) return new Response('', { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/fixture' } });
    assert.equal(options.headers.Authorization, undefined); return new Response('[]');
  } });
  assert.deepEqual(await redirected(url), []);
  await assert.rejects(redirected('https://api.github.com/repos/other/workbench/releases'), /已授权/);
});
