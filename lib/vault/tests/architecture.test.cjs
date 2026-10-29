const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const m = require('..');
const repo = path.resolve(__dirname, '../../..');
const request = (action, values = {}) => ({ action, request_id: randomUUID(), privacy: 'ordinary', ...values });
async function fixture(t) {
  const parent = path.join(repo, 'tmp/architecture-tests');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = new m.VaultFiles(root), run = input => m.execute(root, input);
  const project = await run(request('create-project', { name: '长期研究', goal: '持续整理与验证方法', directions: ['学习', '创作'] }));
  const task = await run(request('create-task', { name: '验证方案', goal: '取得验收证据', projectPath: project.path }));
  return { root, files, run, project: project.path, task: task.path };
}

test('集中项目无需领域，任务必须归属在办项目；旧身份仍可读取而新建不写旧根', async t => {
  const h = await fixture(t);
  assert.equal(h.project, '1.项目/长期研究/项目说明.md');
  assert.deepEqual(m.documentParts(await h.files.read(h.project)).fields.directions, ['学习', '创作']);
  assert.equal(m.workMetadata(h.task, m.documentParts(await h.files.read(h.task)).fields).projectPath, h.project);
  await assert.rejects(h.run(request('create-task', { name: '无归属', goal: '结果' })), { code: 'PROJECT_REQUIRED' });
  const legacy = '05.领域/研究/项目/旧项目/项目说明.md';
  await h.files.exclusiveFile(legacy, m.newDocument({ type: 'project', status: 'paused', test_fixture: true }, '旧项目'));
  const oldTask = '02.独立任务/旧任务/任务说明.md';
  await h.files.exclusiveFile(oldTask, m.newDocument({ type: 'task', status: 'not_started', progress: '', next_step: '' }, '旧任务'));
  assert.equal(m.workMetadata(legacy, m.documentParts(await h.files.read(legacy)).fields).legacy, true);
  assert.equal(m.workMetadata(legacy, m.documentParts(await h.files.read(legacy)).fields).test_fixture, true);
  assert.equal(m.workMetadata(oldTask, m.documentParts(await h.files.read(oldTask)).fields).type, 'task');
  const listed = (await h.run({ action: 'info', list: true })).notes.map(note => note.path);
  assert.ok(listed.includes(legacy) && listed.includes(oldTask) && listed.includes(h.project));
  await assert.rejects(h.run(request('create-task', { name: '新增', goal: '结果', projectPath: legacy })), { code: 'LEGACY_WRITE' });
  await assert.rejects(h.run(request('create-note', { path: '03.知识/新笔记.md', content: '内容' })), { code: 'LEGACY_WRITE' });
  await assert.rejects(h.run(request('attach', { path: h.project, expected: await h.files.read(h.project), directory: '04.资料/附件', filename: '原文.txt', base64: 'YQ==' })), { code: 'LEGACY_WRITE' });
  const legacyInbox = '01.收件箱/输入.md', raw = m.newDocument({ type: 'inbox', inbox_status: 'pending' }, '历史输入');
  await h.files.exclusiveFile(legacyInbox, raw);
  assert.equal(m.inboxCatalog([{ path: legacyInbox }], () => m.documentParts(raw).fields, '')[0].kind, 'record');
  await h.run(request('review', { path: legacyInbox, expected: raw, status: 'reviewed' }));
});

