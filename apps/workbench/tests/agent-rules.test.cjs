const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AgentRulesReader, skillPrompt } = require('../agent-rules.js');

async function fixture() {
  // Runtime fixtures use ordinary names in the existing excluded data area.
  const base = path.resolve(__dirname, '../../../tmp/agent-rules-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'run-'));
  const home = path.join(root, 'user'), directory = path.join(home, 'codex');
  const source = path.join(root, 'docs/global-agent-instructions');
  const scenes = path.join(source, 'scenarios-agent-instructions');
  await fs.mkdir(scenes, { recursive: true }); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(source, 'AGENTS.md'), '# 主规则\n\n保持原义。\n');
  await fs.writeFile(path.join(scenes, 'one.md'), '# 场景一\n\n条件与动作。\n');
  // Map only the shared entry's parent name; all status checks still use the
  // real OS filesystem and real symlinks. No hidden discovery directories created.
  const map = p => p === path.join(home, '.agents/scenarios-agent-instructions') ? path.join(home, 'scenarios') : p;
  const io = { ...fs };
  for (const key of ['lstat', 'stat', 'realpath', 'readlink', 'open']) io[key] = (p, ...args) => fs[key](map(p), ...args);
  const reader = new AgentRulesReader(root, { home, env: { CODEX_HOME: directory }, io, sourceDirectory: source });
  return { root, home, source, scenes, directory, reader, io,
    main: path.join(directory, 'AGENTS.md'), scenarioEntry: path.join(home, 'scenarios') };
}

async function connect(h) {
  await fs.symlink(path.join(h.source, 'AGENTS.md'), h.main, 'file');
  await fs.symlink(h.scenes, h.scenarioEntry, 'dir');
}

test('未明确选择源时不回落到知识库或软件目录；支持独立规则目录和旧显式根设置', async () => {
  const h = await fixture();
  const unselected = new AgentRulesReader(h.root, { home: h.home, env: {} });
  const empty = await unselected.scan(); assert.equal(empty.status, 'unconfigured'); assert.deepEqual(empty.documents, []); assert.deepEqual(empty.entries, []);
  assert.match(skillPrompt(empty), /先.*选择/);
  const legacy = new AgentRulesReader(h.root, { sourceRoot: h.root, home: h.home, env: {} });
  assert.equal((await legacy.scan()).source, h.source);
  const unrelated = new AgentRulesReader(h.root, { sourceDirectory: path.join(h.root, 'missing'), home: h.home, env: {} });
  assert.equal((await unrelated.scan()).status, 'unknown'); assert.deepEqual((await unrelated.scan()).documents, []);
  assert.throws(() => new AgentRulesReader(h.root, { sourceDirectory: 'relative' }), /绝对路径/);
});

test('普通文件即使内容相同也未接入；读取与提示词不写入原文件', async () => {
  const h = await fixture(), original = await fs.readFile(path.join(h.source, 'AGENTS.md'), 'utf8');
  await fs.writeFile(h.main, original);
  const s = await h.reader.scan();
  assert.equal(s.status, 'attention'); assert.deepEqual(s.entries.map(i => i.status), ['file', 'missing']);
  assert.equal(s.documents.find(d => d.id === 'local-main').content, original);
  assert.equal(s.skill.available, false); assert.match(skillPrompt(s), /\$tt-organize-agent-rules/);
  assert.match(skillPrompt(s), /普通文件/); assert.match(skillPrompt(s), /确认后/);
  assert.match(skillPrompt(s), /当前任务：整理并接入主规则/);
  assert.match(skillPrompt(s), /主规则与场景规则的拆分及接入方案/);
  assert.equal(await fs.readFile(h.main, 'utf8'), original); assert.equal((await fs.lstat(h.main)).isSymbolicLink(), false);
});

