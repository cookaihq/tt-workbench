'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
// Electron replaces Error.prepareStackTrace; native assertions must keep their own messages.
const assert = {
  ok(value, message = '预期条件未满足') { if (!value) throw new Error(message); },
  equal(actual, expected, message = '值核验不匹配') { if (actual !== expected) throw new Error(message); },
  deepEqual(actual, expected, message = '对象核验不匹配') { if (!isDeepStrictEqual(actual, expected)) throw new Error(message); }
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const DEVICE_FIELDS = ['apiToken', 'api', 'vault', 'configSyncEnabled', 'readonlySyncEnabled', 'autoRedirectEnabled', 'wsPreProbeEnabled'];

async function verifyPersistedSettings(app, expected) {
  assert.equal(app.vault.getName(), 'tannt', '必须在 tannt 验收');
  const root = app.vault.adapter.getBasePath();
  const runtime = require(path.join(root, '.obsidian/plugins/tt-workbench/fns-runtime.js')).createFnsRuntime(app);
  const before = expected || { ...(await runtime.inspect()).settings };
  const previous = await runtime.suspend();
  try { assert.equal((await runtime.inspect()).loaded, false, 'FNS 应实际暂停'); }
  finally { await runtime.restore(previous); }
  const after = (await runtime.inspect()).settings;
  for (const field of DEVICE_FIELDS) assert.ok(after?.[field] === before[field], `再次加载后设备字段 ${field} 应保持原值`);
  const report = await app.plugins.plugins['tt-workbench'].fns.inspect();
  assert.equal(report.runtime.loaded, true, '再次加载的四组规则应与磁盘一致');
  assert.equal(report.device.status, 'ready', '再次加载后应继续使用普通文件');
  return { passed: true, deviceFieldsPreserved: DEVICE_FIELDS, runtimeLoaded: true, ordinaryConfig: true };
}

module.exports = async function verifyFns(app, { migrate = false } = {}) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const directory = path.join(root, '.scratch/fns-config-sync/verification/local-config-20261028');
  await fs.mkdir(directory, { recursive: true });
  const report = { startedAt: new Date().toISOString(), platform: process.platform, realCrossDevice: false, remotePublicationPerformed: false, checks: [] };
  const checkpoint = async stage => { report.stage = stage; await fs.writeFile(path.join(directory, 'native.json'), JSON.stringify(report, null, 2) + '\n'); };
  const source = path.join(root, app.vault.configDir, 'plugins/fast-note-sync/data.json');
  const before = JSON.parse(await fs.readFile(source, 'utf8'));
  const noteDrafts = app.workspace.getLeavesOfType('tt-workbench').filter(l => l.view.fnsUI?.notesEditorDraft)
    .map(l => ({ leafId: l.id, draft: structuredClone(l.view.fnsUI.notesEditorDraft),
      open: Boolean(l.view.contentEl.querySelector('dialog[open][aria-label="编辑规则设置说明"]')) }));
  if (noteDrafts.length) {
    const backup = path.join(root, '.system/.workbench-runtime/fns-local-config-validation/notes-input-before.json');
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.writeFile(backup, JSON.stringify(noteDrafts, null, 2), { mode: 0o600 });
    assert.deepEqual(JSON.parse(await fs.readFile(backup, 'utf8')), noteDrafts);
  }
  report.preservedNoteDrafts = noteDrafts.length;
  await checkpoint('检查工作台草稿');
  try {
    assert.ok(!app.workspace.getLeavesOfType('tt-workbench').some(l => {
      const v = l.view;
      return v.saving || v.fnsUI?.busy || v.captureContent?.value || v.inboxDrafts?.size || v.workUI?.drafts?.size || v.taskUI?.drafts?.size || v.issueUI?.drafts?.size || v.issueUI?.createDraft;
    }), '工作台仍有未保存输入，不能重载插件。');
    await checkpoint('重载工作台插件');
    await app.plugins.unloadPlugin('tt-workbench');
    await app.plugins.loadManifests(); await app.plugins.enablePluginAndSave('tt-workbench');
    const plugin = app.plugins.plugins['tt-workbench']; assert.ok(plugin); assert.equal(plugin.manifest.version, '0.21.0');
    await checkpoint('打开工作台独立窗口');
    const view = await plugin.openWorkbench(true);
    await checkpoint('打开 FNS 页面'); view.navigate('@fns');
    const until = Date.now() + 10000;
    while (!view.fnsUI.report && !view.fnsUI.error && Date.now() < until) await pause(100);
    assert.equal(view.fnsUI.error, '');
    const previousApplied = view.fnsUI.report.applied;
    const beforeDeviceSettings = structuredClone(app.plugins.plugins['fast-note-sync']?.settings);
    if (view.fnsUI.report.device.status === 'needs-migration') {
      assert.equal(migrate, true, '旧链接迁回须明确传 migrate: true。');
      await checkpoint('从工作台迁回旧配置链接');
      view.fnsUI.confirmOnboard();
      const modal = view.contentEl.querySelector('dialog[open]');
      assert.ok(modal.textContent.includes('迁回本机配置'));
      [...modal.querySelectorAll('button')].find(b => b.textContent === '确认迁回').click();
      const deadline = Date.now() + 15000;
      while (view.fnsUI.busy && Date.now() < deadline) await pause(100);
      assert.equal(view.fnsUI.busy, false); assert.equal(view.fnsUI.error, '');
      assert.equal((await fs.lstat(source)).isSymbolicLink(), false);
      report.checks.push('通过工作台迁回确认入口将旧链接恢复为普通文件');
    }
    await checkpoint('核验迁回后的配置和运行状态');
    assert.ok(view.fnsUI.report?.local, '迁回后应能读取本机规则');
    assert.deepEqual(view.fnsUI.report.applied, previousApplied, '迁回不改变应用记录');
    for (const field of ['apiToken', 'api', 'vault', 'configSyncEnabled', 'readonlySyncEnabled']) {
      assert.ok(app.plugins.plugins['fast-note-sync']?.settings[field] === beforeDeviceSettings?.[field], `迁回后设备字段 ${field} 不变`);
    }
    assert.ok(view.nav.textContent.includes('系统'), '导航应含系统分组'); assert.equal(view.contentEl.dataset.page, 'fns', '当前页面应为 FNS');
    assert.equal(view.fnsUI.report.device.status, 'ready', '设备配置应为普通文件');
    assert.equal(view.fnsUI.report.runtime.loaded, true, '实际 FNS 运行时规则应与本机磁盘语义一致');
    report.checks.push('正式插件加载、系统菜单、实际设备配置及 FNS 运行时语义检查');
    const win = view.contentEl.ownerDocument.defaultView;
    const electron = win.require('electron').remote;
    const browser = electron.getCurrentWindow();
    browser.webContents.closeDevTools();
    report.windows = [];
    for (const width of [1280, 420]) {
      browser.setSize(width, 860); await pause(250);
      assert.ok(Math.abs(browser.getSize()[0] - width) <= 2);
      assert.ok(view.contentEl.scrollWidth <= view.contentEl.clientWidth + 1, '页面不能横向溢出');
      const tabs = view.fnsUI.panel.querySelectorAll('[role=tab]'); assert.equal(tabs.length, 4);
      tabs[0].focus();
      browser.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); browser.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' }); await pause(100);
      assert.equal(view.fnsUI.field, 'syncExcludeFolders');
      assert.equal(view.fnsUI.panel.querySelector('[role=tab][aria-selected=true]').textContent.startsWith('排除目录'), true);
      assert.equal(win.document.activeElement.getAttribute('aria-selected'), 'true');
      const screenshot = (await browser.webContents.capturePage()).toDataURL().split(',')[1];
      const filename = path.join(directory, `native-fns-${width}.png`);
      await fs.writeFile(filename, screenshot, { encoding: 'base64' });
      assert.equal((await fs.readFile(filename)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '截图必须保存为有效 PNG');
      report.windows.push({ width: browser.getSize()[0], viewWidth: view.contentEl.clientWidth, overflow: false });
      view.fnsUI.panel.querySelectorAll('[role=tab]')[0].click();
    }
    browser.setSize(1280, 860); await pause(150);
    view.fnsUI.checkDialog(); await view.fnsUI.localUI.refresh();
    assert.ok(view.contentEl.querySelector('dialog[open]')?.textContent.includes('本机文件排除'));
    view.contentEl.querySelector('dialog[open]').close();
    for (const scope of ['@tasks', '@projects', '@issues', '']) {
      view.navigate(scope); await pause(150); assert.equal(view.fnsUI.panel.hidden, true); assert.equal(view.searchInput.disabled, false);
    }
    view.navigate('@fns'); await view.fnsUI.refresh();
    report.checks.push('1280/420 宽度、真实方向键切换、本机检查弹窗与业务导航回归');
    const nativeRuntime = require(path.join(root, '.obsidian/plugins/tt-workbench/fns-runtime.js')).createFnsRuntime(app);
    const beforeRuntime = { ...(await nativeRuntime.inspect()).settings };
    await checkpoint('暂停并恢复真实 FNS');
    const previous = await nativeRuntime.suspend();
    try { assert.equal((await nativeRuntime.inspect()).loaded, false); }
    finally { await nativeRuntime.restore(previous); }
    await view.fnsUI.refresh(); assert.equal(view.fnsUI.report.runtime.loaded, true);
    assert.equal((await fs.lstat(source)).isSymbolicLink(), false);
    const { normalize, fingerprint } = require(path.join(root, '.obsidian/plugins/tt-workbench/lib/fns/rules.cjs'));
    assert.equal(fingerprint(normalize(JSON.parse(await fs.readFile(source, 'utf8')))), fingerprint(normalize(before)), '暂停/恢复不能改变四组规则');
    const afterRuntime = (await nativeRuntime.inspect()).settings;
    for (const field of ['apiToken', 'api', 'vault', 'configSyncEnabled', 'readonlySyncEnabled', 'autoRedirectEnabled', 'wsPreProbeEnabled']) assert.ok(afterRuntime[field] === beforeRuntime[field], `设备字段 ${field} 的实际加载值保持原状`);
    await app.plugins.plugins['fast-note-sync'].saveSettings();
    assert.equal((await fs.lstat(source)).isSymbolicLink(), false);
    assert.equal(fingerprint(normalize(JSON.parse(await fs.readFile(source, 'utf8')))), fingerprint(normalize(before)));
    report.persistedSettings = await verifyPersistedSettings(app, beforeRuntime);
    report.checks.push('真实 FNS 暂停及恢复加载，设备设置和四组规则语义不变，FNS 再次保存后配置仍为普通文件');
    await view.fnsUI.refresh();
    assert.equal(view.fnsUI.report.device.status, 'ready', '设备配置应为普通文件');
    assert.equal(view.fnsUI.report.runtime.loaded, true);
    report.configPath = path.relative(root, source); report.workbenchVersion = plugin.manifest.version;
    report.passed = true; report.stage = '完成';
  } catch (error) { report.passed = false; report.failure = error.message; }
  finally {
    const plugin = app.plugins.plugins['tt-workbench'];
    if (plugin) {
      report.restoredNoteDrafts = 0;
      for (const saved of noteDrafts) {
        const leaf = app.workspace.getLeavesOfType('tt-workbench').find(l => l.id === saved.leafId && l.view.fnsUI);
        const view = leaf?.view || await plugin.openWorkbench(true);
        view.fnsUI.notesEditorDraft = structuredClone(saved.draft);
        view.navigate('@fns'); await view.fnsUI.refresh();
        if (saved.open && !view.contentEl.querySelector('dialog[open]')) view.fnsUI.notesDialog();
        assert.deepEqual(view.fnsUI.notesEditorDraft, saved.draft, '说明编辑状态恢复后应一致');
        report.restoredNoteDrafts++;
      }
    }
  }
  report.completedAt = new Date().toISOString();
  await fs.writeFile(path.join(directory, 'native.json'), JSON.stringify(report, null, 2) + '\n');
  return { passed: report.passed, failure: report.failure, checks: report.checks };
};
module.exports.verifyPersistedSettings = verifyPersistedSettings;
