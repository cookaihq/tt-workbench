const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { mapPreviousPath } = require('../../apps/workbench/vault-paths.js');

module.exports = async function verify(app, view) {
  assert.equal(app.vault.getName(), 'tannt');
  const root=app.vault.adapter.getBasePath();
  const out=path.join(root,'docs/workbench/verification');
  const report={checkedAt:new Date().toISOString(),checks:[]};
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const sample=mapPreviousPath(JSON.parse(await fs.readFile(path.join(out,'04-native-review.json'),'utf8')).sample);
  const plugin=app.plugins.plugins['tannt-workbench'];
  const original=[];
  const browser=view.contentEl.ownerDocument.defaultView.require('electron').remote.getCurrentWindow();
  try {
    const fixtures=[['01.收件箱/工作台验收-手动收件箱.md','2026-10-17 09:00:00','+08:00'],['01.收件箱/工作台验收-尚未应用模板.md','2026-10-16 17:59:00','-07:00']];
    for(const [p,created,zone] of fixtures){const f=app.vault.getAbstractFileByPath(p);const raw=await app.vault.read(f);original.push([f,raw]);await app.vault.modify(f,`---\ntype: inbox\ninbox_status: pending\ncreated: "${created}"\ncreated_timezone: "${zone}"\n---\n\n时区显示验收。\n`);}
    const until=Date.now()+10000;while(Date.now()<until&&!fixtures.every(([p,c])=>app.metadataCache.getCache(p)?.frontmatter?.created===c))await pause(80);
    view.pageScope='01.收件箱';view.refreshList();
    const paths=[...view.listEl.querySelectorAll('[data-path]')].map(b=>b.dataset.path);
    assert.ok(paths.indexOf(fixtures[0][0])<paths.indexOf(fixtures[1][0]));
    await view.openNote(fixtures[0][0]);assert.ok(view.noteInfoEl.textContent.includes('2026-10-17 09:00:00 UTC+08:00'));assert.ok(view.noteInfoEl.textContent.includes('2026-10-16 18:00:00 UTC-07:00'));
    report.checks.push({name:'两个来源时区跨日样例按实际时刻排序，详情保留原值与本设备换算值',passed:true});
    for(const [file,raw] of original.splice(0))await app.vault.modify(file,raw);
    await view.openNote(sample);
    for(const [width,height] of [[1280,860],[650,780],[420,780]]){
      browser.setSize(width,height);await pause(250);const panel=view.bodyEl.querySelector('.tw-edit-panel');panel.open=true;
      const button=panel.querySelector('button[type=submit]');button.scrollIntoView({block:'center'});await pause(100);
      const rect=view.contentEl.getBoundingClientRect();const br=button.getBoundingClientRect();
      assert.ok(view.contentEl.scrollWidth<=view.contentEl.clientWidth+1,'整体水平溢出');assert.ok(br.top>=rect.top&&br.bottom<=rect.bottom+1,'保存按钮不可滚动到可见区域');
      const input=panel.querySelector('textarea');input.focus();assert.equal(view.contentEl.ownerDocument.activeElement,input);
      const image=await browser.webContents.capturePage({x:Math.round(rect.x),y:Math.round(rect.y),width:Math.floor(rect.width),height:Math.floor(rect.height)});
      await fs.writeFile(path.join(out,`04-review-${width}.png`),image.toPNG());
      report.checks.push({width,passed:true,saveButtonReachable:true,inputFocus:true,noHorizontalOverflow:true});
    }
    browser.setSize(1280,860);await pause(250);view.bodyEl.scrollTop=0;
    report.passed=true;
  }catch(error){report.passed=false;report.failure=error.stack;}
  finally{for(const[file,raw]of original)await app.vault.modify(file,raw);await fs.writeFile(path.join(out,'04-time-layout.json'),JSON.stringify(report,null,2)+'\n');}
  return report;
};
