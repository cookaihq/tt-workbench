const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function(app,v){
  assert.equal(app.vault.getName(),'tannt'); const root=app.vault.adapter.getBasePath(),p=app.plugins.plugins['tannt-workbench'];
  const report={checkedAt:new Date().toISOString(),entry:'Obsidian 原生编辑器、核心 Templates 和真实工作台链接',checks:[],samples:[]};
  const wait=async f=>{const until=Date.now()+8000;while(Date.now()<until){if(await f())return;await new Promise(r=>setTimeout(r,60));}throw Error('等待实际文件超时')};
  const check=name=>report.checks.push({name,passed:true});
  const editLeaf=app.workspace.getLeaf('tab');
  const fill=async(relative,template,sections)=>{
    await p.editor.ensureDirectories(path.posix.dirname(relative));await wait(()=>app.vault.getAbstractFileByPath(path.posix.dirname(relative)));
    let file=app.vault.getAbstractFileByPath(relative);if(file){report.samples.push(relative);return file;}
    file=await app.vault.create(relative,'');await editLeaf.openFile(file,{active:true,state:{mode:'source'}});app.workspace.setActiveLeaf(editLeaf,{focus:true});
    await app.internalPlugins.plugins.templates.instance.insertTemplate(app.vault.getAbstractFileByPath('templates/'+template+'.md'));
    const ed=editLeaf.view.editor;assert.ok(ed.getValue().includes('# '+file.basename));assert.ok(!ed.getValue().includes('{{title}}'));
    let value=ed.getValue();for(const [heading,text]of Object.entries(sections))value=value.replace('## '+heading,'## '+heading+'\n\n'+text);
    ed.setValue(value);await editLeaf.view.save();await wait(async()=>await app.vault.read(file)===value);report.samples.push(relative);return file;
  };
  const prefix='05.领域/内容创作/工作台验收方向',project=prefix+'/项目/工作台验收-同选题多种作品/项目说明.md';
  const source='04.资料/文章与视频/工作台验收-复用来源.md',knowledge='03.知识/笔记/工作台验收分类/工作台验收-输入与推进分开.md',topic='03.知识/专题/工作台验收-工作方法.md',idea=prefix+'/选题/工作台验收-先记录再决定.md';
  const training='05.领域/企业培训/培训内容/工作台验收-提示词基础/培训内容.md',training2='05.领域/企业培训/培训内容/工作台验收-结果核验/培训内容.md';
  const enterprise1='05.领域/企业培训/企业/工作台验收企业/项目/工作台验收-第一场培训';
  const enterprise2='05.领域/企业培训/企业/工作台验收第二企业/项目/工作台验收-共用培训内容';
  try{
    await fill(source,'来源资料说明',{'来源资料与原始内容':'合成验收来源：记录输入之后再决定是否推进。此句不是外部作者引文。','AI 归纳':'验收归纳：保存与启动任务是两个操作。','本人判断与待验证问题':'验收判断：是否减少切换压力仍待本人实际使用验证。'});
    await fill(knowledge,'知识笔记',{'当前认识':'验收观点，尚待验证。','依据与来源':'[['+source+']]'});
    await fill(topic,'专题索引',{'相关知识、资料、研究项目与任务':'[['+knowledge+']]\n\n[['+source+']]'});check('原生模板建立来源、本人分类中的知识及链接型专题，来源/AI归纳/判断分开');
    await fill(idea,'候选选题',{'选题想法':'合成验收：解释先记录再决定。','依据与来源':'[['+knowledge+']]','已决定制作的项目或任务':'[['+project+']]'});
    const old=await p.reader.read(project);if(!old.content.includes(idea))await p.editor.update(project,old.content,{append:'原始选题：[['+idea+']]'});
    const accounts=[['工作台验收公众号','微信公众号','文章'],['工作台验收图文号','小红书','图文'],['工作台验收视频号','视频号','视频']];
    for(const [name,platform,format]of accounts){const account='05.领域/内容创作/账号/'+name+'.md';await fill(account,'发布账号',{'平台与具体账号':platform+'；具体账号：'+name+'（虚构验收账号，未发布）。','用于哪些创作方向':'[[05.领域/内容创作/工作台验收方向/方向说明.md]]'});await fill(path.posix.dirname(project)+'/'+format+'-初稿.md','作品稿件',{'关联项目或任务、作品形式与具体发布账号':'项目：[['+project+']]\n\n形式：'+format+'；账号：[['+account+']]','正文':'验收稿件初稿，未对外发布。'});}
    await fill(prefix+'/方向说明.md','创作方向',{'定位与受众':'虚构验收方向，只用于检查文件关联。'});check('候选选题原位保留并连接同方向项目，多种作品分别引用具体账号');
    for(const [target,text]of [[training,'提示词练习大纲 v1（合成验收）。'],[training2,'结果核验练习（合成验收）。']])await fill(target,'培训内容',{'大纲、案例与练习':text});
    if(!app.vault.getAbstractFileByPath(enterprise2+'/项目说明.md')){v.workUI.openCreate();v.workUI.area.value='企业培训';v.workUI.kind.value='enterprise';v.workUI.group.value='工作台验收第二企业';v.workUI.name.value='工作台验收-共用培训内容';v.workUI.goal.value='验证两家企业引用同一套培训内容';v.workUI.createForm.requestSubmit();await wait(()=>app.vault.getAbstractFileByPath(enterprise2+'/项目说明.md'));}
    for(const parent of [enterprise1,enterprise2]){await fill(parent+'/培训交付记录.md','培训交付记录',{'企业需求与本次目标':'虚构验收需求：使用通用培训内容并保留本次交付。','采用的通用培训内容':'[['+training+']]\n\n[['+training2+']]','本次定制与实际交付稿':'[['+parent+'/实际交付稿.md]]'});await fill(parent+'/实际交付稿.md','培训交付记录',{'企业需求与本次目标':'本次实际交付稿验收快照。提示词练习大纲 v1；本企业定制练习：检查输入和预期结果。'});}
    const before=await Promise.all([enterprise1,enterprise2].map(x=>fs.readFile(path.join(root,x,'实际交付稿.md'),'utf8')));
    const t=await p.reader.read(training);await p.editor.update(training,t.content,{append:'通用内容更新验收：新增检验步骤，既有交付稿不改写。'});
    for(let i=0;i<2;i++)assert.equal(await fs.readFile(path.join(root,[enterprise1,enterprise2][i],'实际交付稿.md'),'utf8'),before[i]);check('一套培训供两家企业引用，项目组合两套内容，通用更新不改历史实际交付稿');
    await app.workspace.revealLeaf(v.leaf);v.pageScope='';await v.openNote(topic);
    const follow=async target=>{const link=[...v.bodyEl.querySelectorAll('a.internal-link')].find(e=>e.getAttribute('data-href')===target);assert.ok(link,target);link.click();await wait(()=>v.selectedPath===target&&v.statusEl.dataset.kind==='loaded');};
    await follow(knowledge);await follow(source);assert.ok(v.bodyEl.textContent.includes('AI 归纳'));
    await v.openNote(idea);await follow(project);await v.openNote(enterprise2+'/培训交付记录.md');await follow(training);check('真实工作台沿专题、知识、来源、选题项目及培训链接逐份阅读');report.passed=true;
  }catch(e){report.passed=false;report.failure=e.stack;}finally{await fs.writeFile(path.join(root,'docs/workbench/verification/11-reuse.json'),JSON.stringify(report,null,2)+'\n');}
  return v;
};