test('完成不自动移动；显式归档与恢复保持身份、状态、原附件并修正双向链接', async t => {
  const h = await fixture(t), asset = '1.项目/长期研究/任务/验证方案/attachments/原始 #[记录].md';
  const resource = '3.资源/知识/共用.md', ref = '2.领域/研究/索引.md';
  await h.files.exclusiveFile(resource, '共用知识');
  const rawAsset = '---\r\ntype: [\r\n---\r\n原始材料，保持原字节\r\n[[' + h.project + ']]\r\n';
  await h.files.exclusiveFile(asset, rawAsset);
  let project = await h.files.read(h.project), task = await h.files.read(h.task);
  await h.files.update(h.project, project, { fields: { status: 'completed' }, append: `[任务](任务/验证方案/任务说明.md)\n[[${resource}]]\n\`${h.task}\`` });
  await h.files.update(h.task, task, { fields: { attachments: [asset], status: 'in_progress' }, append: m.linkTo(asset, h.task) + '\n' + m.linkTo(resource, h.task) });
  project = await h.files.read(h.project); task = await h.files.read(h.task);
  const projectFields = m.documentParts(project).fields, taskFields = m.documentParts(task).fields;
  await h.files.exclusiveFile(ref, m.newDocument({ related_work: [`[[${h.task}]]`], output_uses: [{ id: 'use-1', artifact: h.task, version: `[[${h.task}|实际版本]]`, status: 'used' }] }, `[[${h.project}|项目]]\n\`[[${h.project}]]\`\n${m.linkTo(asset, ref)}`));
  await h.files.ensureDirectories('1.项目/长期研究/tmp/保留空目录');
  assert.ok(await h.files.read(h.project));
  const archiveInput = request('archive-project', { path: h.project, expected: project });
  const archived = await h.run(archiveInput), archivedTask = '4.存档/项目/长期研究/任务/验证方案/任务说明.md';
  assert.equal(archived.path, '4.存档/项目/长期研究/项目说明.md');
  assert.equal((await h.run(archiveInput)).reused, true);
  await assert.rejects(h.files.read(h.project), { code: 'ENOENT' });
  assert.deepEqual(m.documentParts(await h.files.read(archived.path)).fields, projectFields);
  assert.equal(m.documentParts(await h.files.read(archivedTask)).fields.id, taskFields.id);
  assert.equal(m.documentParts(await h.files.read(archivedTask)).fields.status, 'in_progress');
  assert.equal(m.workMetadata(archivedTask, m.documentParts(await h.files.read(archivedTask)).fields).archived, true);
  assert.equal(await fs.readFile(path.join(h.root, asset.replace('1.项目', '4.存档/项目')), 'utf8'), rawAsset);
  assert.ok((await fs.stat(path.join(h.root, '4.存档/项目/长期研究/tmp/保留空目录'))).isDirectory());
  const rewritten = await h.files.read(ref);
  assert.ok(rewritten.includes(`[[${archived.path}|项目]]`));
  assert.ok(rewritten.includes(`\`[[${h.project}]]\``));
  assert.deepEqual(m.documentParts(rewritten).fields.related_work, [`[[${archivedTask}]]`]);
  assert.equal(m.documentParts(rewritten).fields.output_uses[0].artifact, archivedTask);
  assert.equal(m.documentParts(rewritten).fields.output_uses[0].version, `[[${archivedTask}|实际版本]]`);
  assert.ok(rewritten.includes(encodeURIComponent('4.存档')));
  const taskRaw = await h.files.read(archivedTask), link = /\[共用.md\]\(<([^>]+)>\)/.exec(taskRaw)[1];
  assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(archivedTask), decodeURIComponent(link))), resource);
  await assert.rejects(h.run(request('create-task', { name: '新增', goal: '结果', projectPath: archived.path })), { code: 'ARCHIVED_PROJECT' });
  await assert.rejects(h.run(request('work-update', { path: archivedTask, expected: taskRaw, status: 'completed' })), { code: 'ARCHIVED_PROJECT' });
  const restored = await h.run(request('restore-project', { path: archived.path, expected: await h.files.read(archived.path) }));
  assert.equal(restored.path, h.project);
  assert.equal(m.documentParts(await h.files.read(h.project)).fields.status, 'completed');
  assert.equal(m.documentParts(await h.files.read(h.task)).fields.id, taskFields.id);
  assert.equal(m.documentParts(await h.files.read(ref)).fields.output_uses[0].artifact, h.task);
  assert.equal(m.documentParts(await h.files.read(ref)).fields.output_uses[0].version, `[[${h.task}|实际版本]]`);
});

test('归档先检查目标与读取快照，恢复不合并重名项目', async t => {
  const h = await fixture(t), expected = await h.files.read(h.project);
  await assert.rejects(h.run(request('archive-project', { path: h.project, expected: '过期' })), { code: 'CONFLICT' });
  await h.files.ensureDirectories('4.存档/项目/长期研究');
  await assert.rejects(h.run(request('archive-project', { path: h.project, expected })), { code: 'PATH_CONFLICT' });
  await fs.rmdir(path.join(h.root, '4.存档/项目/长期研究'));
  const out = await h.run(request('archive-project', { path: h.project, expected }));
  await h.files.exclusiveFile(h.project, '新项目，不可覆盖');
  await assert.rejects(h.run(request('restore-project', { path: out.path, expected: await h.files.read(out.path) })), { code: 'PATH_CONFLICT' });
  assert.equal(await h.files.read(h.project), '新项目，不可覆盖');
});

