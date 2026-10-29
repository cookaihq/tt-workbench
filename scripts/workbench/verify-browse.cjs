const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function(app,v){
  assert.equal(app.vault.getName(),'tannt');const root=app.vault.adapter.getBasePath(),p=app.plugins.plugins['tt-workbench'];
  const report={checkedAt:new Date().toISOString(),entry:'真实工作台目录、正文检索与笔记导航',checks:[]};const check=name=>report.checks.push({name,passed:true});
  const wait=async fn=>{const end=Date.now()+8000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw Error('等待超时');};
  const scope='03.知识/笔记/工作台验收分类',note=scope+'/无属性笔记.md',other='04.资料/文章与视频/工作台验收参考.md';
  const add=async(f,raw)=>{await p.editor.ensureDirectories(path.posix.dirname(f));if(!app.vault.getAbstractFileByPath(f)){await p.editor.exclusiveFile(f,raw);await wait(()=>app.vault.getAbstractFileByPath(f));}};
  try{
    await add(note,'# 尚待验证的判断\n\n正文检索验收标记Q782。A < B & C；这一判断还不成熟。\n\n[['+other+']]\n');await add(other,'# 来源材料\n\n正文检索验收标记Q782 在范围外也存在。\n');await p.editor.ensureDirectories(scope+'/空目录');await wait(()=>app.vault.getAbstractFileByPath(scope+'/空目录'));
    const before=await fs.readFile(path.join(root,note),'utf8');v.navigate('');
    assert.ok(v.listEl.querySelector('[data-folder="03.知识"]'));assert.equal(v.listEl.querySelector('[data-folder="apps"]'),null);
    v.listEl.querySelector('[data-folder="03.知识"]').click();v.listEl.querySelector('[data-folder="03.知识/笔记"]').click();v.listEl.querySelector(`[data-folder="${scope}"]`).click();assert.ok(v.listEl.querySelector(`[data-path="${note}"]`));
    check('从实际根目录逐层进入本人分类位置，源码目录不在业务入口');
    v.searchInput.value='Q782';v.searchInput.dispatchEvent(new v.contentEl.ownerDocument.defaultView.Event('input',{bubbles:true}));await wait(()=>v.countEl.textContent.startsWith('搜索结果'));
    assert.equal(v.listEl.querySelectorAll('[data-path]').length,1);v.listEl.querySelector('[data-path]').click();await wait(()=>v.bodyEl.textContent.includes('这一判断还不成熟'));assert.ok(v.bodyEl.textContent.includes('A < B & C'));
    check('当前目录及子目录的正文命中正确，范围外同词不混入；特殊字符按文字显示');
    const link=[...v.bodyEl.querySelectorAll('a.internal-link')].find(a=>a.getAttribute('data-href')===other);assert.ok(link);link.click();await wait(()=>v.selectedPath===other&&v.statusEl.dataset.kind==='loaded');v.backButton.click();await wait(()=>v.selectedPath===note&&v.statusEl.dataset.kind==='loaded');
    assert.equal(await fs.readFile(path.join(root,note),'utf8'),before);check('库内引用在详情阅读并返回，无属性笔记未被补写');
    v.navigate(scope+'/空目录');assert.ok(v.listEl.textContent.includes('还没有笔记'));v.searchInput.value='没有这个词';v.query=v.searchInput.value;v.refreshList();await wait(()=>v.countEl.textContent.startsWith('搜索结果'));assert.ok(v.listEl.textContent.includes('没有匹配结果'));check('真实空目录与无结果有明确提示');
    const old=scope+'/重命名前.md',renamed=scope+'/重命名后.md';if(!app.vault.getAbstractFileByPath(renamed)){await add(old,'重命名验收原文');await app.vault.rename(app.vault.getAbstractFileByPath(old),renamed);}v.navigate(scope);assert.ok(v.listEl.querySelector(`[data-path="${renamed}"]`));check('原生重命名后列表读取实际新位置');
    await v.openNote('apps/workbench/main.js');assert.equal(v.statusEl.dataset.errorCode,'NOT_MARKDOWN');await v.openNote('docs/workbench/work-records.md');assert.equal(v.statusEl.dataset.errorCode,'OUT_OF_SCOPE');
    await v.openNote(note);check('非业务文件入口被拒绝且能返回有效笔记');
    const leaf=v.leaf;await app.plugins.unloadPlugin('tt-workbench');await app.plugins.enablePluginAndSave('tt-workbench');await leaf.setViewState({type:'tt-workbench',active:true});v=leaf.view;v.navigate(scope);await v.openNote(note);assert.equal(await fs.readFile(path.join(root,note),'utf8'),before);check('重开后目录与正文从真实 Markdown 恢复，不依赖持久索引');report.passed=true;
  }catch(e){report.passed=false;report.failure=e.stack;}
  await fs.writeFile(path.join(root,'docs/workbench/verification/10-browse.json'),JSON.stringify(report,null,2)+'\n');return v;
};
