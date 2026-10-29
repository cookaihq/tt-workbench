const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ROOTS, BUSINESS_ROOTS, RENAMED_ROOTS } = require('../../apps/workbench/vault-paths.js');

module.exports = async function verify(app) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath(), out = path.join(root, 'docs/workbench/verification');
  const report = { checkedAt: new Date().toISOString(), checks: [], auxiliary: {} };
  const check = name => report.checks.push({ name, passed: true });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { const end = Date.now() + 8000; while (Date.now() < end) { if (await predicate()) return; await pause(80); } throw Error('等待实际应用结果超时'); };
  const p = app.plugins.plugins['tt-workbench'], v = await p.openWorkbench();
  const win = v.contentEl.ownerDocument.defaultView;
  const browser = win.require('electron').remote.getCurrentWindow();
  const resizeErrors = [];
  const onError = e => { if (e.message?.includes('ResizeObserver')) resizeErrors.push(e.message); };
  try {
    assert.equal(p.manifest.version, require('../../apps/workbench/manifest.json').version);
    for (const [old, next] of Object.entries(RENAMED_ROOTS)) {
      assert.equal(await app.vault.adapter.exists(old), false);
      assert.ok(app.vault.getAbstractFileByPath(next)?.children);
    }
    const explorer = app.workspace.getLeavesOfType('file-explorer')[0].view;
    assert.equal(explorer.getState().sortOrder, 'alphabetical');
    const known = new Set([...BUSINESS_ROOTS, 'apps', 'attachments', 'docs', 'scripts', 'skills', 'templates', 'tmp']);
    const order = [...new Set([...explorer.containerEl.querySelectorAll('[data-path]')].map(e => e.getAttribute('data-path')).filter(value => known.has(value)))];
    assert.deepEqual(order.slice(0, BUSINESS_ROOTS.length), BUSINESS_ROOTS); report.explorerOrder = order;
    check('原生文件列表中的业务根目录按编号排列，旧目录不存在');
    v.navigate(ROOTS.inbox);
    await v.openNote(ROOTS.inbox + '/工作台验收-手动收件箱.md');
    assert.equal(v.statusEl.dataset.kind, 'loaded');
    assert.ok(v.bodyEl.querySelector('.tw-edit-panel'));
    v.navigate('@projects'); assert.ok(v.workEntries.filter(i => i.type === 'project').length >= 7);
    v.navigate('@tasks'); assert.ok(v.workEntries.filter(i => i.type === 'task').length >= 7);
    const task = ROOTS.independent + '/工作台验收-研究会话切换/任务说明.md';
    await v.openNote(task);
    v.bodyEl.querySelectorAll('[role=tab]')[2].click();
    await wait(() => [...v.bodyEl.querySelectorAll('textarea')].some(e => e.readOnly && e.value.includes(task)));
    check('原有 Inbox、项目、任务和查询 Prompt 使用新路径');
    v.navigate('');
    const folders = [...v.listEl.querySelectorAll('[data-folder]')].map(e => e.dataset.folder);
    for (const directory of BUSINESS_ROOTS) assert.ok(folders.includes(directory));
    await v.openNote(ROOTS.knowledge + '/笔记/工作台验收分类/工作台验收-输入与推进分开.md');
    const target = ROOTS.resources + '/文章与视频/工作台验收-复用来源.md';
    const link = [...v.bodyEl.querySelectorAll('a.internal-link')].find(e => e.getAttribute('data-href') === target);
    assert.ok(link); link.click(); await wait(() => v.selectedPath === target && v.statusEl.dataset.kind === 'loaded');
    await v.openNote(ROOTS.inbox + '/2026-10/工作台验收-嵌套附件/记录.md');
    v.bodyEl.querySelector('img')?.scrollIntoView({ block: 'center' });
    await wait(() => [...v.bodyEl.querySelectorAll('img')].some(e => e.complete && e.naturalWidth > 0));
    check('业务浏览目录、跨目录笔记链接和迁移后的附件图片可用');
    const title = '工作台验收-目录编号';
    let sample = p.reader.list().find(file => app.metadataCache.getCache(file.path)?.frontmatter?.title === title)?.path;
    if (!sample) {
      v.captureButton.click(); v.captureTitle.value = title;
      v.captureContent.value = '目录编号验收：这条记录应保存到 01.收件箱，不创建旧目录。';
      v.captureSources.value = '';
      v.captureContent.dispatchEvent(new win.Event('input', { bubbles: true }));
      v.captureForm.requestSubmit(); await wait(() => !v.saving);
      assert.equal(v.captureStatus.dataset.kind, 'saved', v.captureStatus.textContent);
      sample = v.selectedPath;
    }
    assert.ok(sample.startsWith(ROOTS.inbox + '/')); report.sample = sample;
    assert.ok((await p.reader.read(sample)).content.includes('目录编号验收'));
    assert.ok(p.work.prepareProject({ area: '企业培训', mode: 'general', name: '目录验证', goal: '仅核对新建路径，不保存项目' }).path.startsWith(ROOTS.areas + '/'));
    assert.ok((await p.work.prepareTask({ name: '目录验证', goal: '仅核对新建路径，不保存任务' })).path.startsWith(ROOTS.independent + '/'));
    check('真实随手记写入 01.收件箱；项目和独立任务创建请求生成新路径');
    const rules = JSON.parse(app.plugins.plugins['fast-note-sync'].settings.syncExcludeFolders);
    const excluded = value => rules.some(r => new RegExp('^' + r.pattern, r.caseSensitive ? '' : 'i').test(value));
    assert.equal(app.plugins.plugins['fast-note-sync'].settings.syncExcludeWhitelist, '');
    for (const value of ['02.独立任务/任务/tmp/解析/缓存.txt', '05.领域/企业培训/企业/客户/项目/培训/tmp/共享/缓存.txt', '05.领域/企业培训/项目/培训/任务/准备/tmp/解析/缓存.txt']) assert.ok(excluded(value));
    for (const value of [sample, task, '05.领域/企业培训/项目/培训/项目说明.md', '05X领域/企业培训/项目/培训/tmp/缓存.txt']) assert.equal(excluded(value), false);
    check('本机 FNS 排除新路径下的项目与任务 tmp，编号中的点按字面匹配');
    browser.webContents.closeDevTools();
    win.addEventListener('error', onError);
    const [width, height] = browser.getSize();
    browser.setSize(width - 80, height); await pause(300); browser.setSize(width, height); await pause(700);
    // Window sizing is an auxiliary observation, independent of directory migration.
    report.auxiliary.resizeObserver = {
      passed: resizeErrors.length === 0,
      errors: resizeErrors.length,
      message: resizeErrors[0] || null,
      issue: '.scratch/vault-workspace-v1/backlog.md'
    };
    v.navigate(ROOTS.inbox); await v.openNote(sample); v.workspaceEl.scrollTop = 0;
    await pause(150);
    await fs.writeFile(path.join(out, 'root-numbering-obsidian.png'), (await browser.webContents.capturePage()).toPNG());
    for (const old of Object.keys(RENAMED_ROOTS)) assert.equal(await app.vault.adapter.exists(old), false);
    report.directoryChecksPassed = report.checks.length === 5 && report.checks.every(item => item.passed);
    report.passed = report.directoryChecksPassed;
  } catch (error) { report.passed = false; report.failure = error.stack; }
  finally { win.removeEventListener('error', onError); await fs.writeFile(path.join(out, 'root-numbering-ui.json'), JSON.stringify(report, null, 2) + '\n'); }
  return report;
};
