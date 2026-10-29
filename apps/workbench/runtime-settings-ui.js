'use strict';
class RuntimeSettingsUI {
  constructor(view) { this.view = view; this.service = view.plugin.runtimeSettings; this.generation = 0; }
  mount(header) {
    const button = header.createEl('button', { text: '运行数据位置', attr: { 'aria-label': '设置运行数据位置' } });
    button.addEventListener('click', () => this.open());
  }
  open() {
    if (this.dialog) return;
    this.dialog = this.view.contentEl.createEl('dialog', { cls: 'tw-modal tw-runtime-modal', attr: { 'aria-label': '运行数据位置' } });
    this.dialog.createEl('h2', { text: '运行数据位置' });
    this.dialog.createEl('p', { text: '保存本机锁、操作回执和恢复材料。更改位置会核验并迁移现有数据，完成后所有入口立即使用新位置。' });
    const label = (text, name, placeholder) => {
      const el = this.dialog.createEl('label', { cls: 'tw-runtime-field' }); el.createSpan({ text });
      return el.createEl('input', { attr: { 'aria-label': name, placeholder } });
    };
    const roots = this.service.roots();
    this.select = this.dialog.createEl('select', { attr: { 'aria-label': '运行数据所属实例' } });
    for (const item of roots) this.select.createEl('option', { text: `${item.label} · ${item.root}`, value: item.root });
    this.select.addEventListener('change', () => void this.load());
    this.current = this.dialog.createEl('p');
    this.directory = label('保存目录', '运行数据相对目录', '.system/.workbench-runtime');
    this.dialog.createEl('p', { cls: 'tw-muted', text: '路径相对于上方选定的实例根目录。默认：.system/.workbench-runtime/。位置配置固定保存在该实例的 .system/workbench/runtime.jsonc。' });
    this.backup = label('迁移备份目录', '运行数据迁移备份目录', '库外独立目录的绝对路径');
    this.dialog.createEl('p', { cls: 'tw-muted', text: '请先结束独立 CLI 操作。迁移时暂停本库连接服务与 FNS，完成后恢复；为新旧位置补齐本机 Git/FNS 排除。备份可能含本机配置，请保留在本机。开发实例有其他写入程序时，先停止后再操作。' });
    this.message = this.dialog.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
    const actions = this.dialog.createDiv({ cls: 'tw-actions' });
    const button = (text, action) => { const b = actions.createEl('button', { text }); b.addEventListener('click', action); return b; };
    this.previewButton = button('预览迁移', () => void this.preview());
    this.defaultButton = button('恢复默认位置', () => { this.directory.value = '.system/.workbench-runtime'; this.plan = null; void this.preview(); });
    this.applyButton = button('迁移并保存', () => void this.apply());
    this.resumeButton = button('继续上次迁移', () => void this.apply('resume'));
    this.restoreButton = button('从备份恢复旧位置', () => void this.apply('restore'));
    this.closeButton = button('关闭', () => this.close());
    this.directory.addEventListener('input', () => { this.plan = null; this.applyButton.disabled = true; });
    this.dialog.addEventListener('cancel', event => { if (this.service.busy) event.preventDefault(); });
    this.dialog.addEventListener('close', () => this.close());
    this.dialog.showModal(); void this.load();
  }
  async load() {
    const generation = ++this.generation;
    try {
      const report = await this.service.inspect(this.select.value);
      if (generation !== this.generation || !this.dialog) return;
      this.current.setText(`当前设置：${report.vault.replace(/\\/g, '/')}/${report.current}/${report.status === 'ready' ? '' : `；待处理：${report.from}/`}`);
      this.directory.value = report.current;
      this.backup.value = report.pending?.backup || '';
      this.plan = null; this.applyButton.disabled = true;
      this.resumeButton.disabled = !report.pending;
      this.message.setText(report.pending ? `上次迁移尚未结束，可继续或恢复。备份：${report.pending.backup}` : '先预览迁移，再保存位置。');
    } catch (error) { if (generation === this.generation && this.dialog) this.message.setText(error.message); }
  }
  async preview() {
    const generation = ++this.generation, root = this.select.value, directory = this.directory.value.trim();
    this.plan = null; this.applyButton.disabled = true;
    try {
      const report = await this.service.inspect(root, directory);
      if (generation !== this.generation || !this.dialog) return;
      this.plan = report;
      this.message.setText(report.status === 'ready' ? '当前已经使用此位置，无需迁移。' : `${report.from}/ → ${report.to}/；${report.source.files.filter(f => f.path !== 'agent-bridge.json' && !f.path.startsWith('writers/')).length} 个文件。${report.conflicts.length ? '目标存在冲突，需先核对。' : '确认备份目录后迁移并保存。'}`);
      this.applyButton.disabled = report.status !== 'needs-migration' || Boolean(report.conflicts.length);
    } catch (error) { if (generation === this.generation && this.dialog) this.message.setText(error.message); }
  }
  async apply(mode) {
    if (this.service.busy || !mode && !this.plan) return;
    const directory = this.directory.value.trim(), backup = this.backup.value.trim();
    const controls = [this.select, this.directory, this.backup, this.previewButton, this.defaultButton, this.applyButton, this.resumeButton, this.restoreButton, this.closeButton];
    for (const el of controls) el.disabled = true;
    this.message.setText('正在核验并处理运行数据，请保留当前窗口…');
    try {
      const result = await this.service.apply(this.select.value, { plan: this.plan, directory, backup, resume: mode === 'resume', restore: mode === 'restore' });
      await this.load();
      this.backup.value = result.backup || '';
      this.message.setText(`${result.status === 'restored' ? '已恢复旧位置' : '已保存运行位置'}：${result.runtime}/。${result.backup ? `备份：${result.backup}。` : ''}${(result.warnings || []).join('；')}`);
    } catch (error) {
      await this.load(); this.directory.value = directory; this.backup.value ||= backup; this.message.setText(error.message);
    } finally {
      for (const el of controls) el.disabled = false;
      this.plan = null; this.applyButton.disabled = true;
    }
  }
  close() { if (this.service.busy) return; ++this.generation; const dialog = this.dialog; this.dialog = null; dialog?.remove(); }
  dispose() { this.close(); }
}
module.exports = { RuntimeSettingsUI };
