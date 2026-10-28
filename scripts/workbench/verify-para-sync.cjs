'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async function(app){
 assert.equal(app.vault.getName(),'tannt');const root=app.vault.adapter.getBasePath();
 const report={startedAt:new Date().toISOString(),crossDeviceVerified:false};
 const out=path.join(root,'.scratch/information-architecture-workflow/verification'),reportPath=path.join(out,'sync.json');
 let previous;try{previous=await fs.readFile(reportPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous!==undefined){const saved=path.join(out,`sync-before-retry-${Date.now()}-${randomUUID()}.json`);await fs.writeFile(saved,previous,{flag:'wx'});report.previousReport=path.relative(root,saved);}
 const readStableConfig=async configPath=>{
  const until=Date.now()+3000;let previousText;
  while(Date.now()<until){
   try{const text=await fs.readFile(configPath,'utf8'),value=JSON.parse(text);assert(value&&typeof value==='object'&&!Array.isArray(value));if(text===previousText)return value;previousText=text;}
   catch{previousText=undefined;}
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw Error('FNS config did not become stable valid JSON within 3 seconds; config was not changed');
 };
 const roots=['01.收件箱','02.独立任务','03.知识','04.资料','05.领域','06.经验'];
 try{
  const native=JSON.parse(await fs.readFile(path.join(root,'.scratch/information-architecture-workflow/verification/native.json'),'utf8'));assert(native.passed,'Native acceptance must complete first');
  const configPath=path.join(root,'.obsidian/plugins/fast-note-sync/data.json');assert((await fs.lstat(configPath)).isSymbolicLink(),'FNS config link missing');
  const config=await readStableConfig(configPath);
  await app.plugins.disablePluginAndSave('fast-note-sync');await app.plugins.enablePluginAndSave('fast-note-sync');
  const plugin=app.plugins.plugins['fast-note-sync'];assert(plugin,'FNS failed to reload');const until=Date.now()+60000;let stableSince=0;
  while(Date.now()<until){const idle=plugin.websocket.isAuth&&plugin.websocket.isOpen&&!plugin.isSyncing&&!plugin.isSyncRequesting&&!plugin.pendingNoteDeleteAcks.size&&!plugin.pendingFileDeleteAcks.size;if(idle){stableSince||=Date.now();if(Date.now()-stableSince>=10000)break;}else stableSince=0;await new Promise(r=>setTimeout(r,250));}
  assert(stableSince&&Date.now()-stableSince>=10000,'FNS did not settle after reload');
  assert.equal(plugin.settings.syncExcludeFolders,config.syncExcludeFolders);assert.equal(plugin.settings.syncExcludeWhitelist,config.syncExcludeWhitelist);assert.equal(plugin.settings.offlineDeleteSyncEnabled,config.offlineDeleteSyncEnabled);
  const retired=await require('./retire-para-legacy.cjs')(app,'verify');assert(retired.passed,retired.error||'Old paths were not retired');
  report.retirement={activeOldPaths:0,recycledOldPaths:retired.recycled};
  for(const name of roots)assert.equal(await app.vault.adapter.exists(name),false,'Old root reappeared: '+name);
  for(const name of ['0.收件箱','1.项目','2.领域','3.资源','4.存档'])assert(await app.vault.adapter.exists(name),'New root missing '+name);
  const fixtureOrigins={
   '4.存档/项目/工作台验收-PARA-融合架构/项目说明.md':'1.项目/工作台验收-PARA-融合架构/项目说明.md',
   '4.存档/资源/验收样例/PARA-融合架构/说明.md':'3.资源/验收样例/PARA-融合架构/说明.md'
  };
  assert.deepEqual([...native.fixturePaths].sort(),Object.keys(fixtureOrigins).sort(),'Unexpected acceptance fixtures');
  for(const file of native.fixturePaths){assert(await app.vault.adapter.exists(file),'Archived fixture missing');assert.equal(await app.vault.adapter.exists(fixtureOrigins[file]),false,'Active fixture reappeared: '+fixtureOrigins[file]);}
  assert((await fs.lstat(configPath)).isSymbolicLink(),'FNS overwrote config link');
  report.fnsEnabled=app.plugins.enabledPlugins.has('fast-note-sync');report.fnsLoaded=!!app.plugins.plugins['fast-note-sync'];report.runtimeConfigVerified=true;report.configSymlinkPreserved=true;report.legacyRootsAbsent=true;report.activeFixturePathsAbsent=true;report.passed=true;
 }catch(error){report.passed=false;report.error=error.stack;}
 report.completedAt=new Date().toISOString();await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');return report;
};
