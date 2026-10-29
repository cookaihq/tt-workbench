'use strict';
const assert = require('node:assert/strict');

// Run in the explicitly selected Obsidian instance. This inspection never
// configures FNS, reloads plugins, checks a remote or publishes a version.
module.exports = async function verifyUpdates(app) {
  const plugin = app.plugins.plugins['tt-workbench'];
  assert.ok(plugin, '请先启用当前知识库的 tt 工作台。');
  const view = await plugin.openWorkbench(), ui = view.updatesUI;
  ui.open();
  try {
    assert.ok(ui.body.textContent.includes('当前运行 v' + plugin.manifest.version));
    assert.ok(!ui.body.textContent.includes('代码同步设置'));
    assert.ok(!ui.body.textContent.includes('本机文件排除'));
    return { version: plugin.manifest.version, vault: app.vault.adapter.getBasePath(), updateDialog: true, fnsSettingsInVersionDialog: false };
  } finally { ui.close(); }
};

module.exports.scopeUI = async function verifyLocalProtection(app) {
  const plugin = app.plugins.plugins['tt-workbench'];
  assert.ok(plugin, '请先启用当前知识库的 tt 工作台。');
  const view = await plugin.openWorkbench();
  view.fnsUI.checkDialog();
  const ui = view.fnsUI.localUI;
  try {
    await ui.refresh();
    assert.ok(ui.body.textContent.includes('本机文件排除'));
    assert.ok(ui.report, ui.readError || '未取得本机检查结果');
    for (const item of ui.report.paths) assert.ok(ui.body.textContent.includes(item.path + (item.kind === 'directory' ? '/' : '')));
    assert.ok(ui.report.paths.some(item => item.path === app.vault.configDir + '/community-plugins.json'));
    assert.ok(ui.report.paths.some(item => item.path === app.vault.configDir + '/plugins/tt-workbench.install-lock'));
    return { version: plugin.manifest.version, status: ui.report.status, paths: ui.report.paths, readOnly: true };
  } finally { ui.close(); }
};

module.exports.layout = async function verifyLayout(app, window) {
  const view = app.workspace.getLeavesOfType('tt-workbench').map(leaf => leaf.view).find(item => item.contentEl.ownerDocument.defaultView === window);
  assert.ok(view, '请在工作台窗口中运行布局检查。');
  const browser = window.require('electron').remote.getCurrentWindow(), before = browser.getBounds(), layouts = [];
  try {
    for (const width of [1280, 420]) {
      browser.setSize(width, 860);
      await new Promise(resolve => setTimeout(resolve, 180));
      view.updatesUI.open();
      assert.ok(view.updatesUI.dialog.scrollWidth <= view.updatesUI.dialog.clientWidth + 1, '版本弹窗横向溢出');
      view.updatesUI.close();
      view.fnsUI.checkDialog();
      const local = view.fnsUI.localUI;
      await local.refresh();
      assert.ok(local.dialog.scrollWidth <= local.dialog.clientWidth + 1, '本机检查弹窗横向溢出');
      local.close();
      layouts.push({ width, horizontalOverflow: false });
    }
    return { layouts };
  } finally { view.updatesUI.close(); view.fnsUI.localUI?.close(); browser.setBounds(before); }
};
