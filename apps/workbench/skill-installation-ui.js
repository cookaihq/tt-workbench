'use strict';
const { HOSTS, LABELS } = require('./lib/agent-skills/manager.cjs');
const OUTCOMES = { success: '成功', unchanged: '保持', skipped: '跳过', failed: '失败' };

class SkillInstallationUI {
  constructor(view) { this.view = view; this.manager = view.plugin.skills; this.agent = 'codex'; this.generation = 0; this.selected = ''; this.receipts = {}; }
  active() { return this.view.pageScope === '@skills' && !this.view.closed; }
  build(parent) { this.root = parent.createDiv({ cls: 'tw-skills-page' }); this.root.hidden = true; }
  enter() {
    this.root.hidden = false;
    this.view.pageEyebrow.setText('SYSTEM / 系统'); this.view.pageTitle.setText('Skill 安装');
    this.view.pageDescription.setText('让 Agent 在当前知识库中使用工作台的内置能力。');
    if (!this.visible) { this.visible = true; void this.refresh(); }
  }
  leave() { this.visible = false; ++this.generation; this.checking = false; this.root.hidden = true; this.closeDialog(); }
  button(parent, text, action, { primary = false, disabled = false, label = text } = {}) {
    const button = this.view.button(parent, label, text, action);
    if (primary) button.addClass('mod-cta');
    button.disabled = disabled || Boolean(this.busy) || Boolean(this.checking);
    return button;
  }
  async refresh() {
    if (this.busy) return;
    const request = ++this.generation, agent = this.agent;
    this.checking = true; this.error = ''; this.render();
    try {
      const snapshot = await this.manager.scan(agent);
      if (request === this.generation) this.snapshot = snapshot;
    } catch (error) { if (request === this.generation) { this.snapshot = null; this.error = `检查失败：${error.message}`; } }
    finally { if (request === this.generation) { this.checking = false; if (this.active()) this.render(); } }
  }
  writable() { return this.snapshot?.agent === this.agent && this.snapshot.isolation.ok && !this.snapshot.busy && !this.checking && !this.busy; }
  render() {
    this.root.empty();
    const s = this.snapshot?.agent === this.agent ? this.snapshot : null;
    const scope = this.root.createEl('section', { cls: 'tw-skills-scope', attr: { 'aria-label': '安装范围' } });
    const location = scope.createDiv(); location.createDiv({ text: '安装范围 · 当前知识库', cls: 'tw-muted' });
    location.createEl('strong', { text: this.view.app.vault.getName() });
    location.createDiv({ text: this.manager.vault, cls: 'tw-skills-path' });
    const hosts = scope.createDiv({ cls: 'tw-skills-hosts', attr: { role: 'group', 'aria-label': '目标 Agent' } });
    for (const [agent, host] of Object.entries(HOSTS)) {
      const b = this.button(hosts, host.name, () => { this.agent = agent; this.closeDialog(); this.view.app.workspace.requestSaveLayout(); return this.refresh(); });
      b.setAttribute('aria-pressed', String(this.agent === agent));
    }
    const toolbar = this.root.createDiv({ cls: 'tw-skills-toolbar' });
    toolbar.createSpan({ text: `内置 Skill · 随工作台 v${this.view.plugin.manifest.version} 更新`, cls: 'tw-muted' });
    const actions = toolbar.createDiv({ cls: 'tw-skills-actions' });
    this.button(actions, '重新检查', () => this.refresh());
    const absent = s?.items.filter(i => i.status === 'absent') || [];
    this.button(actions, absent.length ? `安装未安装项（${absent.length}）` : '暂无可安装项', () => this.batch(), { primary: true, disabled: !this.writable() || !absent.length });
    if (this.checking || this.busy) this.root.createDiv({ text: this.busy ? '正在处理入口，请稍候…' : '正在检查本机入口与资源…', cls: 'tw-skills-notice', attr: { role: 'status', 'aria-live': 'polite' } });
    if (this.error) this.root.createDiv({ text: this.error, cls: 'tw-skills-notice tw-warning', attr: { role: 'alert' } });
    const receipt = this.receipts[this.agent];
    if (receipt) {
      const result = this.root.createEl('section', { cls: 'tw-skills-receipt', attr: { 'aria-label': '操作结果', role: 'status', 'aria-live': 'polite' } });
      result.createEl('strong', { text: `${HOSTS[this.agent].name} · ${receipt.ok ? '本次操作完成' : '请核对逐项结果'}` });
      for (const item of receipt.results) result.createDiv({ text: `${OUTCOMES[item.outcome]} · ${item.name}：${item.message}`, cls: item.outcome === 'failed' ? 'tw-warning' : '' });
      for (const warning of receipt.warnings || []) result.createDiv({ text: warning, cls: 'tw-warning' });
    }
    if (!s) return;
    if (!s.isolation.ok || s.busy) {
      const notice = this.root.createDiv({ cls: 'tw-skills-notice tw-warning', attr: { role: 'status' } });
      notice.createEl('strong', { text: '完成本机检查后才能操作入口' });
      for (const reason of s.isolation.reasons) notice.createDiv({ text: reason });
      if (s.isolation.reasons.some(reason => reason.startsWith('FNS'))) this.button(notice, '打开 FNS 配置同步', () => this.view.navigate('@fns'));
      if (s.busy) notice.createDiv({ text: `存在 Skill 操作锁。若先前异常退出，请核对持有进程及 ${this.view.plugin.skills.runtime}/ 中的恢复记录。` });
    }
    const needs = s.items.filter(i => ['broken', 'conflict', 'error'].includes(i.status));
    if (needs.length) this.root.createDiv({ text: `${needs.length} 项需处理。损坏入口可单独修复；冲突内容保留。批量安装会列出跳过原因。`, cls: 'tw-skills-notice' });
    if (!s.items.some(i => i.name === this.selected)) this.selected = s.items[0]?.name;
    const grid = this.root.createDiv({ cls: 'tw-skills-grid' });
    const list = grid.createEl('section', { cls: 'tw-skills-list', attr: { 'aria-label': '内置 Skill 列表' } });
    const head = list.createDiv({ cls: 'tw-skills-list-head' });
    head.createEl('h2', { text: '选择 Skill' }); head.createSpan({ text: `${s.items.filter(i => i.status === 'installed').length} / ${s.items.length} 已安装`, cls: 'tw-muted' });
    for (const item of s.items) {
      const b = this.button(list, '', () => { this.selected = item.name; this.render(); this.root.querySelector(`[data-skill="${item.name}"]`)?.focus(); }, { label: `${item.title}，${LABELS[item.status]}` });
      b.addClass('tw-skills-item'); b.dataset.skill = item.name; b.setAttribute('aria-pressed', String(item.name === this.selected));
      const row = b.createDiv({ cls: 'tw-skills-item-title' }); row.createEl('strong', { text: item.title }); this.badge(row, item);
      b.createDiv({ text: item.name, cls: 'tw-skills-id' }); b.createDiv({ text: item.description || item.reason, cls: 'tw-skills-summary' });
    }
    const item = s.items.find(i => i.name === this.selected);
    const detail = grid.createEl('article', { cls: 'tw-skills-detail', attr: { 'aria-label': 'Skill 详情' } });
    if (item) this.detail(detail, item);
    const foot = this.root.createDiv({ cls: 'tw-skills-foot' });
    foot.createDiv({ text: `检查时间：${new Date(s.checkedAt).toLocaleString()}。已安装表示本机入口正确且资源可读；宿主发现和实际调用需在新会话中核验。` });
    for (const note of s.isolation.notes) foot.createDiv({ text: note });
  }
  badge(parent, item) { parent.createSpan({ text: LABELS[item.status], cls: 'tw-skills-badge', attr: { 'data-status': item.status } }); }
  detail(parent, item) {
    this.badge(parent, item); parent.createEl('h2', { text: item.title });
    parent.createDiv({ text: item.name, cls: 'tw-skills-id' }); parent.createEl('p', { text: item.description });
    const fact = parent.createDiv({ cls: 'tw-skills-facts' });
    fact.createEl('strong', { text: `${HOSTS[this.agent].name} 发现入口` }); fact.createDiv({ text: item.entry, cls: 'tw-skills-path' });
    fact.createDiv({ text: `内置资源：${item.source}`, cls: 'tw-skills-path' });
    if (item.previous) fact.createDiv({ text: `旧名称入口：${item.previous.entry}`, cls: 'tw-skills-path' });
    if (item.target) fact.createDiv({ text: `当前链接目标：${item.target}`, cls: 'tw-skills-path' });
    if (item.reason) fact.createEl('p', { text: item.reason, cls: 'tw-warning' });
    const actions = parent.createDiv({ cls: 'tw-skills-actions' });
    if (item.status === 'absent') this.button(actions, '安装到 ' + HOSTS[this.agent].name, () => this.perform('install', [item.name]), { primary: true, disabled: !this.writable() });
    if (item.status === 'broken') this.button(actions, item.previous ? '迁移为新名称' : '修复入口', () => this.perform('repair', [item.name]), { primary: true, disabled: !this.writable() });
    if (item.status === 'installed') this.button(actions, '使用说明', () => this.usage(item), { primary: true });
    if (['installed', 'broken'].includes(item.status) && !item.previous) this.button(actions, '移除安装…', () => this.confirmRemove(item), { disabled: !this.writable() });
    if (['conflict', 'error'].includes(item.status)) this.button(actions, '处理后重新检查', () => this.refresh());
    parent.createEl('h3', { text: '安装后怎么用' }); parent.createEl('p', { text: item.next });
    if (item.example) parent.createDiv({ text: item.example, cls: 'tw-skills-example' });
    if (item.related) this.button(parent, item.related === '@fns' ? '打开 FNS 配置同步' : '打开 Agent 规则', () => this.view.navigate(item.related));
    parent.createEl('p', { text: '从当前库根目录新开所选宿主的会话，核对 Skill 列表，再提供真实目标和内容。资源随插件更新；服务配置与规则接入分别操作。', cls: 'tw-muted' });
  }
  batch() {
    const items = this.snapshot.items, names = items.map(i => i.name);
    if (!items.some(i => ['broken', 'conflict', 'error'].includes(i.status))) return this.perform('install', names);
    const { body, footer } = this.dialog('核对批量安装');
    body.createEl('p', { text: `${HOSTS[this.agent].name} · ${this.manager.vault}` });
    for (const item of items) body.createEl('p', { text: `${item.title}：${item.status === 'absent' ? '本次安装' : `跳过 · ${item.reason || LABELS[item.status]}`}` });
    this.button(footer, '返回', () => this.closeDialog());
    const expected = this.expected(names);
    this.button(footer, `安装其余 ${items.filter(i => i.status === 'absent').length} 项`, () => { this.closeDialog(); return this.perform('install', names, expected); }, { primary: true });
  }
  confirmRemove(item) {
    const { body, footer } = this.dialog('移除这项 Skill 的安装');
    body.createEl('p', { text: `${HOSTS[this.agent].name} · ${item.title}（${item.name}）` });
    body.createDiv({ text: item.entry, cls: 'tw-skills-path' });
    body.createEl('p', { text: '只移除所选发现入口。内置资源、笔记、账号配置、其他宿主入口与全局规则保留；之后可重新安装。' });
    const expected = { [item.name]: item.token };
    this.button(footer, '取消', () => this.closeDialog());
    this.button(footer, '确认移除', () => { this.closeDialog(); return this.perform('remove', [item.name], expected); });
  }
  expected(names) { return Object.fromEntries(this.snapshot.items.filter(i => names.includes(i.name)).map(i => [i.name, i.token])); }
  async perform(action, names, expected = this.expected(names)) {
    if (!this.writable()) return;
    const agent = this.agent; this.busy = true; this.error = ''; this.render();
    try {
      await this.view.plugin.beforeSkillWrite?.(agent);
      const result = await this.manager.apply({ agent, names, action, expected });
      this.receipts[agent] = result;
      if (this.agent === agent) this.snapshot = result.snapshot;
    } catch (error) {
      this.receipts[agent] = { ok: false, results: names.map(name => ({ name, outcome: 'failed', message: error.message })) };
      try { if (this.agent === agent) this.snapshot = await this.manager.scan(agent); }
      catch (e) { this.snapshot = null; this.error = `操作后检查失败：${e.message}`; }
    } finally { this.busy = false; this.checking = false; if (this.active()) this.render(); }
  }
  dialog(title) {
    this.closeDialog(); this.returnFocus = this.view.contentEl.ownerDocument.activeElement;
    const dialog = this.view.contentEl.createEl('dialog', { cls: 'tw-skills-dialog', attr: { 'aria-label': title } });
    this.modal = dialog; dialog.createEl('h2', { text: title });
    const body = dialog.createDiv(), footer = dialog.createDiv({ cls: 'tw-skills-actions' });
    dialog.addEventListener('cancel', e => { e.preventDefault(); this.closeDialog(); }); dialog.showModal();
    return { body, footer };
  }
  closeDialog() { if (this.modal) { this.modal.close(); this.modal.remove(); this.modal = null; if (this.returnFocus?.isConnected) this.returnFocus.focus(); } }
  usage(item) {
    const { body, footer } = this.dialog(`使用「${item.title}」`);
    const list = body.createEl('ol');
    for (const text of [`在 ${this.manager.vault} 根目录新开 ${HOSTS[this.agent].name} 会话。`, `核对宿主提供的 Skill 列表中有 ${item.name}。`, `明确目标和内容后调用。${item.next}`]) list.createEl('li', { text });
    const field = body.createEl('textarea', { attr: { readonly: '', rows: '8', 'aria-label': '示例调用提示词' } });
    field.value = `${this.agent === 'claude' ? '/' : '$'}${item.name}\n\n目标知识库：${this.manager.vault}\n\n${item.example}\n\n请按我随后提供的真实目标和内容操作。`;
    const status = body.createDiv({ attr: { role: 'status' } });
    this.button(footer, '关闭', () => this.closeDialog());
    this.button(footer, '复制示例提示词', async () => { try { await this.view.contentEl.ownerDocument.defaultView.navigator.clipboard.writeText(field.value); status.setText('已复制。'); } catch { field.focus(); field.select(); status.setText('请使用复制快捷键。'); } }, { primary: true });
  }
}
module.exports = { SkillInstallationUI };
