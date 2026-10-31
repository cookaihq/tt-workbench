#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import releases from '../../lib/agent-skills/releases.cjs';
import publishing from '../../lib/agent-skills/publish.cjs';
import github from '../../lib/github/releases.cjs';
import transport from '../../lib/github/publish-request.cjs';
import { assembleRelease } from './assemble-release.mjs';
const { values } = parseArgs({ options: { help: { type: 'boolean' }, batch: { type: 'string' }, skills: { type: 'string' } } });
if (values.help) console.log('publish-release.mjs --batch <skills-YYYYMMDD.N|v工作台版本> --skills tt-capture,tt-update-note\n仅供明确启动的 GitHub Actions 串行发布任务。联合发布包含工作台三个附件并设为 Latest；Skill 单独发布不占 Latest。读取任务 GITHUB_TOKEN 和固定 GITHUB_SHA；本地准备使用 build-release.mjs。');
else try {
  if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_TOKEN || !process.env.GITHUB_SHA) throw Error('发布仅从明确启动的 GitHub Actions 工作流执行；本地命令不会读取个人或全局凭据。');
  const repository = github.repositoryName(process.env.GITHUB_REPOSITORY || '');
  if (repository !== 'cookaihq/tt-workbench') throw Error('发布工作流目标仓库不符。');
  const root = fileURLToPath(new URL('../../', import.meta.url)), commit = process.env.GITHUB_SHA;
  const request = await transport.createPublishRequest({ repository, token: process.env.GITHUB_TOKEN, stateFile: path.join(root, 'dist/skills/request-state.json') });
  const apiRoot = `https://api.github.com/repos/${repository}`;
  async function list() {
    const items = [];
    for (let page = 1; page <= 20; page++) { const next = await request(`${apiRoot}/releases?per_page=100&page=${page}`); items.push(...next); if (next.length < 100) return items; }
    throw Error('发布列表未完整取得。');
  }
  const api = {
    findRelease: async batch => (await list()).find(r => r.tag_name === batch) || null,
    download: asset => request(`${apiRoot}/releases/assets/${asset.id}`, { accept: 'application/octet-stream' }),
    async latestCatalog() {
      const all = (await list()).filter(r => !r.draft && !r.prerelease && releases.hasCatalog(r));
      if (!all.length) return null;
      const result = await releases.discover({ repository, request: async (url, options) => {
        const data = await request(url, options); return Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
      }, deadline: Date.now() + 60000 });
      if (!result.complete) throw Error('最新批次未完整核验，停止发布。');
      return result;
    },
    async tagCommit(batch) {
      const ref = await request(`${apiRoot}/git/ref/tags/${encodeURIComponent(batch)}`);
      if (ref.object.type === 'commit') return ref.object.sha;
      const tag = await request(`${apiRoot}/git/tags/${ref.object.sha}`);
      if (tag.object.type !== 'commit') throw Error('发布标签不直接指向提交。');
      return tag.object.sha;
    },
    async ensureTag(batch, sha) {
      try { if (await api.tagCommit(batch) !== sha) throw Error('同名标签已指向不同提交。'); return; }
      catch (error) { if (error.status !== 404) throw error; }
      try { await request(`${apiRoot}/git/refs`, { method: 'POST', json: { ref: 'refs/tags/' + batch, sha } }); }
      catch (error) { if (await api.tagCommit(batch) !== sha) throw error; }
    },
    createDraft: json => request(`${apiRoot}/releases`, { method: 'POST', json }),
    upload: (id, name, bytes) => request(`https://uploads.github.com/repos/${repository}/releases/${id}/assets?name=${encodeURIComponent(name)}`, { method: 'POST', bytes }),
    publish: (id, json) => request(`${apiRoot}/releases/${id}`, { method: 'PATCH', json })
  };
  const previous = await api.latestCatalog();
  const existing = await api.findRelease(values.batch);
  // A resumed published/draft batch was built against its recorded parent,
  // not against itself. All selected source files still come from this SHA.
  let previousRaw = previous?.raw || null;
  if (existing?.assets?.some(a => a.name === releases.CATALOG)) {
    const current = releases.parseCatalog(await api.download(github.asset(existing, releases.CATALOG)), { repository });
    const parent = current.previous && await api.findRelease(current.previous.batch);
    previousRaw = parent ? await api.download(github.asset(parent, releases.CATALOG)) : null;
  }
  const candidate = await releases.buildRelease({ root, repository, batch: values.batch, names: (values.skills || '').split(',').map(s => s.trim()).filter(Boolean), previousRaw });
  const build = await assembleRelease({ root, build: candidate, readArtifact: async item => {
    const origin = await api.findRelease(item.artifact.batch);
    if (!origin || origin.draft || origin.prerelease) throw Error('继承的 Skill 来源不是正式 Release。');
    return api.download(github.asset(origin, item.artifact.name));
  } });
  const out = path.join(root, 'dist/skills', build.catalog.batch); await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, releases.CATALOG), build.raw);
  for (const [name, bytes] of [...build.artifacts, ...build.coreArtifacts || []]) await fs.writeFile(path.join(out, name), bytes);
  const result = await publishing.publishRelease({ build, commit, api });
  await fs.writeFile(path.join(out, 'publication.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({ ok: false, code: error.code || 'PUBLISH_FAILED', message: error.message, retryAfter: error.retryAfter })); process.exitCode = 1; }
