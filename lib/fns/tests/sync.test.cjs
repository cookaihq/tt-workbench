'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { FnsSyncService } = require('../sync.cjs');
const run = promisify(execFile);
const git = async (cwd, ...args) => (await run('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })).stdout.trim();
const rule = pattern => ({ pattern, caseSensitive: false });
const note = (reason, pattern = '.agents', field = 'configSyncOtherDirs') => ({ field, pattern, caseSensitive: false, reason });
const saveNotes = async (service, notes) => service.saveNotes((await service.inspect()).notes.expected, notes);
const settings = (token, dirs = ['.agents'], extensions = ['pdf']) => ({
  apiToken: token, server: 'device-specific', configSyncEnabled: true,
  configSyncOtherDirs: JSON.stringify(dirs.map(rule)),
  syncExcludeFolders: JSON.stringify(['^config/fns-config(?:/|$)', 'apps/workbench/data/'].map(rule)),
  syncExcludeExtensions: JSON.stringify(extensions.map(rule)), syncExcludeWhitelist: '',
  futureSetting: { preserve: true }
});

async function device(root, deviceId, config) {
  const configDir = 'obsidian-settings', pluginDir = path.join(root, configDir, 'plugins/fast-note-sync');
  const target = path.join(pluginDir, 'data.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(target, JSON.stringify(config));
  await fs.writeFile(path.join(pluginDir, 'manifest.json'), JSON.stringify({ version: '2.4.0' }));
  await fs.writeFile(path.join(root, configDir, 'community-plugins.json'), '["fast-note-sync"]');
  await fs.writeFile(path.join(root, '.gitignore'), '/apps/workbench/data/\n/obsidian-settings/\n');
  let runtimeSettings = structuredClone(config), enabled = true;
  const runtime = {
    async inspect() { return { enabled, loaded: enabled, settings: runtimeSettings }; },
    async suspend() { const previous = { enabled }; enabled = false; await fs.writeFile(path.join(root, configDir, 'community-plugins.json'), '[]'); return previous; },
    async restore(previous) { enabled = previous.enabled; runtimeSettings = JSON.parse(await fs.readFile(target)); await fs.writeFile(path.join(root, configDir, 'community-plugins.json'), JSON.stringify(enabled ? ['fast-note-sync'] : [])); }
  };
  return { root, target, configDir, deviceId, runtime, service: new FnsSyncService({ vault: root, configDir, deviceId, runtime }), read: async () => JSON.parse(await fs.readFile(target)) };
}

async function pair(t) {
  const f = await fixture(t), remote = path.join(f.root, 'remote.git');
  await git(f.root, 'init', '--bare', remote);
  const devices = [];
  for (const [name, id, config] of [['a', 'darwin-1111111111111111', settings('A-test', ['.agents', '.claudian'], [])], ['b', 'win32-2222222222222222', settings('B-test')]]) {
    const root = path.join(f.root, name); await fs.mkdir(root);
    await git(root, 'init', '-b', 'main');
    await git(root, 'config', 'user.name', 'FNS test'); await git(root, 'config', 'user.email', 'fns@example.invalid');
    await git(root, 'remote', 'add', 'origin', remote);
    devices.push(await device(root, id, config));
  }
  return { ...f, remote, a: devices[0], b: devices[1] };
}

async function fixture(t) {
  const base = path.resolve(__dirname, '../../../apps/workbench/data/fns-sync-validation');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'run-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, service: new FnsSyncService({ vault: root, configDir: 'obsidian-settings', deviceId: 'darwin-1111111111111111' }) };
}

test('首次缺少本机配置时给出接入步骤，只读检查不创建文件', async t => {
  const f = await fixture(t);
  const before = await fs.readdir(f.root);
  const report = await f.service.inspect();
  assert.equal(report.device.status, 'missing-config');
  assert.match(report.device.message, /安装.*FNS/);
  assert.equal(report.local, null);
  assert.deepEqual(await fs.readdir(f.root), before);
});

test('旧发布可读取；逐条说明保存为草稿并随新版本传递，接收即可展示且不写入 FNS 配置', async t => {
  const { a, b } = await pair(t), beforeA = await fs.readFile(a.target, 'utf8'), beforeB = await fs.readFile(b.target, 'utf8');
  const { randomUUID } = require('node:crypto');
  const { FIELDS } = require('../rules.cjs');
  const local = await a.service.local();
  const legacy = await a.service.git.create({ schema: 1, id: randomUUID(), previousId: null, version: 1,
    sourceDevice: a.deviceId, publishedAt: new Date().toISOString(), fields: FIELDS, fingerprint: local.fingerprint }, local.raw, null);
  await a.service.git.push(legacy);
  assert.deepEqual((await a.service.checkUpdates()).publication.notes, []);
  const entries = [note('跨设备同步 Agent 的项目技能入口。'), note('保留开发记录。\n说明只供阅读。', '.claudian')];
  await saveNotes(a.service, entries);
  assert.equal((await a.service.inspect()).notes.draft, true);
  assert.equal((await a.service.inspect()).publication.version, 1);
  assert.equal(await fs.readFile(a.target, 'utf8'), beforeA);
  a.service = new FnsSyncService(a.service.options);
  const plan = await a.service.preview('publish');
  assert.equal(plan.noteChanges.length, 2);
  assert.equal(plan.diff.configSyncOtherDirs.add.length, 0);
  await a.service.publish(plan);
  const received = await b.service.checkUpdates();
  assert.equal(received.publication.version, 2);
  assert.deepEqual(received.publication.notes, entries);
  assert.equal(received.publication.fingerprint, local.fingerprint);
  assert.equal(received.applied, null);
  assert.equal(await fs.readFile(b.target, 'utf8'), beforeB);
  assert.equal((await a.service.inspect()).notes.draft, false);
  assert.deepEqual((await a.service.publication(legacy)).notes, []);
  await b.service.apply(await b.service.preview('apply'));
  assert.ok(!JSON.stringify(await b.read()).includes(entries[0].reason));
  assert.equal((await b.read()).apiToken, 'B-test');
});

test('说明编辑保存拒绝陈旧输入，说明更新后旧发布预览也被拒绝', async t => {
  const { a } = await pair(t);
  const old = (await a.service.inspect()).notes.expected;
  await a.service.saveNotes(old, [note('第一版说明')]);
  await assert.rejects(a.service.saveNotes(old, [note('陈旧输入')]), { code: 'STALE_NOTES' });
  const plan = await a.service.preview('publish');
  await saveNotes(a.service, [note('第二版说明')]);
  await assert.rejects(a.service.publish(plan), { code: 'STALE_PLAN' });
  assert.equal((await a.service.inspect()).notes.entries[0].reason, '第二版说明');
  assert.equal(await a.service.git.head(), null);
  const expected = (await a.service.inspect()).notes.expected;
  const config = await a.read(); config.configSyncOtherDirs = JSON.stringify([rule('.different')]);
  await fs.writeFile(a.target, JSON.stringify(config));
  await assert.rejects(a.service.saveNotes(expected, [note('规则已变化')]), { code: 'STALE_NOTES' });
});

test('收到新权威版本时保留说明草稿，比较并重新保存后才允许发布', async t => {
  const { a, b } = await pair(t);
  await saveNotes(a.service, [note('原设置目的')]);
  await a.service.publish(await a.service.preview('publish')); await b.service.checkUpdates();
  await saveNotes(a.service, [note('本机正在编辑的目的')]);
  await saveNotes(b.service, [note('另一台设备的新说明')]);
  await b.service.publish(await b.service.preview('publish'));
  const report = await a.service.checkUpdates();
  assert.equal(report.notes.conflict, true);
  assert.equal(report.notes.entries[0].reason, '本机正在编辑的目的');
  assert.equal(report.publication.notes[0].reason, '另一台设备的新说明');
  await assert.rejects(a.service.preview('publish'), { code: 'NOTES_CONFLICT' });
  await a.service.saveNotes(report.notes.expected, [note('核对两端后的说明')]);
  assert.equal((await a.service.inspect()).notes.conflict, false);
  await a.service.publish(await a.service.preview('publish'));
  assert.equal((await b.service.checkUpdates()).publication.notes[0].reason, '核对两端后的说明');
});

test('失败推送固定说明快照，重试不丢失；清空说明生成新版本并保留旧版', async t => {
  const { a, b } = await pair(t);
  await saveNotes(a.service, [note('需要跨设备传递的说明')]);
  const push = a.service.git.push.bind(a.service.git);
  a.service.git.push = async () => { throw Error('offline'); };
  assert.equal((await a.service.publish(await a.service.preview('publish'))).status, 'pending');
  const pending = (await a.service.inspect()).pending;
  await assert.rejects(saveNotes(a.service, [note('重试时不得改写说明')]), { code: 'PENDING_PUBLICATION' });
  a.service = new FnsSyncService(a.service.options);
  a.service.git.push = push;
  await a.service.retryPublish();
  const original = (await b.service.checkUpdates()).publication;
  assert.equal(original.id, pending.publicationId);
  assert.equal(original.notes[0].reason, '需要跨设备传递的说明');
  await saveNotes(a.service, []);
  const plan = await a.service.preview('publish');
  assert.equal(plan.noteChanges[0].after, '');
  await a.service.publish(plan);
  assert.deepEqual((await b.service.checkUpdates()).publication.notes, []);
  assert.equal((await a.service.publication(original.commit)).notes[0].reason, '需要跨设备传递的说明');
});

test('说明严格绑定规则身份，删除规则不遗留错配说明，非法或重复说明不能保存', async t => {
  const { a } = await pair(t);
  for (const entries of [[note('不存在', '.missing')], [note('超长'.repeat(2100))], [note('重复'), note('重复')], [{ ...note('错误选项'), caseSensitive: true }]]) {
    await assert.rejects(saveNotes(a.service, entries), { code: 'INVALID_NOTES' });
  }
  await saveNotes(a.service, [note('仅用于当前规则')]);
  await a.service.publish(await a.service.preview('publish'));
  const config = await a.read(); config.configSyncOtherDirs = JSON.stringify([rule('.claudian')]);
  await fs.writeFile(a.target, JSON.stringify(config));
  const plan = await a.service.preview('publish');
  assert.deepEqual(plan.notes, []);
  assert.equal(plan.noteChanges[0].after, '');
  await a.service.publish(plan);
  assert.deepEqual((await a.service.inspect()).publication.notes, []);
});

test('A 明确发布后 B 接收、比较并应用四组规则，保留本机身份、其他设置和链接', async t => {
  const { a, b } = await pair(t), before = await b.read();
  const published = await a.service.publish(await a.service.preview('publish'));
  assert.equal(published.status, 'published');
  assert.equal((await b.service.inspect()).publication, null);
  const received = await b.service.checkUpdates();
  assert.equal(received.publication.version, 1);
  assert.equal(received.publication.sourceDevice, a.deviceId);
  assert.equal(received.applied, null);
  assert.deepEqual(await b.read(), before);
  const plan = await b.service.preview('apply');
  assert.equal(plan.diff.configSyncOtherDirs.add[0].pattern, '.claudian');
  assert.equal(plan.diff.syncExcludeExtensions.remove[0].pattern, 'pdf');
  const applied = await b.service.apply(plan);
  assert.equal(applied.status, 'applied');
  const after = await b.read();
  assert.equal(after.configSyncOtherDirs, (await a.read()).configSyncOtherDirs);
  assert.equal(after.syncExcludeExtensions, '[]');
  assert.deepEqual({ ...after, configSyncOtherDirs: before.configSyncOtherDirs, syncExcludeExtensions: before.syncExcludeExtensions }, before);
  assert.equal((await fs.lstat(path.join(b.root, b.configDir, 'plugins/fast-note-sync/data.json'))).isSymbolicLink(), false);
  const report = await b.service.inspect();
  assert.equal(report.status, 'applied');
  assert.equal(report.applied.publicationId, received.publication.id);
  assert.ok(!JSON.stringify(report).includes('B-test'));
});

test('发布前拒绝白名单覆盖设备配置与运行记录，拒绝损坏规则而不写入同步记录', async t => {
  const { a } = await pair(t);
  const config = await a.read();
  config.syncExcludeWhitelist = JSON.stringify([rule('apps/workbench/data/.*')]);
  await fs.writeFile(a.target, JSON.stringify(config));
  await assert.rejects(a.service.preview('publish'), { code: 'PROTECTED_SCOPE' });
  await assert.rejects(fs.stat(path.join(a.root, 'apps/workbench/data/fns-sync')), { code: 'ENOENT' });
  config.syncExcludeWhitelist = ''; config.syncExcludeFolders = '[]';
  await fs.writeFile(a.target, JSON.stringify(config));
  await assert.rejects(a.service.preview('publish'), { code: 'PROTECTED_SCOPE' });
});

test('同机两个入口不能同时应用；操作结束后释放锁并保留已有配置', async t => {
  const { a, b } = await pair(t);
  await a.service.publish(await a.service.preview('publish')); await b.service.checkUpdates();
  const plan = await b.service.preview('apply');
  let entered, release;
  const started = new Promise(r => { entered = r; }), gate = new Promise(r => { release = r; });
  const suspend = b.runtime.suspend;
  let first = true;
  b.runtime.suspend = async () => { const previous = await suspend(); if (first) { first = false; entered(); await gate; } return previous; };
  const inFlight = b.service.apply(plan);
  await started;
  const other = new FnsSyncService({ vault: b.root, configDir: b.configDir, deviceId: b.deviceId, runtime: b.runtime });
  try { await assert.rejects(other.apply(plan), { code: 'BUSY' }); }
  finally { release(); await inFlight.catch(() => {}); }
  assert.equal((await other.inspect()).status, 'applied');
});

test('重载失败保留写入回执与恢复材料；重开后核验当前运行时，不沿用历史成功', async t => {
  const { a, b } = await pair(t);
  await a.service.publish(await a.service.preview('publish')); await b.service.checkUpdates();
  const plan = await b.service.preview('apply'), before = await b.read();
  const restore = b.runtime.restore;
  b.runtime.restore = async () => { throw Error('synthetic runtime failure'); };
  const result = await b.service.apply(plan);
  assert.equal(result.status, 'written');
  assert.match(result.message, /恢复|加载/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(b.root, result.recovery, 'before.json'))), before);
  assert.equal((await b.service.inspect()).status, 'written');
  b.runtime.restore = restore; await restore({ enabled: true });
  await b.service.apply(await b.service.preview('apply'));
  assert.equal((await b.service.inspect()).status, 'applied');
  await b.runtime.suspend();
  assert.equal((await b.service.inspect()).status, 'written');
});

test('推送失败沿用同一发布；远端争用时保留本机并允许明确放弃待推送版本', async t => {
  const { a, b, remote } = await pair(t), hook = path.join(remote, 'hooks/pre-receive');
  await fs.writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const failed = await a.service.publish(await a.service.preview('publish'));
  assert.equal(failed.status, 'pending');
  const pending = (await a.service.inspect()).pending;
  await fs.unlink(hook);
  await b.service.publish(await b.service.preview('publish'));
  await assert.rejects(a.service.retryPublish(), { code: 'REMOTE_CHANGED' });
  assert.equal((await a.service.inspect()).pending.publicationId, pending.publicationId);
  await a.service.discardPending(pending.publicationId);
  const published = await a.service.publish(await a.service.preview('publish'));
  assert.equal(published.version, 2);
  assert.equal((await a.service.inspect()).pending, null);
  assert.equal((await b.service.checkUpdates()).publication.sourceDevice, a.deviceId);
});

test('普通配置无需接入或停用即可读取，不创建设备目录', async t => {
  const { a } = await pair(t), before = await fs.readFile(a.target);
  a.runtime.suspend = async () => { throw Error('不应暂停'); };
  const result = await a.service.onboard();
  assert.equal(result.device.status, 'ready');
  assert.equal(result.applied, null);
  assert.deepEqual(await fs.readFile(a.target), before);
  await assert.rejects(fs.stat(path.join(a.root, 'config/fns-config')), { code: 'ENOENT' });
});

async function legacyLink(a, absolute = false) {
  const old = path.join(a.root, 'config/fns-config', a.deviceId, 'data.json');
  await fs.mkdir(path.dirname(old), { recursive: true });
  await fs.rename(a.target, old);
  await fs.symlink(absolute ? old : path.relative(path.dirname(a.target), old), a.target);
  return old;
}

test('旧链接经程序迁回并恢复原启用状态，不伪造应用版本', async t => {
  const { a } = await pair(t), before = await fs.readFile(a.target);
  const old = await legacyLink(a);
  assert.equal((await a.service.inspect()).device.status, 'needs-migration');
  const result = await a.service.onboard();
  assert.equal(result.device.status, 'ready');
  assert.equal(result.applied, null);
  assert.equal((await a.runtime.inspect()).enabled, true);
  assert.deepEqual(await fs.readFile(a.target), before);
  assert.equal((await fs.lstat(a.target)).isSymbolicLink(), false);
  await assert.rejects(fs.stat(old), { code: 'ENOENT' });
  assert.equal((await a.service.publish(await a.service.preview('publish'))).status, 'published');
});

test('恢复上次应用前规则；之后发生外部修改时拒绝覆盖', async t => {
  const { a, b } = await pair(t), before = await b.read();
  await a.service.publish(await a.service.preview('publish')); await b.service.checkUpdates();
  const applied = await b.service.apply(await b.service.preview('apply'));
  const recovered = await b.service.recover(applied.recovery.split('/').at(-1));
  assert.equal(recovered.status, 'restored');
  assert.deepEqual(await b.read(), before);
  const next = await b.service.apply(await b.service.preview('apply'));
  const changed = { ...await b.read(), futureSetting: { preserve: 'new external edit' } };
  await fs.writeFile(b.target, JSON.stringify(changed));
  await assert.rejects(b.service.recover(next.recovery.split('/').at(-1)), { code: 'RECOVERY_CONFLICT' });
  assert.deepEqual(await b.read(), changed);
});

test('已收到的远端版本被删除时保留最近记录，不冒充首次发布', async t => {
  const { a, b, remote } = await pair(t);
  await a.service.publish(await a.service.preview('publish'));
  const received = await b.service.checkUpdates();
  await git(remote, 'update-ref', '-d', 'refs/heads/tannt-fns-config');
  await assert.rejects(b.service.checkUpdates(), { code: 'REMOTE_HISTORY_CHANGED' });
  assert.equal((await b.service.inspect()).publication.id, received.publication.id);
});

test('发布和接收保留用户分支、索引、未提交文件及未推送提交', async t => {
  const { a, b, remote } = await pair(t);
  await fs.writeFile(path.join(a.root, 'private-work.txt'), 'unrelated local commit');
  await git(a.root, 'add', 'private-work.txt'); await git(a.root, 'commit', '-m', 'unrelated work');
  const head = await git(a.root, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(a.root, 'staged.txt'), 'staged'); await git(a.root, 'add', 'staged.txt');
  await fs.writeFile(path.join(a.root, 'private-work.txt'), 'dirty');
  const staged = await git(a.root, 'diff', '--cached', '--binary'), dirty = await git(a.root, 'diff', '--binary');
  await a.service.publish(await a.service.preview('publish')); await b.service.checkUpdates();
  assert.equal(await git(a.root, 'rev-parse', 'HEAD'), head);
  assert.equal(await git(a.root, 'branch', '--show-current'), 'main');
  assert.equal(await git(a.root, 'diff', '--cached', '--binary'), staged);
  assert.equal(await git(a.root, 'diff', '--binary'), dirty);
  const files = (await git(remote, 'ls-tree', '-r', '--name-only', 'tannt-fns-config')).split('\n');
  assert.deepEqual(files.sort(), ['config/fns-config/authority.jsonc', `config/fns-config/${a.deviceId}/data.json`].sort());
  assert.equal(await git(remote, 'rev-list', '--count', 'tannt-fns-config'), '1');
});

test('预览后本机变化拒绝陈旧应用；已有本机基线的修改需明确覆盖', async t => {
  const { a, b } = await pair(t);
  await a.service.publish(await a.service.preview('publish')); await b.service.checkUpdates();
  const stale = await b.service.preview('apply');
  await fs.writeFile(b.target, JSON.stringify({ ...await b.read(), futureSetting: { changed: true } }));
  await assert.rejects(b.service.apply(stale), { code: 'STALE_PLAN' });
  await b.service.apply(await b.service.preview('apply'));
  const changed = { ...await b.read(), configSyncOtherDirs: JSON.stringify([rule('.mine')]) };
  await fs.writeFile(b.target, JSON.stringify(changed));
  const fresh = await b.service.preview('apply');
  assert.equal(fresh.localChanged, true);
  await assert.rejects(b.service.apply(fresh), { code: 'LOCAL_CHANGES' });
  assert.deepEqual(await b.read(), changed);
  await b.service.apply(fresh, { replaceLocal: true });
  assert.equal((await b.service.inspect()).status, 'applied');
});

test('推送失败后本机又改规则，重试仍发布原版本并标出未发布修改', async t => {
  const { a, b, remote } = await pair(t), hook = path.join(remote, 'hooks/pre-receive');
  await fs.writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  await a.service.publish(await a.service.preview('publish'));
  const pending = (await a.service.inspect()).pending;
  await fs.writeFile(a.target, JSON.stringify({ ...await a.read(), configSyncOtherDirs: JSON.stringify([rule('.not-published')]) }));
  await fs.unlink(hook);
  const retried = await a.service.retryPublish();
  assert.equal(retried.publicationId, pending.publicationId);
  const received = await b.service.checkUpdates();
  assert.deepEqual(received.publication.rules.configSyncOtherDirs.map(r => r.pattern), ['.agents', '.claudian']);
  assert.equal((await a.service.inspect()).localChanged, true);
});

test('来源文件被独立改写但元数据未发布时拒绝接收；不覆盖原已收记录', async t => {
  const { root, a, b, remote } = await pair(t);
  await a.service.publish(await a.service.preview('publish'));
  const old = await b.service.checkUpdates();
  const foreign = path.join(root, 'foreign'); await git(root, 'clone', '--branch', 'tannt-fns-config', remote, foreign);
  await git(foreign, 'config', 'user.name', 'FNS test'); await git(foreign, 'config', 'user.email', 'fns@example.invalid');
  const filename = path.join(foreign, 'config/fns-config', a.deviceId, 'data.json');
  const config = JSON.parse(await fs.readFile(filename)); config.configSyncOtherDirs = JSON.stringify([rule('.unpublished')]);
  await fs.writeFile(filename, JSON.stringify(config)); await git(foreign, 'add', '.'); await git(foreign, 'commit', '-m', 'unpublished source change'); await git(foreign, 'push');
  await assert.rejects(b.service.checkUpdates(), { code: 'SOURCE_CHANGED' });
  const reopened = new FnsSyncService({ vault: b.root, configDir: b.configDir, deviceId: b.deviceId, runtime: b.runtime });
  const report = await reopened.inspect();
  assert.equal(report.publication.id, old.publication.id);
  assert.equal(report.status, 'authority-invalid');
  await assert.rejects(reopened.preview('apply'), { code: 'AUTHORITY_BLOCKED' });
});

test('复制其他设备的运行回执不能冒充本机已应用，损坏的记录不暴露任意字段', async t => {
  const { a, b } = await pair(t);
  await a.service.publish(await a.service.preview('publish')); await b.service.checkUpdates();
  await b.service.apply(await b.service.preview('apply'));
  const statePath = device => path.join(device.root, 'apps/workbench/data/fns-sync/state.json');
  await fs.copyFile(statePath(b), statePath(a));
  await assert.rejects(a.service.inspect(), { code: 'INVALID_STATE' });
  const state = JSON.parse(await fs.readFile(statePath(b)));
  state.pending = { token: 'synthetic-do-not-expose' };
  await fs.writeFile(statePath(b), JSON.stringify(state));
  await assert.rejects(b.service.inspect(), error => error.code === 'INVALID_STATE' && !error.message.includes('synthetic-do-not-expose'));
});

test('传输引用夹带其他文件时拒收，保留已接收版本并阻断应用', async t => {
  const { root, a, b, remote } = await pair(t);
  await a.service.publish(await a.service.preview('publish'));
  const before = await b.service.checkUpdates();
  const foreign = path.join(root, 'foreign'); await git(root, 'clone', '--branch', 'tannt-fns-config', remote, foreign);
  await git(foreign, 'config', 'user.name', 'FNS test'); await git(foreign, 'config', 'user.email', 'fns@example.invalid');
  await fs.writeFile(path.join(foreign, 'unrelated.txt'), 'not part of a publication');
  await git(foreign, 'add', '.'); await git(foreign, 'commit', '-m', 'unrelated content'); await git(foreign, 'push');
  await assert.rejects(b.service.checkUpdates(), { code: 'INVALID_PUBLICATION' });
  assert.equal((await b.service.inspect()).publication.id, before.publication.id);
  await assert.rejects(b.service.preview('apply'), { code: 'AUTHORITY_BLOCKED' });
});

test('远端提交必须对应唯一发布身份与连续前序，不能重复使用上一版记录', async t => {
  const { root, a, b, remote } = await pair(t);
  await a.service.publish(await a.service.preview('publish')); await b.service.checkUpdates();
  const foreign = path.join(root, 'foreign'); await git(root, 'clone', '--branch', 'tannt-fns-config', remote, foreign);
  await git(foreign, 'config', 'user.name', 'FNS test'); await git(foreign, 'config', 'user.email', 'fns@example.invalid');
  await git(foreign, 'commit', '--allow-empty', '-m', 'reused metadata'); await git(foreign, 'push');
  await assert.rejects(b.service.checkUpdates(), { code: 'INVALID_PUBLICATION' });
});

test('进程在暂停 FNS 时退出后，可明确恢复原启用状态；不能抢占活进程的锁', async t => {
  const { a, b } = await pair(t), before = await b.read();
  await a.service.publish(await a.service.preview('publish')); await b.service.checkUpdates();
  const plan = await b.service.preview('apply');
  const child = `const fs=require('node:fs/promises');const {FnsSyncService}=require(process.argv[1]);
    const options=JSON.parse(process.argv[2]);
    options.runtime={inspect:async()=>({enabled:true}),suspend:async()=>{await fs.writeFile(options.vault+'/'+options.configDir+'/community-plugins.json','[]');process.exit(73);},restore:async()=>{}};
    new FnsSyncService(options).apply(JSON.parse(process.argv[3])).catch(()=>process.exit(74));`;
  await assert.rejects(run(process.execPath, ['-e', child, path.resolve(__dirname, '../sync.cjs'), JSON.stringify({ vault: b.root, configDir: b.configDir, deviceId: b.deviceId }), JSON.stringify(plan)]), { code: 73 });
  assert.deepEqual(await b.read(), before);
  const interrupted = await b.service.inspect(), operationId = interrupted.recovery.split('/').at(-1);
  const lock = path.join(b.root, 'apps/workbench/data/fns-sync/operation.lock'), deadLock = await fs.readFile(lock);
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  await assert.rejects(b.service.recover(operationId), { code: 'BUSY' });
  await fs.writeFile(lock, deadLock);
  await b.runtime.suspend();
  const recovered = await b.service.recover(operationId);
  assert.equal(recovered.status, 'restored');
  assert.equal((await b.runtime.inspect()).enabled, true);
  assert.deepEqual(await b.read(), before);
  await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
});

test('运行数据须整体忽略且无已跟踪文件，单独忽略状态文件不足以开始操作', async t => {
  const { a } = await pair(t), ignore = path.join(a.root, '.gitignore');
  await fs.writeFile(ignore, '/apps/workbench/data/fns-sync/state.json\n');
  await assert.rejects(a.service.checkUpdates(), { code: 'UNSAFE_STORAGE' });
  await fs.writeFile(ignore, '/apps/workbench/data/\n');
  const backup = path.join(a.root, 'apps/workbench/data/fns-sync/operations/existing/before.json');
  await fs.mkdir(path.dirname(backup), { recursive: true }); await fs.writeFile(backup, '{}');
  await git(a.root, 'add', '-f', 'apps/workbench/data/fns-sync/operations/existing/before.json');
  const index = await git(a.root, 'diff', '--cached', '--binary');
  await assert.rejects(a.service.checkUpdates(), { code: 'UNSAFE_STORAGE' });
  assert.equal(await git(a.root, 'diff', '--cached', '--binary'), index);
});

test('运行目录的子项通配与例外不能冒充整体忽略，接入前拒绝未隔离的备份目录', async t => {
  const { a } = await pair(t), before = await fs.readFile(a.target);
  const entry = path.join(a.root, a.configDir, 'plugins/fast-note-sync/data.json');
  const old = await legacyLink(a, true);
  await fs.writeFile(path.join(a.root, '.gitignore'), '/apps/workbench/data/*\n!/apps/workbench/data/fns-device-config/\n');
  await assert.rejects(a.service.onboard(), { code: 'UNSAFE_STORAGE' });
  assert.equal(await fs.readlink(entry), old);
  assert.deepEqual(await fs.readFile(a.target), before);
  assert.equal((await a.runtime.inspect()).enabled, true);
  await assert.rejects(fs.stat(path.join(a.root, 'apps/workbench/data/fns-device-config')), { code: 'ENOENT' });
});

test('大批中文目录规则经过 Git 发布与接收后内容完整', async t => {
  const { a, b } = await pair(t);
  const directories = Array.from({ length: 8000 }, (_, i) => `资料/中文测试目录${i}`);
  await fs.writeFile(a.target, JSON.stringify({ ...await a.read(), configSyncOtherDirs: JSON.stringify(directories.map(rule)) }));
  assert.equal((await a.service.publish(await a.service.preview('publish'))).status, 'published');
  const received = await b.service.checkUpdates();
  assert.deepEqual(received.publication.rules.configSyncOtherDirs.map(r => r.pattern), directories);
});

test('本机绝对链接迁回普通文件，完整配置保持原样', async t => {
  const { a } = await pair(t), before = await fs.readFile(a.target);
  const entry = path.join(a.root, a.configDir, 'plugins/fast-note-sync/data.json');
  const old = await legacyLink(a, true);
  assert.equal((await a.service.inspect()).device.status, 'needs-migration');
  assert.equal((await a.service.onboard()).device.status, 'ready');
  assert.equal((await fs.lstat(entry)).isSymbolicLink(), false);
  await assert.rejects(fs.stat(old), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(a.target), before);
  assert.equal((await a.runtime.inspect()).enabled, true);
});

test('拒收远端独立历史后，即使 Git 清理对象仍能回查最近有效版本', async t => {
  const { root, a, b, remote } = await pair(t);
  await a.service.publish(await a.service.preview('publish'));
  const previous = await b.service.checkUpdates();
  await git(remote, 'update-ref', '-d', 'refs/heads/tannt-fns-config');
  const replacement = path.join(root, 'replacement'); await fs.mkdir(replacement);
  await git(replacement, 'init', '-b', 'main'); await git(replacement, 'config', 'user.name', 'FNS test'); await git(replacement, 'config', 'user.email', 'fns@example.invalid');
  await git(replacement, 'remote', 'add', 'origin', remote);
  const c = await device(replacement, 'darwin-3333333333333333', settings('C-test'));
  await c.service.publish(await c.service.preview('publish'));
  await assert.rejects(b.service.checkUpdates(), { code: 'REMOTE_HISTORY_CHANGED' });
  await git(b.root, 'reflog', 'expire', '--expire=now', '--all'); await git(b.root, 'gc', '--prune=now');
  const reopened = new FnsSyncService({ vault: b.root, configDir: b.configDir, deviceId: b.deviceId, runtime: b.runtime });
  const report = await reopened.inspect();
  assert.equal(report.publication.id, previous.publication.id);
  assert.equal(report.status, 'authority-invalid');
});
