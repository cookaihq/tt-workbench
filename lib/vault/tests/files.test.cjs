const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const m = require('..');
const repo = path.resolve(__dirname, '../../..');
async function fixture() {
  const parent = path.join(repo, 'tmp/vault-module-tests');
  await fs.mkdir(parent, {recursive:true}); const root = await fs.mkdtemp(path.join(parent,'api-'));
  return {root,files:new m.VaultFiles(root),run: input=>m.execute(root,input)};
}
const write = (action, values={}) => ({action,request_id:randomUUID(),privacy:'ordinary',...values});

test('明确位置的新笔记可独立创建、重试与补充附件，不覆盖同名不同内容',async()=>{
  const h=await fixture(),p='3.资源/课程/合成验收/课堂记录.md';
  const input=write('create-note',{path:p,content:'已明确归属的原始输入。',files:[{filename:'附件.txt',base64:Buffer.from('原始附件').toString('base64'),directory:'3.资源/课程/合成验收/资料'}]});
  const saved=await h.run(input);assert.equal(saved.saved,true);assert.equal(saved.path,p);
  const raw=await h.files.read(p);assert.equal(m.documentParts(raw).fields.type,'note');assert.ok(raw.includes('已明确归属的原始输入。'));
  assert.equal((await h.run(input)).reused,true);
  await assert.rejects(h.run(write('create-note',{path:p,content:'另一次不同的输入'})),{code:'EEXIST'});
  assert.equal(await h.files.read(p),raw);
});

