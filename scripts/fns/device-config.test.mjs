import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, lstat, symlink, readlink, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deviceIdFromMachineId, inspectDeviceConfig, migrateDeviceConfig } from './device-config.mjs';
import { replaceChecked } from './env-sync-support.mjs';

const deviceId = 'darwin-1111111111111111', secondId = 'win32-2222222222222222';
const raw = JSON.stringify({ apiToken: 'device-A-test-token', configSyncOtherDirs: '',
  syncExcludeFolders: JSON.stringify([{ pattern: '.system/.workbench-runtime/', caseSensitive: false }, {pattern: '.system/workbench/', caseSensitive: false}]),
  unknownFutureSetting: { preserve: true } }) + '\n';
const run = promisify(execFile);
async function fixture(t, contents = raw) {
  const base = fileURLToPath(new URL('../../tmp/fns-validation/', import.meta.url));
  await mkdir(base, { recursive: true });
  const vault = await mkdtemp(path.join(base, 'device-'));
  t.after(() => rm(vault, { recursive: true, force: true }));
  const configDir = 'obsidian-settings';
  const source = path.join(vault, configDir, 'plugins/fast-note-sync/data.json');
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(path.join(vault, configDir, 'community-plugins.json'), '[]');
  if (contents !== null) await writeFile(source, contents);
  const old = path.join(vault, 'config/fns-config', deviceId, 'data.json');
  return { options: { vault, configDir, deviceId }, vault, source, old };
}
async function linked(t, { absolute = false, legacy = false, contents = raw } = {}) {
  const f = await fixture(t, null);
  if (legacy) f.old = path.join(f.vault, '.fns-config', deviceId, 'data.json');
  await mkdir(path.dirname(f.old), { recursive: true });
  await writeFile(f.old, contents);
  await symlink(absolute ? f.old : path.relative(path.dirname(f.source), f.old), f.source, 'file');
  return f;
}

test('device identity is stable and independent of hostname', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  assert.equal(deviceIdFromMachineId('darwin', id), deviceIdFromMachineId('darwin', id.toUpperCase()));
  assert.notEqual(deviceIdFromMachineId('darwin', id), deviceIdFromMachineId('win32', id));
  assert.throws(() => deviceIdFromMachineId('darwin', 'bogon'));
});

test('ordinary configuration is ready without relocation, extra exclusions or side effects', async t => {
  const f = await fixture(t, JSON.stringify({ apiToken: 'local', syncExcludeFolders: '' }));
  const before = await readdir(f.vault), contents = await readFile(f.source);
  assert.equal((await inspectDeviceConfig(f.options)).status, 'ready');
  assert.equal((await migrateDeviceConfig(f.options)).changed, false);
  assert.deepEqual(await readFile(f.source), contents);
  assert.deepEqual(await readdir(f.vault), before);
  assert.equal((await lstat(f.source)).isSymbolicLink(), false);
});

test('missing config does not borrow a downloaded profile', async t => {
  const f = await fixture(t, null);
  await mkdir(path.dirname(f.old), { recursive: true }); await writeFile(f.old, raw);
  assert.equal((await migrateDeviceConfig(f.options)).status, 'missing-config');
  await assert.rejects(lstat(f.source), { code: 'ENOENT' });
});

for (const options of [{}, { absolute: true }, { legacy: true }]) {
  test(`migration restores exact bytes to the plugin file and removes only its old source ${JSON.stringify(options)}`, async t => {
    const f = await linked(t, options), before = await readdir(f.vault);
    assert.equal((await inspectDeviceConfig(f.options)).status, 'needs-migration');
    assert.deepEqual(await readdir(f.vault), before);
    const other = path.join(path.dirname(path.dirname(f.old)), secondId, 'data.json');
    await mkdir(path.dirname(other)); await writeFile(other, 'other-device-sentinel');
    const result = await migrateDeviceConfig(f.options);
    assert.equal(result.status, 'ready'); assert.equal(result.contentPreserved, true);
    assert.deepEqual(result.changedFields, []);
    assert.equal((await lstat(f.source)).isSymbolicLink(), false);
    assert.equal(await readFile(f.source, 'utf8'), raw);
    assert.equal(await readFile(path.join(f.vault, result.recovery, 'source.before.json'), 'utf8'), raw);
    assert.equal(JSON.parse(await readFile(path.join(f.vault, result.recovery, 'receipt.json'))).phase, 'complete');
    await assert.rejects(lstat(f.old), { code: 'ENOENT' });
    assert.equal(await readFile(other, 'utf8'), 'other-device-sentinel');
    assert.match(await readFile(path.join(f.vault, '.gitignore'), 'utf8'), /\/obsidian-settings\/plugins\/fast-note-sync\/data.json/);
    assert.equal((await migrateDeviceConfig(f.options)).changed, false);
    assert.ok(!JSON.stringify(result).includes('device-A-test-token'));
    await writeFile(f.source, raw.replace('preserve":true', 'preserve":false'));
    assert.equal((await lstat(f.source)).isSymbolicLink(), false);
    await assert.rejects(lstat(f.old), { code: 'ENOENT' });
  });
}