test('真实直接符号链接与覆盖文件分别核对，刷新读取新状态', async () => {
  const h = await fixture();
  await fs.symlink(path.join(h.source, 'AGENTS.md'), h.main, 'file');
  const partial = await h.reader.scan(), prompt = skillPrompt(partial);
  assert.equal(partial.status, 'attention'); assert.deepEqual(partial.entries.map(i => i.status), ['linked', 'missing']);
  assert.match(prompt, /当前任务：补齐场景规则入口/); assert.match(prompt, /保留其正文与链接/);
  assert.match(prompt, /与我确认后再执行/); assert.doesNotMatch(prompt, /拆分/);
  assert.ok(prompt.includes(h.scenes)); assert.ok(prompt.includes(partial.entries[1].entry));
  await fs.symlink(h.scenes, h.scenarioEntry, 'dir');
  const first = await h.reader.scan();
  assert.equal(first.status, 'connected'); assert.deepEqual(first.entries.map(i => i.status), ['linked', 'linked']);
  assert.equal(first.documents.length, 2);
  const override = path.join(h.directory, 'AGENTS.override.md');
  await fs.writeFile(override, '# 覆盖规则');
  const second = await h.reader.scan();
  assert.equal(second.status, 'attention'); assert.equal(second.override.status, 'present');
  assert.equal(second.documents.find(d => d.id === 'local-override').content, '# 覆盖规则');
  assert.match(skillPrompt(second), /当前任务：核查覆盖文件或读取问题/);
  assert.doesNotMatch(skillPrompt(second), /拆分/);
  await fs.writeFile(override, ' \n'); assert.equal((await h.reader.scan()).status, 'connected');
});

test('其他目标、中间链接、断链、普通目录与缺失不可混为已接入', async () => {
  const h = await fixture(), target = path.join(h.source, 'AGENTS.md');
  const wrong = path.join(h.root, 'other.md'); await fs.writeFile(wrong, '# 其他');
  const other = path.join(h.root, 'other-entry.md'); await fs.symlink(wrong, other, 'file');
  assert.equal((await h.reader.inspect(other, target, 'file')).status, 'other');
  const middle = path.join(h.root, 'middle.md'); await fs.symlink(target, middle, 'file');
  const chain = path.join(h.root, 'chain.md'); await fs.symlink(middle, chain, 'file');
  assert.equal((await h.reader.inspect(chain, target, 'file')).status, 'indirect');
  const broken = path.join(h.root, 'broken.md'); await fs.symlink(path.join(h.root, 'absent.md'), broken, 'file');
  assert.equal((await h.reader.inspect(broken, target, 'file')).status, 'broken');
  assert.equal((await h.reader.inspect(h.directory, target, 'file')).status, 'directory');
  assert.equal((await h.reader.inspect(h.main, target, 'file')).status, 'missing');
});

test('权限错误和坏的覆盖链接显示未知，仍保留其他项检查结果', async () => {
  const h = await fixture(); await connect(h);
  const original = h.io.lstat;
  h.io.lstat = async p => { if (p === h.main) throw Object.assign(Error('permission denied'), { code: 'EACCES' }); return original(p); };
  let s = await h.reader.scan();
  assert.equal(s.status, 'unknown'); assert.equal(s.entries[0].status, 'unknown'); assert.equal(s.entries[1].status, 'linked');
  assert.match(skillPrompt(s), /当前任务：核实入口状态/);
  h.io.lstat = original;
  await fs.symlink(path.join(h.root, 'gone.md'), path.join(h.directory, 'AGENTS.override.md'), 'file');
  s = await h.reader.scan(); assert.equal(s.status, 'unknown'); assert.equal(s.override.status, 'unknown');
});

test('场景内部链接不递归读取库外文本；正文大小有界', async () => {
  const h = await fixture();
  const outside = path.join(h.root, 'outside.md'); await fs.writeFile(outside, '不得从场景链接读取');
  await fs.symlink(outside, path.join(h.scenes, 'escape.md'), 'file');
  await fs.writeFile(path.join(h.scenes, 'large.md'), 'a'.repeat(1024 * 1024 + 1));
  const s = await h.reader.scan();
  assert.equal(s.status, 'unknown'); assert.equal(s.documents.length, 2);
  assert.ok(s.errors.some(e => e.includes('符号链接未读取'))); assert.ok(s.errors.some(e => e.includes('超过 1 MiB')));
});

test('自定义配置目录使用真实位置；相对目录不猜测；Claude 不检查 Codex 覆盖文件', async () => {
  const h = await fixture(); await fs.writeFile(h.main, '# 自定义位置');
  assert.equal((await h.reader.scan()).entries[0].entry, h.main);
  h.reader.env = { CODEX_HOME: 'relative-home' };
  const s = await h.reader.scan(); assert.equal(s.status, 'unknown'); assert.match(s.reason, /相对路径/);
  assert.match(skillPrompt(s), /当前任务：核实入口状态/);
  h.reader.env = { CLAUDE_CONFIG_DIR: h.directory };
  await fs.writeFile(path.join(h.directory, 'CLAUDE.md'), '# Claude');
  const c = await h.reader.scan('claude'); assert.equal(c.override.status, 'na');
  assert.equal(c.documents.find(d => d.id === 'local-main').content, '# Claude');
  await assert.rejects(h.reader.scan('unknown'), /不支持的 Agent/);
});
