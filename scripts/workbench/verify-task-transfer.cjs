const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');

// Run in the actual tannt Obsidian renderer. Only creates marked verification records.
module.exports = async function(app) {
  assert.equal(app.vault.getName(), 'tannt');
  const root = app.vault.adapter.getBasePath(), prefix = '工作台验收-资料迁移-' + Date.now();
  const report = { checkedAt: new Date().toISOString(), entry: 'Obsidian 真实工作台表单', prefix, checks: [], created: [] };
  const check = name => report.checks.push({name, passed: true});
  const read = p => fs.readFile(path.join(root, p), 'utf8');
  const exists = p => fs.stat(path.join(root, p)).then(() => true, e => { if(e.code === 'ENOENT') return false; throw e; });
  const wait = async (fn, label) => { const until = Date.now()+12000; while(Date.now()<until) { if(await fn()) return; await new Promise(r=>setTimeout(r,80)); } throw Error('等待超时：'+label); };
  let plugin, v, shared;
  const reload = async () => {
    await app.plugins.unloadPlugin('tt-workbench');
    const installed = path.join(root,'.obsidian/plugins/tt-workbench/');
    for(const key of Object.keys(require.cache)) if(key.startsWith(installed)) delete require.cache[key];
    await app.plugins.loadManifests();
    await app.plugins.enablePluginAndSave('tt-workbench');
    plugin=app.plugins.plugins['tt-workbench']; assert.equal(plugin.manifest.version,'0.16.0');
    shared=require(path.join(installed,'shared.js')); assert.equal(typeof shared.TaskTransfer,'function');
    v=await plugin.openWorkbench();
  };
  const fields = raw => shared.documentParts(raw).fields;
  const change = el => el.dispatchEvent(new v.contentEl.ownerDocument.defaultView.Event('input',{bubbles:true}));
  const button = (scope,label) => { const b=[...scope.querySelectorAll('button')].find(b=>b.textContent===label); assert.ok(b,'缺少按钮：'+label); return b; };
  const capture = async (suffix, attachment=true) => {
    v.captureButton.click();v.captureTitle.value=prefix+'-'+suffix;v.captureContent.value='验收专用原始输入：'+suffix;v.captureSources.value='https://example.org/task-materials';change(v.captureContent);
    v.captureForm.requestSubmit();await wait(()=>!v.saving,'保存输入');assert.equal(v.captureStatus.dataset.kind,'saved');
    const source=v.selectedPath;assert.ok(source.startsWith('01.收件箱/'));report.created.push(path.posix.dirname(source));
    let asset;
    if(attachment) {
      const out=await plugin.attachments.save({path:source,expected:await read(source),directory:path.posix.dirname(source)+'/attachments',filename:'研究原文.md',base64:Buffer.from('# 原始研究\n\n验收材料，保持原字节。\n').toString('base64')});
      asset=out.attachmentPath;await wait(()=>app.vault.getAbstractFileByPath(asset),'附件进入实际库');
    }
    await wait(()=>app.metadataCache.getCache(source)?.frontmatter?.type==='inbox','来源元数据');
    await v.openNote(source);return {source,asset,original:await read(source),originalAsset:asset?await read(asset):null};
  };
  const moved = async (input,target) => {
    const task=await read(target), match=/\[记录\.md\]\(<([^>]+)>\)/g;
    const candidates=[...task.matchAll(match)].map(m=>path.posix.normalize(path.posix.join(path.posix.dirname(target),decodeURIComponent(m[1]))));
    let sourcePath;
    for(const p of candidates)if(fields(await read(p)).capture_origin?.path===input.source)sourcePath=p;
    assert.ok(sourcePath,'任务说明未引用迁入记录');await wait(()=>app.vault.getAbstractFileByPath(sourcePath),'迁入记录进入实际库');
    const after=fields(await read(sourcePath)), before=fields(input.original);
    for(const key of ['id','created','created_timezone','inbox_status','source_urls'])assert.deepEqual(after[key],before[key]);
    assert.equal(after.type,'note');assert.equal(await exists(input.source),false);
    if(input.asset) { assert.equal(await read(after.attachments[0]),input.originalAsset); assert.equal(await exists(input.asset),false); }
    await v.openNote(target);button(v.bodyEl,'相关笔记').click();
    const link=[...v.bodyEl.querySelectorAll('.tw-related-note')].find(b=>b.getAttribute('aria-label')==='阅读相关笔记 '+sourcePath);
    assert.ok(link,'任务相关笔记没有迁入记录');link.click();await wait(()=>v.selectedPath===sourcePath&&v.statusEl.dataset.kind==='loaded','任务中打开来源');
    assert.ok(v.bodyEl.textContent.includes('验收专用原始输入'));
    if(input.asset){const a=v.bodyEl.querySelector('a.internal-link');assert.ok(a,'来源没有可打开的附件链接');a.click();await wait(()=>v.selectedPath===after.attachments[0]&&v.statusEl.dataset.kind==='loaded','从来源打开原研究');assert.ok(v.bodyEl.textContent.includes('保持原字节'),'原研究正文尚未显示');}
    return sourcePath;
  };
  try {
    await reload();
    const first=await capture('新建');button(v.bodyEl,'新建任务并迁入资料').click();
    const ui=v.taskUI;ui.owner.value='';ui.name.value=prefix+'-任务';ui.goal.value='验证原输入与专属材料集中保存。';change(ui.name);
    ui.form.requestSubmit();await wait(()=>!ui.submit.disabled,'创建并迁入');assert.equal(ui.message.dataset.kind,'saved',ui.message.textContent);
    const target=v.selectedPath;report.target=target;report.created.push(path.posix.dirname(target));
    report.first=await moved(first,target);check('新建任务表单迁入原记录和附件，身份时间保留，相关笔记与附件实际可读');

    const second=await capture('已有任务');const form=v.bodyEl.querySelector('.tw-transfer-form');form.querySelector('select').value=target;
    form.requestSubmit();await wait(()=>!form.querySelector('button[type=submit]').disabled,'迁入已有任务');assert.notEqual(form.querySelector('.tw-status').dataset.kind,'error',form.textContent);
    report.second=await moved(second,target);check('已有任务表单迁入第二条完整输入，同一任务集中保存多组材料');

    const reference=await capture('共享引用',false);const linkForm=[...v.bodyEl.querySelectorAll('.tw-link-panel form')].find(f=>!f.classList.contains('tw-transfer-form'));
    linkForm.querySelector('select').value=target;linkForm.requestSubmit();await wait(()=>!linkForm.querySelector('button[type=submit]').disabled,'仅添加引用');
    const refFields=fields(await read(reference.source));assert.ok(refFields.related_work.includes(`[[${target}]]`));assert.equal(refFields.inbox_status,'pending');assert.equal(refFields.type,'inbox');
    check('共享资料仅添加引用，原记录保持收件箱位置和整理状态');

    const retry=await capture('部分失败');button(v.bodyEl,'新建任务并迁入资料').click();
    const retryUI=v.taskUI;retryUI.name.value=prefix+'-重试任务';retryUI.goal.value='验证复制失败后不重复建任务。';change(retryUI.name);
    const run=shared.TaskTransfer.prototype.run;let injected=false;
    shared.TaskTransfer.prototype.run=function(input){
      if(input.path!==retry.source)return run.call(this,input);
      const failing=new shared.TaskTransfer(root,{io:{...fs,open:async(p,...args)=>{if(!injected&&p.includes('/资料/')&&p.endsWith('/研究原文.md')){injected=true;throw Object.assign(Error('验收注入复制错误'),{code:'EACCES'});}return fs.open(p,...args);}}});
      return run.call(failing,input);
    };
    let retryTarget;
    try {
      retryUI.form.requestSubmit();await wait(()=>!retryUI.submit.disabled,'部分失败');
      assert.equal(retryUI.message.dataset.kind,'error');assert.ok(retryUI.message.textContent.includes('任务已保存到'));
      retryTarget=retryUI.createdPath;assert.ok(retryTarget);report.created.push(path.posix.dirname(retryTarget));
      assert.ok(await exists(retry.source));assert.ok(await exists(retryTarget));assert.ok(await new shared.TaskTransfer(root).pending(retry.source));
    } finally { shared.TaskTransfer.prototype.run=run; }
    retryUI.form.requestSubmit();await wait(()=>!retryUI.submit.disabled,'重试迁入');assert.equal(retryUI.message.dataset.kind,'saved',retryUI.message.textContent);
    assert.equal(v.selectedPath,retryTarget);await moved(retry,retryTarget);assert.equal((await read(retryTarget)).split('## 迁入资料').length,2);
    check('实际复制失败保留源文件和恢复记录，同一表单重试继续已建任务且不重复资料链接');

    await reload();await v.openNote(target);button(v.bodyEl,'相关笔记').click();assert.ok(v.bodyEl.querySelector('.tw-related-note'));
    await v.openNote(report.first);assert.ok(v.bodyEl.textContent.includes('验收专用原始输入'));
    check('插件重载后从实际文件恢复任务和来源阅读');
    report.passed=true;
  } catch(error) { report.passed=false;report.failure=error.stack; }
  finally {
    if(v?.taskUI.dialog.open)v.taskUI.dialog.close();
    await fs.writeFile(path.join(root,'.scratch/task-materials-together/verification/obsidian.json'),JSON.stringify(report,null,2)+'\n');
  }
  return report;
};

