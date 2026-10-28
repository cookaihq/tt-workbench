const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function(app,v){
  assert.equal(app.vault.getName(),'tannt');
  const out=path.join(app.vault.adapter.getBasePath(),'docs/workbench/verification');
  const remote=v.contentEl.ownerDocument.defaultView.require('electron').remote,w=remote.getCurrentWindow();
  const report={checkedAt:new Date().toISOString(),entry:'真实任务窗口、键盘与布局 A',checks:[]};const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const capture=async name=>{const r=v.contentEl.getBoundingClientRect();await fs.writeFile(path.join(out,name),(await w.webContents.capturePage({x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)})).toPNG());};
  try{
    assert.equal(v.contentEl.querySelectorAll('dialog[open]').length,0,'验收开始时应无其他弹窗遮挡');
    for(const width of [1280,650,420]){
      w.setSize(width,860);await pause(150);v.taskUI.status='all';v.navigate('@tasks');await pause(200);
      assert.ok(v.contentEl.scrollWidth<=v.contentEl.clientWidth+1);assert.ok(v.bodyEl.querySelector('.tw-task-form'));
      await capture(`06-tasks-${width}.png`);
      v.newTaskButton.click();assert.ok(v.taskUI.dialog.open);assert.equal(v.contentEl.ownerDocument.activeElement,v.taskUI.name);
      w.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await pause(100);assert.equal(v.contentEl.ownerDocument.activeElement,v.taskUI.goal);
      await capture(`06-create-task-${width}.png`);v.taskUI.dialog.close();report.checks.push({width,passed:true,keyboardTab:true,noHorizontalOverflow:true});
    }
    w.setSize(1280,860);await pause(150);v.navigate('@projects');await pause(200);await capture('06-project-1280.png');v.navigate('@tasks');report.passed=true;
  }catch(e){report.passed=false;report.failure=e.stack;}finally{if(v.taskUI.dialog.open)v.taskUI.dialog.close();await fs.writeFile(path.join(out,'06-layout.json'),JSON.stringify(report,null,2)+'\n');}
};
