'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const packages = require('../../../lib/workbench/package.cjs');
const { WorkbenchUpdates, compareVersions, repositoryName } = require('../updates.js');
const { excludeWorkbenchCode, codeDirectories, inspectWorkbenchExclusions } = require('../../../lib/fns/workbench-scope.cjs');
const { normalize, validateScope } = require('../../../lib/fns/rules.cjs');
const { matches } = require('../../../lib/fns/legacy-rules.cjs');

function bundle(version, extra = {}) {
  const files = new Map(Object.entries({ 'manifest.json': JSON.stringify({ id: 'tt-workbench', version, minAppVersion: '1.8.7' }), 'main.js': `module.exports = ${JSON.stringify(version)};`, 'styles.css': 'body {}', 'updates.js': '// updater', ...extra }).map(([name, text]) => [name, Buffer.from(text)]));
  return { files, release: { schema: 1, id: 'tt-workbench', version, files: Object.fromEntries([...files].map(([name, bytes]) => [name, packages.hash(bytes)])) } };
}
async function fixture(t) {
  const base = path.resolve(__dirname, '../../../tmp/update-tests'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'different-vault-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configDir = 'custom-settings', target = path.join(root, configDir, 'plugins/tt-workbench');
  await packages.installPackage(bundle('0.21.0', { 'old.js': '// old' }), { vault: root, configDir });
  await fs.writeFile(path.join(root, 'note.md'), 'unchanged');
  let latest, id = 0; const assets = new Map(), requests = [];
  const publish = data => {
    const releaseId = ++id, bundleId = ++id;
    const encoded = packages.encodeBundle(data);
    assets.set(releaseId, Buffer.from(JSON.stringify(data.release))); assets.set(bundleId, encoded);
    latest = { tag_name: 'v' + data.release.version, draft: false, prerelease: false, assets: [{ id: releaseId, name: 'release.json', size: assets.get(releaseId).length }, { id: bundleId, name: 'tt-workbench.bundle.json.gz', size: encoded.length }] };
    return { releaseId, bundleId, encoded };
  };
  const request = async url => {
    requests.push(url);
    if (url.includes('/releases?')) return Buffer.from(JSON.stringify([latest]));
    const value = assets.get(Number(url.split('/').at(-1)));
    if (!value) throw Error('missing');
    return value;
  };
  const service = new WorkbenchUpdates({ vault: root, configDir, version: '0.21.0', appVersion: '1.14.5', repository: 'example/workbench', request });
  return { root, target, configDir, service, publish, assets, requests };
}
test('版本及公开仓库地址校验；未配置不联网也不读取知识库 Git', async t => {
  assert.equal(compareVersions('0.22.0', '0.9.0'), 1);
  assert.throws(() => compareVersions('next', '1.0.0'), { code: 'INVALID_VERSION' });
  assert.equal(repositoryName('https://github.com/example/workbench'), 'example/workbench');
  assert.throws(() => repositoryName('https://elsewhere.invalid/code'), { code: 'INVALID_REPOSITORY' });
  const h = await fixture(t); await h.service.configure('');
  assert.equal((await h.service.check()).kind, 'unconfigured'); assert.equal(h.requests.length, 0);
});
test('固定发布附件完成真实文件升级，保留笔记、用户设置和恢复副本', async t => {
  const h = await fixture(t); h.publish(bundle('0.22.0', { 'new.js': '// new' }));
  assert.equal((await h.service.check()).kind, 'available');
  h.publish(bundle('0.23.0'));
  await fs.writeFile(path.join(h.target, 'data.json'), '{"device":true}');
  const result = await h.service.install();
  assert.equal(result.kind, 'installed', result.message); assert.equal(result.latest, '0.22.0');
  assert.equal(JSON.parse(await fs.readFile(path.join(h.target, 'manifest.json'))).version, '0.22.0');
  assert.equal(await fs.readFile(path.join(h.target, 'data.json'), 'utf8'), '{"device":true}');
  assert.equal(await fs.readFile(path.join(h.root, 'note.md'), 'utf8'), 'unchanged');
  assert.equal(JSON.parse(await fs.readFile(path.join(result.recovery, 'manifest.json'))).version, '0.21.0');
  await assert.rejects(fs.stat(path.join(h.target, 'old.js')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(h.root, '.git')), { code: 'ENOENT' });
});
test('网络错误、相同版本、本地较新分别报告；失败不冒充最新版', async t => {
  const h = await fixture(t); h.publish(bundle('0.20.0')); assert.equal((await h.service.check()).kind, 'ahead');
  h.publish(bundle('0.21.0')); assert.equal((await h.service.check()).kind, 'current');
  h.service.request = async () => { throw Error('offline'); }; assert.equal((await h.service.check()).kind, 'error');
});

test('跨页读取工作台正式版本，忽略 GitHub Latest、Skill 批次和草稿；尊重限流冷却', async t => {
  const h = await fixture(t), published = h.publish(bundle('0.22.0'));
  const calls = [];
  h.service.request = async url => {
    calls.push(url);
    if (new URL(url).searchParams.get('page') === '1') return Buffer.from(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ tag_name: 'skills-20261031.' + (i + 1), draft: false, prerelease: false }))));
    if (new URL(url).searchParams.get('page') === '2') return Buffer.from(JSON.stringify([
      { tag_name: 'v9.0.0', draft: true }, { tag_name: 'v8.0.0', prerelease: true },
      { tag_name: 'v0.22.0', assets: [{ id: published.releaseId, name: 'release.json' }, { id: published.bundleId, name: 'tt-workbench.bundle.json.gz', size: published.encoded.length }] }
    ]));
    return h.assets.get(Number(url.split('/').at(-1)));
  };
  assert.equal((await h.service.check()).latest, '0.22.0'); assert.ok(calls.some(url => url.includes('page=2'))); assert.ok(!calls.some(url => url.endsWith('/latest')));
  let count = 0;
  h.service.request = async () => { count++; throw Object.assign(Error('limited'), { code: 'RATE_LIMITED', retryAfter: new Date(Date.now() + 60000).toISOString() }); };
  assert.equal((await h.service.check()).kind, 'error'); await h.service.check(); assert.equal(count, 1);
});

