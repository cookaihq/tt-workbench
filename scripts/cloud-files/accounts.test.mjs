import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorizationUrl, parseAuthorizationResult, queryIdentity, listAccounts, checkAccount, saveAuthorization } from './accounts.mjs';

const state = 'a'.repeat(64);
const now = Date.parse('2026-10-25T18:00:00Z');
const callback = (token = 'test-only-token', changes = {}) => 'https://openapi.baidu.com/oauth/2.0/login_success#' + new URLSearchParams({ access_token: token, expires_in: '3600', token_type: 'Bearer', state, ...changes });
const authorization = (token = 'test-only-token') => parseAuthorizationResult(callback(token), state, now);
const identityFetch = (uk, netdisk_name = '示例账号') => async (url, options) => {
  assert.equal(url.origin, 'https://pan.baidu.com');
  assert.equal(url.searchParams.get('method'), 'uinfo');
  assert.equal(options.redirect, 'error');
  return { ok: true, json: async () => ({ errno: 0, uk, netdisk_name }) };
};
async function fixture(t) {
  const parent = fileURLToPath(new URL('../../apps/workbench/data/cloud-account-tests/', import.meta.url));
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, storePath: path.join(root, 'profiles/accounts.json') };
}

test('OAuth result binds to its request, validates provider and expires without echoing credentials', () => {
  const request = new URL(authorizationUrl(state));
  assert.equal(request.searchParams.get('state'), state);
  assert.equal(request.searchParams.get('redirect_uri'), 'oob');
  assert.equal(authorization().expires_at, '2026-10-25T19:00:00.000Z');
  for (const [url, expected, code] of [
    [callback(), 'b'.repeat(64), 'STATE_MISMATCH'],
    [callback().replace('openapi.baidu.com', 'example.com'), state, 'INVALID_RESULT'],
    [callback('test-only-token', { expires_in: '-1' }), state, 'INVALID_EXPIRY'],
    [callback('test-only-token', { error: 'access_denied' }), state, 'AUTH_DENIED'],
    [callback() + '&access_token=other', state, 'INVALID_RESULT'],
  ]) assert.throws(() => parseAuthorizationResult(url, expected, now), error => error.code === code && !error.message.includes('test-only-token'));
});

test('identity failures and unsafe numeric IDs are rejected without leaking request URLs', async () => {
  await assert.rejects(queryIdentity('test-only-token', { fetchImpl: async () => { throw Error('https://example.com/?access_token=test-only-token'); } }), error => error.code === 'IDENTITY_UNAVAILABLE' && !error.message.includes('test-only-token'));
  await assert.rejects(queryIdentity('test-only-token', { fetchImpl: identityFetch(9007199254740992) }), { code: 'INVALID_IDENTITY' });
  assert.equal((await queryIdentity('test-only-token', { fetchImpl: identityFetch('9007199254740993') })).account_id, '9007199254740993');
  await assert.rejects(queryIdentity('test-only-token', { fetchImpl: async () => ({ ok: true, json: async () => ({ errno: -6 }) }) }), { code: 'AUTH_INVALID' });
});

test('multiple accounts persist privately; public reports and checks never contain tokens', async t => {
  const h = await fixture(t);
  assert.deepEqual(await listAccounts(h), []);
  await assert.rejects(fs.stat(path.dirname(h.storePath)), { code: 'ENOENT' });
  const first = await saveAuthorization('work', authorization(), { ...h, now, fetchImpl: identityFetch(123) });
  await saveAuthorization('personal', authorization('test-only-second'), { ...h, now, fetchImpl: identityFetch(456) });
  const accounts = await listAccounts(h);
  assert.deepEqual(accounts.map(x => [x.account_ref, x.account_id]), [['work', '123'], ['personal', '456']]);
  const checked = await checkAccount('work', { ...h, now, fetchImpl: identityFetch(123) });
  assert.equal(checked.verified, true);
  assert.equal(JSON.stringify({ first, accounts, checked }).includes('test-only'), false);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(path.dirname(h.storePath))).mode & 0o777, 0o700);
    assert.equal((await fs.stat(h.storePath)).mode & 0o777, 0o600);
  }
});

