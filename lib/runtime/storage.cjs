'use strict';
const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseJSONC } = require('../config/jsonc.cjs');

// Belongs to the explicit vault/development root, never to the software or
// Obsidian configuration directory. All clients share the same file locks.
const ROOT = '.system/.workbench-runtime';
const PREVIOUS = '.workbench-runtime';
const LEGACY = 'apps/workbench/data';
const CONTROL = '.system/workbench';
const CONFIG = `${CONTROL}/runtime.jsonc`;
const GATE = `${CONTROL}/migration.lock`;
const JOURNAL = `${CONTROL}/migration.json`;
const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
const stat = (file, io = fs) => io.lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
const contains = (a, b) => a.toLowerCase() === b.toLowerCase() || b.toLowerCase().startsWith(a.toLowerCase() + '/');
function directory(value) {
  const reserved = [...require('../vault/paths.js').READABLE_ROOTS, '.git', '.obsidian', '.agents', '.claude', '.credentials', '.scratch', 'config', 'lib', 'scripts', 'apps', 'docs', 'skills', 'templates', 'node_modules', CONTROL];
  if (typeof value !== 'string' || !value || /[\\:*?"<>|\[\]{}\x00-\x1f]/.test(value)
    || value.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))
    || reserved.some(p => contains(p, value) || contains(value, p))) fail('INVALID_RUNTIME_PATH', '请选择实例内独立的相对目录，不能使用绝对路径、上级路径、链接、业务内容、软件或配置目录。');
  return value;
}
function plainSync(root, name, file = false) {
  if (!path.isAbsolute(root || '')) fail('INVALID_INSTANCE', '运行位置需要明确的实例绝对路径。');
  let current = root;
  for (const [i, part] of ['', ...name.split('/')].entries()) {
    if (part) current = path.join(current, part);
    let info;
    try { info = sync.lstatSync(current); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const leaf = file && i === name.split('/').length;
    if (info.isSymbolicLink() || (leaf ? !info.isFile() : !info.isDirectory())) fail('UNSAFE_RUNTIME', `运行路径含链接或特殊文件：${name}`);
  }
  return current;
}
// No process cache: already-open clients and standalone commands resolve the
// same instance setting. Migration leases prevent it changing during a write.
function location(root) {
  if (!root) return { directory: ROOT, previousDirectories: [LEGACY, PREVIOUS], raw: null };
  const filename = plainSync(root, CONFIG, true);
  let raw = null;
  try { raw = sync.readFileSync(filename, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let value = {};
  if (raw !== null) {
    try { value = parseJSONC(raw); } catch { fail('INVALID_RUNTIME_CONFIG', `无法解析 ${CONFIG}，请保留原文并修复。`); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== 1 || typeof value.directory !== 'string'
      || !Array.isArray(value.previousDirectories) || value.previousDirectories.some(p => typeof p !== 'string')) fail('INVALID_RUNTIME_CONFIG', `位置配置无效：${CONFIG}`);
    directory(value.directory);
    for (const p of value.previousDirectories) if (p !== LEGACY) directory(p);
  }
  const selected = value.directory || ROOT;
  plainSync(root, selected);
  return { directory: selected, previousDirectories: [...new Set([LEGACY, PREVIOUS, ...(value.previousDirectories || [])])].filter(p => p !== selected), raw };
}
const relative = (component = '', root) => component ? `${location(root).directory}/${component}` : location(root).directory;
const protectedDirectories = root => [...new Set([relative('', root), CONTROL])];
async function plain(root, name, { mkdir = false, io = fs, file = false } = {}) {
  if (!path.isAbsolute(root) || !name || /[\\:\x00-\x1f]/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) fail('UNSAFE_RUNTIME', '运行记录必须位于明确实例的普通目录。');
  let current = root;
  const base = await stat(root, io);
  if (!base?.isDirectory() || base.isSymbolicLink()) fail('UNSAFE_RUNTIME', '实例根目录不是普通目录。');
  const parts = name.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let entry = await stat(current, io);
    const directory = !file || i < parts.length - 1;
    if (!entry && mkdir && directory) {
      await io.mkdir(current, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
      entry = await stat(current, io);
    }
    if (entry && (entry.isSymbolicLink() || (directory ? !entry.isDirectory() : !entry.isFile()))) fail('UNSAFE_RUNTIME', `运行路径含链接或特殊文件：${name}`);
  }
  return current;
}
async function assertReady(root, io = fs) {
  const current = location(root);
  for (const gate of [GATE, JOURNAL, `${current.directory}/migration.lock`]) {
    await plain(root, gate, { io, file: true });
    if (await stat(path.join(root, gate), io)) fail('RUNTIME_BUSY', '运行记录正在迁移或等待恢复，请核对迁移清单后再操作。');
  }
  for (const old of current.previousDirectories) {
    await plain(root, old, { io });
    if (await stat(path.join(root, old), io)) fail('RUNTIME_MIGRATION_REQUIRED', `存在旧运行目录 ${old}，请在工作台「运行数据位置」或 runtime-storage.mjs 中显式迁移；未创建新操作记录。`);
  }
}
// A lease covers the whole operation, in addition to each module's own lock.
// Migration takes its gate before checking leases; writers recheck after taking
// a lease, so neither side can pass the other between inspection and writing.
async function lease(root, io = fs) {
  await assertReady(root, io);
  const selected = relative('', root);
  const writers = await plain(root, `${selected}/writers`, { mkdir: true, io });
  const filename = path.join(writers, `${randomUUID()}.json`);
  const raw = JSON.stringify({ pid: process.pid, created: new Date().toISOString() });
  await io.writeFile(filename, raw, { flag: 'wx', mode: 0o600 });
  const release = async () => {
    await plain(root, `${selected}/writers`, { io });
    const info = await stat(filename, io);
    if (!info?.isFile() || info.isSymbolicLink() || await io.readFile(filename, 'utf8') !== raw) fail('RUNTIME_BUSY', '运行操作标识发生变化，已保留现场。');
    await io.unlink(filename);
  };
  try { await assertReady(root, io); if (relative('', root) !== selected) fail('RUNTIME_BUSY', '运行位置已变化，请重新操作。'); } catch (e) { await release(); throw e; }
  return release;
}
async function withRuntime(root, action, io = fs) {
  const release = await lease(root, io);
  try { return await action(); } finally { await release(); }
}
// Immutable historical receipts retain their bytes. Only known recovery path
// fields are interpreted through this alias; arbitrary document text is untouched.
function relocated(value, root) {
  const current = location(root);
  const old = current.previousDirectories.find(p => typeof value === 'string' && value.startsWith(p + '/'));
  return old ? current.directory + value.slice(old.length) : value;
}
module.exports = { ROOT, PREVIOUS, LEGACY, CONTROL, CONFIG, GATE, JOURNAL, location, directory, contains, protectedDirectories, relative, plain, stat, assertReady, lease, withRuntime, relocated, fail };

module.exports.assertFnsExcluded = (settings, root) => { const { normalize, validateScope } = require('../fns/rules.cjs'); validateScope(normalize(settings), protectedDirectories(root)); };