test('正式核心更新拒绝夹带开发 Skill，下载包不能换掉已检查的管理来源', async t => {
  const h = await fixture(t), { workbench } = require('../../../lib/agent-skills/tests/fixtures.cjs');
  const candidate = workbench(); h.publish(candidate);
  assert.equal((await h.service.check()).kind, 'error');
  candidate.release.skillSource = { kind: 'release', batch: 'skills-20261031.1', sha256: 'a'.repeat(64) };
  const published = h.publish(candidate); assert.equal((await h.service.check()).kind, 'available');
  candidate.release.skillSource.sha256 = 'b'.repeat(64);
  const tampered = packages.encodeBundle(candidate);
  h.assets.set(published.bundleId, tampered); h.service.status.bundleSize = tampered.length;
  assert.equal((await h.service.install()).kind, 'error');
  assert.equal(JSON.parse(await fs.readFile(path.join(h.target, 'manifest.json'))).version, '0.21.0');
});
test('工作台下载限流保留冷却截止时间，重新检查不会提前请求', async t => {
  const h = await fixture(t); h.publish(bundle('0.22.0')); await h.service.check();
  let calls = 0;
  h.service.request = async () => { calls++; throw Object.assign(Error('cooldown'), { code: 'RATE_LIMITED', retryAfter: new Date(Date.now() + 60000).toISOString() }); };
  assert.equal((await h.service.install()).kind, 'error');
  assert.equal((await h.service.check()).kind, 'error'); await h.service.install();
  assert.equal(calls, 1); assert.equal(JSON.parse(await fs.readFile(path.join(h.target, 'manifest.json'))).version, '0.21.0');
});
test('本机修改和并发安装锁均保留旧插件', async t => {
  const h = await fixture(t); h.publish(bundle('0.22.0')); await h.service.check();
  await fs.writeFile(path.join(h.target, 'main.js'), '// local edit');
  assert.match((await h.service.install()).message, /本机修改/);
  assert.equal(await fs.readFile(path.join(h.target, 'main.js'), 'utf8'), '// local edit');
  const lock = path.join(path.dirname(h.target), 'tt-workbench.install-lock'); await fs.writeFile(lock, 'busy');
  await fs.writeFile(path.join(h.target, 'main.js'), bundle('0.21.0').files.get('main.js'));
  await h.service.check(); assert.match((await h.service.install()).message, /安装锁/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'busy');
});
test('拒绝损坏包、越界路径、本机数据覆盖和不兼容版本', async t => {
  const h = await fixture(t), broken = bundle('0.22.0'); broken.files.set('main.js', Buffer.from('corrupted'));
  h.publish(broken); await h.service.check(); assert.equal((await h.service.install()).kind, 'error');
  const traversal = bundle('0.22.0'); traversal.release.files['../escape'] = packages.hash(Buffer.from('bad'));
  h.publish(traversal); assert.equal((await h.service.check()).kind, 'error');
  h.publish(bundle('0.22.0', { 'data.json': '{}' })); assert.equal((await h.service.check()).kind, 'error');
  h.publish(bundle('0.22.0', { 'manifest.json': JSON.stringify({ id: 'tt-workbench', version: '0.22.0', minAppVersion: '2.0.0' }) }));
  await h.service.check(); assert.match((await h.service.install()).message, /2.0.0/);
  assert.equal(JSON.parse(await fs.readFile(path.join(h.target, 'manifest.json'))).version, '0.21.0');
});

