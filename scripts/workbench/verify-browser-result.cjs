const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function(app,v){
 assert.equal(app.vault.getName(),'tannt');const root=app.vault.adapter.getBasePath(),p=app.plugins.plugins['tt-workbench'];const selected=JSON.parse(await fs.readFile(path.join(root,'docs/workbench/verification/09-browser-selection.json'),'utf8'));
 const report={checkedAt:new Date().toISOString(),browser:'Google Chrome 155.0.8059.82，独立验收用户目录',entry:'实际网页选区/URL → 已生成的书签脚本 → 浏览器打开 Obsidian → 工作台保存弹窗',checks:[],notes:[]};
 const check=name=>report.checks.push({name,passed:true});try{
  const matches=[];for(const f of p.reader.list().filter(f=>f.path.startsWith('01.收件箱/'))){const note=await p.reader.read(f.path),m=p.inbox.describe(note.content,note.path);if(/capture_entry: "browser"/.test(note.content)&&m?.sources.includes(selected.source)){matches.push({note,m});report.notes.push(note.path);}}
  const copies=matches.filter(x=>x.m.body.trim()===selected.text);assert.ok(copies.length>=2);assert.notEqual(copies[0].note.path,copies[1].note.path);const url=matches.find(x=>x.m.body.trim()===selected.source);assert.ok(url);check('真实网页选区逐字保留；同 URL 重复剪藏创建不同记录，不覆盖第一次；无选区保存 URL');
  for(const {note,m}of matches){assert.match(note.content,/created_timezone: "[+-]\d\d:\d\d"/);assert.equal(m.status,'待整理');assert.match(note.content,/type: "inbox"/);await v.openNote(note.path);assert.equal(v.statusEl.dataset.kind,'loaded');assert.ok(v.bodyEl.textContent.includes(m.body.trim()));}
  check('实际时间、时区与待整理字段正确，工作台逐条读取与磁盘一致');
  const leaf=v.leaf;await app.plugins.unloadPlugin('tt-workbench');await app.plugins.enablePluginAndSave('tt-workbench');await leaf.setViewState({type:'tt-workbench',active:true});v=leaf.view;await v.openNote(copies[0].note.path);assert.ok(v.bodyEl.textContent.includes(selected.text));check('卸载重载后从真实 Markdown 读回选区与来源');
  report.images='选区以纯文本取得，不下载图片；来源 URL 保留';report.passed=true;
 }catch(e){report.passed=false;report.failure=e.stack;}
 await fs.writeFile(path.join(root,'docs/workbench/verification/09-browser-capture.json'),JSON.stringify(report,null,2)+'\n');return v;
};
