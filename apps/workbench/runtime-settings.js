'use strict';
const path = require('node:path');
// Loaded from both source tests and the complete installed package.
const runtime = require('./shared.js').runtimeStorage;
const migration = require(require('node:fs').existsSync(path.join(__dirname, 'lib/runtime/migrate.cjs')) ? './lib/runtime/migrate.cjs' : '../../lib/runtime/migrate.cjs');

class RuntimeSettings {
  constructor(plugin) { this.plugin = plugin; this.busy = false; }
  roots() {
    const vault = this.plugin.app.vault.adapter.getBasePath();
    const development = this.plugin.issues.root;
    return [{ root: vault, label: '当前知识库' }, ...(path.resolve(vault) !== path.resolve(development) ? [{ root: development, label: '开发 Issue 所属实例' }] : [])];
  }
  options(root, extra = {}) {
    if (!this.roots().some(item => item.root === root)) throw Error('请选择当前知识库或已配置的开发根。');
    return { vault: root, configDir: root === this.roots()[0].root ? this.plugin.app.vault.configDir : '.obsidian', ...extra };
  }
  inspect(root, directory) { return migration.inspect(this.options(root, directory === undefined ? {} : { directory })); }
  async apply(root, { plan, directory, backup, resume = false, restore = false }) {
    if (this.busy) throw Error('已有运行位置操作正在执行。');
    this.busy = true;
    const local = root === this.roots()[0].root, bridge = this.plugin.agentBridge;
    const bridgeWasRunning = local && Boolean(bridge?.server?.listening);
    let previous, result, failure;
    try {
      if (local) {
        await bridge?.stop();
        previous = await this.plugin.fns.runtime.suspend();
      }
      // inspect fingerprints exclude ephemeral bridge and lease files, but every
      // migration still checks those files are gone before touching records.
      result = await migration.migrate(this.options(root, { directory, backup, expected: plan?.fingerprint, resume, restore, writersStopped: true, configureIsolation: true }));
    } catch (error) { failure = error; }
    finally {
      const warnings = [];
      if (previous) {
        try {
          await this.plugin.fns.runtime.restore(previous);
          const loaded = await this.plugin.fns.runtime.inspect();
          if (previous.enabled && (!loaded.loaded || !loaded.settings)) throw Error('FNS 尚未重新加载。');
          if (loaded.settings) runtime.assertFnsExcluded(loaded.settings, root);
        } catch (error) { warnings.push('FNS 恢复或排除核验未通过：' + error.message); }
      }
      if (bridgeWasRunning || local && !failure && previous?.enabled) {
        try { await bridge.start(); } catch (error) { warnings.push('连接服务尚未恢复：' + error.message); }
      }
      this.busy = false;
      if (failure) { failure.message += warnings.length ? '；' + warnings.join('；') : ''; throw failure; }
      if (result) result.warnings = warnings;
    }
    return result;
  }
}
module.exports = { RuntimeSettings };
