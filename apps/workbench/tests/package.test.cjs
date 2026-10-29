'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const packages = require('../../../lib/workbench/package.cjs');
const source = path.resolve(__dirname, '../../..');
const run = (script, args, input, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, input, encoding: 'utf8' });
async function fixture(t) {
  const base = path.join(source, 'tmp/package-tests'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, '独立知识库-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('完整包安装到不同名称的空库，仅写插件；已安装 CLI 无需源库及 Obsidian', async t => {
  const root = await fixture(t), configDir = 'custom-settings';
  const bundle = packages.decodeBundle(packages.encodeBundle(await packages.collectPackage(source)));
  assert.ok(![...bundle.files.keys()].some(name => name.startsWith('docs/global-agent-instructions/')));
  const result = await packages.installPackage(bundle, { vault: root, configDir });
  assert.deepEqual(await fs.readdir(root), [configDir]);
  assert.deepEqual(await fs.readdir(path.join(root, configDir)), ['plugins']);
  assert.equal((await packages.installPackage(bundle, { vault: root, configDir, check: true })).ok, true);
  const cli = path.join(result.target, 'scripts/vault/write.mjs');
  const info = run(cli, ['--vault', root], JSON.stringify({ action: 'info', list: true }), root);
  assert.equal(info.status, 0, info.stderr); assert.equal(JSON.parse(info.stdout).vault, root);
  const missing = run(cli, [], JSON.stringify({ action: 'info' }), root);
  assert.equal(missing.status, 1); assert.equal(JSON.parse(missing.stdout).code, 'VAULT_REQUIRED');
  const request = { action: 'capture', title: '独立安装验证', content: 'Synthetic test only', request_id: randomUUID(), privacy: 'ordinary' };
  const capture = run(cli, ['--vault', root], JSON.stringify(request), root);
  assert.equal(capture.status, 0, capture.stdout + capture.stderr);
  const created = JSON.parse(capture.stdout); assert.match(await fs.readFile(path.join(root, created.path), 'utf8'), /Synthetic test only/);
  const repeated = run(cli, ['--vault', root], JSON.stringify(request), root);
  assert.equal(repeated.status, 0, repeated.stdout); assert.equal(JSON.parse(repeated.stdout).path, created.path);
  await fs.writeFile(path.join(root, configDir, 'app.json'), JSON.stringify({ attachmentFolderPath: './attachments' }));
  const attached = run(cli, ['--vault', root, '--config-dir', configDir], JSON.stringify({ action: 'attach', path: created.path, expected: await fs.readFile(path.join(root, created.path), 'utf8'), filename: 'sample.txt', base64: 'c2FtcGxl', privacy: 'ordinary', request_id: randomUUID() }), root);
  assert.equal(attached.status, 0, attached.stdout + attached.stderr);
  assert.equal(await fs.readFile(path.join(root, JSON.parse(attached.stdout).attachmentPath), 'utf8'), 'sample');
  assert.ok(!(await fs.readdir(root)).includes('.agents'));
  const rules = run(path.join(result.target, 'scripts/global-agent-instructions/install.mjs'), ['--check'], undefined, root);
  assert.equal(rules.status, 1); assert.match(rules.stderr, /--source/);
});
test('帮助和只读检查不安装；Skill 注册独立执行并拒绝覆盖未知入口', async t => {
  const root = await fixture(t);
  const help = run(path.join(source, 'scripts/workbench/install.mjs'), ['--help'], undefined, root);
  assert.equal(help.status, 0); assert.deepEqual(await fs.readdir(root), []);
  const check = await packages.installPackage(await packages.collectPackage(source), { vault: root, check: true });
  assert.equal(check.ok, false); assert.deepEqual(await fs.readdir(root), []);
  const result = await packages.installPackage(await packages.collectPackage(source), { vault: root });
  const installer = path.join(result.target, 'scripts/agent-skills/install.mjs');
  const registered = run(installer, ['--vault', root, '--agent', 'codex'], undefined, root);
  assert.equal(registered.status, 0, registered.stderr);
  assert.equal(await fs.realpath(path.join(root, '.agents/skills/tt-capture')), path.join(result.target, 'skills/tt-capture'));
  assert.equal(run(installer, ['--vault', root, '--agent', 'codex', '--check'], undefined, root).status, 0);
  const entry = path.join(root, '.agents/skills/tt-capture'); await fs.unlink(entry); await fs.mkdir(entry);
  await fs.writeFile(path.join(entry, 'keep.txt'), 'mine');
  assert.equal(run(installer, ['--vault', root, '--agent', 'codex'], undefined, root).status, 1);
  assert.equal(await fs.readFile(path.join(entry, 'keep.txt'), 'utf8'), 'mine');
});
test('安装和升级保留目标库自有入口、规则与概念，软件规则只留在插件包中', async t => {
  const root = await fixture(t);
  const ownFiles = new Map([
    ['AGENTS.md', '# 目标库\n\n保存前读取 [本库规则](policy/capture.md)。\n'],
    ['CLAUDE.md', '@AGENTS.md\n'],
    ['policy/capture.md', '# 本库保存规则\n\n内容按本库选择存放。\n'],
    ['docs/rules/writing-and-changes.md', '# 本库写入规则\n\n保留独立正文。\n'],
    ['GLOSSARY.md', '# 本库概念\n'],
  ]);
  for (const [name, content] of ownFiles) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  const first = await packages.collectPackage(source);
  const initial = await packages.installPackage(first, { vault: root });
  const next = { files: new Map(first.files), release: { ...first.release, files: { ...first.release.files } } };
  const rule = 'docs/rules/content-and-sources.md';
  next.files.set(rule, Buffer.from('# 软件规则更新\n'));
  next.release.files[rule] = packages.hash(next.files.get(rule));
  await packages.installPackage(next, { vault: root });
  for (const [name, content] of ownFiles) assert.equal(await fs.readFile(path.join(root, name), 'utf8'), content, name);
  assert.equal(await fs.readFile(path.join(initial.target, rule), 'utf8'), '# 软件规则更新\n');
  assert.deepEqual((await fs.readdir(root)).sort(), ['.obsidian', 'AGENTS.md', 'CLAUDE.md', 'GLOSSARY.md', 'docs', 'policy'].sort());
  assert.deepEqual(await fs.readdir(path.join(root, 'docs/rules')), ['writing-and-changes.md']);
});
test('安装期间出现外部改动时拒绝替换，恢复并发编辑结果', async t => {
  const root = await fixture(t), first = await packages.collectPackage(source);
  const initial = await packages.installPackage(first, { vault: root });
  const next = { files: new Map(first.files), release: { ...first.release, files: { ...first.release.files } } };
  next.files.set('styles.css', Buffer.from('/* new */')); next.release.files['styles.css'] = packages.hash(next.files.get('styles.css'));
  await assert.rejects(packages.installPackage(next, { vault: root, beforeReplace: () => fs.writeFile(path.join(initial.target, 'styles.css'), '/* external */') }), { code: 'LOCAL_CHANGES' });
  assert.equal(await fs.readFile(path.join(initial.target, 'styles.css'), 'utf8'), '/* external */');
});