test('stale profiles cannot override an existing ordinary local file', async t => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.old), { recursive: true }); await writeFile(f.old, '{"apiToken":"old"}');
  assert.equal((await migrateDeviceConfig(f.options)).status, 'ready');
  assert.equal(await readFile(f.source, 'utf8'), raw);
  assert.equal(await readFile(f.old, 'utf8'), '{"apiToken":"old"}');
});

test('broken, foreign and indirect links are preserved', async t => {
  const f = await linked(t);
  await rm(f.old);
  assert.equal((await migrateDeviceConfig(f.options)).status, 'broken-link');
  const original = await readlink(f.source);
  await symlink('unknown', f.old);
  assert.equal((await migrateDeviceConfig(f.options)).status, 'conflict');
  assert.equal(await readlink(f.source), original);
  await rm(f.source); await symlink(path.join(f.vault, 'unknown.json'), f.source);
  assert.equal((await migrateDeviceConfig(f.options)).status, 'foreign-link');
});

test('running FNS blocks migration without changing either file', async t => {
  const f = await linked(t);
  await writeFile(path.join(f.vault, f.options.configDir, 'community-plugins.json'), '["fast-note-sync"]');
  await assert.rejects(migrateDeviceConfig(f.options), /暂时停用 FNS/);
  assert.ok((await lstat(f.source)).isSymbolicLink());
  assert.equal(await readFile(f.old, 'utf8'), raw);
});

test('invalid JSON and duplicate keys do not expose input in errors', async t => {
  for (const value of ['{"apiToken":"secret-sentinel",broken', '{"apiToken":"secret-sentinel","apiToken":"twice"}']) {
    const f = await fixture(t, value);
    await assert.rejects(inspectDeviceConfig(f.options), error => /JSON/.test(error.message) && !error.message.includes('secret-sentinel'));
  }
});

test('migration rejects linked directories and unprotected recovery storage', async t => {
  const f = await linked(t);
  await rm(path.dirname(f.old), { recursive: true });
  const elsewhere = path.join(f.vault, 'elsewhere'); await mkdir(elsewhere); await writeFile(path.join(elsewhere, 'data.json'), raw);
  await symlink(elsewhere, path.dirname(f.old), 'dir');
  await assert.rejects(migrateDeviceConfig(f.options), /普通文件或目录/);
  const g = await linked(t, { contents: '{"syncExcludeFolders":""}' });
  await assert.rejects(migrateDeviceConfig(g.options), /明确目录排除/);
  assert.ok((await lstat(g.source)).isSymbolicLink());
});

test('Git-tracked local entry and unignored backups are rejected', async t => {
  const f = await linked(t);
  await run('git', ['init', '--quiet', f.vault]);
  await assert.rejects(migrateDeviceConfig(f.options), /整体排除 Git/);
  await writeFile(path.join(f.vault, '.gitignore'), '/.system/.workbench-runtime/\n');
  await run('git', ['add', '--', path.relative(f.vault, f.source)], { cwd: f.vault });
  await assert.rejects(migrateDeviceConfig(f.options), /已被 Git 跟踪/);
  assert.ok((await lstat(f.source)).isSymbolicLink());
  assert.equal(await readFile(f.old, 'utf8'), raw);
});

test('maintenance updates ordinary settings and rejects stale writes or legacy links', async t => {
  const f = await linked(t);
  const result = await migrateDeviceConfig(f.options), recovery = path.join(f.vault, result.recovery);
  const updated = raw.replace('preserve":true', 'preserve":false');
  await replaceChecked(f.source, raw, updated, recovery);
  assert.equal(await readFile(f.source, 'utf8'), updated);
  await assert.rejects(replaceChecked(f.source, raw, 'stale', recovery), /已变化/);
  await replaceChecked(f.source, updated, raw, recovery);
  assert.equal((await lstat(f.source)).isSymbolicLink(), false);
  const g = await linked(t);
  await assert.rejects(replaceChecked(g.source, raw, updated, recovery), /普通文件/);
  assert.equal(await readFile(g.old, 'utf8'), raw);
});
