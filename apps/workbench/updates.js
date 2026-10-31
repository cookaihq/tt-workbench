"use strict";
const path = require('node:path');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const local = createRequire(__filename);
let packages, github;
try { packages = local('./lib/workbench/package.cjs'); github = local('./lib/github/releases.cjs'); } catch { packages = local('../../lib/workbench/package.cjs'); github = local('../../lib/github/releases.cjs'); }
const { repositoryName, requestBytes } = github;
const { hash: digest, parseRelease, readTree, fingerprint: treeFingerprint } = packages;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function compareVersions(a, b) {
  const parse = value => { if (!/^\d+\.\d+\.\d+$/.test(value)) fail('INVALID_VERSION', '版本号必须为主版本.次版本.修订号。'); return value.split('.').map(Number); };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
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
    if (this.status.retryAfter && Date.parse(this.status.retryAfter) > Date.now()) return this.status;
    if (!this.repository) { this.setStatus({ kind: 'unconfigured' }); return this.status; }
    this.busy = true; this.setStatus({ kind: 'checking' });
    try {
      const deadline = Date.now() + 15000;
      const releases = await github.listReleases(this.repository, { request: this.request, deadline });
      const metadata = releases.filter(r => /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(r.tag_name)).sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
      if (!metadata || !Array.isArray(metadata.assets)) fail('INVALID_PACKAGE', '没有可安装的正式工作台版本。');
      const asset = name => {
        const matches = metadata.assets.filter(a => a.name === name);
        if (matches.length !== 1) fail('INVALID_PACKAGE', '发布缺少完整安装附件：' + name);
        return matches[0];
      };
      const releaseRaw = await github.withinBudget(this.request, this.assetUrl(asset('release.json')), { accept: 'application/octet-stream', limit: 2 * 1024 * 1024, deadline });
      const release = parseRelease(releaseRaw), difference = compareVersions(release.version, this.version), checkedAt = new Date().toISOString();
      if (metadata.tag_name !== 'v' + release.version) fail('INVALID_PACKAGE', '工作台版本与发布标签不一致。');
      if (release.skillPackages && release.skillSource?.kind !== 'release') fail('INVALID_PACKAGE', '工作台发布包仍包含开发中的 Skill 候选，不能作为正式更新安装。');
      if (difference <= 0) this.setStatus({ kind: difference < 0 ? 'ahead' : 'current', latest: release.version, checkedAt });
      else {
        const bundle = asset('tt-workbench.bundle.json.gz');
        if (!Number.isSafeInteger(bundle.size) || bundle.size <= 0 || bundle.size > 64 * 1024 * 1024) fail('INVALID_PACKAGE', '安装附件大小无效。');
        this.setStatus({ kind: 'available', latest: release.version, release, bundleUrl: this.assetUrl(bundle), bundleSize: bundle.size, checkedAt });
      }
    } catch (error) { this.setStatus({ kind: 'error', retryAfter: error.retryAfter, message: error.code && !/^E[A-Z_]+$/.test(error.code) ? error.message : error.code === 'INVALID_PACKAGE' || error.code === 'DOWNLOAD_FAILED' ? error.message : '检查更新失败，请核对公开仓库地址、网络及发布包。' }); }
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
      const bytes = await github.withinBudget(this.request, available.bundleUrl, { accept: 'application/octet-stream', deadline: Date.now() + 60000 });
      if (bytes.length !== available.bundleSize) fail('VERIFY_FAILED', '下载的安装包大小与检查时不一致。');
      const bundle = packages.decodeBundle(bytes);
      if (JSON.stringify(bundle.release) !== JSON.stringify(available.release)) fail('VERIFY_FAILED', '下载包与已检查版本不一致。');
      if (this.appVersion && compareVersions(this.appVersion, bundle.manifest.minAppVersion) < 0) fail('OBSIDIAN_TOO_OLD', `请先升级 Obsidian 至 ${bundle.manifest.minAppVersion}。`);
      const result = await packages.installPackage(bundle, { vault: this.vault, configDir: this.configDir });
      this.setStatus({ kind: 'installed', latest: available.latest, recovery: result.recovery });
    } catch (error) { this.setStatus({ kind: 'error', retryAfter: error.retryAfter, message: error.code === 'EEXIST' ? '已有安装操作或中断记录，请先核对插件目录中的安装锁。' : error.code && !/^E[A-Z_]+$/.test(error.code) ? error.message : ['VERIFY_FAILED', 'LOCAL_CHANGES', 'INVALID_PACKAGE', 'RESTART_REQUIRED', 'OBSIDIAN_TOO_OLD', 'UNSAFE_PATH'].includes(error.code) ? error.message : '安装未完成，已有版本及恢复材料已保留。' }); }
    finally { this.busy = false; }
    return this.status;
  }
}
module.exports = { WorkbenchUpdates, compareVersions, repositoryName, requestBytes, digest, parseRelease, readTree, treeFingerprint };
