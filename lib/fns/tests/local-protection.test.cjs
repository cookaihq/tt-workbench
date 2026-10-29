'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FnsSyncService } = require('../sync.cjs');
const scope = require('../workbench-scope.cjs');
const storage = require('../../runtime/storage.cjs');
const { normalize, validateScope } = require('../rules.cjs');
const { matches } = require('../legacy-rules.cjs');

async function fixture(t, { directory, configDir = 'settings', config = {} } = {}) {
  const base = path.resolve(__dirname, '../../../tmp/fns-local-protection');
  await fs.mkdir(base, { recursive: true });
  const vault = await fs.mkdtemp(path.join(base, 'test-'));
  t.after(async () => { assert.equal(path.dirname(vault), base); await fs.rm(vault, { recursive: true, force: true }); });
  if (directory) {
    await fs.mkdir(path.join(vault, storage.CONTROL), { recursive: true });
    await fs.writeFile(path.join(vault, storage.CONFIG), JSON.stringify({ schema: 1, directory, previousDirectories: [] }));
  }
  const plugin = path.join(vault, configDir, 'plugins/fast-note-sync'), target = path.join(plugin, 'data.json');
  await fs.mkdir(plugin, { recursive: true });
  await fs.writeFile(target, JSON.stringify({ apiToken: 'fixture-only', ...config }));
  await fs.writeFile(path.join(plugin, 'manifest.json'), '{"version":"2.4.0"}');
  const calls = [];
  let enabled = true, loaded = JSON.parse(await fs.readFile(target));
  const runtime = {
    inspect: async () => ({ enabled, loaded: enabled, settings: loaded }),
    suspend: async () => { calls.push('pause'); const previous = { enabled }; enabled = false; return previous; },
    restore: async previous => { calls.push('restore'); loaded = JSON.parse(await fs.readFile(target)); enabled = previous.enabled; }
  };
  const service = new FnsSyncService({ vault, configDir, runtime, deviceId: 'win32-1111111111111111' });
  service.git = new Proxy({}, { get: () => () => { throw Error('Local setup must not use publication Git'); } });
  return { vault, configDir, target, service, calls, runtime };
}

test('首次补齐从空排除开始，不依赖发布状态或 Git 远端，保留设备设置与恢复原文', async t => {
  const h = await fixture(t), before = await fs.readFile(h.target, 'utf8');
  const state = path.join(h.service.data, 'state.json');
  await fs.mkdir(path.dirname(state), { recursive: true });
  await fs.writeFile(state, 'broken publication state');
  assert.equal((await scope.inspectWorkbenchExclusions(h.service)).status, 'needs-setup');
  const result = await scope.applyWorkbenchExclusions(h.service);
  assert.equal(result.loaded, true);
  assert.deepEqual(h.calls, ['pause', 'restore']);
  assert.equal(await fs.readFile(path.join(h.vault, result.recovery, 'before.json'), 'utf8'), before);
  const after = JSON.parse(await fs.readFile(h.target));
  assert.equal(after.apiToken, 'fixture-only');
  const report = await scope.inspectWorkbenchExclusions(h.service);
  assert.equal(report.status, 'configured');
  assert.ok(report.paths.every(item => item.excluded));
  for (const file of ['settings/plugins/tt-workbench.install-lock', 'settings/community-plugins.json']) {
    assert.ok(normalize(after).syncExcludeFolders.some(rule => matches(file, rule)), file);
  }
  assert.equal(await fs.readFile(state, 'utf8'), 'broken publication state');
  await scope.assertWorkbenchExclusions(h.service);
  assert.equal((await scope.applyWorkbenchExclusions(h.service)).changed, false);
});

test('自定义路径和旧安装按实例检查，旧规则保留，新实例不列旧插件', async t => {
  const h = await fixture(t, { directory: 'local/runtime', config: { syncExcludeFolders: '["old-retired/"]' } });
  let report = await scope.inspectWorkbenchExclusions(h.service);
  assert.ok(report.paths.some(item => item.path === 'local/runtime'));
  assert.ok(!report.paths.some(item => item.path.includes('tannt-workbench') || item.path === 'config/fns-config'));
  await fs.mkdir(path.join(h.vault, 'settings/plugins/tannt-workbench'), { recursive: true });
  await fs.mkdir(path.join(h.vault, 'config/fns-config'), { recursive: true });
  report = await scope.inspectWorkbenchExclusions(h.service);
  assert.ok(report.paths.some(item => item.path === 'settings/plugins/tannt-workbench' && item.legacy));
  await scope.applyWorkbenchExclusions(h.service);
  const rules = normalize(JSON.parse(await fs.readFile(h.target)));
  validateScope(rules, ['local/runtime', '.system/workbench', 'config/fns-config']);
  assert.ok(rules.syncExcludeFolders.some(item => item.pattern === 'old-retired/'));
});

test('未配置 FNS 时本机排除不适用，更新无需读取运行记录', async t => {
  const h = await fixture(t);
  await fs.unlink(h.target);
  h.runtime.inspect = async () => ({ enabled: false, loaded: false });
  const result = await scope.inspectWorkbenchExclusions(h.service);
  assert.equal(result.status, 'not-applicable');
  assert.equal(result.canConfigure, false);
  await scope.assertWorkbenchExclusions(h.service);
});

