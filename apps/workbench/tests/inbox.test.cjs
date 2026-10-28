const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const nodePath = require('node:path');
const { InboxStore, creationInstant, inboxMetadata } = require('../inbox.js');

const id1 = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
const fixtureRoot = nodePath.resolve('/fixture/tannt');
const failure = code => Object.assign(new Error(code), { code });

// In-memory OS boundary; real Obsidian tests separately exercise real files and
// the native YAML parser. Only JSON-compatible YAML emitted by this writer is
// parsed here; this is not a replacement YAML parser for the application.
function frontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  return match ? { exists: true, frontmatter: match[1], contentStart: match[0].length } : { exists: false, contentStart: 0 };
}
function parseYaml(source) {
  return Object.fromEntries(source.split('\n').filter(Boolean).map(line => {
    const index = line.indexOf(':');
    return [line.slice(0, index), JSON.parse(line.slice(index + 1).trim())];
  }));
}
function harness() {
  const entries = new Map([[fixtureRoot, { kind: 'dir' }]]);
  const get = name => { if (!entries.has(name)) throw failure('ENOENT'); return entries.get(name); };
  const io = {
    lstat: async name => { const entry = get(name); return { isDirectory: () => entry.kind === 'dir', isFile: () => entry.kind === 'file', isSymbolicLink: () => entry.kind === 'link' }; },
    mkdir: async name => { if (entries.has(name)) throw failure('EEXIST'); if (get(nodePath.dirname(name)).kind !== 'dir') throw failure('ENOTDIR'); entries.set(name, { kind: 'dir' }); },
    readdir: async name => [...entries.keys()].filter(key => nodePath.dirname(key) === name && key !== name).map(key => nodePath.basename(key)),
    readFile: async (name, encoding) => encoding ? get(name).content : Buffer.from(get(name).content),
    open: async (name, flags) => {
      assert.equal(flags, 'wx');
      if (entries.has(name)) throw failure('EEXIST');
      const entry = { kind: 'file', content: '' };
      entries.set(name, entry);
      return { writeFile: async content => { entry.content = content; }, sync: async () => {}, close: async () => {} };
    }
  };
  const reader = { assertVault: () => {}, vault: { adapter: { getBasePath: () => fixtureRoot } } };
  const store = new InboxStore(reader, { io, withLock: action => action(), parseYaml, getFrontMatterInfo: frontmatter, newId: () => id1, now: () => new Date('2026-10-16T20:00:00Z') });
  const records = () => [...entries.entries()].filter(([name, entry]) => entry.kind === 'file' && nodePath.basename(name) === '记录.md');
  return { entries, io, reader, store, records };
}

test('保存完整原始输入、实际来源与创建属性，文件可独立读取', async () => {
  const { store, entries } = harness();
  const content = '  第一行保留空格\n\nhttps://example.com/a\n第二个来源 https://example.org/b\n';
  const attempt = store.prepare({ content, sources: 'https://example.com/a\nhttps://example.org/b' });
  const saved = await store.save(attempt);
  const raw = entries.get(nodePath.join(fixtureRoot, saved.path)).content;
  assert.equal(raw.slice(raw.indexOf('\n---\n\n') + 6), content);
  const fields = parseYaml(frontmatter(raw).frontmatter);
  assert.equal(fields.type, 'inbox');
  assert.equal(fields.inbox_status, 'pending');
  assert.deepEqual(fields.source_urls, ['https://example.com/a', 'https://example.org/b']);
  assert.equal(fields.title, '第一行保留空格');
  assert.equal(creationInstant(fields.created, fields.created_timezone), Date.parse('2026-10-16T20:00:00Z'));
  assert.deepEqual(Object.keys(fields).sort(), ['capture_entry','created','created_timezone','id','inbox_status','request_hash','source_urls','title','type']);
  assert.match(saved.path, /^0\.收件箱\/2026-10\/第一行保留空格\/记录\.md$/);
});

test('只提交 URL 可以保存，不自动下载、补作者或合并同一个链接', async () => {
  const { store, records } = harness();
  const first = await store.save(store.prepare({ content: 'https://example.com/a' }));
  store.newId = () => id2;
  const second = await store.save(store.prepare({ content: 'https://example.com/a' }));
  assert.notEqual(first.path, second.path);
  assert.equal(records().length, 2);
  assert.ok(records().every(([, entry]) => entry.content.endsWith('https://example.com/a')));
});

test('空白内容或无效来源在创建任何目录之前被拒绝', () => {
  const { store, entries } = harness();
  assert.throws(() => store.prepare({ content: ' \n\t' }), { code: 'EMPTY_INPUT' });
  assert.throws(() => store.prepare({ content: '想法', sources: 'javascript:alert(1)' }), { code: 'INVALID_SOURCE' });
  assert.equal(entries.size, 1);
});

test('标题中的路径字符不能改变保存范围，原标题保留在 YAML', async () => {
  const { store } = harness();
  const attempt = store.prepare({ title: '../很长/标题: "值"\n下一行', content: '原文' });
  assert.equal(attempt.path.split('/').length, 4);
  assert.equal(parseYaml(frontmatter(attempt.document).frontmatter).title, '../很长/标题: "值"\n下一行');
  await store.save(attempt);
});

test('同标识且不同标题的并行提交只写入一份，冲突指出已有位置', async () => {
  const { store, records } = harness();
  const first = store.prepare({ title: '第一条', content: '保留原文' });
  const second = store.prepare({ title: '第二条', content: '不能覆盖' });
  const results = await Promise.allSettled([store.save(first), store.save(second)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].reason.code, 'ID_CONFLICT');
  assert.ok(results[1].reason.message.includes(first.directory));
  assert.equal(records().length, 1);
  assert.ok(records()[0][1].content.endsWith('保留原文'));
});

