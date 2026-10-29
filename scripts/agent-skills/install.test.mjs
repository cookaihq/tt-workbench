import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repository = fileURLToPath(new URL('../../', import.meta.url));
async function fixture(t) {
  const base = path.join(repository, 'tmp/skill-cli-tests'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'run-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(base)); await fs.rm(root, { recursive: true, force: true }); });
  const vault = path.join(root, 'target'), software = path.join(vault, 'custom/plugins/tt-workbench');
  await fs.mkdir(path.join(software, 'scripts/agent-skills'), { recursive: true });
  await fs.cp(path.join(repository, 'scripts/agent-skills/install.mjs'), path.join(software, 'scripts/agent-skills/install.mjs'));
  for (const dir of ['config', 'agent-skills', 'runtime']) await fs.cp(path.join(repository, 'lib', dir), path.join(software, 'lib', dir), { recursive: true });
  await fs.mkdir(path.join(software, 'lib/fns')); await fs.cp(path.join(repository, 'lib/fns/rules.cjs'), path.join(software, 'lib/fns/rules.cjs'));
  await fs.mkdir(path.join(software, 'skills/sample'), { recursive: true });
  await fs.writeFile(path.join(software, 'skills/manifest.jsonc'), '{"skills":["sample"]}');
  await fs.writeFile(path.join(software, 'skills/sample/SKILL.md'), '---\r\nname: sample\r\ndescription: Sample\r\n---\r\n');
  const run = (...args) => spawnSync(process.execPath, [path.join(software, 'scripts/agent-skills/install.mjs'), ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  return { root, vault, software, run };
}
test('安装副本 CLI 必须显式指定知识库；单项安装和检查与其他宿主隔离', async t => {
  const h = await fixture(t);
  assert.equal(h.run().status, 1); assert.equal(h.run('--help').status, 0);
  assert.deepEqual(await fs.readdir(h.vault), ['custom']);
  const other = path.join(h.vault, '.claude/skills/sample'); await fs.mkdir(path.dirname(other), { recursive: true }); await fs.writeFile(other, 'keep');
  const args = ['--vault', h.vault, '--config-dir', 'custom', '--agent', 'codex', '--skill', 'sample'];
  // Even the source CLI must point discovery at this vault's installed package.
  const installed = spawnSync(process.execPath, [path.join(repository, 'scripts/agent-skills/install.mjs'), ...args], { cwd: h.root, encoding: 'utf8', windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  assert.equal(await fs.realpath(path.join(h.vault, '.agents/skills/sample')), path.join(h.software, 'skills/sample'));
  const check = h.run(...args, '--check'); assert.equal(check.status, 0, check.stdout); assert.equal(JSON.parse(check.stdout).mode, 'check');
  assert.equal(await fs.readFile(other, 'utf8'), 'keep');
  const remove = h.run(...args, '--action', 'remove'); assert.equal(remove.status, 0, remove.stdout);
  assert.equal(h.run(...args, '--check').status, 1);
});
test('CLI 修复需要显式选择和旧源证明，两个宿主逐项结果真实', async t => {
  const h = await fixture(t), entry = path.join(h.vault, '.agents/skills/sample'), old = path.join(h.root, 'old-skills');
  await fs.mkdir(path.dirname(entry), { recursive: true }); await fs.symlink(path.join(old, 'sample'), entry, 'dir');
  const args = ['--vault', h.vault, '--config-dir', 'custom', '--agent', 'codex'];
  assert.equal(h.run(...args, '--action', 'repair').status, 1);
  assert.equal(h.run(...args, '--skill', '../escape').status, 1);
  const conflict = h.run('--vault', h.vault, '--config-dir', 'custom', '--agent', 'all');
  assert.equal(conflict.status, 1); assert.equal(JSON.parse(conflict.stdout).reports[1].ok, true);
  const repaired = h.run(...args, '--action', 'repair', '--skill', 'sample', '--migrate-from', old);
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  assert.equal(await fs.realpath(entry), path.join(h.software, 'skills/sample'));
});
