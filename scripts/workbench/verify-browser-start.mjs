import { readFile,writeFile } from 'node:fs/promises';
import { browserSession } from './browser-session.mjs';
const browser=await browserSession();
try{
  const result=await browser.call('Runtime.evaluate',{expression:`(()=>{const p=[...document.querySelectorAll('p')].find(p=>p.innerText.includes('From personal notes')&&p.innerText.length>40);if(!p)throw Error('没有找到官方网页说明段落');const range=document.createRange();range.selectNodeContents(p);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return {title:document.title,source:location.href,text:selection.toString()};})()`,returnByValue:true});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.text);
  const selected=result.result.value;
  await writeFile(new URL('../../docs/workbench/verification/09-browser-selection.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),browser:'Google Chrome，独立验收用户目录',...selected},null,2)+'\n');
  const source=await readFile(new URL('./browser-capture.js',import.meta.url),'utf8');
  const capture=await browser.call('Runtime.evaluate',{expression:source,userGesture:true,returnByValue:true});if(capture.exceptionDetails)throw Error(capture.exceptionDetails.text);
  console.log(JSON.stringify({source:selected.source,title:selected.title,selectedLength:selected.text.length,dispatched:true}));
}finally{browser.close();}
