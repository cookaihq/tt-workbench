const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');

module.exports=async function(app,view){
  assert.equal(app.vault.getName(),'tannt');
  const plugin=app.plugins.plugins['tannt-workbench'],ui=view.taskUI,root=app.vault.adapter.getBasePath();
  const report={checkedAt:new Date().toISOString(),entry:'实际工作台任务表单、项目往返与原笔记读写',checks:[],samples:[]};
  const check=name=>report.checks.push({name,passed:true});
  const read=p=>fs.readFile(path.join(root,p),'utf8');
  const fields=raw=>plugin.editor.parseYaml(plugin.inbox.getFrontMatterInfo(raw).frontmatter);
  const wait=async fn=>{const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw Error('等待超时');};
  const change=el=>el.dispatchEvent(new view.contentEl.ownerDocument.defaultView.Event('input',{bubbles:true}));
  const submit=async()=>{ui.form.requestSubmit();await wait(()=>!ui.submit.disabled);};
  const controls=()=>{const f=view.bodyEl.querySelector('.tw-task-form');return {form:f,status:f.querySelector('select'),progress:f.querySelectorAll('textarea')[0],next:f.querySelectorAll('textarea')[1],button:f.querySelector('button[type=submit]'),message:f.querySelector('.tw-status')};};
  const process=app.vault.process;
  try{
    view.navigate('@tasks');
    const projects=view.workEntries.filter(i=>i.type==='project'&&i.title.startsWith('工作台验收-'));
    const project=projects.find(i=>i.title==='工作台验收-第二场培训');const projectBefore=await read(project.path);
    for(const [owner,name] of [[project.path,'工作台验收-准备培训案例'],['','工作台验收-研究会话切换'],[projects.find(i=>i.group.includes('第一组')).path,'工作台验收-社群活动任务']]){
      const attempt=await plugin.work.prepareTask({projectPath:owner,name,goal:'功能验收：记录预期结果、实际进度与下一步。'});
      if(!app.vault.getAbstractFileByPath(attempt.path)){
        ui.openCreate(owner);ui.name.value=name;ui.goal.value='功能验收：记录预期结果、实际进度与下一步。';change(ui.name);await submit();assert.equal(ui.message.dataset.kind,'saved');
      }
      assert.equal(fields(await read(attempt.path)).type,'task');report.samples.push(attempt.path);
    }
    check('项目内、独立与多层分组任务通过真实表单建立固定目录和说明');
    const p=report.samples[0];const original=await read(p);
    ui.openCreate(project.path);ui.name.value='工作台验收-准备培训案例';ui.goal.value='不得覆盖原任务';change(ui.name);await submit();assert.equal(ui.message.dataset.errorCode,'PATH_CONFLICT');assert.equal(await read(p),original);ui.dialog.close();
    await assert.rejects(()=>plugin.work.prepareTask({projectPath:'04.资料/不存在/项目说明.md',name:'错误归属',goal:'拒绝'}));
    check('重名与不存在的项目归属被拒绝，不覆盖原记录');
    const file=app.vault.getAbstractFileByPath(p);if(!original.includes('custom_task:'))await app.vault.modify(file,original.replace('\n---\n','\ncustom_task: {keep: true}\n---\n'));
    for(const status of ['not_started','in_progress','paused','completed','cancelled']){
      await view.openNote(p);const c=controls();c.status.value=status;c.progress.value='已完成第一轮案例筛选。\n需要复核来源。';c.next.value='核对引用并准备练习。';change(c.progress);c.form.requestSubmit();await wait(()=>!c.button.disabled);assert.notEqual(c.message.dataset.kind,'error');
      const f=fields(await read(p));assert.equal(f.status,status);assert.equal(f.progress,c.progress.value);assert.equal(f.next_step,c.next.value);assert.equal(f.custom_task.keep,true);
    }
    assert.equal(await read(project.path),projectBefore);assert.ok((await fs.stat(path.dirname(path.join(root,p)))).isDirectory());
    const note=await plugin.reader.read(project.path);await plugin.work.update(note,{status:'completed'});assert.equal(fields(await read(p)).status,'cancelled');
    await plugin.work.update(await plugin.reader.read(project.path),{status:fields(projectBefore).status});
    check('五种状态、进度与下一步写回同一 YAML；项目和任务状态双向独立，终态保留目录');
    await view.openNote(p);const c=controls();c.progress.value='失败后保留的进度';change(c.progress);app.vault.process=async()=>{throw Object.assign(Error('injected'),{code:'EACCES'});};c.form.requestSubmit();await wait(()=>!c.button.disabled);assert.equal(c.message.dataset.errorCode,'WRITE_FAILED');assert.equal(c.progress.value,'失败后保留的进度');app.vault.process=process;
    c.form.requestSubmit();await wait(()=>!c.button.disabled);assert.equal(fields(await read(p)).progress,'失败后保留的进度');
    check('注入不可写错误后保留表单，恢复后能保存同一输入');
    await view.openNote(p);const stale=controls();stale.next.value='发生冲突的下一步';change(stale.next);const external=(await read(p))+'\n原笔记入口追加的任务过程。\n';await app.vault.modify(file,external);stale.form.requestSubmit();await wait(()=>!stale.button.disabled);assert.equal(stale.message.dataset.errorCode,'CONFLICT');assert.equal(await read(p),external);ui.drafts.delete(p);
    check('其他入口修改后旧表单显示冲突，未知属性和正文保留');
    await view.openNote(p);view.noteInfoEl.querySelector('button').click();await wait(()=>view.selectedPath===project.path&&view.bodyEl.textContent.includes('项目任务'));const taskButton=[...view.bodyEl.querySelectorAll('.tw-related-note')].find(b=>b.textContent.includes('准备培训案例'));assert.ok(taskButton);taskButton.click();await wait(()=>view.selectedPath===p&&!!view.bodyEl.querySelector('.tw-task-form'));
    ui.status='cancelled';ui.area='企业培训';ui.group='企业/工作台验收企业';ui.project=project.path;view.refreshList();assert.ok(view.listEl.querySelector(`[data-path="${p}"]`));
    check('项目任务往返与领域、企业、项目、历史状态筛选可用');
    const expected=await read(p),leaf=view.leaf;await app.plugins.unloadPlugin('tannt-workbench');await app.plugins.enablePluginAndSave('tannt-workbench');await leaf.setViewState({type:'tannt-workbench',active:true});view=leaf.view;view.taskUI.status='all';view.navigate('@tasks');await view.openNote(p);assert.equal(await read(p),expected);assert.equal(view.bodyEl.querySelector('.tw-task-form textarea').value,'失败后保留的进度');
    check('插件重载后任务内容与进度恢复');report.passed=true;
  }catch(error){report.passed=false;report.failure=error.stack;}
  finally{app.vault.process=process;if(ui.dialog.open)ui.dialog.close();await fs.writeFile(path.join(root,'docs/workbench/verification/06-native-tasks.json'),JSON.stringify(report,null,2)+'\n');}
  return view;
};
