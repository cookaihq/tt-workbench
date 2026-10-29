'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FnsUI } = require('../fns-ui.js');
const { UpdatesUI } = require('../updates-ui.js');

// Small Obsidian DOM surface: tests exercise the real rendering and callbacks.
class Element {
  constructor(tag, options = {}) { this.tag = tag; this.text = options.text || ''; this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = { ...options.attr }; }
  createEl(tag, options) { const child = new Element(tag, options); child.parent = this; this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  empty() { this.children = []; }
  setText(value) { this.text = value; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addClass() {}
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
  remove() { this.removed = true; }
  find(text) { return this.children.flatMap(child => [child, ...child.all()]).find(child => child.text === text); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
}
const view = plugin => ({ plugin, contentEl: new Element('div'), closed: false, pageScope: '@fns', button(parent, text, title, action) {
  const button = parent.createEl('button', { text }); button.addEventListener('click', action); return button;
} });

test('版本弹窗只操作更新服务，打开和重新渲染均不读取 FNS', () => {
  const updates = { status: { kind: 'unconfigured', current: '0.25.1' }, repository: '', subscribe: () => () => {} };
  const v = view({ updates });
  const ui = new UpdatesUI(v); ui.mount(new Element('div')); ui.open();
  assert.ok(ui.body.textContent.includes('工作台版本'));
  assert.ok(!ui.body.textContent.includes('代码同步设置'));
  assert.ok(!ui.body.textContent.includes('本机文件排除'));
  ui.render({ kind: 'current', current: '0.25.1' });
  ui.close();
});

test('发布记录损坏不影响打开本机检查、补齐排除和显示文件路径', async () => {
  let configured = false, writes = 0;
  const plugin = {
    fns: {
      inspect: async () => { throw Error('broken publication state'); },
      inspectLocal: async () => ({ device: { status: 'ready', source: 'settings/plugins/fast-note-sync/data.json' }, runtime: { warnings: [] } })
    },
    inspectLocalProtection: async () => ({ status: configured ? 'configured' : 'needs-setup', configured, canConfigure: true,
      paths: [{ path: 'settings/plugins/tt-workbench.install-lock', kind: 'file', excluded: configured }] }),
    configureLocalProtection: async () => { configured = true; writes++; }
  };
  const ui = new FnsUI(view(plugin));
  await ui.refresh(); assert.equal(ui.error, 'broken publication state');
  ui.checkDialog(); await ui.localUI.refresh();
  assert.ok(ui.localUI.body.textContent.includes('本机文件排除'));
  assert.ok(!ui.localUI.body.textContent.includes('tt-workbench.install-lock/'));
  assert.equal(ui.localUI.body.find('补齐本机排除').disabled, false);
  await ui.localUI.configure();
  assert.equal(writes, 1);
  assert.equal(ui.localUI.report.status, 'configured');
  assert.equal(ui.localUI.body.find('补齐本机排除').disabled, true);
  assert.equal(ui.error, 'broken publication state');
  ui.localUI.close();
});

test('关闭本机弹窗后异步检查结果不重新创建界面', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const ui = new FnsUI(view({ fns: { inspectLocal: async () => pending }, inspectLocalProtection: async () => pending }));
  ui.checkDialog(); const local = ui.localUI;
  local.close(); resolve({}); await pending; await new Promise(done => setImmediate(done));
  assert.equal(local.body, null); assert.equal(local.dialog, null);
});

const emptyRules = () => ({ configSyncOtherDirs: [], syncExcludeFolders: [], syncExcludeExtensions: [], syncExcludeWhitelist: [] });
function applicationReport() {
  return {
    device: { status: 'ready', deviceId: 'test-device' }, local: { rules: emptyRules() }, status: 'update-available',
    publication: { version: 2, sourceDevice: 'other-device', publishedAt: '2026-10-29T00:00:00Z', rules: emptyRules() },
    application: { allowed: false, code: 'PROTECTED_SCOPE', message: '此版本不能直接应用到本机：必须保留 .system/.workbench-runtime/ 的明确目录排除。' }
  };
}

test('提示条直接补齐本机排除，防止重复点击；完成后仅预览修正版，不自动发布或应用', async () => {
  let configured = false, writes = 0, previews = 0, publications = 0, applications = 0, finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const ui = new FnsUI(view({
    fns: {
      inspect: async () => applicationReport(),
      preview: async kind => {
        assert.equal(kind, 'publish'); previews++;
        return { version: 3, diff: Object.fromEntries(Object.keys(emptyRules()).map(field => [field, { add: [], remove: [] }])) };
      },
      publish: async () => { publications++; }, apply: async () => { applications++; }
    },
    inspectLocalProtection: async () => ({ configured, canConfigure: true, status: configured ? 'configured' : 'needs-setup' }),
    configureLocalProtection: async () => { writes++; await pending; configured = true; return { message: '本机排除已保存并加载。' }; }
  }));
  ui.build(new Element('div')); await ui.refresh();
  const configure = ui.panel.find('补齐本机排除');
  assert.equal(configure.disabled, false);
  const operation = configure.listeners.click();
  assert.equal(ui.panel.find('补齐本机排除').disabled, true);
  await configure.listeners.click(); assert.equal(writes, 1);
  finish(); await operation;
  assert.equal(ui.panel.find('补齐本机排除'), undefined);
  assert.ok(ui.panel.textContent.includes('本机排除已齐全并生效'));
  assert.ok(ui.panel.textContent.includes('此版本暂不可应用'));
  assert.ok(!ui.panel.textContent.includes('有版本可应用'));
  assert.equal(ui.panel.find('比较并应用').disabled, true);
  assert.equal(previews, 0); assert.equal(publications, 0); assert.equal(applications, 0);
  await ui.panel.find('比较并发布').listeners.click();
  assert.equal(previews, 1); assert.equal(publications, 0);
  assert.ok(ui.view.contentEl.find('确认发布并推送'));
  ui.view.contentEl.find('取消').listeners.click();
  assert.equal(publications, 0);
});

test('补齐失败显示原因、恢复按钮并保留不可应用状态', async () => {
  const ui = new FnsUI(view({
    fns: { inspect: async () => applicationReport() },
    inspectLocalProtection: async () => ({ configured: false, canConfigure: true, status: 'needs-setup' }),
    configureLocalProtection: async () => { throw Error('白名单可能覆盖恢复目录；请收窄为明确的其他目录。'); }
  }));
  ui.build(new Element('div')); await ui.refresh();
  await ui.panel.find('补齐本机排除').listeners.click();
  assert.ok(ui.panel.textContent.includes('白名单可能覆盖恢复目录'));
  assert.equal(ui.panel.find('补齐本机排除').disabled, false);
  assert.equal(ui.panel.find('比较并发布'), undefined);
  assert.equal(ui.panel.find('比较并应用').disabled, true);
  assert.equal(ui.message, '');
});

test('本机已保存但未加载时明确显示待核验，待推送记录阻止新发布', async () => {
  const report = applicationReport();
  const ui = new FnsUI(view({
    fns: { inspect: async () => structuredClone(report) },
    inspectLocalProtection: async () => ({ configured: true, canConfigure: true, status: 'pending' })
  }));
  ui.build(new Element('div')); await ui.refresh();
  assert.ok(ui.panel.textContent.includes('FNS 加载仍待核验'));
  assert.ok(!ui.panel.textContent.includes('已齐全并生效'));
  assert.equal(ui.panel.find('补齐本机排除'), undefined);
  assert.equal(ui.panel.find('比较并发布').disabled, false);
  report.pending = { version: 3 };
  await ui.refresh();
  assert.equal(ui.panel.find('比较并发布').disabled, true);
  assert.ok(ui.panel.textContent.includes('请先处理页面下方的待推送记录'));
});

test('本机检查不可用时保留版本比较，其他发布异常不提供补齐快捷操作', async () => {
  const report = applicationReport(); let localChecks = 0;
  const ui = new FnsUI(view({
    fns: { inspect: async () => structuredClone(report) },
    inspectLocalProtection: async () => { localChecks++; throw Error('配置暂不可读'); }
  }));
  ui.build(new Element('div')); await ui.refresh();
  assert.ok(ui.panel.find('查看本机检查'));
  assert.ok(ui.panel.find('权威版本 v2'));
  assert.equal(ui.panel.find('补齐本机排除'), undefined);
  report.blocked = { code: 'INVALID_PUBLICATION' };
  await ui.refresh();
  assert.equal(localChecks, 1);
  assert.equal(ui.panel.find('补齐本机排除'), undefined);
  assert.equal(ui.panel.find('比较并发布'), undefined);
  assert.equal(ui.panel.find('比较并应用').disabled, true);
});
