const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function verify(app, view) {
  assert.equal(app.vault.getName(),'tannt');
  const root=app.vault.adapter.getBasePath(),out=path.join(root,'docs/workbench/verification');
  const remote=view.contentEl.ownerDocument.defaultView.require('electron').remote;
  const browser=remote.getCurrentWindow();const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const report={checkedAt:new Date().toISOString(),reference:'docs/prototypes/workbench/workbench-prototype.html',checks:[]};
  const capture=async name=>{const r=view.contentEl.getBoundingClientRect();const image=await browser.webContents.capturePage({x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)});await fs.writeFile(path.join(out,name),image.toPNG());};
  let reference;
  try {
    for(const width of [1280,650,420]){
      browser.setSize(width,860);await pause(250);view.navigate('01.收件箱');await pause(250);
      assert.ok(view.contentEl.scrollWidth<=view.contentEl.clientWidth+1,'整体横向溢出');
      for(const label of ['任务','项目','收件箱 Inbox','浏览笔记','独立任务'])assert.ok(view.nav.textContent.includes(label));
      assert.equal(view.pageTitle.textContent,'先记下，稍后整理');
      assert.equal(view.filterEl.querySelectorAll('button[data-filter]').length,3);
      await capture(`05-layout-a-inbox-${width}.png`);
      view.captureButton.click();assert.ok(view.capturePanel.open);assert.equal(view.contentEl.ownerDocument.activeElement,view.captureContent);await capture(`05-layout-a-capture-${width}.png`);
      const before=app.vault.getMarkdownFiles().length;view.captureContent.value='仅检查弹窗关闭，不保存这段验收文字';view.hideCaptureButton.click();await pause(150);assert.equal(view.capturePanel.open,false);assert.equal(app.vault.getMarkdownFiles().length,before);view.captureContent.value='';
      view.navigate('@projects');await pause(100);view.workUI.openCreate();assert.ok(view.workUI.dialog.open);await capture(`05-layout-a-project-form-${width}.png`);view.workUI.dialog.close();
      report.checks.push({width,passed:true,navigation:true,filters:true,captureDialog:true,noSaveOnCancel:true,projectDialog:true});
    }
    browser.setSize(1280,860);await pause(200);view.navigate('01.收件箱');
    const rect=view.contentEl.getBoundingClientRect();
    reference=new remote.BrowserWindow({width:Math.floor(rect.width),height:Math.floor(rect.height),useContentSize:true,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    await reference.loadFile(path.join(root,'docs/prototypes/workbench/workbench-prototype.html'));
    await reference.webContents.executeJavaScript("document.querySelector('[data-action=\"view\"][data-value=\"inbox\"]').click(); document.querySelector('.prototype-banner')?.remove(); document.querySelector('.switcher')?.remove();");
    await pause(200);const ref=await reference.webContents.capturePage();await fs.writeFile(path.join(out,'05-reference-inbox-1280.png'),ref.toPNG());
    report.referenceNote='原型仍使用原有演示数据，仅去除讨论用顶部说明与底部原型工具条；正式界面显示当前库真实记录。';
    report.passed=true;
  }catch(error){report.passed=false;report.failure=error.stack;}
  finally{if(reference&&!reference.isDestroyed())reference.close();await fs.writeFile(path.join(out,'05-layout-a.json'),JSON.stringify(report,null,2)+'\n');}
  return report;
};
