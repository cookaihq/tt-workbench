'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SkillManager } = require('../manager.cjs');
const base = path.resolve(__dirname, '../../../tmp/skill-manager-tests');
async function fixture(t, names = ['one', 'two']) {
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'run-'));
  t.after(async () => { assert.equal(path.dirname(root), base); await fs.rm(root, { recursive: true, force: true }); });
  const vault = path.join(root, '知识库'), packageRoot = path.join(vault, 'custom/plugins/tannt-workbench');
  await fs.mkdir(path.join(packageRoot, 'skills'), { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'skills/manifest.jsonc'), JSON.stringify({ skills: names }));
  for (const name of names) { await fs.mkdir(path.join(packageRoot, 'skills', name)); await fs.writeFile(path.join(packageRoot, 'skills', name, 'SKILL.md'), `---\r\nname: ${name}\r\ndescription: Sample\r\n---\r\n# Sample\r\n`); }
  const io = { ...fs }, manager = new SkillManager({ vault, packageRoot, configDir: 'custom', io });
  const entry = (name = 'one', agent = 'codex') => path.join(vault, manager.host(agent).directory, name);
  const runtime = path.join(vault, manager.runtime);
  return { root, vault, packageRoot, io, manager, entry, runtime };
}
const outcomes = report => report.results.map(i => i.outcome);

test('首次检查只读；单项、双宿主、更新与移除采用真实文件且相互隔离', async t => {
  const h = await fixture(t), before = await fs.readdir(h.vault);
  const s = await h.manager.scan(); assert.deepEqual(s.items.map(i => i.status), ['absent', 'absent']);
  assert.deepEqual(await fs.readdir(h.vault), before);
  assert.equal((await h.manager.apply({ names: ['one'] })).ok, true);
  assert.equal(await fs.realpath(h.entry()), path.join(h.packageRoot, 'skills/one'));
  assert.deepEqual((await h.manager.scan('claude')).items.map(i => i.status), ['absent', 'absent']);
  await h.manager.apply({ agent: 'claude', names: ['one'] });
  await fs.appendFile(path.join(h.packageRoot, 'skills/one/SKILL.md'), '\nUpdated resource');
  assert.equal((await h.manager.scan()).items[0].status, 'installed');
  assert.equal((await h.manager.apply({ action: 'remove', names: ['one'] })).ok, true);
  assert.equal((await h.manager.scan()).items[0].status, 'absent');
  assert.equal((await h.manager.scan('claude')).items[0].status, 'installed');
  assert.match(await fs.readFile(path.join(h.packageRoot, 'skills/one/SKILL.md'), 'utf8'), /Updated/);
});

test('普通文件、目录及外部和断开的陌生链接均保留；批量只安装其余项', async t => {
  const h = await fixture(t, ['file', 'folder', 'foreign', 'dangling', 'fresh']);
  await fs.mkdir(path.dirname(h.entry()), { recursive: true });
  await fs.writeFile(h.entry('file'), 'mine'); await fs.mkdir(h.entry('folder'));
  await fs.writeFile(path.join(h.entry('folder'), 'keep'), 'keep');
  await fs.symlink(h.root, h.entry('foreign'), 'dir'); await fs.symlink(path.join(h.root, 'missing'), h.entry('dangling'), 'dir');
  const scan = await h.manager.scan(); assert.deepEqual(scan.items.map(i => i.status), ['conflict', 'conflict', 'conflict', 'conflict', 'absent']);
  const report = await h.manager.apply({}); assert.deepEqual(outcomes(report), ['skipped', 'skipped', 'skipped', 'skipped', 'success']); assert.equal(report.ok, false);
  assert.equal(await fs.readFile(h.entry('file'), 'utf8'), 'mine'); assert.equal(await fs.readFile(path.join(h.entry('folder'), 'keep'), 'utf8'), 'keep');
  assert.equal(await fs.readlink(h.entry('foreign')), h.root);
  assert.equal((await h.manager.apply({ action: 'remove', names: ['foreign'] })).results[0].outcome, 'skipped');
});

