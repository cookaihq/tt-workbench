'use strict';
const https = require('node:https');
const { fail } = require('../agent-skills/package.cjs');
function repositoryName(value = '') {
  const name = value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (name && !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name)) fail('INVALID_REPOSITORY', '请填写 GitHub 的 owner/repository 或公开仓库网址。');
  return name;
}
function retryAt(value, now = Date.now()) {
  if (typeof value !== 'string') return null;
  const date = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(date) && date > now ? new Date(date).toISOString() : null;
}
function requestBytes(url, { accept = 'application/vnd.github+json', limit = 64 * 1024 * 1024, deadline = Date.now() + 15000 } = {}, redirects = 0) {
  const parsed = new URL(url), remaining = deadline - Date.now();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port && parsed.port !== '443' || !['github.com', 'api.github.com'].includes(parsed.hostname) && !parsed.hostname.endsWith('.githubusercontent.com')) fail('INVALID_SOURCE', '更新文件必须来自 GitHub 的 HTTPS 下载地址。');
  if (remaining <= 0) return Promise.reject(Object.assign(Error('检查更新超时，当前版本保持可用。'), { code: 'UPDATE_TIMEOUT' }));
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, { headers: { 'User-Agent': 'tt-workbench', Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 5 || !response.headers.location) { reject(Error('下载重定向无效。')); return; }
        try { resolve(requestBytes(new URL(response.headers.location, parsed).href, { accept, limit, deadline }, redirects + 1)); } catch (error) { reject(error); }
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        const limited = response.statusCode === 429 || response.statusCode === 403 && response.headers['x-ratelimit-remaining'] === '0';
        const retryAfter = retryAt(response.headers['retry-after']) || (limited && /^\d+$/.test(response.headers['x-ratelimit-reset'] || '') ? new Date(Number(response.headers['x-ratelimit-reset']) * 1000).toISOString() : null);
        reject(Object.assign(Error(limited ? `GitHub 暂时限流，${retryAfter ? '可在 ' + retryAfter + ' 后' : '请稍后'}重试。当前版本保持可用。` : response.statusCode === 404 ? '尚未找到公开的发布版本或完整安装包。' : 'GitHub 暂不可用，请稍后重试。'), { code: limited ? 'RATE_LIMITED' : 'DOWNLOAD_FAILED', retryAfter }));
        return;
      }
      let size = 0; const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > limit) response.destroy(Error('更新文件过大。')); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    // A wall-clock budget includes DNS, TLS, headers, body and redirects, not
    // merely socket inactivity. Never shorten a server's Retry-After to retry.
    const timer = setTimeout(() => request.destroy(Object.assign(Error('更新请求超时，当前版本保持可用。'), { code: 'UPDATE_TIMEOUT' })), remaining);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}
async function withinBudget(request, url, options) {
  const remaining = options.deadline - Date.now();
  if (remaining <= 0) fail('UPDATE_TIMEOUT', '检查更新超时，当前版本保持可用。');
  let timer;
  try {
    return await Promise.race([request(url, options), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('检查更新超时，当前版本保持可用。'), { code: 'UPDATE_TIMEOUT' })), remaining); })]);
  } finally { clearTimeout(timer); }
}
async function listReleases(repository, { request = requestBytes, deadline = Date.now() + 15000 } = {}) {
  repository = repositoryName(repository);
  if (!repository) fail('INVALID_REPOSITORY', '尚未设置公开发布仓库。');
  const releases = [], seen = new Set();
  for (let page = 1; page <= 20; page++) {
    const data = JSON.parse(await withinBudget(request, `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, { limit: 8 * 1024 * 1024, deadline }));
    if (!Array.isArray(data) || data.length > 100) fail('INVALID_RELEASES', 'GitHub 发布列表无效。');
    for (const release of data) if (!release.draft && !release.prerelease) {
      if (typeof release.tag_name !== 'string' || seen.has(release.tag_name)) fail('INVALID_RELEASES', 'GitHub 发布列表不完整或包含重复标签。');
      seen.add(release.tag_name); releases.push(release);
    }
    if (data.length < 100) return releases;
  }
  fail('INCOMPLETE_RELEASES', '发布记录过多，本次检查未完成；当前版本保持可用。');
}
function asset(release, name) {
  const matches = release.assets?.filter(item => item.name === name) || [];
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0 || !Number.isSafeInteger(matches[0].size) || matches[0].size <= 0) fail('INVALID_PACKAGE', '发布缺少有效的固定附件：' + name);
  return matches[0];
}
const assetUrl = (repository, item) => `https://api.github.com/repos/${repositoryName(repository)}/releases/assets/${item.id}`;
module.exports = { repositoryName, retryAt, requestBytes, withinBudget, listReleases, asset, assetUrl };
