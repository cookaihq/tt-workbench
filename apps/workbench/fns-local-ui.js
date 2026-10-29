'use strict';
const DEVICE = { ready: '本机配置正常', 'needs-migration': '旧配置待迁回', 'missing-config': '尚未配置 FNS', 'foreign-link': '配置归属需核对', 'broken-link': '本机链接已断开', conflict: '配置冲突' };
const STATUS = { configured: '已设置 · 已生效', pending: '已设置 · 待生效', 'needs-setup': '需要补齐', 'not-applicable': '不适用', unknown: '无法确认' };

class FnsLocalUI {
  constructor(view, onChange) { this.view = view; this.onChange = onChange; this.generation = 0; this.busy = false; }
  open() {
    if (this.dialog) return;
    this.dialog = this.view.contentEl.createEl('dialog', { cls: 'tw-modal tw-fns-modal', attr: { 'aria-label': '本机检查' } });
    this.body = this.dialog.createDiv();
    this.dialog.addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    this.dialog.addEventListener('close', () => this.close());
    this.dialog.showModal();
    void this.refresh();
  }
  async refresh() {
    const generation = ++this.generation;
    this.checking = true; this.render();
    const [device, protection] = await Promise.allSettled([
      this.view.plugin.fns.inspectLocal(), this.view.plugin.inspectLocalProtection()
    ]);
    if (!this.dialog || generation !== this.generation) return;
    this.device = device.status === 'fulfilled' ? device.value : null;
    this.report = protection.status === 'fulfilled' ? protection.value : null;
    this.readError = [device, protection].filter(item => item.status === 'rejected').map(item => item.reason.message).join('；');
    this.checking = false; this.render();
  }
  render() {
    if (!this.body) return;
    const body = this.body; body.empty();
    body.createEl('h2', { text: '本机检查' });
    if (this.device) {
      const device = this.device.device;
      body.createEl('p', { text: DEVICE[device.status] || device.status });
      if (device.deviceId) body.createEl('p', { text: '设备：' + device.deviceId, cls: 'tw-fns-caption' });
      body.createEl('p', { text: '本机配置：' + device.source, cls: 'tw-fns-caption' });
      for (const warning of this.device.runtime?.warnings || []) body.createEl('p', { text: warning, cls: 'tw-warning' });
    }
    body.createEl('h3', { text: '本机文件排除' });
    body.createEl('p', { text: '插件安装文件、恢复材料、运行记录和插件启用列表保留在本机。以下路径相对于当前知识库；父目录排除也算覆盖。', cls: 'tw-fns-caption' });
    const list = body.createEl('ul', { cls: 'tw-fns-protection-list', attr: { 'aria-label': '本机文件排除清单' } });
    for (const item of this.report?.paths || []) {
      const row = list.createEl('li');
      row.createEl('code', { text: item.path + (item.kind === 'directory' ? '/' : '') });
      const label = (item.excluded === true ? '已排除' : item.excluded === false ? '需设置' : '待核验') + (item.legacy ? ' · 旧配置' : '');
      const badge = row.createSpan({ text: label, cls: 'tw-fns-protection-item' });
      badge.dataset.state = item.excluded ? 'configured' : 'pending';
      if (item.reason) badge.title = item.reason;
    }
    body.createEl('p', { text: this.report?.message || '正在读取本机配置…', cls: 'tw-fns-caption' });
    body.createEl('p', { text: '补齐只保存本机排除。需要其他设备采用时，再比较并发布本机配置。此处不检查远端发布状态。', cls: 'tw-fns-caption' });
    const error = this.error || this.readError;
    if (error) body.createDiv({ text: error, cls: 'tw-fns-alert', attr: { role: 'alert' } });
    const actions = body.createDiv({ cls: 'tw-fns-actions' });
    const button = (text, action) => this.view.button(actions, text, text, action);
    const setup = button('补齐本机排除', () => void this.configure());
    setup.disabled = this.busy || this.checking || !this.report?.canConfigure || this.report.configured;
    actions.createSpan({ text: this.busy ? '正在设置…' : this.checking ? '正在检查…' : STATUS[this.report?.status] || '无法确认', cls: 'tw-fns-caption', attr: { role: 'status', 'aria-live': 'polite' } });
    button('重新检查', () => void this.refresh()).disabled = this.busy || this.checking;
    button('关闭', () => this.close()).disabled = this.busy;
  }
  async configure() {
    if (this.busy || this.checking || !this.report?.canConfigure || this.report.configured) return;
    this.busy = true; this.error = ''; this.render();
    try { await this.view.plugin.configureLocalProtection(); }
    catch (error) { this.error = error.message; }
    finally { this.busy = false; await this.refresh(); await this.onChange?.(); }
  }
  close() {
    if (this.busy) return;
    ++this.generation;
    const dialog = this.dialog;
    this.dialog = null; this.body = null; this.error = ''; dialog?.remove();
  }
  dispose() { ++this.generation; this.dialog?.remove(); this.dialog = null; this.body = null; }
}
module.exports = { FnsLocalUI };