test('只修复记录证明的旧源；普通安装跳过损坏项，未知旧源仍冲突', async t => {
  const h = await fixture(t); await h.manager.apply({ names: ['one'] });
  const next = path.join(h.vault, 'new-settings/plugins/tannt-workbench'); await fs.mkdir(path.dirname(next), { recursive: true }); await fs.rename(h.packageRoot, next);
  const manager = new SkillManager({ vault: h.vault, packageRoot: next, configDir: 'new-settings' });
  assert.equal((await manager.scan()).items[0].status, 'broken');
  assert.deepEqual(outcomes(await manager.apply({})), ['skipped', 'success']);
  assert.equal((await manager.apply({ action: 'repair', names: ['one'] })).ok, true);
  assert.equal(await fs.realpath(h.entry()), path.join(next, 'skills/one'));
  await fs.unlink(h.entry('two')); await fs.symlink(path.join(h.root, 'unknown/skills/two'), h.entry('two'), 'dir');
  assert.equal((await manager.scan()).items[1].status, 'conflict');
});

test('资源缺失、读取拒绝、坏记录及链接父目录显示检查失败且禁止依赖写入', async t => {
  const h = await fixture(t); await fs.unlink(path.join(h.packageRoot, 'skills/one/SKILL.md'));
  assert.equal((await h.manager.scan()).items[0].status, 'error');
  assert.deepEqual(outcomes(await h.manager.apply({})), ['skipped', 'success']);
  const lstat = h.io.lstat; h.io.lstat = async file => { if (file === h.entry('two')) throw Object.assign(Error('denied'), { code: 'EACCES' }); return lstat(file); };
  assert.equal((await h.manager.scan()).items[1].status, 'error'); h.io.lstat = lstat;
  await fs.writeFile(path.join(h.runtime, 'registry.json'), '{broken');
  assert.ok((await h.manager.scan()).items.every(i => i.status === 'error'));
  const other = await fixture(t); await fs.symlink(other.root, path.join(other.vault, '.agents'), 'dir');
  assert.ok((await other.manager.scan()).items.every(i => i.status === 'error'));
  await assert.rejects(other.manager.apply({}), { code: 'ISOLATION_REQUIRED' });
  assert.equal(await fs.readlink(path.join(other.vault, '.agents')), other.root);
});

test('清单路径穿越、重复与链接源被拒绝；只读操作不创建运行记录', async t => {
  const h = await fixture(t);
  for (const skills of [['../escape'], ['same', 'same'], ['..'], ['bad:name']]) {
    await fs.writeFile(path.join(h.packageRoot, 'skills/manifest.jsonc'), JSON.stringify({ skills }));
    await assert.rejects(h.manager.scan(), { code: 'INVALID_MANIFEST' });
  }
  assert.equal(await h.manager.stat(h.runtime), null);
  await fs.writeFile(path.join(h.packageRoot, 'skills/manifest.jsonc'), '{"skills":["three"]}');
  await fs.symlink(path.join(h.packageRoot, 'skills/one'), path.join(h.packageRoot, 'skills/three'), 'dir');
  assert.equal((await h.manager.scan()).items[0].status, 'error');
});

test('陈旧页面、创建瞬间冲突、并发调用与遗留锁均不会覆盖新内容', async t => {
  const h = await fixture(t); const old = await h.manager.scan();
  await fs.mkdir(path.dirname(h.entry()), { recursive: true }); await fs.writeFile(h.entry(), 'new content');
  let report = await h.manager.apply({ names: ['one'], expected: { one: old.items[0].token } });
  assert.match(report.results[0].message, /STALE/); assert.equal(await fs.readFile(h.entry(), 'utf8'), 'new content');
  const symlink = h.io.symlink; h.io.symlink = async (target, entry, kind) => { if (entry === h.entry('two')) await fs.writeFile(entry, 'raced', { flag: 'wx' }); return symlink(target, entry, kind); };
  report = await h.manager.apply({ names: ['two'] }); assert.equal(report.ok, false); assert.equal(await fs.readFile(h.entry('two'), 'utf8'), 'raced');
  await fs.writeFile(path.join(h.runtime, 'operation.lock'), 'previous operation');
  await assert.rejects(h.manager.apply({ names: ['one'] }), { code: 'BUSY' });
  assert.equal((await h.manager.scan()).busy, true);
});

