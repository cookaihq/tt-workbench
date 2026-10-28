'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fail } = require('./rules.cjs');
async function safePath(root, filename, { mkdir = false, file = false } = {}) {
  const relative = path.relative(root, filename);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('INVALID_PATH', '操作路径超出当前库。');
  const parts = relative.split(path.sep).filter(Boolean); let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let info = await fs.lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    const isFile = file && i === parts.length - 1;
    if (!info && mkdir && !isFile) { await fs.mkdir(current, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; }); info = await fs.lstat(current); }
    if (info && (info.isSymbolicLink() || (isFile ? !info.isFile() : !info.isDirectory()))) fail('INVALID_PATH', '配置同步运行记录路径不是普通文件或目录。');
  }
  return filename;
}
async function atomicJSON(root, filename, value) {
  await safePath(root, path.dirname(filename), { mkdir: true });
  await safePath(root, filename, { file: true });
  const staged = path.join(path.dirname(filename), randomUUID() + '.staging');
  await fs.writeFile(staged, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try { await safePath(root, filename, { file: true }); await fs.rename(staged, filename); }
  finally { await fs.unlink(staged).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function acquireLock(root, filename, recover) {
  try { return await fs.open(filename, 'wx', 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const busy = () => fail('BUSY', '已有本机 FNS 同步操作；请等待完成。只有明确恢复且确认原进程已退出时才能接续遗留操作。');
  if (!recover) busy();
  await safePath(root, filename, { file: true });
  const before = await fs.lstat(filename), raw = await fs.readFile(filename, 'utf8');
  let owner;
  try { owner = JSON.parse(raw); } catch { busy(); }
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) busy();
  try { process.kill(owner.pid, 0); busy(); }
  catch (error) { if (error.code !== 'ESRCH') busy(); }
  const current = await fs.lstat(filename);
  if (current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev || await fs.readFile(filename, 'utf8') !== raw) busy();
  await fs.unlink(filename);
  try { return await fs.open(filename, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') busy(); throw error; }
}
async function replaceChecked(filename, expected, replacement, recovery) {
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('仅允许更新普通文件；旧 FNS 链接须先迁回。');
  const target = await fs.realpath(filename);
  const sameEntry = async () => {
    const current = await fs.lstat(filename);
    return current.isFile() && !current.isSymbolicLink() && await fs.realpath(filename) === target;
  };
  if (await fs.readFile(target, 'utf8') !== expected) throw new Error('文件已变化；未覆盖：' + filename);
  const staging = path.join(recovery, randomUUID() + '.staging');
  await fs.writeFile(staging, replacement, { flag: 'wx', mode: info.mode & 0o777 });
  if (!await sameEntry() || await fs.readFile(target, 'utf8') !== expected) throw new Error('文件并发变化；恢复材料位于 ' + recovery);
  await fs.rename(staging, target);
  if (!await sameEntry() || await fs.readFile(filename, 'utf8') !== replacement) throw new Error('读回校验不匹配：' + filename);
}

module.exports = { safePath, atomicJSON, acquireLock, replaceChecked };
