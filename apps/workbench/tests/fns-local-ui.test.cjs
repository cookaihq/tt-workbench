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
