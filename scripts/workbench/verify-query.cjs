const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function(app,v){
 assert.equal(app.vault.getName(),'tannt');const p=app.plugins.plugins['tt-workbench'],root=app.vault.adapter.getBasePath();
 const task='02.独立任务/工作台验收-研究会话切换/任务说明.md';
 const before=await p.reader.read(task);await p.work.update(before,{status:'in_progress',progress:'查询 Prompt 验收：这段是最新保存进度。',next_step:'在新会话核查可访问的执行证据。'});
 const savedSnapshot=(await p.reader.read(task)).content;v.pageScope='@tasks';await v.openNote(task);const buttons=[...v.bodyEl.querySelectorAll('[role=tab]')];assert.equal(buttons.length,3);buttons[1].click();assert.equal(v.bodyEl.querySelector('[aria-label="相关笔记"][role=tabpanel]').hidden,false);buttons[2].click();
 const text=v.bodyEl.querySelector('[aria-label="任务查询 Prompt"]');const until=Date.now()+5000;while(!text.value&&Date.now()<until)await new Promise(r=>setTimeout(r,30));
 assert.ok(text.value.includes('这段是最新保存进度'));assert.ok(text.value.includes(task));assert.ok(text.value.includes('无法确认'));assert.ok(text.value.includes('不打开、搜索或转存私人库'));assert.ok(text.value.includes('不能单独证明'));
 text.scrollIntoView({block:'center'});await fs.writeFile(path.join(root,'docs/workbench/verification/13-prompt.txt'),text.value);
 await fs.writeFile(path.join(root,'docs/workbench/verification/13-query-ui.json'),JSON.stringify({checkedAt:new Date().toISOString(),uiPassed:true,task,latestContent:true,tabs:true,queryDoesNotChangeState:(await p.reader.read(task)).content===savedSnapshot,clipboardPending:true,newSessionPending:true},null,2));
};
