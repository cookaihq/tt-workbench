const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { projectDirectory, workMetadata, WorkStore, WORK_STATES, workVisible, outputUses, USE_FIELDS } = require('../work-items.js');
const shared = require('../shared.js');
const { documentParts, newDocument } = shared;
const { WorkUI } = require('../work-ui.js');

test('项目集中保存，不需要领域，已有分类参数不再制造目录层级', () => {
  assert.equal(projectDirectory({area:'企业培训',mode:'enterprise',company:'企业甲',name:'第一期'}),'1.项目/第一期');
  assert.equal(projectDirectory({area:'企业培训',mode:'general',name:'课程研发'}),'1.项目/课程研发');
  assert.equal(projectDirectory({area:'内容创作',direction:'AI实践',name:'一篇文章'}),'1.项目/一篇文章');
  assert.equal(projectDirectory({area:'社群运营',group:'成员社群/第一组',name:'本月活动'}),'1.项目/本月活动');
  assert.equal(projectDirectory({name:'调研'}),'1.项目/调研');
});

test('空名称、越界与保留名称在任何文件写入前拒绝', () => {
  for(const name of ['', '../私人库', '.obsidian', '甲/乙', 'tmp', '任务']) assert.throws(()=>projectDirectory({ name }));
});

test('项目字段来自说明笔记，分组来自实际路径，缺失状态可发现', () => {
  const item=workMetadata('05.领域/社群运营/社群甲/小组乙/项目/本月/项目说明.md',{type:'project',title:'本月计划'});
  assert.equal(item.group,'社群甲/小组乙');assert.equal(item.statusLabel,'项目状态缺失或无效');
  assert.equal(workMetadata('05.领域/社群运营/文件.md',{type:'project'}),null);
  assert.equal(workMetadata('04.资料/其他/项目/甲/项目说明.md',{type:'project'}),null);
  assert.deepEqual(Object.values(WORK_STATES),['待开始','进行中','暂停','已完成','已取消']);
});

