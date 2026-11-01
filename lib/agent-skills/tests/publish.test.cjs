'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture, skill, workbench } = require('./fixtures.cjs');
const core = require('../../workbench/package.cjs');
const { buildRelease } = require('../releases.cjs');
const { publishRelease } = require('../publish.cjs');
const commit = 'a'.repeat(40);
async function fixtureAPI(t, batch = 'skills-20261031.1') {
  const h = await fixture(t); await fs.mkdir(path.join(h.vault, 'skills')); await fs.writeFile(path.join(h.vault, 'skills/manifest.jsonc'), '{"skills":["one"]}');
  const build = await buildRelease({ root: h.vault, repository: 'example/workbench', batch, names: ['one'], collect: async () => skill() });
  if (batch.startsWith('v')) {
    const bundle = workbench(batch.slice(1));
    bundle.release.skillSource = { kind: 'release', batch, sha256: core.hash(build.raw) };
    const { encodePluginZip } = await import('../../../scripts/workbench/zip.mjs');
    build.coreArtifacts = new Map([
      ['release.json', Buffer.from(JSON.stringify(bundle.release, null, 2) + '\n')],
      ['tt-workbench.bundle.json.gz', core.encodeBundle(bundle)], ['tt-workbench.zip', encodePluginZip(bundle)]
    ]);
  }
  const calls = [], bytes = new Map(); let remote, id = 0, latest = null;
  const api = {
    latestCatalog: async () => { calls.push('base'); return latest; },
    findRelease: async () => remote,
    createDraft: async data => { assert.equal(data.make_latest, 'false'); assert.equal(data.draft, true); calls.push('draft'); return remote = { id: 1, ...data, assets: [], html_url: 'https://github.com/example/workbench/releases/tag/' + data.tag_name }; },
    upload: async (_, name, content) => { calls.push('upload:' + name); const asset = { id: ++id, name, size: content.length }; remote.assets.push(asset); bytes.set(id, content); },
    download: async asset => { calls.push('verify:' + asset.name); return bytes.get(asset.id); },
    ensureTag: async (_, sha) => { assert.equal(sha, commit); calls.push('tag'); },
    tagCommit: async () => commit,
    publish: async (_, data) => { assert.equal(data.make_latest, batch.startsWith('v') ? 'true' : 'false'); assert.equal(data.draft, false); calls.push('publish'); remote = { ...remote, ...data }; }
  };
  return { build, api, calls, bytes, latest: value => { latest = value; }, remote: () => remote };
}
test('附件完整上传并下载核验后才正式发布，明确禁止占用 Latest，重复执行不再写入', async t => {
  const h = await fixtureAPI(t), result = await publishRelease({ build: h.build, commit, api: h.api });
  assert.equal(result.published, true); assert.equal(h.remote().draft, false);
  const published = h.calls.indexOf('publish');
  for (const name of [...h.build.artifacts.keys(), 'skills-release.json']) assert.ok(h.calls.indexOf('verify:' + name) < published);
  assert.equal(h.calls.slice(0, published).filter(c => c === 'base').length, 2);
  h.calls.length = 0;
  assert.equal((await publishRelease({ build: h.build, commit, api: h.api })).resumed, true);
  assert.ok(h.calls.every(c => !['draft', 'tag', 'publish'].includes(c) && !c.startsWith('upload')));
});
test('联合发布在同一草稿核验工作台、清单和 Skill 包后一次公开，并保留工作台 Latest', async t => {
  const h = await fixtureAPI(t, 'v0.26.0');
  const result = await publishRelease({ build: h.build, commit, api: h.api });
  assert.equal(result.batch, 'v0.26.0'); assert.equal(h.remote().make_latest, 'true');
  assert.equal(h.calls.filter(c => c === 'draft').length, 1); assert.equal(h.calls.filter(c => c === 'publish').length, 1);
  const published = h.calls.indexOf('publish');
  for (const name of ['skills-release.json', ...h.build.artifacts.keys(), ...h.build.coreArtifacts.keys()]) assert.ok(h.calls.indexOf('verify:' + name) < published);
  assert.equal(h.remote().assets.length, 5);
  h.calls.length = 0;
  assert.equal((await publishRelease({ build: h.build, commit, api: h.api })).resumed, true);
  assert.ok(h.calls.every(c => !c.startsWith('upload:') && !['publish', 'draft', 'tag'].includes(c)));
});
test('联合发布缺工作台附件、内容来源不一致或 ZIP 损坏时不能创建草稿', async t => {
  const missing = await fixtureAPI(t, 'v0.26.0'); missing.build.coreArtifacts.delete('tt-workbench.zip');
  await assert.rejects(publishRelease({ build: missing.build, commit, api: missing.api }), { code: 'MISSING_ASSET' });
  assert.deepEqual(missing.calls, []);
  const wrong = await fixtureAPI(t, 'v0.26.0');
  const release = JSON.parse(wrong.build.coreArtifacts.get('release.json')); release.skillSource.batch = 'skills-20261031.1';
  wrong.build.coreArtifacts.set('release.json', Buffer.from(JSON.stringify(release)));
  await assert.rejects(publishRelease({ build: wrong.build, commit, api: wrong.api }), { code: 'RELEASE_CONFLICT' });
  assert.deepEqual(wrong.calls, []);
  const corrupt = await fixtureAPI(t, 'v0.26.0'); corrupt.build.coreArtifacts.set('tt-workbench.zip', Buffer.from('bad zip'));
  await assert.rejects(publishRelease({ build: corrupt.build, commit, api: corrupt.api }), { code: 'VERIFY_FAILED' });
  assert.deepEqual(corrupt.calls, []);
});
test('远端联合发布附件损坏时保留草稿，不提前公开工作台', async t => {
  const h = await fixtureAPI(t, 'v0.26.0'), original = h.api.download;
  h.api.download = asset => asset.name === 'tt-workbench.zip' ? Buffer.from('bad download') : original(asset);
  await assert.rejects(publishRelease({ build: h.build, commit, api: h.api }), { code: 'VERIFY_FAILED' });
  assert.equal(h.remote().draft, true); assert.ok(!h.calls.includes('publish'));
});
test('上传结果不明先回读确认；附件损坏或并发基线变化时保留草稿', async t => {
  const h = await fixtureAPI(t), upload = h.api.upload;
  h.api.upload = async (...args) => { await upload(...args); throw Error('connection lost after write'); };
  assert.equal((await publishRelease({ build: h.build, commit, api: h.api })).published, true);
  assert.equal(h.calls.filter(c => c.startsWith('upload:')).length, 2);
  const broken = await fixtureAPI(t), original = broken.api.download;
  broken.api.download = async asset => asset.name.endsWith('.gz') ? Buffer.from('corrupt') : original(asset);
  await assert.rejects(publishRelease({ build: broken.build, commit, api: broken.api }), { code: 'VERIFY_FAILED' });
  assert.equal(broken.remote().draft, true); assert.ok(!broken.calls.includes('publish'));
  const stale = await fixtureAPI(t); let checks = 0;
  stale.api.latestCatalog = async () => ++checks === 1 ? null : { catalog: { ...stale.build.catalog, batch: 'skills-20261031.2' }, raw: Buffer.from('changed') };
  await assert.rejects(publishRelease({ build: stale.build, commit, api: stale.api }), { code: 'STALE_RELEASE_BASE' });
  assert.equal(stale.remote().draft, true);
});
