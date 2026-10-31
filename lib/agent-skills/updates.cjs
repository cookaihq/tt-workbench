'use strict';
const releases = require('./releases.cjs');
const packages = require('./package.cjs');
const installer = require('./install.cjs');
const github = require('../github/releases.cjs');
const { inspectIsolation } = require('./isolation.cjs');
class SkillUpdates {
  constructor({ manager, repository = '', workbenchVersion, request = github.requestBytes, beforeInstall } = {}) {
    this.manager = manager; this.repository = repository; this.workbenchVersion = workbenchVersion;
    this.request = request; this.beforeInstall = beforeInstall; this.status = { kind: 'idle' };
  }
  currentRepository() { return github.repositoryName(typeof this.repository === 'function' ? this.repository() : this.repository); }
  async check() {
    if (this.busy) return this.status;
    if (this.status.retryAfter && Date.parse(this.status.retryAfter) > Date.now()) return this.status;
    const repository = this.currentRepository();
    if (!repository) return this.status = { kind: 'unconfigured', message: '请在工作台版本设置中配置公开发布仓库。' };
    this.busy = true; this.status = { kind: 'checking' };
    try {
      const catalog = await this.manager.catalog();
      const result = await releases.discover({ repository, required: catalog.names, request: this.request });
      this.status = { ...result, repository, kind: result.complete ? 'ready' : 'partial', checkedAt: new Date().toISOString(), message: result.complete ? '' : '较新批次未通过核验，已列出最近有效版本；当前不能确定是否已是最新。' };
    } catch (error) { this.status = { kind: 'error', message: error.code ? error.message : 'Skill 更新检查失败，当前版本保持可用。', retryAfter: error.retryAfter }; }
    finally { this.busy = false; }
    return this.status;
  }
  forItem(item, agent) {
    const s = this.status;
    if (!['ready', 'partial'].includes(s.kind) || s.repository !== this.currentRepository()) return { kind: s.kind === 'error' ? 'unknown' : 'unchecked', message: s.message || '尚未检查正式版本。' };
    const available = s.catalog.skills.find(i => i.name === item.name);
    if (!available) return { kind: 'unknown', message: '正式清单缺少此 Skill。' };
    const reason = packages.compatibilityReason(available.compatibility, { workbench: this.workbenchVersion, host: agent });
    const result = { version: available.version, notes: available.notes, batch: s.catalog.batch, checkedAt: s.checkedAt };
    if (reason) return { ...result, kind: 'incompatible', message: reason };
    const difference = item.resourceVersion ? packages.compareVersions(available.version, item.resourceVersion) : 1;
    if (difference === 0 && item.contentHash && item.contentHash !== available.contentHash) return { ...result, kind: 'unknown', message: '同名同版本的内容与正式发布不一致，已保留本机内容，请核对安装来源。' };
    return { ...result, kind: difference > 0 ? 'available' : difference < 0 ? 'ahead' : s.kind === 'partial' ? 'unknown' : 'current', message: difference > 0 ? `可更新至 v${available.version}` : difference < 0 ? '本机版本较新。' : s.kind === 'partial' ? s.message : '已是最新正式版本。' };
  }
  async install({ name, agent = 'codex', expected } = {}) {
    if (this.busy) packages.fail('BUSY', '请等当前 Skill 更新操作结束。');
    const checked = this.status, repository = this.currentRepository();
    if (!['ready', 'partial'].includes(checked.kind) || checked.repository !== repository) packages.fail('CHECK_REQUIRED', '请先重新检查 Skill 正式版本。');
    this.busy = true;
    try {
      const snapshot = await this.manager.scan(agent), item = snapshot.items.find(i => i.name === name);
      if (!item || !['installed', 'absent'].includes(item.status)) packages.fail('ENTRY_NOT_READY', '请先处理此 Skill 的发现入口或资源状态。');
      if (expected && item.token !== expected) packages.fail('STALE_SKILL', 'Skill 或入口已变化，请重新检查。');
      if (this.forItem(item, agent).kind !== 'available') packages.fail('NO_UPDATE', '此 Skill 当前没有可安装的新版。');
      const isolation = await inspectIsolation(this.manager, agent, { packages: true });
      if (!isolation.ok) packages.fail('ISOLATION_REQUIRED', isolation.reasons.join('；'));
      await this.beforeInstall?.(agent);
      const available = checked.catalog.skills.find(i => i.name === name);
      const bytes = await github.withinBudget(this.request, checked.downloads[name], { accept: 'application/octet-stream', limit: packages.LIMIT, deadline: Date.now() + 60000 });
      if (bytes.length !== available.artifact.size || packages.hash(bytes) !== available.artifact.sha256) packages.fail('VERIFY_FAILED', 'Skill 下载包校验失败，原版本保持可用。');
      const bundle = packages.decodeBundle(bytes), m = bundle.manifest;
      if (m.name !== name || m.version !== available.version || m.contentHash !== available.contentHash || JSON.stringify(m.compatibility) !== JSON.stringify(available.compatibility) || m.notes !== available.notes) packages.fail('VERIFY_FAILED', '下载的 Skill 与已检查正式清单不一致。');
      // Recheck the user's displayed source after downloading, before switching.
      const fresh = (await this.manager.scan(agent)).items.find(i => i.name === name);
      if (fresh?.token !== item.token) packages.fail('STALE_SKILL', '下载期间 Skill 或入口已变化，请重新检查。');
      const result = await installer.installSkill(bundle, { vault: this.manager.vault, configDir: this.manager.configDir, workbenchVersion: this.workbenchVersion, expected: item.contentHash });
      return { ...result, snapshot: await this.manager.scan(agent), message: `已安装 ${name} v${m.version}。两个已注册宿主共用此版本；请在新会话中核对实际调用提示。` };
    } catch (error) {
      if (error.retryAfter) this.status = { kind: 'error', retryAfter: error.retryAfter, message: error.message };
      throw error;
    } finally { this.busy = false; }
  }
  async recover({ operation, agent = 'codex', mode = 'rollback' } = {}) {
    if (this.busy) packages.fail('BUSY', '请等当前 Skill 操作结束。');
    this.busy = true;
    try {
      const isolation = await inspectIsolation(this.manager, agent, { packages: true });
      if (!isolation.ok) packages.fail('ISOLATION_REQUIRED', isolation.reasons.join('；'));
      await this.beforeInstall?.(agent);
      return { ...await installer.recoverSkill({ vault: this.manager.vault, configDir: this.manager.configDir, operation, mode }), snapshot: await this.manager.scan(agent) };
    } finally { this.busy = false; }
  }
}
module.exports = { SkillUpdates };
