const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const m=require('..');
const repo=path.resolve(__dirname,'../../..');
async function fixture(t){
  const parent=path.join(repo,'tmp/task-transfer-tests');
  await fs.mkdir(parent,{recursive:true});const root=await fs.mkdtemp(path.join(parent,'case-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const files=new m.VaultFiles(root),run=input=>m.execute(root,input);
  const project=await run({action:'create-project',request_id:randomUUID(),privacy:'ordinary',name:'研究方案',goal:'完成研究'});
  const task=await run({action:'create-task',request_id:randomUUID(),privacy:'ordinary',name:'研究任务',goal:'验证研究方案',projectPath:project.path});
  const source='0.收件箱/2026-10/研究输入/记录.md';
  const asset='0.收件箱/2026-10/研究输入/attachments/资料 #[甲].jsonl';
  const raw=m.newDocument({type:'inbox',id:randomUUID(),created:'2026-10-13 07:00:00',created_timezone:'-07:00',inbox_status:'pending',title:'研究输入',attachments:[asset],custom:{a:1}},'原始输入\n\n'+m.linkTo(asset,source)+'\n');
  await files.exclusiveFile(source,raw);await files.exclusiveFile(asset,Buffer.from([0,4,13,10,255]));
  const input={action:'transfer-to-task',request_id:randomUUID(),privacy:'ordinary',path:source,expected:raw,target:task.path,target_expected:await files.read(task.path)};
  return {root,files,run,source,asset,input};
}
test('整组资料迁入任务，保留身份、时间、历史正文与附件字节，更新入链，重试不重复',async t=>{
  const h=await fixture(t),ref='03.知识/笔记/引用.md';
  await h.files.exclusiveFile(ref,`[研究](../../${h.source.replace(/ /g,'%20')})\n[[${h.source}|来源]]\n\n\`[[${h.source}]]\`\n`);
  const out=await h.run(h.input);assert.equal(out.saved,true);assert.equal(out.moved.length,2);
  const note=await h.files.read(out.sourcePath),before=m.documentParts(h.input.expected),after=m.documentParts(note);
  assert.equal(after.fields.type,'note');
  for(const key of ['id','created','created_timezone','inbox_status','custom'])assert.deepEqual(after.fields[key],before.fields[key]);
  assert.equal(after.fields.capture_origin.path,h.source);assert.ok(after.body.includes('原始输入'));
  const asset=out.moved.find(e=>e.from===h.asset);assert.ok((await fs.readFile(path.join(h.root,asset.to))).equals(Buffer.from([0,4,13,10,255])));
  await assert.rejects(fs.stat(path.join(h.root,path.posix.dirname(h.source))),{code:'ENOENT'});
  assert.ok((await h.files.read(ref)).includes(`[[${out.sourcePath}|来源]]`));assert.ok((await h.files.read(ref)).includes(`\`[[${h.source}]]\``));
  assert.ok((await h.files.read(h.input.target)).includes(encodeURIComponent('记录.md')));
  assert.equal(m.documentParts(await h.files.read(h.input.target)).fields.status,'not_started');
  assert.equal((await h.run(h.input)).reused,true);
  await h.files.update(out.sourcePath,note,{append:'后续内容'});
  await assert.rejects(h.run(h.input),{code:'REPLAY_CHANGED'});
});
test('手动单文件仅迁移自身和登记附件，其他输入保持原位，目标重名使用序号',async t=>{
  const h=await fixture(t),source='0.收件箱/手动.md',asset='0.收件箱/attachments/附件.txt';
  await h.files.exclusiveFile(asset,'原附件');
  const raw=m.newDocument({type:'inbox',title:'手动',attachments:[asset]},'输入');await h.files.exclusiveFile(source,raw);
  await h.files.ensureDirectories('1.项目/研究方案/任务/研究任务/资料/手动');
  const out=await h.run({...h.input,path:source,expected:raw});
  assert.match(out.directory,/手动 \(2\)$/);assert.ok(await h.files.read(h.source));
  await assert.rejects(fs.stat(path.join(h.root,asset)),{code:'ENOENT'});
});
test('手动无标题记录使用文件名，迁移后相对 wiki 与 Markdown 共享链接仍指向原资料',async t=>{
  const h=await fixture(t),source='0.收件箱/手写研究.md',shared='3.资源/课程/共同资料.md';
  await h.files.exclusiveFile(shared,'共同资料');
  const raw=m.newDocument({type:'inbox'},'[[../3.资源/课程/共同资料.md|参考]]\n[参考](../3.资源/课程/共同资料.md)');
  await h.files.exclusiveFile(source,raw);
  const out=await h.run({...h.input,path:source,expected:raw}),after=await h.files.read(out.sourcePath);
  assert.match(out.directory,/资料\/手写研究$/);assert.ok(after.includes(`[[${shared}|参考]]`));
  const target=/\[参考\]\(<([^>]+)>\)/.exec(after)[1];
  assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(out.sourcePath),decodeURIComponent(target))),shared);
});
test('来源或任务发生修改时，迁移前拒绝；不改变现存资料',async t=>{
  const h=await fixture(t);await fs.appendFile(path.join(h.root,h.source),'并发补充');
  await assert.rejects(h.run(h.input),{code:'CONFLICT'});
  assert.ok((await h.files.read(h.source)).endsWith('并发补充'));
  await assert.rejects(h.run({...h.input,expected:await h.files.read(h.source),target_expected:'过期任务'}),{code:'CONFLICT'});
});
test('工作台迁移前发现冲突，重新读取来源后可提交新请求；不沿用无恢复记录的旧快照',async t=>{
  const h=await fixture(t),{WorkLinks}=require('../../../apps/workbench/work-links.js');
  const links=new WorkLinks({app:{vault:{adapter:{getBasePath:()=>h.root}}},reader:{read:async p=>({content:await h.files.read(p)})}});
  await fs.appendFile(path.join(h.root,h.source),'新增输入');
  await assert.rejects(links.move({path:h.source,content:h.input.expected},h.input.target),{code:'CONFLICT'});
  const out=await links.move({path:h.source,content:await h.files.read(h.source)},h.input.target);
  assert.ok((await h.files.read(out.sourcePath)).endsWith('新增输入'));
});
test('其他记录引用同一附件时不擅自搬走，提示具体文件及引用者',async t=>{
  const h=await fixture(t);await h.files.exclusiveFile('0.收件箱/另一条.md',m.newDocument({type:'inbox',attachments:[h.asset]},'共享'));
  await assert.rejects(h.run(h.input),e=>e.code==='SHARED_MATERIAL'&&e.message.includes('另一条.md'));
  assert.ok(await h.files.read(h.source));
});
test('任务外已有独立归属的资料只引用，不搬动',async t=>{
  const h=await fixture(t),shared='3.资源/课程/原课程/资料.pdf';await h.files.exclusiveFile(shared,'PDF');
  const raw=m.patchFields(h.input.expected,{attachments:[h.asset,shared]});await fs.writeFile(path.join(h.root,h.source),raw);
  const out=await h.run({...h.input,expected:raw});assert.equal(out.moved.length,2);
  assert.equal(await fs.readFile(path.join(h.root,shared),'utf8'),'PDF');
  assert.ok(m.documentParts(await h.files.read(out.sourcePath)).fields.attachments.includes(shared));
});
test('拒绝符号链接、混入独立记录、无效目标、缺失登记附件和越界路径',async t=>{
  const h=await fixture(t);const bad='0.收件箱/2026-10/研究输入/另一记录.md';
  await h.files.exclusiveFile(bad,m.newDocument({type:'inbox'},'另一输入'));
  await assert.rejects(h.run(h.input),{code:'MIXED_MATERIAL'});await fs.unlink(path.join(h.root,bad));
  await fs.symlink(h.root,path.join(h.root,path.dirname(bad),'外部'));
  await assert.rejects(h.run(h.input),{code:'INVALID_DIRECTORY'});await fs.unlink(path.join(h.root,path.dirname(bad),'外部'));
  await fs.unlink(path.join(h.root,h.asset));await assert.rejects(h.run(h.input),{code:'NOT_FOUND'});
  await assert.rejects(h.run({...h.input,path:'../私人库/记录.md'}),{code:'OUT_OF_SCOPE'});
});
test('复制阶段失败后保留源，使用同一请求恢复；不同请求不重复建资料',async t=>{
  const h=await fixture(t);let injected=false;
  const transfer=new m.TaskTransfer(h.root,{io:{...fs,open:async(p,...args)=>{
    if(!injected&&p.split(path.sep).join('/').includes('/资料/研究输入/attachments/')){injected=true;throw Object.assign(Error('复制失败'),{code:'EACCES'});}return fs.open(p,...args);
  }}});
  await assert.rejects(transfer.run(h.input),e=>e.partial&&!!e.recoveryPath);
  assert.ok(await h.files.read(h.source));
  await assert.rejects(h.run({...h.input,request_id:randomUUID()}),{code:'TRANSFER_PENDING'});
  const out=await h.run(h.input);assert.equal(out.saved,true);assert.equal(out.moved.length,2);
});
test('部分源文件已移除后失败可恢复，不丢失剩余资料，也不重复更新任务',async t=>{
  const h=await fixture(t);let injected=false;
  const transfer=new m.TaskTransfer(h.root,{io:{...fs,unlink:async p=>{
    if(!injected&&p===path.join(h.root,h.asset)){injected=true;throw Object.assign(Error('移除失败'),{code:'EACCES'});}return fs.unlink(p);
  }}});
  await assert.rejects(transfer.run(h.input),e=>e.partial);
  const out=await h.run(h.input);assert.equal(out.ok,true);
  assert.equal((await h.files.read(h.input.target)).split('## 迁入资料').length,2);
});
test('恢复时检测被修改的源和目标，不覆盖变化',async t=>{
  const h=await fixture(t);
  const transfer=new m.TaskTransfer(h.root,{io:{...fs,unlink:async p=>{if(p===path.join(h.root,h.source))throw Error('中断');return fs.unlink(p);}}});
  await assert.rejects(transfer.run(h.input),e=>e.partial);
  const pending=await transfer.pending(h.source);assert.equal(pending.input.request_id,h.input.request_id);
  const plan=JSON.parse(await fs.readFile(path.join(h.root,pending.recoveryPath),'utf8'));
  await fs.writeFile(path.join(h.root,plan.entries[1].to),'用户修改');
  await assert.rejects(h.run(h.input),{code:'PATH_CONFLICT'});assert.ok(await h.files.read(h.source));
});
test('任务专属新附件忽略任务外默认目录，明确指定任务外位置时拒绝',async t=>{
  const h=await fixture(t);await h.files.exclusiveFile('.obsidian/app.json',JSON.stringify({attachmentFolderPath:'公共附件'}));
  const expected=await h.files.read(h.input.target);
  const input={action:'attach',request_id:randomUUID(),privacy:'ordinary',path:h.input.target,expected,filename:'新材料.txt',base64:Buffer.from('资料').toString('base64')};
  const out=await h.run(input);assert.equal(out.attachmentPath,'1.项目/研究方案/任务/研究任务/attachments/新材料.txt');
  await assert.rejects(h.run({...input,request_id:randomUUID(),expected:await h.files.read(h.input.target),directory:'公共附件'}),{code:'TASK_ATTACHMENT_PATH'});
});
test('项目内任务创建与迁移也使用同一入口，保留项目状态',async t=>{
  const h=await fixture(t),project='1.项目/方案/项目说明.md';
  await h.files.exclusiveFile(project,m.newDocument({type:'project',status:'paused'},'项目'));
  const input={action:'create-task',request_id:randomUUID(),privacy:'ordinary',name:'子任务',goal:'结果',projectPath:project};
  const task=await h.run(input);assert.equal((await h.run(input)).reused,true);
  const out=await h.run({...h.input,target:task.path,target_expected:await h.files.read(task.path)});
  assert.ok(out.directory.startsWith('1.项目/方案/任务/子任务/'));
  assert.equal(m.documentParts(await h.files.read(project)).fields.status,'paused');
});
