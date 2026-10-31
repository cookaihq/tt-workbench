'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('../../workbench/package.cjs');
const packages = require('../package.cjs');
const { installSkill, recoverSkill, pendingRecovery } = require('../install.cjs');
const { SkillManager } = require('../manager.cjs');
const { fixture, skill, workbench } = require('./fixtures.cjs');
async function setup(t) {
  const h = await fixture(t); await core.installPackage(workbench(), h);
  h.manager = new SkillManager(h);
  h.read = async () => packages.inspectTree(await packages.readTree(path.join(h.packageRoot, 'skills/one')));
  return h;
}
test('独立 Skill 后升级工作台与反向顺序均保留正式归属、用户文件及两宿主入口', async t => {
  const h = await setup(t);
  assert.equal((await h.manager.apply({ agent: 'codex' })).ok, true); assert.equal((await h.manager.apply({ agent: 'claude' })).ok, true);
  await fs.writeFile(path.join(h.packageRoot, 'skills/one/personal.json'), '{"keep":true}');
  await fs.writeFile(path.join(h.packageRoot, 'data.json'), '{"settings":true}');
  await installSkill(skill('one', '1.1.0'), { ...h, workbenchVersion: '0.26.0' });
  await core.installPackage(workbench('0.27.0'), h);
  assert.equal((await h.read()).actual.version, '1.1.0');
  assert.equal(await fs.readFile(path.join(h.packageRoot, 'skills/one/personal.json'), 'utf8'), '{"keep":true}');
  assert.equal(await fs.readFile(path.join(h.packageRoot, 'data.json'), 'utf8'), '{"settings":true}');
  await installSkill(skill('one', '1.2.0'), { ...h, workbenchVersion: '0.27.0' });
  for (const agent of ['codex', 'claude']) {
    const item = (await h.manager.scan(agent)).items[0]; assert.equal(item.status, 'installed'); assert.equal(item.installedVersion, '1.2.0');
  }
  await core.installPackage(workbench('0.28.0', [skill('one', '9.0.0')]), h);
  assert.equal((await h.read()).actual.version, '1.2.0', '工作台包也不能擅自升级已采用的 Skill');
  assert.equal((await h.manager.apply({ action: 'remove', agent: 'claude', names: ['one'] })).ok, true);
  assert.equal((await h.manager.scan('codex')).items[0].installedVersion, '1.2.0');
});
test('同版本异内容、降级、兼容不足和核心待重启均保留旧版本', async t => {
  const h = await setup(t);
  await assert.rejects(installSkill(skill('one', '1.0.0', 'different'), h), { code: 'IMMUTABLE_VERSION' });
  await assert.rejects(installSkill(skill('one', '0.9.0'), h), { code: 'IMMUTABLE_VERSION' });
  await assert.rejects(installSkill(skill('one', '2.0.0', 'new', { workbench: '9.0.0' }), h), { code: 'SKILL_INCOMPATIBLE' });
  await assert.rejects(installSkill(skill('one', '1.1.0'), { ...h, workbenchVersion: '0.25.0' }), { code: 'RESTART_REQUIRED' });
  assert.equal((await h.read()).actual.version, '1.0.0');
});
test('工作台仍核验核心和独立 Skill 内容；合法更新不放宽未知文件保护', async t => {
  const h = await setup(t); const script = path.join(h.packageRoot, 'skills/one/runtime/scripts/probe.cjs');
  await fs.writeFile(script, 'local edit');
  await assert.rejects(core.installPackage(workbench('0.27.0'), h), { code: 'SKILL_CONTENT_CHANGED' });
  assert.equal(await fs.readFile(script, 'utf8'), 'local edit');
  await fs.writeFile(script, skill().files.get('runtime/scripts/probe.cjs'));
  await fs.writeFile(path.join(h.packageRoot, 'main.js'), 'core local edit');
  await assert.rejects(core.installPackage(workbench('0.27.0'), h), { code: 'LOCAL_CHANGES' });
});
test('旧无版本资源经过原清单校验进入独立模型，损坏旧入口仍保留', async t => {
  const h = await fixture(t), old = workbench('0.25.2');
  for (const file of [...old.files.keys()]) if (file.startsWith('skills/one/')) old.files.delete(file);
  old.files.set('skills/one/SKILL.md', Buffer.from('---\nname: one\ndescription: Legacy\n---\nold'));
  delete old.release.skillPackages; old.release.files = Object.fromEntries([...old.files].map(([file, bytes]) => [file, core.hash(bytes)]));
  await core.installPackage(old, h);
  const manager = new SkillManager(h); await manager.apply({});
  await core.installPackage(workbench(), h);
  assert.equal((await manager.scan()).items[0].installedVersion, '1.0.0');
  await fs.unlink(path.join(h.vault, '.agents/skills/one')); await fs.symlink(path.join(h.vault, 'missing'), path.join(h.vault, '.agents/skills/one'), 'dir');
  await installSkill(skill('one', '1.1.0'), h);
  assert.equal((await manager.scan()).items[0].status, 'conflict');
  assert.equal(await fs.readlink(path.join(h.vault, '.agents/skills/one')), path.join(h.vault, 'missing'));
});
test('替换失败自动恢复，下载期间变化与并发工作台更新不会覆盖文件', async t => {
  const h = await setup(t), io = { ...fs };
  io.rename = async (from, to) => { if (path.basename(from) === 'stage') throw Error('simulated disk error'); return fs.rename(from, to); };
  await assert.rejects(installSkill(skill('one', '1.1.0'), { ...h, io }), /simulated disk error/);
  assert.equal((await h.read()).actual.version, '1.0.0'); assert.equal(await pendingRecovery(h), null);
  await installSkill(skill('one', '1.1.0'), { ...h, beforeReplace: async () => {
    await assert.rejects(core.installPackage(workbench('0.27.0'), h), { code: 'EEXIST' });
  } });
  const resource = path.join(h.packageRoot, 'skills/one/SKILL.md');
  await assert.rejects(installSkill(skill('one', '1.2.0'), { ...h, beforeReplace: async () => fs.appendFile(resource, '\nexternal change') }), { code: 'STALE_SKILL' });
  assert.match(await fs.readFile(resource, 'utf8'), /external change/);
});
test('进程在目录切换间或新目录就位后退出，可从同一恢复记录回退或接续', async t => {
  for (const phase of ['previous', 'installed']) {
    const h = await setup(t), bundleFile = path.join(h.vault, 'candidate.gz');
    await fs.writeFile(bundleFile, packages.encodeBundle(skill('one', '1.1.0')));
    const program = `const fs=require('node:fs/promises'),path=require('node:path'),p=require(${JSON.stringify(require.resolve('../package.cjs'))}),i=require(${JSON.stringify(require.resolve('../install.cjs'))});(async()=>{const io={...fs,rename:async(a,b)=>{await fs.rename(a,b);if(${JSON.stringify(phase)}==='previous'?path.basename(b)==='previous':path.basename(a)==='stage')process.exit(73)}};await i.installSkill(p.decodeBundle(await fs.readFile(${JSON.stringify(bundleFile)})),{vault:${JSON.stringify(h.vault)},configDir:'custom',io})})().catch(e=>{console.error(e);process.exitCode=1})`;
    const result = spawnSync(process.execPath, ['-e', program], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.equal(result.status, 73, result.stderr);
    const pending = await pendingRecovery(h); assert.equal(pending.recoverable, true);
    const mode = phase === 'previous' ? 'finish' : 'rollback';
    await recoverSkill({ ...h, operation: pending.operation, mode });
    assert.equal((await h.read()).actual.version, mode === 'finish' ? '1.1.0' : '1.0.0');
    assert.equal(await pendingRecovery(h), null);
  }
});

test('宿主仍运行时可恢复已结束的失败；恢复再次中断后仍可接续', async t => {
  const h = await setup(t), io = { ...fs }, rawRename = fs.rename;
  io.rename = async (from, to) => { if (path.basename(from) === 'stage' || path.basename(from) === 'previous') throw Error('temporary disk failure'); return rawRename(from, to); };
  await assert.rejects(installSkill(skill('one', '1.1.0'), { ...h, io }), { code: 'RECOVERY_REQUIRED' });
  const pending = await pendingRecovery(h);
  assert.equal(pending.pid, process.pid); assert.equal(pending.state, 'interrupted');
  const program = `const fs=require('node:fs/promises'),path=require('node:path'),i=require(${JSON.stringify(require.resolve('../install.cjs'))});i.recoverSkill({vault:${JSON.stringify(h.vault)},configDir:'custom',operation:${JSON.stringify(pending.operation)},mode:'finish',io:{...fs,rename:async(a,b)=>{await fs.rename(a,b);if(path.basename(a)==='stage')process.exit(74)}}}).catch(e=>{console.error(e);process.exitCode=1})`;
  const child = spawnSync(process.execPath, ['-e', program], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(child.status, 74, child.stderr);
  await recoverSkill({ ...h, operation: pending.operation, mode: 'rollback' });
  assert.equal((await h.read()).actual.version, '1.0.0');
  assert.equal(await pendingRecovery(h), null);
});
