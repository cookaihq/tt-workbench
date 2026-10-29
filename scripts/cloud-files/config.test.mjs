import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_PATH, parseTargets, validateTargets, selectUploadTarget, inspectConfig } from './config.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const targets = { default_account: '工作', remote_parents: { '工作': '/资料/中文 空格/O\'Brien #读书/"课程"', personal: '/私人附件' } };
async function fixture(t) {
  const parent = path.join(repo, 'tmp/cloud-config-tests');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'config'));
  return { root, config: path.join(root, CONFIG_PATH) };
}

test('default and explicit accounts retain their own parents; unknown choices never fall back', () => {
  const parsed = parseTargets(JSON.stringify(targets));
  assert.deepEqual(parsed, targets);
  assert.equal(selectUploadTarget(parsed, undefined, '课程库').remote_parent, targets.remote_parents['工作']);
  assert.equal(selectUploadTarget(parsed, 'personal', '课程库').remote_root, '/私人附件/课程库');
  assert.equal(selectUploadTarget(parsed, 'personal', 'tannt').remote_root, '/私人附件/tannt');
  assert.throws(() => selectUploadTarget(parsed, 'missing'), { code: 'ACCOUNT_UNCONFIGURED' });
  assert.throws(() => selectUploadTarget(parsed, ''), { code: 'ACCOUNT_UNCONFIGURED' });
});

test('an explicit account works without a default; empty targets stay unconfigured', () => {
  const partial = parseTargets(JSON.stringify({ ...targets, default_account: null }));
  assert.equal(selectUploadTarget(partial, 'personal', '资料').account_ref, 'personal');
  assert.throws(() => selectUploadTarget(partial), { code: 'ACCOUNT_UNCONFIGURED' });
  assert.deepEqual(parseTargets('{"default_account":null,"remote_parents":{}}'), { default_account: null, remote_parents: {} });
});

test('remote directory requires an explicit instance choice and cannot escape its account parent', () => {
  for (const name of [undefined, null, '', ' ', ' name', 'name ', '.', '..', '../other', '/other', 'a/b', 'a\\b', 'a\nb', 'a\u007fb']) {
    assert.throws(() => selectUploadTarget(targets, 'personal', name), { code: 'VAULT_DIRECTORY_REQUIRED' });
  }
  const before = JSON.stringify(targets);
  assert.equal(selectUploadTarget(targets, 'personal', '研究 库').remote_root, '/私人附件/研究 库');
  assert.equal(JSON.stringify(targets), before);
});

test('JSONC preserves Unicode, quotes and shell-like text literally, including BOM and CRLF', () => {
  const literal = { default_account: 'work', remote_parents: { work: '/$(echo unsafe)/`echo unsafe`/$HOME' } };
  assert.deepEqual(parseTargets(JSON.stringify(literal, null, 2).replaceAll('\n', '\r\n')), literal);
  assert.deepEqual(parseTargets('\uFEFF' + JSON.stringify(targets)), targets);
});

test('invalid JSONC, schema and paths are rejected without exposing values', () => {
  for (const text of ['', 'TANNT_CLOUD_DEFAULT_ACCOUNT=work', '{"access_token":"test-only-secret",}']) {
    assert.throws(() => parseTargets(text), error => error.code === 'INVALID_JSONC' && !error.message.includes('test-only-secret'));
  }
  for (const value of [null, [], {}, { ...targets, access_token: 'test-only-secret' }, { remote_parents: {} }, { ...targets, default_account: 'missing' }]) {
    assert.throws(() => parseTargets(JSON.stringify(value)), error => error.code === 'INVALID_TARGETS' && !error.message.includes('test-only-secret'));
  }
  for (const parent of ['relative', '/../other', '/a/./b', '/a\\b', '/a\nb']) {
    assert.throws(() => validateTargets({ default_account: 'work', remote_parents: { work: parent } }), { code: 'INVALID_TARGETS' });
  }
});

test('duplicate default keys and account aliases cannot silently replace an earlier target', () => {
  for (const text of [
    '{"default_account":null,"default_account":"work","remote_parents":{"work":"/a"}}',
    '{"default_account":"work","remote_parents":{"work":"/a","work":"/b"}}',
    '{"default_account":"work","remote_parents":{"work":"/a","\\u0077ork":"/b"}}',
  ]) assert.throws(() => parseTargets(text), { code: 'DUPLICATE_KEY' });
});

test('the default entry reads JSONC and preserves comments, content and timestamps', async t => {
  const h = await fixture(t), text = '/* 共享配置 */\n' + JSON.stringify(targets, null, 2) + '\n// 保留备注\n';
  await fs.writeFile(h.config, text);
  const before = await fs.stat(h.config);
  const report = await inspectConfig(h.root);
  assert.equal(report.ok, true);
  assert.equal(report.source, CONFIG_PATH);
  assert.deepEqual(report.targets, targets);
  assert.equal(await fs.readFile(h.config, 'utf8'), text);
  assert.equal((await fs.stat(h.config)).mtimeMs, before.mtimeMs);
  assert.deepEqual(await fs.readdir(h.root), ['config']);
});

test('missing or empty configuration stays explicit, with no fallback or file generation', async t => {
  const h = await fixture(t);
  assert.equal((await inspectConfig(h.root)).state, 'missing');
  assert.deepEqual(await fs.readdir(path.dirname(h.config)), []);
  await fs.writeFile(path.join(h.root, 'config/cloud-storage-targets.json'), JSON.stringify(targets));
  assert.equal((await inspectConfig(h.root)).state, 'missing', 'a stale JSON must not become a second active source');
  await fs.writeFile(h.config, '{"default_account":null,"remote_parents":{}}');
  assert.equal((await inspectConfig(h.root)).state, 'unconfigured');
  assert.deepEqual(await fs.readdir(h.root), ['config']);
});

test('invalid UTF-8 and symlinks are rejected before any configuration is used', async t => {
  const h = await fixture(t);
  await fs.writeFile(h.config, Buffer.from([0xff, 0xfe]));
  await assert.rejects(inspectConfig(h.root), { code: 'INVALID_ENCODING' });
  await fs.writeFile(h.config, JSON.stringify(targets));
  await fs.rename(h.config, path.join(h.root, 'target.json'));
  await fs.symlink('../target.json', h.config);
  await assert.rejects(inspectConfig(h.root), { code: 'INVALID_DIRECTORY' });
});
