'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

// Run in the actual tannt renderer. UI fixtures never publish or save real settings.
module.exports = async function verifyFnsNotes(app) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const directory = path.join(root, '.scratch/fns-config-sync/verification/notes');
  await fs.mkdir(directory, { recursive: true });
  const report = { startedAt: new Date().toISOString(), checks: [], realPublicationChanged: false };
  const checkpoint = async stage => { report.stage = stage; await fs.writeFile(path.join(directory, 'native.json'), JSON.stringify(report, null, 2) + '\n'); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async predicate => {
    const end = Date.now() + 8000;
    while (!predicate() && Date.now() < end) await pause(40);
    assert.ok(predicate(), '等待界面完成超时');
  };
  let fixture, browser, bounds;
  await checkpoint('核对未保存输入');
  try {
    assert.ok(!app.workspace.getLeavesOfType('tt-workbench').some(({ view: v }) =>
      v.saving || v.fnsUI?.busy || v.fnsUI?.notesEditorDraft || v.captureContent?.value || v.inboxDrafts?.size
      || v.workUI?.drafts?.size || v.taskUI?.drafts?.size || v.issueUI?.drafts?.size || v.issueUI?.createDraft), '存在未保存输入，不能重载');
    const stateFile = path.join(root, '.system/.workbench-runtime/fns-sync/state.json');
    const sourceFile = path.join(root, app.vault.configDir, 'plugins/fast-note-sync/data.json');
    const stateBefore = await fs.readFile(stateFile, 'utf8'), sourceBefore = await fs.readFile(sourceFile, 'utf8');
    await checkpoint('加载已安装版本');
    await app.plugins.unloadPlugin('tt-workbench'); await app.plugins.loadManifests();
    await app.plugins.enablePluginAndSave('tt-workbench');
    const plugin = app.plugins.plugins['tt-workbench'];
    const version = JSON.parse(await fs.readFile(path.join(root, 'apps/workbench/manifest.json'), 'utf8')).version;
    assert.equal(plugin.manifest.version, version); report.version = version;
    const view = await plugin.openWorkbench(); view.navigate('@fns'); await view.fnsUI.refresh();
    assert.ok(view.fnsUI.report.notes); assert.equal(view.fnsUI.error, '');
    assert.ok(view.fnsUI.panel.textContent.includes('编辑说明'));
    assert.ok(view.fnsUI.panel.querySelector('.tw-fns-note'));
    const win = view.contentEl.ownerDocument.defaultView;
    browser = win.require('electron').remote.getCurrentWindow(); bounds = browser.getBounds();
    browser.webContents.closeDevTools();
    report.checks.push('正式插件加载、FNS 入口及真实 v2 说明占位显示');
    const requireLocal = createRequire(path.join(root, '.obsidian/plugins/tt-workbench/main.js'));
    const { FnsUI } = requireLocal('./fns-ui.js');
    const { FIELDS } = requireLocal('./lib/fns/rules.cjs');
    const { noteChanges } = requireLocal('./lib/fns/notes.cjs');
    const rule = { pattern: '.scratch', caseSensitive: false };
    const rules = Object.fromEntries(FIELDS.map(field => [field, field === FIELDS[0] ? [rule] : []]));
    const reason = '验收样例：同步开发规格、任务和验收记录，便于换设备后继续工作。\n第二行说明用于验证换行。';
    const notes = [{ field: FIELDS[0], ...rule, reason }];
    const sample = { device: { deviceId: '界面验收样例', status: 'ready' }, status: 'equal',
      local: { rules }, publication: { version: 99, sourceDevice: '验收样例', publishedAt: new Date().toISOString(), rules, notes },
      notes: { expected: { authorityCommit: 'fixture', localRevision: 'fixture', notesRevision: '1' }, entries: notes, draft: false, conflict: false } };
    let rejectSave = true, saved = null, published = false;
    const service = {
      inspect: async () => structuredClone(sample),
      saveNotes: async (expected, entries) => {
        assert.deepEqual(expected, sample.notes.expected);
        if (rejectSave) throw Error('验收样例：保存失败，输入应保留。');
        saved = structuredClone(entries); sample.notes.entries = saved; sample.notes.draft = true;
        sample.notes.expected.notesRevision = '2'; return { message: '验收样例：说明草稿已保存。' };
      },
      preview: async () => ({ version: 100, diff: Object.fromEntries(FIELDS.map(field => [field, { add: [], remove: [] }])), noteChanges: noteChanges(notes, saved || notes) }),
      publish: async () => { published = true; throw Error('禁止从界面夹具发布'); }
    };
    fixture = win.document.body.createDiv({ cls: 'tt-workbench', attr: { 'data-page': 'fns' } });
    Object.assign(fixture.style, { position: 'fixed', inset: '0', zIndex: '99999', overflow: 'auto' });
    const content = fixture.createDiv(); content.style.padding = '20px';
    const fakeView = { contentEl: fixture, pageScope: '@fns', plugin: { fns: service },
      button: (parent, text, title, callback) => { const button = parent.createEl('button', { text, attr: { title } }); button.addEventListener('click', callback); return button; } };
    const ui = new FnsUI(fakeView); ui.build(content); ui.panel.hidden = false;
    ui.message = '界面验收样例 · 不保存或发布真实配置'; await ui.refresh();
    await checkpoint('宽窄布局与说明显示');
    report.layouts = [];
    for (const width of [1280, 420]) {
      browser.setSize(width, 860); await pause(160);
      assert.ok(fixture.scrollWidth <= fixture.clientWidth + 1, '页面横向溢出');
      const note = ui.panel.querySelector('.tw-fns-column:last-child .tw-fns-reason');
      assert.equal(note.textContent, reason);
      const rect = note.getBoundingClientRect(); assert.ok(rect.width > 90 && rect.right <= fixture.clientWidth + 1);
      await fs.writeFile(path.join(directory, `fixture-${width}.png`), (await browser.webContents.capturePage()).toPNG());
      report.layouts.push({ width, overflow: false, reasonVisible: true });
    }
    browser.setSize(1280, 860); await pause(120);
    await checkpoint('编辑、保存失败保留、恢复草稿及发布预览');
    ui.panel.querySelector('.tw-fns-note-edit').click();
    let dialog = fixture.querySelector('dialog[open]'), input = dialog.querySelector('textarea');
    assert.equal(input.value, reason);
    const updated = '验收新说明 <img src=x onerror=alert(1)>\n支持多行纯文本。';
    input.value = updated; input.dispatchEvent(new win.Event('input', { bubbles: true }));
    const click = text => [...fixture.querySelectorAll('dialog[open] button')].find(button => button.textContent === text).click();
    click('保存说明草稿'); await until(() => !ui.busy);
    assert.ok(fixture.querySelector('dialog[open]')); assert.equal(input.value, updated);
    assert.ok(!dialog.querySelector('[role=alert]').hidden);
    click('稍后继续'); await pause(50); assert.ok(ui.notesEditorDraft);
    await ui.prepare('publish');
    assert.ok(fixture.querySelector('dialog[open] textarea'), '发布必须先处理未保存输入');
    input = fixture.querySelector('dialog[open] textarea'); assert.equal(input.value, updated);
    rejectSave = false; click('保存说明草稿'); await until(() => !ui.busy && !fixture.querySelector('dialog[open]'));
    assert.equal(saved[0].reason, updated); assert.equal(ui.notesEditorDraft, null);
    assert.equal(ui.panel.querySelector('.tw-fns-column:last-child .tw-fns-reason').textContent, reason);
    assert.ok(!ui.panel.querySelector('img'), '说明必须按纯文本呈现');
    await ui.prepare('publish');
    dialog = fixture.querySelector('dialog[open]'); assert.ok(dialog.textContent.includes('设置说明的变化'));
    assert.ok(dialog.textContent.includes(updated)); assert.ok(!dialog.querySelector('img'));
    click('取消'); assert.equal(published, false);
    report.checks.push('宽窄布局、逐条入口、保存失败保留输入、继续编辑、保存后左右区别、说明变更预览与纯文本呈现');
    ui.dispose(); fixture.remove(); fixture = null;
    browser.setBounds(bounds); await view.fnsUI.refresh(); await pause(100);
    await fs.writeFile(path.join(directory, 'actual.png'), (await browser.webContents.capturePage()).toPNG());
    assert.equal(await fs.readFile(stateFile, 'utf8'), stateBefore);
    assert.equal(await fs.readFile(sourceFile, 'utf8'), sourceBefore);
    report.checks.push('真实权威记录、本机草稿文件及 FNS 配置原文未改变');
    report.passed = true; await checkpoint('完成');
  } catch (error) {
    report.passed = false; report.error = error.message; await checkpoint('失败');
  } finally { fixture?.remove(); if (browser && bounds) browser.setBounds(bounds); }
  return { passed: report.passed, stage: report.stage, error: report.error };
};
