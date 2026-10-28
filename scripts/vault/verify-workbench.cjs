"use strict";
// Invoke only in the actual tannt Obsidian renderer. Creates labelled acceptance notes.
const fs = require('node:fs/promises'), path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const hash = x => createHash('sha256').update(x).digest('hex');
module.exports = async function verify(app, nodeBinary, existingView) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const out = path.join(root, '.scratch/vault-rules-and-skills/verification');
  const shared = require(path.join(root, 'lib/vault'));
  const report = { started: new Date().toISOString(), entry: 'installed Obsidian workbench, native Templates, CLI', checks: [], files: [] };
  const record = (name, detail = {}) => report.checks.push({ name, passed: true, ...detail });
  const flush = () => fs.writeFile(path.join(out, 'native-workbench.json'), JSON.stringify(report, null, 2));
  const read = p => fs.readFile(path.join(root, p), 'utf8');
  const fields = text => shared.documentParts(text).fields;
  const wait = async (fn, label) => {
    const until = Date.now() + 12000;
    while (Date.now() < until) { if (await fn()) return; await new Promise(r => setTimeout(r, 80)); }
    throw Error('timeout: ' + label);
  };
  const cli = input => new Promise((resolve, reject) => {
    const child = spawn(nodeBinary, [path.join(root, 'scripts/vault/write.mjs')], { cwd: root });
    let output = '', errors = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', x => output += x); child.stderr.on('data', x => errors += x);
    child.on('error', reject); child.on('close', code => {
      try { const result = JSON.parse(output); if (code || !result.ok) throw Error(output + errors); resolve(result); } catch (e) { reject(e); }
    }); child.stdin.end(JSON.stringify(input));
  });
  let view, manualLeaf;
  try {
    const plugin = app.plugins.plugins['tannt-workbench'];
    report.version = plugin.manifest.version; assert.equal(report.version, '0.15.0');
    view = existingView || await plugin.openWorkbench(true);
    const win = view.contentEl.ownerDocument.defaultView;
    view.navigate('01.收件箱');
    const title = '工作台验收-共同规则-表单-20261021';
    const body = '  合成验收原文：中文 🌱\n\n保持空行与结尾换行。\n';
    view.captureButton.click(); view.captureTitle.value = title; view.captureContent.value = body;
    view.captureSources.value = 'https://example.org/workbench-shared-rules';
    view.captureForm.dispatchEvent(new win.Event('input', { bubbles: true }));
    view.captureForm.requestSubmit();
    await wait(() => !view.saving && view.captureStatus.dataset.kind !== 'loading', 'native capture');
    assert.equal(view.captureStatus.dataset.kind, 'saved', view.captureStatus.textContent);
    const notePath = view.selectedPath; report.files.push(notePath); report.notePath = notePath;
    assert.match(notePath, /\/工作台验收-共同规则-表单-20261021(?: \(\d+\))?\/记录\.md$/);
    let raw = await read(notePath), initial = fields(raw);
    assert.ok(raw.endsWith(body)); assert.equal(initial.inbox_status, 'pending'); assert.equal(initial.capture_entry, 'workbench');
    record('表单保存可读目录，原文与创建时区完整，默认待整理', { path: notePath }); await flush();

    const source = path.join(out, '原始笔记样例.md');
    const attached = await plugin.attachments.save({ path: notePath, expected: raw, source, directory: path.posix.dirname(notePath) + '/原始资料' });
    report.files.push(attached.attachmentPath);
    assert.equal(hash(await fs.readFile(path.join(root, attached.attachmentPath))), hash(await fs.readFile(source)));
    await wait(() => app.metadataCache.getCache(notePath)?.frontmatter?.attachments?.includes(attached.attachmentPath), 'attachment metadata');
    view.refreshList(); await view.openNote(notePath);
    assert.equal(view.inboxEntries.find(x => x.path === attached.attachmentPath)?.kind, 'auxiliary', 'original Markdown classified as auxiliary');
    assert.ok(!view.listEl.textContent.includes('原始笔记样例.md'), 'auxiliary Markdown excluded from visible Inbox list');
    assert.ok(view.bodyEl.textContent.includes('原始笔记样例.md'));
    record('工作台附件保存保留原名原字节，指定子目录，原 Markdown 不计为新输入', { path: attached.attachmentPath });

    const input = view.bodyEl.querySelector('.tw-edit-panel textarea');
    input.value = '工作台表单补充验收'; input.dispatchEvent(new win.Event('input', { bubbles: true }));
    view.bodyEl.querySelector('.tw-edit-panel form').requestSubmit();
    await wait(async () => (await read(notePath)).includes('工作台表单补充验收'), 'append');
    await wait(() => !view.inboxDrafts.has(notePath), 'append UI completion');
    await view.openNote(notePath);
    view.bodyEl.querySelector('[data-review-status="reviewed"]').click();
    await wait(async () => fields(await read(notePath)).inbox_status === 'reviewed', 'review');
    await wait(() => view.bodyEl.querySelector('[data-review-status="pending"]'), 'review UI completion');
    raw = await read(notePath); assert.equal(fields(raw).created, initial.created); assert.equal(fields(raw).created_timezone, initial.created_timezone);
    record('真实补充与整理按钮只执行指定变更，创建时间保留'); await flush();

    const staleInput = view.bodyEl.querySelector('.tw-edit-panel textarea');
    staleInput.value = '工作台旧原文上的拟写内容'; staleInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    await cli({ action: 'update', request_id: randomUUID(), privacy: 'ordinary', path: notePath, expected: raw, append: '另一个 Node 进程先提交的内容' });
    const external = await read(notePath);
    view.bodyEl.querySelector('.tw-edit-panel form').requestSubmit();
    await wait(() => view.bodyEl.querySelector('.tw-edit-panel .tw-status')?.dataset.errorCode === 'CONFLICT', 'mixed writer conflict');
    assert.equal(await read(notePath), external);
    const conflictNames = (await fs.readdir(path.dirname(path.join(root, notePath)))).filter(x => x.includes('保存冲突'));
    assert.ok(conflictNames.length); report.files.push(...conflictNames.map(x => path.posix.join(path.posix.dirname(notePath), x)));
    assert.ok((await read(report.files.at(-1))).includes('工作台旧原文上的拟写内容'));
    view.inboxDrafts.delete(notePath); await view.openNote(notePath);
    record('实际 CLI 先修改、工作台后提交时保留冲突副本，原笔记不覆盖'); await flush();

    const manualPath = '01.收件箱/工作台验收-共同规则-手动模板-20261021.md';
    if (app.vault.getAbstractFileByPath(manualPath)) throw Error('manual acceptance path already exists; do not overwrite');
    const file = await app.vault.create(manualPath, ''); report.files.push(manualPath);
    manualLeaf = app.workspace.getLeaf('tab'); await manualLeaf.openFile(file);
    await app.workspace.revealLeaf(manualLeaf);
    const templates = app.internalPlugins.plugins.templates.instance;
    assert.equal(templates.options.folder, 'templates');
    await templates.insertTemplate(app.vault.getAbstractFileByPath('templates/收件箱.md'));
    const editor = manualLeaf.view.editor, line = editor.lineCount() - 1;
    editor.replaceRange('手动模板验收：这是合成输入。\n', { line, ch: editor.getLine(line).length });
    await wait(async () => (await read(manualPath)).includes('手动模板验收'), 'native editor save');
    const manual = await read(manualPath), fm = fields(manual);
    assert.equal(fm.type, 'inbox'); assert.equal(fm.id, undefined); assert.ok(!manual.includes('{{'));
    assert.ok(Number.isFinite(shared.creationInstant(fm.created, fm.created_timezone)));
    await wait(() => app.metadataCache.getCache(manualPath)?.frontmatter?.type === 'inbox', 'manual metadata');
    await app.workspace.revealLeaf(view.leaf); view.inboxFilter = 'all'; view.refreshList();
    const legacy = view.inboxEntries.find(x => /\/[0-9a-f-]{36}-[^/]+\/记录\.md$/i.test(x.path));
    assert.ok(legacy); const old = await read(legacy.path);
    for (const p of [legacy.path, manualPath, notePath]) { await view.openNote(p); assert.equal(view.statusEl.dataset.kind, 'loaded'); }
    assert.equal(await read(legacy.path), old); assert.equal(await read(manualPath), manual);
    record('核心 Templates 与原生编辑器保存成功；旧 UUID、手动单文件、新目录混合读取', { manualPath, legacyPath: legacy.path });

    // Reopen this task's own view, leaving pre-existing user views intact.
    await view.leaf.setViewState({ type: 'empty' });
    await view.leaf.setViewState({ type: 'tannt-workbench', active: true, state: { path: notePath } });
    view = view.leaf.view; if (view.leaf.loadIfDeferred) await view.leaf.loadIfDeferred();
    view.navigate('01.收件箱'); view.inboxFilter = 'all'; view.refreshList();
    await view.openNote(notePath); assert.equal(view.statusEl.dataset.kind, 'loaded');
    assert.ok(view.bodyEl.textContent.includes('另一个 Node 进程先提交的内容'));
    record('重开工作台视图后读取实际更新结果');
    const rect = view.contentEl.getBoundingClientRect();
    await new Promise(resolve => view.contentEl.ownerDocument.defaultView.requestAnimationFrame(() => view.contentEl.ownerDocument.defaultView.requestAnimationFrame(resolve)));
    const browser = view.contentEl.ownerDocument.defaultView.require('electron').remote.getCurrentWindow();
    await fs.writeFile(path.join(out, 'native-workbench.png'), (await browser.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.floor(rect.width), height: Math.floor(rect.height) })).toPNG());
    report.passed = true;
  } catch (error) { report.passed = false; report.failure = error.stack; }
  finally { if (manualLeaf) await manualLeaf.detach(); report.finished = new Date().toISOString(); await flush(); }
  return view;
};
