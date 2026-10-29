const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function verify(app, view) {
  assert.equal(app.vault.getName(),'tannt');
  const root=app.vault.adapter.getBasePath();
  const out=path.join(root,'docs/workbench/verification/05-native-projects.json');
  const report={checkedAt:new Date().toISOString(),entry:'真实工作台项目创建、筛选、状态与文件回读',checks:[],samples:[]};
  const check=name=>report.checks.push({name,passed:true});
  const wait=async(fn,label)=>{const end=Date.now()+12000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw new Error('等待超时：'+label);};
  const plugin=app.plugins.plugins['tt-workbench'];
  const workUI=view.workUI;
  const source=p=>fs.readFile(path.join(root,p),'utf8');
  const fields=raw=>plugin.editor.parseYaml(plugin.inbox.getFrontMatterInfo(raw).frontmatter);
  const fill=sample=>{
    workUI.openCreate();workUI.area.value=sample.area;workUI.kind.value=sample.mode||'general';workUI.group.value=sample.group||'';workUI.name.value=sample.name;workUI.goal.value=sample.goal;
    workUI.area.dispatchEvent(new view.contentEl.ownerDocument.defaultView.Event('input',{bubbles:true}));
  };
  const submit=async()=>{workUI.createForm.requestSubmit();await wait(()=>!workUI.submit.disabled,'项目创建结束');};
  const projectCases=[
    {area:'企业培训',mode:'enterprise',group:'工作台验收企业',name:'工作台验收-第一场培训'},
    {area:'企业培训',mode:'enterprise',group:'工作台验收企业',name:'工作台验收-第二场培训'},
    {area:'企业培训',mode:'general',name:'工作台验收-通用培训开发'},
    {area:'内容创作',group:'工作台验收方向',name:'工作台验收-同选题多种作品'},
    {area:'社群运营',group:'工作台验收社群/第一组',name:'工作台验收-分组活动'},
    {area:'社群运营',name:'工作台验收-直接归属领域'}
  ].map(s=>({...s,goal:'这是工作台功能验收记录，用于核对项目归属、状态与真实文件保存。'}));
  try {
    view.navigate('@projects');
    fill({...projectCases[0],name:''});workUI.createForm.requestSubmit();assert.equal(workUI.name.validity.valueMissing,true);workUI.dialog.close();
    fill({...projectCases[0],name:'../不能越界'});await submit();assert.equal(workUI.message.dataset.errorCode,'INVALID_NAME');workUI.dialog.close();
    check('实际表单拒绝空名称与越界名称，输入保留');
    for(const sample of projectCases){
      const attempt=plugin.work.prepareProject({...sample,company:sample.group,direction:sample.group});
      if(!app.vault.getAbstractFileByPath(attempt.path)){
        fill(sample);await submit();assert.equal(workUI.message.dataset.kind,'saved');assert.equal(view.selectedPath,attempt.path);
      }
      const raw=await source(attempt.path);assert.equal(fields(raw).type,'project');assert.ok(raw.includes(sample.goal));report.samples.push(attempt.path);
    }
    check('同企业多个项目、通用培训、创作方向和有无中间分组均从真实表单创建');
    const first=report.samples[0];const old=await source(first);
    fill(projectCases[0]);await submit();assert.equal(workUI.message.dataset.errorCode,'PATH_CONFLICT');assert.equal(await source(first),old);workUI.dialog.close();
    check('同位置重名被拒绝，原说明与本次输入保留');
    const file=app.vault.getAbstractFileByPath(first);
    if(!old.includes('custom_project:'))await app.vault.modify(file,old.replace('\n---\n','\ncustom_project: {keep: "未知属性"}\n---\n'));
    for(const status of ['not_started','in_progress','paused','completed','cancelled']){
      await view.openNote(first);const form=view.bodyEl.querySelector('.tw-work-form');const select=form.querySelector('select');const button=form.querySelector('button[type=submit]');
      select.value=status;select.dispatchEvent(new view.contentEl.ownerDocument.defaultView.Event('change',{bubbles:true}));form.requestSubmit();await wait(()=>!button.disabled,'项目状态保存');assert.equal(fields(await source(first)).status,status);assert.equal(JSON.stringify(fields(await source(first)).custom_project),JSON.stringify({keep:'未知属性'}));
    }
    check('五种项目状态写回说明，未知属性和目标正文保留');
    await wait(()=>app.metadataCache.getCache(first)?.frontmatter?.status==='cancelled','状态进入索引');
    view.pageScope='@projects';workUI.statusFilter='current';view.refreshList();assert.ok(![...view.listEl.querySelectorAll('[data-path]')].some(b=>b.dataset.path===first));
    workUI.statusSelect.value='cancelled';workUI.statusSelect.dispatchEvent(new view.contentEl.ownerDocument.defaultView.Event('change',{bubbles:true}));assert.ok([...view.listEl.querySelectorAll('[data-path]')].some(b=>b.dataset.path===first));
    workUI.statusFilter='all';workUI.areaFilter='企业培训';workUI.groupFilter='企业/工作台验收企业';view.refreshList();assert.equal(view.listEl.querySelectorAll('[data-path]').length,2);assert.ok(view.nav.textContent.includes('工作台验收企业'));
    check('历史状态、领域和企业筛选从真实目录发现项目');
    await view.openNote(first);let form=view.bodyEl.querySelector('.tw-work-form');let select=form.querySelector('select');let button=form.querySelector('button[type=submit]');
    select.value='in_progress';select.dispatchEvent(new view.contentEl.ownerDocument.defaultView.Event('change',{bubbles:true}));
    const external=(await source(first))+'\n来自另一编辑入口的项目备注。\n';await app.vault.modify(file,external);form.requestSubmit();await wait(()=>!button.disabled,'冲突结束');
    assert.equal(form.querySelector('.tw-status').dataset.errorCode,'CONFLICT');assert.equal(await source(first),external);assert.equal(select.value,'in_progress');
    check('旧项目表单保存显示冲突，不覆盖其他入口的修改');
    workUI.drafts.delete(first);workUI.statusFilter='all';workUI.areaFilter='';workUI.groupFilter='';view.refreshList();await view.openNote(first);
    for(const p of report.samples){const taskDirectory=path.join(root,path.posix.dirname(p),'任务');try{await fs.access(taskDirectory);throw new Error('创建项目意外产生任务目录');}catch(e){if(e.code!=='ENOENT')throw e;}}
    check('项目可独立使用，创建和变更状态没有建立任务');
    const viewState=view.getState();await view.setState(viewState,{});await view.openNote(first);assert.equal(fields(await source(first)).status,'cancelled');
    check('重新打开项目仍读取已保存状态');
    report.passed=true;
  }catch(error){report.passed=false;report.failure=error.stack;}
  finally{if(workUI.dialog.open)workUI.dialog.close();await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');}
  return report;
};
