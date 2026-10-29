'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const packages = require('../../../lib/workbench/package.cjs');
const base = path.resolve(__dirname, '../../../tmp/rename-tests');
function bundle(id, version = '0.25.0') {
  const files = new Map(Object.entries({ 'manifest.json': JSON.stringify({ id, version }), 'main.js': 'module.exports = {};', 'styles.css': '/* workbench */' }).map(([name, text]) => [name, Buffer.from(text)]));
  return { files, release: { schema: 1, id, version, files: Object.fromEntries([...files].map(([name, bytes]) => [name, packages.hash(bytes)])) } };
}
async function fixture(t) {
  await fs.mkdir(base, { recursive: true });
  const vault = await fs.mkdtemp(path.join(base, 'vault-'));
  t.after(async () => { assert.equal(path.dirname(vault), base); await fs.rm(vault, { recursive: true, force: true }); });
  const configDir = 'custom-settings', legacy = path.join(vault, configDir, 'plugins/tannt-workbench');
  await fs.mkdir(legacy, { recursive: true });
  const previous = bundle(packages.LEGACY_ID, '0.24.0');
  for (const [name, bytes] of previous.files) await fs.writeFile(path.join(legacy, name), bytes);
  await fs.writeFile(path.join(legacy, 'release.json'), JSON.stringify(previous.release));
  const settings = '{"updateRepository":"example/repo","rulesSource":"D:/my-rules"}\n';
  await fs.writeFile(path.join(legacy, 'data.json'), settings);
  return { vault, configDir, legacy, settings, next: bundle(packages.ID) };
}
test('旧 ID 只读预检及显式迁移：保留设置、完整恢复目录和库外入口，随后可正常更新', async t => {
  const h = await fixture(t), options = { vault: h.vault, configDir: h.configDir };
  const workspace = path.join(h.vault, h.configDir, 'workspace.json'), enabled = path.join(h.vault, h.configDir, 'community-plugins.json');
  await fs.writeFile(workspace, '{"type":"tannt-workbench"}'); await fs.writeFile(enabled, '["tannt-workbench"]');
  const before = packages.fingerprint(await packages.readTree(h.vault));
  const preview = await packages.installPackage(h.next, { ...options, check: true });
  assert.equal(preview.ok, false); assert.equal(preview.migration.from, h.legacy);
  await assert.rejects(packages.installPackage(h.next, options), { code: 'LEGACY_MIGRATION_REQUIRED' });
  assert.equal(packages.fingerprint(await packages.readTree(h.vault)), before);
  const result = await packages.installPackage(h.next, { ...options, migrateLegacy: true });
  assert.equal(result.ok, true); assert.equal(path.basename(result.target), 'tt-workbench');
  assert.equal(await fs.readFile(path.join(result.target, 'data.json'), 'utf8'), h.settings);
  assert.equal(await fs.readFile(path.join(result.recovery, 'data.json'), 'utf8'), h.settings);
  assert.equal(JSON.parse(await fs.readFile(path.join(result.recovery, 'manifest.json'))).id, 'tannt-workbench');
  await assert.rejects(fs.stat(h.legacy), { code: 'ENOENT' });
  assert.equal(await fs.readFile(enabled, 'utf8'), '["tannt-workbench"]');
  assert.equal(await fs.readFile(workspace, 'utf8'), '{"type":"tannt-workbench"}');
  assert.equal((await packages.installPackage(h.next, { ...options, check: true })).ok, true);
  assert.equal((await packages.installPackage(bundle(packages.ID, '0.25.1'), options)).ok, true);
});
test('旧包只用于核验迁移基线，不能作为新 ID 的安装包', () => {
  assert.throws(() => packages.decodeBundle(packages.encodeBundle(bundle(packages.LEGACY_ID))), { code: 'INVALID_PACKAGE' });
});
test('旧目录被修改、没有基线或新旧目录共存时保留现场', async t => {
  for (const kind of ['changed', 'no-baseline', 'both']) {
    const h = await fixture(t);
    if (kind === 'changed') await fs.writeFile(path.join(h.legacy, 'main.js'), 'local edit');
    if (kind === 'no-baseline') await fs.unlink(path.join(h.legacy, 'release.json'));
    if (kind === 'both') await fs.mkdir(path.join(h.vault, h.configDir, 'plugins/tt-workbench'));
    const before = packages.fingerprint(await packages.readTree(h.vault));
    await assert.rejects(packages.installPackage(h.next, { vault: h.vault, configDir: h.configDir, migrateLegacy: true }), { code: { changed: 'LOCAL_CHANGES', 'no-baseline': 'NO_BASELINE', both: 'LEGACY_CONFLICT' }[kind] });
    assert.equal(packages.fingerprint(await packages.readTree(h.vault)), before);
  }
});
test('迁移遵守旧安装锁，并在替换前拒绝并发设置变化或新目录占位', async t => {
  const h = await fixture(t), options = { vault: h.vault, configDir: h.configDir, migrateLegacy: true };
  const lock = path.join(path.dirname(h.legacy), 'tannt-workbench.install-lock');
  await fs.writeFile(lock, 'old installer');
  await assert.rejects(packages.installPackage(h.next, options), { code: 'EEXIST' });
  assert.equal(await fs.readFile(lock, 'utf8'), 'old installer'); await fs.unlink(lock);
  await assert.rejects(packages.installPackage(h.next, { ...options, beforeReplace: () => fs.writeFile(path.join(h.legacy, 'data.json'), 'external settings') }), { code: 'LOCAL_CHANGES' });
  assert.equal(await fs.readFile(path.join(h.legacy, 'data.json'), 'utf8'), 'external settings');
  const target = path.join(path.dirname(h.legacy), 'tt-workbench');
  await assert.rejects(packages.installPackage(h.next, { ...options, beforeReplace: async () => { await fs.mkdir(target); await fs.writeFile(path.join(target, 'keep'), 'external'); } }), { code: 'LOCAL_CHANGES' });
  assert.equal(await fs.readFile(path.join(target, 'keep'), 'utf8'), 'external');
  assert.equal(await fs.readFile(path.join(h.legacy, 'data.json'), 'utf8'), 'external settings');
});
