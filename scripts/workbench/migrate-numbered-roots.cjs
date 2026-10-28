const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { RENAMED_ROOTS, mapPreviousPath } = require('../../apps/workbench/vault-paths.js');

const hash = data => createHash('sha256').update(data).digest('hex');
function rewriteReferences(content) {
  return content
    .replace(/(\[\[)(收件箱|独立任务|知识|资料|领域)(?=\/)/g, (_, prefix, root) => prefix + RENAMED_ROOTS[root])
    .replace(/^(original:\s*["']?)(收件箱|独立任务|知识|资料|领域)(?=\/)/gm, (_, prefix, root) => prefix + RENAMED_ROOTS[root]);
}

// Execute only in the current tannt Obsidian, after preparing the documented
// local backup. Never merge an existing destination or repeat a completed move.
module.exports = async function migrate(app) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const backup = path.join(root, 'apps/workbench/data/root-numbering-20261016');
  const manifest = JSON.parse(await fs.readFile(path.join(backup, 'manifest.json'), 'utf8'));
  const report = { checkedAt: new Date().toISOString(), mapping: RENAMED_ROOTS, moved: [], rewritten: [], existingUnresolved: [] };
  const reportPath = path.join(root, 'docs/workbench/verification/root-numbering-migration.json');
  const leaves = app.workspace.getLeavesOfType('tannt-workbench');
  const states = leaves.map(leaf => ({ leaf, state: leaf.getViewState() }));
  try {
    assert.deepEqual(manifest.roots, RENAMED_ROOTS);
    for (const [old, next] of Object.entries(RENAMED_ROOTS)) {
      const folder = app.vault.getAbstractFileByPath(old);
      assert.ok(folder && Array.isArray(folder.children), `原目录不存在：${old}`);
      assert.equal(await app.vault.adapter.exists(next), false, `目标已存在，停止合并：${next}`);
    }
    for (const { leaf } of states) {
      const v = leaf.view;
      if (!v.contentEl) continue;
      assert.ok(!v.saving && !v.captureContent?.value.trim() && !v.inboxDrafts?.size && !v.workUI?.drafts?.size && !v.taskUI?.drafts?.size, '工作台有未提交内容，暂不重载');
      assert.ok(!v.workUI?.name.value && !v.workUI?.goal.value && !v.taskUI?.name.value && !v.taskUI?.goal.value, '创建表单有未提交内容，暂不重载');
    }
    const p = app.plugins.plugins['tannt-workbench'];
    const beforeNotes = p.reader.list().map(file => file.path);
    const beforeLinks = [];
    const edits = [];
    for (const old of manifest.businessFiles) {
      const data = await fs.readFile(path.join(root, old));
      assert.equal(hash(data), manifest.files[old], `备份后文件已变化：${old}`);
      if (!old.endsWith('.md')) continue;
      const before = data.toString('utf8'), after = rewriteReferences(before);
      if (before !== after) edits.push({ old, next: mapPreviousPath(old), before, after });
      const cache = app.metadataCache.getCache(old);
      for (const link of [...(cache?.links || []), ...(cache?.embeds || []), ...(cache?.frontmatterLinks || [])]) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(link.link)) continue;
        const dest = app.metadataCache.getFirstLinkpathDest(link.link, old);
        if (dest) beforeLinks.push({ source: old, link: link.link, destination: dest.path });
        else report.existingUnresolved.push({ source: old, link: link.link });
      }
    }
    await fs.writeFile(path.join(backup, 'resolved-links-before.json'), JSON.stringify(beforeLinks, null, 2));
    const fns = app.plugins.plugins['fast-note-sync'];
    const rules = JSON.parse(fns.settings.syncExcludeFolders);
    assert.ok(rules.some(rule => rule.pattern === 'apps/workbench/data/'));
    assert.equal(fns.settings.syncExcludeWhitelist, '');
    const oldPattern = '(?:领域/.*/项目/[^/]+/(?:任务/[^/]+/)?tmp/|独立任务/[^/]+/tmp/)';
    const newPattern = '(?:(?:领域|05\\.领域)/.*/项目/[^/]+/(?:任务/[^/]+/)?tmp/|(?:独立任务|02\\.独立任务)/[^/]+/tmp/)';
    assert.equal(rules.filter(rule => rule.pattern === oldPattern).length, 1, 'FNS 排除规则已变化，需重新核对');
    fns.settings.syncExcludeFolders = JSON.stringify(rules.map(rule => rule.pattern === oldPattern ? { ...rule, pattern: newPattern } : rule));
    await fns.saveAndReloadServices();
    report.fnsRules = JSON.parse(fns.settings.syncExcludeFolders);
    const persisted = JSON.parse(await fs.readFile(path.join(root, '.obsidian/plugins/fast-note-sync/data.json'), 'utf8'));
    assert.deepEqual(JSON.parse(persisted.syncExcludeFolders), report.fnsRules);
    await app.plugins.unloadPlugin('tannt-workbench');
    for (const [old, next] of Object.entries(RENAMED_ROOTS)) {
      await app.vault.rename(app.vault.getAbstractFileByPath(old), next);
      report.moved.push({ old, next });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    }
    for (const edit of edits) {
      const file = app.vault.getAbstractFileByPath(edit.next);
      assert.ok(file, `Obsidian 尚未找到改名后的笔记：${edit.next}`);
      await app.vault.process(file, current => {
        assert.ok(current === edit.before || current === edit.after, `笔记同时被修改，停止覆盖：${edit.next}`);
        return edit.after;
      });
      report.rewritten.push(edit.next);
    }
    const until = Date.now() + 10000;
    while (Date.now() < until && beforeLinks.some(link => {
      const dest = app.metadataCache.getFirstLinkpathDest(mapPreviousPath(link.link), mapPreviousPath(link.source));
      return dest?.path !== mapPreviousPath(link.destination);
    })) await new Promise(resolve => setTimeout(resolve, 80));
    for (const link of beforeLinks) {
      const dest = app.metadataCache.getFirstLinkpathDest(mapPreviousPath(link.link), mapPreviousPath(link.source));
      assert.equal(dest?.path, mapPreviousPath(link.destination), `链接未能恢复：${link.source} → ${link.link}`);
    }
    for (const old of manifest.businessFiles) {
      const original = await fs.readFile(path.join(backup, 'files', old));
      const expected = old.endsWith('.md') ? Buffer.from(rewriteReferences(original.toString('utf8'))) : original;
      assert.deepEqual(await fs.readFile(path.join(root, mapPreviousPath(old))), expected, `迁移后内容不符：${old}`);
    }
    assert.equal(hash(await fs.readFile(path.join(root, '.scratch/vault-workspace-v1/spec.md'))), manifest.frozenSpecSHA256);
    await app.plugins.loadManifests();
    await app.plugins.enablePluginAndSave('tannt-workbench');
    for (const { leaf, state } of states) await leaf.setViewState(state);
    const current = app.plugins.plugins['tannt-workbench'];
    assert.equal(current.manifest.version, '0.14.0');
    assert.deepEqual(current.reader.list().map(file => file.path).sort(), beforeNotes.map(mapPreviousPath).sort());
    app.workspace.requestSaveLayout();
    report.businessFilesPreserved = manifest.businessFiles.length;
    report.resolvedLinksPreserved = beforeLinks.length;
    report.businessNoteCount = beforeNotes.length;
    report.specUnchanged = true;
    report.version = current.manifest.version;
    report.passed = true;
  } catch (error) { report.passed = false; report.failure = error.stack; }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  return report;
};
module.exports.rewriteReferences = rewriteReferences;
