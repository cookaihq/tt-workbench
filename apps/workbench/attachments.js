"use strict";
const fs=require('node:fs/promises'),path=require('node:path');
const {NoteWriteError}=require('./note-editor.js');
const IMAGE=/\.(png|jpe?g|gif|webp)$/i;
const {AttachmentWriter, attachmentPath}=require("./shared.js");
function unsupportedMarkup(content) {
  // Angle brackets delimit Markdown destinations as well as HTML. Inspect
  // tags after excluding inline and reference link destinations.
  const inspected = content
    .replace(/(\]\(\s*)<[^<>\r\n]*>/g, '$1destination')
    .replace(/^( {0,3}\[[^\]\r\n]+\]:\s*)<[^<>\r\n]*>/gm, '$1destination');
  return /!\s*\[|<[!?]|<\/?[a-z][a-z0-9-]*(?:\s+[^<>]*?)?\/?>/i.test(inspected);
}
class AttachmentStore{
  constructor(plugin){this.plugin=plugin;}
  async safe(relative,create=false){
    attachmentPath(relative);let absolute=this.plugin.app.vault.adapter.getBasePath();
    const parts=relative.split('/');for(let i=0;i<parts.length;i++){
      absolute=path.join(absolute,parts[i]);
      try{const s=await fs.lstat(absolute);if(s.isSymbolicLink()||i<parts.length-1&&!s.isDirectory())throw new NoteWriteError('ATTACHMENT_PATH','附件路径包含符号链接或非目录，未访问库外文件。');}
      catch(e){if(e.code!=='ENOENT')throw e;if(create&&i<parts.length-1)await fs.mkdir(absolute);else if(i<parts.length-1)throw e;}
    }return absolute;
  }
  async save(input){
    return new AttachmentWriter(this.plugin.editor).save(input);
  }
  async resolve(target,source){
    const p=this.plugin,file=p.app.metadataCache.getFirstLinkpathDest(target.split('#')[0],source);
    if(!file)throw new Error('附件未到达当前设备或链接不存在');await this.safe(file.path);return file;
  }
  async render(content,article,note,component,render){
    const entries=[],stamp='TTATTACHMENT'+Date.now();
    const mark=(target,raw)=>{const id=stamp+entries.length+'END';entries.push({id,target,raw});return '\n\n'+id+'\n\n';};
    let safe=content.replace(/!\[\[([^\]\n]+)\]\]/g,(raw,target)=>mark(target.split('|')[0],raw)).replace(/!\[[^\]\n]*\]\((<[^>]+>|[^)\n]+)\)/g,(raw,target)=>mark(target.replace(/^<|>$/g,''),raw));
    if(unsupportedMarkup(safe)){article.createEl('p',{text:'此段包含暂不支持的嵌入或 HTML，显示原文。',cls:'tw-source-notice'});article.createEl('pre',{text:content,cls:'tw-source'});return;}
    await render(safe);
    for(const entry of entries){const el=[...article.querySelectorAll('p')].find(el=>el.textContent===entry.id);if(!el)continue;el.empty();el.addClass('tw-attachment');
      if(/^https?:\/\//i.test(entry.target)){el.createSpan({text:'外部图片链接（未下载）：'+entry.target});continue;}
      try{let target;try{target=decodeURIComponent(entry.target);}catch{target=entry.target;}
        const file=await this.resolve(target,note.path);
        if(IMAGE.test(file.path)){const img=el.createEl('img',{attr:{alt:file.name,src:this.plugin.app.vault.getResourcePath(file),loading:'lazy'}});img.addEventListener('error',()=>{img.remove();el.createSpan({text:'图片当前无法显示：'+file.path});});}
        else{el.createSpan({text:'附件：'+file.path});}
      }catch(e){el.createSpan({text:entry.raw+' · '+e.message});}
    }
    article.querySelectorAll('input,button').forEach(el=>{el.disabled=true;});
  }
}
module.exports={AttachmentStore,attachmentPath};
