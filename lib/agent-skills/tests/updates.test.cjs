'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture, skill, workbench, remote } = require('./fixtures.cjs');
const core = require('../../workbench/package.cjs');
const { SkillManager } = require('../manager.cjs');
const { SkillUpdates } = require('../updates.cjs');
const { buildRelease } = require('../releases.cjs');
const { WorkbenchUpdates } = require('../../../apps/workbench/updates.js');
async function setup(t) {
  const h = await fixture(t); await core.installPackage(workbench(), h);
  const manager = new SkillManager(h), r = remote(); let next = skill();
  const build = (batch, previousRaw) => buildRelease({ root: h.packageRoot, batch, previousRaw, names: ['one'], repository: 'example/workbench', collect: async () => next });
  const first = await build('skills-20261031.1'); r.add(first); next = skill('one', '1.1.0');
  const second = await build('skills-20261031.2', first.raw); r.add(second);
  const updates = new SkillUpdates({ manager, repository: 'example/workbench', workbenchVersion: '0.26.0', request: r.request });
  return { ...h, manager, r, updates, first, second };
}
test('检查更新只读，下载固定附件并校验后更新；页面版本来自实际安装元数据', async t => {
  const h = await setup(t); await h.manager.apply({});
  const before = await core.readTree(h.packageRoot); assert.equal((await h.updates.check()).kind, 'ready');
  assert.equal(core.fingerprint(await core.readTree(h.packageRoot)), core.fingerprint(before));
  const item = (await h.manager.scan()).items[0], update = h.updates.forItem(item, 'codex');
  assert.equal(update.version, '1.1.0'); assert.equal(update.kind, 'available'); assert.match(update.notes, /1.1.0/);
  const result = await h.updates.install({ name: 'one', agent: 'codex', expected: item.token });
  assert.equal(result.snapshot.items[0].installedVersion, '1.1.0');
  assert.equal(h.updates.forItem(result.snapshot.items[0], 'codex').kind, 'current');
  assert.match(await fs.readFile(path.join(h.packageRoot, 'skills/one/SKILL.md'), 'utf8'), /version: "1.1.0"/);
});
test('同一联合 Release 同时被两种更新器识别，先升级工作台再单独采用 Skill 新版', async t => {
  const h = await setup(t); await h.manager.apply({});
  const next = skill('one', '1.2.0', 'combined release', { workbench: '0.27.0' });
  const combined = await buildRelease({ root: h.packageRoot, repository: 'example/workbench', batch: 'v0.27.0', names: ['one'], previousRaw: h.second.raw, collect: async () => next });
  const bundle = workbench('0.27.0', [next]);
  bundle.release.skillSource = { kind: 'release', batch: 'v0.27.0', sha256: core.hash(combined.raw) };
  combined.coreArtifacts = new Map([['release.json', Buffer.from(JSON.stringify(bundle.release))], ['tt-workbench.bundle.json.gz', core.encodeBundle(bundle)]]);
  h.r.add(combined);
  await h.updates.check();
  assert.equal(h.updates.forItem((await h.manager.scan()).items[0], 'codex').kind, 'incompatible');
  const updates = new WorkbenchUpdates({ vault: h.vault, configDir: h.configDir, version: '0.26.0', appVersion: '1.14.5', repository: 'example/workbench', request: h.r.request });
  assert.equal((await updates.check()).kind, 'available');
  assert.equal((await updates.install()).kind, 'installed');
  assert.equal((await h.manager.scan()).items[0].installedVersion, '1.0.0');
  const skillUpdates = new SkillUpdates({ manager: h.manager, workbenchVersion: '0.27.0', repository: 'example/workbench', request: h.r.request });
  assert.equal((await skillUpdates.check()).kind, 'ready');
  assert.equal((await skillUpdates.install({ name: 'one', agent: 'codex' })).snapshot.items[0].installedVersion, '1.2.0');
});
test('查询失败不显示最新；下载损坏和检查后入口变化保留原可用版本', async t => {
  const h = await setup(t); await h.manager.apply({}); await h.updates.check();
  const item = (await h.manager.scan()).items[0];
  const downloadId = Number(h.updates.status.downloads.one.split('/').at(-1)); h.r.assets.set(downloadId, Buffer.from('bad'));
  await assert.rejects(h.updates.install({ name: 'one', expected: item.token }), { code: 'VERIFY_FAILED' });
  assert.equal((await h.manager.scan()).items[0].installedVersion, '1.0.0');
  h.updates.request = async () => { throw Error('offline'); };
  assert.equal((await h.updates.check()).kind, 'error'); assert.equal(h.updates.forItem(item, 'codex').kind, 'unknown');
  await assert.rejects(h.updates.install({ name: 'one' }), { code: 'CHECK_REQUIRED' });
});
test('未注册时更新安装资源不擅自注册，已有同名冲突也不会被更新入口覆盖', async t => {
  const h = await setup(t); await h.updates.check();
  await h.updates.install({ name: 'one', agent: 'codex' });
  const item = (await h.manager.scan()).items[0]; assert.equal(item.status, 'absent'); assert.equal(item.resourceVersion, '1.1.0'); assert.equal(item.installedVersion, null);
  await assert.rejects(fs.stat(path.join(h.vault, '.agents/skills/one')), { code: 'ENOENT' });
  await fs.mkdir(path.join(h.vault, '.agents/skills'), { recursive: true }); await fs.writeFile(path.join(h.vault, '.agents/skills/one'), 'user content');
  await assert.rejects(h.updates.install({ name: 'one', agent: 'codex' }), { code: 'ENTRY_NOT_READY' });
  assert.equal(await fs.readFile(path.join(h.vault, '.agents/skills/one'), 'utf8'), 'user content');
});
test('Skill 下载限流后保留原版本，再次检查和更新不能提前联网', async t => {
  const h = await setup(t); await h.manager.apply({}); await h.updates.check();
  let calls = 0;
  h.updates.request = async () => { calls++; throw Object.assign(Error('cooldown'), { code: 'RATE_LIMITED', retryAfter: new Date(Date.now() + 60000).toISOString() }); };
  await assert.rejects(h.updates.install({ name: 'one' }), { code: 'RATE_LIMITED' });
  assert.equal((await h.updates.check()).kind, 'error');
  await assert.rejects(h.updates.install({ name: 'one' }), { code: 'CHECK_REQUIRED' });
  assert.equal(calls, 1); assert.equal((await h.manager.scan()).items[0].installedVersion, '1.0.0');
});
