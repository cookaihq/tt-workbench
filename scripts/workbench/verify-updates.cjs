'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

// Run in the actual tannt Obsidian renderer after installing the source.
module.exports = async function verifyUpdates(app) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const requireLocal = createRequire(path.join(root, 'apps/workbench/main.js'));
  for (const name of ['../../lib/fns/sync.cjs', '../../lib/fns/workbench-scope.cjs']) delete requireLocal.cache[requireLocal.resolve(name)];
  const directory = path.join(root, '.scratch/workbench-updates/verification');
  await fs.mkdir(directory, { recursive: true });
  const report = { startedAt: new Date().toISOString(), platform: process.platform, privateRemoteRead: false, checks: [] };
  const save = async stage => { report.stage = stage; await fs.writeFile(path.join(directory, 'native.json'), JSON.stringify(report, null, 2) + '\n'); };
  await save('check drafts');
  try {
    assert.ok(!app.workspace.getLeavesOfType('tannt-workbench').some(({ view: v }) =>
      v.saving || v.fnsUI?.busy || v.captureContent?.value || v.inboxDrafts?.size || v.workUI?.drafts?.size || v.taskUI?.drafts?.size || v.issueUI?.drafts?.size || v.issueUI?.createDraft), '工作台有未保存输入，不能重载。');
    const { createFnsRuntime } = requireLocal('./fns-runtime.js');
    const { FnsSyncService } = requireLocal('../../lib/fns/sync.cjs');
    const { applyWorkbenchExclusions } = requireLocal('../../lib/fns/workbench-scope.cjs');
    const runtime = createFnsRuntime(app), before = structuredClone((await runtime.inspect()).settings);
    const service = new FnsSyncService({ vault: root, configDir: app.vault.configDir, runtime });
    await save('apply FNS exclusions');
    report.fns = await applyWorkbenchExclusions(service);
    assert.equal(report.fns.loaded, true);
    const after = (await runtime.inspect()).settings;
    report.changedSettingKeys = Object.keys(before).filter(key => key !== 'syncExcludeFolders' && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    assert.deepEqual(report.changedSettingKeys, [], 'FNS 其他设备设置发生变化，请仅检查键名并核对语义。');
    assert.ok((await fs.lstat(path.join(root, app.vault.configDir, 'plugins/fast-note-sync/data.json'))).isSymbolicLink());
    report.checks.push('FNS code exclusions loaded; other runtime settings and device link preserved');
    await save('reload workbench');
    await app.plugins.unloadPlugin('tannt-workbench');
    await app.plugins.loadManifests(); await app.plugins.enablePluginAndSave('tannt-workbench');
    const version = JSON.parse(await fs.readFile(path.join(root, 'apps/workbench/manifest.json'), 'utf8')).version;
    const plugin = app.plugins.plugins['tannt-workbench']; assert.equal(plugin.manifest.version, version);
    const view = await plugin.openWorkbench();
    assert.ok(view.updatesUI.button.textContent.includes('v' + version));
    // Startup already begins the check. Wait for that operation rather than
    // assuming a second call starts another one.
    const deadline = Date.now() + 40000;
    while (plugin.updates.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (plugin.updates.status.kind === 'idle') await plugin.updates.check();
    report.updateStatus = { kind: plugin.updates.status.kind, current: plugin.updates.status.current, latest: plugin.updates.status.latest, message: plugin.updates.status.message };
    assert.ok(['ahead', 'current', 'available'].includes(report.updateStatus.kind), report.updateStatus.message);
    report.privateRemoteRead = true;
    view.updatesUI.open();
    assert.ok(view.updatesUI.body.textContent.includes('当前运行 v' + version));
    view.updatesUI.close();
    report.checks.push(`installed v${version} loaded; version dialog and real private Git check passed`);
    report.success = true; await save('complete');
    return report;
  } catch (error) {
    report.success = false; report.error = error.code || 'NATIVE_CHECK_FAILED'; report.failedAt = report.stage;
    // Assertion output can contain settings; persist no actual/expected values.
    await save('failed'); throw new Error('工作台更新验收停止：' + report.failedAt + ' / ' + report.error);
  }
};

module.exports.layout = async function verifyLayout(app, window) {
  assert.equal(app.vault.getName(), 'tannt');
  const view = app.workspace.getLeavesOfType('tannt-workbench').map(l => l.view).find(v => v.contentEl.ownerDocument.defaultView === window);
  assert.ok(view, '请在工作台独立窗口的控制台运行布局验收。');
  const browser = window.require('electron').remote.getCurrentWindow();
  const previous = browser.getBounds(), directory = path.join(app.vault.adapter.getBasePath(), '.scratch/workbench-updates/verification');
  const layouts = [];
  try {
    browser.webContents.closeDevTools();
    for (const width of [1280, 420]) {
      browser.setSize(width, 860);
      await new Promise(resolve => setTimeout(resolve, 180));
      view.updatesUI.close();
      const root = view.contentEl, header = root.querySelector('.tw-header');
      const rect = root.getBoundingClientRect(), badge = view.updatesUI.button.getBoundingClientRect();
      assert.ok(header.scrollWidth <= header.clientWidth + 1, '页头横向溢出');
      assert.ok(badge.left >= rect.left && badge.right <= rect.right, '版本号超出工作台');
      const capture = async name => fs.writeFile(path.join(directory, name), (await browser.webContents.capturePage()).toPNG());
      await capture(`header-${width}.png`);
      view.updatesUI.open();
      const dialog = view.updatesUI.dialog;
      assert.ok(dialog.getBoundingClientRect().width <= rect.width, '版本弹窗超出窗口');
      await capture(`dialog-${width}.png`);
      layouts.push({ width, headerOverflow: false, versionVisible: true, dialogFits: true });
      view.updatesUI.close();
    }
    await fs.writeFile(path.join(directory, 'layout.json'), JSON.stringify({ testedAt: new Date().toISOString(), layouts }, null, 2) + '\n');
  } finally { view.updatesUI.close(); browser.setBounds(previous); }
};

module.exports.scopeUI = async function verifyScopeUI(app) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath(), directory = path.join(root, '.scratch/workbench-updates/verification');
  const config = path.join(root, app.vault.configDir, 'plugins/fast-note-sync/data.json');
  const before = await fs.readFile(config);
  const report = { testedAt: new Date().toISOString(), version: JSON.parse(await fs.readFile(path.join(root, 'apps/workbench/manifest.json'), 'utf8')).version, layouts: [] };
  let browser, previous;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    assert.ok(!app.workspace.getLeavesOfType('tannt-workbench').some(({ view: v }) =>
      v.saving || v.fnsUI?.busy || v.captureContent?.value || v.captureTitle?.value || v.captureSources?.value || v.inboxDrafts?.size || v.workUI?.drafts?.size || v.taskUI?.drafts?.size || v.issueUI?.drafts?.size || v.issueUI?.createDraft), '工作台有未保存输入，不能重载。');
    await app.plugins.unloadPlugin('tannt-workbench');
    await app.plugins.loadManifests(); await app.plugins.enablePluginAndSave('tannt-workbench');
    const plugin = app.plugins.plugins['tannt-workbench']; assert.equal(plugin.manifest.version, report.version);
    const view = await plugin.openWorkbench(true), ui = view.updatesUI;
    ui.open(); await ui.refreshScope();
    assert.equal(ui.scopeReport.status, 'configured');
    assert.equal(ui.scopeReport.directories.length, 8);
    assert.equal(ui.scopeStatus.textContent, '已设置 · 已生效');
    assert.equal(ui.scopeSetup.disabled, true);
    ui.scopeEl.open = true; await pause(150);
    await plugin.updates.check();
    const deadline = Date.now() + 40000;
    while ((plugin.updates.busy || ui.scopeChecking) && Date.now() < deadline) await pause(100);
    assert.ok(!plugin.updates.busy && !ui.scopeChecking);
    assert.equal(ui.scopeEl.open, true, '检查版本不应折叠目录说明');
    ui.close(); ui.open(); await ui.refreshScope();
    await pause(150);
    const scopeDeadline = Date.now() + 5000;
    while (ui.scopeChecking && Date.now() < scopeDeadline) await pause(50);
    assert.equal(ui.scopeChecking, false);
    assert.equal(ui.scopeEl.open, true); assert.equal(ui.scopeReport.status, 'configured');
    assert.equal(ui.scopeStatus.textContent, '已设置 · 已生效');
    assert.ok(ui.scopeEl.textContent.includes('apps/workbench/data/'));
    assert.ok(ui.scopeEl.textContent.includes(`${app.vault.configDir}/community-plugins.json`));
    report.status = ui.scopeStatus.textContent;
    report.directories = ui.scopeReport.directories;
    report.expansionPreserved = true;
    report.relatedExclusionsExplained = true;
    browser = view.contentEl.ownerDocument.defaultView.require('electron').remote.getCurrentWindow();
    previous = browser.getBounds();
    for (const width of [1280, 420]) {
      browser.setSize(width, 860); await pause(180);
      const modal = ui.dialog, row = ui.scopeStatus.parentElement;
      assert.ok(modal.scrollWidth <= modal.clientWidth + 1, '弹窗横向溢出');
      assert.ok(ui.scopeReport.directories.every(item => ui.scopeList.textContent.includes(item.path + '/')));
      const button = ui.scopeSetup.getBoundingClientRect(), status = ui.scopeStatus.getBoundingClientRect();
      assert.ok(status.right <= modal.getBoundingClientRect().right, '状态超出弹窗');
      assert.ok(Math.abs(button.y + button.height / 2 - status.y - status.height / 2) < 2, '状态应位于按钮旁');
      row.scrollIntoView({ block: 'nearest' }); await pause(100);
      await fs.writeFile(path.join(directory, `scope-${width}.png`), (await browser.webContents.capturePage()).toPNG());
      report.layouts.push({ width, allDirectoriesListed: true, statusBesideButton: true, horizontalOverflow: false });
    }
    assert.ok((await fs.readFile(config)).equals(before), '只读状态检查不应改动 FNS 配置');
    report.configUnchanged = true; report.success = true;
  } catch (error) { report.success = false; report.error = error.code || 'NATIVE_CHECK_FAILED'; throw error; }
  finally {
    if (previous) browser.setBounds(previous);
    await fs.writeFile(path.join(directory, 'scope-ui.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
};
