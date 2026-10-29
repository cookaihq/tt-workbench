const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

// Run only in the tannt Obsidian window. This exercises real native views,
// DOM controls, the Markdown editor and vault.read(), not a simulated DOM.
module.exports = async function verify(app) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const filePath = path.join(root, '欢迎.md');
  const original = await fs.readFile(filePath, 'utf8');
  const expectedWelcome = '这是你的新*仓库*。\n\n写点笔记，[[创建链接]]，或者试一试[导入器](https://help.obsidian.md/Plugins/Importer)插件!\n\n当你准备好了，就将该笔记文件删除，使这个仓库为你所用。';
  assert.equal(original, expectedWelcome, '欢迎笔记已变化；请先重新选择合适的非私密验收笔记。');
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  const report = { checkedAt: new Date().toISOString(), vault: 'tannt', entry: 'Obsidian 工作台实际界面', checks: [], originalHash: hash(original) };
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`等待超时：${label}`);
  };
  const check = (name, details) => report.checks.push({ name, passed: true, ...(details ? { details } : {}) });
  let editor;
  const marker = '工作台验收：这是通过 Obsidian 编辑器写入、随后重新读取的文字。';
  const edited = original + '\n\n' + marker + '\n\n- [ ] 只读预览不能改写此项\n';
  let plugin = app.plugins.plugins['tt-workbench'];
  assert.ok(plugin, '插件未加载');
  let view;
  try {
    view = await plugin.openWorkbench();
    const selectWelcome = () => {
      const button = [...view.listEl.querySelectorAll('button')].find(b => b.dataset.path === '欢迎.md');
      assert.ok(button, '真实列表缺少欢迎笔记');
      button.click();
    };
    selectWelcome();
    await wait(() => view.statusEl.dataset.kind === 'loaded', '列表点击后显示笔记');
    assert.ok(view.bodyEl.textContent.includes('这是你的新仓库。'));
    assert.equal(await fs.readFile(filePath, 'utf8'), original);
    check('点击真实笔记列表，详情区显示 Markdown 正文且文件未改写');

    const submit = value => {
      view.pathInput.value = value;
      view.pathInput.closest('form').requestSubmit();
    };
    submit('不存在的工作台验收笔记.md');
    await wait(() => view.statusEl.dataset.errorCode === 'NOT_FOUND', '不存在的笔记错误');
    assert.equal(view.bodyEl.textContent, '');
    check('路径表单打开不存在的文件，显示具体错误并清除旧正文');

    submit('README.md');
    await wait(() => view.statusEl.dataset.errorCode === 'OUT_OF_SCOPE', '业务范围错误');
    check('路径表单拒绝业务范围外的实际文件');

    const read = view.reader.read.bind(view.reader);
    try {
      view.reader.read = async () => { throw Object.assign(new Error('fault injection'), { code: 'PERMISSION' }); };
      // Use the actual error class from the installed module for the same user-facing path.
      const ReaderError = require(path.join(root, '.obsidian/plugins/tt-workbench/note-reader.js')).NoteReadError;
      view.reader.read = async () => { throw new ReaderError('PERMISSION', '当前设备没有读取这份笔记的权限。'); };
      submit('欢迎.md');
      await wait(() => view.statusEl.dataset.errorCode === 'PERMISSION', '读取失败提示');
      assert.ok(view.statusEl.textContent.includes('权限'));
      check('实际表单显示权限错误，未展示虚假成功', '向读取接口注入权限错误；没有更改真实文件权限。');
    } finally { view.reader.read = read; }

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
      view.reader.read = async target => {
        const note = await read(target);
        if (target === '欢迎.md') await gate;
        return note;
      };
      const earlier = view.openNote('欢迎.md');
      await view.openNote('不存在的工作台验收笔记.md');
      release();
      await earlier;
      assert.equal(view.statusEl.dataset.errorCode, 'NOT_FOUND');
      assert.equal(view.bodyEl.textContent, '');
      check('较早读取晚返回时，不覆盖后来选择的文件或错误');
    } finally { release(); view.reader.read = read; }

    await view.openNote('欢迎.md');
    view.editButton.click();
    await wait(() => app.workspace.activeLeaf?.view?.editor && app.workspace.getActiveFile()?.path === '欢迎.md', '打开原笔记编辑器');
    editor = app.workspace.activeLeaf.view.editor;
    assert.equal(editor.getValue(), original);
    editor.setValue(edited);
    await wait(async () => (await fs.readFile(filePath, 'utf8')) === edited, '编辑器写入实际文件');
    await app.workspace.revealLeaf(view.leaf);
    view.refreshButton.click();
    await wait(() => view.statusEl.dataset.kind === 'loaded' && view.bodyEl.textContent.includes(marker), '重新读取编辑后的正文');
    check('在真实 Obsidian 编辑器修改笔记，再从工作台重新读取，显示新内容');

    const checkbox = view.bodyEl.querySelector('input[type="checkbox"]');
    assert.ok(checkbox?.disabled);
    checkbox.click();
    assert.equal(await fs.readFile(filePath, 'utf8'), edited);
    check('笔记预览中的任务复选框不改写原文件');

    const state = view.getState();
    assert.deepEqual(Object.keys(state).sort(), ['path', 'scope']);
    view.leaf.detach();
    view = await plugin.openWorkbench();
    await view.setState(state, {});
    await wait(() => view.statusEl.dataset.kind === 'loaded', '重新打开工作台');
    assert.ok(view.bodyEl.textContent.includes(marker));
    check('关闭并重新打开工作台，只凭笔记路径重新取得实际正文');

    assert.equal(editor.getValue(), edited, '验收期间笔记出现其他修改，停止自动恢复');
    assert.equal(await fs.readFile(filePath, 'utf8'), edited, '验收期间文件出现其他修改，停止自动恢复');
    editor.setValue(original);
    await wait(async () => (await fs.readFile(filePath, 'utf8')) === original, '恢复验收笔记');
    view.refreshButton.click();
    await wait(() => view.statusEl.dataset.kind === 'loaded' && !view.bodyEl.textContent.includes(marker), '重新读取恢复后的笔记');
    report.finalHash = hash(await fs.readFile(filePath, 'utf8'));
    assert.equal(report.finalHash, report.originalHash);
    check('验收结束后原笔记字节内容完全恢复，工作台再次显示原内容');
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = error.message;
  } finally {
    if (editor && editor.getValue() === edited && (await fs.readFile(filePath, 'utf8')) === edited) {
      editor.setValue(original);
      await wait(async () => (await fs.readFile(filePath, 'utf8')) === original, '异常后恢复验收笔记');
      if (view && !view.closed) await view.openNote('欢迎.md');
      report.finalHash = hash(await fs.readFile(filePath, 'utf8'));
    }
    await fs.writeFile(path.join(root, 'docs/workbench/verification/01-native-ui.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(report.passed ? 'TANNT_NATIVE_UI_PASS' : 'TANNT_NATIVE_UI_FAIL');
  return report;
};
