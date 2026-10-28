'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const ID = 'fast-note-sync';
const error = (code, message) => Object.assign(new Error(message), { code });

function createFnsRuntime(app) {
  const managers = app.plugins;
  async function settled(enabled) {
    const deadline = Date.now() + 5000;
    do {
      try {
        const saved = JSON.parse(await fs.readFile(path.join(app.vault.adapter.getBasePath(), app.vault.configDir, 'community-plugins.json'), 'utf8'));
        if (Boolean(managers.plugins[ID]) === enabled && managers.enabledPlugins.has(ID) === enabled && Array.isArray(saved) && saved.includes(ID) === enabled) return;
      } catch { /* Obsidian may still be writing its plugin list. */ }
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw error(enabled ? 'FNS_LOAD_FAILED' : 'FNS_PAUSE_FAILED', enabled ? 'FNS 尚未恢复加载。' : 'FNS 未完全停用，配置未写入。');
  }
  return {
    async inspect() {
      const plugin = managers.plugins[ID];
      return { enabled: managers.enabledPlugins.has(ID), loaded: Boolean(plugin), connected: plugin ? Boolean(plugin.websocket?.isAuth) : null, settings: plugin?.settings };
    },
    async suspend() {
      const plugin = managers.plugins[ID], previous = { enabled: managers.enabledPlugins.has(ID) };
      if (plugin && (plugin.isSyncing || plugin.isSyncRequesting || plugin.pendingNoteDeleteAcks?.size || plugin.pendingFileDeleteAcks?.size)) {
        throw error('FNS_BUSY', 'FNS 正在同步，请等待本轮同步结束后重试。');
      }
      try {
        if (plugin || previous.enabled) await managers.disablePluginAndSave(ID);
        await settled(false);
        return previous;
      } catch {
        if (previous.enabled && !managers.plugins[ID]) {
          try { await managers.enablePluginAndSave(ID); await settled(true); } catch { throw error('FNS_PAUSE_FAILED', '暂停 FNS 未完成，且恢复失败；请检查插件启用状态。'); }
        }
        throw error('FNS_PAUSE_FAILED', '无法核验 FNS 已停用，配置未写入。');
      }
    },
    async restore(previous) {
      if (!previous.enabled) return;
      await managers.enablePluginAndSave(ID);
      await settled(true);
    }
  };
}
module.exports = { createFnsRuntime };
