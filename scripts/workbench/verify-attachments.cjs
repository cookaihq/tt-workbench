const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http'),{randomUUID}=require('node:crypto'),zlib=require('node:zlib');
module.exports=async function(app,v){
  assert.equal(app.vault.getName(),'tannt');const p=app.plugins.plugins['tannt-workbench'],root=app.vault.adapter.getBasePath();
  const report={checkedAt:new Date().toISOString(),entry:'当前库实际 Obsidian 设置、认证 Agent HTTP 保存与工作台显示',checks:[],attachments:[]};const check=name=>report.checks.push({name,passed:true});
  const wait=async f=>{const until=Date.now()+6000;while(Date.now()<until){if(await f())return;await new Promise(r=>setTimeout(r,60));}throw Error('等待超时')};
  const call=async input=>{const cfg=JSON.parse(await fs.readFile(path.join(root,'apps/workbench/data/agent-bridge.json'),'utf8'));return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:cfg.port,path:'/request',method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cfg.token}},res=>{res.setEncoding('utf8');let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve(JSON.parse(body)));});req.on('error',reject);req.end(JSON.stringify(input));});};
  const add=async(relative,content)=>{await p.editor.ensureDirectories(path.posix.dirname(relative));let file=app.vault.getAbstractFileByPath(relative);if(!file){await p.editor.exclusiveFile(relative,content);await wait(()=>app.vault.getAbstractFileByPath(relative));}return relative;};
  const direct=await add('01.收件箱/工作台验收-直属附件.md','---\ntype: inbox\ninbox_status: pending\ncreated: "2026-10-16 16:00:00"\ncreated_timezone: "-07:00"\n---\n\n# 直属附件验收\n'),nested=await add('01.收件箱/2026-10/工作台验收-嵌套附件/记录.md','---\ntype: inbox\ninbox_status: pending\ncreated: "2026-10-16 16:00:01"\ncreated_timezone: "-07:00"\n---\n\n# 嵌套附件验收\n');
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=';
  const attach=async(target,extra={})=>{const note=await p.reader.read(target);return call({action:'attach',request_id:randomUUID(),privacy:'ordinary',path:target,expected:note.content,filename:'验收图片.png',base64:png,...extra});};
  const original=app.vault.getConfig('attachmentFolderPath');report.originalSetting=original;
  try{
    for(const target of [direct,nested]){const setting=app.vault.getConfig('attachmentFolderPath');const suggested=await app.fileManager.getAvailablePathForAttachment('设置路径核对.png',target);const result=await attach(target);assert.equal(result.ok,true,result.message);assert.equal(path.posix.dirname(result.attachmentPath),path.posix.dirname(suggested));assert.equal(app.vault.getConfig('attachmentFolderPath'),setting);report.attachments.push(result);}
    check('直属和嵌套记录按当前设置保存，目录与 Obsidian 官方路径 API 返回一致');
    const explicit=await attach(nested,{directory:'04.资料/文章与视频/工作台验收附件'});assert.equal(explicit.ok,true,explicit.message);assert.equal(path.posix.dirname(explicit.attachmentPath),'04.资料/文章与视频/工作台验收附件');assert.equal(app.vault.getConfig('attachmentFolderPath'),original);report.attachments.push(explicit);check('Agent 明确指定本次目录生效，默认设置与既有附件保持不变');
    app.vault.setConfig('attachmentFolderPath','./工作台验收附件');const changed=await attach(direct);assert.equal(changed.ok,true,changed.message);assert.equal(path.posix.dirname(changed.attachmentPath),'01.收件箱/工作台验收附件');report.attachments.push(changed);app.vault.setConfig('attachmentFolderPath',original);check('修改实际设置后新保存随之变化，验收后恢复原设置');
    const before=(await p.reader.read(direct)).content,getConfig=app.vault.getConfig;
    try{app.vault.getConfig=function(key){if(key==='attachmentFolderPath')throw Error('合成不可读');return getConfig.call(this,key)};const failed=await attach(direct);assert.equal(failed.code,'ATTACHMENT_SETTING');}finally{app.vault.getConfig=getConfig;}
    const failed=await attach(direct,{directory:direct});assert.equal(failed.ok,false);assert.equal((await p.reader.read(direct)).content,before);check('设置不可读及目标不是目录时不改笔记，不生成虚假的附件链接（前者为故障注入）');
    for(const result of report.attachments)await wait(()=>app.vault.getAbstractFileByPath(result.attachmentPath));
    await v.openNote(nested);v.bodyEl.querySelector('img')?.scrollIntoView({block:'center'});await wait(()=>[...v.bodyEl.querySelectorAll('img')].some(i=>i.complete&&i.naturalWidth>0));assert.ok(v.bodyEl.textContent.includes('嵌套附件验收'));check('工作台直接显示实际本地图片，正文仍可正常阅读');
    const task='02.独立任务/工作台验收-视频位置/任务说明.md';if(!app.vault.getAbstractFileByPath(task)){v.taskUI.openCreate();v.taskUI.name.value='工作台验收-视频位置';v.taskUI.goal.value='验证原视频不可达时仍能阅读转写与位置说明';v.taskUI.form.requestSubmit();await wait(()=>app.vault.getAbstractFileByPath(task));}
    const locations='## 多个等价位置\n\n以下均为不可达的合成验收示例，没有下载或复制原视频。\n\n| 设备或服务 | 位置 |\n| --- | --- |\n| 电脑 A（示例） | 外部资料盘/课程/示例.mp4 |\n| 电脑 B（示例） | 外部资料盘/视频/示例.mp4 |\n| 外置硬盘（示例） | 外置盘/示例.mp4 |\n| 云盘（示例） | 云盘空间/课程/示例.mp4 |\n\n这些位置视为相同内容的替代入口，实际地址由本人提供后填写。';
    const location=await add('02.独立任务/工作台验收-视频位置/源文件位置.md','# 源文件位置\n\n'+locations);
    const course=await add('04.资料/课程/工作台验收课程/源文件位置.md','# 课程源文件位置\n\n'+locations);
    const transcript=await add('02.独立任务/工作台验收-视频位置/完整转写.md','# 合成转写验收文本\n\n此文件模拟已生成的转写，用来核验长期保留位置；没有实际解析视频。\n\n[['+location+']]');
    const screenshot=await attach(transcript,{directory:'02.独立任务/工作台验收-视频位置/关键截图'});assert.equal(screenshot.ok,true,screenshot.message);report.attachments.push(screenshot);
    await v.openNote(location);assert.ok(v.bodyEl.textContent.includes('电脑 B'));await v.openNote(transcript);assert.ok(v.bodyEl.textContent.includes('合成转写'));assert.ok(!screenshot.attachmentPath.includes('/tmp/'));check('课程与视频任务各有多位置记录；无原视频仍可阅读文字，转写及实际选用截图保存在任务内');
    const fns=app.plugins.plugins['fast-note-sync'],rules=JSON.parse(fns.settings.syncExcludeFolders),matches=value=>rules.some(r=>new RegExp('^'+r.pattern,r.caseSensitive?'':'i').test(value));
    assert.equal(fns.settings.syncExcludeWhitelist,'');assert.ok(matches('02.独立任务/工作台验收-视频位置/tmp/解析/缓存.txt'));assert.ok(matches('05.领域/企业培训/企业/某企业/项目/某项目/tmp/共用/缓存.txt'));assert.ok(matches('05.领域/企业培训/项目/某项目/任务/某任务/tmp/解析/缓存.txt'));assert.equal(matches(transcript),false);assert.equal(matches(screenshot.attachmentPath),false);check('本设备 FNS 明确排除 Project/Task 临时路径，保留转写和截图；没有执行清理');
    report.passed=true;
  }catch(e){report.passed=false;report.failure=e.stack;}finally{app.vault.setConfig('attachmentFolderPath',original);await fs.writeFile(path.join(root,'docs/workbench/verification/12-attachments.json'),JSON.stringify(report,null,2)+'\n');}
  return v;
};
