const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { IssueStore } = require('../issues.js');

async function fixture() {
  const base = path.resolve(__dirname, '../../../tmp/workbench-issues/module-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'run-'));
  const write = async (relative, content) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), content);
  };
  return { root, write, store: new IssueStore(root) };
}

test('发现本地 Issue 与仅有规格的功能，未登记关闭状态时不猜测完成', async () => {
  const h = await fixture();
  const original = 'Status: ready-for-agent\r\n\r\n# 已完成的旧记录\r\n\r\n- [x] 验收通过\r\n\r\n## Comments\r\n\r\n- 没有作者与时间的旧评论。\r\n';
  await h.write('.scratch/alpha/issues/01-first.md', original);
  await h.write('.scratch/plan/spec.md', '# 只有规格的功能\n');
  await h.write('.scratch/alpha/issues/01-first-保存冲突-abc.md', '# 冲突副本\n');
  const catalog = await h.store.list();
  assert.equal(catalog.issues.length, 1);
  assert.equal(catalog.issues[0].state, 'unknown');
  assert.equal(catalog.issues[0].triage, 'ready-for-agent');
  assert.deepEqual(catalog.issues[0].checks.map(c => c.done), [true]);
  assert.equal(catalog.groups.find(g => g.feature === 'plan').title, '只有规格的功能');
  const note = await h.store.read('.scratch/alpha/issues/01-first.md');
  assert.equal(note.content, original);
  assert.match(note.legacyComments, /没有作者与时间/);
  await assert.rejects(h.store.read('01.收件箱/笔记.md'), { code: 'OUT_OF_SCOPE' });
});

test('从新功能创建 Issue，重试不重复创建，并发创建分配不同编号', async () => {
  const h = await fixture();
  const input = { feature: '新功能', title: '修复中文输入', description: '## 验收条件\n\n- [ ] 中文完整保存\n', labels: ['缺陷'], priority: 'high', id: '61552a1c-4040-4b3d-80d9-7807ad8010b1' };
  const first = await h.store.create(input);
  const again = await new IssueStore(h.root).create(input);
  assert.equal(again.path, first.path);
  assert.equal((await h.store.read(first.path)).state, 'open');
  const values = await Promise.all([h.store.create({ ...input, title: '第二项', id: undefined }), new IssueStore(h.root).create({ ...input, title: '第三项', id: undefined })]);
  assert.deepEqual(values.map(v => v.number).sort(), [2, 3]);
  assert.equal((await h.store.list()).issues.length, 3);
  await assert.rejects(h.store.create({ ...input, feature: '../other' }), { code: 'INVALID_INPUT' });
  await fs.mkdir(path.join(h.root, '.scratch/linked'));
  await fs.symlink(path.join(h.root, '.scratch/新功能/issues'), path.join(h.root, '.scratch/linked/issues'));
  await assert.rejects(h.store.create({ ...input, feature: 'linked', id: undefined }), { code: 'INVALID_PATH' });
});

test('编辑、验收、关闭和重开写回原文件，保留未知属性及旧讨论；陈旧提交不覆盖', async () => {
  const h = await fixture(), p = '.scratch/alpha/issues/01-first.md';
  await h.write(p, 'Status: ready-for-agent\r\nCustom: keep\r\n\r\n# 原标题\r\n\r\n- [ ] 真实验收\r\n\r\n## Comments\r\n\r\n- 原始讨论不得丢失。\r\n');
  let note = await h.store.read(p);
  note = await h.store.update(p, note.content, { action: 'edit', title: '新标题', description: note.description });
  assert.equal(note.title, '新标题');
  assert.equal(note.path, p);
  note = await h.store.update(p, note.content, { action: 'check', index: 0, done: true });
  assert.equal(note.checks[0].done, true);
  assert.equal(note.state, 'unknown');
  const old = note.content;
  note = await h.store.update(p, note.content, { action: 'close', resolution: 'completed', conclusion: '已从真实入口核对。' });
  assert.equal(note.state, 'completed');
  assert.equal(note.triage, 'ready-for-agent');
  await assert.rejects(h.store.update(p, old, { action: 'edit', title: '陈旧标题', description: '不得覆盖' }), e => e.code === 'CONFLICT' && Boolean(e.recoveryPath));
  assert.equal((await h.store.read(p)).content, note.content);
  note = await h.store.update(p, note.content, { action: 'reopen', conclusion: '发现回归' });
  assert.equal(note.state, 'open');
  assert.match(note.content, /Custom: keep\r\n/);
  assert.match(note.legacyComments, /原始讨论不得丢失/);
  assert.match(note.activity, /发现回归/);
  assert.equal(note.created, '');
});

