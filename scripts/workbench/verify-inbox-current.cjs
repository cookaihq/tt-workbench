const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');

module.exports=async function(app,view){
  assert.equal(app.vault.getName(),'tannt');
  const root=app.vault.adapter.getBasePath(),plugin=app.plugins.plugins['tt-workbench'];
  const report={checkedAt:new Date().toISOString(),entry:'布局 A 收件箱真实表单回归',checks:[]};
  const check=name=>report.checks.push({name,passed:true});
  const wait=async fn=>{const end=Date.now()+8000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('操作等待超时');};
  const read=p=>fs.readFile(path.join(root,p),'utf8');
  const fields=raw=>plugin.inbox.parseYaml(plugin.inbox.getFrontMatterInfo(raw).frontmatter);
  const sample=plugin.reader.list().find(f=>app.metadataCache.getCache(f.path)?.frontmatter?.title==='工作台验收-补充与整理').path;
  const edit=()=>{const form=view.bodyEl.querySelector('.tw-edit-panel form');return {form,input:form.querySelector('textarea'),save:form.querySelector('button[type=submit]'),message:form.querySelector('.tw-status')};};
  const input=c=>c.input.dispatchEvent(new view.contentEl.ownerDocument.defaultView.Event('input',{bubbles:true}));
  const filter=value=>view.filterEl.querySelector(`[data-filter="${value}"]`).click();
  try{
    report.sample=sample;view.navigate('01.收件箱');await view.openNote(sample);
    const original=await read(sample),initial=fields(original);
    let c=edit();c.input.value='布局 A 验收：补充输入在切换整理状态后仍然保留。';input(c);
    let review=view.bodyEl.querySelector('[data-review-status]');review.click();await wait(()=>!review.disabled);
    assert.equal(fields(await read(sample)).inbox_status,'reviewed');assert.equal(edit().input.value,c.input.value);
    await wait(()=>app.metadataCache.getCache(sample)?.frontmatter?.inbox_status==='reviewed');filter('reviewed');assert.ok(view.listEl.querySelector(`[data-path="${sample}"]`));filter('pending');assert.equal(view.listEl.querySelector(`[data-path="${sample}"]`),null);filter('all');assert.ok(view.listEl.querySelector(`[data-path="${sample}"]`));
    check('三个筛选按钮读取真实状态；标为已整理保留未保存的补充草稿');
    c=edit();c.form.requestSubmit();await wait(()=>!c.save.disabled);assert.notEqual(c.message.dataset.kind,'error');
    assert.ok((await read(sample)).includes(c.input.value));assert.equal(fields(await read(sample)).inbox_status,'reviewed');
    review=view.bodyEl.querySelector('[data-review-status]');review.click();await wait(()=>!review.disabled);assert.equal(fields(await read(sample)).inbox_status,'pending');
    const after=fields(await read(sample));assert.equal(after.created,initial.created);assert.equal(after.created_timezone,initial.created_timezone);assert.equal(JSON.stringify(after.custom_nested),JSON.stringify(initial.custom_nested));
    check('保存补充不改变整理状态，恢复待整理仍保留创建时间与未知属性');
    c=edit();c.input.value='布局 A 冲突验收的拟保存补充。';input(c);
    const external=(await read(sample))+'\n布局 A 验收期间由原笔记入口追加。\n';
    await app.vault.modify(app.vault.getAbstractFileByPath(sample),external);c.form.requestSubmit();await wait(()=>!c.save.disabled);
    assert.equal(c.message.dataset.errorCode,'CONFLICT');assert.equal(await read(sample),external);assert.equal(c.input.value,'布局 A 冲突验收的拟保存补充。');
    check('新版补充表单遇到原文件变化保留输入与冲突副本');
    view.inboxDrafts.delete(sample);view.inboxFilter='pending';view.navigate('01.收件箱');await view.openNote(sample);
    const project=plugin.reader.list().find(f=>f.path.includes('工作台验收-第一场培训/项目说明.md')).path;
    const expectedProject=await read(project),expectedInbox=await read(sample),leaf=view.leaf;
    await app.plugins.unloadPlugin('tt-workbench');await app.plugins.enablePluginAndSave('tt-workbench');
    await leaf.setViewState({type:'tt-workbench',active:true});view=leaf.view;
    await view.openNote(project);assert.equal(await read(project),expectedProject);assert.ok(view.bodyEl.querySelector('.tw-work-form'));
    view.navigate('01.收件箱');await view.openNote(sample);assert.equal(await read(sample),expectedInbox);assert.ok(view.bodyEl.textContent.includes('布局 A 验收期间由原笔记入口追加。'));
    check('卸载并重载插件后，项目状态与收件箱新内容均从真实文件恢复');
    report.passed=true;
  }catch(error){report.passed=false;report.failure=error.stack;}
  await fs.writeFile(path.join(root,'docs/workbench/verification/05-inbox-regression.json'),JSON.stringify(report,null,2)+'\n');
  return view;
};
