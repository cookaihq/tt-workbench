'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const completedChecks=[
 '0.17.0 loaded; five roots and homepage; real projects visible, fixtures hidden',
 'All previously resolved links still reach corresponding targets',
 'Native project form creates without area; task form requires project',
 'Inbox input moves into selected task, preserving source identity',
 'Native optional-use form saves two uses; one update preserves the other and actual version',
 'Native project archive/restore preserves tasks, state and external links; archived task controls read-only',
 'Native resource package archive/restore rewrites artifact and actual-version links'
];
module.exports=async function(app,options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options));assert(Object.keys(options).every(key=>key==='resumeFixtures'),'Unknown verification option');assert(options.resumeFixtures===undefined||typeof options.resumeFixtures==='boolean');
 assert.equal(app.vault.getName(),'tannt');const root=app.vault.adapter.getBasePath();
 const out=path.join(root,'.scratch/information-architecture-workflow/verification');await fs.mkdir(out,{recursive:true});
 let report={startedAt:new Date().toISOString(),checks:[],fixtureProject:'工作台验收-PARA-融合架构'};
 if(options.resumeFixtures){
  const previous=await fs.readFile(path.join(out,'native.json'),'utf8'),prior=JSON.parse(previous);
  assert.equal(prior.passed,false,'Only an incomplete native acceptance can resume');assert.equal(prior.stage,'retain fixtures in archive');assert.equal(prior.fixtureProject,report.fixtureProject);assert.equal(prior.fixtureCreated,true);assert.deepEqual(prior.checks,completedChecks,'All seven native checks must already have passed');assert(prior.migratedLinks?.checked>0);assert.deepEqual(prior.migratedLinks.failures,[]);
  const previousName=`native-before-resume-${Date.now()}-${randomUUID()}.json`;await fs.writeFile(path.join(out,previousName),previous,{flag:'wx'});
  report=prior;report.originalCompletedAt??=prior.completedAt;report.resumeHistory??=[];report.resumeHistory.push({startedAt:new Date().toISOString(),previousReport:path.relative(root,path.join(out,previousName)),previousError:prior.error});
 }
 const save=()=>fs.writeFile(path.join(out,'native.json'),JSON.stringify(report,null,2)+'\n');
 const stage=async name=>{report.stage=name;await save();};
 const wait=async(fn,label)=>{const until=Date.now()+15000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,80))}throw Error('Timeout: '+label)};
 let plugin,v;
 const indexed=async file=>wait(()=>app.vault.getAbstractFileByPath(file)&&app.metadataCache.getCache(file),'indexed '+file);
 const ready=async file=>{await indexed(file);await wait(async()=>{if(v.selectedPath!==file)return false;if(v.statusEl.dataset.kind==='stale')await v.openNote(file);return v.statusEl.dataset.kind==='loaded';},'detail loaded '+file);};
 const submit=async(form,label)=>{
  assert(form,'Missing form: '+label);const button=form.querySelector('[type="submit"]'),message=form.querySelector('.tw-status');assert(button&&!button.disabled,'Disabled submit: '+label);assert(form.checkValidity(),'Invalid form: '+label);
  form.requestSubmit();await wait(()=>!button.disabled,'submit completed '+label);assert.notEqual(message?.dataset.kind,'error',message?.textContent||label);
 };
 const moveByButton=async(label,target,receipt)=>{
  const button=v.bodyEl.querySelector(`[aria-label="${label}"]`);assert(button&&!button.disabled,'Missing action: '+label);const message=button.closest('.tw-edit-panel')?.querySelector('.tw-status');
  v.receiptEl.hidden=true;button.click();await wait(()=>!button.disabled,'operation completed '+label);assert.notEqual(message?.dataset.kind,'error',message?.textContent||label);
  await ready(target);assert(!v.receiptEl.hidden&&v.receiptEl.textContent.includes(receipt),'Missing completion receipt: '+label);
 };
 const moveMaterial=async(directory,target,receipt)=>{
  const input=v.bodyEl.querySelector('[aria-label="整包目录"]');assert(input);input.closest('details').open=true;input.value=directory;input.dispatchEvent(new v.contentEl.ownerDocument.defaultView.Event('input',{bubbles:true}));
  v.receiptEl.hidden=true;await submit(input.closest('form'),'material '+directory);await ready(target);assert(!v.receiptEl.hidden&&v.receiptEl.textContent.includes(receipt),'Missing material completion receipt');
 };
 const assertNoDrafts=()=>{
  for(const leaf of app.workspace.getLeavesOfType('tt-workbench')){
   const view=leaf.view,dirty=[];
   for(const [label,drafts]of [['inbox',view.inboxDrafts],['project',view.workUI?.drafts],['task',view.taskUI?.drafts],['use',view.workUI?.useDrafts],['issue',view.issueUI?.drafts]])if(drafts?.size)dirty.push(label);
   for(const [label,control]of [['capture title',view.captureTitle],['capture text',view.captureContent],['capture sources',view.captureSources],['project name',view.workUI?.name],['project goal',view.workUI?.goal],['task name',view.taskUI?.name],['task goal',view.taskUI?.goal]])if(control?.value?.trim())dirty.push(label);
   if(view.issueUI?.createDraft)dirty.push('new issue');if(view.saving)dirty.push('capture saving');
   if(view.contentEl?.querySelector('.tw-work-form [type="submit"]:disabled,.tw-task-form [type="submit"]:disabled,.tw-use-form [type="submit"]:disabled'))dirty.push('form saving');
   assert.equal(dirty.length,0,'Unsaved work; do not continue: '+dirty.join(', '));
  }
 };
 const waitForFnsStable=async label=>{
  const until=Date.now()+45000;let stableAt=0,lastInventory='',lastState;
  const fixturePath=value=>typeof value==='string'&&(value.includes('/工作台验收-PARA-融合架构/')||value.includes('/验收样例/PARA-融合架构/'));
  while(Date.now()<until){
   const fns=app.plugins.plugins['fast-note-sync'],size=value=>value?.size??value?.length??0;
   assert(fns||!app.plugins.enabledPlugins.has('fast-note-sync'),'FNS is enabled but not loaded');
   const pending=fns?Object.fromEntries(['pendingNoteModifies','pendingUploadHashes','pendingNoteRenames','pendingFileRenames','pendingNoteDeleteAcks','pendingFileDeleteAcks','pendingConfigModifies','pendingConfigDeleteAcks','pendingDeleteNotePaths','pendingDeleteFilePaths','pendingDeleteFolderPaths','pendingDeleteConfigPaths','fileDownloadSessions','ignoredFiles','lastSyncPathDeleted','lastSyncPathRenamed'].map(key=>[key,size(fns[key])])):{};
   if(fns){pending.eventTimers=[...(fns.eventManager?.rawEventTimers?.keys()||[])].filter(fixturePath).length;pending.renames=size(fns.eventManager?.pendingRenamePaths);pending.slots=size(fns.concurrencyLimiter?.activeKeys);pending.queue=size(fns.concurrencyLimiter?.queue);}
   lastState={loaded:Boolean(fns),syncing:Boolean(fns?.isSyncing||fns?.isSyncRequesting),connected:!fns||Boolean(fns.websocket?.isAuth&&fns.websocket?.isOpen&&fns.websocket?.ws?.readyState===1),pending};
   const inventory=app.vault.getAllLoadedFiles().filter(file=>fixturePath(file.path)).map(file=>`${file.path}:${file.stat?.mtime??''}:${file.stat?.size??''}`).sort().join('\n');
   const idle=!lastState.syncing&&lastState.connected&&Object.values(pending).every(count=>count===0)&&!(fns?.websocket?.ws?.bufferedAmount);
   if(!idle||inventory!==lastInventory)stableAt=0;else stableAt||=Date.now();lastInventory=inventory;
   if(stableAt&&Date.now()-stableAt>=Math.max(2500,(fns?.settings?.syncUpdateDelay||0)+750)){report.retentionWaits??=[];report.retentionWaits.push({label,at:new Date().toISOString(),state:lastState});await save();return;}
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  report.retentionWaitFailure={label,state:lastState};throw Error('FNS did not become idle and stable before '+label);
 };
 const retainFixtures=async()=>{
  assert.deepEqual(report.checks,completedChecks);await stage('retain fixtures in archive');await waitForFnsStable('inspect acceptance fixtures');
  const {documentParts}=require(path.join(root,'.obsidian/plugins/tt-workbench/shared.js'));
  const project=`1.项目/${report.fixtureProject}/项目说明.md`,task=`1.项目/${report.fixtureProject}/任务/验证归属与结果/任务说明.md`,resource='3.资源/验收样例/PARA-融合架构/说明.md';
  const archived=project.replace('1.项目/','4.存档/项目/'),archivedTask=task.replace('1.项目/','4.存档/项目/'),archivedResource=resource.replace('3.资源/','4.存档/资源/');
  const current=async(active,stored)=>{const choices=await Promise.all([active,stored].map(async file=>await app.vault.adapter.exists(file)?file:null));const found=choices.filter(Boolean);assert.equal(found.length,1,'Expected exactly one fixture location: '+active);await indexed(found[0]);return found[0];};
  let projectPath=await current(project,archived),resourcePath=await current(resource,archivedResource),taskPath=projectPath===project?task:archivedTask;
  assert.equal(await current(task,archivedTask),taskPath,'Task must remain in its fixture project');
  const notes={project:await plugin.reader.read(projectPath),task:await plugin.reader.read(taskPath),resource:await plugin.reader.read(resourcePath)},fields=Object.fromEntries(Object.entries(notes).map(([key,note])=>[key,documentParts(note.content).fields]));
  assert.equal(fields.project.test_fixture,true);assert.equal(fields.resource.test_fixture,true);assert.equal(fields.project.type,'project');assert.equal(fields.project.title,report.fixtureProject);assert.equal(fields.task.type,'task');assert.equal(fields.task.title,'验证归属与结果');assert.equal(fields.resource.type,'note');
  assert(notes.project.content.includes('验证 PARA 创建、分流、用途与归档恢复。仅为验收样例。'));assert(notes.resource.content.includes('# 验收资源'));assert(notes.resource.content.includes(taskPath));assert.equal(plugin.work.describe(notes.task).projectPath,projectPath);
  const identities={project:{id:fields.project.id},task:{id:fields.task.id},resource:{request_id:fields.resource.request_id,request_hash:fields.resource.request_hash}};
  for(const [kind,identity]of Object.entries(identities)){
   for(const [key,value]of Object.entries(identity))assert(typeof value==='string'&&value.length>0,'Missing fixture identity: '+kind+'.'+key);
   const created=Date.parse(String(fields[kind].created).replace(' ','T')+String(fields[kind].created_timezone));assert(Number.isFinite(created)&&created>=Date.parse(report.startedAt)-1000&&created<=Date.parse(report.originalCompletedAt||report.completedAt||new Date().toISOString())+1000,'Fixture creation is outside the verified run: '+kind);
   const [key,value]=Object.entries(identity)[0],matches=app.vault.getMarkdownFiles().filter(file=>app.metadataCache.getCache(file.path)?.frontmatter?.[key]===value);assert.equal(matches.length,1,'Fixture identity must be unique: '+kind);assert.equal(matches[0].path,notes[kind].path);
  }
  if(report.fixtureIdentities)assert.deepEqual(identities,report.fixtureIdentities,'Fixture identities changed since prior attempt');else report.fixtureIdentities=identities;
  const uses=plugin.work.uses(notes.task);assert.equal(uses.length,2);assert.equal(uses[0].title,'培训用途');assert.equal(uses[0].purpose,'独立更新这一用途');assert.equal(uses[1].title,'文章用途');assert.equal(uses[1].status,'used');assert(uses.every(use=>use.artifact.includes(resourcePath)));assert(uses[1].version.includes(resourcePath));
  report.retentionInitialPaths={project:projectPath,task:taskPath,resource:resourcePath};await save();
  if(resourcePath===resource){await waitForFnsStable('archive fixture resource');await plugin.work.relocateMaterial(await plugin.reader.read(resource),'3.资源/验收样例/PARA-融合架构','archive');resourcePath=archivedResource;}
  await indexed(resourcePath);await waitForFnsStable('archive fixture project');
  if(projectPath===project){await plugin.work.relocate(await plugin.reader.read(project),'archive');projectPath=archived;taskPath=archivedTask;}
  await waitForFnsStable('verify retained fixtures');await indexed(archived);await indexed(archivedTask);await indexed(archivedResource);
  assert.equal(await current(project,archived),archived);assert.equal(await current(task,archivedTask),archivedTask);assert.equal(await current(resource,archivedResource),archivedResource);
  for(const [kind,file]of Object.entries({project:archived,task:archivedTask,resource:archivedResource})){const updated=documentParts((await plugin.reader.read(file)).content).fields;for(const [key,value]of Object.entries(identities[kind]))assert.equal(updated[key],value,'Fixture identity changed during retention');}
  const retainedTask=await plugin.reader.read(archivedTask);assert.equal(plugin.work.describe(retainedTask).projectPath,archived);assert(plugin.work.describe(retainedTask).archived);assert((await plugin.reader.read(archivedResource)).content.includes(archivedTask));assert(plugin.work.uses(retainedTask).every(use=>use.artifact.includes(archivedResource)));assert(plugin.work.uses(retainedTask)[1].version.includes(archivedResource));
  v.showFixtures=false;v.refreshList();await v.openNote('首页.md');report.fixturePaths=[archived,archivedResource];report.version=plugin.manifest.version;report.passed=true;report.stage='complete';delete report.error;delete report.retentionWaitFailure;
 };
 try{
  if(options.resumeFixtures){
   assertNoDrafts();plugin=app.plugins.plugins['tt-workbench'];assert.equal(plugin?.manifest.version,'0.17.0');v=await plugin.openWorkbench();await retainFixtures();
   report.completedAt=new Date().toISOString();await save();return {passed:report.passed,checks:report.checks,resumedFixtures:true,previousReport:report.resumeHistory.at(-1).previousReport};
  }
  await stage('check unsaved work before reload');
  assertNoDrafts();
  if(app.plugins.plugins['tt-workbench'])await app.plugins.unloadPlugin('tt-workbench');
  await app.plugins.loadManifests();await app.plugins.enablePluginAndSave('tt-workbench');plugin=app.plugins.plugins['tt-workbench'];assert.equal(plugin.manifest.version,'0.17.0');v=await plugin.openWorkbench();
  const {documentParts}=require(path.join(root,'.obsidian/plugins/tt-workbench/shared.js'));
  v.showFixtures=false;v.refreshList();assert.equal(v.workEntries.filter(i=>i.type==='project').length,2);assert(!v.workEntries.some(i=>i.test_fixture));assert(v.nav.querySelector('[aria-label="打开库根首页"]'));
  for(const label of ['0.收件箱','1.项目','2.领域','3.资源','4.存档'])assert(v.nav.querySelector(`[aria-label="查看${label}"]`));
  report.checks.push('0.17.0 loaded; five roots and homepage; real projects visible, fixtures hidden');await save();
  await stage('verify migrated links');const before=JSON.parse(await fs.readFile(path.join(root,'apps/workbench/data/para-migration/app-before.json'),'utf8'));const m=JSON.parse(await fs.readFile(path.join(root,'apps/workbench/data/para-migration/manifest.json'),'utf8'));const moves=Object.fromEntries(m.entries.map(e=>[e.from,e.to]));
  const failures=[];for(const link of before.resolvedLinks){const source=moves[link.source]||link.source,target=moves[link.target]||link.target;const cache=app.metadataCache.getCache(source);const actual=[...(cache?.links||[]),...(cache?.embeds||[]),...(cache?.frontmatterLinks||[])].map(l=>app.metadataCache.getFirstLinkpathDest(l.link,source)?.path);if(!actual.includes(target))failures.push({source,oldLink:link.link,target});}
  report.migratedLinks={checked:before.resolvedLinks.length,failures};assert.equal(failures.length,0,'Migrated links missing');report.checks.push('All previously resolved links still reach corresponding targets');await save();
  await stage('create fixture project and task');const name=report.fixtureProject,project=`1.项目/${name}/项目说明.md`;assert(!await app.vault.adapter.exists(project),'Fixture already exists: inspect prior result, do not repeat');
  v.workUI.openCreate();v.workUI.name.value=name;v.workUI.goal.value='验证 PARA 创建、分流、用途与归档恢复。仅为验收样例。';await submit(v.workUI.createForm,'create project');assert.equal(v.workUI.message.dataset.kind,'saved');await ready(project);report.fixtureCreated=true;await save();
  let note=await plugin.reader.read(project);await plugin.editor.update(project,note.content,{fields:{test_fixture:true}});await wait(()=>app.metadataCache.getCache(project)?.frontmatter?.test_fixture===true,'fixture metadata');
  v.showFixtures=true;v.refreshList();await assert.rejects(()=>plugin.work.prepareTask({name:'不允许独立任务',goal:'拒绝无项目'}),e=>e.code==='PROJECT_REQUIRED');
  v.taskUI.openCreate(project);v.taskUI.name.value='验证归属与结果';v.taskUI.goal.value='能够回查来源、分别更新用途并随项目往返归档。';await submit(v.taskUI.form,'create task');assert.equal(v.taskUI.message.dataset.kind,'saved');
  const task=`1.项目/${name}/任务/验证归属与结果/任务说明.md`;assert.equal(plugin.work.describe(await plugin.reader.read(task)).projectPath,project);
  report.checks.push('Native project form creates without area; task form requires project');await save();
  const shared=require(path.join(root,'.obsidian/plugins/tt-workbench/shared.js'));const api=input=>shared.execute(root,{request_id:randomUUID(),privacy:'ordinary',...input});
  await stage('create resource and transfer inbox');const resource=`3.资源/验收样例/PARA-融合架构/说明.md`;await api({action:'create-note',path:resource,content:`# 验收资源\n\n[[${task}]]\n`});await indexed(resource);let res=await plugin.reader.read(resource);await plugin.editor.update(resource,res.content,{fields:{test_fixture:true}});await wait(()=>app.metadataCache.getCache(resource)?.frontmatter?.test_fixture===true,'resource fixture metadata');
  const captured=await api({action:'capture',title:'工作台验收-PARA-分流',content:'本条为验收输入，验证完整分流。'});await wait(()=>app.vault.getAbstractFileByPath(captured.path),'capture');
  const moved=await plugin.links.move(await plugin.reader.read(captured.path),task);assert(!await app.vault.adapter.exists(captured.path));await indexed(moved.sourcePath);assert.equal(documentParts((await plugin.reader.read(moved.sourcePath)).content).fields.type,'note');
  report.checks.push('Inbox input moves into selected task, preserving source identity');await save();
  await stage('create and update two optional uses');await v.openNote(task);await ready(task);
  const addUse=async(title,status,version)=>{
   v.bodyEl.querySelector('.tw-output-uses').open=true;v.bodyEl.querySelector('[aria-label="添加用途记录"]').click();const form=v.bodyEl.querySelector('.tw-use-form');assert(form);
   form.querySelector('[aria-label="用途名称"]').value=title;form.querySelector('[aria-label="成果链接（选填）"]').value=`[[${resource}]]`;
   form.querySelector('[aria-label="实际采用版本或交付位置"]').value=version;form.querySelector('[aria-label="用途状态"]').value=status;
   form.querySelector('[aria-label="用途状态"]').dispatchEvent(new v.contentEl.ownerDocument.defaultView.Event('change',{bubbles:true}));await submit(form,'save use '+title);await wait(async()=>plugin.work.uses(await plugin.reader.read(task)).some(u=>u.title===title),'save use '+title);await ready(task);
  };
  await addUse('培训用途','planned','');await addUse('文章用途','used',`[[${resource}]]`);
  let taskNote=await plugin.reader.read(task),uses=plugin.work.uses(taskNote);assert.equal(uses.length,2);const second=JSON.stringify(uses[1]);await plugin.work.saveUse(taskNote,{...uses[0],purpose:'独立更新这一用途'});uses=plugin.work.uses(await plugin.reader.read(task));assert.equal(JSON.stringify(uses[1]),second);
  report.checks.push('Native optional-use form saves two uses; one update preserves the other and actual version');await save();
  await stage('archive and restore fixture project');await v.openNote(project);await ready(project);const archived=project.replace('1.项目/','4.存档/项目/');await moveByButton('归档项目',archived,'项目及其任务已存档');
  const archivedTask=task.replace('1.项目/','4.存档/项目/');await indexed(archivedTask);const item=plugin.work.describe(await plugin.reader.read(archivedTask));assert(item.archived);assert.equal(item.projectPath,archived);assert.equal(item.status,'not_started');
  await v.openNote(archivedTask);await ready(archivedTask);assert(!v.bodyEl.querySelector('.tw-task-form'));assert((await plugin.reader.read(resource)).content.includes(archivedTask));
  await v.openNote(archived);await ready(archived);await moveByButton('恢复项目',project,'项目已恢复');await indexed(task);assert.equal(plugin.work.describe(await plugin.reader.read(task)).status,'not_started');
  report.checks.push('Native project archive/restore preserves tasks, state and external links; archived task controls read-only');await save();
  await stage('archive and restore fixture resource');await v.openNote(resource);await ready(resource);const archivedResource=resource.replace('3.资源/','4.存档/资源/');await moveMaterial('3.资源/验收样例/PARA-融合架构',archivedResource,'目录及其内容已存档');
  assert(plugin.work.uses(await plugin.reader.read(task)).every(u=>u.artifact.includes(archivedResource)));assert(plugin.work.uses(await plugin.reader.read(task))[1].version.includes(archivedResource));
  await v.openNote(archivedResource);await ready(archivedResource);await moveMaterial('4.存档/资源/验收样例/PARA-融合架构',resource,'目录及其内容已恢复');
  report.checks.push('Native resource package archive/restore rewrites artifact and actual-version links');await save();
  // Retain clearly marked acceptance assets as historical evidence, outside current work.
  await retainFixtures();
 }catch(error){report.passed=false;report.error=error.stack;}
 report.completedAt=new Date().toISOString();await save();return {passed:report.passed,checks:report.checks,error:report.error};
};
