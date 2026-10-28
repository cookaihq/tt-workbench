'use strict';
// Run from the tannt Obsidian console after the PARA migration. Restore the
// original FNS state even if native acceptance reports a failure.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function finish(app, options = {}) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const runtime = path.join(root, 'apps/workbench/data/para-migration');
  const before = JSON.parse(await fs.readFile(path.join(runtime, 'app-before.json'), 'utf8'));
  const report = { startedAt: new Date().toISOString() };
  try {
    delete require.cache[require.resolve('./verify-para.cjs')];
    report.native = await require('./verify-para.cjs')(app, options);
  } catch (error) {
    report.native = { passed: false, error: error.stack };
  } finally {
    try {
      if (before.fnsEnabled) await app.plugins.enablePluginAndSave('fast-note-sync');
      else await app.plugins.disablePluginAndSave('fast-note-sync');
      assert.equal(app.plugins.enabledPlugins.has('fast-note-sync'), before.fnsEnabled);
      assert.equal(Boolean(app.plugins.plugins['fast-note-sync']), before.fnsEnabled);
      const configPath = path.join(root, '.obsidian/plugins/fast-note-sync/data.json');
      assert((await fs.lstat(configPath)).isSymbolicLink());
      const disk = JSON.parse(await fs.readFile(configPath, 'utf8'));
      if (before.fnsEnabled) {
        const live = app.plugins.plugins['fast-note-sync'].settings;
        assert.equal(live.syncExcludeFolders, disk.syncExcludeFolders);
        assert.equal(live.syncExcludeWhitelist, '');
        const rules = JSON.parse(live.syncExcludeFolders);
        const excluded = value => rules.some(r => new RegExp('^' + r.pattern, r.caseSensitive ? '' : 'i').test(value));
        for (const p of ['1.项目/验收/tmp/缓存.txt', '1.项目/验收/任务/任务/tmp/缓存.txt', '4.存档/项目/验收/tmp/缓存.txt', '4.存档/项目/验收/任务/任务/tmp/缓存.txt', 'apps/workbench/data/check.txt', 'config/fns-config/check.json']) assert(excluded(p), p);
        for (const p of ['1.项目/验收/项目说明.md', '1.项目/验收/任务/任务/任务说明.md', '4.存档/项目/验收/项目说明.md', '3.资源/知识/知识.md']) assert(!excluded(p), p);
      }
      report.fns = { restored: true, enabled: before.fnsEnabled, symlinkPreserved: true, runtimeExclusionsVerified: before.fnsEnabled, crossDeviceVerified: false };
    } catch (error) {
      report.fns = { restored: false, error: error.stack };
    }
  }
  if (report.native?.passed && report.fns?.restored) {
    try {
    const plugin = app.plugins.plugins['tannt-workbench'];
    const view = await plugin.openWorkbench();
    view.navigate('');
    await view.openNote('首页.md');
    const browser = view.contentEl.ownerDocument.defaultView.require('electron').remote.getCurrentWindow();
    browser.webContents.closeDevTools();
    await fs.writeFile(path.join(root, '.scratch/information-architecture-workflow/verification/homepage.png'), (await browser.webContents.capturePage()).toPNG());
    report.screenshot = { saved: true };
    } catch (error) {
      report.screenshot = { saved: false, error: error.stack };
    }
  }
  report.completedAt = new Date().toISOString();
  report.passed = Boolean(report.native?.passed && report.fns?.restored);
  await fs.writeFile(path.join(runtime, 'app-restored.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
};
