"use strict";
const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const local = createRequire(__filename);
let packages;
try { packages = local('./lib/workbench/package.cjs'); } catch { packages = local('../../lib/workbench/package.cjs'); }
const { hash: digest, parseRelease, readTree, fingerprint: treeFingerprint } = packages;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function compareVersions(a, b) {
  const parse = value => { if (!/^\d+\.\d+\.\d+$/.test(value)) fail('INVALID_VERSION', '版本号必须为主版本.次版本.修订号。'); return value.split('.').map(Number); };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function repositoryName(value = '') {
  const name = value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (name && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) fail('INVALID_REPOSITORY', '请填写 GitHub 的 owner/repository 或公开仓库网址。');
  return name;
}
function requestBytes(url, { accept = 'application/vnd.github+json', limit = 64 * 1024 * 1024 } = {}, redirects = 0) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !['github.com', 'api.github.com'].includes(parsed.hostname) && !parsed.hostname.endsWith('.githubusercontent.com')) fail('INVALID_SOURCE', '更新文件必须来自 GitHub 的 HTTPS 下载地址。');
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, { headers: { 'User-Agent': 'tt-workbench', Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' }, timeout: 30000 }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 5 || !response.headers.location) { reject(Error('下载重定向无效。')); return; }
        try { resolve(requestBytes(new URL(response.headers.location, parsed).href, { accept, limit }, redirects + 1)); } catch (e) { reject(e); }
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(Object.assign(new Error(response.statusCode === 404 ? '尚未找到公开的发布版本或完整安装包。' : 'GitHub 暂不可用，请稍后重试。'), { code: 'DOWNLOAD_FAILED' })); return; }
      let size = 0; const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > limit) response.destroy(Error('更新文件过大。')); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(Error('更新请求超时。')));
    request.on('error', reject);
  });
}
class WorkbenchUpdates {
  constructor({ vault, configDir = '.obsidian', version, appVersion, repository = '', request = requestBytes, beforeInstall, saveRepository } = {}) {
    this.vault = path.resolve(vault); this.configDir = configDir;
    this.target = path.join(this.vault, configDir, 'plugins/tt-workbench');
    this.version = version; this.appVersion = appVersion;
    this.repository = repositoryName(repository); this.request = request;
    this.beforeInstall = beforeInstall; this.saveRepository = saveRepository;
    this.status = { kind: this.repository ? 'idle' : 'unconfigured', current: version };
    this.listeners = new Set();
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.status); return () => this.listeners.delete(listener); }
  setStatus(status) { this.status = { current: this.version, ...status }; for (const fn of this.listeners) fn(this.status); }
  async configure(repository) {
    if (this.busy) fail('BUSY', '请等当前更新操作结束。');
    const value = repositoryName(repository);
    await this.saveRepository?.(value); this.repository = value;
    this.setStatus({ kind: value ? 'idle' : 'unconfigured' });
  }
  assetUrl(asset) {
    if (!Number.isSafeInteger(asset?.id) || asset.id <= 0) fail('INVALID_PACKAGE', '发布附件缺少固定标识。');
    return `https://api.github.com/repos/${this.repository}/releases/assets/${asset.id}`;
  }
  async check() {
    if (this.busy || this.status.kind === 'installed') return this.status;
    if (!this.repository) { this.setStatus({ kind: 'unconfigured' }); return this.status; }
    this.busy = true; this.setStatus({ kind: 'checking' });
    try {
      const metadata = JSON.parse(await this.request(`https://api.github.com/repos/${this.repository}/releases/latest`, { limit: 2 * 1024 * 1024 }));
      if (metadata.draft || metadata.prerelease || !Array.isArray(metadata.assets)) fail('INVALID_PACKAGE', '没有可安装的正式发布版本。');
      const asset = name => {
        const matches = metadata.assets.filter(a => a.name === name);
        if (matches.length !== 1) fail('INVALID_PACKAGE', '发布缺少完整安装附件：' + name);
        return matches[0];
      };
      const releaseRaw = await this.request(this.assetUrl(asset('release.json')), { accept: 'application/octet-stream', limit: 1024 * 1024 });
      const release = parseRelease(releaseRaw), difference = compareVersions(release.version, this.version), checkedAt = new Date().toISOString();
      if (difference <= 0) this.setStatus({ kind: difference < 0 ? 'ahead' : 'current', latest: release.version, checkedAt });
      else {
        const bundle = asset('tt-workbench.bundle.json.gz');
        if (!Number.isSafeInteger(bundle.size) || bundle.size <= 0 || bundle.size > 64 * 1024 * 1024) fail('INVALID_PACKAGE', '安装附件大小无效。');
        this.setStatus({ kind: 'available', latest: release.version, release, bundleUrl: this.assetUrl(bundle), bundleSize: bundle.size, checkedAt });
      }
    } catch (error) { this.setStatus({ kind: 'error', message: error.code && !/^E[A-Z_]+$/.test(error.code) ? error.message : error.code === 'INVALID_PACKAGE' || error.code === 'DOWNLOAD_FAILED' ? error.message : '检查更新失败，请核对公开仓库地址、网络及发布包。' }); }
    finally { this.busy = false; }
    return this.status;
  }
  async install() {
    if (this.busy || this.status.kind !== 'available') return this.status;
    this.busy = true; const available = this.status;
    this.setStatus({ ...available, kind: 'installing' });
    try {
      await this.beforeInstall?.();
      const baseline = parseRelease(await fs.readFile(path.join(this.target, 'release.json')));
      if (baseline.version !== this.version) fail('RESTART_REQUIRED', '已安装版本发生变化，请先重启 Obsidian。');
      const bytes = await this.request(available.bundleUrl, { accept: 'application/octet-stream' });
      if (bytes.length !== available.bundleSize) fail('VERIFY_FAILED', '下载的安装包大小与检查时不一致。');
      const bundle = packages.decodeBundle(bytes);
      const names = Object.keys(available.release.files);
      if (bundle.release.version !== available.release.version || names.length !== Object.keys(bundle.release.files).length || names.some(name => bundle.release.files[name] !== available.release.files[name])) fail('VERIFY_FAILED', '下载包与已检查版本不一致。');
      if (this.appVersion && compareVersions(this.appVersion, bundle.manifest.minAppVersion) < 0) fail('OBSIDIAN_TOO_OLD', `请先升级 Obsidian 至 ${bundle.manifest.minAppVersion}。`);
      const result = await packages.installPackage(bundle, { vault: this.vault, configDir: this.configDir });
      this.setStatus({ kind: 'installed', latest: available.latest, recovery: result.recovery });
    } catch (error) { this.setStatus({ kind: 'error', message: error.code === 'EEXIST' ? '已有安装操作或中断记录，请先核对插件目录中的安装锁。' : error.code && !/^E[A-Z_]+$/.test(error.code) ? error.message : ['VERIFY_FAILED', 'LOCAL_CHANGES', 'INVALID_PACKAGE', 'RESTART_REQUIRED', 'OBSIDIAN_TOO_OLD', 'UNSAFE_PATH'].includes(error.code) ? error.message : '安装未完成，已有版本及恢复材料已保留。' }); }
    finally { this.busy = false; }
    return this.status;
  }
}
module.exports = { WorkbenchUpdates, compareVersions, repositoryName, requestBytes, digest, parseRelease, readTree, treeFingerprint };
