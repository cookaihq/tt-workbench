'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { promisify } = require('node:util');

const machineId = '12345678-1234-5678-9abc-123456789abc';
// Exercise the real module with only the OS query replaced: no real consoles
// or device identifiers are created/read by the regression suite.
function loadIdentity(platform, query) {
  const filename = path.resolve(__dirname, '../device-config.cjs');
  const localRequire = createRequire(filename), module = { exports: {} }, calls = [];
  const execFile = () => { throw Error('expected promisified execFile'); };
  execFile[promisify.custom] = async (...args) => { calls.push(args); return query(...args); };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, process: { platform },
    require: name => name === 'node:child_process' ? { execFile } : localRequire(name)
  }, { filename });
  return { ...module.exports, calls };
}

test('Windows identity queries are hidden and retain the registered ID algorithm', async () => {
  const identity = loadIdentity('win32', async () => ({ stdout: machineId + '\r\n' }));
  assert.equal(await identity.currentDeviceId(), identity.deviceIdFromMachineId('win32', machineId));
  assert.equal(identity.calls[0][0], 'powershell.exe');
  assert.equal(identity.calls[0][2].windowsHide, true);
  assert.equal(identity.calls[0][2].timeout, 10000);
});

for (const platform of ['win32', 'darwin']) {
  test(`${platform} shares one identity query across concurrent and later callers`, async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const identity = loadIdentity(platform, () => pending);
    const reads = Array.from({ length: 40 }, () => identity.currentDeviceId());
    finish({ stdout: platform === 'darwin' ? `"IOPlatformUUID" = "${machineId}"` : machineId });
    const ids = await Promise.all(reads);
    assert.equal(new Set(ids).size, 1);
    assert.equal(identity.calls.length, 1, 'concurrent callers must share the in-flight query');
    for (let i = 0; i < 10; i++) assert.equal(await identity.currentDeviceId(), ids[0]);
    assert.equal(identity.calls.length, 1, 'successful identity must be reused');
  });
}

test('query failure is shared but does not prevent a later retry', async () => {
  let attempts = 0;
  const identity = loadIdentity('win32', async () => {
    if (++attempts === 1) throw Error('query timed out');
    return { stdout: machineId };
  });
  const failed = await Promise.allSettled(Array.from({ length: 12 }, () => identity.currentDeviceId()));
  assert.ok(failed.every(result => result.status === 'rejected' && result.reason.message === 'query timed out'));
  assert.equal(attempts, 1);
  assert.equal(await identity.currentDeviceId(), identity.deviceIdFromMachineId('win32', machineId));
  assert.equal(attempts, 2);
});

test('invalid machine identity is not cached; a valid retry is cached', async () => {
  let attempts = 0;
  const identity = loadIdentity('win32', async () => ({ stdout: ++attempts === 1 ? 'invalid' : machineId }));
  await assert.rejects(identity.currentDeviceId(), /稳定身份/);
  const id = await identity.currentDeviceId();
  assert.equal(await identity.currentDeviceId(), id);
  assert.equal(attempts, 2);
});

test('concurrent FNS inspect/local-check services share the OS query across the complete read chain', async t => {
  const io = fs.promises, base = path.resolve(__dirname, '../../../tmp/fns-identity-tests');
  await io.mkdir(base, { recursive: true });
  const vault = await io.mkdtemp(path.join(base, 'vault-'));
  t.after(() => io.rm(vault, { recursive: true, force: true }));
  const identity = loadIdentity('win32', async () => ({ stdout: machineId }));
  const filename = path.resolve(__dirname, '../sync.cjs'), localRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
    require: name => name === './device-config.cjs' ? identity : localRequire(name)
  }, { filename });
  const configDir = 'settings', plugin = path.join(vault, configDir, 'plugins/fast-note-sync');
  await io.mkdir(plugin, { recursive: true });
  await io.writeFile(path.join(plugin, 'data.json'), JSON.stringify({
    configSyncOtherDirs: '', syncExcludeFolders: '', syncExcludeExtensions: '', syncExcludeWhitelist: ''
  }));
  const { FnsSyncService } = module.exports;
  const a = new FnsSyncService({ vault, configDir }), b = new FnsSyncService({ vault, configDir });
  const expected = identity.deviceIdFromMachineId('win32', machineId);
  await io.mkdir(a.data, { recursive: true });
  await io.writeFile(path.join(a.data, 'state.json'), JSON.stringify({ schema: 1, deviceId: expected, configDir }));
  const reports = await Promise.all(Array.from({ length: 20 }, (_, i) => i % 2 ? a.inspect() : b.inspectLocal()));
  assert.ok(reports.every(report => report.device.deviceId === expected && report.device.status === 'ready'));
  assert.equal(identity.calls.length, 1);
  await a.inspect(); await b.inspectLocal();
  assert.equal(identity.calls.length, 1);
});