test('归档复制中断可沿持久记录恢复，同一来源不创建第二个操作', async t => {
  const h = await fixture(t), input = request('archive-project', { path: h.project, expected: await h.files.read(h.project) });
  let failed = false;
  const archive = new m.ProjectArchive(h.root, { io: { ...fs, open: async (p, ...args) => {
    if (!failed && p.split(path.sep).join('/').includes('/4.存档/项目/') && path.basename(p) === '任务说明.md') { failed = true; throw Object.assign(Error('模拟复制中断'), { code: 'EACCES' }); }
    return fs.open(p, ...args);
  } } });
  await assert.rejects(archive.run(input), error => error.partial && Boolean(error.recoveryPath));
  assert.ok(await h.files.read(h.project)); assert.ok(await h.files.read(h.task));
  assert.equal((await archive.pending(h.project)).input.request_id, input.request_id);
  await assert.rejects(h.run({ ...input, request_id: randomUUID() }), { code: 'TRANSFER_PENDING' });
  await assert.rejects(h.run(request('create-task', { name: '迁移中新增', goal: '结果', projectPath: h.project })), { code: 'TRANSFER_PENDING' });
  const out = await h.run(input); assert.equal(out.ok, true); assert.equal(out.moved.length, 2);
});

test('归档与任务创建使用同一文件锁，不能在已搬走的项目路径新建孤立任务', async t => {
  const h = await fixture(t), input = request('archive-project', { path: h.project, expected: await h.files.read(h.project) });
  let copying, release;
  const reached = new Promise(resolve => { copying = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const archive = new m.ProjectArchive(h.root, { io: { ...fs, open: async (p, ...args) => {
    if (p === path.join(h.root, '4.存档/项目/长期研究/项目说明.md')) { copying(); await gate; }
    return fs.open(p, ...args);
  } } });
  const moving = archive.run(input);
  await reached;
  const creating = h.run(request('create-task', { name: '新任务', goal: '结果', projectPath: h.project }));
  const outcome = creating.then(() => null, error => error);
  release(); await moving;
  assert.equal((await outcome).code, 'ENOENT');
  await assert.rejects(fs.stat(path.join(h.root, '1.项目/长期研究')), { code: 'ENOENT' });
});

test('移除部分来源后中断可恢复，若迁入文件被修改则停止并保留双方', async t => {
  const h = await fixture(t), input = request('archive-project', { path: h.project, expected: await h.files.read(h.project) });
  const archive = new m.ProjectArchive(h.root, { io: { ...fs, unlink: async p => {
    if (p === path.join(h.root, h.project)) throw Object.assign(Error('模拟清理中断'), { code: 'EACCES' });
    return fs.unlink(p);
  } } });
  await assert.rejects(archive.run(input), error => error.partial);
  await assert.rejects(h.files.read(h.task), { code: 'ENOENT' });
  const target = '4.存档/项目/长期研究/项目说明.md', before = await h.files.read(target);
  await fs.writeFile(path.join(h.root, target), '用户后续改写');
  await assert.rejects(h.run(input), { code: 'PATH_CONFLICT' });
  assert.ok(await h.files.read(h.project));
  await fs.writeFile(path.join(h.root, target), before);
  assert.equal((await h.run(input)).saved, true);
});

test('项目归档拒绝托管原件、替代文件、飞书内容与需回传的外部引用', async t => {
  const h = await fixture(t), input = request('archive-project', { path: h.project, expected: await h.files.read(h.project) });
  for (const [suffix, content, code] of [
    ['原件.MP4', 'bytes', 'CLOUD_WORKFLOW_REQUIRED'],
    ['原文.pdf.yaml', 'schema: tannt-cloud-file/v1\n', 'CLOUD_WORKFLOW_REQUIRED'],
    ['镜像.md', m.newDocument({ lark_body_path: 'shared/body.md' }, '镜像'), 'LARK_WORKFLOW_REQUIRED']
  ]) {
    const p = `1.项目/长期研究/${suffix}`; await h.files.exclusiveFile(p, content);
    await assert.rejects(h.run(input), { code });
    assert.equal(await fs.readFile(path.join(h.root, p), 'utf8'), content);
    await fs.unlink(path.join(h.root, p));
  }
  const mirror = '3.资源/飞书知识库/页面.md';
  await h.files.exclusiveFile(mirror, `[[${h.project}]]`);
  await assert.rejects(h.run(input), { code: 'LARK_WORKFLOW_REQUIRED' });
  assert.ok(await h.files.read(h.project));
});

test('收件箱可明确分流到项目、领域或资源；旧Inbox来源保持身份，归档目标拒绝', async t => {
  const h = await fixture(t);
  for (const target of [h.project, '2.领域/研究/领域说明.md', '3.资源/知识/主题/索引.md']) {
    if (target !== h.project) await h.files.exclusiveFile(target, '# 说明');
    const source = `01.收件箱/2026-10/${randomUUID()}/记录.md`, id = randomUUID();
    const raw = m.newDocument({ type: 'inbox', id, title: '输入', inbox_status: 'pending' }, '需要整理的原文');
    await h.files.exclusiveFile(source, raw);
    const out = await h.run(request('transfer-inbox', { path: source, expected: raw, target, target_expected: await h.files.read(target) }));
    assert.ok(out.directory.startsWith(path.posix.dirname(target) + '/资料/'));
    assert.equal(m.documentParts(await h.files.read(out.sourcePath)).fields.id, id);
  }
  const archived = await h.run(request('archive-project', { path: h.project, expected: await h.files.read(h.project) }));
  const capture = await h.run(request('capture', { content: '新输入' }));
  await assert.rejects(h.run(request('transfer-inbox', { path: capture.path, expected: await h.files.read(capture.path), target: archived.path, target_expected: await h.files.read(archived.path) })), { code: 'ARCHIVED_PROJECT' });
});

test('领域与资源明确整包归档和恢复，拒绝推定范围或整个业务根目录', async t => {
  const h = await fixture(t);
  for (const directory of ['2.领域/写作', '3.资源/来源/课程/课程甲']) {
    const p = directory + '/说明.md', bytes = directory + '/附件.txt', ref = `导航-${directory.split('/')[0]}.md`;
    await h.files.exclusiveFile(p, m.newDocument({ type: 'note', id: randomUUID() }, '资料说明'));
    await h.files.exclusiveFile(bytes, '原附件');
    await h.files.exclusiveFile(ref, `[[${p}]]`);
    const expected = await h.files.read(p);
    await assert.rejects(h.run(request('archive-material', { path: p, expected })), { code: 'DIRECTORY_REQUIRED' });
    await assert.rejects(h.run(request('archive-material', { path: p, directory: directory.split('/')[0], expected })), { code: 'INVALID_ARCHIVE' });
    const input = request('archive-material', { path: p, directory, expected }), out = await h.run(input);
    assert.ok(out.path.startsWith('4.存档/')); assert.equal((await h.run(input)).reused, true);
    assert.equal((await h.files.read(ref)).trim(), `[[${out.path}]]`);
    const back = await h.run(request('restore-material', { path: out.path, directory: out.directory, expected: await h.files.read(out.path) }));
    assert.equal(back.path, p); assert.equal(await h.files.read(p), expected);
    assert.equal(await fs.readFile(path.join(h.root, bytes), 'utf8'), '原附件');
  }
});

test('归档解析库内工程文档但不编辑它们，保留加号文件名，不遍历运行目录或符号链接', async t => {
  const h = await fixture(t), guide = 'docs/规则.md', rootDoc = 'README.md', asset = '1.项目/长期研究/A+B.md';
  await h.files.exclusiveFile(guide, '# 工程规则\n'); await h.files.exclusiveFile(rootDoc, '# 项目说明\n');
  await h.files.exclusiveFile(asset, '附件');
  await h.files.exclusiveFile('.system/.workbench-runtime/private.md', '运行记录');
  await fs.symlink(path.join(h.root, 'docs'), path.join(h.root, '指向工程目录'));
  const names = await m.inventory(h.files);
  assert.ok(names.includes(guide) && names.includes(rootDoc));
  assert.ok(!names.includes('.system/.workbench-runtime/private.md') && !names.some(name => name.startsWith('指向工程目录/')));
  const links = [guide, rootDoc, asset].map(target => m.linkTo(target, h.project)).join('\n');
  assert.ok(links.includes('A+B.md') && !links.includes('%2B'));
  await h.files.update(h.project, await h.files.read(h.project), { append: links });
  const result = await h.run(request('archive-project', { path: h.project, expected: await h.files.read(h.project) }));
  const raw = await h.files.read(result.path);
  assert.ok(raw.includes('<../../../docs/') && raw.includes('<../../../README.md>'));
  assert.ok(raw.includes('<A+B.md>') && !raw.includes('%2B'));
  assert.equal(await fs.readFile(path.join(h.root, guide), 'utf8'), '# 工程规则\n');
  assert.equal(await fs.readFile(path.join(h.root, rootDoc), 'utf8'), '# 项目说明\n');
});

test('迁移用原生已解析目标补全工程文档，改变目录深度时修正相对路径', () => {
  const { transformed, referenceNames } = require('../../../scripts/vault/migrate-para.cjs');
  const from = '06.经验/主题/经验.md', to = '3.资源/知识/主题/经验.md';
  const guide = 'docs/规则.md', rootDoc = 'GLOSSARY.md';
  const names = referenceNames([from], { resolvedLinks: [{ target: guide }, { target: rootDoc }] });
  const after = transformed('[规则](../../docs/规则.md)\n[术语](../../GLOSSARY.md)', from, to, { [from]: to }, names);
  assert.ok(after.includes('<../../../docs/') && after.includes('<../../../GLOSSARY.md>'));
  assert.throws(() => referenceNames([from], { resolvedLinks: [{ target: '../库外.md' }] }));
});
