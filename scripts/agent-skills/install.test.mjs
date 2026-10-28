import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = fileURLToPath(new URL('../../', import.meta.url));

test('所选宿主可安装和复查 CRLF Skill，另一宿主的冲突保持原样', async () => {
  const base = path.join(repository, 'apps/workbench/data/agent-skills-tests');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-'));
  await mkdir(path.join(root, 'scripts/agent-skills'), { recursive: true });
  await cp(path.join(repository, 'scripts/agent-skills/install.mjs'), path.join(root, 'scripts/agent-skills/install.mjs'));
  await cp(path.join(repository, 'lib/config'), path.join(root, 'lib/config'), { recursive: true });
  const source = path.join(root, 'skills/sample');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(root, 'skills/manifest.jsonc'), '{"skills":["sample"],"retired":[]}\n');
  await writeFile(path.join(source, 'SKILL.md'), '---\r\nname: sample\r\ndescription: A sample skill.\r\n---\r\n\r\nRead the sample.\r\n');
  const other = path.join(root, '.claude/skills/sample');
  await mkdir(path.dirname(other), { recursive: true });
  await writeFile(other, 'Keep the unselected host unchanged.');
  const run = (...args) => spawnSync(process.execPath, ['scripts/agent-skills/install.mjs', '--agent', 'codex', ...args], { cwd: root, encoding: 'utf8' });

  const installed = run();
  assert.equal(installed.status, 0, installed.stderr);
  const entry = path.join(root, '.agents/skills/sample');
  assert.equal((await lstat(entry)).isSymbolicLink(), true);
  assert.equal(await realpath(entry), await realpath(source));
  assert.equal(await readFile(other, 'utf8'), 'Keep the unselected host unchanged.');

  const checked = run('--check');
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).mode, 'check');
});
