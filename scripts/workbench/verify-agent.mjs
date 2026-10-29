import { request } from './agent-request.mjs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../',import.meta.url));
const report={checkedAt:new Date().toISOString(),entry:'本机 Codex 加载共用 Skill 后经 Node CLI 调用实际 Obsidian 保存模块',checks:[]};
const check=name=>report.checks.push({name,passed:true});
const write=body=>request({request_id:randomUUID(),privacy:'ordinary',...body});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const read=async p=>{for(let i=0;i<40;i++){const r=await request({action:'read',path:p});if(r.ok)return r;await pause(100);}throw Error('笔记没有进入实际索引');};
try{
  const info=await request({action:'info'});assert.equal(info.ok,true);assert.equal(info.vault,root.replace(/\/$/,''));report.timezone=info.timezone;
  const input={action:'capture',request_id:randomUUID(),privacy:'ordinary',title:'工作台验收-Agent保存',content:'来源原文占位：先保存输入，再决定是否推进。',sources:'https://example.org/source-a\nhttps://example.org/source-b',ai_summary:'这是单独标注的 AI 归纳验收内容。',judgment:'本人已表达的判断占位。',timezone:'Asia/Shanghai'};
  const saved=await request(input);assert.equal(saved.ok,true,saved.message);report.sample=saved.path;
  const original=await read(saved.path);assert.match(original.content,/created_timezone: "\+08:00"/);assert.match(original.content,/capture_entry: "agent"/);assert.match(original.content,/## AI 归纳/);assert.match(original.content,/## 本人判断/);
  const retry=await request(input);assert.equal(retry.path,saved.path);check('本机 Agent 保存原文、多个来源及分开的归纳和判断；明确时区生效且同请求重试不重复');
  const appended=await write({action:'append',path:saved.path,expected:original.content,content:'Agent 明确追加的文字。'});assert.equal(appended.ok,true,appended.message);const current=await read(saved.path);assert.ok(current.content.startsWith(original.content));assert.match(current.content,/inbox_status: "pending"/);
  const stale=await write({action:'append',path:saved.path,expected:original.content,content:'这是旧版本拟追加内容。'});assert.equal(stale.code,'CONFLICT');assert.ok(stale.conflictPath);assert.equal((await read(saved.path)).content,current.content);report.conflict=stale.conflictPath;check('明确追加保留创建值与整理状态，旧版本更新保留真实冲突文件');
  const reviewed=await write({action:'review',path:saved.path,expected:current.content,status:'reviewed'});assert.equal(reviewed.ok,true,reviewed.message);check('仅明确 review 操作修改整理状态');
  const task=info.notes.find(f=>f.path==='02.独立任务/工作台验收-研究会话切换/任务说明.md');const t=await read(task.path);
  const updated=await write({action:'work-update',path:task.path,expected:t.content,status:'in_progress',progress:'Agent 已完成一次保存入口验收。',next_step:'在工作台读取同一任务。'});assert.equal(updated.ok,true,updated.message);check('获授权的任务更新写回工作台使用的同一说明');
  const parent='05.领域/企业培训/企业/工作台验收企业/项目/工作台验收-第二场培训';const target=`${parent}/Agent保存验收-${Date.now()}.md`;
  const direct=await write({action:'create-note',path:target,content:'已明确属于当前项目的资料说明，直接保存到该项目。'});assert.equal(direct.ok,true,direct.message);const same=await write({action:'create-note',path:target,content:'不得覆盖'});assert.equal(same.ok,false);assert.ok((await read(target)).content.includes('直接保存到该项目'));report.direct=target;check('明确归属的内容直接进入既有项目，同名写入拒绝覆盖');
  const count=(await request({action:'info'})).notes.length;
  const privateResult=await request({action:'capture',request_id:randomUUID(),privacy:'suspected',content:'合成验收：非常私密的个人日记占位，无真实隐私。'});assert.equal(privateResult.code,'PRIVACY_REVIEW');assert.equal((await request({action:'info'})).notes.length,count);
  const boundary=await request({action:'read',path:'../tannt_pra/不得访问.md'});assert.equal(boundary.code,'OUT_OF_SCOPE');check('合成疑似私密输入被拒绝且没有新增记录；库外路径在读取前被拒绝');
  const cfg=JSON.parse(await readFile(path.join(root,'.system/.workbench-runtime/agent-bridge.json'),'utf8'));assert.equal((await stat(path.join(root,'.system/.workbench-runtime/agent-bridge.json'))).mode&0o777,0o600);
  const unauth=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:cfg.port,path:'/request',method:'POST',headers:{'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{"action":"info"}');});assert.equal(unauth,403);
  const fns=JSON.parse(await readFile(path.join(root,'.obsidian/plugins/fast-note-sync/data.json'),'utf8'));assert.ok(JSON.parse(fns.syncExcludeFolders).some(r=>r.pattern==='.system/.workbench-runtime/'));assert.equal(fns.syncExcludeWhitelist,'');check('连接文件权限为0600，未认证请求拒绝，实际 FNS 配置已排除运行数据且无白名单覆盖');
  report.passed=true;
}catch(e){report.passed=false;report.failure=e.stack;}
await writeFile(path.join(root,'docs/workbench/verification/08-agent-save.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
