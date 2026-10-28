const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');

module.exports = async function probe(app) {
  if (app.vault.getName() !== 'tannt') throw new Error('当前窗口不是 tannt。');
  const root = app.vault.adapter.getBasePath();
  const output = path.join(root, 'docs/workbench/verification/01-integration-probe.json');
  const report = { vault: 'tannt', checkedAt: new Date().toISOString() };
  await app.plugins.loadManifests();
  try {
    if (app.plugins.plugins['tannt-workbench']) {
      if (typeof app.plugins.unloadPlugin !== 'function') throw new Error('当前 Obsidian 不提供插件重载入口。');
      await app.plugins.unloadPlugin('tannt-workbench');
    }
    await app.plugins.enablePluginAndSave('tannt-workbench');
    report.pluginLoaded = Boolean(app.plugins.plugins['tannt-workbench']);
    if (report.pluginLoaded) await app.plugins.plugins['tannt-workbench'].openWorkbench();
  } catch (error) {
    report.pluginLoaded = false;
    report.pluginError = String(error.message);
  }
  const fns = app.plugins.plugins['fast-note-sync'];
  if (fns?.settings.vault !== 'tannt') throw new Error('FNS 未绑定 tannt，停止探测。');
  const api = new URL(fns.runApi || fns.settings.api);
  const token = fns.settings.apiToken;
  report.fns = { protocol: api.protocol, webPath: '/webgui/' };
  if (!token || /^(encrypted:|fns-enc)/.test(token)) {
    report.fns.noteRead = '运行中的插件没有可直接使用的凭证，未发送请求。';
  } else {
    const url = new URL('/api/note', api);
    url.searchParams.set('vault', 'tannt');
    url.searchParams.set('path', '欢迎.md');
    try {
      const response = await new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.get(url, { headers: { Authorization: `Bearer ${token}` } }, res => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        request.setTimeout(10000, () => request.destroy(new Error('timeout')));
        request.on('error', reject);
      });
      const result = JSON.parse(response.data);
      const local = await fs.readFile(path.join(root, '欢迎.md'), 'utf8');
      report.fns.noteRead = { httpStatus: response.status, code: result.code, status: result.status,
        contentMatchesLocal: result.data?.content === local, dataFields: Object.keys(result.data || {}) };
    } catch (error) { report.fns.noteRead = { errorCode: error.code || 'REQUEST_FAILED' }; }
  }
  const remote = require('electron').remote;
  report.electronRemoteAvailable = Boolean(remote?.getCurrentWindow);
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log('TANNT_PROBE_SAVED');
  return report;
};
