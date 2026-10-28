const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function verify(app) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath();
  const output = path.join(root, 'docs/workbench/verification/04-native-review.json');
  const report = { checkedAt: new Date().toISOString(), entry: '真实 Obsidian 工作台表单、状态筛选和磁盘读回', checks: [] };
  const check = name => report.checks.push({ name, passed: true });
  const wait = async (predicate, label) => { const end=Date.now()+10000; while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,80));}throw new Error('等待超时：'+label); };
  let plugin = app.plugins.plugins['tannt-workbench'];
  let view = await plugin.openWorkbench();
  const fields = raw => plugin.inbox.parseYaml(plugin.inbox.getFrontMatterInfo(raw).frontmatter);
  const read = p => fs.readFile(path.join(root,p),'utf8');
  const process = app.vault.process;
  const title='工作台验收-补充与整理';
  let samplePath;
  const supplement='新增来源 https://example.org/review\n自己的补充判断，仅为本次验收。';
  const controls=()=>{const panel=view.bodyEl.querySelector('.tw-edit-panel');assert.ok(panel);panel.open=true;return {form:panel.querySelector('form'),input:panel.querySelector('textarea'),select:panel.querySelector('select'),save:panel.querySelector('button[type=submit]'),status:panel.querySelector('.tw-status')};};
  const fill=(text,statusValue)=>{const c=controls();c.input.value=text;c.select.value=statusValue;c.input.dispatchEvent(new view.contentEl.ownerDocument.defaultView.Event('input',{bubbles:true}));return c;};
  const submit=async c=>{c.form.requestSubmit();await wait(()=>!c.save.disabled,'修改保存结束');};
  const filter=value=>{view.inboxFilterSelect.value=value;view.inboxFilterSelect.dispatchEvent(new view.contentEl.ownerDocument.defaultView.Event('change',{bubbles:true}));};
  const listed=p=>[...view.listEl.querySelectorAll('[data-path]')].some(b=>b.dataset.path===p);
  try {
    assert.equal(plugin.manifest.version,'0.4.0');
    samplePath=plugin.reader.list().find(f=>app.metadataCache.getCache(f.path)?.frontmatter?.title===title)?.path;
    if(!samplePath){
      view.captureButton.click();view.captureTitle.value=title;view.captureContent.value='原始输入：学习方法值得保留，暂不建立任务。\n';view.captureSources.value='';
      view.captureContent.dispatchEvent(new view.contentEl.ownerDocument.defaultView.Event('input',{bubbles:true}));
      view.captureForm.requestSubmit();await wait(()=>!view.saving,'创建验收记录');
      assert.equal(view.captureStatus.dataset.kind,'saved');samplePath=view.selectedPath;
    }
    report.sample=samplePath;
    const sampleFile=app.vault.getAbstractFileByPath(samplePath);
    let original=await read(samplePath);
    if(!original.includes('custom_nested:')) {
      original=original.replace('\n---\n','\n# 未知属性与注释应保留\ncustom_nested:\n  owner: 本人\n  values: [一, 二]\ncustom_multiline: |\n  这段属性原样保留\n  第二行也保留\n---\n');
      await app.vault.modify(sampleFile,original);
    }
    const initial=fields(original);
    view.pageScope='01.收件箱';view.inboxFilter='pending';view.refreshList();await view.openNote(samplePath);
    if(!original.includes(supplement)){const c=fill(supplement,'pending');await submit(c);assert.notEqual(c.status.dataset.kind,'error');}
    let raw=await read(samplePath);
    assert.ok(raw.includes(supplement));assert.ok(raw.startsWith(original));assert.deepEqual(fields(raw).custom_nested,initial.custom_nested);assert.equal(fields(raw).created,initial.created);assert.equal(fields(raw).created_timezone,initial.created_timezone);assert.equal(fields(raw).inbox_status,'pending');
    check('追加来源与自己的文字分段保留，未知嵌套属性、注释和原创建值未改变');
    await view.openNote(samplePath);await submit(fill('','reviewed'));
    await wait(()=>app.metadataCache.getCache(samplePath)?.frontmatter?.inbox_status==='reviewed','已整理索引');view.refreshList();assert.ok(!listed(samplePath));filter('reviewed');assert.ok(listed(samplePath));filter('all');assert.ok(listed(samplePath));
    await view.openNote(samplePath);await submit(fill('','pending'));await wait(()=>app.metadataCache.getCache(samplePath)?.frontmatter?.inbox_status==='pending','恢复待整理');filter('pending');assert.ok(listed(samplePath));
    check('待整理／已整理／全部可找回与恢复原记录，位置和创建时间不变');

    const failureText='失败恢复验收：本次文字保留在表单。';
    if(!(await read(samplePath)).includes(failureText)) {
      await view.openNote(samplePath);const c=fill(failureText,'pending');
      app.vault.process=async()=>{throw Object.assign(new Error('injected EACCES'),{code:'EACCES'});};await submit(c);
      assert.equal(c.status.dataset.errorCode,'WRITE_FAILED');assert.equal(c.input.value,failureText);app.vault.process=process;
      await submit(c);assert.ok((await read(samplePath)).includes(failureText));
    }
    check('真实表单遇到注入的不可写错误保留输入，恢复后同一表单保存成功');

    await view.openNote(samplePath);const c=fill('旧界面拟追加的内容，必须保留在冲突副本。','reviewed');
    const external=(await read(samplePath))+'\n外部编辑器已写入的另一段内容。\n';
    await app.vault.modify(sampleFile,external);await submit(c);
    assert.equal(c.status.dataset.errorCode,'CONFLICT');assert.equal(await read(samplePath),external);assert.ok(c.input.value.includes('旧界面'));
    const conflictFiles=(await fs.readdir(path.dirname(path.join(root,samplePath)))).filter(n=>n.includes('-保存冲突-'));
    const conflict=conflictFiles.at(-1);assert.ok(conflict);const conflictPath=path.posix.join(path.posix.dirname(samplePath),conflict);
    const conflictRaw=await read(conflictPath);assert.match(conflictRaw,/旧界面拟追加/);assert.match(conflictRaw,/workbench-conflict/);assert.ok(c.status.textContent.includes(conflictPath));report.conflict=conflictPath;
    check('其他编辑器修改后旧表单保存显示冲突，当前原文和拟保存完整版本分别持久保留');
    view.inboxDrafts.delete(samplePath);await view.openNote(samplePath);
    await app.plugins.unloadPlugin('tannt-workbench');await app.plugins.enablePluginAndSave('tannt-workbench');plugin=app.plugins.plugins['tannt-workbench'];view=await plugin.openWorkbench();view.pageScope='01.收件箱';view.refreshList();await view.openNote(samplePath);
    assert.equal(await read(samplePath),external);assert.ok(view.bodyEl.textContent.includes('外部编辑器'));assert.equal(view.inboxFilter,'pending');
    check('重载工作台恢复真实保存结果，冲突副本不作为新收件箱记录');
    const conflictEntry=view.inboxEntries.find(e=>e.path===conflictPath);if(conflictEntry)assert.equal(conflictEntry.kind,'auxiliary');
    report.passed=true;
  } catch(error){report.passed=false;report.failure=error.stack;}
  finally{app.vault.process=process;await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');}
  return report;
};
