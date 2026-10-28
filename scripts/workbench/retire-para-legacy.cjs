'use strict';
// Retire only verified, backed-up legacy copies through the existing FNS
// online delete event. Never clear the remote recycle bin or change sync policy.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
const roots=['01.收件箱','02.独立任务','03.知识','04.资料','05.领域','06.经验'];
module.exports=async function(app,mode='probe'){
 assert.equal(app.vault.getName(),'tannt');assert(['probe','apply','finish','verify'].includes(mode));
 const base=app.vault.adapter.getBasePath(),dir=path.join(base,'apps/workbench/data/para-migration/fns-retirement');await fs.mkdir(dir,{recursive:true});
 const backup=JSON.parse(await fs.readFile(path.join(base,'apps/workbench/data/para-migration/reappeared-backup/manifest.json'),'utf8'));
 const audit=JSON.parse(await fs.readFile(path.join(base,'apps/workbench/data/para-migration/reappeared-backup/audit.json'),'utf8'));assert.equal(audit.semantic_change_files,0);assert(backup.complete);
 const migration=JSON.parse(await fs.readFile(path.join(base,'apps/workbench/data/para-migration/manifest.json'),'utf8'));const moved=new Map(migration.entries.map(e=>[e.from,e]));
 const p=app.plugins.plugins['fast-note-sync'];assert(p,'FNS must be enabled');
 const wait=async(fn,label)=>{const end=Date.now()+60000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,250))}throw Error('Timeout '+label)};
 await wait(()=>p.websocket.isAuth&&p.websocket.isOpen&&!p.isSyncing&&!p.isSyncRequesting,'authenticated idle FNS');
 async function listed(recycled){const found=[];for(const kind of ['Note','File'])for(const root of roots){let page=1,total=1;do{const data=await p.api['get'+kind+'List'](page,100,recycled,root+'/');const rows=data.list??[];assert(Array.isArray(rows),'Invalid list response');total=Number(data.pager?.totalPages)||Math.max(1,Math.ceil(Number(data.pager?.totalRows||0)/100));assert(total<1000,'Unexpected pagination');for(const item of rows)if(item.path?.startsWith(root+'/'))found.push({kind,path:item.path,pathHash:item.pathHash});page++;}while(page<=total)}return found;}
 const report={startedAt:new Date().toISOString(),mode,files:backup.files.length,trashed:[],folders:[],remoteWritesVia:'FNS online vault delete events',offlineDeleteSettingChanged:false};
 const save=()=>fs.writeFile(path.join(dir,mode+'.json'),JSON.stringify(report,null,2)+'\n');
 try{
  for(const e of backup.files){assert(moved.has(e.path));assert.equal(hash(await fs.readFile(path.join(base,e.backup_path))),e.sha256);assert.equal(hash(await fs.readFile(path.join(base,e.new_target))),moved.get(e.path).after);}
  if(mode==='probe'){
   report.active=await listed(false);report.unexpected=report.active.filter(e=>!moved.has(e.path));assert.equal(report.unexpected.length,0,'Unmapped server path');report.passed=true;
  }else{
   if(mode==='apply'){
    const probe=JSON.parse(await fs.readFile(path.join(dir,'probe.json'),'utf8'));assert(probe.passed,'Probe required');
    const localPaths=new Set(backup.files.map(e=>e.path));report.remoteOnly=probe.active.filter(e=>!localPaths.has(e.path));
    for(const e of report.remoteOnly){const entry=moved.get(e.path);assert(entry&&e.kind==='File','Unknown remote-only entry');assert.equal(hash(await fs.readFile(path.join(base,'apps/workbench/data/para-migration/before',e.path))),entry.before);assert.equal(hash(await fs.readFile(path.join(base,entry.to))),entry.after);}
    for(const e of backup.files)assert.equal(hash(await fs.readFile(path.join(base,e.path))),e.sha256,'Source changed '+e.path);
    for(const e of backup.files){
     assert(p.websocket.isAuth&&p.websocket.isOpen,'FNS connection lost');
     assert.equal(hash(await fs.readFile(path.join(base,e.path))),e.sha256,'Source changed '+e.path);
     // trashSystem reconciles the vault and emits delete, with no fallback to
     // a newly created vault-local .trash directory.
     assert(await app.vault.adapter.trashSystem(e.path),'System trash refused '+e.path);
     report.trashed.push(e.path);if(report.trashed.length%20===0)await save();
     if(report.trashed.length===1){await wait(async()=>{const active=await listed(false),recycle=await listed(true);return !active.some(f=>f.path===e.path)&&recycle.some(f=>f.path===e.path);},'first online delete is recoverable');report.firstDeleteRecoverable=true;await save();}
    }
    for(const e of report.remoteOnly){await p.concurrencyLimiter.waitForSlot(e.path);p.websocket.SendMessage('FileDelete',{vault:p.settings.vault,path:e.path,pathHash:e.pathHash},undefined,()=>p.pendingFileDeleteAcks.add(e.path));}
   }
   if(mode==='finish'){
    const prior=JSON.parse(await fs.readFile(path.join(dir,'apply.json'),'utf8'));assert.equal(prior.recycled?.length,363,'Verify initial retirement before finishing');
    for(const entry of migration.entries){const content=await fs.readFile(path.join(base,entry.from)).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(!content)continue;assert.equal(hash(content),entry.before,'Late download differs from original '+entry.from);assert.equal(hash(await fs.readFile(path.join(base,'apps/workbench/data/para-migration/before',entry.from))),entry.before);assert(await app.vault.adapter.trashSystem(entry.from),'Late copy could not be trashed');report.trashed.push(entry.from);}
   }
   let active=[],recycle=[];
   const expectedRemote=JSON.parse(await fs.readFile(path.join(dir,'probe.json'),'utf8')).active;
   await wait(async()=>{active=await listed(false);recycle=await listed(true);const gone=new Set(active.map(e=>e.path)),recoverable=new Set(recycle.map(e=>e.path));report.pending=expectedRemote.filter(e=>gone.has(e.path)||!recoverable.has(e.path)).map(e=>e.path);return !report.pending.length;},'remote active absence and recycle presence');
   report.activeLegacy=active;report.recycled=recycle.filter(e=>moved.has(e.path));assert.equal(active.length,0,'Legacy remote entries remain');
   const directories=[];async function collect(relative){const entries=await fs.readdir(path.join(base,relative),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(entries===null)return;for(const e of entries){assert(e.isDirectory()&&!e.isSymbolicLink(),'Unexpected remaining content '+relative+'/'+e.name);await collect(relative+'/'+e.name);}directories.push(relative);}if(mode==='apply'||mode==='finish')for(const root of roots)await collect(root);
   if(mode==='apply'||mode==='finish')for(const relative of directories){
    const absolute=path.join(base,relative);
    const entries=await fs.readdir(absolute).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(entries===null)continue;assert.equal(entries.length,0,'Unexpected folder content '+relative);assert(await app.vault.adapter.trashSystem(relative));report.folders.push(relative);
   }
   report.localLegacyRoots=await Promise.all(roots.map(async r=>({root:r,exists:await app.vault.adapter.exists(r)})));assert(report.localLegacyRoots.every(r=>!r.exists));report.passed=true;
  }
 }catch(error){report.passed=false;report.error=error.stack;}
 report.completedAt=new Date().toISOString();await save();return {passed:report.passed,files:report.files,active:report.active?.length,trashed:report.trashed.length,recycled:report.recycled?.length,error:report.error};
};
