const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Real workbench controls, real files, native YAML parsing. The two non-private
// records remain in Inbox as persistent acceptance examples; nothing is deleted.
module.exports = async function verifyInbox(app) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const output = path.join(root, 'docs/workbench/verification/02-native-inbox.json');
  try { await fs.access(output); throw new Error('已有本项验收记录；先阅读结果，避免重复创建样例。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const report = { checkedAt: new Date().toISOString(), vault: 'tannt', entry: 'Obsidian 工作台实际随手记表单', checks: [], samples: [] };
  const check = (name, details) => report.checks.push({ name, passed: true, ...(details ? { details } : {}) });
  const wait = async (predicate, label) => {
    const until = Date.now() + 10000;
    while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
    throw new Error('等待超时：' + label);
  };
  let plugin = app.plugins.plugins['tt-workbench'];
  assert.equal(plugin.manifest.version, '0.2.0');
  let view = await plugin.openWorkbench();
  const before = plugin.reader.list().filter(file => file.path.startsWith('01.收件箱/')).map(file => file.path);
  const content = '工作台验收：一条输入可以保留多个来源与自己的想法。\n\n  这行开头的两个空格应保留。\n参考 https://example.com/a 与 https://example.org/b\n';
  const sources = 'https://example.com/a\nhttps://example.org/b';
  const fill = (body, title = '', links = '') => {
    view.captureButton.click();
    view.captureTitle.value = title;
    view.captureContent.value = body;
    view.captureSources.value = links;
    view.captureContent.dispatchEvent(new view.contentEl.ownerDocument.defaultView.Event('input', { bubbles: true }));
  };
  const submit = async () => {
    view.captureForm.requestSubmit();
    await wait(() => !view.saving, '表单保存结束');
  };
  const sourceFields = raw => plugin.inbox.parseYaml(plugin.inbox.getFrontMatterInfo(raw).frontmatter);
  const records = async () => plugin.reader.list().filter(file => file.path.startsWith('01.收件箱/'));
  const io = plugin.inbox.io;
  const newId = plugin.inbox.newId;
  try {
    fill(' \n\t');
    await submit();
    assert.equal(view.captureStatus.dataset.errorCode, 'EMPTY_INPUT');
    assert.equal((await records()).length, before.length);
    check('空白输入显示原因，不创建记录');

    fill(content, '', sources);
    plugin.inbox.io = { ...io, mkdir: async () => { throw Object.assign(new Error('injected unwritable target'), { code: 'EACCES' }); } };
    await submit();
    assert.equal(view.captureStatus.dataset.errorCode, 'PERMISSION');
    assert.equal(view.captureContent.value, content);
    assert.equal(view.captureSources.value, sources);
    assert.equal(view.capturePanel.hidden, false);
    assert.equal((await records()).length, before.length);
    check('实际表单遇到不可写错误，保留原始输入与来源且不显示成功', '向目录创建接口注入 EACCES；未更改真实目录权限。');
    plugin.inbox.io = io;

    const originalAttempt = view.captureAttempt;
    view.captureForm.requestSubmit();
    view.captureForm.requestSubmit();
    await wait(() => !view.saving, '权限恢复后的保存与重复提交');
    assert.equal(view.captureStatus.dataset.kind, 'saved');
    assert.equal(view.selectedPath, originalAttempt.path);
    assert.equal(view.statusEl.dataset.kind, 'loaded');
    const firstPath = view.selectedPath;
    const firstRaw = await fs.readFile(path.join(root, firstPath), 'utf8');
    const firstFields = sourceFields(firstRaw);
    report.samples.push({ path: firstPath, sha256: crypto.createHash('sha256').update(firstRaw).digest('hex'), created: firstFields.created, created_timezone: firstFields.created_timezone });
    assert.equal(firstRaw.slice(firstRaw.indexOf('\n---\n\n') + 6), content);
    assert.equal(firstFields.type, 'inbox');
    assert.equal(firstFields.inbox_status, 'pending');
    assert.deepEqual(firstFields.source_urls, sources.split('\n'));
    assert.equal(firstFields.title, content.split('\n')[0]);
    assert.match(firstPath, /^01\.收件箱\/\d{4}-\d{2}\/[\da-f-]+-.+\/记录\.md$/);
    assert.ok(view.bodyEl.textContent.includes('一条输入可以保留多个来源'));
    assert.ok(view.noteInfoEl.textContent.includes(firstFields.created));
    assert.ok(view.noteInfoEl.textContent.includes(firstFields.created_timezone));
    assert.ok(view.receiptEl.textContent.includes('已保存到本机'));
    assert.equal(view.captureContent.value, '');
    await wait(async () => (await records()).length === before.length + 1, '仅增加一份真实记录');
    check('权限恢复后保存到原定路径，真实 Markdown 保留原文、多来源与创建属性');
    check('标题可省略，连续两次提交只创建一份记录，成功后清空表单');

    fill('这次输入不能覆盖已有记录', firstFields.title);
    plugin.inbox.newId = () => firstFields.id;
    await submit();
    assert.equal(view.captureStatus.dataset.errorCode, 'ID_CONFLICT');
    assert.ok(view.captureStatus.textContent.includes(firstPath.replace('/记录.md', '')));
    assert.equal(view.captureContent.value, '这次输入不能覆盖已有记录');
    assert.equal(await fs.readFile(path.join(root, firstPath), 'utf8'), firstRaw);
    assert.equal((await records()).length, before.length + 1);
    plugin.inbox.newId = newId;
    check('真实已有记录的同名与标识碰撞被拒绝，旧文件及待保存输入保留');

    const url = 'https://example.com/workbench-capture-verification';
    fill(url);
    await submit();
    assert.equal(view.captureStatus.dataset.kind, 'saved');
    assert.equal(view.statusEl.dataset.kind, 'loaded');
    const secondPath = view.selectedPath;
    const secondRaw = await fs.readFile(path.join(root, secondPath), 'utf8');
    const secondFields = sourceFields(secondRaw);
    report.samples.push({ path: secondPath, sha256: crypto.createHash('sha256').update(secondRaw).digest('hex'), created: secondFields.created, created_timezone: secondFields.created_timezone });
    assert.equal(secondRaw.slice(secondRaw.indexOf('\n---\n\n') + 6), url);
    assert.equal(secondFields.title, url);
    assert.equal(secondFields.source_urls, undefined);
    assert.ok(view.bodyEl.textContent.includes(url));
    check('仅提交 URL 也保存为可独立阅读的记录，没有编造来源信息');

    await wait(() => [...view.listEl.querySelectorAll('strong')].some(el => el.textContent === secondFields.title), '真实元数据进入笔记列表');
    assert.ok(view.listEl.textContent.includes('当前设备'));
    assert.ok(view.listEl.textContent.includes('待整理'));
    check('基本列表显示真实标题、待整理状态、按当前设备换算的时间与时区');

    await app.plugins.unloadPlugin('tt-workbench');
    await app.plugins.enablePluginAndSave('tt-workbench');
    plugin = app.plugins.plugins['tt-workbench'];
    view = await plugin.openWorkbench();
    view.pageScope = '01.收件箱';
    view.refreshList();
    const button = [...view.listEl.querySelectorAll('button')].find(el => el.dataset.path === firstPath);
    assert.ok(button);
    button.click();
    await wait(() => view.statusEl.dataset.kind === 'loaded', '重载插件后从列表重新读取');
    assert.ok(view.bodyEl.textContent.includes('一条输入可以保留多个来源'));
    assert.ok(view.noteInfoEl.textContent.includes(firstFields.created));
    assert.equal(await fs.readFile(path.join(root, firstPath), 'utf8'), firstRaw);
    assert.equal(await fs.readFile(path.join(root, secondPath), 'utf8'), secondRaw);
    check('重载插件并重开工作台后从实际文件恢复正文与原创建时间');

    for (const directory of ['05.领域', '02.独立任务']) {
      try { await fs.access(path.join(root, directory)); throw new Error('意外创建业务目录：' + directory); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    check('保存没有创建 Project 或 Task 目录');
    report.passed = true;
  } catch (error) { report.passed = false; report.failure = error.message; }
  finally {
    if (plugin?.inbox) { plugin.inbox.io = io; plugin.inbox.newId = newId; }
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(report.passed ? 'TANNT_INBOX_PASS' : 'TANNT_INBOX_FAIL');
  return report;
};