test('代码排除保留设备设置，重复设置无变化，白名单不能覆盖代码', () => {
  const config = { apiToken: 'synthetic', configSyncOtherDirs: '[{"pattern":".agents"}]', syncExcludeFolders: '[{"pattern":".system/.workbench-runtime/","caseSensitive":true}]', syncExcludeWhitelist: '' };
  const result = excludeWorkbenchCode(config);
  assert.equal(result.config.apiToken, config.apiToken); assert.equal(result.config.configSyncOtherDirs, config.configSyncOtherDirs);
  const rules = normalize(result.config);
  validateScope(rules, codeDirectories());
  for (const directory of codeDirectories()) for (const item of [directory, directory + '/file.js']) assert.ok(rules.syncExcludeFolders.some(rule => matches(item, rule)), item);
  assert.equal(excludeWorkbenchCode(result.config).added.length, 0);
  assert.throws(() => excludeWorkbenchCode({ ...config, syncExcludeWhitelist: '[{"pattern":".system/.workbench-runtime/.*"}]' }), { code: 'PROTECTED_SCOPE' });
});

test('应用旧 FNS 发布不能撤销已经配置的工作台代码排除', async () => {
  const { FnsSyncService } = require('../../../lib/fns/sync.cjs');
  const old = { syncExcludeFolders: '[{"pattern":".system/.workbench-runtime/"},{"pattern":"config/fns-config/"}]' };
  const local = { rules: normalize(excludeWorkbenchCode(old).config) };
  const service = new FnsSyncService({ vault: process.cwd(), runtime: {} });
  await assert.rejects(service.writeRules({}, local, {}, { rules: normalize(old) }), { code: 'PROTECTED_SCOPE' });
});

test('打开排除状态检查即读取全部目录，父目录覆盖和本机加载同时核验', async () => {
  const config = excludeWorkbenchCode({ syncExcludeFolders: '[{"pattern":".obsidian"}]' }).config;
  const service = { options: {}, local: async () => ({ rules: normalize(config) }), runtime: { inspect: async () => ({ loaded: true, settings: config }) } };
  const report = await inspectWorkbenchExclusions(service);
  assert.equal(report.status, 'configured'); assert.equal(report.configured, true);
  assert.ok(report.directories.every(item => item.excluded));
  for (const directory of ['.obsidian/plugins/tt-workbench', '.obsidian/plugins/tt-workbench-recovery']) assert.ok(report.directories.some(item => item.path === directory));
  assert.ok(!report.paths.some(item => item.path.includes('tannt-workbench')));
  assert.ok(report.paths.some(item => item.path === '.obsidian/plugins/tt-workbench.install-lock' && item.kind === 'file'));
  assert.ok(report.paths.some(item => item.path === '.obsidian/community-plugins.json' && item.kind === 'file'));
});

test('仅部分目录排除时列出缺项，白名单覆盖不能显示为已设置', async () => {
  const config = { syncExcludeFolders: '[{"pattern":".system/.workbench-runtime/"}]' };
  const service = { options: {}, local: async () => ({ rules: normalize(config) }), runtime: { inspect: async () => { throw Error('not needed'); } } };
  const report = await inspectWorkbenchExclusions(service);
  assert.equal(report.status, 'needs-setup'); assert.equal(report.canConfigure, true);
  assert.deepEqual(report.directories.filter(item => item.excluded).map(item => item.path), ['.system/.workbench-runtime']);
  const complete = excludeWorkbenchCode({}).config;
  service.local = async () => ({ rules: normalize({ ...complete, syncExcludeWhitelist: '[{"pattern":".system/.workbench-runtime/.*"}]' }) });
  const conflict = await inspectWorkbenchExclusions(service);
  assert.equal(conflict.status, 'needs-setup'); assert.equal(conflict.directories.find(item => item.path === '.system/.workbench-runtime').excluded, false);
});

test('配置已保存但 FNS 未启用或仍加载旧规则时显示待生效，自定义配置目录正确', async () => {
  const configDir = 'obsidian-settings', config = excludeWorkbenchCode({}, configDir).config;
  const service = { options: { configDir }, local: async () => ({ rules: normalize(config) }), runtime: { inspect: async () => ({ loaded: false }) } };
  const stopped = await inspectWorkbenchExclusions(service);
  assert.equal(stopped.configured, true); assert.equal(stopped.status, 'pending');
  assert.ok(stopped.directories.some(item => item.path === 'obsidian-settings/plugins/tt-workbench'));
  service.runtime.inspect = async () => ({ loaded: true, settings: {} });
  assert.equal((await inspectWorkbenchExclusions(service)).status, 'pending');
  service.runtime.inspect = async () => ({ loaded: true, settings: config });
  assert.equal((await inspectWorkbenchExclusions(service)).status, 'configured');
});

test('无法读到本机配置时显示待核验，不把失败当成尚未排除或输出配置内容', async () => {
  const service = { options: {}, local: async () => { throw Error('synthetic-secret-in-parser-error'); } };
  const report = await inspectWorkbenchExclusions(service);
  assert.equal(report.status, 'unknown'); assert.equal(report.canConfigure, false);
  assert.ok(report.directories.every(item => item.excluded === null));
  assert.ok(!JSON.stringify(report).includes('synthetic-secret'));
});