test('无 Obsidian 对象也能保存、追加、整理，重试不重复且时间未知属性保留', async()=>{
  const h=await fixture(), input=write('capture',{title:'中文标题',content:'原文\n',sources:'https://example.org/a'});
  const created=await h.run(input); assert.match(created.path,/\/中文标题\/记录.md$/);
  assert.equal((await h.run(Object.fromEntries(Object.entries(input).reverse()))).path,created.path);
  let before=await h.files.read(created.path), initial=m.documentParts(before).fields;
  before=before.replace('\n---\n','\n# 不改这条注释\nunknown:\n  values: [甲, 乙]\nmultiline: |\n  一\n  二\n---\n');
  await fs.writeFile(path.join(h.root,created.path),before);
  const update=write('update',{path:created.path,expected:before,append:'补充内容',fields:{inbox_status:'reviewed'}});
  assert.equal((await h.run(update)).saved,true); assert.equal((await h.run(update)).reused,true);
  const after=await h.files.read(created.path),fields=m.documentParts(after).fields;
  assert.equal(fields.created,initial.created);assert.equal(fields.created_timezone,initial.created_timezone);
  assert.deepEqual(fields.unknown,{values:['甲','乙']});assert.equal(fields.multiline,'一\n二\n');assert.match(after,/# 不改这条注释/);
  assert.equal(after.split('补充内容').length,2);assert.equal(fields.inbox_status,'reviewed');
});

test('同名新记录使用可读序号，重名不同内容不覆盖；原字节附件含 JSONL 和大于旧接口上限文件',async()=>{
  const h=await fixture();
  const a=await h.run(write('capture',{title:'同名',content:'一'}));const b=await h.run(write('capture',{title:'同名',content:'二'}));
  assert.match(b.path,/同名 \(2\)/);assert.ok((await h.files.read(a.path)).endsWith('一'));
  const source=path.join(h.root,'原会话.jsonl'),bytes=Buffer.alloc(9*1024*1024,0x61);await fs.writeFile(source,bytes);
  const request=write('attach',{path:a.path,expected:await h.files.read(a.path),source,directory:'0.收件箱/资料'});
  const first=await h.run(request);assert.equal(first.attachmentPath,'0.收件箱/资料/原会话.jsonl');
  assert.ok((await fs.readFile(path.join(h.root,first.attachmentPath))).equals(bytes));
  assert.equal((await h.run(request)).reused,true);
  await fs.writeFile(source,'不同内容');await assert.rejects(h.run(request),{code:'REQUEST_CHANGED'});
  const next=await h.run(write('attach',{path:a.path,expected:await h.files.read(a.path),source,directory:'0.收件箱/资料'}));
  assert.equal(next.attachmentPath,'0.收件箱/资料/原会话 (2).jsonl');
});

test('收件箱写入中断后新实例检查同一目录，不另建记录或覆盖残留内容',async()=>{
  const h=await fixture(),id=randomUUID();
  const io={...fs,open:async(name,...args)=>{
    const handle=await fs.open(name,...args);
    if(path.basename(name)==='记录.md')handle.writeFile=async()=>{await handle.write('---\ntype: [');throw Object.assign(Error('模拟中断'),{code:'ENOSPC'});};
    return handle;
  }};
  const first=new m.InboxStore(h.root,{io});
  await assert.rejects(first.save(first.prepare({title:'中断恢复',content:'完整原文',requestId:id})),{code:'NO_SPACE'});
  const second=new m.InboxStore(h.root);
  await assert.rejects(second.save(second.prepare({title:'中断恢复',content:'完整原文',requestId:id})),{code:'PARTIAL_WRITE'});
  const month=(await fs.readdir(path.join(h.root,'0.收件箱')))[0];
  assert.deepEqual(await fs.readdir(path.join(h.root,'0.收件箱',month)),['中断恢复']);
  assert.equal(await h.files.read(`0.收件箱/${month}/中断恢复/记录.md`),'---\ntype: [');
});

test('部分完成的附件被外部改写时停止重试；缺少附件配置返回明确错误',async()=>{
  const h=await fixture(),source=path.join(h.root,'一.txt');await fs.writeFile(source,'原文件');
  const input=write('capture',{title:'重试核对',content:'原文',files:[{source,directory:'0.收件箱/材料'},{source:path.join(h.root,'不存在.txt'),directory:'0.收件箱/材料'}]});
  const partial=await h.run(input);assert.equal(partial.partial,true);
  await fs.writeFile(path.join(h.root,partial.files[0].attachmentPath),'外部改写');
  await assert.rejects(h.run(input),{code:'REPLAY_CHANGED'});
  await assert.rejects(h.run(write('attach',{path:partial.path,expected:await h.files.read(partial.path),source})),{code:'ATTACHMENT_SETTING'});
});

test('多个原文件部分失败逐项报告，修复缺失来源后继续且不重建笔记或成功附件',async()=>{
  const h=await fixture(),one=path.join(h.root,'一.md'),two=path.join(h.root,'二.jsonl');await fs.writeFile(one,'---\ntype: inbox\n---\n原始会话');
  const input=write('capture',{title:'多份材料',content:'问题',files:[{source:one,directory:'0.收件箱/材料'},{source:two,directory:'0.收件箱/材料'}]});
  const partial=await h.run(input);assert.equal(partial.ok,false);assert.equal(partial.partial,true);assert.equal(partial.files.length,1);assert.equal(partial.failures.length,1);
  await fs.writeFile(two,'{"content":"原文"}\n');const complete=await h.run(input);assert.equal(complete.ok,true);assert.equal(complete.path,partial.path);assert.equal(complete.files.length,2);
  const raw=await h.files.read(complete.path);assert.equal(m.documentParts(raw).fields.attachments.length,2);
  assert.ok((await fs.readFile(path.join(h.root,'0.收件箱/材料/一.md'))).equals(await fs.readFile(one)));
  assert.equal(raw.split('[一.md]').length,2);
});

test('替换正文只改指定正文，属性注释、创建时间和未知 YAML 均保留',async()=>{
  const h=await fixture(),p='06.经验/一.md';const original='---\r\ntype: note\r\ncreated: "2026-10-21 10:00:00"\r\ncustom: {x: [1, 2]} # keep\r\n---\r\n旧正文';
  await h.files.exclusiveFile(p,original);await h.run(write('update',{path:p,expected:original,body:'新的正文'}));
  assert.equal(await h.files.read(p),original.replace('旧正文','新的正文'));
  await assert.rejects(h.run(write('update',{path:p,expected:await h.files.read(p),fields:{created:'新的时间'}})),{code:'IMMUTABLE_FIELD'});
});

test('两个独立 Node 进程争用同一笔记时，一个成功、一个保留冲突，不依赖工作台',async()=>{
  const h=await fixture(),p='0.收件箱/并发.md';await h.files.exclusiveFile(p,'原文');
  const code='const m=require(process.argv[1]);m.execute(process.argv[2],JSON.parse(process.argv[3])).then(r=>console.log(JSON.stringify(r))).catch(e=>console.log(JSON.stringify(m.errorResult(e))));';
  const run=promisify(execFile);const inputs=['甲','乙'].map(append=>write('update',{path:p,expected:'原文',append}));
  const outputs=await Promise.all(inputs.map(input=>run(process.execPath,['-e',code,path.join(repo,'lib/vault'),h.root,JSON.stringify(input)])));
  const results=outputs.map(x=>JSON.parse(x.stdout));assert.equal(results.filter(r=>r.ok).length,1);const conflict=results.find(r=>!r.ok);assert.equal(conflict.code,'CONFLICT');
  const actual=await h.files.read(p),copy=await h.files.read(conflict.conflictPath);assert.ok(actual.includes('甲')?copy.includes('乙'):copy.includes('甲'));
});

test('外部编辑在最终读回前发生时报告冲突并保留原文件实际结果',async()=>{
  const h=await fixture(),p='0.收件箱/外部.md';await h.files.exclusiveFile(p,'原文');
  const files=new m.VaultFiles(h.root,{io:{...fs,rename:async(from,to)=>{await fs.rename(from,to);await fs.writeFile(to,'外部编辑器的内容');}}});
  await assert.rejects(files.update(p,'原文',{append:'拟写内容'}),e=>e.code==='CONFLICT'&&Boolean(e.recoveryPath));
  assert.equal(await h.files.read(p),'外部编辑器的内容');
});

test('符号链接和目录穿越被拒绝；空更新、无效状态与无效 YAML 不写入',async()=>{
  const h=await fixture();await fs.mkdir(path.join(h.root,'0.收件箱'));await fs.symlink(h.root,path.join(h.root,'0.收件箱','外部'));
  await assert.rejects(h.files.read('0.收件箱/外部/任意.md'),{code:'INVALID_DIRECTORY'});
  await assert.rejects(h.files.read('../别处.md'),{code:'OUT_OF_SCOPE'});
  const p='0.收件箱/坏.md',raw='---\ntype: [\n---\n正文';await h.files.exclusiveFile(p,raw);
  await assert.rejects(h.run(write('update',{path:p,expected:raw,append:'内容'})),{code:'INVALID_YAML'});assert.equal(await h.files.read(p),raw);
  const created=await h.run(write('capture',{content:'普通输入'}));const expected=await h.files.read(created.path);
  await assert.rejects(h.run(write('update',{path:created.path,expected})),{code:'EMPTY_INPUT'});
  await assert.rejects(h.run(write('update',{path:created.path,expected,fields:{inbox_status:'unknown'}})),{code:'INVALID_STATUS'});
});

test('工作状态使用真实说明路径，仅更新获授权字段，不联动其他记录',async()=>{
  const h=await fixture(),p='02.独立任务/验收/任务说明.md',original=m.newDocument({type:'task',status:'not_started',progress:'原进度',next_step:'原下一步'},'任务正文');
  await h.files.exclusiveFile(p,original);await h.run(write('update',{path:p,expected:original,fields:{status:'in_progress',progress:'本次已完成'}}));
  assert.equal(m.documentParts(await h.files.read(p)).fields.next_step,'原下一步');
  const invalid='3.资源/假任务.md';await h.files.exclusiveFile(invalid,original);
  await assert.rejects(h.run(write('update',{path:invalid,expected:original,fields:{status:'completed'}})),{code:'INVALID_STATUS'});
});

test('附件目录和特殊名称保留；Markdown 链接编码可恢复实际路径',()=>{
  assert.equal(m.attachmentDirectory('./attachments','0.收件箱/标题/记录.md'),'0.收件箱/标题/attachments');
  assert.equal(m.attachmentDirectory('.','0.收件箱/手写.md'),'0.收件箱');
  assert.equal(m.attachmentDirectory('/','0.收件箱/手写.md'),'');
  assert.throws(()=>m.attachmentDirectory('./../私人','0.收件箱/手写.md'),{code:'ATTACHMENT_PATH'});
  const link=m.linkTo('0.收件箱/资料/a#[中].jsonl','0.收件箱/标题/记录.md');assert.match(link,/%23%5B/);assert.match(decodeURIComponent(link),/a#\[中\]\.jsonl/);
});

test('真实 CLI 的 stdin 按单字节发送中文和 emoji，写入原文完整',async()=>{
  const h=await fixture();await fs.mkdir(path.join(h.root,'scripts/vault'),{recursive:true});await fs.mkdir(path.join(h.root,'lib/vault'),{recursive:true});
  await fs.copyFile(path.join(repo,'scripts/vault/write.mjs'),path.join(h.root,'scripts/vault/write.mjs'));
  await fs.mkdir(path.join(h.root,'lib/config'),{recursive:true});
  await fs.copyFile(path.join(repo,'lib/config/target.cjs'),path.join(h.root,'lib/config/target.cjs'));
  await fs.writeFile(path.join(h.root,'lib/vault/index.js'),`module.exports=require(${JSON.stringify(path.join(repo,'lib/vault'))});`);
  const content='跨字节中文😀，完整原文。\n第二行',input=write('capture',{content,title:'中文😀标题'});
  const child=spawn(process.execPath,[path.join(h.root,'scripts/vault/write.mjs'),'--vault',h.root],{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  const done=new Promise(resolve=>child.on('close',resolve));
  for(const byte of Buffer.from(JSON.stringify(input))){child.stdin.write(Buffer.from([byte]));await new Promise(r=>setTimeout(r,1));}child.stdin.end();
  assert.equal(await done,0,err);const result=JSON.parse(out);assert.equal(result.ok,true);assert.ok((await h.files.read(result.path)).endsWith(content));
});
