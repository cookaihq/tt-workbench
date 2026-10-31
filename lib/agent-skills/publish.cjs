'use strict';
const packages = require('./package.cjs');
const releases = require('./releases.cjs');
const core = require('../workbench/package.cjs');
const { fail, hash } = packages;
async function validateWorkbenchAssets(build, catalog) {
  const combined = releases.isWorkbenchTag(catalog.batch), assets = build.coreArtifacts;
  if (!combined) {
    if (assets?.size) fail('RELEASE_CONFLICT', '仅 Skill 发布不能附带工作台安装包。');
    return;
  }
  const names = ['release.json', 'tt-workbench.bundle.json.gz', 'tt-workbench.zip'];
  if (!(assets instanceof Map) || assets.size !== names.length || names.some(name => !Buffer.isBuffer(assets.get(name)))) fail('MISSING_ASSET', '联合发布必须同时提供工作台的三个完整附件。');
  const bundle = core.decodeBundle(assets.get('tt-workbench.bundle.json.gz')), release = bundle.release;
  if (release.version !== catalog.batch.slice(1) || release.skillSource?.kind !== 'release' || release.skillSource.batch !== catalog.batch || release.skillSource.sha256 !== hash(build.raw) || JSON.stringify(core.parseRelease(assets.get('release.json'))) !== JSON.stringify(release)) fail('RELEASE_CONFLICT', '工作台版本或 Skill 来源与联合发布清单不一致。');
  if (Object.keys(release.skillPackages).length !== catalog.active.length || catalog.skills.some(item => release.skillPackages[item.name]?.version !== item.version || release.skillPackages[item.name]?.contentHash !== item.contentHash || packages.compareVersions(release.version, item.compatibility.workbench) < 0)) fail('RELEASE_CONFLICT', '工作台附带的 Skill 版本、内容或兼容要求与清单不一致。');
  const { encodePluginZip } = await import('../../scripts/workbench/zip.mjs');
  if (hash(encodePluginZip(bundle)) !== hash(assets.get('tt-workbench.zip'))) fail('VERIFY_FAILED', '工作台 ZIP 与同次构建的更新包不一致。');
}
// api is an explicit release-scoped adapter. Production dispatch is serialized
// by the workflow; optimistic baseline checks also detect out-of-band writers.
async function publishRelease({ build, commit, api }) {
  const catalog = releases.parseCatalog(build.raw);
  if (!/^[a-f0-9]{40}$/.test(commit || '')) fail('INVALID_COMMIT', '发布必须固定完整提交 SHA。');
  await validateWorkbenchAssets(build, catalog);
  const combined = releases.isWorkbenchTag(catalog.batch);
  async function checkBase() {
    const previous = await api.latestCatalog();
    releases.validateSuccessor(catalog, previous?.catalog, previous?.raw);
  }
  async function verify(release) {
    const asset = name => {
      const found = release.assets.filter(a => a.name === name);
      if (found.length !== 1) fail('MISSING_ASSET', '发布缺少唯一附件：' + name);
      return found[0];
    };
    const raw = await api.download(asset(releases.CATALOG));
    if (hash(raw) !== hash(build.raw)) fail('RELEASE_CONFLICT', '远端批次清单与本次候选不一致，保留现场。');
    for (const [name, expected] of build.coreArtifacts || []) {
      const bytes = await api.download(asset(name));
      if (bytes.length !== expected.length || hash(bytes) !== hash(expected)) fail('VERIFY_FAILED', '远端工作台附件核验失败：' + name);
    }
    for (const item of catalog.skills) {
      const origin = item.artifact.batch === catalog.batch ? release : await api.findRelease(item.artifact.batch);
      if (!origin || item.artifact.batch !== catalog.batch && (origin.draft || origin.prerelease)) fail('MISSING_ASSET', '继承的 Skill 来源不是正式发布。');
      const matches = origin.assets.filter(a => a.name === item.artifact.name);
      if (matches.length !== 1) fail('MISSING_ASSET', 'Skill 安装包缺失或重复：' + item.name);
      const bytes = await api.download(matches[0]);
      if (bytes.length !== item.artifact.size || hash(bytes) !== item.artifact.sha256) fail('VERIFY_FAILED', '远端 Skill 安装包核验失败：' + item.name);
      const bundle = packages.decodeBundle(bytes);
      if (bundle.manifest.name !== item.name || bundle.manifest.version !== item.version || bundle.manifest.contentHash !== item.contentHash || JSON.stringify(bundle.manifest.compatibility) !== JSON.stringify(item.compatibility) || bundle.manifest.notes !== item.notes) fail('VERIFY_FAILED', '远端包与完整清单不一致：' + item.name);
    }
  }
  let remote = await api.findRelease(catalog.batch);
  if (remote && !remote.draft) {
    if (remote.prerelease || await api.tagCommit(catalog.batch) !== commit) fail('RELEASE_CONFLICT', '同名批次已发布且身份不同。');
    await verify(remote);
    return { ok: true, published: true, resumed: true, batch: catalog.batch, url: remote.html_url };
  }
  await checkBase();
  if (remote && remote.target_commitish !== commit && await api.tagCommit(catalog.batch) !== commit) fail('RELEASE_CONFLICT', '同名草稿来自其他提交，已保留。');
  if (!remote) {
    try { remote = await api.createDraft({ tag_name: catalog.batch, target_commitish: commit, name: catalog.batch, draft: true, prerelease: false, make_latest: 'false', body: catalog.skills.filter(i => catalog.changed.includes(i.name)).map(i => `- ${i.name} v${i.version}：${i.notes}`).join('\n') }); }
    catch (error) {
      remote = await api.findRelease(catalog.batch);
      if (!remote) throw Object.assign(Error('创建批次草稿结果未确定；请回查同一标签后续做。'), { code: 'PUBLISH_UNKNOWN', cause: error });
      if (!remote.draft || remote.target_commitish !== commit) fail('RELEASE_CONFLICT', '草稿创建期间出现不同来源的批次，已停止。');
    }
  }
  const uploads = new Map([...build.artifacts, ...build.coreArtifacts || []]); uploads.set(releases.CATALOG, build.raw);
  for (const [name, bytes] of uploads) {
    const existing = remote.assets.filter(a => a.name === name);
    if (existing.length > 1) fail('RELEASE_CONFLICT', '远端存在重名附件，已停止。');
    if (!existing.length) {
      try { await api.upload(remote.id, name, bytes); }
      catch (error) {
        remote = await api.findRelease(catalog.batch);
        const found = remote?.assets.filter(a => a.name === name) || [];
        if (found.length !== 1 || hash(await api.download(found[0])) !== hash(bytes)) throw Object.assign(Error('附件上传结果未确定；草稿和已上传附件保留，核对后续做。'), { code: 'PUBLISH_UNKNOWN', cause: error });
      }
      remote = await api.findRelease(catalog.batch);
    } else if (hash(await api.download(existing[0])) !== hash(bytes)) fail('RELEASE_CONFLICT', '草稿同名附件内容不同，未覆盖。');
  }
  await verify(remote);
  await api.ensureTag(catalog.batch, commit);
  if (await api.tagCommit(catalog.batch) !== commit) fail('RELEASE_CONFLICT', '发布标签不再指向已核验提交。');
  await checkBase();
  try { await api.publish(remote.id, { draft: false, prerelease: false, make_latest: combined ? 'true' : 'false' }); }
  catch (error) {
    const checked = await api.findRelease(catalog.batch);
    if (!checked || checked.draft) throw Object.assign(Error('公开批次结果未确定；请回查同一 Release，勿创建另一批次重发。'), { code: 'PUBLISH_UNKNOWN', cause: error });
  }
  remote = await api.findRelease(catalog.batch);
  if (!remote || remote.draft || remote.prerelease) fail('PUBLISH_UNKNOWN', '尚未核实正式 Release 状态。');
  await verify(remote);
  return { ok: true, published: true, batch: catalog.batch, url: remote.html_url, commit, catalogSha256: hash(build.raw) };
}
module.exports = { publishRelease, validateWorkbenchAssets };