module.exports.verifySavedTask = async function(app) {
  assert.equal(app.vault.getName(),'tannt');
  const root=app.vault.adapter.getBasePath(),file='.scratch/task-materials-together/verification/business-migration.json';
  const record=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
  const plugin=app.plugins.plugins['tt-workbench'],v=await plugin.openWorkbench();
  const wait=async fn=>{const until=Date.now()+10000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw Error('实际研究任务显示超时');};
  const result={checkedAt:new Date().toISOString(),version:plugin.manifest.version,task:record.task,checks:[]};
  const check=name=>result.checks.push({name,passed:true});
  try {
    v.taskUI.status='all';v.taskUI.area=v.taskUI.group=v.taskUI.project='';v.pageScope='@tasks';v.query='';v.searchInput.value='';v.refreshList();
    const item=[...v.listEl.querySelectorAll('button')].find(b=>b.dataset.path===record.task);assert.ok(item,'任务列表缺少真实研究任务');item.click();
    await wait(()=>v.selectedPath===record.task&&v.statusEl.dataset.kind==='loaded');
    assert.ok(v.bodyEl.textContent.includes('尚未安装或试跑工具'),'进度说明缺失');
    check('真实任务列表可打开研究任务，进度与待开始状态可读');
    const related=[...v.bodyEl.querySelectorAll('button')].find(b=>b.textContent==='相关笔记');related.click();
    const sourceButton=[...v.bodyEl.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='阅读相关笔记 '+record.source);assert.ok(sourceButton,'缺少来源入口');sourceButton.click();
    await wait(()=>v.selectedPath===record.source&&v.statusEl.dataset.kind==='loaded');
    assert.ok(v.bodyEl.textContent.includes('要解决的问题'),'原记录未显示');
    const screenshot=v.bodyEl.querySelector('img');assert.ok(screenshot,'原记录未生成截图元素');screenshot.scrollIntoView({block:'center'});
    await wait(()=>[...v.bodyEl.querySelectorAll('img')].some(img=>img.complete&&img.naturalWidth>0));
    check('任务内原记录显示历史正文与真实截图');
    const source=await plugin.reader.read(record.source);
    const properties=plugin.editor.parseYaml(plugin.inbox.getFrontMatterInfo(source.content).frontmatter);
    assert.equal(properties.attachments.length,4);
    for(const asset of record.attachments){const f=app.vault.getAbstractFileByPath(asset.path);assert.ok(f,'Obsidian 尚未发现附件：'+asset.path);}
    const a=[...v.bodyEl.querySelectorAll('a.internal-link')].find(a=>a.textContent==='research.md');assert.ok(a,'研究原文链接缺失');a.click();
    await wait(()=>v.selectedPath.endsWith('/attachments/research.md')&&v.statusEl.dataset.kind==='loaded');
    assert.ok(v.bodyEl.textContent.includes('Skill'),'研究原文没有呈现');check('四份附件均可定位，research.md 链接在工作台中打开原文');
    await v.openNote(record.task);result.passed=true;
  } catch(error) {result.passed=false;result.failure=error.stack;}
  await fs.writeFile(path.join(root,'.scratch/task-materials-together/verification/business-ui.json'),JSON.stringify(result,null,2)+'\n');return result;
};