test('移除时被替换的普通文件保存在恢复位置，新内容不会被删除', async t => {
  const h = await fixture(t); await h.manager.apply({ names: ['one'] });
  const rename = h.io.rename; let recovered;
  h.io.rename = async (from, to) => { if (from === h.entry()) { await fs.unlink(from); await fs.writeFile(from, 'concurrent document'); recovered = to; } return rename(from, to); };
  const result = await h.manager.apply({ action: 'remove', names: ['one'] });
  assert.equal(result.ok, false); assert.equal(await fs.readFile(recovered, 'utf8'), 'concurrent document');
  assert.match(result.results[0].message, /恢复材料/);
});

test('预览中无法检查的项恢复后仍须重新确认，不能混入本次批量安装', async t => {
  const h = await fixture(t), resource = path.join(h.packageRoot, 'skills/one/SKILL.md');
  const content = await fs.readFile(resource, 'utf8'); await fs.unlink(resource);
  const preview = await h.manager.scan();
  const expected = Object.fromEntries(preview.items.map(item => [item.name, item.token]));
  assert.equal(expected.one, null);
  await fs.writeFile(resource, content);
  const report = await h.manager.apply({ expected });
  assert.deepEqual(outcomes(report), ['failed', 'success']); assert.match(report.results[0].message, /STALE/);
  assert.equal(report.snapshot.items[0].status, 'absent');
});

test('外部替换操作锁时保留新内容并报告未释放', async t => {
  const h = await fixture(t), symlink = h.io.symlink, lock = path.join(h.runtime, 'operation.lock');
  h.io.symlink = async (...args) => {
    await fs.rename(lock, path.join(h.runtime, 'original.lock'));
    await fs.writeFile(lock, 'external owner', { flag: 'wx' });
    return symlink(...args);
  };
  const report = await h.manager.apply({ names: ['one'] });
  assert.equal(report.ok, false); assert.equal(report.snapshot.busy, true);
  assert.match(report.warnings[0], /操作锁已变化/); assert.equal(await fs.readFile(lock, 'utf8'), 'external owner');
});

test('同时写入的第二个管理器被锁阻止，不抢占活跃操作', async t => {
  const h = await fixture(t);
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const symlink = h.io.symlink;
  h.io.symlink = async (...args) => { entered(); await gate; return symlink(...args); };
  const first = h.manager.apply({ names: ['one'] });
  await reached;
  const second = new SkillManager({ vault: h.vault, packageRoot: h.packageRoot, configDir: 'custom' });
  try { await assert.rejects(second.apply({ names: ['two'] }), { code: 'BUSY' }); }
  finally { release(); }
  assert.equal((await first).ok, true);
  assert.equal((await second.scan()).items[1].status, 'absent');
});

