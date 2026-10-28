"use strict";
// Run in a tannt renderer after installation. Rechecks the final changed writer
// and reads the record saved through the real Chrome -> Obsidian URI flow.
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async function(app, leaf) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath(), out = path.join(root, '.scratch/vault-rules-and-skills/verification');
  const report = { started: new Date().toISOString(), checks: [], files: [] };
  const read = p => fs.readFile(path.join(root, p), 'utf8');
  const check = name => report.checks.push({ name, passed: true });
  const wait = async (test, label) => {
    const until = Date.now() + 12000;
    while (Date.now() < until) { if (await test()) return; await new Promise(r => setTimeout(r, 80)); }
    throw Error('timeout: ' + label);
  };
  let view;
  try {
    for (const {view:v} of app.workspace.getLeavesOfType('tannt-workbench')) {
      assert.ok(!v.captureContent?.value && !v.inboxDrafts?.size && !v.workUI?.drafts?.size && !v.taskUI?.drafts?.size && !v.issueUI?.drafts?.size && !v.issueUI?.createDraft, 'preserve all existing drafts before reload');
    }
    await app.plugins.unloadPlugin('tannt-workbench');
    await app.plugins.loadManifests(); await app.plugins.enablePluginAndSave('tannt-workbench');
    await leaf.setViewState({type:'tannt-workbench',active:true});
    if (leaf.loadIfDeferred) await leaf.loadIfDeferred();
    view = leaf.view; const plugin = app.plugins.plugins['tannt-workbench'];
    report.version = plugin.manifest.version;
    const shared = require(path.join(root,'.obsidian/plugins/tannt-workbench/vault-lib'));
    const p = '01.收件箱/2026-10/工作台验收-共同规则-剪藏-20261021/记录.md';
    const selected = 'From personal notes to journaling, knowledge bases, and project management, Obsidian gives you the tools to come up with ideas and organize\u00a0them.';
    const raw = await read(p), parts = shared.documentParts(raw);
    assert.ok(raw.endsWith(selected), 'actual webpage selection preserved byte for byte');
    assert.equal(parts.fields.capture_entry, 'browser'); assert.equal(parts.fields.inbox_status, 'pending');
    assert.deepEqual(parts.fields.source_urls, ['https://obsidian.md/']);
    assert.ok(Number.isFinite(shared.creationInstant(parts.fields.created, parts.fields.created_timezone)), 'real timestamp with offset');
    report.files.push(p); report.browser = { source: 'https://obsidian.md/', title: 'Obsidian - Sharpen your thinking', text: selected, entry: 'native Chrome selection; browser-capture.js body in DevTools; native Open Obsidian confirmation; native save button' };
    view.navigate('01.收件箱'); await view.openNote(p);
    assert.equal(view.statusEl.dataset.kind,'loaded'); assert.ok(view.bodyEl.textContent.includes(selected),'browser text visible after plugin reload');
    check('真实 Chrome 剪藏原文、来源、待整理和时间字段正确；插件重载后可读');

    const notePath = JSON.parse(await fs.readFile(path.join(out,'native-workbench.json'),'utf8')).notePath;
    const before = await read(notePath), initial = shared.documentParts(before).fields;
    await view.openNote(notePath);
    const message = '最终安装回归：恢复快照不参与笔记索引。';
    assert.ok(!before.includes(message),'do not duplicate this acceptance update');
    const seen = [], original = plugin.editor.exclusiveFile;
    plugin.editor.exclusiveFile = async function(p,...args) { seen.push(p); return original.call(this,p,...args); };
    try {
      const win = view.contentEl.ownerDocument.defaultView, input = view.bodyEl.querySelector('.tw-edit-panel textarea');
      input.value = message; input.dispatchEvent(new win.Event('input',{bubbles:true}));
      view.bodyEl.querySelector('.tw-edit-panel form').requestSubmit();
      await wait(async()=> (await read(notePath)).includes(message),'final native update');
      await wait(()=>!view.inboxDrafts.has(notePath),'native save completion');
    } finally { plugin.editor.exclusiveFile = original; }
    assert.ok(seen.some(p=>p.endsWith('/before.txt')) && seen.some(p=>p.endsWith('/after.txt')),'real update used non-Markdown snapshots');
    assert.ok(!seen.some(p=>p.startsWith('apps/workbench/data/vault-io/updates/')&&p.endsWith('.md')),'no Markdown runtime snapshot created');
    const updated = shared.documentParts(await read(notePath)).fields;
    assert.equal(updated.created,initial.created);assert.equal(updated.created_timezone,initial.created_timezone);
    report.snapshots = seen;report.files.push(notePath);
    check('最终安装副本经真实表单完成追加；恢复快照不生成 Markdown，创建时间不变');

    await view.openNote(p); await app.workspace.revealLeaf(leaf);
    const win = view.contentEl.ownerDocument.defaultView, browser = win.require('electron').remote.getCurrentWindow();
    browser.webContents.closeDevTools();
    await new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));
    const rect = view.contentEl.getBoundingClientRect();
    await fs.writeFile(path.join(out,'browser-visible.png'),(await browser.webContents.capturePage({x:Math.round(rect.x),y:Math.round(rect.y),width:Math.floor(rect.width),height:Math.floor(rect.height)})).toPNG());
    report.passed = true;
  } catch(error) { report.passed = false;report.failure = error.stack; }
  report.finished = new Date().toISOString();await fs.writeFile(path.join(out,'final-native.json'),JSON.stringify(report,null,2));
  return view;
};