test('配置缺失但 FNS 仍启用或加载时不能绕过更新前检查', async t => {
  const h = await fixture(t);
  await fs.unlink(h.target);
  for (const runtime of [{ enabled: true, loaded: false }, { enabled: false, loaded: true }]) {
    h.runtime.inspect = async () => runtime;
    const result = await scope.inspectWorkbenchExclusions(h.service);
    assert.equal(result.status, 'unknown');
    assert.equal(result.canConfigure, false);
    await assert.rejects(scope.assertWorkbenchExclusions(h.service), { code: 'FNS_NOT_READY' });
  }
});

test('排除已保存但启用的 FNS 尚未加载时不能安装更新', async t => {
  const h = await fixture(t);
  await scope.applyWorkbenchExclusions(h.service);
  h.runtime.inspect = async () => ({ enabled: true, loaded: false });
  assert.equal((await scope.inspectWorkbenchExclusions(h.service)).status, 'pending');
  await assert.rejects(scope.assertWorkbenchExclusions(h.service), { code: 'FNS_NOT_READY' });
});

test('已有写入锁及白名单冲突均不改变本机配置', async t => {
  const h = await fixture(t), before = await fs.readFile(h.target, 'utf8');
  await fs.mkdir(h.service.data, { recursive: true });
  const lock = path.join(h.service.data, 'operation.lock');
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid }));
  await assert.rejects(scope.applyWorkbenchExclusions(h.service), { code: 'BUSY' });
  assert.deepEqual(h.calls, []);
  assert.equal(await fs.readFile(h.target, 'utf8'), before);
  await fs.unlink(lock);
  await fs.writeFile(h.target, JSON.stringify({ syncExcludeWhitelist: '[".*"]' }));
  await assert.rejects(scope.applyWorkbenchExclusions(h.service), { code: 'PROTECTED_SCOPE' });
  assert.deepEqual(h.calls, []);
});

test('暂停期间外部修改被保留，不生成陈旧备份或覆盖设备设置', async t => {
  const h = await fixture(t), suspend = h.runtime.suspend;
  h.runtime.suspend = async () => {
    const previous = await suspend();
    await fs.writeFile(h.target, '{"external":"changed"}');
    return previous;
  };
  await assert.rejects(scope.applyWorkbenchExclusions(h.service), { code: 'STALE_PLAN' });
  assert.equal(await fs.readFile(h.target, 'utf8'), '{"external":"changed"}');
  assert.equal((await h.runtime.inspect()).enabled, true);
});

test('首次补齐写入失败时保留恢复原文并保持 FNS 停用，避免备份被同步', async t => {
  const h = await fixture(t), before = await fs.readFile(h.target, 'utf8'), rename = fs.rename;
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === h.target) throw Object.assign(Error('fixture write failure'), { code: 'EACCES' });
    return rename(source, destination);
  });
  let failure;
  await assert.rejects(scope.applyWorkbenchExclusions(h.service), error => { failure = error; return error.code === 'EACCES'; });
  assert.match(failure.message, /FNS 保持停用/);
  assert.equal((await h.runtime.inspect()).enabled, false);
  assert.equal(await fs.readFile(h.target, 'utf8'), before);
  assert.equal(await fs.readFile(path.join(h.vault, failure.recovery, 'before.json'), 'utf8'), before);
  await assert.rejects(fs.stat(path.join(h.service.data, 'operation.lock')), { code: 'ENOENT' });
});

test('加载旧规则时补齐报告失败并重新暂停，不能宣称已经生效', async t => {
  const h = await fixture(t), restore = h.runtime.restore;
  h.runtime.restore = async previous => {
    await restore(previous);
    h.runtime.inspect = async () => ({ enabled: true, loaded: true, settings: {} });
  };
  await assert.rejects(scope.applyWorkbenchExclusions(h.service), error => error.code === 'FNS_LOAD_FAILED' && error.message.includes('保持停用'));
  assert.deepEqual(h.calls, ['pause', 'restore', 'pause']);
});

test('实例已有 Git 却未忽略恢复目录时在暂停前拒绝，不要求远端', async t => {
  const h = await fixture(t), exec = require('node:util').promisify(require('node:child_process').execFile);
  await exec('git', ['init'], { cwd: h.vault, windowsHide: true });
  await assert.rejects(scope.applyWorkbenchExclusions(h.service), { code: 'UNSAFE_STORAGE' });
  assert.deepEqual(h.calls, []);
  await fs.writeFile(path.join(h.vault, '.gitignore'), '/.system/\n');
  assert.equal((await scope.applyWorkbenchExclusions(h.service)).loaded, true);
});

test('独立 CLI 本机检查与补齐不读取损坏发布记录，并保持 FNS 停用', async t => {
  const h = await fixture(t);
  await fs.writeFile(path.join(h.vault, h.configDir, 'community-plugins.json'), '[]');
  await fs.mkdir(h.service.data, { recursive: true });
  await fs.writeFile(path.join(h.service.data, 'state.json'), 'invalid state');
  const invoke = input => new Promise((resolve, reject) => {
    const child = require('node:child_process').spawn(process.execPath, [path.resolve(__dirname, '../../../scripts/fns/sync-request.cjs'), '--vault', h.vault], { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      try { assert.equal(code, 0, err); assert.ok(!out.includes('fixture-only')); resolve(JSON.parse(out).result); }
      catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({ ...input, configDir: h.configDir }));
  });
  assert.equal((await invoke({ action: 'local-check' })).protection.status, 'needs-setup');
  const result = await invoke({ action: 'configure-local', fnsStopped: true });
  assert.equal(result.changed, true); assert.equal(result.loaded, false);
  assert.equal((await invoke({ action: 'local-check' })).protection.status, 'pending');
  assert.equal(await fs.readFile(path.join(h.vault, h.configDir, 'community-plugins.json'), 'utf8'), '[]');
});
