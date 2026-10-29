const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function(app,v){
 assert.equal(app.vault.getName(),'tannt');const root=app.vault.adapter.getBasePath(),out=path.join(root,'docs/workbench/verification'),report={checkedAt:new Date().toISOString(),version:app.plugins.plugins['tt-workbench'].manifest.version,checks:[]};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));const win=view=>view.contentEl.ownerDocument.defaultView.require('electron').remote.getCurrentWindow();
 const capture=async(view,name)=>{const rect=view.contentEl.getBoundingClientRect();await fs.writeFile(path.join(out,name),(await win(view).webContents.capturePage({x:Math.round(rect.x),y:Math.round(rect.y),width:Math.floor(rect.width),height:Math.floor(rect.height)})).toPNG());};
 try{
  assert.equal(report.version,'0.14.0');const w=win(v);w.webContents.closeDevTools();
  for(const width of [1280,650,420]){
   w.setSize(width,860);await pause(160);v.taskUI.selectedTab=null;v.pageScope='@tasks';await v.openNote('02.独立任务/工作台验收-研究会话切换/任务说明.md');await pause(120);
   const selected=v.listEl.querySelector('.tw-note[aria-pressed="true"]');assert.ok(selected);const row=selected.getBoundingClientRect(),list=v.listEl.getBoundingClientRect();assert.ok(row.top>=list.top-1&&row.bottom<=list.bottom+1,'选中任务应在列表可视区域内');
   v.workspaceEl.scrollTop=0;v.contentEl.scrollTop=0;v.contentEl.querySelector('.tw-shell').scrollTop=0;await pause(80);
   if(width===1280){const visibleRow=selected.getBoundingClientRect(),viewport=v.contentEl.getBoundingClientRect();assert.ok(visibleRow.top>=viewport.top&&visibleRow.bottom<=viewport.bottom,'选中任务应在实际窗口内');}
   assert.ok(v.contentEl.scrollWidth<=v.contentEl.clientWidth+1);assert.equal(v.bodyEl.querySelectorAll('[role=tab]').length,3);assert.ok(!v.bodyEl.querySelector('[aria-label="任务说明"][role=tabpanel]').hidden);assert.equal(v.nav.querySelector('[aria-label="查看项目"]').textContent.includes('项目'),true);await capture(v,`final-tasks-${width}.png`);
   const tabs=[...v.bodyEl.querySelectorAll('[role=tab]')];tabs[0].focus();w.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});await pause(80);assert.equal(tabs[1].getAttribute('aria-selected'),'true');assert.equal(v.contentEl.ownerDocument.activeElement,tabs[1]);
   report.checks.push({width,noHorizontalOverflow:true,selectedTaskVisible:true,taskTabs:true,realArrowKey:true});
  }
  w.setSize(1280,860);await pause(160);v.navigate('01.收件箱');await pause(180);await capture(v,'final-inbox-1280.png');
  v.navigate('@projects');await pause(180);await capture(v,'final-projects-1280.png');
  v.taskUI.selectedTab=null;v.navigate('@tasks');await v.openNote('02.独立任务/工作台验收-研究会话切换/任务说明.md');const tabs=[...v.bodyEl.querySelectorAll('[role=tab]')];tabs[2].click();await pause(120);await capture(v,'final-query-1280.png');
  const main=app.workspace.getLeavesOfType('tt-workbench').find(l=>l.view.contentEl&&l.view.contentEl.ownerDocument!==v.contentEl.ownerDocument);if(main){main.view.pageScope='@tasks';main.view.taskUI.selectedTab=null;await main.view.openNote('02.独立任务/工作台验收-研究会话切换/任务说明.md');await app.workspace.revealLeaf(main);await pause(150);await capture(main.view,'final-main-window.png');report.mainWindow=true;}else report.mainWindow=false;
  await app.workspace.revealLeaf(v.leaf);v.taskUI.selectedTab=null;await v.openNote('02.独立任务/工作台验收-研究会话切换/任务说明.md');v.workspaceEl.scrollTop=0;report.passed=report.mainWindow;
 }catch(e){report.passed=false;report.failure=e.stack;}
 await fs.writeFile(path.join(out,'final-ui.json'),JSON.stringify(report,null,2)+'\n');return v;
};