test('记录失败不污染下一项；入口实际状态、回执失败和移除恢复分别报告', async t => {
  const h = await fixture(t); const rename = h.io.rename;
  let failed = false;
  h.io.rename = async (from, to) => { if (!failed && to === path.join(h.runtime, 'registry.json')) { failed = true; throw Object.assign(Error('disk full'), { code: 'ENOSPC' }); } return rename(from, to); };
  const report = await h.manager.apply({});
  assert.deepEqual(outcomes(report), ['failed', 'success']); assert.ok(report.snapshot.items.every(i => i.status === 'installed'));
  const disk = JSON.parse(await fs.readFile(path.join(h.runtime, 'registry.json'), 'utf8'));
  assert.deepEqual(Object.keys(disk.entries), ['codex/two']);
  h.io.rename = async (from, to) => { if (to === path.join(h.runtime, 'registry.json')) throw Object.assign(Error('disk full'), { code: 'ENOSPC' }); return rename(from, to); };
  const removed = await h.manager.apply({ action: 'remove', names: ['two'] });
  assert.equal(removed.ok, false); assert.equal(removed.snapshot.items[1].status, 'installed'); assert.match(removed.results[0].message, /已恢复/);
  h.io.rename = rename;
  const writeFile = h.io.writeFile;
  h.io.writeFile = async (file, text, options) => { if (/^[a-f0-9-]{36}\.json$/.test(path.basename(file))) throw Error('receipt denied'); return writeFile(file, text, options); };
  const receipt = await h.manager.apply({ action: 'remove', names: ['two'] });
  assert.equal(receipt.ok, false); assert.equal(receipt.results[0].outcome, 'success'); assert.equal(receipt.snapshot.items[1].status, 'absent'); assert.match(receipt.warnings[0], /回执未保存/);
});

test('修复创建失败恢复旧链接；外部同时占位则保留双方并指出恢复位置', async t => {
  const h = await fixture(t); await h.manager.apply({ names: ['one'] });
  const next = path.join(h.vault, 'next'); await fs.rename(h.packageRoot, next);
  const manager = new SkillManager({ vault: h.vault, packageRoot: next, io: h.io });
  const original = await fs.readlink(h.entry()), symlink = h.io.symlink;
  let first = true;
  h.io.symlink = async (...args) => { if (first) { first = false; throw Error('creation failed'); } return symlink(...args); };
  let report = await manager.apply({ action: 'repair', names: ['one'] });
  assert.equal(report.ok, false); assert.equal(await fs.readlink(h.entry()), original); assert.equal(report.snapshot.items[0].status, 'broken');
  h.io.symlink = async (...args) => { if (!await manager.stat(h.entry())) await fs.writeFile(h.entry(), 'new owner'); return symlink(...args); };
  report = await manager.apply({ action: 'repair', names: ['one'] });
  assert.equal(await fs.readFile(h.entry(), 'utf8'), 'new owner'); assert.match(report.results[0].message, /恢复材料/);
});

test('Git 与自定义配置目录 FNS 排除在创建隐藏目录前验证，配置原文保持', async t => {
  const h = await fixture(t);
  execFileSync('git', ['init', '-q', h.vault], { windowsHide: true });
  let scan = await h.manager.scan(); assert.equal(scan.isolation.ok, false);
  await assert.rejects(h.manager.apply({}), { code: 'ISOLATION_REQUIRED' }); assert.equal(await h.manager.stat(path.join(h.vault, '.agents')), null);
  await fs.writeFile(path.join(h.vault, '.gitignore'), '/.agents/skills/*\n/apps/workbench/data/*\n');
  assert.equal((await h.manager.scan()).isolation.ok, false);
  await fs.writeFile(path.join(h.vault, '.gitignore'), '/.agents/\n/.claude/\n/apps/workbench/data/\n');
  const fns = path.join(h.vault, 'custom/plugins/fast-note-sync'); await fs.mkdir(fns, { recursive: true });
  await fs.writeFile(path.join(fns, 'data.json'), '{}'); assert.equal((await h.manager.scan()).isolation.ok, false);
  const config = JSON.stringify({ syncExcludeFolders: JSON.stringify(['^\\.agents(?:/|$)', '^apps/workbench/data(?:/|$)']) });
  await fs.writeFile(path.join(fns, 'data.json'), config);
  assert.equal((await h.manager.scan()).isolation.ok, true);
  assert.equal((await h.manager.apply({ names: ['one'] })).ok, true);
  assert.equal(await fs.readFile(path.join(fns, 'data.json'), 'utf8'), config);
  assert.equal((await h.manager.scan('claude')).isolation.ok, false);
});
