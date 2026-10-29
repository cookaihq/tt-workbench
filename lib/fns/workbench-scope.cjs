'use strict';
const runtimeStorage = require('../runtime/storage.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalize, validateScope, fingerprint, fail } = require('./rules.cjs');
const { safePath, replaceChecked } = require('./files.cjs');

const codeDirectories = (configDir = '.obsidian', vault) => [
  ...runtimeStorage.protectedDirectories(vault),
  `${configDir}/plugins/tannt-workbench-recovery`, `${configDir}/plugins/tannt-workbench`,
  `${configDir}/plugins/tt-workbench-recovery`, `${configDir}/plugins/tt-workbench`
];
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function directoryCoverage(rules, directories) {
  return directories.map(directory => {
    try { validateScope(rules, [directory]); return { path: directory, excluded: true }; }
    catch (error) { return { path: directory, excluded: false, reason: error.message }; }
  });
}

async function inspectWorkbenchExclusions(service) {
  const paths = codeDirectories(service.options.configDir, service.vault);
  let local;
  try { local = await service.local(); }
  catch (error) {
    return { status: 'unknown', configured: false, canConfigure: false,
      directories: paths.map(directory => ({ path: directory, excluded: null })),
      message: error.code === 'DEVICE_NOT_READY' ? '请先在「FNS 配置同步」中核对本机配置并迁回旧链接，再检查代码排除。' : '无法读取本机 FNS 配置，请检查配置文件后重试。' };
  }
  const directories = directoryCoverage(local.rules, paths), configured = directories.every(item => item.excluded);
  if (!configured) return { status: 'needs-setup', configured, canConfigure: true, directories,
    message: '尚未全部排除；点击按钮补齐本机规则。白名单冲突需要先在 FNS 设置中处理。' };
  try {
    const runtime = await service.runtime?.inspect();
    if (!runtime?.loaded) return { status: 'pending', configured, canConfigure: true, directories, message: '排除规则已保存。FNS 当前未加载，启用后再核验生效状态。' };
    if (runtime.settings && directoryCoverage(normalize(runtime.settings), paths).every(item => item.excluded)) {
      return { status: 'configured', configured, canConfigure: true, directories, message: '所列目录已排除，FNS 当前加载的规则也已覆盖。' };
    }
    return { status: 'pending', configured, canConfigure: true, directories, message: '排除规则已保存，FNS 仍在使用旧设置；请重新加载 FNS。' };
  } catch {
    return { status: 'pending', configured, canConfigure: true, directories, message: '排除规则已保存，但无法核验 FNS 当前加载状态。' };
  }
}
function excludeWorkbenchCode(config, configDir, vault) {
  const rules = normalize(config), added = [];
  for (const directory of codeDirectories(configDir, vault)) {
    try { validateScope(rules, [directory]); }
    catch (error) {
      if (error.code !== 'PROTECTED_SCOPE') throw error;
      const rule = { pattern: `^${escape(directory)}(?:/|$)`, caseSensitive: false };
      rules.syncExcludeFolders.push(rule); added.push(rule);
    }
  }
  validateScope(rules, codeDirectories(configDir, vault)); // Whitelist overrides must not pass.
  if (!added.length) return { config, added };
  return { config: { ...config, syncExcludeFolders: JSON.stringify(rules.syncExcludeFolders) }, added };
}

async function applyWorkbenchExclusions(service) {
  return service.withLock(async () => {
    if (!service.runtime) fail('RUNTIME_REQUIRED', '请从工作台暂停 FNS 后设置代码排除。');
    const first = await service.local();
    const initial = excludeWorkbenchCode(first.config, service.options.configDir, service.vault);
    if (!initial.added.length) return { changed: false, loaded: (await service.runtimeState(first.rules)).loaded, directories: codeDirectories(service.options.configDir, service.vault) };
    const base = path.join(service.vault, runtimeStorage.relative('workbench-code-sync', service.vault));
    await safePath(service.vault, base, { mkdir: true });
    const recovery = path.join(base, randomUUID());
    await safePath(service.vault, recovery, { mkdir: true });
    let previous;
    try {
      previous = await service.runtime.suspend();
      const current = await service.local();
      if (fingerprint(current.rules) !== fingerprint(first.rules)) fail('STALE_PLAN', '暂停期间 FNS 规则发生变化，请重新核对。');
      const desired = excludeWorkbenchCode(current.config, service.options.configDir, service.vault);
      await fs.writeFile(path.join(recovery, 'before.json'), current.raw, { flag: 'wx', mode: 0o600 });
      const next = JSON.stringify(desired.config, null, 2) + '\n';
      await replaceChecked(current.filename, current.raw, next, recovery);
    } finally { if (previous) await service.runtime.restore(previous); }
    const local = await service.local(), runtime = await service.runtimeState(local.rules);
    validateScope(local.rules, codeDirectories(service.options.configDir, service.vault));
    return { changed: true, loaded: runtime.loaded, directories: codeDirectories(service.options.configDir, service.vault), recovery: path.relative(service.vault, recovery) };
  });
}

module.exports = { codeDirectories, excludeWorkbenchCode, applyWorkbenchExclusions, inspectWorkbenchExclusions };
