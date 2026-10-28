#!/usr/bin/env node
'use strict';
// Explicit, version-checked migration for this vault's approved PARA layout.
// plan is read-only to business files; apply copies and verifies before unlinking;
// originals and expected outputs remain in excluded runtime storage for recovery.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const {documentParts,patchFields,newDocument}=require('../../lib/vault/document');
const {localCreation}=require('../../lib/vault/time');
const {rewriteLinks}=require('../../lib/vault/task-transfer');
const root=path.resolve(__dirname,'../..'), runtime='apps/workbench/data/para-migration';
const oldRoots=['01.收件箱','02.独立任务','03.知识','04.资料','05.领域','06.经验'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const abs=p=>{assert(!path.isAbsolute(p)&&!p.split('/').includes('..'));return path.join(root,p)};
async function exists(p){return Boolean(await fs.lstat(abs(p)).catch(e=>{if(e.code==='ENOENT')return null;throw e}))}
async function walk(p){const out=[];for(const e of await fs.readdir(abs(p),{withFileTypes:true})){const q=p?`${p}/${e.name}`:e.name;if(e.isSymbolicLink())throw Error('SYMLINK '+q);if(e.isDirectory())out.push(...await walk(q));else if(e.isFile())out.push(q);else throw Error('SPECIAL '+q)}return out}
function referenceNames(files,baseline){
 assert(Array.isArray(baseline.resolvedLinks),'Capture resolved links before planning the migration');
 const names=new Set(files);
 for(const link of baseline.resolvedLinks){assert(typeof link.target==='string'&&!path.posix.isAbsolute(link.target)&&!link.target.split('/').includes('..'),'Invalid baseline link target');names.add(link.target);}
 return names;
}
function destination(p){
 if(p.startsWith('01.收件箱/'))return p.replace('01.收件箱/','0.收件箱/');
 if(p.startsWith('02.独立任务/'))return '1.项目/'+(p.includes('/工作台验收-')?'工作台验收':'Skill 设计与验收研究')+'/任务/'+p.slice('02.独立任务/'.length);
 if(p.startsWith('03.知识/笔记/'))return p.replace('03.知识/笔记/','3.资源/知识/');
 if(p.startsWith('03.知识/专题/'))return p.replace('03.知识/专题/','3.资源/专题/');
 if(p.startsWith('04.资料/飞书知识库/'))return p.replace('04.资料/','3.资源/');
 if(p.startsWith('04.资料/'))return p.replace('04.资料/','3.资源/来源/');
 if(p==='06.经验/README.md')return '3.资源/知识/经验索引.md';
 if(p.startsWith('06.经验/'))return p.replace('06.经验/','3.资源/知识/');
 if(p.startsWith('05.领域/')){
  const parts=p.split('/'),i=parts.indexOf('项目');
  if(i>0)return '1.项目/'+parts.slice(i+1).join('/');
  if(p.startsWith('05.领域/内容创作/账号/'))return p.replace('05.领域/内容创作/账号/','3.资源/对象/发布账号/');
  if(p.startsWith('05.领域/企业培训/培训内容/'))return p.replace('05.领域/企业培训/培训内容/','3.资源/可复用内容/培训内容/');
  if(p.endsWith('/不要迷信最聪明的模型.md'))return '3.资源/知识/不要迷信最聪明的模型.md';
  if(parts.includes('选题'))return '3.资源/创作选题/'+parts.slice(2).join('/');
  return p.replace('05.领域/','2.领域/');
 }
 return p;
}
function transformed(content,from,to,moves,names){
 let result=rewriteLinks(content,from,to,moves,names,root);const f=documentParts(result).fields,patch={};
 for(const k of ['lark_body_path','original','project_path'])if(typeof f[k]==='string'&&moves[f[k]])patch[k]=moves[f[k]];
 if(from.startsWith('05.领域/')&&path.basename(from)==='项目说明.md'){
  const a=from.split('/'),i=a.indexOf('项目');patch.area=a[1];if(i>2)patch.group=a.slice(2,i).join('/');
  if(a[1]==='内容创作')patch.directions=[a[2]];
  if(a[2]==='企业')patch.company=a[3];
 }
 if(/工作台验收/.test(from)&&!from.endsWith('/不要迷信最聪明的模型.md')&&['project','task','content-direction','content-idea','publishing-account','training-content'].includes(f.type))patch.test_fixture=true;
 result=Object.keys(patch).length?patchFields(result,patch):result;
 if(f.lark_content_role==='embed'){
  const parts=documentParts(result),bodyPath=parts.fields.lark_body_path;
  assert(typeof bodyPath==='string'&&bodyPath.endsWith('.md'),'Invalid shared body path '+to);
  const embed=/^(\s*)!\[\[([^\]\r\n]+)\]\](\s*)$/.exec(parts.body),target=bodyPath.slice(0,-3);
  assert(embed&&[bodyPath,target].includes(embed[2]),'Shared embed contains other content; preserve and reconcile '+to);
  result=parts.prefix+`${embed[1]}![[${target}]]${embed[3]}`;
 }
 return result;
}
async function plan(){
 assert.equal(path.basename(root),'tannt');assert(!(await exists(`${runtime}/manifest.json`)),'Existing plan: use verify/apply rather than overwrite');
 const wiki=JSON.parse(await fs.readFile(abs('tmp/information-architecture-workflow/wiki-check.json'),'utf8'));
 assert(wiki.complete);for(const s of Object.values(wiki.spaces))assert(!s.remote_changes.length&&!s.local_changes.length&&!s.remote_removed.length,'Wiki changed; reconcile first');
 const all=(await Promise.all(oldRoots.map(walk))).flat();
 const top=(await fs.readdir(root,{withFileTypes:true})).filter(e=>e.isFile()&&e.name.endsWith('.md')&&!['README.md','AGENTS.md','CLAUDE.md','GLOSSARY.md'].includes(e.name)).map(e=>e.name);
 const attachments=await exists('attachments')?await walk('attachments'):[];
 // Resolution includes unchanged engineering targets captured by Obsidian;
 // this does not add them to the editable business-file migration scope.
 const baseline=JSON.parse(await fs.readFile(abs(`${runtime}/app-before.json`),'utf8'));
 const names=referenceNames([...all,...top,...attachments],baseline),moves=Object.fromEntries(all.map(p=>[p,destination(p)]));
 assert.equal(new Set(Object.values(moves)).size,all.length,'Destination collision');
 const entries=[],edits=[];
 for(const p of all){const to=moves[p];assert(!(await exists(to)),'Destination exists '+to);const before=await fs.readFile(abs(p));let after=before;
  if(p.endsWith('.yaml')&&/schema:\s*["']?tannt-cloud-file\/v1/.test(before.toString()))throw Error('Cloud coordination required '+p);
  if(p.endsWith('.md'))after=Buffer.from(transformed(before.toString('utf8'),p,to,moves,names));
  entries.push({from:p,to,before:hash(before),after:hash(after),bytes:before.length,fixture:/工作台验收/.test(p)&&!p.endsWith('/不要迷信最聪明的模型.md')});
  await fs.mkdir(path.dirname(abs(`${runtime}/before/${p}`)),{recursive:true});await fs.writeFile(abs(`${runtime}/before/${p}`),before,{flag:'wx'});
  if(!before.equals(after)){await fs.mkdir(path.dirname(abs(`${runtime}/after/${to}`)),{recursive:true});await fs.writeFile(abs(`${runtime}/after/${to}`),after,{flag:'wx'});}
 }
 for(const p of top){const before=await fs.readFile(abs(p),'utf8'),after=transformed(before,p,p,moves,names);if(after!==before){edits.push({path:p,before,after});}}
 const now=new Date(),created=localCreation(now),newFiles={};
 const makeProject=(name,fixture,body)=>newDocument({type:'project',title:name,status:'not_started',...created,id:randomUUID(),...(fixture?{test_fixture:true}:{})},body);
 newFiles['1.项目/Skill 设计与验收研究/项目说明.md']=makeProject('Skill 设计与验收研究',false,'# Skill 设计与验收研究\n\n## 项目范围\n\n研究 Skill 的设计审阅与真实使用验收办法，包括流程与对话审阅、多轮用户场景及真实宿主入口。承接既有研究任务，不因目录迁移启动新的研究。\n\n## 当前重点\n\n[[1.项目/Skill 设计与验收研究/任务/Skill 设计审阅与真实使用验收方案研究/任务说明|Skill 设计审阅与真实使用验收方案研究]]\n\n任务保留原状态、历史调研和未完成验证；项目说明在本次归属迁移时创建。\n');
 newFiles['1.项目/工作台验收/项目说明.md']=makeProject('工作台验收',true,'# 工作台验收\n\n本项目承接原有四项独立验收任务，保存历史验证资产，不代表本人真实业务工作。任务状态按原记录保留；创建本容纳项目不启动测试。\n\n## 任务\n\n'+all.filter(p=>p.startsWith('02.独立任务/工作台验收')&&p.endsWith('/任务说明.md')).map(p=>`- [[${moves[p]}|${p.split('/')[1]}]]`).join('\n')+'\n');
 const manifest={schema:'tannt-para-migration/v1',createdAt:now.toISOString(),phase:'prepared',wikiCheck:wiki,entries,edits,newFiles};
 await fs.writeFile(abs(`${runtime}/manifest.json`),JSON.stringify(manifest,null,2),{flag:'wx'});return summary(manifest);
}
function summary(m){return {phase:m.phase,files:m.entries.length,bytes:m.entries.reduce((n,e)=>n+e.bytes,0),rewritten:m.entries.filter(e=>e.before!==e.after).length,rootEdits:m.edits.length,newProjects:Object.keys(m.newFiles).length,manifest:`${runtime}/manifest.json`}}
async function read(){return JSON.parse(await fs.readFile(abs(`${runtime}/manifest.json`),'utf8'))}
async function output(e){const p=e.before===e.after?`${runtime}/before/${e.from}`:`${runtime}/after/${e.to}`;const b=await fs.readFile(abs(p));assert.equal(hash(b),e.after,'Staged content mismatch');return b}
async function verify(m){for(const e of m.entries)assert.equal(hash(await fs.readFile(abs(e.to))),e.after,e.to);for(const e of m.edits)assert.equal(await fs.readFile(abs(e.path),'utf8'),e.after,e.path);for(const [p,v]of Object.entries(m.newFiles))assert.equal(await fs.readFile(abs(p),'utf8'),v,p);return summary(m)}
async function apply(){
 const m=await read();if(m.phase==='complete')return verify(m);
 const paused=JSON.parse(await fs.readFile(abs(`${runtime}/app-paused.json`),'utf8'));assert(paused.fnsUnloaded&&paused.workbenchUnloaded);
 const enabled=JSON.parse(await fs.readFile(abs('.obsidian/community-plugins.json'),'utf8'));assert(!enabled.includes('fast-note-sync'),'Pause FNS first');
 for(const e of m.entries){if(await exists(e.from))assert.equal(hash(await fs.readFile(abs(e.from))),e.before,'Source changed '+e.from);else assert.equal(m.phase,'cleanup','Missing source '+e.from);if(await exists(e.to))assert.equal(hash(await fs.readFile(abs(e.to))),e.after,'Destination changed '+e.to);}
 for(const e of m.edits){const v=await fs.readFile(abs(e.path),'utf8');assert(v===e.before||v===e.after,'Referrer changed '+e.path);}
 for(const [p,v] of Object.entries(m.newFiles))if(await exists(p))assert.equal(await fs.readFile(abs(p),'utf8'),v,'New project collision');
 for(const e of m.entries){if(await exists(e.to))continue;await fs.mkdir(path.dirname(abs(e.to)),{recursive:true});await fs.writeFile(abs(e.to),await output(e),{flag:'wx'});}
 for(const [p,v]of Object.entries(m.newFiles)){await fs.mkdir(path.dirname(abs(p)),{recursive:true});if(!(await exists(p)))await fs.writeFile(abs(p),v,{flag:'wx'});}
 for(const e of m.edits){const current=await fs.readFile(abs(e.path),'utf8');if(current===e.after)continue;assert.equal(current,e.before);await fs.writeFile(abs(e.path),e.after);}
 await verify(m);m.phase='cleanup';await fs.writeFile(abs(`${runtime}/manifest.json`),JSON.stringify(m,null,2));
 for(const e of m.entries)if(await exists(e.from)){assert.equal(hash(await fs.readFile(abs(e.from))),e.before,'Source changed during copy');assert.equal(hash(await fs.readFile(abs(e.to))),e.after);await fs.unlink(abs(e.from));}
 async function prune(p){for(const e of await fs.readdir(abs(p),{withFileTypes:true})){assert(e.isDirectory(),'Unexpected source '+p+'/'+e.name);await prune(p+'/'+e.name)}await fs.rmdir(abs(p));}
 for(const p of oldRoots)if(await exists(p))await prune(p);
 await verify(m);m.phase='complete';m.completedAt=new Date().toISOString();await fs.writeFile(abs(`${runtime}/manifest.json`),JSON.stringify(m,null,2));return summary(m);
}
async function rollback(){
 const m=await read();await verify(m);for(const e of m.entries)if(await exists(e.from))assert.equal(hash(await fs.readFile(abs(e.from))),e.before);
 for(const e of m.entries){await fs.mkdir(path.dirname(abs(e.from)),{recursive:true});if(!(await exists(e.from)))await fs.copyFile(abs(`${runtime}/before/${e.from}`),abs(e.from),fs.constants.COPYFILE_EXCL);assert.equal(hash(await fs.readFile(abs(e.from))),e.before);}
 for(const e of m.edits){assert.equal(await fs.readFile(abs(e.path),'utf8'),e.after);await fs.writeFile(abs(e.path),e.before);}
 for(const e of m.entries){assert.equal(hash(await fs.readFile(abs(e.to))),e.after);await fs.unlink(abs(e.to));}
 for(const [p,v]of Object.entries(m.newFiles)){assert.equal(await fs.readFile(abs(p),'utf8'),v);await fs.unlink(abs(p));}
 m.phase='rolled-back';await fs.writeFile(abs(`${runtime}/manifest.json`),JSON.stringify(m,null,2));return summary(m);
}
if(require.main===module){const mode=process.argv[2];Promise.resolve().then(()=>mode==='plan'?plan():mode==='apply'?apply():mode==='verify'?read().then(verify):mode==='rollback'?rollback():Promise.reject(Error('Usage: migrate-para.cjs plan|apply|verify|rollback'))).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1})}
module.exports={destination,transformed,referenceNames};
