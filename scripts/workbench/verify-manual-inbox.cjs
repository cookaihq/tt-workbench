const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

module.exports = async function verify(app) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const out = path.join(root, 'docs/workbench/verification/03-native-manual-inbox.json');
  const report = { checkedAt: new Date().toISOString(), entry: 'Obsidian 核心插入模板命令、原生编辑器、工作台实际列表', checks: [] };
  const check = name => report.checks.push({ name, passed: true });
  const wait = async (predicate, label) => {
    const end = Date.now() + 10000;
    while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 80)); }
    throw new Error('等待超时：' + label);
  };
  const plugin = app.plugins.plugins['tt-workbench'];
  const manualPath = '01.收件箱/工作台验收-手动收件箱.md';
  const originalAttachmentRule = app.vault.getConfig('attachmentFolderPath');
  const manualFile = app.vault.getAbstractFileByPath(manualPath);
  let view;
  const restore = [];
  const read = p => fs.readFile(path.join(root, p), 'utf8');
  const fields = raw => plugin.inbox.parseYaml(plugin.inbox.getFrontMatterInfo(raw).frontmatter);
  const fixtures = {
    '01.收件箱/工作台验收-尚未应用模板.md': '这是一份尚未应用模板的手动记录，工作台仍应能读到。\n',
    '01.收件箱/工作台验收-兼容/说明.md': '这份嵌套 Markdown 的身份需要本人核对。\n',
    '01.收件箱/工作台验收-兼容/源文件位置.md': '源文件位置辅助说明，不是一条新输入。\n',
    '01.收件箱/工作台验收-兼容/attachments/附件说明.md': '附件目录内的 Markdown，不单独计入收件箱。\n'
  };
  try {
    assert.equal(app.internalPlugins.getPluginById('templates').instance.options.folder, 'templates');
    const templateRaw = await read(manualPath);
    const fm = fields(templateRaw);
    assert.equal(fm.type, 'inbox'); assert.equal(fm.inbox_status, 'pending');
    assert.equal(fm.id, undefined); assert.ok(!templateRaw.includes('{{'));
    const instant = require(path.join(root, 'apps/workbench/inbox.js')).creationInstant(fm.created, fm.created_timezone);
    assert.ok(Number.isFinite(instant));
    assert.equal(fm.created_timezone, require(path.join(root, 'apps/workbench/inbox.js')).localCreation(new Date(instant)).created_timezone);
    report.template = { path: manualPath, created: fm.created, created_timezone: fm.created_timezone, variableExpanded: true };
    check('真实核心模板命令展开时间与当时 UTC 偏移，无手动 ID 或条目文件夹');

    // Append through the actual native editor, without clipboard tooling changing
    // its selection or replacing frontmatter. This is UI editor input, not a file rewrite.
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(manualFile);
    const editor = leaf.view.editor;
    const body = '手动录入验收：先新建单文件，再插入模板，最后写下自己的想法。';
    if (!editor.getValue().includes(body)) {
      const last = editor.lineCount() - 1;
      editor.replaceRange(body + '\n', { line: last, ch: editor.getLine(last).length });
    }
    await wait(async () => (await read(manualPath)).includes(body), '原生编辑器保存');
    const savedManual = await read(manualPath);
    assert.equal(fields(savedManual).created, fm.created);
    check('原生编辑器写正文后，已展开模板属性与正文共同保存在真实单文件');

    for (const [p, content] of Object.entries(fixtures)) {
      await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true });
      try { await fs.writeFile(path.join(root, p), content, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST' || await read(p) !== content) throw error; }
    }
    await wait(() => Object.keys(fixtures).every(p => app.metadataCache.getCache(p)), '样例元数据索引');
    view = await plugin.openWorkbench(); view.pageScope = '01.收件箱'; view.refreshList();
    const clickNote = async p => {
      const button = [...view.listEl.querySelectorAll('button[data-path]')].find(b => b.dataset.path === p);
      assert.ok(button, '列表缺少 ' + p); button.click();
      await wait(() => view.selectedPath === p && view.statusEl.dataset.kind === 'loaded', '列表阅读');
    };
    await clickNote(manualPath); assert.ok(view.bodyEl.textContent.includes(body));
    assert.ok(view.inboxEntries.some(e => e.path.endsWith('/记录.md') && e.kind === 'record'));
    assert.equal(await read(manualPath), savedManual);
    check('手动单文件与已有程序嵌套记录共同显示，点击读取不修改原文');
    const incomplete = '01.收件箱/工作台验收-尚未应用模板.md';
    await clickNote(incomplete); assert.match(view.noteInfoEl.textContent, /模板/);
    await clickNote('01.收件箱/工作台验收-兼容/说明.md'); assert.match(view.noteInfoEl.textContent, /身份不明/);
    for (const p of Object.keys(fixtures).filter(p => /源文件位置|附件说明/.test(p))) {
      assert.ok(![...view.listEl.querySelectorAll('button[data-path]')].some(b => b.dataset.path === p));
    }
    check('未应用模板可读，嵌套身份不明文件单独提示，位置说明与附件不计入记录');

    for (const p of [manualPath, incomplete]) {
      const original = await read(p); restore.push([p, original]);
      const raw = `---\ntype: inbox\nid: 03-test-duplicate\ninbox_status: broken\ncreated: "2026-02-30 10:00:00"\ncreated_timezone: "bad"\n---\n${plugin.inbox.describe(original,p).body}`;
      await app.vault.modify(app.vault.getAbstractFileByPath(p), raw);
    }
    await wait(() => [manualPath, incomplete].every(p => app.metadataCache.getCache(p)?.frontmatter?.id === '03-test-duplicate'), '冲突元数据');
    view.refreshList(); await view.openNote(manualPath);
    assert.match(view.noteInfoEl.textContent, /状态缺失或无效/);
    assert.ok(view.noteInfoEl.textContent.includes(incomplete));
    assert.ok(view.bodyEl.textContent.includes(body));
    check('真实无效属性与重复 ID 显示具体问题及对方路径，不合并或丢失正文');
    for (const [p, raw] of restore.splice(0)) await app.vault.modify(app.vault.getAbstractFileByPath(p), raw);
    await wait(() => !app.metadataCache.getCache(manualPath)?.frontmatter?.id, '恢复验收样例属性');
    await app.plugins.unloadPlugin('tt-workbench'); await app.plugins.enablePluginAndSave('tt-workbench');
    view = await app.plugins.plugins['tt-workbench'].openWorkbench(); view.pageScope = '01.收件箱'; view.refreshList();
    await view.openNote(manualPath); assert.ok(view.bodyEl.textContent.includes(body));
    assert.equal(await read(manualPath), savedManual);
    assert.equal(app.vault.getConfig('attachmentFolderPath'), originalAttachmentRule);
    check('插件重载后继续读取原文件，模板配置生效且附件设置未改变');
    report.samples = [manualPath, ...Object.keys(fixtures)];
    report.manualSha256 = crypto.createHash('sha256').update(savedManual).digest('hex');
    report.passed = true;
  } catch (error) { report.passed = false; report.failure = error.stack; }
  finally {
    for (const [p, raw] of restore) await app.vault.modify(app.vault.getAbstractFileByPath(p), raw);
    await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
};
