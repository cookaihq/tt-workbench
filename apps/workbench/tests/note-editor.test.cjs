const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NoteEditor, patchFields, appendSupplement } = require('../note-editor.js');

// JSON-valued YAML subset for unit fixtures. Native validation separately uses
// Obsidian's real YAML parser with comments, multiline fields and unknown keys.
const parseYaml = raw => Object.fromEntries(raw.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(l => {
  const i = l.indexOf(':'); if (i < 1) throw new Error('invalid');
  return [l.slice(0,i), JSON.parse(l.slice(i+1).trim())];
}));
const original = '---\r\n# keep this comment\r\ntype: "inbox"\r\ninbox_status: "pending"\r\ncreated: "2026-10-01 09:00:00"\r\ncreated_timezone: "+08:00"\r\nunknown: {"nested":[1,"x"]}\r\n---\r\n\r\n  原始输入\r\n\r\n尾部\r\n';

test('局部状态更新保留未知属性、注释、CRLF 和逐字原始正文', () => {
  const next = patchFields(original, { inbox_status: 'reviewed' }, parseYaml);
  assert.equal(next, original.replace('inbox_status: "pending"', 'inbox_status: "reviewed"'));
  const supplemented = appendSupplement(next, '来源 https://example.org\n本人新想法', new Date('2026-10-17T01:00:00Z'));
  assert.ok(supplemented.startsWith(next));
  assert.match(supplemented, /后续补充/);
  assert.ok(supplemented.includes('来源 https://example.org\n本人新想法'));
});

test('缺属性可增加状态但不生成类型、创建时间或时区', () => {
  const next = patchFields('尚未应用模板\n', { inbox_status: 'reviewed' }, parseYaml);
  assert.equal(next, '---\ninbox_status: "reviewed"\n---\n\n尚未应用模板\n');
  assert.throws(() => patchFields('---\ntype: [\n---\n原文', { inbox_status: 'pending' }, parseYaml), { code: 'INVALID_YAML' });
});

const fs = require('node:fs/promises');
const path = require('node:path');
async function harness(current = original) {
  const parent = path.resolve(__dirname, '../../../tmp/vault-module-tests'); await fs.mkdir(parent, {recursive:true});
  const root = await fs.mkdtemp(path.join(parent, 'editor-'));
  await fs.mkdir(path.join(root, '01.收件箱')); const notePath = '01.收件箱/一.md';
  await fs.writeFile(path.join(root,notePath), current);
  const vault = {adapter:{getBasePath:()=>root},process:()=>{throw Error('Must not call Obsidian');}};
  const io = {...fs}; const editor = new NoteEditor({vault},{io});
  return {editor,root,io,notePath,current:()=>fs.readFile(path.join(root,notePath),'utf8')};
}

test('陈旧原文不覆盖别处修改，拟保存完整版本持久保留', async () => {
  const h=await harness(original+'别处新增\n'); let conflict;
  await assert.rejects(h.editor.update(h.notePath,original,{append:'本次补充'}), e=>{conflict=e.conflictPath;return e.code==='CONFLICT';});
  assert.equal(await h.current(),original+'别处新增\n');
  assert.match(await fs.readFile(path.join(h.root,conflict),'utf8'),/本次补充/);
});

test('两个写入者从同一快照更新，后一个冲突且两个版本都保留', async () => {
  const h=await harness();const other=new NoteEditor({vault:{adapter:{getBasePath:()=>h.root}}});
  const results=await Promise.allSettled([h.editor.update(h.notePath,original,{append:'第一处'}),other.update(h.notePath,original,{append:'第二处'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const failure=results.find(r=>r.status==='rejected').reason;assert.equal(failure.code,'CONFLICT');
  const current=await h.current(),conflict=await fs.readFile(path.join(h.root,failure.conflictPath),'utf8');
  assert.ok((current.includes('第一处')&&conflict.includes('第二处'))||(current.includes('第二处')&&conflict.includes('第一处')));
});

test('原子替换失败保留原文和恢复材料，不依赖 Obsidian 更新接口', async () => {
  const h=await harness(); h.io.rename=async()=>{throw Object.assign(Error('injected EACCES'),{code:'EACCES'});};
  let recovery;
  await assert.rejects(h.editor.update(h.notePath,original,{append:'不能丢失'}),e=>{recovery=e.recoveryPath;return e.code==='WRITE_FAILED';});
  assert.equal(await h.current(),original);assert.match(await fs.readFile(path.join(h.root,recovery,'after.txt'),'utf8'),/不能丢失/);
  assert.equal(await fs.readFile(path.join(h.root,recovery,'before.txt'),'utf8'),original);
  assert.ok((await fs.readdir(path.join(h.root,recovery))).every(name=>!name.endsWith('.md')));
});
