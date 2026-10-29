'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { randomUUID } = require('node:crypto');
const { ROOT, LEGACY, withRuntime } = require('../storage.cjs');
const { inspect, migrate, inventory } = require('../migrate.cjs');
const { execute } = require('../../vault/api.js');
const { IssueStore } = require('../../../apps/workbench/issues.js');
const packages = require('../../workbench/package.cjs');
const repo = path.resolve(__dirname, '../../..');
async function fixture(t) {
  const parent = path.join(repo, 'tmp/runtime-storage-tests');
  await fs.mkdir(parent, { recursive: true });
  const base = await fs.mkdtemp(path.join(parent, 'run-')), vault = path.join(base, '知识库');
  await fs.mkdir(vault);
  t.after(async () => { assert.equal(path.dirname(base), parent); await fs.rm(base, { recursive: true, force: true }); });
  await exec('git', ['init', '-q'], { cwd: vault });
  await fs.writeFile(path.join(vault, '.gitignore'), `/${ROOT}/\n/.system/workbench/\n/${LEGACY}/\n/apps/\n`);
  const put = async (name, content = '历史原始字节\r\n') => { const file = path.join(vault, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  const options = { vault, backup: path.join(base, 'backup'), writersStopped: true };
  const apply = async (extra = {}) => migrate({ ...options, expected: (await inspect({ ...options, ...extra })).fingerprint, ...extra });
  return { base, vault, put, options, apply };
}
test('read-only inspection and CLI leave fresh and legacy instances untouched', async t => {
  const h = await fixture(t);
  assert.equal((await inspect(h.options)).status, 'ready');
  await execute(h.vault, { action: 'info', list: true }, { configDir: 'custom/settings' });
  await new IssueStore(h.vault).list();
  assert.equal(await fs.stat(path.join(h.vault, ROOT)).catch(() => null), null);
  await h.put(`${LEGACY}/fns-sync/state.json`, '{}');
  const before = await inventory(h.vault, LEGACY);
  const run = await exec(process.execPath, [path.join(repo, 'scripts/workbench/runtime-storage.mjs'), '--vault', h.vault, '--check']);
  assert.equal(JSON.parse(run.stdout).status, 'needs-migration');
  assert.deepEqual(await inventory(h.vault, LEGACY), before);
  assert.equal(await fs.stat(path.join(h.vault, ROOT)).catch(() => null), null);
  await assert.rejects(execute(h.vault, { action: 'capture', request_id: randomUUID(), privacy: 'ordinary', content: 'synthetic' }), { code: 'RUNTIME_MIGRATION_REQUIRED' });
});
test('all known history migrates byte-for-byte, resumes and restores without overwriting', async t => {
  const h = await fixture(t);
  for (const component of ['vault-io/requests', 'issues/operations/id', 'fns-device-config/id', 'fns-sync', 'workbench-code-sync/id', 'fns-env-support/id', 'agent-skills']) await h.put(`${LEGACY}/${component}/record.json`);
  await h.put(`${ROOT}/agent-skills/new.json`, 'new data');
  const before = await inventory(h.vault, LEGACY);
  const result = await h.apply(); assert.equal(result.files, 7); assert.equal(result.appsRemoved, true);
  for (const file of before.files) assert.equal((await fs.readFile(path.join(h.vault, ROOT, file.path))).toString(), '历史原始字节\r\n');
  assert.equal((await h.apply()).changed, false);
  assert.equal((await h.apply({ resume: true })).status, 'complete');
  assert.equal((await h.apply({ restore: true })).status, 'restored');
  assert.deepEqual((await inventory(h.vault, LEGACY)).files, before.files);
  assert.equal(await fs.readFile(path.join(h.vault, ROOT, 'agent-skills/new.json'), 'utf8'), 'new data');
  assert.equal((await h.apply({ resume: true })).status, 'complete');
  await h.put(`${ROOT}/fns-sync/record.json`, 'later change');
  await assert.rejects(h.apply({ restore: true }), { code: 'SOURCE_CHANGED' });
  assert.equal(await fs.readFile(path.join(h.vault, ROOT, 'fns-sync/record.json'), 'utf8'), 'later change');
});
test('copy interruption preserves source and resumes from verified backup', async t => {
  const h = await fixture(t); await h.put(`${LEGACY}/vault-io/requests/request.json`);
  await assert.rejects(h.apply({ afterCopy() { throw Error('simulated interruption'); } }), /simulated interruption/);
  assert.equal(JSON.parse(await fs.readFile(path.join(h.options.backup, 'manifest.json'))).phase, 'copy');
  assert.ok(await fs.stat(path.join(h.vault, LEGACY)));
  assert.equal((await h.apply({ resume: true })).status, 'complete');
});
test('process exit leaves a verifiable gate; resume only reclaims the dead owner', async t => {
  const h = await fixture(t); await h.put(`${LEGACY}/fns-sync/state.json`, '{}');
  const options = { ...h.options, expected: (await inspect(h.options)).fingerprint };
  const code = `require(${JSON.stringify(path.join(repo, 'lib/runtime/migrate.cjs'))}).migrate({...${JSON.stringify(options)}, afterCopy(){process.exit(73)}}).catch(()=>process.exit(74))`;
  await assert.rejects(exec(process.execPath, ['-e', code]), e => e.code === 73);
  assert.ok(await fs.stat(path.join(h.vault, ROOT, 'migration.lock')));
  assert.equal((await h.apply({ resume: true })).status, 'complete');
});
test('historical FNS recovery paths resolve without modifying saved bytes', () => {
  const { validateState } = require('../../fns/state.cjs');
  const id = randomUUID(), state = { schema: 1, deviceId: 'win32-1111111111111111', configDir: 'custom', recovery: `${LEGACY}/fns-sync/operations/${id}` };
  const raw = JSON.stringify(state);
  assert.equal(validateState(state, state.deviceId, 'custom').recovery, `${ROOT}/fns-sync/operations/${id}`);
  assert.equal(JSON.stringify(state), raw);
  assert.throws(() => validateState(state, state.deviceId, '.obsidian'), { code: 'INVALID_STATE' });
});
test('unknown files, links, active locks, stale plans and differing targets are preserved', async t => {
  for (const kind of ['unknown', 'lock', 'bridge', 'conflict', 'link', 'stale']) {
    const h = await fixture(t); await h.put(`${LEGACY}/fns-sync/state.json`, '{}');
    const plan = await inspect(h.options);
    if (kind === 'unknown') await h.put(`${LEGACY}/foreign.txt`);
    if (kind === 'lock') await h.put(`${LEGACY}/fns-sync/operation.lock`, JSON.stringify({ pid: process.pid }));
    if (kind === 'bridge') await h.put(`${LEGACY}/agent-bridge.json`, JSON.stringify({ pid: process.pid }));
    if (kind === 'conflict') await h.put(`${ROOT}/fns-sync/state.json`, 'different');
    if (kind === 'link') await fs.symlink(h.base, path.join(h.vault, LEGACY, 'foreign'), 'junction');
    if (kind === 'stale') await h.put(`${LEGACY}/fns-sync/later.json`);
    await assert.rejects(kind === 'stale' ? migrate({ ...h.options, expected: plan.fingerprint }) : h.apply());
    assert.equal(await fs.readFile(path.join(h.vault, LEGACY, 'fns-sync/state.json'), 'utf8'), '{}');
  }
});
test('late source changes stop cleanup and leave both copies recoverable', async t => {
  const h = await fixture(t); await h.put(`${LEGACY}/fns-sync/state.json`, 'old');
  await assert.rejects(h.apply({ afterCopy: () => h.put(`${LEGACY}/fns-sync/state.json`, 'new') }), { code: 'SOURCE_CHANGED' });
  assert.equal(await fs.readFile(path.join(h.vault, LEGACY, 'fns-sync/state.json'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(h.vault, ROOT, 'fns-sync/state.json'), 'utf8'), 'old');
  await assert.rejects(h.apply({ resume: true }), { code: 'TARGET_CONFLICT' });
});
test('Git and custom FNS exclusions are mandatory; whitelist cannot bypass protection', async t => {
  const h = await fixture(t); await h.put(`${LEGACY}/fns-sync/state.json`, '{}');
  await fs.writeFile(path.join(h.vault, '.gitignore'), `/${LEGACY}/\n`);
  await assert.rejects(h.apply(), { code: 'UNSAFE_STORAGE' });
  await fs.writeFile(path.join(h.vault, '.gitignore'), `/${LEGACY}/\n/${ROOT}/\n/.system/workbench/\n/apps/\n`);
  const configDir = 'custom/settings', config = { syncExcludeFolders: JSON.stringify([LEGACY]), syncExcludeWhitelist: '' };
  await h.put(`${configDir}/plugins/fast-note-sync/data.json`, JSON.stringify(config));
  await assert.rejects(h.apply({ configDir }), { code: 'PROTECTED_SCOPE' });
  config.syncExcludeFolders = JSON.stringify(['.system/workbench', '^apps(?:/|$)', '^\\.system/\\.workbench-runtime(?:/|$)']);
  config.syncExcludeWhitelist = '.*';
  await h.put(`${configDir}/plugins/fast-note-sync/data.json`, JSON.stringify(config));
  await assert.rejects(h.apply({ configDir }), { code: 'PROTECTED_SCOPE' });
  config.syncExcludeWhitelist = '';
  await h.put(`${configDir}/plugins/fast-note-sync/data.json`, JSON.stringify(config));
  const plan = await inspect({ ...h.options, configDir });
  assert.equal((await h.apply({ configDir, expected: plan.fingerprint })).status, 'complete');
});
test('migration rejects live writers; a migration gate blocks new writes', async t => {
  const h = await fixture(t);
  await withRuntime(h.vault, async () => {
    await h.put(`${LEGACY}/fns-sync/state.json`, '{}');
    await assert.rejects(h.apply(), { code: 'ACTIVE_RECORDS' });
  });
  await h.apply();
  await h.put(`${ROOT}/migration.lock`, '{}');
  await assert.rejects(withRuntime(h.vault, () => assert.fail('must not write')), { code: 'RUNTIME_BUSY' });
});

test('retiring the old apps tree requires FNS to exclude its parent folders', async t => {
  const h = await fixture(t);
  await h.put(`${LEGACY}/fns-sync/state.json`, '{}');
  const config = { syncExcludeFolders: JSON.stringify(['.system/workbench', 'apps/workbench', '^\\.system/\\.workbench-runtime(?:/|$)']) };
  await h.put('.obsidian/plugins/fast-note-sync/data.json', JSON.stringify(config));
  await assert.rejects(h.apply(), { code: 'PROTECTED_SCOPE' });
  config.syncExcludeFolders = JSON.stringify(['.system/workbench', '^apps(?:/|$)', '^\\.system/\\.workbench-runtime(?:/|$)']);
  await h.put('.obsidian/plugins/fast-note-sync/data.json', JSON.stringify(config));
  assert.equal((await h.apply()).appsRemoved, true);
  const other = await fixture(t);
  await other.put(`${LEGACY}/fns-sync/state.json`, '{}');
  await other.put('apps/another-app/keep.txt', 'unrelated');
  config.syncExcludeFolders = JSON.stringify(['.system/workbench', 'apps/workbench', '^\\.system/\\.workbench-runtime(?:/|$)']);
  await other.put('.obsidian/plugins/fast-note-sync/data.json', JSON.stringify(config));
  assert.equal((await other.apply()).appsRemoved, false);
  assert.equal(await fs.readFile(path.join(other.vault, 'apps/another-app/keep.txt'), 'utf8'), 'unrelated');
});
test('notes and development issues use their own roots; custom configuration shares note locks', async t => {
  const h = await fixture(t), second = await fixture(t);
  const request = { action: 'capture', request_id: randomUUID(), privacy: 'ordinary', content: '合成验收内容', title: '路径验收' };
  const created = await execute(h.vault, request, { configDir: 'custom/settings' });
  assert.equal((await execute(h.vault, request)).reused, true);
  assert.ok(await fs.stat(path.join(h.vault, ROOT, 'vault-io/requests', request.request_id + '.json')));
  const store = new IssueStore(second.vault);
  const issue = await store.create({ feature: 'fixture', title: '合成 Issue', description: 'fixture', actor: 'Agent' });
  await store.update(issue.path, issue.content, { action: 'metadata', triage: 'ready-for-agent', actor: 'Agent' });
  assert.ok(await fs.stat(path.join(second.vault, ROOT, 'issues/operations')));
  assert.equal(await fs.stat(path.join(h.vault, ROOT, 'issues')).catch(() => null), null);
  for (const vault of [h.vault, second.vault]) assert.equal(await fs.stat(path.join(vault, 'apps')).catch(() => null), null);
  assert.equal((await execute(h.vault, { action: 'read', path: created.path })).ok, true);
});
test('installation, upgrade and installed CLI preserve instance runtime and require explicit target', async t => {
  const h = await fixture(t); const bundle = await packages.collectPackage(repo);
  await h.put(`${ROOT}/fns-sync/history.json`, 'keep runtime');
  await h.put(`${LEGACY}/issues/operations/id/before.md`, 'legacy remains until explicit migration');
  const configDir = 'custom/settings';
  const installed = await packages.installPackage(bundle, { vault: h.vault, configDir });
  await packages.installPackage(bundle, { vault: h.vault, configDir });
  const result = await exec(process.execPath, [path.join(installed.target, 'scripts/workbench/runtime-storage.mjs'), '--vault', h.vault, '--config-dir', configDir, '--check']);
  assert.equal(JSON.parse(result.stdout).status, 'needs-migration');
  assert.equal(await fs.readFile(path.join(h.vault, ROOT, 'fns-sync/history.json'), 'utf8'), 'keep runtime');
  assert.equal(await fs.readFile(path.join(h.vault, LEGACY, 'issues/operations/id/before.md'), 'utf8'), 'legacy remains until explicit migration');
  await assert.rejects(exec(process.execPath, [path.join(installed.target, 'scripts/workbench/runtime-storage.mjs'), '--check']));
});