test('重命名后的既有笔记也通过 YAML 标识发现冲突', async () => {
  const { store, entries } = harness();
  entries.set(nodePath.join(fixtureRoot, '0.收件箱'), { kind: 'dir' });
  const existing = nodePath.join(fixtureRoot, '0.收件箱/自己改的名字.md');
  entries.set(existing, { kind: 'file', content: `---\nid: "${id1}"\n---\n原文` });
  await assert.rejects(store.save(store.prepare({ content: '新输入' })), error => error.code === 'ID_CONFLICT' && error.message.includes('自己改的名字.md'));
  assert.ok(entries.get(existing).content.endsWith('原文'));
});

test('文件在实际创建前被其他写入方占用时不覆盖', async () => {
  const { store, io, entries } = harness();
  const open = io.open;
  io.open = async (name, flags) => { if (nodePath.basename(name) === '记录.md') entries.set(name, { kind: 'file', content: '其他写入方' }); return open(name, flags); };
  const attempt = store.prepare({ content: '本次输入' });
  await assert.rejects(store.save(attempt), { code: 'PATH_CONFLICT' });
  assert.equal(entries.get(nodePath.join(fixtureRoot, attempt.path)).content, '其他写入方');
});

test('不可写目标给出明确错误，恢复权限后仍使用同一保存请求', async () => {
  const { store, io, records } = harness();
  const mkdir = io.mkdir;
  io.mkdir = async () => { throw failure('EACCES'); };
  const attempt = store.prepare({ content: '待保存原文' });
  await assert.rejects(store.save(attempt), { code: 'PERMISSION' });
  assert.equal(records().length, 0);
  io.mkdir = mkdir;
  assert.equal((await store.save(attempt)).path, attempt.path);
});

test('中途写入失败不误报成功，重试不覆盖已留下的部分内容', async () => {
  const { store, io, entries } = harness();
  const open = io.open;
  io.open = async (...args) => { const file = await open(...args); if (nodePath.basename(args[0]) === '记录.md') file.writeFile = async () => { entries.get(args[0]).content = '部分内容'; throw failure('ENOSPC'); }; return file; };
  const attempt = store.prepare({ content: '完整输入' });
  await assert.rejects(store.save(attempt), { code: 'NO_SPACE' });
  await assert.rejects(store.save(attempt), { code: 'PARTIAL_WRITE' });
  assert.equal(entries.get(nodePath.join(fixtureRoot, attempt.path)).content, '部分内容');
  assert.ok(attempt.document.endsWith('完整输入'));
});

test('文件已完整写入但确认失败，重试核对原文件而不新增重复记录', async () => {
  const { store, io, records } = harness();
  const open = io.open;
  io.open = async (...args) => { const file = await open(...args); if (nodePath.basename(args[0]) === '记录.md') file.sync = async () => { throw failure('EIO'); }; return file; };
  const attempt = store.prepare({ content: '可恢复的保存' });
  await assert.rejects(store.save(attempt), { code: 'WRITE_FAILED' });
  assert.equal((await store.save(attempt)).path, attempt.path);
  assert.equal(records().length, 1);
});

test('收件箱符号链接在写入前被拒绝，不能跟随到其他位置', async () => {
  const { store, entries } = harness();
  entries.set(nodePath.join(fixtureRoot, '0.收件箱'), { kind: 'link' });
  await assert.rejects(store.save(store.prepare({ content: '不能越界' })), { code: 'INVALID_DIRECTORY' });
  assert.equal(entries.size, 2);
});

test('错误库和非本实例生成的请求不能写入', async () => {
  const { store, reader, entries } = harness();
  await assert.rejects(store.save({ path: '../别处.md' }), { code: 'INVALID_ATTEMPT' });
  reader.assertVault = () => { throw Object.assign(new Error('wrong vault'), { code: 'WRONG_VAULT' }); };
  assert.throws(() => store.prepare({ content: '不能写' }), { code: 'WRONG_VAULT' });
  assert.equal(entries.size, 1);
});

test('两个创建时区表达同一时刻，夏令时按创建当天记录偏移', () => {
  const modulePath = require.resolve('../inbox.js');
  const run = (zone, iso) => JSON.parse(execFileSync(process.execPath, ['-e', `const m=require(${JSON.stringify(modulePath)});process.stdout.write(JSON.stringify(m.localCreation(new Date(${JSON.stringify(iso)}))))`], { env: { ...process.env, TZ: zone }, encoding: 'utf8' }));
  const la = run('America/Los_Angeles', '2026-10-17T01:30:00Z');
  const sh = run('Asia/Shanghai', '2026-10-17T01:30:00Z');
  assert.deepEqual(la, { created: '2026-10-16 18:30:00', created_timezone: '-07:00' });
  assert.deepEqual(sh, { created: '2026-10-17 09:30:00', created_timezone: '+08:00' });
  assert.equal(creationInstant(la.created, la.created_timezone), creationInstant(sh.created, sh.created_timezone));
  assert.equal(run('America/Los_Angeles', '2026-12-17T01:30:00Z').created_timezone, '-08:00');
});

test('缺失时区、非法日期和偏移不猜测成有效创建时间', () => {
  for (const [created, zone] of [['2026-02-30 12:00:00', '+08:00'], ['2026-10-16 24:00:00', '+08:00'], ['2026-10-16 12:00:00', undefined], ['2026-10-16 12:00:00', '+08:99']]) {
    assert.equal(creationInstant(created, zone), null);
  }
  const metadata = inboxMetadata({ type: 'inbox', created: '2026-10-16 12:00:00' });
  assert.equal(metadata.timestamp, null);
  assert.match(metadata.displayTime, /缺失/);
  assert.match(metadata.status, /缺失/);
});
