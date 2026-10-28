const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inboxCatalog, InboxStore } = require('../inbox.js');

test('混合深度按属性识别，缺模板与辅助文件分别处理', () => {
  const fields = {
    '01.收件箱/手写.md': { type: 'inbox' },
    '01.收件箱/多层/任意/自定文件名.md': { type: 'inbox' },
    '01.收件箱/新文件.md': {},
    '01.收件箱/条目/说明.md': {},
    '01.收件箱/条目/源文件位置.md': {},
    '01.收件箱/条目/media/摘录.md': {},
    '01.收件箱/别的类型.md': { type: 'task' }
  };
  const list = inboxCatalog(Object.keys(fields).map(path => ({ path })), p => fields[p], './media');
  assert.deepEqual(list.map(e => e.kind), ['record','record','incomplete','uncertain','auxiliary','auxiliary','auxiliary']);
  assert.ok(list[2].inbox.warnings.some(s => s.includes('模板')));
  assert.ok(list[3].inbox.warnings.some(s => s.includes('身份不明')));
});

test('重复 ID 列出双方路径，缺可选 ID 不误报，无效状态时间仍可读', () => {
  const fields = {
    '01.收件箱/一.md': { type: 'inbox', id: 'same', inbox_status: 'broken' },
    '01.收件箱/深/二.md': { type: 'inbox', id: 'same' },
    '01.收件箱/三.md': { type: 'inbox', inbox_status: 'pending' }
  };
  const list = inboxCatalog(Object.keys(fields).map(path => ({ path })), p => fields[p], './attachments');
  assert.deepEqual(list[0].duplicates, ['01.收件箱/深/二.md']);
  assert.deepEqual(list[1].duplicates, ['01.收件箱/一.md']);
  assert.equal(list[2].duplicates.length, 0);
  assert.ok(list[0].inbox.warnings.some(s => s.includes('状态')));
  assert.equal(list[0].inbox.timestamp, null);
});

test('损坏 YAML 的详情保留完整原文并明确提示', () => {
  const store = new InboxStore({ vault: { adapter: { getBasePath: () => '/fixture/tannt' } } }, { getFrontMatterInfo: () => { throw new Error('invalid yaml'); } });
  const raw = '---\ntype: [\n---\n不能丢失的正文';
  const note = store.describe(raw, '01.收件箱/损坏.md');
  assert.equal(note.body, raw);
  assert.equal(note.invalidYaml, true);
  assert.ok(note.warnings.some(s => s.includes('YAML')));
});


test('明确指定目录里的原始 Markdown 按主笔记附件登记识别，不改原文件类型', () => {
  const fields = {
    '01.收件箱/主记录.md': { type: 'inbox', attachments: ['01.收件箱/原始资料/原会话.md'] },
    '01.收件箱/原始资料/原会话.md': { type: 'inbox' }
  };
  const entries = inboxCatalog(Object.keys(fields).map(path => ({path})), p => fields[p], './attachments');
  assert.deepEqual(entries.map(e => e.kind), ['record','auxiliary']);
});