test('same-account renewal preserves unrelated profiles; alias cannot silently switch accounts', async t => {
  const h = await fixture(t);
  const options = { ...h, now, fetchImpl: identityFetch(123) };
  await saveAuthorization('work', authorization(), options);
  const raw = JSON.parse(await fs.readFile(h.storePath, 'utf8'));
  raw.note = 'preserve'; raw.accounts.work.display_label = '工作';
  await fs.writeFile(h.storePath, JSON.stringify(raw));
  await saveAuthorization('work', authorization('test-only-renewed'), options);
  const before = await fs.readFile(h.storePath, 'utf8');
  const stored = JSON.parse(before);
  assert.equal(stored.note, 'preserve');
  assert.equal(stored.accounts.work.display_label, '工作');
  assert.equal(stored.accounts.work.access_token, 'test-only-renewed');
  await assert.rejects(saveAuthorization('work', authorization('test-only-wrong'), { ...h, now, fetchImpl: identityFetch(999) }), { code: 'ACCOUNT_MISMATCH' });
  assert.equal(await fs.readFile(h.storePath, 'utf8'), before);
  await assert.rejects(checkAccount('work', { ...h, now, fetchImpl: identityFetch(999) }), { code: 'ACCOUNT_MISMATCH' });
});

test('missing, expired and invalid authorization do not fall back or create an auth store', async t => {
  const h = await fixture(t);
  const offline = { ...h, now, fetchImpl: () => { throw Error('must not query'); } };
  await assert.rejects(checkAccount('missing', offline), { code: 'ACCOUNT_MISSING' });
  await assert.rejects(saveAuthorization('work', { ...authorization(), expires_at: 'invalid' }, offline), { code: 'INVALID_AUTHORIZATION' });
  await assert.rejects(saveAuthorization('work', authorization(), { ...h, now, fetchImpl: async () => ({ ok: false }) }), { code: 'IDENTITY_UNAVAILABLE' });
  await assert.rejects(fs.stat(path.dirname(h.storePath)), { code: 'ENOENT' });
  await saveAuthorization('work', authorization(), { ...h, now, fetchImpl: identityFetch(123) });
  await assert.rejects(checkAccount('work', { ...offline, now: now + 3600001 }), { code: 'AUTH_EXPIRED' });
});

test('locks and changes during remote verification prevent lost updates', async t => {
  const h = await fixture(t);
  const options = { ...h, now, fetchImpl: identityFetch(123) };
  await saveAuthorization('work', authorization(), options);
  const original = await fs.readFile(h.storePath, 'utf8');
  const lock = path.join(path.dirname(h.storePath), 'accounts.lock');
  await fs.mkdir(lock, { mode: 0o700 });
  await assert.rejects(saveAuthorization('work', authorization('test-only-new'), options), { code: 'STORE_LOCKED' });
  assert.equal(await fs.readFile(h.storePath, 'utf8'), original);
  await fs.rmdir(lock);
  await assert.rejects(saveAuthorization('work', authorization(), { ...h, now, fetchImpl: async (...args) => {
    await fs.appendFile(h.storePath, '\n');
    return identityFetch(123)(...args);
  } }), { code: 'STORE_CHANGED' });
  assert.equal(await fs.readFile(h.storePath, 'utf8'), original + '\n');
  assert.deepEqual(await fs.readdir(path.dirname(h.storePath)), ['accounts.json']);
});

test('symlinks, corrupt stores and permissive file modes are rejected', async t => {
  const h = await fixture(t);
  const options = { ...h, now, fetchImpl: identityFetch(123) };
  await saveAuthorization('work', authorization(), options);
  if (process.platform !== 'win32') {
    await fs.chmod(h.storePath, 0o644);
    await assert.rejects(listAccounts(h), { code: 'UNSAFE_STORE' });
    await fs.chmod(h.storePath, 0o600);
  }
  await fs.writeFile(h.storePath, '{');
  await assert.rejects(saveAuthorization('work', authorization(), options), { code: 'INVALID_STORE' });
  await fs.rename(h.storePath, path.join(path.dirname(h.storePath), 'original.json'));
  await fs.symlink('original.json', h.storePath);
  await assert.rejects(listAccounts(h), { code: 'UNSAFE_STORE' });
});