test('创建请求包含状态与目标，目标文字不进入 YAML，不预建任务', () => {
  const store=new WorkStore({vault:{},assertVault(){}},{});
  const request=store.prepareProject({area:'研究',name:'一个问题',goal:'原始目标\n---\n复杂目标正文'});
  assert.equal(request.path,'1.项目/一个问题/项目说明.md');
  assert.equal(documentParts(request.document).fields.status,'not_started');
  assert.match(request.document,/## 目标与范围\n\n原始目标\n---\n复杂目标正文/);
  assert.equal(request.document.includes('任务说明.md'),false);
});

test('任务必须选择新项目，存档和旧项目不能继续创建任务', async () => {
  const reader = { vault:{}, assertVault(){}, read: async path => ({ path, content:newDocument({ type:'project', title:'研究', status:'paused' }, '# 研究') }) };
  const store = new WorkStore(reader, {});
  await assert.rejects(store.prepareTask({name:'验证',goal:'完成验证'}), {code:'PROJECT_REQUIRED'});
  await assert.rejects(store.prepareTask({name:'验证',goal:'完成验证',projectPath:'4.存档/项目/研究/项目说明.md'}), {code:'ARCHIVED_PROJECT'});
  await assert.rejects(store.prepareTask({name:'验证',goal:'完成验证',projectPath:'05.领域/研究/项目/研究/项目说明.md'}), {code:'LEGACY_WRITE'});
  const task = await store.prepareTask({name:'验证',goal:'完成验证',projectPath:'1.项目/研究/项目说明.md'});
  assert.equal(task.path,'1.项目/研究/任务/验证/任务说明.md');
});

test('活跃、暂停、已结束和存档独立筛选，未知状态保留核对入口', () => {
  assert.equal(workVisible({status:'paused'},'current'),false);
  assert.equal(workVisible({status:'paused'},'paused'),true);
  assert.equal(workVisible({status:'completed'},'history'),true);
  assert.equal(workVisible({status:'completed',archived:true},'history'),false);
  assert.equal(workVisible({status:'in_progress',archived:true},'current'),false);
  assert.equal(workVisible({status:'in_progress',archived:true},'archived'),true);
  assert.equal(workVisible({status:undefined},'current'),true);
});

test('项目的验收样例标记传播到其任务，真实项目不受影响', () => {
  const fields = new Map([
    ['1.项目/样例/项目说明.md',{type:'project',test_fixture:true}],
    ['1.项目/样例/任务/检查/任务说明.md',{type:'task'}],
    ['1.项目/实际/项目说明.md',{type:'project'}]
  ]);
  const ui = new WorkUI({plugin:{work:{}},app:{metadataCache:{getCache:path=>({frontmatter:fields.get(path)})}}});
  const items = ui.catalog([...fields.keys()].map(path=>({path})));
  assert.deepEqual(items.map(item=>item.test_fixture),[true,true,false]);
});

test('用途逐项更新保留其他用途和自定义属性，实际使用需要版本依据', async () => {
  let saved;
  const store = new WorkStore({vault:{}},{update:async (...args)=>{saved=args;return {path:args[0]};}});
  const first = {id:'first',title:'课程讲义',status:'planned',custom:'保留'};
  const second = {id:'second',title:'社群分享',status:'planned',version:'初稿'};
  const note = {path:'3.资源/讲义.md',content:newDocument({type:'note',custom:'正文属性',output_uses:[first,second]},'# 讲义\n原文')};
  const value = {...Object.fromEntries(USE_FIELDS.map(key=>[key,''])),id:'first',title:'课程讲义',status:'used',version:'[[4.存档/项目/交付/讲义-v1.md]]'};
  await store.saveUse(note,value);
  assert.equal(saved[1],note.content);
  assert.equal(saved[2].fields.output_uses[0].custom,'保留');
  assert.deepEqual(saved[2].fields.output_uses[1],second);
  assert.deepEqual(Object.keys(saved[2].fields),['output_uses']);
  await assert.rejects(store.saveUse(note,{...value,version:''}),{code:'VERSION_REQUIRED'});
  assert.deepEqual(outputUses({}),[]);
  assert.throws(()=>outputUses({output_uses:[first,first]}),{code:'INVALID_USES'});
});

for (const kind of ['project', 'material']) {
  test(`${kind} 归档失败沿用请求，成功恢复后相同内容可以再次归档`, async t => {
    const parent = path.resolve(__dirname, '../../../tmp/work-items-tests');
    await fs.mkdir(parent, { recursive: true });
    const root = await fs.mkdtemp(path.join(parent, `${kind}-`));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const files = new shared.VaultFiles(root);
    const reader = { vault: { adapter: { getBasePath: () => root } }, read: async notePath => ({ path: notePath, content: await files.read(notePath) }) };
    const store = new WorkStore(reader, {});
    let active, directory;
    if (kind === 'project') {
      const project = await shared.execute(root, { action: 'create-project', name: '重复归档', goal: '验证完整往返', request_id: randomUUID(), privacy: 'ordinary' });
      active = project.path; directory = path.posix.dirname(active);
    } else {
      directory = '3.资源/重复归档'; active = `${directory}/说明.md`;
      await files.exclusiveFile(active, newDocument({ type: 'note', id: randomUUID() }, '# 原始说明'));
    }
    const storedDirectory = directory.replace(kind === 'project' ? '1.项目/' : '3.资源/', kind === 'project' ? '4.存档/项目/' : '4.存档/资源/');
    const archived = storedDirectory + active.slice(directory.length), original = await files.read(active);
    await files.exclusiveFile(`${directory}/附件.txt`, '附件必须原样往返');
    await files.exclusiveFile('3.资源/引用.md', `[[${active}]]`);
    const move = async (notePath, action) => {
      const note = await reader.read(notePath);
      return kind === 'project' ? store.relocate(note, action) : store.relocateMaterial(note, path.posix.dirname(notePath), action);
    };

    await fs.mkdir(path.join(root, storedDirectory), { recursive: true });
    await assert.rejects(move(active, 'archive'), { code: 'PATH_CONFLICT' });
    const retryId = [...store.relocations.values()][0];
    assert.ok(retryId);
    await assert.rejects(move(active, 'archive'), { code: 'PATH_CONFLICT' });
    assert.deepEqual([...store.relocations.values()], [retryId]);
    await fs.rmdir(path.join(root, storedDirectory));
    assert.equal((await move(active, 'archive')).path, archived);
    const receipt = JSON.parse(await fs.readFile(path.join(root, '.system/.workbench-runtime/vault-io/transfers', `${retryId}.json`), 'utf8'));
    assert.equal(receipt.phase, 'complete');
    assert.equal((await move(archived, 'restore')).path, active);
    assert.equal(await files.read(active), original, 'Restored content must reuse the original cache key');
    assert.equal((await move(active, 'archive')).path, archived);
    assert.equal(await files.read(archived), original);
    assert.equal(await fs.readFile(path.join(root, storedDirectory, '附件.txt'), 'utf8'), '附件必须原样往返');
    assert.equal((await files.read('3.资源/引用.md')).trim(), `[[${archived}]]`);
    await assert.rejects(files.read(active), { code: 'ENOENT' });
    assert.equal(store.relocations.size, 0, 'Only incomplete attempts retain a request ID');
  });
}
