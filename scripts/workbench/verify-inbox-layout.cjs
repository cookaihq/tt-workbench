const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { mapPreviousPath } = require('../../apps/workbench/vault-paths.js');

module.exports = async function verifyInboxLayout(app, existingView) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const out = path.join(root, 'docs/workbench/verification');
  const samples = JSON.parse(await fs.readFile(path.join(out, '02-native-inbox.json'), 'utf8')).samples.map(sample => ({ ...sample, path: mapPreviousPath(sample.path) }));
  const plugin = app.plugins.plugins['tannt-workbench'];
  const view = existingView || await plugin.openWorkbench(true, samples[0].path);
  await view.openNote(samples[0].path);
  view.pageScope = '01.收件箱';
  view.refreshList();
  const win = view.contentEl.ownerDocument.defaultView;
  const browser = win.require('electron').remote.getCurrentWindow();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = { checkedAt: new Date().toISOString(), vault: 'tannt', windowTitle: browser.getTitle(), checks: [] };
  const capture = async name => {
    const rect = view.contentEl.getBoundingClientRect();
    const image = await browser.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.floor(rect.width), height: Math.floor(rect.height) });
    await fs.writeFile(path.join(out, name), image.toPNG());
  };
  try {
    for (const [width, height] of [[1280, 860], [650, 780], [420, 780]]) {
      browser.setSize(width, height);
      await pause(300);
      view.captureButton.click();
      await pause(100);
      const rootEl = view.contentEl;
      assert.ok(rootEl.scrollWidth <= rootEl.clientWidth + 1, '表单导致整体水平溢出');
      assert.equal(rootEl.ownerDocument.activeElement, view.captureContent);
      const textarea = view.captureContent.getBoundingClientRect();
      assert.ok(textarea.width > 200 && textarea.height > 50, '输入区域不可用');
      await capture(`02-capture-${width}.png`);
      view.saveButton.scrollIntoView({ block: 'nearest' });
      await pause(100);
      const bounds = rootEl.getBoundingClientRect();
      const save = view.saveButton.getBoundingClientRect();
      assert.ok(save.top >= bounds.top && save.bottom <= bounds.bottom + 1, '保存按钮无法滚动到可见区域');
      assert.ok(save.left >= bounds.left && save.right <= bounds.right + 1);
      view.hideCaptureButton.click();
      view.bodyEl.scrollIntoView({ block: 'nearest' });
      await pause(100);
      assert.ok(view.bodyEl.clientHeight > 50, '保存表单收起后正文区域被压缩');
      assert.ok(view.bodyEl.textContent.includes('一条输入可以保留多个来源'));
      await capture(`02-reading-${width}.png`);
      report.checks.push({ width, noHorizontalOverflow: true, inputFocus: true, saveButtonReachable: true, readingVisible: true });
    }
    browser.setSize(1280, 860);
    await pause(300);
    view.captureButton.click();
    view.captureContent.focus();
    report.passed = true;
  } catch (error) { report.passed = false; report.failure = error.message; }
  await fs.writeFile(path.join(out, '02-layout.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(report.passed ? 'TANNT_INBOX_LAYOUT_PASS' : 'TANNT_INBOX_LAYOUT_FAIL');
  return report;
};
