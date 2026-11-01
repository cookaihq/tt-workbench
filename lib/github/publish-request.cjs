'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { repositoryName, retryAt } = require('./releases.cjs');

// One deadline and one persisted cooldown cover writes, reconciliation reads
// and redirects. A failed write is never replayed by this transport.
async function createPublishRequest({ repository, token, stateFile, fetch: send = globalThis.fetch, now = Date.now, budget = 8 * 60000 } = {}) {
  repository = repositoryName(repository);
  const operationDeadline = now() + budget;
  let state = { schema: 1, repository, retryAfter: null };
  if (stateFile) {
    try {
      const saved = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      if (saved.schema !== 1 || saved.repository !== repository || saved.retryAfter !== null && !Number.isFinite(Date.parse(saved.retryAfter))) throw Error('发布冷却记录无效，请核对原记录。');
      state = saved;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const cooldownError = () => Object.assign(Error(`GitHub 请求冷却至 ${state.retryAfter}；发布阶段已保留，请在此后续做同一批次。`), { code: 'PUBLISH_COOLDOWN', retryAfter: state.retryAfter });
  async function save() {
    if (!stateFile) return;
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile + '.tmp', JSON.stringify(state, null, 2) + '\n');
    await fs.rename(stateFile + '.tmp', stateFile);
  }
  await save();
  async function request(url, { method = 'GET', json, bytes, accept = 'application/vnd.github+json', deadline = now() + 60000 } = {}, redirects = 0) {
    if (Date.parse(state.retryAfter) > now()) throw cooldownError();
    deadline = Math.min(deadline, now() + 60000, operationDeadline);
    if (deadline <= now()) throw Object.assign(Error('本次发布请求超过总预算；保留当前阶段后续做。'), { code: 'PUBLISH_TIMEOUT' });
    const parsed = new URL(url), authenticated = ['api.github.com', 'uploads.github.com'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port && parsed.port !== '443' || !authenticated && !parsed.hostname.endsWith('.githubusercontent.com') || authenticated && !parsed.pathname.startsWith(`/repos/${repository}/`)) throw Error('发布请求地址不在已授权 GitHub 范围内。');
    const headers = { Accept: accept, 'User-Agent': 'tt-workbench-skill-release', 'X-GitHub-Api-Version': '2022-11-28' };
    if (authenticated) headers.Authorization = `Bearer ${token}`;
    if (json) headers['Content-Type'] = 'application/json';
    if (bytes) headers['Content-Type'] = 'application/octet-stream';
    const response = await send(url, { method, headers, body: json ? JSON.stringify(json) : bytes, redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, deadline - now())) });
    const limited = response.status === 429 || response.status === 403 && (response.headers.get('retry-after') || response.headers.get('x-ratelimit-remaining') === '0');
    const reset = response.headers.get('x-ratelimit-reset');
    const after = retryAt(response.headers.get('retry-after'), now()) || (limited && /^\d+$/.test(reset || '') ? retryAt(new Date(Number(reset) * 1000).toUTCString(), now()) : null) || (limited ? new Date(now() + 60000).toISOString() : null);
    if (!response.ok && after) {
      state.retryAfter = after;
      await response.body?.cancel();
      await save();
      throw cooldownError();
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (method !== 'GET' || redirects >= 5 || !response.headers.get('location')) throw Error('发布请求出现不可处理的重定向。');
      return request(new URL(response.headers.get('location'), url).href, { accept, deadline }, redirects + 1);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(Error(`GitHub 请求失败（${response.status}）；保留当前发布阶段。`), { status: response.status });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 32 * 1024 * 1024) throw Error('发布响应过大。');
    return accept === 'application/octet-stream' ? buffer : JSON.parse(buffer);
  }
  return request;
}
module.exports = { createPublishRequest };
