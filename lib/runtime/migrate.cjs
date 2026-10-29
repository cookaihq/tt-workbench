'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { plain, stat, fail } = require('./storage.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const KNOWN = new Set(['vault-io', 'issues', 'fns-device-config', 'fns-sync', 'workbench-code-sync', 'fns-env-support', 'agent-skills', 'lark-wiki-sync', 'agent-bridge.json']);
const lockName = name => /(?:^|\/)[^/]*\.lock$/.test(name) || name.startsWith('vault-io/locks/') || name.startsWith('writers/');

async function inventory(root, directory) {
  await plain(root, directory);
  const files = [], directories = [], unknown = [], locks = [];
  const walk = async (relative = '') => {
    const current = relative ? `${directory}/${relative}` : directory;
    for (const entry of await fs.readdir(path.join(root, current), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) fail('UNSAFE_RUNTIME', `保留链接或特殊文件：${directory}/${name}`);
      if (!relative && !KNOWN.has(entry.name) && !['writers', 'migration.lock'].includes(entry.name)) unknown.push(name);
      if (entry.isDirectory()) { directories.push(name); await walk(name); }
      else {
        const bytes = await fs.readFile(await plain(root, `${directory}/${name}`, { file: true }));
        files.push({ path: name, sha256: hash(bytes), bytes: bytes.length });
        if (lockName(name) || name === 'agent-bridge.json') locks.push(name);
      }
    }
  };
  if (await stat(path.join(root, directory))) await walk();
  // An empty lock directory can be the instant between mkdir and owner.json.
  for (const name of directories) if (name.startsWith('vault-io/locks/')) locks.push(name);
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), directories: directories.sort(), unknown, locks: [...new Set(locks)] };
}
async function backupDirectory(vault, backup) {
  if (!backup || !path.isAbsolute(backup)) fail('BACKUP_REQUIRED', '迁移需要明确的库外绝对 --backup 路径。');
  backup = path.resolve(backup);
  for (const [a, b] of [[vault, backup], [backup, vault]]) {
    const rel = path.relative(a, b);
    if (!rel || !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)) fail('UNSAFE_BACKUP', '备份与实例目录不能互相包含。');
  }
  const base = path.parse(backup).root, name = path.relative(base, backup).split(path.sep).join('/');
  await plain(base, name, { mkdir: true });
  return backup;
}
async function saveManifest(backup, value) {
  const content = JSON.stringify(value, null, 2) + '\n';
  const staging = await plain(backup, `manifest-${randomUUID()}.next`, { file: true });
  await fs.writeFile(staging, content, { flag: 'wx', mode: 0o600 });
  await plain(backup, 'manifest.json', { file: true });
  await fs.rename(staging, path.join(backup, 'manifest.json'));
  if (await fs.readFile(path.join(backup, 'manifest.json'), 'utf8') !== content) fail('VERIFY_FAILED', '迁移清单读回不一致。');
}
async function copyVerified(from, to, entry) {
  const source = await plain(from, entry.path, { file: true });
  const bytes = await fs.readFile(source);
  if (hash(bytes) !== entry.sha256) fail('SOURCE_CHANGED', `源版本变化：${entry.path}`);
  const destination = await plain(to, entry.path, { file: true, mkdir: true });
  if (await stat(destination)) {
    if (hash(await fs.readFile(destination)) !== entry.sha256) fail('TARGET_CONFLICT', `目标已有不同内容：${entry.path}`);
  } else await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
  if (hash(await fs.readFile(destination)) !== entry.sha256) fail('VERIFY_FAILED', `目标读回不一致：${entry.path}`);
}
async function verify(root, entries, allowMissing = false) {
  if (allowMissing && !await stat(root)) return;
  for (const entry of entries) {
    const filename = await plain(root, entry.path, { file: true });
    if (allowMissing && !await stat(filename)) continue;
    if (hash(await fs.readFile(filename)) !== entry.sha256) fail('SOURCE_CHANGED', `记录在操作后变化：${entry.path}`);
  }
}
async function prune(vault, directories) {
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    await plain(vault, directory);
    try { await fs.rmdir(path.join(vault, directory)); }
    catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e; }
  }
}
// Public entry points share the configurable-location migration protocol.
module.exports = { inventory, backupDirectory, saveManifest, copyVerified, verify, prune, hash, KNOWN, lockName,
  inspect: options => require('./location-migration.cjs').inspect(options),
  migrate: options => require('./location-migration.cjs').migrate(options),
  isolation: (...args) => require('./location-migration.cjs').isolation(...args) };
