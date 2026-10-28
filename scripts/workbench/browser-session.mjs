import { readFile } from 'node:fs/promises';
export async function browserSession(){
  const port=Number((await readFile(new URL('../../apps/workbench/data/browser-verification/DevToolsActivePort',import.meta.url),'utf8')).split('\n')[0]);
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page=pages.find(p=>p.type==='page'&&/^https:\/\/(help\.)?obsidian\.md\//.test(p.url));
  if(!page)throw Error('没有找到专用验收窗口的 Obsidian 官方文档页。');
  const ws=new WebSocket(page.webSocketDebuggerUrl),pending=new Map();let next=0;
  ws.addEventListener('message',e=>{const msg=JSON.parse(e.data);const req=pending.get(msg.id);if(req){pending.delete(msg.id);msg.error?req.reject(Error(msg.error.message)):req.resolve(msg.result);}});
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  return {call:(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));}),close:()=>ws.close(),page};
}
