'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const http = require('node:http');
const exec = require('node:util').promisify(require('node:child_process').execFile);
const { AgentBridge } = require('../agent-bridge.js');
const storage = require('../../../lib/runtime/storage.cjs');
const migration = require('../../../lib/runtime/migrate.cjs');
const repo = path.resolve(__dirname, '../../..');
const settings = vault => ({syncExcludeFolders:JSON.stringify(storage.protectedDirectories(vault))});
function plugin(vault) {
  return { app:{vault:{adapter:{getBasePath:()=>vault},configDir:'.obsidian'},plugins:{plugins:{'fast-note-sync':{settings:settings(vault)}}}}, reader:{assertVault(){},list(){return [];}} };
}
async function fixture(t, directory) {
  const parent = path.join(repo, 'tmp/bridge-shutdown');
  await fs.mkdir(parent, {recursive:true});
  const vault = await fs.mkdtemp(path.join(parent, 'test-'));
  if (directory) {
    await fs.mkdir(path.join(vault, storage.CONTROL), {recursive:true});
    await fs.writeFile(path.join(vault, storage.CONFIG), JSON.stringify({schema:1,directory,previousDirectories:[]}));
  }
  const bridge = new AgentBridge(plugin(vault));
  t.after(async()=>{
    await bridge.stop();
    assert.equal(path.dirname(vault),parent);
    await fs.rm(vault,{recursive:true,force:true});
  });
  return {vault,bridge,runtime:path.join(vault,storage.relative('',vault))};
}
async function markers(h) {
  const writers = await fs.readdir(path.join(h.runtime,'writers')).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const connection = await fs.stat(path.join(h.runtime,'agent-bridge.json')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
  return {writers:writers.length,connection};
}
function request(bridge, body) {
  let socket;
  const result = new Promise((resolve,reject)=>{
    socket = http.request({host:'127.0.0.1',port:bridge.server.address().port,path:'/request',method:'POST',headers:{authorization:`Bearer ${bridge.token}`,'content-type':'application/json'}}, response=>{
      let raw=''; response.setEncoding('utf8'); response.on('data',s=>raw+=s); response.on('end',()=>resolve({status:response.statusCode,...JSON.parse(raw)}));
    });
    socket.on('error',reject); socket.end(JSON.stringify(body));
  });
  return {result,abort:()=>socket.destroy()};
}
for (const directory of [undefined,'local/runtime']) for (const duringStartup of [false,true]) test(`synchronous host unload leaves no markers (${directory||'default'}, startup=${duringStartup})`, async t=>{
  const h=await fixture(t,directory);
  const child=`const {AgentBridge}=require(${JSON.stringify(path.join(repo,'apps/workbench/agent-bridge.js'))});
    const vault=process.argv[1], settings=${JSON.stringify(settings(h.vault))};
    const bridge=new AgentBridge({app:{vault:{adapter:{getBasePath:()=>vault}},plugins:{plugins:{'fast-note-sync':{settings}}}}});
    const started=bridge.start();
    const unload=()=>{void bridge.stop();process.exit(0);};
    if (${duringStartup}) unload(); else started.then(unload).catch(()=>process.exit(2));`;
  await exec(process.execPath,['-e',child,h.vault],{windowsHide:true,timeout:10000});
  assert.deepEqual(await markers(h),{writers:0,connection:false});
});
test('stop during startup, repeated stop and restart do not leave an extra service or lease', async t=>{
  const h=await fixture(t);
  const starting=h.bridge.start();
  await Promise.all([h.bridge.stop(),h.bridge.stop(),starting]);
  assert.deepEqual(await markers(h),{writers:0,connection:false});
  await Promise.all([h.bridge.start(),h.bridge.start()]);
  assert.deepEqual(await markers(h),{writers:1,connection:true});
  assert.equal((await request(h.bridge,{action:'info'}).result).ok,true);
  await Promise.all([h.bridge.stop(),h.bridge.stop()]);
  assert.deepEqual(await markers(h),{writers:0,connection:false});
});
test('disconnecting a client does not release the lease while its write is still executing', async t=>{
  const h=await fixture(t);
  let finish, entered;
  const active=new Promise(resolve=>entered=resolve), pending=new Promise(resolve=>finish=resolve);
  h.bridge.execute=async()=>{entered();await pending;return {saved:true};};
  await h.bridge.start();
  const call=request(h.bridge,{action:'capture',privacy:'ordinary',request_id:require('node:crypto').randomUUID(),content:'synthetic'});
  const response=call.result.catch(()=>null);
  await active; call.abort();
  let stopped=false;
  const stopping=h.bridge.stop().then(()=>stopped=true);
  try {
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(stopped,false);
    assert.equal((await markers(h)).writers,1);
    const plan=await migration.inspect({vault:h.vault,directory:'local/next'});
    assert.ok(plan.source.locks.some(p=>p.startsWith('writers/')));
  } finally { finish(); await stopping; await response; }
  assert.deepEqual(await markers(h),{writers:0,connection:false});
});
test('stop preserves changed connection and writer identities', async t=>{
  const h=await fixture(t);
  await h.bridge.start();
  const connection=path.join(h.runtime,'agent-bridge.json');
  const replacement=JSON.stringify({token:'foreign-test-owner',pid:process.pid,port:1});
  await fs.writeFile(connection,replacement);
  await h.bridge.stop();
  assert.equal(await fs.readFile(connection,'utf8'),replacement);
  await fs.unlink(connection);
  await h.bridge.start();
  const writer=path.join(h.runtime,'writers',(await fs.readdir(path.join(h.runtime,'writers')))[0]);
  const originalWriter=await fs.readFile(writer);
  await fs.writeFile(writer,'{"pid":123,"owner":"foreign"}');
  try {
    await assert.rejects(h.bridge.stop(),{code:'RUNTIME_BUSY'});
    assert.equal(await fs.readFile(writer,'utf8'),'{"pid":123,"owner":"foreign"}');
  } finally { await fs.writeFile(writer,originalWriter); await h.bridge.stop(); }
});
test('startup still respects migration gates, previous storage and unsafe paths', async t=>{
  for (const blocked of ['gate','previous','link']) {
    const h=await fixture(t);
    if (blocked==='gate') {
      await fs.mkdir(path.join(h.vault,storage.CONTROL),{recursive:true});
      await fs.writeFile(path.join(h.vault,storage.GATE),'synthetic migration');
    } else if (blocked==='previous') await fs.mkdir(path.join(h.vault,storage.PREVIOUS));
    else {
      await fs.mkdir(h.runtime,{recursive:true});
      await fs.mkdir(path.join(h.vault,'foreign'));
      await fs.symlink(path.join(h.vault,'foreign'),path.join(h.runtime,'writers'),'junction');
    }
    await assert.rejects(h.bridge.start(),{code:blocked==='gate'?'RUNTIME_BUSY':blocked==='previous'?'RUNTIME_MIGRATION_REQUIRED':'UNSAFE_RUNTIME'});
    assert.deepEqual(await markers(h),{writers:0,connection:false});
  }
});
test('the actual bridge stops for location migration and restarts in the new runtime', async t=>{
  const h=await fixture(t), p=h.bridge.plugin;
  p.agentBridge=h.bridge; p.issues={root:h.vault};
  p.fns={runtime:{
    async suspend(){return {enabled:true};},
    async restore(){p.app.plugins.plugins['fast-note-sync'].settings=settings(h.vault);},
    async inspect(){return {enabled:true,loaded:true,settings:settings(h.vault)};}
  }};
  const {RuntimeSettings}=require('../runtime-settings.js'), service=new RuntimeSettings(p);
  const backup=h.vault+'-backup';
  t.after(async()=>{assert.equal(path.dirname(backup),path.join(repo,'tmp/bridge-shutdown'));await fs.rm(backup,{recursive:true,force:true});});
  await h.bridge.start();
  const plan=await service.inspect(h.vault,'local/next');
  const result=await service.apply(h.vault,{plan,directory:'local/next',backup});
  assert.deepEqual(result.warnings,[]);
  assert.equal((await request(h.bridge,{action:'info'}).result).ok,true);
  assert.deepEqual(await markers(h),{writers:0,connection:false});
  assert.deepEqual(await markers({...h,runtime:path.join(h.vault,'local/next')}),{writers:1,connection:true});
  await h.bridge.stop();
  assert.deepEqual(await markers({...h,runtime:path.join(h.vault,'local/next')}),{writers:0,connection:false});
});
for(const unloadFirst of [false,true,'window']) test(`plugin startup waits for dependent plugins and ignores layout after unload (${unloadFirst})`, async t=>{
  const h=await fixture(t), ready=[], disposers=[], notices=[];
  const events=new (require('node:events').EventEmitter)();
  const hostWindow={setInterval:()=>1,addEventListener:(name,fn)=>events.on(name,fn),removeEventListener:(name,fn)=>events.off(name,fn)};
  const packages=require('../../../lib/workbench/package.cjs');
  await packages.installPackage(await packages.collectPackage(repo),{vault:h.vault});
  const module={exports:{}};
  class Plugin {
    async loadData(){return {};}
    register(fn){disposers.push(fn);}
    registerDomEvent(target,name,fn){target.addEventListener(name,fn);this.register(()=>target.removeEventListener(name,fn));}
    registerInterval(){} registerView(){} addRibbonIcon(){} addCommand(){} registerObsidianProtocolHandler(){}
  }
  const obsidian={Plugin,ItemView:class{},Component:class{},Notice:class{constructor(text){notices.push(text);}},apiVersion:'1.14.5'};
  const code=await fs.readFile(path.join(h.vault,'.obsidian/plugins/tt-workbench/main.js'),'utf8');
  require('node:vm').runInNewContext(code,{module,require:name=>name==='obsidian'?obsidian:require(name),console,window:hostWindow});
  const actual=new module.exports();
  actual.app={...plugin(h.vault).app,workspace:{onLayoutReady:fn=>ready.push(fn)}};
  actual.app.plugins.plugins={};
  actual.manifest={dir:'.obsidian/plugins/tt-workbench',version:'0.25.1'};
  await actual.onload();
  t.after(()=>actual.agentBridge.stop());
  actual.app.plugins.plugins['fast-note-sync']={settings:settings(h.vault)};
  if(unloadFirst===true)await Promise.all(disposers.map(fn=>fn()));
  await Promise.all(ready.map(fn=>fn()));
  assert.deepEqual(notices,[]);
  try {
    assert.deepEqual(await markers(h),unloadFirst===true?{writers:0,connection:false}:{writers:1,connection:true});
    if(unloadFirst==='window')events.emit('unload');
    else await Promise.all(disposers.map(fn=>fn()));
    assert.deepEqual(await markers(h),{writers:0,connection:false});
  } finally {await actual.agentBridge.stop();}
});
