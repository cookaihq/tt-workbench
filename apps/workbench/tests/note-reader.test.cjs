const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodePath = require('node:path');
const { NoteReader, businessPath } = require('../note-reader.js');

function harness({ name = 'tannt', content = '# 保留原文\n', statError, readError, symlinkAt } = {}) {
  const calls = { read: [], stat: [], lookup: [] };
  const files = ['欢迎.md', '04.资料/课程/示例/学习笔记.md', '05.领域/企业培训/企业/示例/项目/示例/项目说明.md',
    '02.独立任务/示例/任务说明.md', '03.知识/笔记/自定分类/想法.md', 'README.md', 'docs/设计.md',
    'apps/workbench/README.md', '.scratch/记录.md', '05.领域/示例/项目/示例/tmp/中间结果.md',
    '0.收件箱/输入.md', '1.项目/研究/项目说明.md', '2.领域/培训/领域说明.md', '3.资源/知识/认识.md', '4.存档/项目/历史/任务/验证/任务说明.md', '4.存档/项目/历史/tmp/中间结果.md'];
  const vault = {
    getName: () => name,
    adapter: { getBasePath: () => '/fixture/tannt' },
    getMarkdownFiles: () => files.map(path => ({ path, basename: path.split('/').pop().slice(0, -3) })),
    getAbstractFileByPath: path => {
      calls.lookup.push(path);
      return { path, basename: path.split('/').pop().slice(0, -3), extension: 'md' };
    },
    read: async file => { calls.read.push(file.path); if (readError) throw readError; return content; }
  };
  const reader = new NoteReader(vault, { lstat: async path => {
    calls.stat.push(path);
    if (statError) throw statError;
    return { isSymbolicLink: () => Boolean(symlinkAt) && nodePath.normalize(path) === nodePath.normalize(symlinkAt) };
  } });
  return { reader, vault, calls };
}

test('读取原文不重写未知属性、空行或正文', async () => {
  const content = '---\ncustom: 保留我\n---\n\n# 想法\n\n还未形成判断。\n';
  const { reader, calls } = harness({ content });
  const note = await reader.read('03.知识/笔记/自定分类/想法.md');
  assert.equal(note.content, content);
  assert.deepEqual(calls.read, ['03.知识/笔记/自定分类/想法.md']);
});

test('每次重新读取都取得实际文件接口的新内容', async () => {
  const { reader, vault } = harness();
  let content = '第一版';
  vault.read = async () => content;
  assert.equal((await reader.read('欢迎.md')).content, '第一版');
  content = '第二版';
  assert.equal((await reader.read('欢迎.md')).content, '第二版');
});

test('列表只列业务笔记，允许企业层级和用户自定知识分类', () => {
  const { reader, calls } = harness();
  const paths = reader.list().map(item => item.path);
  assert.equal(paths.length, 10);
  for (const root of ['0.收件箱','1.项目','2.领域','3.资源','4.存档']) assert.ok(paths.some(path => path.startsWith(root + '/')));
  assert.ok(paths.includes('03.知识/笔记/自定分类/想法.md'));
  assert.ok(paths.includes('05.领域/企业培训/企业/示例/项目/示例/项目说明.md'));
  assert.deepEqual(calls.read, []);
});

test('越出范围、隐藏配置、源码和路径穿越在文件访问前被拒绝', async () => {
  const { reader, calls } = harness();
  for (const path of ['/outside/notes.md', '../outside/notes.md', '04.资料/../README.md',
    '04.资料//笔记.md', '资料\\笔记.md', 'file:///outside/笔记.md', 'obsidian://open',
    '.obsidian/配置.md', 'docs/规则.md', 'README.md', '05.领域/示例/tmp/缓存.md',
    '03.知识/.内部/笔记.md', '04.资料/笔记\u0000.md']) {
    await assert.rejects(reader.read(path), { code: 'OUT_OF_SCOPE' });
  }
  assert.deepEqual(calls, { read: [], stat: [], lookup: [] });
});

test('符号链接目录在解析后续路径或读取正文前被拒绝', async () => {
  const { reader, calls } = harness({ symlinkAt: '/fixture/tannt/04.资料' });
  await assert.rejects(reader.read('04.资料/其他库/笔记.md'), { code: 'SYMLINK' });
  assert.deepEqual(calls.stat, [nodePath.normalize('/fixture/tannt/04.资料')]);
  assert.deepEqual(calls.read, []);
  assert.deepEqual(calls.lookup, []);
});

test('符号链接文件不会交给 Obsidian 读取', async () => {
  const { reader, calls } = harness({ symlinkAt: '/fixture/tannt/欢迎.md' });
  await assert.rejects(reader.read('欢迎.md'), { code: 'SYMLINK' });
  assert.deepEqual(calls.read, []);
});

test('不存在的文件给出明确结果，不能当成空白笔记', async () => {
  const { reader } = harness({ statError: { code: 'ENOENT' } });
  await assert.rejects(reader.read('欢迎.md'), { code: 'NOT_FOUND' });
});

test('读取权限错误保留明确错误类型且不暴露底层异常内容', async () => {
  for (const option of ['statError', 'readError']) {
    const { reader } = harness({ [option]: { code: 'EACCES', message: 'opaque backend detail' } });
    await assert.rejects(reader.read('欢迎.md'), error => error.code === 'PERMISSION'
      && error.message.includes('权限') && !error.message.includes('opaque'));
  }
});

test('普通读取失败不会返回成功内容', async () => {
  const { reader } = harness({ readError: new Error('connection lost') });
  await assert.rejects(reader.read('欢迎.md'), { code: 'READ_FAILED' });
});

test('不同名称的桌面库可用，非本地适配器拒绝文件访问', async () => {
  const { reader, calls } = harness({ name: 'another-vault' });
  assert.ok(Array.isArray(reader.list()));
  delete reader.vault.adapter.getBasePath;
  assert.throws(() => reader.list(), { code: 'WRONG_VAULT' });
  await assert.rejects(reader.read('欢迎.md'), { code: 'WRONG_VAULT' });
  assert.deepEqual(calls, { read: [], stat: [], lookup: [] });
});

test('空路径与非 Markdown 文件均需明确提示', () => {
  assert.throws(() => businessPath('  '), { code: 'EMPTY_PATH' });
  assert.throws(() => businessPath('04.资料/课程.mp4'), { code: 'NOT_MARKDOWN' });
  assert.equal(businessPath('04.资料/文章与视频/带 空格的笔记.md'), '04.资料/文章与视频/带 空格的笔记.md');
});