test('分诊、标签和关系可更新；循环依赖被拒绝，取消前置事项不会解除阻塞', async () => {
  const h = await fixture();
  let a = await h.store.create({ feature: 'flow', title: '前置工作', description: '完成前置条件。' });
  let b = await h.store.create({ feature: 'flow', title: '后续工作', description: '依赖前置。' });
  b = await h.store.update(b.path, b.content, { action: 'metadata', triage: 'ready-for-human', labels: ['功能'], priority: 'medium', blockedBy: [a.ref], related: [a.path] });
  assert.equal(b.triage, 'ready-for-human'); assert.deepEqual(b.related, [a.path]);
  await assert.rejects(h.store.update(a.path, a.content, { action: 'metadata', blockedBy: [b.ref] }), { code: 'DEPENDENCY_CYCLE' });
  await assert.rejects(h.store.update(a.path, a.content, { action: 'metadata', related: ['../private.md'] }), { code: 'OUT_OF_SCOPE' });
  a = await h.store.update(a.path, a.content, { action: 'close', resolution: 'not-planned' });
  assert.deepEqual((await h.store.list()).issues.find(i => i.ref === b.ref).blocked, [a.ref]);
  a = await h.store.update(a.path, a.content, { action: 'reopen' });
  a = await h.store.update(a.path, a.content, { action: 'close', resolution: 'completed' });
  assert.deepEqual((await h.store.list()).issues.find(i => i.ref === b.ref).blocked, []);
  b = await h.store.update(b.path, b.content, { action: 'close', resolution: 'not-planned', duplicateOf: a.ref });
  assert.equal(b.duplicateOf, a.ref);
  b = await h.store.update(b.path, b.content, { action: 'reopen' });
  assert.equal(b.duplicateOf, '');
});

test('新增评论可编辑并记录原作者，旧评论保留，示例代码中的清单不被计数', async () => {
  const h = await fixture(), p = '.scratch/notes/issues/01-comment.md';
  await h.write(p, 'Status: needs-info\n\n# 评论\n\n```md\n- [ ] 只是示例\n```\n\n## Comments\n\n- 旧评论\n');
  let note = await h.store.read(p);
  note = await h.store.update(p, note.content, { action: 'comment', body: '补充中文证据。\n\n```js\nconst x = 1;\n```', actor: 'Agent' });
  assert.equal(note.comments.length, 1); assert.equal(note.checks.length, 0);
  const comment = note.comments[0];
  note = await h.store.update(p, note.content, { action: 'edit-comment', id: comment.id, body: '核对后的证据。' });
  assert.equal(note.comments[0].author, 'Agent'); assert.equal(note.comments[0].created, comment.created);
  assert.ok(note.comments[0].updated); assert.equal(note.comments[0].body, '核对后的证据。');
  assert.match(note.legacyComments, /旧评论/);
  await assert.rejects(h.store.update(p, note.content, { action: 'comment', body: '<!-- /tannt-comment -->' }), { code: 'INVALID_INPUT' });
  await h.write('.scratch/decisions/issues/01-answer.md', 'Type: research\nStatus: claimed\n\n# 决策任务\n\n## Answer\n');
  const decision = await h.store.read('.scratch/decisions/issues/01-answer.md');
  assert.equal(decision.wayfinding, true);
  await assert.rejects(h.store.update(decision.path, decision.content, { action: 'close', resolution: 'completed' }), { code: 'WAYFINDING' });
});

test('外部文件的无时区时间、重复状态和矛盾的重复标记明确报错，不据此改写文件', async () => {
  const h = await fixture(), p = '.scratch/errors/issues/01-invalid.md';
  const content = 'Status: needs-triage\nState: open\nState: completed\nCreated: 2026-10-21 09:00:00\nDuplicate of: errors#02\n\n# 无效记录\n';
  await h.write(p, content);
  const note = await h.store.read(p);
  assert.equal(note.created, '');
  assert.ok(note.errors.some(e => e.includes('时间')));
  assert.ok(note.errors.some(e => e.includes('重复')));
  await assert.rejects(h.store.update(p, content, { action: 'reopen' }), { code: 'INVALID_FORMAT' });
  assert.equal((await h.store.read(p)).content, content);
});
