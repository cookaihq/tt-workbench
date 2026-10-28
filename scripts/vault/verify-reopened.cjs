"use strict";
// Run in the actual tannt renderer after the independent runtime cases.
const fs = require('node:fs/promises'), path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
module.exports = async function(app, view) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const out = path.join(root, '.scratch/vault-rules-and-skills/verification');
  const shared = require(path.join(root, '.obsidian/plugins/tannt-workbench/vault-lib'));
  const report = { started: new Date().toISOString(), version: app.plugins.plugins['tannt-workbench'].manifest.version, records: [] };
  const read = relative => fs.readFile(path.join(root, relative));
  try {
    assert.ok(!view.captureContent?.value && !view.inboxDrafts?.size && !view.workUI?.drafts?.size && !view.taskUI?.drafts?.size && !view.issueUI?.drafts?.size && !view.issueUI?.createDraft, 'preserve existing drafts');
    report.previousView = view.getState();
    view.navigate('01.收件箱'); view.inboxFilter = 'all'; view.refreshList();
    for (const state of ['vault-closed', 'app-stopped']) {
      const offline = JSON.parse(await fs.readFile(path.join(out, state + '.json'), 'utf8'));
      assert.equal(offline.passed, true);
      const [notePath, jsonlPath, markdownPath] = offline.files;
      const raw = await read(notePath), fields = shared.documentParts(raw.toString('utf8')).fields;
      assert.equal(hash(raw), offline.noteSha256, 'reopening must not change the offline note');
      assert.ok(app.vault.getAbstractFileByPath(notePath), 'Obsidian discovered the new note');
      const visible = [...view.listEl.querySelectorAll('button[data-path]')].map(el => el.dataset.path);
      assert.ok(visible.includes(notePath), 'offline note is listed');
      assert.ok(!visible.includes(markdownPath), 'original Markdown is not a separate inbox record');
      assert.equal(view.inboxEntries.find(entry => entry.path === markdownPath)?.kind, 'auxiliary');
      assert.equal(fields.inbox_status, 'reviewed');
      await view.openNote(notePath);
      assert.equal(view.statusEl.dataset.kind, 'loaded');
      const info = view.noteInfoEl.textContent, body = view.bodyEl.textContent;
      assert.ok(info.includes('已整理') && info.includes(fields.created) && info.includes(fields.created_timezone), 'status and original creation fields rendered');
      assert.ok(body.includes(`合成验收：${state}，中文 🌱`) && body.includes('独立运行时追加正文'), 'original and appended body rendered');
      const links = [...view.bodyEl.querySelectorAll('a.internal-link')].map(el => ({ text: el.textContent, target: el.dataset.href || el.getAttribute('href') }));
      for (const attachment of [jsonlPath, markdownPath]) {
        const link = links.find(link => link.text === path.posix.basename(attachment));
        assert.ok(link, 'rendered attachment link: ' + attachment);
        assert.equal(app.metadataCache.getFirstLinkpathDest(link.target, notePath)?.path, attachment, 'link resolves to original copied file');
        assert.equal(hash(await read(attachment)), hash(await fs.readFile(path.join(out, path.posix.basename(attachment)))));
      }
      const win = view.contentEl.ownerDocument.defaultView;
      await app.workspace.revealLeaf(view.leaf);
      const browser = win.require('electron').remote.getCurrentWindow();
      browser.webContents.closeDevTools();
      await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
      const rect = view.contentEl.getBoundingClientRect();
      const screenshot = state + '-reopened.png';
      await fs.writeFile(path.join(out, screenshot), (await browser.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.floor(rect.width), height: Math.floor(rect.height) })).toPNG());
      report.records.push({ state, path: notePath, sha256: hash(raw), status: fields.inbox_status, created: fields.created, offset: fields.created_timezone, visible: true, auxiliaryExcluded: true, info, body, links, screenshot, passed: true });
    }
    report.passed = true;
  } catch (error) { report.passed = false; report.failure = error.stack; }
  report.finished = new Date().toISOString();
  await fs.writeFile(path.join(out, 'reopened-workbench.json'), JSON.stringify(report, null, 2));
  return report;
};
