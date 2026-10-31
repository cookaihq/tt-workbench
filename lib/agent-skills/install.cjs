'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const packages = require('./package.cjs');
const { resolveVault, configDirectory } = require('../config/target.cjs');
const { fail, hash, compareVersions, MANIFEST } = packages;
const stamp = files => packages.contentHash(Object.fromEntries([...files].map(([name, bytes]) => [name, hash(bytes)])));
const stat = (io, file) => io.lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
async function plain(io, root, relative, create = false) {
  if ((await io.lstat(root)).isSymbolicLink() || path.resolve(await io.realpath(root)).toLowerCase() !== path.resolve(root).toLowerCase()) fail('UNSAFE_PATH', '安装根不能经过链接。');
  let current = root;
  for (const part of packages.relative(relative).split('/')) {
    current = path.join(current, part);
    if (create) { try { await io.mkdir(current); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    const info = await stat(io, current);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) fail('UNSAFE_PATH', 'Skill 安装路径不是普通目录。');
  }
  return current;
}
function locations(vault, configDir) {
  vault = resolveVault(vault); configDir = configDirectory(configDir);
  return { vault, configDir, root: path.join(vault, configDir, 'plugins/tt-workbench'), recoveryRoot: path.join(vault, configDir, 'plugins/tt-workbench-recovery'), lock: path.join(vault, configDir, 'plugins/tt-workbench.install-lock') };
}
async function tree(io, target) { return await stat(io, target) ? packages.readTree(target, '', io) : new Map(); }
async function writeRecord(io, target, value) {
  const next = path.join(path.dirname(target), `record-${randomUUID()}.json`);
  const raw = JSON.stringify(value, null, 2) + '\n';
  await io.writeFile(next, raw, { flag: 'wx' }); await io.rename(next, target);
  if (await io.readFile(target, 'utf8') !== raw) fail('VERIFY_FAILED', 'Skill 恢复记录读回失败。');
}
const writeJournal = (io, folder, value) => writeRecord(io, path.join(folder, 'operation.json'), value);
async function readExisting(io, root, name) {
  const files = await tree(io, path.join(root, 'skills', name));
  if (!files.size) return { files, userFiles: new Map(), version: null };
  if (files.has(MANIFEST)) {
    const checked = packages.inspectTree(files);
    if (checked.manifest.name !== name) fail('INVALID_SKILL_PACKAGE', '已安装 Skill 身份不一致。');
    return { ...checked, version: checked.actual.version };
  }
  // The one-time unversioned migration is authorized by the old core baseline.
  const baseline = require('../workbench/package.cjs').parseRelease(await io.readFile(path.join(root, 'release.json')));
  const prefix = `skills/${name}/`, known = Object.entries(baseline.files).filter(([file]) => file.startsWith(prefix));
  if (!known.length) fail('NO_BASELINE', '现有 Skill 来源无法核验，已保留原内容。');
  for (const [file, expected] of known) if (hash(files.get(file.slice(prefix.length)) || '') !== expected) fail('SKILL_CONTENT_CHANGED', '现有 Skill 有待保留的改动，请核对后再更新。');
  return { files, version: packages.metadata(files.get('SKILL.md')?.toString('utf8'), name, { legacy: true }).version, userFiles: new Map([...files].filter(([file]) => !Object.hasOwn(baseline.files, prefix + file))) };
}
async function installSkill(bundle, { vault, configDir = '.obsidian', workbenchVersion, expected, io = fs, beforeReplace } = {}) {
  packages.validateFiles(bundle.manifest, bundle.files);
  const loc = locations(vault, configDir), name = bundle.manifest.name;
  await plain(io, loc.vault, `${loc.configDir}/plugins/tt-workbench/skills`);
  const core = JSON.parse(await io.readFile(path.join(loc.root, 'manifest.json'), 'utf8'));
  if (core.id !== 'tt-workbench' || workbenchVersion && workbenchVersion !== core.version) fail('RESTART_REQUIRED', '工作台已更新，请重启 Obsidian 后再更新 Skill。');
  const reason = packages.compatibilityReason(bundle.manifest.compatibility, { workbench: core.version });
  if (reason) fail('SKILL_INCOMPATIBLE', reason);
  const baseline = require('../workbench/package.cjs').parseRelease(await io.readFile(path.join(loc.root, 'release.json')));
  if (!Object.hasOwn(baseline.skillPackages || {}, name)) fail('SKILL_MANAGER_REQUIRED', '请先安装支持此 Skill 独立更新的工作台版本。');
  const target = await plain(io, loc.root, `skills/${name}`), operation = randomUUID();
  let lock;
  try { lock = await io.open(loc.lock, 'wx'); } catch (e) { if (e.code === 'EEXIST') fail('BUSY', '正在安装工作台或 Skill；若上次更新中断，请使用“恢复上次更新”。'); throw e; }
  let folder, journal, safeToUnlock = true, lockText;
  try {
    lockText = JSON.stringify({ kind: 'skill', pid: process.pid, operation, name }); await lock.writeFile(lockText);
    await lock.close(); lock = null;
    const current = await readExisting(io, loc.root, name), before = stamp(current.files);
    if (expected && expected !== current.manifest?.contentHash) fail('STALE_SKILL', 'Skill 版本已变化，请重新检查后再更新。');
    if (current.version && compareVersions(bundle.manifest.version, current.version) <= 0) {
      if (bundle.manifest.version === current.version && bundle.manifest.contentHash === current.manifest?.contentHash) return { ok: true, changed: false, name, version: current.version };
      fail('IMMUTABLE_VERSION', '不能降级或用不同内容替换同一 Skill 版本。');
    }
    const incoming = new Map(bundle.files);
    for (const [file, bytes] of current.userFiles) {
      if (incoming.has(file) && hash(incoming.get(file)) !== hash(bytes)) fail('USER_FILE_CONFLICT', `新版与保留的个人文件 ${file} 重名，原版本保持可用。请先另存该文件后再更新。`);
      incoming.set(file, bytes);
    }
    incoming.set(MANIFEST, Buffer.from(JSON.stringify(bundle.manifest, null, 2) + '\n'));
    await plain(io, loc.vault, `${loc.configDir}/plugins/tt-workbench-recovery`, true);
    folder = await plain(io, loc.recoveryRoot, 'skill-' + operation, true);
    const stage = await plain(io, folder, 'stage', true), previous = path.join(folder, 'previous');
    for (const [file, bytes] of incoming) {
      const dest = path.join(stage, packages.relative(file)); await io.mkdir(path.dirname(dest), { recursive: true }); await io.writeFile(dest, bytes, { flag: 'wx' });
    }
    const after = stamp(incoming);
    if (stamp(await tree(io, stage)) !== after) fail('VERIFY_FAILED', 'Skill 安装前读回失败，原版本保持可用。');
    journal = { schema: 1, kind: 'tt-skill-install', operation, name, version: bundle.manifest.version, before, after, hadPrevious: current.files.size > 0, phase: 'prepared' };
    await writeJournal(io, folder, journal);
    await beforeReplace?.();
    await plain(io, loc.root, `skills/${name}`);
    if (stamp(await tree(io, target)) !== before) fail('STALE_SKILL', '安装准备期间 Skill 发生变化，原内容已保留。');
    // Mark intent before the first rename. Recovery derives truth from files,
    // so an interrupted journal update cannot conceal a completed rename.
    safeToUnlock = false;
    if (journal.hadPrevious) await io.rename(target, previous);
    journal.phase = 'previous-saved'; await writeJournal(io, folder, journal);
    await io.rename(stage, target);
    if (stamp(await tree(io, target)) !== after) fail('VERIFY_FAILED', 'Skill 替换后内容发生变化，请恢复上次更新。');
    journal.phase = 'complete'; await writeJournal(io, folder, journal); safeToUnlock = true;
    return { ok: true, changed: true, name, version: bundle.manifest.version, operation, recovery: folder };
  } catch (error) {
    if (!safeToUnlock && folder && journal) {
      const previous = path.join(folder, 'previous');
      try {
        const actual = await tree(io, target);
        if (!actual.size && journal.hadPrevious && stamp(await tree(io, previous)) === journal.before) await io.rename(previous, target);
        if (stamp(await tree(io, target)) === journal.before) { journal.phase = 'rolled-back'; await writeJournal(io, folder, journal); safeToUnlock = true; }
      } catch { /* Leave the verified journal, old files and lock for recovery. */ }
    }
    if (!safeToUnlock) {
      // A caught failure has finished even when its Obsidian process stays alive.
      // Persist this fact so the product can recover without killing the host.
      if (await io.readFile(loc.lock, 'utf8') === lockText) await writeRecord(io, loc.lock, { kind: 'skill', pid: process.pid, operation, name, state: 'interrupted' });
      throw Object.assign(Error(`Skill 更新未完成，请使用“恢复上次更新”。原版本及恢复材料已保留。${error.message}`), { code: 'RECOVERY_REQUIRED', operation });
    }
    throw error;
  } finally {
    await lock?.close();
    if (safeToUnlock && await io.readFile(loc.lock, 'utf8') === lockText) await io.unlink(loc.lock);
  }
}
async function pendingRecovery({ vault, configDir = '.obsidian', io = fs }) {
  const loc = locations(vault, configDir);
  await plain(io, loc.vault, `${loc.configDir}/plugins`);
  const info = await stat(io, loc.lock);
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) fail('UNSAFE_PATH', '安装锁需要核对。');
  let lock;
  try { lock = JSON.parse(await io.readFile(loc.lock, 'utf8')); } catch { return { kind: 'unknown', recoverable: false }; }
  return { ...lock, recoverable: lock.kind === 'skill' && /^[a-f0-9-]{36}$/.test(lock.operation) && packages.validName(lock.name) };
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
async function recoverSkill({ vault, configDir = '.obsidian', operation, mode = 'rollback', io = fs } = {}) {
  if (!['rollback', 'finish'].includes(mode) || !/^[a-f0-9-]{36}$/.test(operation || '')) fail('INVALID_RECOVERY', '请明确本次恢复标识与恢复方式。');
  const loc = locations(vault, configDir), lock = await pendingRecovery({ vault, configDir, io });
  if (!lock?.recoverable || lock.operation !== operation) fail('STALE_RECOVERY', '上次更新状态已变化，请重新检查。');
  if (lock.state !== 'interrupted' && processAlive(lock.pid)) fail('BUSY', '原安装进程仍在运行，请等待该操作结束。');
  const folder = await plain(io, loc.vault, `${loc.configDir}/plugins/tt-workbench-recovery/skill-${operation}`);
  const file = path.join(folder, 'operation.json'), info = await io.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) fail('INVALID_RECOVERY', '恢复记录无法安全读取。');
  const journal = JSON.parse(await io.readFile(file, 'utf8'));
  if (journal.schema !== 1 || journal.kind !== 'tt-skill-install' || journal.operation !== operation || journal.name !== lock.name || !packages.validHash(journal.before) || !packages.validHash(journal.after) || typeof journal.hadPrevious !== 'boolean') fail('INVALID_RECOVERY', '恢复记录与安装锁不一致。');
  const claim = path.join(folder, 'recovery.lock');
  const claimInfo = await stat(io, claim);
  if (claimInfo) {
    if (!claimInfo.isFile() || claimInfo.isSymbolicLink() || claimInfo.size > 1024) fail('INVALID_RECOVERY', '恢复锁需要核对。');
    const raw = await io.readFile(claim, 'utf8');
    let owner; try { owner = JSON.parse(raw); } catch { fail('INVALID_RECOVERY', '恢复锁无法读取，已保留现场。'); }
    if (processAlive(owner.pid)) fail('BUSY', '另一恢复操作仍在执行。');
    if (await io.readFile(claim, 'utf8') !== raw) fail('BUSY', '恢复状态已变化，请重新检查。');
    await io.unlink(claim);
  }
  const handle = await io.open(claim, 'wx');
  const claimText = JSON.stringify({ pid: process.pid, token: randomUUID() });
  await handle.writeFile(claimText);
  try {
    const again = await pendingRecovery({ vault, configDir, io });
    if (JSON.stringify(again) !== JSON.stringify(lock)) fail('STALE_RECOVERY', '恢复前安装锁已变化。');
    const target = await plain(io, loc.root, `skills/${journal.name}`), previous = await plain(io, folder, 'previous'), stage = await plain(io, folder, 'stage');
    const targetFiles = await tree(io, target), previousFiles = await tree(io, previous), stageFiles = await tree(io, stage);
    const targetHash = stamp(targetFiles), previousHash = stamp(previousFiles), stageHash = stamp(stageFiles);
    if (mode === 'rollback') {
      if (targetHash !== journal.before) {
        if (targetFiles.size && targetHash !== journal.after || journal.hadPrevious && previousHash !== journal.before) fail('RECOVERY_CONFLICT', '更新后文件已有其他变化，保留现场，请核对恢复材料。');
        if (targetFiles.size) await io.rename(target, path.join(folder, 'unapplied-' + randomUUID()));
        if (journal.hadPrevious) await io.rename(previous, target);
      }
      if (stamp(await tree(io, target)) !== journal.before) fail('VERIFY_FAILED', '原 Skill 恢复后核验失败。');
    } else if (targetHash !== journal.after) {
      if (stageHash !== journal.after || targetFiles.size && targetHash !== journal.before || previousFiles.size && previousHash !== journal.before) fail('RECOVERY_CONFLICT', '暂存版本或原内容已变化，保留现场。');
      if (targetFiles.size) {
        if (previousFiles.size) fail('RECOVERY_CONFLICT', '原内容存在两份，需先核对。');
        await io.rename(target, previous);
      }
      await io.rename(stage, target);
      if (stamp(await tree(io, target)) !== journal.after) fail('VERIFY_FAILED', '接续安装后核验失败。');
    }
    journal.phase = mode === 'rollback' ? 'rolled-back' : 'complete'; await writeJournal(io, folder, journal);
    if (JSON.stringify(await pendingRecovery({ vault, configDir, io })) !== JSON.stringify(lock)) fail('STALE_RECOVERY', '恢复后安装锁已变化，已保留。');
    await io.unlink(loc.lock);
    return { ok: true, name: journal.name, operation, mode, recovery: folder };
  } finally { await handle.close(); if (await io.readFile(claim, 'utf8') === claimText) await io.unlink(claim); }
}
module.exports = { installSkill, recoverSkill, pendingRecovery, readExisting, stamp };
