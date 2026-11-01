'use strict';
const runtimeStorage = require('../runtime/storage.cjs');
const fs = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { parseConfig, normalize, validateScope } = require('./rules.cjs');
const { safePath, atomicJSON, replaceChecked } = require('./files.cjs');
const run = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const installMessage = '请先安装 Fast Note Sync（FNS），启用并完成本机配置后，再接入当前设备。';
const { resolveVault } = require('../config/target.cjs');
// This path remains in immutable publications and in old, not-yet-migrated installations.
const profileDirectory = 'config/fns-config';
async function entry(filename) {
  try { return await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function deviceIdFromMachineId(platform, machineId) {
  const normalized = machineId.trim().toLowerCase();
  if (!['darwin', 'win32'].includes(platform) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(normalized)
      || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(normalized)) throw new Error('无法确认受支持的本机稳定身份；未选择任何设备配置。');
  return `${platform}-${hash(normalized).slice(0, 16)}`;
}
let deviceIdentity;
function currentDeviceId() {
  // Identity is stable for this process. Share the in-flight query as well as
  // its validated result; rejected/invalid queries must remain retryable.
  deviceIdentity ||= readDeviceId().catch(error => { deviceIdentity = null; throw error; });
  return deviceIdentity;
}
async function readDeviceId() {
  let machineId;
  if (process.platform === 'darwin') {
    const { stdout } = await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 10000 });
    machineId = stdout.match(/"IOPlatformUUID"\s*=\s*"([a-fA-F0-9-]+)"/)?.[1];
  } else if (process.platform === 'win32') {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '(Get-ItemProperty -LiteralPath "HKLM:\\SOFTWARE\\Microsoft\\Cryptography" -Name MachineGuid).MachineGuid'], { timeout: 10000, windowsHide: true });
    machineId = stdout.trim();
  }
  return deviceIdFromMachineId(process.platform, machineId || '');
}

