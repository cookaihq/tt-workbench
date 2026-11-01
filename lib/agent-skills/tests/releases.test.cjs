'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const packages = require('../package.cjs');
const releases = require('../releases.cjs');
const github = require('../../github/releases.cjs');
const { fixture, skill, remote } = require('./fixtures.cjs');
async function source(t, names = ['one', 'two']) {
  const h = await fixture(t); await fs.mkdir(path.join(h.vault, 'skills')); await fs.writeFile(path.join(h.vault, 'skills/manifest.jsonc'), JSON.stringify({ skills: names }));
  const versions = new Map(names.map(n => [n, skill(n)]));
  const build = (batch, names, previousRaw = null, collect = async (_, name) => versions.get(name)) => releases.buildRelease({ root: h.vault, repository: 'example/workbench', batch, names, previousRaw, collect });
  return { ...h, versions, build };
}
test('元数据是唯一版本来源；包拒绝不一致版本、重复键、损坏和路径冲突', () => {
  const s = skill(); assert.equal(packages.metadata(s.files.get('SKILL.md').toString(), 'one').version, '1.0.0');
  assert.deepEqual(packages.decodeBundle(packages.encodeBundle(s)).manifest, s.manifest);
  assert.throws(() => packages.metadata(s.files.get('SKILL.md').toString().replace('metadata:', 'name: duplicate\nmetadata:'), 'one'), { code: 'INVALID_SKILL' });
  assert.throws(() => packages.encodeBundle({ ...s, manifest: { ...s.manifest, version: '1.0.1' } }), { code: 'INVALID_SKILL_PACKAGE' });
  const bad = { ...s.manifest, files: { ...s.manifest.files, '../escape': 'a'.repeat(64) } }; bad.contentHash = packages.contentHash(bad.files);
  assert.throws(() => packages.parseManifest(JSON.stringify(bad)), { code: 'INVALID_SKILL_PACKAGE' });
  const collision = { ...s.manifest, files: { ...s.manifest.files, runtime: 'a'.repeat(64) } }; collision.contentHash = packages.contentHash(collision.files);
  assert.throws(() => packages.parseManifest(JSON.stringify(collision)), { code: 'INVALID_SKILL_PACKAGE' });
  assert.throws(() => packages.decodeBundle(Buffer.from('invalid')), { code: 'INVALID_SKILL_PACKAGE' });
});
test('批次只构建选定项，完整继承未变化来源，首批与同版本变更有硬检查', async t => {
  const h = await source(t);
  await assert.rejects(h.build('skills-20261031.1', ['one']), { code: 'INCOMPLETE_CATALOG' });
  const first = await h.build('skills-20261031.1', ['one', 'two']); assert.equal(first.artifacts.size, 2);
  h.versions.set('one', skill('one', '1.1.0')); h.versions.set('two', skill('two', '99.0.0', 'unselected development'));
  const second = await h.build('skills-20261031.2', ['one'], first.raw, async (_, name) => { assert.equal(name, 'one'); return h.versions.get(name); });
  assert.deepEqual(second.catalog.skills.find(s => s.name === 'two'), first.catalog.skills.find(s => s.name === 'two'));
  assert.equal(second.artifacts.size, 1); assert.equal(second.catalog.skills.find(s => s.name === 'two').version, '1.0.0');
  h.versions.set('one', skill('one', '1.1.0', 'changed behavior'));
  await assert.rejects(h.build('skills-20261031.3', ['one'], second.raw), { code: 'IMMUTABLE_VERSION' });
  h.versions.set('one', skill('one', '1.1.0'));
  await assert.rejects(h.build('skills-20261031.3', ['one'], second.raw), { code: 'NO_SKILL_CHANGES' });
  assert.throws(() => releases.validateSuccessor(second.catalog, first.catalog, Buffer.from(first.raw.toString().trim())), { code: 'STALE_RELEASE_BASE' });
  assert.throws(() => releases.batchParts('skills-20260231.1'), { code: 'INVALID_BATCH' });
  assert.throws(() => releases.batchParts('one-v1.0.0'), { code: 'INVALID_BATCH' });
});
test('跨批次发现完整清单；仅一项变更不冒充所有项升级，忽略工作台与预发布', async t => {
  const h = await source(t), r = remote();
  const first = await h.build('skills-20261031.1', ['one', 'two']); r.add(first);
  h.versions.set('one', skill('one', '1.1.0'));
  const second = await h.build('skills-20261031.2', ['one'], first.raw); r.add(second);
  h.versions.set('two', skill('two', '1.2.0'));
  const third = await h.build('skills-20261101.1', ['two'], second.raw); r.add(third);
  r.releases.unshift({ tag_name: 'v99.0.0', assets: [] });
  r.releases.unshift({ tag_name: 'skills-20270101.1', prerelease: true, assets: [] });
  const result = await releases.discover({ repository: 'example/workbench', required: ['one', 'two'], request: r.request });
  assert.equal(result.catalog.batch, third.catalog.batch); assert.equal(result.complete, true);
  assert.deepEqual(result.catalog.skills.map(s => [s.name, s.version]), [['one', '1.1.0'], ['two', '1.2.0']]);
  assert.ok(Object.values(result.downloads).every(url => /\/releases\/assets\/\d+$/.test(url)));
  assert.ok(r.calls.every(url => !url.endsWith('/latest')));
});
test('缺附件或不完整新批次退到可用完整清单并明确检查不完整', async t => {
  const h = await source(t), r = remote(), first = await h.build('skills-20261031.1', ['one', 'two']); r.add(first);
  h.versions.set('one', skill('one', '1.1.0'));
  const second = await h.build('skills-20261031.2', ['one'], first.raw), missing = r.add(second);
  missing.assets = missing.assets.filter(a => a.name === releases.CATALOG);
  const result = await releases.discover({ repository: 'example/workbench', required: ['one', 'two'], request: r.request });
  assert.equal(result.catalog.batch, first.catalog.batch); assert.equal(result.complete, false); assert.equal(result.rejected.length, 1);
  const omitted = { ...second.catalog, active: ['one'], skills: second.catalog.skills.filter(s => s.name === 'one') };
  assert.throws(() => releases.parseCatalog(JSON.stringify(omitted), { required: ['one', 'two'] }), { code: 'INCOMPLETE_CATALOG' });
  assert.throws(() => releases.validateSuccessor(omitted, first.catalog, first.raw), { code: 'INCOMPLETE_CATALOG' });
});
test('请求短总预算、完整 Retry-After；分页未完成或网络失败不产生最新结论', async () => {
  assert.equal(github.retryAt('120', 1000), '1970-01-01T00:02:01.000Z');
  assert.equal(github.retryAt('Wed, 21 Oct 2037 07:28:00 GMT', 1000), '2037-10-21T07:28:00.000Z');
  assert.equal(github.retryAt('invalid'), null);
  const started = Date.now();
  await assert.rejects(github.withinBudget(() => new Promise(() => {}), 'https://api.github.com', { deadline: Date.now() + 30 }), { code: 'UPDATE_TIMEOUT' });
  assert.ok(Date.now() - started < 1000);
  await assert.rejects(releases.discover({ repository: 'example/workbench', request: async () => { throw Object.assign(Error('limited'), { code: 'RATE_LIMITED' }); } }), { code: 'RATE_LIMITED' });
  let pages = 0;
  await assert.rejects(github.listReleases('example/workbench', { request: async () => { pages++; return Buffer.from(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ tag_name: `v${pages}.${i}.0`, assets: [] })))); } }), { code: 'INCOMPLETE_RELEASES' });
  assert.equal(pages, 20);
});
test('联合、独立、联合发布共用继承链，Tag 格式及发布时间不决定 Skill 新旧', async t => {
  const h = await source(t), r = remote();
  const first = await h.build('v0.26.0', ['one', 'two']);
  h.versions.set('one', skill('one', '1.1.0'));
  const second = await h.build('skills-20261031.1', ['one'], first.raw);
  h.versions.set('one', skill('one', '1.2.0'));
  const third = await h.build('v0.27.0', ['one'], second.raw);
  // Deliberately reverse neither by date nor by version/tag.
  r.add(third, { published_at: '2026-01-01' }); r.add(first, { published_at: '2027-01-01' }); r.add(second);
  r.releases.unshift({ tag_name: 'v99.0.0', assets: [] });
  const result = await releases.discover({ repository: 'example/workbench', request: r.request });
  assert.equal(result.catalog.batch, 'v0.27.0'); assert.equal(result.catalog.sequence, 3); assert.equal(result.complete, true);
  assert.deepEqual(result.catalog.skills.find(i => i.name === 'two'), first.catalog.skills.find(i => i.name === 'two'));
  assert.equal(result.catalog.skills.find(i => i.name === 'one').version, '1.2.0');
  assert.throws(() => releases.validateSuccessor({ ...third.catalog, sequence: 9 }, second.catalog, second.raw), { code: 'STALE_RELEASE_BASE' });
  assert.throws(() => releases.parseCatalog(JSON.stringify({ ...first.catalog, sequence: 0 })), { code: 'INVALID_CATALOG' });
});
test('混合发布继承链分叉停止判断；联合清单损坏保留有效清单并提示不完整', async t => {
  const h = await source(t), r = remote(), first = await h.build('v0.26.0', ['one', 'two']); r.add(first);
  h.versions.set('one', skill('one', '1.1.0'));
  const left = await h.build('skills-20261031.1', ['one'], first.raw); r.add(left);
  const right = await h.build('v0.27.0', ['one'], first.raw), rightRemote = r.add(right);
  await assert.rejects(releases.discover({ repository: 'example/workbench', request: r.request }), { code: 'CONFLICTING_CATALOGS' });
  const asset = rightRemote.assets.find(a => a.name === releases.CATALOG);
  r.assets.set(asset.id, Buffer.from('invalid'));
  const result = await releases.discover({ repository: 'example/workbench', request: r.request });
  assert.equal(result.catalog.batch, left.catalog.batch); assert.equal(result.complete, false);
  assert.equal(result.rejected[0].batch, right.catalog.batch);
});
