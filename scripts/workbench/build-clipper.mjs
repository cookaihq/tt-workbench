import { readFile, writeFile } from 'node:fs/promises';
const source=await readFile(new URL('./browser-capture.js',import.meta.url),'utf8');
const uri='javascript:'+encodeURIComponent(source.replace(/^\/\*[^]*?\*\//,''));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>保存到工作台 收件箱</title><style>body{max-width:700px;margin:60px auto;padding:24px;background:#f4f3ee;color:#262c29;font:16px/1.8 system-ui}a{display:inline-block;background:#456551;color:white;padding:12px 20px;border-radius:8px}textarea{width:100%;height:100px}h1{font-size:26px}</style><h1>把网页选区保存到收件箱</h1><p>将下面的按钮拖到浏览器书签栏。在网页选中文字后点击这个书签；没有选中文字时保存当前网页链接。</p><a href="${uri}">保存到工作台</a><p>浏览器询问时选择打开 Obsidian。工作台会显示取得的文字、网页标题和来源；核对后点击“保存到收件箱”。原网页仍可继续浏览。</p><p>需要当前电脑已打开目标知识库并启用工作台；发起剪藏时明确填写目标库名。只保存文字和链接，不下载图片、视频或整个网页。过长选区会提示分段，不截断正文。</p><details><summary>手动添加书签</summary><p>书签名称填写“保存到工作台”，网址填写下面完整内容：</p><textarea readonly>${uri}</textarea></details></html>`;
await writeFile(new URL('../../apps/workbench/browser-clipper.html',import.meta.url),html);
console.log('已生成 apps/workbench/browser-clipper.html');
