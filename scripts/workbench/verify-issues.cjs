const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

// Runs inside the real tannt Obsidian renderer. All normal writes go through UI forms.
module.exports = async function(app, view, { resume = false, visualOnly = false } = {}) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath(), out = path.join(root, 'docs/workbench/verification/issues');
  let report = { checkedAt: new Date().toISOString(), version: app.plugins.plugins['tt-workbench'].manifest.version, entry: '真实 Obsidian 工作台页面与表单', checks: [], samples: [], status: 'running' };
  await fs.mkdir(out, { recursive: true });
  if (resume) {
    report = JSON.parse(await fs.readFile(path.join(out, 'ui.json'), 'utf8'));
    assert.ok(report.checks.length >= 11 && report.samples.length === 2, '只续跑已通过表单保存与剪贴板检查的报告');
    await fs.writeFile(path.join(out, 'ui-before-resume.json'), JSON.stringify(report, null, 2) + '\n');
    report.resumedAt = new Date().toISOString(); report.status = 'running'; delete report.failure; delete report.passed;
  }
  const flush = () => fs.writeFile(path.join(out, 'ui.json'), JSON.stringify(report, null, 2) + '\n');
  const check = async name => { if (!report.checks.some(c => c.name === name)) report.checks.push({ name, passed: true }); await flush(); };
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (condition, label = '页面操作') => { const end = Date.now() + 15000; while (Date.now() < end) { if (await condition()) return; await pause(50); } throw Error(`${label}超时：${view.contentEl.querySelector('dialog[open] .tw-status')?.textContent || view.statusEl.textContent}`); };
  const control = (parent, label) => { const value = [...parent.querySelectorAll('[aria-label]')].find(el => el.getAttribute('aria-label') === label); assert.ok(value, `找不到控件：${label}`); return value; };
  const fill = (parent, label, value) => { const el = control(parent, label); el.value = value; const Event = el.ownerDocument.defaultView.Event; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return el; };
  const click = (parent, label) => control(parent, label).click();
  const dialog = () => view.contentEl.querySelector('dialog[open]');
  const submit = async (form, allowError = false) => { const button = form.querySelector('[type=submit]'); assert.ok(button); form.requestSubmit(); await wait(() => !button.disabled, '表单保存'); const message = form.querySelector('.tw-status'); if (!allowError) assert.notEqual(message?.dataset.kind, 'error', message?.textContent); return message; };
  const read = relative => app.plugins.plugins['tt-workbench'].issues.read(relative);
  const open = async relative => { await view.openNote(relative); await view.issueUI.refresh(); await wait(() => view.issueUI.note?.path === relative && view.statusEl.dataset.kind === 'loaded', '打开 Issue'); };
  const tab = name => click(view.bodyEl, `Issue ${name}`);
  const win = () => view.contentEl.ownerDocument.defaultView.require('electron').remote.getCurrentWindow();
  const capture = async name => { const rect = view.contentEl.getBoundingClientRect(); await fs.writeFile(path.join(out, name), (await win().webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.floor(rect.width), height: Math.floor(rect.height) })).toPNG()); };
  let injectedStore, savedIO;
  try {
    await flush(); view.navigate('@issues'); await view.issueUI.refresh();
    if (!resume) {
    assert.ok(view.issueUI.catalog.issues.length >= 15);
    assert.ok(view.nav.querySelector('[aria-label="查看开发 Issue"]'));
    const specificationOnly = view.issueUI.catalog.groups.find(g => !g.count && g.spec);
    assert.ok(specificationOnly, '应能发现仅有规格的功能');
    await check('导航发现已有 Issue，并列出只有规格的功能');

    for (const title of ['验收样例：主要操作', '验收样例：前置事项']) {
      click(view.contentEl, '新建开发 Issue'); await wait(() => dialog()?.querySelector('.tw-issue-create-form'));
      const form = dialog().querySelector('form');
      fill(form, '所属功能', '@new'); fill(form, '新功能名称', 'workbench-issues-verification');
      fill(form, 'Issue 标题', `${title} ${Date.now()}`);
      fill(form, 'Issue 描述', '本记录是工作台功能验收样例，不代表业务工作。\n\n## 验收条件\n\n- [ ] 从真实页面保存\n- [ ] 重新读取结果\n');
      fill(form, '新 Issue 标签（逗号分隔）', '验收样例');
      await submit(form); await wait(() => !dialog());
      assert.equal(view.issueUI.note.state, 'open'); report.samples.push(view.selectedPath); await flush();
    }
    const [main, dependency] = report.samples; let primary = await read(main), parent = await read(dependency);
    assert.notEqual(primary.number, parent.number);
    await check('通过真实新建表单创建功能和两份 Issue，编号不重复，文件读回正确');

    await open(main); click(view.bodyEl, '编辑 Issue 标题和描述');
    let form = dialog().querySelector('form');
    fill(form, '编辑 Issue 标题', '验收样例：中文编辑与状态');
    fill(form, '编辑 Issue 描述', '这是明确标注的功能验收样例。\n\n## 验收条件\n\n- [ ] 页面提交后读回\n- [ ] 关闭与重开保存\n');
    click(form, '预览修改后的 Markdown'); await wait(() => form.querySelector('.tw-issue-preview').textContent.includes('页面提交后读回'));
    await submit(form); await wait(() => !dialog());
    assert.equal((await read(main)).title, '验收样例：中文编辑与状态'); assert.equal(view.selectedPath, main);
    await check('正文编辑、Markdown 预览和中文标题保存，文件路径不变');

    view.bodyEl.querySelector('.tw-issue-properties').open = true; form = view.bodyEl.querySelector('.tw-issue-meta-form');
    fill(form, '分诊结果', 'ready-for-agent'); fill(form, 'Issue 优先级', 'high'); fill(form, '标签（逗号分隔）', '验收样例，功能');
    await submit(form); primary = await read(main); assert.equal(primary.triage, 'ready-for-agent'); assert.equal(primary.priority, 'high'); assert.deepEqual(primary.labels, ['验收样例', '功能']);
    await check('分诊、标签与优先级从属性表单写入同一 Issue');

    tab('评论'); form = view.bodyEl.querySelector('.tw-issue-comment-form'); fill(form, '添加评论', '中文评论：已经核对真实文件。'); await submit(form);
    primary = await read(main); const comment = primary.comments[0]; assert.ok(comment);
    click(view.bodyEl, `编辑评论 ${comment.id}`); form = dialog().querySelector('form'); fill(form, '评论内容', '中文评论：已补充验收证据。'); await submit(form); await wait(() => !dialog());
    primary = await read(main); assert.equal(primary.comments[0].body, '中文评论：已补充验收证据。'); assert.equal(primary.comments[0].created, comment.created); assert.ok(primary.comments[0].updated);
    await check('新增与编辑评论，保留创建时间并记录编辑时间');

    tab('正文'); let boxes = [...view.bodyEl.querySelectorAll('input[data-issue-check]')]; assert.equal(boxes.length, 2);
    boxes[0].click(); await wait(async () => (await read(main)).checks[0].done); await wait(() => view.issueUI.note.checks[0].done);
    assert.equal((await read(main)).state, 'open');
    await check('点击真实验收复选框保存，不自动关闭 Issue');

    tab('关联与依赖'); form = view.bodyEl.querySelector('.tw-issue-relations-form');
    control(form, `前置 Issue ${parent.ref}`).click(); fill(form, '关联 Issue、规格或验收材料（每行一个库内路径）', '.scratch/workbench-issues/spec.md\n' + dependency); await submit(form);
    assert.deepEqual((await read(main)).blockedBy, [parent.ref]);
    await open(dependency); tab('关联与依赖'); form = view.bodyEl.querySelector('.tw-issue-relations-form');
    control(form, `前置 Issue ${primary.ref}`).click(); const rejected = await submit(form, true); assert.equal(rejected.dataset.errorCode, 'DEPENDENCY_CYCLE');
    assert.equal(control(form, `前置 Issue ${primary.ref}`).checked, true);
    click(form, '放弃未保存的关联与依赖并重新读取');
    await wait(() => view.bodyEl.querySelector('.tw-issue-relations-form') !== form, '放弃关系草稿');
    assert.equal(view.issueUI.drafts.has(`${dependency}:relations`), false);
    await open(dependency);
    await check('关联与依赖通过页面保存，循环依赖被拒绝且输入保留');

    const close = async (relative, resolution, duplicateOf = '') => {
      await open(relative); click(view.bodyEl, '关闭 Issue'); const f = dialog().querySelector('form');
      fill(f, '关闭结果', resolution); if (duplicateOf) fill(f, '重复的原 Issue（选填）', duplicateOf);
      fill(f, '关闭结论（选填）', '功能验收中的状态转换。'); await submit(f); await wait(() => !dialog());
    };
    const reopen = async relative => { await open(relative); click(view.bodyEl, '重新打开 Issue'); const f = dialog().querySelector('form'); fill(f, '重新打开的原因（选填）', '继续核验页面操作。'); await submit(f); await wait(() => !dialog()); };
    await close(dependency, 'not-planned'); await view.issueUI.refresh(); assert.deepEqual(view.issueUI.catalog.issues.find(i => i.path === main).blocked, [parent.ref]);
    await reopen(dependency); await close(dependency, 'completed'); await view.issueUI.refresh(); assert.deepEqual(view.issueUI.catalog.issues.find(i => i.path === main).blocked, []);
    await close(main, 'not-planned', parent.ref); assert.equal((await read(main)).duplicateOf, parent.ref);
    await reopen(main); assert.equal((await read(main)).duplicateOf, '');
    await check('关闭、重开、重复目标及依赖完成结果准确；不实施不算前置完成');

    await open(main); click(view.bodyEl, '编辑 Issue 标题和描述'); form = dialog().querySelector('form'); fill(form, '编辑 Issue 标题', '冲突时应保留的输入');
    const external = (await read(main)).content.replace('这是明确标注的功能验收样例。', '这是明确标注的功能验收样例。外部编辑新增的过程。');
    await fs.writeFile(path.join(root, main), external);
    const conflict = await submit(form, true); assert.equal(conflict.dataset.errorCode, 'CONFLICT'); assert.equal(control(form, '编辑 Issue 标题').value, '冲突时应保留的输入'); assert.equal((await read(main)).content, external);
    click(form, '放弃本次未保存的内容编辑'); await open(main);
    await check('实际文件被其他入口修改后，陈旧表单拒绝覆盖，保留输入与恢复材料');

    tab('评论'); form = view.bodyEl.querySelector('.tw-issue-comment-form'); fill(form, '添加评论', '保存失败后仍保留的评论');
    injectedStore = app.plugins.plugins['tt-workbench'].issues; savedIO = injectedStore.io;
    injectedStore.io = { ...savedIO, rename: async () => { throw Object.assign(Error('injected EACCES'), { code: 'EACCES' }); } };
    const failed = await submit(form, true); assert.equal(failed.dataset.errorCode, 'WRITE_FAILED'); assert.equal(control(form, '添加评论').value, '保存失败后仍保留的评论');
    injectedStore.io = savedIO; await submit(form); assert.ok((await read(main)).comments.some(c => c.body === '保存失败后仍保留的评论'));
    await check('文件系统拒绝写入的故障注入保留输入，恢复后可从同一表单保存');

    click(view.bodyEl, '复制 Issue 的 Agent 上下文'); await wait(() => dialog()?.querySelector('textarea'));
    const clipboard = view.contentEl.ownerDocument.defaultView.require('electron').clipboard.readText(); assert.ok(clipboard.includes(main) && clipboard.includes('docs/rules/issues.md') && clipboard.includes('外部编辑新增的过程'));
    click(dialog(), '关闭 Agent 上下文'); await check('实际系统剪贴板取得最新 Issue、依赖与规则入口，没有启动 Agent');
    }

    const main = report.samples[0], primary = await read(main);
    if (!visualOnly) {
    const specificationOnly = view.issueUI.catalog.groups.find(g => !g.count && g.spec);
    assert.ok(specificationOnly, '应能发现仅有规格的功能');
    click(view.filterEl, 'Issue 筛选：全部'); fill(view.filterEl, '功能', '');
    fill(view.contentEl, '搜索 Issue 标题、编号、正文或评论', primary.ref);
    await wait(() => view.listEl.querySelectorAll('[data-path]').length === 1 && view.listEl.querySelector(`[data-path="${main}"]`), '完整编号搜索结果');
    fill(view.contentEl, '搜索 Issue 标题、编号、正文或评论', '');
    await wait(() => view.filterEl.querySelector('[aria-label="优先级筛选"]'), '搜索后重绘筛选');
    fill(view.filterEl, '优先级筛选', 'high');
    await wait(() => view.listEl.querySelector(`[data-path="${main}"]`), '优先级筛选');
    fill(view.filterEl, '优先级筛选', 'all'); fill(view.filterEl, '功能', specificationOnly.feature);
    await wait(() => view.listEl.textContent.includes('尚未拆分'), '仅规格功能');
    click(view.listEl, '查看功能规格'); await wait(() => view.issueUI.note?.kind === 'document'); assert.equal(view.issueUI.note.path, specificationOnly.spec);
    await check('搜索、优先级筛选和仅有规格的功能可访问');

    await open(main); tab('正文'); const boxes = [...view.bodyEl.querySelectorAll('input[data-issue-check]')]; if (!primary.checks[1].done) { boxes[1].click(); await wait(async () => (await read(main)).checks[1].done); await wait(() => view.issueUI.note.checks[1].done); }
    if ((await read(main)).state !== 'completed') {
      await open(main); click(view.bodyEl, '关闭 Issue'); const f = dialog().querySelector('form'); fill(f, '关闭结果', 'completed'); fill(f, '关闭结论（选填）', '真实页面表单与保存检查完成。'); await submit(f); await wait(() => !dialog());
    }
    const expected = (await read(main)).content, leaf = view.leaf;
    assert.ok(!app.workspace.getLeavesOfType('tt-workbench').some(l => {
      const v = l.view;
      return v.saving || v.captureContent?.value || v.inboxDrafts?.size || v.workUI?.drafts?.size || v.taskUI?.drafts?.size || v.issueUI?.drafts?.size || v.issueUI?.createDraft;
    }), '重载插件前必须保留并先保存所有窗口的未提交输入');
    await app.plugins.unloadPlugin('tt-workbench'); await app.plugins.loadManifests(); await app.plugins.enablePluginAndSave('tt-workbench');
    await leaf.setViewState({ type: 'tt-workbench', active: true, state: { scope: '@issues', path: main } });
    await app.workspace.revealLeaf(leaf); if (leaf.loadIfDeferred) await leaf.loadIfDeferred(); view = leaf.view;
    await open(main); assert.equal((await read(main)).content, expected); assert.equal(view.issueUI.note.state, 'completed');
    assert.ok(view.scope == null || typeof view.scope.handleKey === 'function', '页面范围不能覆盖 Obsidian 的快捷键对象');
    await check('插件重载后从真实文件恢复标题、状态、讨论和关联');
    }

    const w = win(); const originalSize = w.getSize(); report.originalWindowSize = originalSize;
    assert.ok(!w.isFullScreen() && !w.isMaximized(), '窗口布局验收须在未全屏、未最大化的独立窗口执行');
    w.webContents.closeDevTools(); await pause(200); report.windows = [];
    const keyboardErrors = [];
    const onError = event => { if (/handleKey/.test(event.message)) keyboardErrors.push(event.message); };
    view.contentEl.ownerDocument.defaultView.addEventListener('error', onError);
    view.issueUI.feature = ''; view.issueUI.state = 'all'; view.issueUI.tab = 'description';
    for (const width of [1280, 700, 420]) {
      w.setSize(width, 860); await pause(180); await open(main); await pause(100);
      view.refreshList();
      assert.equal(view.pageTitle.textContent, '推进开发，保留讨论', '重新扫描期间不能显示业务浏览标题');
      assert.ok(view.filterEl.querySelector('[aria-label="优先级筛选"]'), '重新扫描期间保留筛选控件');
      report.windows.push({ requestedWidth: width, windowSize: w.getSize(), viewWidth: view.contentEl.clientWidth });
      assert.ok(Math.abs(w.getSize()[0] - width) <= 2, `请求宽度 ${width} 未实际应用到验收窗口`);
      assert.ok(view.contentEl.clientWidth >= width - 80, `宽度 ${width} 的工作台被其他面板占用`);
      assert.ok(view.contentEl.clientWidth <= width + 2, `宽度 ${width} 的工作台仍占用更大的窗口`);
      assert.ok(view.contentEl.scrollWidth <= view.contentEl.clientWidth + 1, `宽度 ${width} 发生横向溢出`);
      const tabs = [...view.bodyEl.querySelectorAll('[role=tab]')]; tabs[0].focus(); w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' }); await pause(90);
      assert.equal(tabs[1].getAttribute('aria-selected'), 'true'); assert.equal(view.contentEl.ownerDocument.activeElement, tabs[1]);
      tabs[0].click(); await pause(150); assert.equal(tabs[0].getAttribute('aria-selected'), 'true'); await capture(`issues-${width}.png`);
      if (width <= 900) { click(view.noteInfoEl, '返回 Issue 列表'); await pause(150); assert.equal(view.contentEl.dataset.issueMode, 'list'); assert.equal(view.contentEl.ownerDocument.defaultView.getComputedStyle(view.contentEl.querySelector('.tw-detail')).display, 'none'); await capture(`issues-list-${width}.png`); }
    }
    view.contentEl.ownerDocument.defaultView.removeEventListener('error', onError);
    assert.deepEqual(keyboardErrors, [], '实际方向键输入不能触发 Obsidian 快捷键异常');
    report.finalVisual = { checkedAt: new Date().toISOString(), windowId: w.id, refreshTitleAndFilters: true, realKeyboard: true, noHorizontalOverflow: true };
    w.setSize(1280, 860); await pause(160);
    if (!visualOnly) {
    const mainLeaf = app.workspace.getLeavesOfType('tt-workbench').find(l => l.view.contentEl.ownerDocument === app.workspace.containerEl.ownerDocument);
    if (mainLeaf?.loadIfDeferred) await mainLeaf.loadIfDeferred(); const mainView = mainLeaf?.view;
    assert.ok(mainView); mainView.navigate('@issues'); await mainView.openNote(main); assert.ok(mainView.bodyEl.querySelector('.tw-issue-detail'));
    }
    view.navigate('@tasks'); await pause(120); assert.ok(view.pageTitle.textContent.includes('工作'));
    view.navigate('@projects'); await pause(120); assert.ok(view.pageTitle.textContent.includes('项目'));
    view.navigate(''); await pause(120); assert.ok(view.browseUI.active()); assert.ok(!view.reader.list().some(i => i.path.startsWith('.scratch/')));
    await check('宽窄窗口与主窗口实际可用，真实方向键切换标签，原任务、项目和业务浏览入口回归通过');
    await open(main); view.issueUI.state = 'closed'; view.issueUI.feature = 'workbench-issues-verification'; await view.issueUI.refresh();
    report.status = 'complete'; report.passed = true;
  } catch (error) { report.status = 'failed'; report.passed = false; report.failure = error.stack; }
  finally { if (injectedStore && savedIO) injectedStore.io = savedIO; await flush(); }
  return view;
};