async function context(options) {
  const vault = resolveVault(options.vault);
  const configDir = options.configDir || '.obsidian';
  if (path.isAbsolute(configDir) || /^[a-z]:/i.test(configDir) || configDir.split(/[\\/]/).some(p => !p || p === '.' || p === '..')) {
    throw new Error('配置目录必须是库内相对目录。');
  }
  const source = path.join(vault, configDir, 'plugins/fast-note-sync/data.json');
  await safePath(vault, path.dirname(source));
  return { vault, configDir, source };
}
async function inspectDeviceConfig(options = {}) {
  const ctx = await context(options), info = await entry(ctx.source);
  const source = path.relative(ctx.vault, ctx.source);
  if (!info) return { status: 'missing-config', source, message: installMessage };
  const deviceId = options.deviceId || await currentDeviceId();
  if (!/^(darwin|win32)-[a-f0-9]{16}$/.test(deviceId)) throw new Error('设备标识格式无效。');
  const report = { deviceId, source };
  if (info.isFile() && !info.isSymbolicLink()) {
    parseConfig(await fs.readFile(ctx.source, 'utf8'));
    return { ...report, status: 'ready' };
  }
  if (!info.isSymbolicLink()) return { ...report, status: 'conflict', message: 'FNS 配置入口不是普通文件。' };
  const originalLink = await fs.readlink(ctx.source);
  const target = path.resolve(path.dirname(ctx.source), originalLink);
  const allowed = [profileDirectory, '.fns-config'].map(dir => path.join(ctx.vault, dir, deviceId, 'data.json'));
  // Never inspect or read an unknown link target, including another device's profile.
  if (!allowed.includes(target)) return { ...report, status: 'foreign-link', message: 'FNS 旧链接不属于本机已知配置；未读取或修改目标。' };
  await safePath(ctx.vault, path.dirname(target));
  const targetInfo = await entry(target);
  if (!targetInfo) return { ...report, status: 'broken-link', message: '本机旧配置链接目标不存在；保留现场，不借用其他配置。' };
  if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) return { ...report, status: 'conflict', message: '本机旧配置目标不是普通文件。' };
  const raw = await fs.readFile(target);
  parseConfig(raw.toString('utf8'));
  return { ...report, status: 'needs-migration', input: path.relative(ctx.vault, target), originalLink, sourceHash: hash(raw),
    message: '本机仍使用旧配置链接；迁回插件目录后即可比较和应用。' };
}
async function checkRecoveryStorage(ctx, runtime) {
  if (!await entry(path.join(ctx.vault, '.git'))) return;
  const git = args => run('git', args, { cwd: ctx.vault, windowsHide: true });
  if ((await git(['ls-files', '--', runtimeStorage.relative('', ctx.vault)])).stdout.trim()) throw new Error('恢复目录已有 Git 跟踪文件；未写入配置备份。');
  // Checking the whole parent prevents child exceptions from exposing backups.
  for (const filename of [runtimeStorage.relative('', ctx.vault), path.relative(ctx.vault, runtime), path.relative(ctx.vault, path.join(runtime, 'source.before.json'))]) {
    try { await git(['check-ignore', '--quiet', filename]); }
    catch { throw new Error('恢复目录必须整体排除 Git；未写入配置备份。'); }
  }
}
async function prepareGitIgnore(ctx, recovery) {
  if (await entry(path.join(ctx.vault, '.git'))) {
    const { stdout } = await run('git', ['ls-files', '--', path.relative(ctx.vault, ctx.source)], { cwd: ctx.vault, windowsHide: true });
    if (stdout.trim()) throw new Error('FNS 本机入口已被 Git 跟踪；请先按授权停止跟踪，再迁回。');
  }
  const filename = path.join(ctx.vault, '.gitignore');
  await safePath(ctx.vault, filename, { file: true });
  const info = await entry(filename), before = info ? await fs.readFile(filename, 'utf8') : '';
  const rule = '/' + path.relative(ctx.vault, ctx.source).split(path.sep).join('/');
  if (before.split(/\r?\n/).includes(rule)) return;
  const after = before + (before && !before.endsWith('\n') ? '\n' : '') + '\n# FNS: local runtime settings stay on this device; publications contain snapshots.\n' + rule + '\n';
  if (info) await replaceChecked(filename, before, after, recovery);
  else await fs.writeFile(filename, after, { flag: 'wx' });
  if (await fs.readFile(filename, 'utf8') !== after) throw new Error('.gitignore 写入后校验失败。');
}
async function migrateDeviceConfig(options = {}) {
  const initial = await inspectDeviceConfig(options);
  if (initial.status !== 'needs-migration') return { ...initial, changed: false };
  return runtimeStorage.withRuntime(resolveVault(options.vault), () => migrateDeviceConfigLocked(options));
}
async function migrateDeviceConfigLocked(options) {
  const initial = await inspectDeviceConfig(options);
  if (initial.status !== 'needs-migration') return { ...initial, changed: false };
  const ctx = await context(options);
  const enabled = parseList(await fs.readFile(path.join(ctx.vault, ctx.configDir, 'community-plugins.json'), 'utf8'));
  if (enabled.includes('fast-note-sync')) throw new Error('请先在 Obsidian 中暂时停用 FNS，再迁回；不能只改磁盘启用列表。');
  const input = path.join(ctx.vault, initial.input), raw = await fs.readFile(input);
  if (hash(raw) !== initial.sourceHash) throw new Error('FNS 配置并发变化；未迁回。');
  validateScope(normalize(parseConfig(raw.toString('utf8'))), runtimeStorage.protectedDirectories(ctx.vault));
  const runtime = path.join(ctx.vault, runtimeStorage.relative('fns-device-config', ctx.vault));
  const recovery = path.join(runtime, randomUUID());
  // Git directory-only ignores require a real directory, not a trailing slash probe.
  await safePath(ctx.vault, path.join(ctx.vault, runtimeStorage.relative('', ctx.vault)), { mkdir: true });
  await checkRecoveryStorage(ctx, recovery);
  await safePath(ctx.vault, runtime, { mkdir: true });
  const lockPath = path.join(runtime, 'migration.lock');
  const lock = await fs.open(lockPath, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error('已有 FNS 配置迁回锁；先核对在途操作，不自动抢占。');
    throw error;
  });
  const unchanged = async () => {
    const fresh = await inspectDeviceConfig({ ...options, deviceId: initial.deviceId });
    if (fresh.status !== 'needs-migration' || fresh.sourceHash !== initial.sourceHash
        || fresh.originalLink !== initial.originalLink || fresh.input !== initial.input) throw new Error('FNS 配置或链接在检查后变化；未覆盖。');
  };
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, deviceId: initial.deviceId }));
    await unchanged();
    await fs.mkdir(recovery, { mode: 0o700 });
    const backup = path.join(recovery, 'source.before.json');
    await fs.writeFile(backup, raw, { flag: 'wx', mode: 0o600 });
    if (!(await fs.readFile(backup)).equals(raw)) throw new Error('恢复备份核验失败。');
    const receipt = { ...initial, operation: 'restore-plugin-file', createdAt: new Date().toISOString(), phase: 'prepared' };
    const saveReceipt = () => atomicJSON(ctx.vault, path.join(recovery, 'receipt.json'), receipt);
    await saveReceipt();
    await prepareGitIgnore(ctx, recovery);
    const staged = path.join(recovery, 'data.staging');
    await fs.writeFile(staged, raw, { flag: 'wx', mode: 0o600 });
    if (!(await fs.readFile(staged)).equals(raw)) throw new Error('迁回文件校验失败。');
    await unchanged();
    receipt.phase = 'replacing'; await saveReceipt();
    await unchanged();
    // Replace the link itself. FNS will now read and write this ordinary file.
    await fs.rename(staged, ctx.source);
    await safePath(ctx.vault, ctx.source, { file: true });
    if (!(await fs.readFile(ctx.source)).equals(raw)) throw new Error('迁回后内容校验失败。');
    receipt.phase = 'written'; await saveReceipt();
    await safePath(ctx.vault, input, { file: true });
    if (!(await fs.readFile(input)).equals(raw)) throw new Error('旧源文件在迁回后变化，已保留，未清理。');
    await fs.unlink(input);
    for (const dir of [path.dirname(input), path.dirname(path.dirname(input))]) {
      try { await fs.rmdir(dir); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
    }
    receipt.phase = 'complete'; receipt.completedAt = new Date().toISOString(); await saveReceipt();
    return { ...await inspectDeviceConfig({ ...options, deviceId: initial.deviceId }), changed: true,
      contentPreserved: true, tokenPreserved: true, changedFields: [], recovery: path.relative(ctx.vault, recovery) };
  } catch (error) {
    throw new Error(`${error.message}；恢复记录：${path.relative(ctx.vault, recovery)}`);
  } finally { await lock.close(); await fs.unlink(lockPath); }
}
function parseList(raw) {
  let value; try { value = JSON.parse(raw); } catch { /* no input in diagnostics */ }
  if (!Array.isArray(value)) throw new Error('无法核对 FNS 插件启用列表。');
  return value;
}
module.exports = { profileDirectory, deviceIdFromMachineId, currentDeviceId, inspectDeviceConfig, migrateDeviceConfig };
