const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function verifyLayout(app, existingView) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const out = path.join(root, 'docs/workbench/verification');
  const plugin = app.plugins.plugins['tt-workbench'];
  const view = existingView || await plugin.openWorkbench(true, '欢迎.md');
  const win = view.contentEl.ownerDocument.defaultView;
  const browser = win.require('electron').remote.getCurrentWindow();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = { checkedAt: new Date().toISOString(), vault: 'tannt', windowTitle: browser.getTitle(), widths: [] };
  const capture = async filename => {
    const rect = view.contentEl.getBoundingClientRect();
    const image = await browser.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.floor(rect.width), height: Math.floor(rect.height) });
    await fs.writeFile(path.join(out, filename), image.toPNG());
  };
  try {
    for (const [width, height, filename] of [[1280, 860, '01-workbench-wide.png'], [650, 780, '01-workbench-narrow.png'], [420, 780, '01-workbench-small.png']]) {
      browser.setSize(width, height);
      await pause(350);
      const el = view.contentEl;
      const nav = view.nav.getBoundingClientRect();
      const list = view.listEl.closest('section').getBoundingClientRect();
      const detail = view.bodyEl.closest('section').getBoundingClientRect();
      assert.ok(el.scrollWidth <= el.clientWidth + 1, '工作台发生整体横向溢出');
      assert.ok(detail.width > 160, '正文区域不可读');
      if (width === 1280) assert.ok(nav.right <= list.left + 1 && list.right <= detail.left + 1, '宽窗口未保留布局 A');
      view.pathInput.focus();
      assert.equal(el.ownerDocument.activeElement, view.pathInput);
      report.widths.push({ requestedWidth: width, actualWidth: el.clientWidth, horizontalOverflow: el.scrollWidth > el.clientWidth + 1, layoutA: width === 1280, inputFocus: true });
      await capture(filename);
      if (width === 420) {
        const grid = el.querySelector('.tw-grid');
        grid.scrollTop = grid.scrollHeight;
        await pause(100);
        assert.ok(grid.scrollTop > 0, '窄窗口无法滚动到正文');
        report.smallWindowScrollTop = grid.scrollTop;
        const last = view.bodyEl.querySelector('.tw-markdown > :last-child').getBoundingClientRect();
        assert.ok(last.bottom <= el.getBoundingClientRect().bottom + 1, '滚动后仍无法看到正文末尾');
        await capture('01-workbench-small-scrolled.png');
        grid.scrollTop = 0;
      }
    }
    browser.setSize(1280, 860);
    await pause(350);
    const fns = app.plugins.plugins['fast-note-sync'];
    assert.equal(fns.settings.vault, 'tannt');
    const url = new URL('/webgui/', fns.runApi || fns.settings.api);
    const frame = win.document.createElement('iframe');
    frame.title = 'FNS 网页端接入验证';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    frame.style.cssText = 'position:fixed;inset:6px;width:calc(100% - 12px);height:calc(100% - 12px);z-index:99999;background:white;border:1px solid #888';
    const loaded = new Promise(resolve => {
      frame.addEventListener('load', () => resolve(true), { once: true });
      setTimeout(() => resolve(false), 12000);
    });
    frame.src = url.href;
    win.document.body.append(frame);
    try {
      report.fnsFrameLoadEvent = await loaded;
      await pause(1800);
      const image = await browser.webContents.capturePage();
      await fs.writeFile(path.join(out, '01-fns-embedded.png'), image.toPNG());
    } finally { frame.remove(); }
    report.passed = true;
    await app.workspace.revealLeaf(view.leaf);
    await capture('01-workbench-final.png');
  } catch (error) { report.passed = false; report.failure = error.message; }
  await fs.writeFile(path.join(out, '01-layout.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(report.passed ? 'TANNT_LAYOUT_PASS' : 'TANNT_LAYOUT_FAIL');
  return report;
};
