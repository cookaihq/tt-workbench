'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const packages = require('./package.cjs');
const github = require('../github/releases.cjs');
const { parseJSONC } = require('../config/jsonc.cjs');
const { fail, validName, validVersion, validHash, hash, compareVersions } = packages;
const CATALOG = 'skills-release.json';
function batchParts(value) {
  const match = typeof value === 'string' && value.match(/^skills-(\d{4})(\d{2})(\d{2})\.([1-9]\d*)$/);
  if (!match) fail('INVALID_BATCH', 'Skill 批次标签须为 skills-YYYYMMDD.N。');
  const date = `${match[1]}-${match[2]}-${match[3]}`, parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || !Number.isSafeInteger(Number(match[4]))) fail('INVALID_BATCH', 'Skill 批次日期或序号无效。');
  return [Number(match[1] + match[2] + match[3]), Number(match[4])];
}
const isBatch = value => { try { batchParts(value); return true; } catch { return false; } };
const isWorkbenchTag = value => typeof value === 'string' && value.startsWith('v') && validVersion(value.slice(1));
const isReleaseTag = value => isBatch(value) || isWorkbenchTag(value);
// Core-only releases have no Skill catalog. A standalone Skill release always
// promises one, so a missing catalog must surface as an incomplete check.
const hasCatalog = release => isBatch(release.tag_name) || isWorkbenchTag(release.tag_name) && release.assets?.some(a => a.name === CATALOG);
const artifactName = (name, version) => `${name}-${version}.skill.json.gz`;
function parseCatalog(raw, { repository, required = [] } = {}) {
  let value;
  try { value = JSON.parse(raw); } catch { fail('INVALID_CATALOG', 'Skill 正式版本清单不是有效 JSON。'); }
  if (value?.schema !== 1 || value.kind !== 'tt-skill-release' || value.complete !== true || !isReleaseTag(value.batch) || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !value.repository || github.repositoryName(value.repository) !== value.repository || repository && value.repository !== repository || !Array.isArray(value.active) || !value.active.length || value.active.length > 100 || value.active.some(n => !validName(n)) || new Set(value.active).size !== value.active.length || !Array.isArray(value.skills)) fail('INVALID_CATALOG', 'Skill 正式版本清单不完整。');
  const names = value.skills.map(item => item?.name);
  if (names.length !== value.active.length || new Set(names).size !== names.length || value.active.some(n => !names.includes(n)) || required.some(n => !names.includes(n))) fail('INCOMPLETE_CATALOG', '正式清单缺少活动 Skill，本次不能确定更新结果。');
  if (value.previous === null ? value.sequence !== 1 : value.sequence === 1 || !isReleaseTag(value.previous?.batch) || !validHash(value.previous.sha256) || value.previous.batch === value.batch) fail('INVALID_CATALOG', 'Skill 清单的前批次依据无效。');
  if (!Array.isArray(value.changed) || !value.changed.length || new Set(value.changed).size !== value.changed.length || value.changed.some(n => !names.includes(n))) fail('INVALID_CATALOG', 'Skill 批次变更清单无效。');
  for (const item of value.skills) {
    const a = item.artifact;
    if (!validName(item.name) || !validVersion(item.version) || !validHash(item.contentHash) || typeof item.notes !== 'string' || !item.notes.trim() || !isReleaseTag(a?.batch) || a.name !== artifactName(item.name, item.version) || !validHash(a.sha256) || !Number.isSafeInteger(a.size) || a.size <= 0 || a.size > packages.LIMIT || value.changed.includes(item.name) !== (a.batch === value.batch)) fail('INVALID_CATALOG', 'Skill 清单的版本或固定附件来源无效。');
    packages.validateCompatibility(item.compatibility);
  }
  return value;
}
function validateSuccessor(current, previous, previousRaw) {
  if (!previous) {
    if (current.previous !== null || current.sequence !== 1 || current.changed.length !== current.active.length) fail('INCOMPLETE_CATALOG', '首批须包含全部活动 Skill。');
    return;
  }
  if (current.previous?.batch !== previous.batch || current.previous.sha256 !== hash(previousRaw) || current.batch === previous.batch || current.sequence !== previous.sequence + 1) fail('STALE_RELEASE_BASE', '上一正式批次已变化，请基于最新清单重新构建。');
  for (const old of previous.skills) {
    const next = current.skills.find(i => i.name === old.name);
    if (!next) fail('INCOMPLETE_CATALOG', '完整清单不能遗漏此前正式 Skill：' + old.name);
    if (!current.changed.includes(old.name) && JSON.stringify(next) !== JSON.stringify(old)) fail('UNSELECTED_CHANGE', '未选择发布的 Skill 必须继承此前完整条目：' + old.name);
    if (current.changed.includes(old.name) && compareVersions(next.version, old.version) <= 0) fail('IMMUTABLE_VERSION', '同名版本已经发布；行为或资源变化必须升级 Skill 版本。');
  }
  for (const item of current.skills) if (!previous.skills.some(i => i.name === item.name) && !current.changed.includes(item.name)) fail('INCOMPLETE_CATALOG', '新增 Skill 缺少本批安装包。');
}
async function buildRelease({ root, batch, repository, names, previousRaw = null, collect = packages.collectPackage }) {
  if (!isReleaseTag(batch)) fail('INVALID_BATCH', 'Skill 发布标签须为 skills-YYYYMMDD.N 或联合发布的 v<工作台版本>。');
  repository = github.repositoryName(repository);
  if (!repository || !Array.isArray(names) || !names.length || names.some(n => !validName(n)) || new Set(names).size !== names.length) fail('INVALID_SELECTION', '请明确发布仓库、批次与一个或多个 Skill。');
  const active = parseJSONC(await fs.readFile(path.join(root, 'skills/manifest.jsonc'), 'utf8')).skills;
  if (!Array.isArray(active) || names.some(n => !active.includes(n))) fail('INVALID_SELECTION', '选择的 Skill 不在源码活动清单中。');
  const previous = previousRaw ? parseCatalog(previousRaw, { repository }) : null;
  if (!previous && (active.length !== names.length || active.some(n => !names.includes(n)))) fail('INCOMPLETE_CATALOG', '首批必须选择全部活动 Skill。');
  if (previous?.batch === batch) fail('INVALID_BATCH', '新发布必须使用新的标签。');
  const entries = new Map((previous?.skills || []).map(item => [item.name, item])), artifacts = new Map(), changed = [];
  for (const name of names) {
    const bundle = await collect(root, name), m = bundle.manifest, old = entries.get(name);
    if (old && compareVersions(m.version, old.version) <= 0) {
      if (m.version === old.version && m.contentHash === old.contentHash) continue;
      fail('IMMUTABLE_VERSION', `${name} v${m.version} 已使用；本次内容不同或版本倒退，请升级该 Skill 的 metadata.version。`);
    }
    const bytes = packages.encodeBundle(bundle), artifact = { batch, name: artifactName(name, m.version), sha256: hash(bytes), size: bytes.length };
    entries.set(name, { name, version: m.version, contentHash: m.contentHash, compatibility: m.compatibility, notes: m.notes, artifact });
    artifacts.set(artifact.name, bytes); changed.push(name);
  }
  if (!changed.length) fail('NO_SKILL_CHANGES', '所选 Skill 没有需要发布的新版本。');
  const skills = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  const catalog = { schema: 1, kind: 'tt-skill-release', complete: true, repository, batch, sequence: previous ? previous.sequence + 1 : 1, previous: previous ? { batch: previous.batch, sha256: hash(previousRaw) } : null, active: skills.map(i => i.name), changed: changed.sort(), skills };
  parseCatalog(JSON.stringify(catalog), { repository }); validateSuccessor(catalog, previous, previousRaw);
  return { catalog, raw: Buffer.from(JSON.stringify(catalog, null, 2) + '\n'), artifacts };
}
async function discover({ repository, required = [], request = github.requestBytes, deadline = Date.now() + 15000 } = {}) {
  repository = github.repositoryName(repository);
  const releases = await github.listReleases(repository, { request, deadline });
  const candidates = releases.filter(hasCatalog);
  const rejected = [], cache = new Map();
  const read = async release => {
    if (cache.has(release.tag_name)) return cache.get(release.tag_name);
    const a = github.asset(release, CATALOG);
    if (a.size > 1024 * 1024) fail('INVALID_CATALOG', 'Skill 清单过大。');
    const raw = await github.withinBudget(request, github.assetUrl(repository, a), { accept: 'application/octet-stream', limit: 1024 * 1024, deadline });
    if (raw.length !== a.size) fail('VERIFY_FAILED', 'Skill 清单下载不完整。');
    const catalog = parseCatalog(raw, { repository });
    if (catalog.batch !== release.tag_name) fail('INVALID_CATALOG', 'Skill 清单与批次标签不一致。');
    const result = { catalog, raw }; cache.set(release.tag_name, result); return result;
  };
  const reject = (batch, error) => {
    if (['RATE_LIMITED', 'UPDATE_TIMEOUT', 'DOWNLOAD_FAILED'].includes(error.code)) throw error;
    rejected.push({ batch, code: error.code || 'INVALID_CATALOG', message: error.message });
  };
  // Tags use two unrelated naming schemes; neither lexical order nor GitHub
  // publication dates order this stream. Verify the hash-linked sequence.
  for (const candidate of candidates) {
    try { await read(candidate); } catch (error) { reject(candidate.tag_name, error); }
  }
  const valid = [], chains = new Map();
  for (const current of [...cache.values()].sort((a, b) => a.catalog.sequence - b.catalog.sequence)) {
    const { catalog } = current;
    try {
      const parent = catalog.previous && cache.get(catalog.previous.batch);
      if (catalog.previous && (!parent || !chains.has(parent.catalog.batch))) fail('INCOMPLETE_CATALOG', '上一正式清单缺失或继承链无效。');
      validateSuccessor(catalog, parent?.catalog, parent?.raw);
      const chain = new Set(parent ? chains.get(parent.catalog.batch) : []);
      if (chain.has(catalog.batch)) fail('INVALID_CATALOG', 'Skill 清单继承链包含重复标签。');
      chain.add(catalog.batch); chains.set(catalog.batch, chain); valid.push(current);
    } catch (error) { reject(catalog.batch, error); }
  }
  valid.sort((a, b) => b.catalog.sequence - a.catalog.sequence);
  if (valid.length && valid.some(item => !chains.get(valid[0].catalog.batch).has(item.catalog.batch))) fail('CONFLICTING_CATALOGS', '正式 Skill 清单出现并行分支，无法确定完整最新集合；当前版本保持可用。');
  for (const { catalog, raw } of valid) {
    try {
      parseCatalog(raw, { repository, required });
      const downloads = {};
      for (const item of catalog.skills) {
        const release = releases.find(r => r.tag_name === item.artifact.batch);
        if (!release) fail('MISSING_ASSET', 'Skill 原始发布批次缺失：' + item.name);
        const a = github.asset(release, item.artifact.name);
        if (a.size !== item.artifact.size) fail('MISSING_ASSET', 'Skill 固定附件大小不符：' + item.name);
        downloads[item.name] = github.assetUrl(repository, a);
      }
      return { catalog, raw, downloads, rejected, complete: rejected.length === 0 };
    } catch (error) {
      reject(catalog.batch, error);
    }
  }
  fail('NO_VALID_CATALOG', rejected.length ? '正式 Skill 清单未通过核验，当前版本保持可用。' : '尚无可用的正式 Skill 批次，当前版本保持可用。');
}
module.exports = { CATALOG, batchParts, isBatch, isWorkbenchTag, isReleaseTag, hasCatalog, artifactName, parseCatalog, validateSuccessor, buildRelease, discover };
