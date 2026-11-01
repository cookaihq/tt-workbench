'use strict';
const storage = require('../runtime/storage.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalize, validateScope, parseConfig, fail } = require('./rules.cjs');
const { safePath, replaceChecked, acquireLock } = require('./files.cjs');
const { workbenchPaths, deviceDirectories } = require('./protection.cjs');
const { gitIsolation } = require('../runtime/location-migration.cjs');

const codeDirectories = (configDir, vault) => workbenchPaths(configDir, vault).filter(item => item.kind === 'directory').map(item => item.path);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pathCoverage(rules, paths) {
  return paths.map(item => {
    try { validateScope(rules, [item]); return { ...item, excluded: true }; }
    catch (error) { return { ...item, excluded: false, reason: error.message }; }
  });
}

async function inspectWorkbenchExclusions(service) {
  const paths = workbenchPaths(service.options.configDir, service.vault);
  const result = values => ({ ...values, directories: values.paths.filter(item => item.kind === 'directory') });
  let local;
  try { local = await service.local(); }
  catch (error) {
    const missing = error.deviceStatus === 'missing-config';
    let notApplicable = missing;
    if (missing) {
      try {
        const runtime = await service.runtime?.inspect();
        notApplicable = !runtime?.enabled && !runtime?.loaded;
      } catch { notApplicable = false; }
    }
    return result({ status: notApplicable ? 'not-applicable' : 'unknown', configured: false, canConfigure: false,
      paths: paths.map(item => ({ ...item, excluded: null })),
      message: notApplicable ? '未配置 FNS，本机文件排除暂不适用。启用 FNS 前请重新检查。'
        : missing ? '本机 FNS 配置缺失，且无法确认 FNS 已停用；请检查配置及插件启用状态。'
        : error.code === 'DEVICE_NOT_READY' ? '请先核对本机 FNS 配置；旧链接须明确迁回后再补齐排除。' : '无法读取本机 FNS 配置，请修复后重试。' });
  }
  const coverage = pathCoverage(local.rules, paths), configured = coverage.every(item => item.excluded);
  if (!configured) return result({ status: 'needs-setup', configured, canConfigure: true, paths: coverage,
    message: '可补齐本机文件排除。白名单冲突须先在 FNS 设置中处理；此次设置不会发布到其他设备。' });
  let runtime, loaded = false;
  try {
    runtime = await service.runtime?.inspect();
    loaded = Boolean(runtime?.loaded && runtime.settings && pathCoverage(normalize(runtime.settings), paths).every(item => item.excluded));
  } catch { /* Report a saved but unverified configuration. */ }
  return result({ status: loaded ? 'configured' : 'pending', configured, canConfigure: true, paths: coverage,
    enabled: runtime?.enabled ?? null,
    message: loaded ? '本机排除已保存并加载；其他设备须分别检查。' : '排除已保存，FNS 尚未加载这些规则；启用或重新加载后再核验。' });
}

async function assertWorkbenchExclusions(service) {
  const report = await inspectWorkbenchExclusions(service);
  if (report.status === 'not-applicable') return report;
  if (!report.configured) fail('FNS_NOT_READY', '请在「FNS 配置同步 → 本机检查」补齐本机文件排除。' + (report.paths.find(item => item.excluded === false)?.reason || report.message));
  if (report.enabled !== false && report.status !== 'configured') fail('FNS_NOT_READY', '本机文件排除尚未核验加载，请重新加载 FNS。');
  return report;
}

function excludeWorkbenchCode(config, configDir, vault) {
  const rules = normalize(config), added = [], paths = workbenchPaths(configDir, vault);
  for (const item of paths) {
    try { validateScope(rules, [item]); }
    catch (error) {
      if (error.code !== 'PROTECTED_SCOPE') throw error;
      const rule = { pattern: `^${escape(item.path)}${item.kind === 'file' ? '$' : '(?:/|$)'}`, caseSensitive: false };
      rules.syncExcludeFolders.push(rule); added.push(rule);
    }
  }
  validateScope(rules, paths);
  return { config: added.length ? { ...config, syncExcludeFolders: JSON.stringify(rules.syncExcludeFolders) } : config, added };
}

async function applyWorkbenchExclusions(service) {
  if (!service.runtime) fail('RUNTIME_REQUIRED', '补齐排除需要先暂停 FNS。');
  const first = await service.local(), vault = service.vault, configDir = service.options.configDir || '.obsidian';
  const initial = excludeWorkbenchCode(first.config, configDir, vault);
  if (!initial.added.length) return { changed: false, loaded: (await inspectWorkbenchExclusions(service)).status === 'configured', message: '本机文件排除已齐全。' };
  const manifest = await safePath(vault, path.join(vault, configDir, 'plugins/fast-note-sync/manifest.json'), { file: true });
  if (parseConfig(await fs.readFile(manifest, 'utf8')).version !== '2.4.0') fail('UNSUPPORTED_FNS', '当前只核验了 FNS 2.4.0，请先复核此版本。');
  await storage.assertReady(vault);
  const directory = storage.relative('', vault), data = path.join(vault, directory, 'fns-sync');
  const lockPath = await safePath(vault, path.join(data, 'operation.lock'), { file: true });
  if (await storage.stat(lockPath)) fail('BUSY', '已有本机 FNS 操作，请等待完成后再补齐。');
  await gitIsolation(vault, storage.protectedDirectories(vault));
  let previous, recovery, restoreAttempted = false, keepStopped = false;
  try {
    previous = await service.runtime.suspend();
    return await storage.withRuntime(vault, async () => {
      if (storage.relative('', vault) !== directory) fail('STALE_PLAN', '运行位置已变化，请重新检查。');
      await safePath(vault, data, { mkdir: true });
      let lock;
      try { lock = await acquireLock(vault, lockPath, false); }
      catch (error) { if (error.code === 'BUSY') keepStopped = true; throw error; }
      try {
        const current = await service.local();
        if (current.raw !== first.raw) fail('STALE_PLAN', '暂停期间本机配置已变化，请重新检查。');
        const desired = excludeWorkbenchCode(current.config, configDir, vault);
        await gitIsolation(vault, storage.protectedDirectories(vault));
        recovery = path.join(vault, directory, 'workbench-code-sync', randomUUID());
        await safePath(vault, recovery, { mkdir: true });
        await fs.writeFile(path.join(recovery, 'before.json'), current.raw, { flag: 'wx', mode: 0o600 });
        await replaceChecked(current.filename, current.raw, JSON.stringify(desired.config, null, 2) + '\n', recovery);
        validateScope((await service.local()).rules, workbenchPaths(configDir, vault));
        restoreAttempted = true;
        try { await service.runtime.restore(previous); }
        catch (error) {
          try { await service.runtime.suspend(); keepStopped = true; }
          catch { error.message += '；无法确认 FNS 已停用，请核对启用状态。'; }
          throw error;
        }
        const report = await inspectWorkbenchExclusions(service);
        if (previous.enabled && report.status !== 'configured') {
          await service.runtime.suspend(); keepStopped = true;
          fail('FNS_LOAD_FAILED', '排除已写入，但加载核验未通过。');
        }
        return { changed: true, loaded: report.status === 'configured', paths: report.paths,
          recovery: path.relative(vault, recovery), message: report.message };
      } finally {
        // Keep the shared writer lock during restoration, including failures.
        try {
          if (!restoreAttempted) {
            if (recovery) {
              try { validateScope((await service.local()).rules, deviceDirectories(vault)); }
              catch { keepStopped = true; }
            }
            if (recovery && !keepStopped) { restoreAttempted = true; await service.runtime.restore(previous); }
          }
        } finally { await lock.close(); await fs.unlink(lockPath); }
      }
    });
  } catch (error) {
    if (previous && ['BUSY', 'RUNTIME_BUSY'].includes(error.code)) keepStopped = true;
    if (previous && !restoreAttempted && !keepStopped && !recovery) {
      restoreAttempted = true;
      try { await service.runtime.restore(previous); } catch { error.message += '；FNS 恢复失败，请检查启用状态。'; }
    }
    if (keepStopped) error.message += ' FNS 保持停用，请核对本机操作与排除后再启用。';
    if (recovery) { error.recovery = path.relative(vault, recovery); error.message += ' 恢复材料：' + error.recovery; }
    throw error;
  }
}

module.exports = { workbenchPaths, codeDirectories, pathCoverage, excludeWorkbenchCode, applyWorkbenchExclusions, inspectWorkbenchExclusions, assertWorkbenchExclusions };
