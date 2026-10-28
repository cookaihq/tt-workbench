const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function(app,v){
  assert.equal(app.vault.getName(),'tannt');
  const root=app.vault.adapter.getBasePath(),plugin=app.plugins.plugins['tannt-workbench'];
  const report={checkedAt:new Date().toISOString(),checks:[]};const check=name=>report.checks.push({name,passed:true});
  const read=p=>fs.readFile(path.join(root,p),'utf8');const fields=raw=>plugin.editor.parseYaml(plugin.inbox.getFrontMatterInfo(raw).frontmatter);
  const wait=async fn=>{const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('等待超时');};
  const change=el=>el.dispatchEvent(new v.contentEl.ownerDocument.defaultView.Event('input',{bubbles:true}));
  const link=async target=>{const f=v.bodyEl.querySelector('.tw-link-panel form'),s=f.querySelector('select'),b=f.querySelector('button[type=submit]');s.value=target;f.requestSubmit();await wait(()=>!b.disabled);return f.querySelector('.tw-status');};
  try{
    let source=plugin.reader.list().find(f=>app.metadataCache.getCache(f.path)?.frontmatter?.title==='工作台验收-Inbox关联')?.path;
    if(!source){v.captureButton.click();v.captureTitle.value='工作台验收-Inbox关联';v.captureContent.value='原始输入与自己的想法：决定推进时才创建任务。';v.captureSources.value='https://example.org/association';change(v.captureContent);v.captureForm.requestSubmit();await wait(()=>!v.saving);assert.equal(v.captureStatus.dataset.kind,'saved');source=v.selectedPath;}
    report.source=source;await v.openNote(source);const original=await read(source),initial=fields(original);
    const targets=v.workEntries.filter(i=>i.type==='project'||i.type==='task').slice(0,2);
    for(const target of targets){await v.openNote(source);assert.notEqual((await link(target.path)).dataset.kind,'error');await v.openNote(source);await link(target.path);}
    assert.equal(new Set(fields(await read(source)).related_work).size,fields(await read(source)).related_work.length);
    const after=fields(await read(source));assert.equal(after.created,initial.created);assert.equal(after.created_timezone,initial.created_timezone);assert.equal(after.inbox_status,initial.inbox_status);assert.equal(JSON.stringify(after.source_urls),JSON.stringify(initial.source_urls));
    check('关联已有对象可重复执行，原文、来源、创建值和整理状态保留');
    const project=v.workEntries.find(i=>i.type==='project'&&i.title==='工作台验收-第二场培训');
    for(const [owner,name] of [['','工作台验收-从Inbox独立推进'],[project.path,'工作台验收-从Inbox准备培训']]){
      await v.openNote(source);const newButton=[...v.bodyEl.querySelectorAll('.tw-link-panel button')].find(b=>b.textContent==='新建任务');newButton.click();const ui=v.taskUI;ui.owner.value=owner;ui.name.value=name;ui.goal.value='从明确保存的输入推进一次工作。';change(ui.name);
      const attempt=await plugin.work.prepareTask({projectPath:owner,name,goal:ui.goal.value});
      if(app.vault.getAbstractFileByPath(attempt.path)){ui.dialog.close();await link(attempt.path);}
      else{ui.form.requestSubmit();await wait(()=>!ui.submit.disabled);assert.equal(ui.message.dataset.kind,'saved');}
      await wait(()=>app.metadataCache.getCache(source)?.frontmatter?.related_work?.includes(`[[${attempt.path}]]`));await v.openNote(attempt.path);assert.ok(v.bodyEl.querySelector('.tw-linked-sources button'));v.bodyEl.querySelector('.tw-linked-sources button').click();await wait(()=>v.selectedPath===source&&!!v.bodyEl.querySelector('.tw-link-panel'));
    }
    check('从Inbox创建独立与项目任务，任务详情可返回原记录');
    await v.openNote(source);const review=v.bodyEl.querySelector('[data-review-status="reviewed"]');if(review){review.click();await wait(()=>!review.disabled);}
    const target=v.workEntries.find(i=>i.type==='task');await v.openNote(source);await link(target.path);assert.equal(fields(await read(source)).inbox_status,'reviewed');check('已整理记录也能关联，关联不重置整理状态');
    // Force the second write to fail after task creation; retry must use the same task.
    await v.openNote(source);[...v.bodyEl.querySelectorAll('.tw-link-panel button')].find(b=>b.textContent==='新建任务').click();const ui=v.taskUI;ui.name.value='工作台验收-关联部分失败-'+Date.now();ui.goal.value='验收部分保存后的同请求重试。';change(ui.name);
    const taskCount=app.vault.getMarkdownFiles().filter(f=>f.basename==='任务说明').length;
    const process=app.vault.process;app.vault.process=async()=>{throw Object.assign(Error('injected'),{code:'EACCES'});};
    try{ui.form.requestSubmit();await wait(()=>!ui.submit.disabled);assert.equal(ui.message.dataset.errorCode,'WRITE_FAILED');assert.ok(ui.message.textContent.includes('任务已保存到'));}finally{app.vault.process=process;}
    const savedPath=ui.attempt.path;assert.ok(await read(savedPath));ui.form.requestSubmit();await wait(()=>!ui.submit.disabled);assert.equal(ui.message.dataset.kind,'saved');assert.ok(fields(await read(source)).related_work.includes(`[[${savedPath}]]`));
    assert.equal(app.vault.getMarkdownFiles().filter(f=>f.basename==='任务说明').length,taskCount+1);check('任务已创建但关联保存失败时报告两处结果；同表单重试不重复创建');
    const leaf=v.leaf;await app.plugins.unloadPlugin('tannt-workbench');await app.plugins.enablePluginAndSave('tannt-workbench');await leaf.setViewState({type:'tannt-workbench',active:true});v=leaf.view;await v.openNote(savedPath);assert.ok(v.bodyEl.querySelector('.tw-linked-sources'));check('插件重载后从单份已保存关联恢复双向回查');report.passed=true;
  }catch(e){report.passed=false;report.failure=e.stack;}finally{if(v.taskUI.dialog.open)v.taskUI.dialog.close();await fs.writeFile(path.join(root,'docs/workbench/verification/07-links.json'),JSON.stringify(report,null,2)+'\n');}return v;
};
