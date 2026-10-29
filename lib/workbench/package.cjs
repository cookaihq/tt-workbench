'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const { configDirectory, resolveVault } = require('../config/target.cjs');
const ID = 'tt-workbench';
const LEGACY_ID = 'tannt-workbench';
const { ROOT, PREVIOUS, CONTROL } = require('../runtime/storage.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const stat = file => fs.lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
function relative(name) {
  if (typeof name !== 'string' || !name || /[\\:\x00-\x1f]/.test(name) || name.split('/').some(s => !s || s === '.' || s === '..' || /[. ]$/.test(s))) fail('INVALID_PACKAGE', '安装包路径无效。');
  return name;
}
async function plain(root, name) {
  let current = root;
  for (const part of relative(name).split('/')) {
    current = path.join(current, part);
    const info = await stat(current);
    if (info?.isSymbolicLink()) fail('UNSAFE_PATH', '安装路径包含符号链接。');
  }
  return current;
}
async function readTree(root, prefix = '') {
  const files = new Map();
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) fail('UNSAFE_PATH', '安装目录包含链接或特殊文件。');
    const name = prefix + entry.name, file = path.join(root, entry.name);
    if (entry.isDirectory()) for (const [key, bytes] of await readTree(file, name + '/')) files.set(key, bytes);
    else files.set(name, await fs.readFile(file));
  }
  return files;
}
function fingerprint(files) { return hash(JSON.stringify([...files].map(([name, bytes]) => [name, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b)))); }
function parseRelease(raw, expectedId = ID) {
  let value;
  try { value = JSON.parse(raw); } catch { fail('INVALID_PACKAGE', '安装包清单不是有效 JSON。'); }
  if (value?.schema !== 1 || value.id !== expectedId || !/^\d+\.\d+\.\d+$/.test(value.version) || !value.files || Array.isArray(value.files) || typeof value.files !== 'object') fail('INVALID_PACKAGE', '安装包清单不完整。');
  const names = Object.keys(value.files), seen = new Set();
  if (!names.length || names.length > 2000) fail('INVALID_PACKAGE', '安装包文件数量无效。');
  for (const name of names) {
    relative(name);
    if (name === 'release.json' || name === 'data.json' || name.startsWith('data/') || name.startsWith('apps/workbench/data/') || [ROOT, PREVIOUS, CONTROL].some(p => name === p || name.startsWith(p + '/')) || seen.has(name.toLowerCase()) || !/^[a-f0-9]{64}$/.test(value.files[name])) fail('INVALID_PACKAGE', '安装包文件清单无效。');
    seen.add(name.toLowerCase());
  }
  for (const name of ['main.js', 'manifest.json', 'styles.css']) if (!value.files[name]) fail('INVALID_PACKAGE', '安装包缺少插件入口。');
  return value;
}
function validateFiles(release, files) {
  let total = 0;
  if (files.size !== Object.keys(release.files).length) fail('INVALID_PACKAGE', '安装包含未登记文件或缺少文件。');
  for (const [name, expected] of Object.entries(release.files)) {
    const bytes = files.get(name);
    if (!Buffer.isBuffer(bytes) || hash(bytes) !== expected) fail('VERIFY_FAILED', '安装包文件校验失败：' + name);
    total += bytes.length;
    if (total > 64 * 1024 * 1024) fail('INVALID_PACKAGE', '安装包过大。');
  }
  let manifest;
  try { manifest = JSON.parse(files.get('manifest.json')); } catch { fail('INVALID_PACKAGE', '插件元数据无法读取。'); }
  if (manifest.id !== ID || manifest.version !== release.version) fail('INVALID_PACKAGE', '插件版本与清单不一致。');
  return manifest;
}
function decodeBundle(bytes) {
  let object;
  try { object = JSON.parse(gunzipSync(bytes, { maxOutputLength: 96 * 1024 * 1024 })); } catch { fail('INVALID_PACKAGE', '安装包无法解压读取。'); }
  const release = parseRelease(JSON.stringify(object.release));
  if (!object.files || Array.isArray(object.files) || typeof object.files !== 'object') fail('INVALID_PACKAGE', '安装包缺少文件。');
  const files = new Map(Object.entries(object.files).map(([name, value]) => {
    relative(name);
    if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('INVALID_PACKAGE', '安装包编码无效。');
    return [name, Buffer.from(value, 'base64')];
  }));
  const manifest = validateFiles(release, files);
  return { release, files, manifest };
}
function encodeBundle({ release, files }) { return gzipSync(Buffer.from(JSON.stringify({ release, files: Object.fromEntries([...files].map(([name, bytes]) => [name, bytes.toString('base64')])) }))); }
async function collectPackage(root) {
  const files = new Map();
  async function collect(directory) {
    for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      if (['tests', 'data', 'verification', 'vendor-tests'].includes(entry.name) || /\.test\.(cjs|mjs)$/.test(entry.name)) continue;
      const name = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) fail('UNSAFE_SOURCE', '打包源不能包含链接：' + name);
      if (entry.isDirectory()) await collect(name);
      else files.set(name, await fs.readFile(path.join(root, name)));
    }
  }
  for (const dir of ['apps/workbench', 'lib', 'skills', 'templates', 'docs/rules', 'docs/agents', 'docs/workbench', 'docs/adr']) await collect(dir);
  for (const dir of ['scripts/agent-skills', 'scripts/cloud-files', 'scripts/fns', 'scripts/global-agent-instructions']) await collect(dir);
  for (const name of ['scripts/vault/write.mjs', 'scripts/workbench/issue-request.cjs', 'scripts/workbench/agent-request.mjs', 'scripts/workbench/install.mjs', 'scripts/workbench/runtime-storage.mjs', 'scripts/fns-hidden-audit.mjs', 'GLOSSARY.md', 'README.md']) files.set(name, await fs.readFile(path.join(root, name)));
  for (const [name, bytes] of [...files]) if (name.startsWith('apps/workbench/') && !name.slice(15).includes('/') && /\.(js|css|json)$/.test(name)) files.set(name.slice(15), bytes);
  for (const name of ['manifest.json', 'styles.css']) files.set(name, await fs.readFile(path.join(root, 'apps/workbench', name)));
  const manifest = JSON.parse(files.get('manifest.json'));
  const release = { schema: 1, id: ID, version: manifest.version, files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, hash(bytes)])) };
  validateFiles(release, files);
  return { release, files, manifest };
}
async function installPackage(bundle, { vault, configDir = '.obsidian', check = false, migrateLegacy = false, beforeReplace } = {}) {
  vault = resolveVault(vault); configDir = configDirectory(configDir);
  validateFiles(bundle.release, bundle.files);
  const relativeTarget = `${configDir}/plugins/${ID}`;
  const target = await plain(vault, relativeTarget), info = await stat(target);
  if (info && !info.isDirectory()) fail('UNSAFE_PATH', '插件安装目标不是普通目录。');
  const legacyRelative = `${configDir}/plugins/${LEGACY_ID}`;
  const legacy = await plain(vault, legacyRelative), legacyInfo = await stat(legacy);
  if (legacyInfo && !legacyInfo.isDirectory()) fail('UNSAFE_PATH', '旧插件安装位置不是普通目录。');
  if (legacyInfo && info) fail('LEGACY_CONFLICT', '新旧插件目录同时存在，请先核对两个目录的设置与版本。');
  if (legacyInfo && !migrateLegacy && !check) fail('LEGACY_MIGRATION_REQUIRED', '发现 tannt-workbench。关闭 Obsidian 后使用 --migrate-legacy 迁移到 tt-workbench；插件设置会保留，Skill 入口需另行修复。');
  const previous = legacyInfo ? legacy : target, previousInfo = legacyInfo || info;
  const migration = legacyInfo ? { from: legacy, to: target, activationRequired: true, skillsRequireRepair: true } : null;
  const before = previousInfo ? await readTree(previous) : new Map();
  const incoming = new Map(bundle.files);
  incoming.set('release.json', Buffer.from(JSON.stringify(bundle.release, null, 2) + '\n'));
  let baseline;
  if (before.size) {
    if (!before.has('release.json')) fail('NO_BASELINE', '已有插件缺少校验清单，请先保留并核对该目录。');
    baseline = parseRelease(before.get('release.json'), legacyInfo ? LEGACY_ID : ID);
    for (const [name, expected] of Object.entries(baseline.files)) if (!before.has(name) || hash(before.get(name)) !== expected) fail('LOCAL_CHANGES', '安装文件已被本机修改：' + name);
    const manifest = JSON.parse(before.get('manifest.json'));
    if (manifest.id !== baseline.id || manifest.version !== baseline.version) fail('INVALID_PACKAGE', '原插件元数据与校验清单不一致。');
    for (const [name, bytes] of before) if (name !== 'release.json' && !baseline.files[name]) {
      if (incoming.has(name)) fail('LOCAL_CHANGES', '新包与本机文件重名：' + name);
      incoming.set(name, bytes);
    }
  }
  const changed = Boolean(legacyInfo) || fingerprint(before) !== fingerprint(incoming);
  if (check || !changed) return { ok: !check || !changed, mode: check ? 'check' : 'install', changed, target, version: bundle.release.version, migration };
  const parent = path.dirname(target);
  await plain(vault, `${configDir}/plugins`);
  await fs.mkdir(parent, { recursive: true });
  const locks = [];
  let stage, recovery, recoveryRoot, moved = false;
  try {
    // Also coordinate with the old installer while moving its installation.
    for (const pluginId of legacyInfo ? [LEGACY_ID, ID] : [ID]) {
      const lockPath = path.join(parent, pluginId + '.install-lock');
      const lock = await fs.open(lockPath, 'wx'); locks.push({ lock, lockPath });
      await lock.writeFile(JSON.stringify({ pid: process.pid, version: bundle.release.version }));
    }
    const id = randomUUID();
    recoveryRoot = await plain(vault, `${configDir}/plugins/${ID}-recovery`);
    await fs.mkdir(recoveryRoot, { recursive: true });
    stage = path.join(recoveryRoot, 'stage-' + id);
    await fs.mkdir(stage);
    for (const [name, bytes] of incoming) {
      const file = path.join(stage, relative(name));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: 'wx' });
    }
    if (fingerprint(await readTree(stage)) !== fingerprint(incoming)) fail('VERIFY_FAILED', '安装前读回校验失败。');
    await beforeReplace?.();
    await plain(vault, relativeTarget);
    await plain(vault, legacyRelative);
    if (legacyInfo ? await stat(target) : await stat(legacy)) fail('LOCAL_CHANGES', '安装准备期间出现另一插件目录，请重新核对。');
    const latest = await stat(previous) ? await readTree(previous) : new Map();
    if (fingerprint(latest) !== fingerprint(before)) fail('LOCAL_CHANGES', '安装准备期间文件发生变化。');
    if (previousInfo) {
      recovery = path.join(recoveryRoot, id);
      await fs.rename(previous, recovery); moved = true;
    }
    try { await fs.rename(stage, target); stage = null; moved = false; }
    catch (error) { if (moved) { await fs.rename(recovery, previous); moved = false; } throw error; }
    if (fingerprint(await readTree(target)) !== fingerprint(incoming)) fail('VERIFY_FAILED', '安装后文件发生变化，请核对恢复记录。');
    return { ok: true, mode: 'install', changed: true, target, version: bundle.release.version, recovery, migration };
  } finally {
    // Cleanup is limited to the verified, generated stage under the recovery root.
    if (stage && recoveryRoot && path.dirname(stage) === recoveryRoot && path.basename(stage).startsWith('stage-')) await fs.rm(stage, { recursive: true, force: true });
    for (const { lock, lockPath } of locks.reverse()) { await lock.close(); if (!moved) await fs.unlink(lockPath); }
  }
}
module.exports = { ID, LEGACY_ID, hash, relative, parseRelease, validateFiles, decodeBundle, encodeBundle, collectPackage, installPackage, readTree, fingerprint };
