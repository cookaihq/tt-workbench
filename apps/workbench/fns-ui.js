'use strict';
const path = require('node:path');
const { FnsLocalUI } = require('./fns-local-ui.js');
const FIELDS = [
  ['configSyncOtherDirs', '增加目录同步', '额外纳入同步的库内目录'],
  ['syncExcludeFolders', '排除目录', '不参与同步的路径与目录'],
  ['syncExcludeExtensions', '排除文件类型', '按扩展名排除的文件'],
  ['syncExcludeWhitelist', '排除白名单', '优先于排除规则的例外']
];
const STATUS = { 'no-publication': '尚无权威版本', 'update-available': '有版本可应用', equal: '规则内容一致',
  ready: '本机配置正常', 'authority-invalid': '远端发布异常，应用已阻止', 'authority-recheck': '旧校验记录待重新检查',
  applied: '本机已应用并核验', written: '已写入，待加载核验', 'local-changes': '本机有未发布修改', pending: '发布等待推送',
  'needs-migration': '旧配置待迁回', 'missing-config': '请先配置 FNS', 'foreign-link': '配置归属需核对', 'broken-link': '本机链接已断开', conflict: '配置冲突' };
const key = r => JSON.stringify(r);
const noteKey = (field, rule) => JSON.stringify([field, rule.pattern, rule.caseSensitive]);
const reasonFor = (notes, field, rule) => notes?.find(note => noteKey(note.field, note) === noteKey(field, rule))?.reason || '';
class FnsUI {
  constructor(view) { this.view = view; this.service = view.plugin.fns; this.field = FIELDS[0][0]; this.generation = 0; this.busy = false; }
  build(parent) { this.panel = parent.createDiv({ cls: 'tw-fns-panel' }); this.panel.hidden = true; }
  active() { return !this.disposed && !this.view.closed && this.view.pageScope === '@fns'; }
  fileChanged(filename) {
    if (!this.active() || typeof filename !== 'string') return;
    const configDir = this.service.options.configDir || '.obsidian';
    filename = filename.replace(/\\/g, '/');
    const paths = [`${configDir}/plugins/fast-note-sync/data.json`, `${configDir}/plugins/fast-note-sync/manifest.json`,
      `${configDir}/community-plugins.json`, '.gitignore', '.system/workbench/runtime.jsonc'];
    // Remember the selected runtime path when reading the page. Ordinary note
    // events should not resolve configuration or start an FNS inspection.
    if (!paths.includes(filename) && filename !== this.statePath && !['config/fns-config', '.fns-config'].includes(filename)) return;
    if (!this.busy) ++this.generation;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { this.refreshTimer = null; void this.refresh(); }, 150);
  }
  async readReport() {
    const report = await this.service.inspect();
    if (this.active() && report.application?.code === 'PROTECTED_SCOPE' && !report.blocked) {
      try { report.localProtection = await this.view.plugin.inspectLocalProtection(); }
      catch { report.localProtection = null; }
    }
    return report;
  }
  refresh() {
    if (!this.active() || this.busy) return Promise.resolve();
    clearTimeout(this.refreshTimer); this.refreshTimer = null;
    ++this.generation; this.refreshRequested = true;
    this.refreshPromise ||= this.drainRefreshes().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }
  async drainRefreshes() {
    while (this.refreshRequested && this.active() && !this.busy) {
      this.refreshRequested = false;
      const generation = this.generation;
      try {
        if (this.service.vault) this.statePath = path.relative(this.service.vault, path.join(this.service.data, 'state.json')).replace(/\\/g, '/');
        const report = await this.readReport();
        if (generation !== this.generation || !this.active() || this.busy) continue;
        this.report = report; this.error = ''; this.render();
      } catch (error) {
        if (generation !== this.generation || !this.active() || this.busy) continue;
        this.error = error.message; this.render();
      }
    }
    this.refreshRequested = false;
  }
  leave() {
    ++this.generation; this.refreshRequested = false;
    clearTimeout(this.refreshTimer); this.refreshTimer = null;
  }
  button(parent, title, callback, primary = false) {
    const button = this.view.button(parent, title, title, callback);
    if (primary) button.addClass('mod-cta');
    button.disabled = this.busy;
    return button;
  }
  async run(action) {
    if (this.busy) return;
    ++this.generation;
    this.busy = true; this.message = '正在处理…'; this.render();
    try {
      await this.refreshPromise;
      const result = await action();
      this.message = result?.message || (result?.status === 'published' ? `v${result.version} 已推送；其他设备仍需接收并应用。` : '检查已完成。');
      this.error = '';
    } catch (error) { this.error = error.message; this.message = ''; }
    finally {
      const actionError = this.error;
      this.busy = false;
      if (this.active()) {
        await this.refresh();
        if (actionError) this.error = actionError;
      }
      if (this.active()) this.render();
    }
  }
  render() {
    if (!this.panel || !this.active()) return;
    const p = this.panel, report = this.report;
    p.empty(); p.setAttribute('aria-busy', String(this.busy));
    const actions = p.createDiv({ cls: 'tw-fns-actions' });
    this.button(actions, '本机检查', () => this.checkDialog());
    this.button(actions, '检查更新', () => this.run(() => this.service.checkUpdates()));
    const publish = this.button(actions, '发布本机配置', () => this.prepare('publish'));
    publish.disabled ||= report?.device?.status !== 'ready' || Boolean(report?.pending);
    const notes = this.button(actions, this.notesEditorDraft ? '继续编辑说明' : '编辑说明', () => this.notesDialog());
    notes.disabled ||= report?.device?.status !== 'ready' || Boolean(report?.pending);
    if (this.error) p.createDiv({ text: this.error, cls: 'tw-fns-alert', attr: { role: 'alert' } });
    if (report?.blocked) p.createDiv({ text: report.blocked.code === 'PROTECTED_SCOPE'
      ? '旧版本留下了目录排除校验记录。请点击“检查更新”重新核验发布；本机排除可在“本机检查”中处理。'
      : '已发现远端发布内容或历史异常。最近收到的版本仅供回查；请修复发布并重新检查更新。', cls: 'tw-fns-alert', attr: { role: 'alert' } });
    if (report?.application?.message && !report.blocked) this.applicationAlert(p, report);
    if (this.message) p.createDiv({ text: this.message, cls: 'tw-fns-message', attr: { role: 'status', 'aria-live': 'polite' } });
    if (report?.notes?.draft) p.createDiv({ text: report.notes.conflict
      ? '说明草稿基于较早版本。请编辑说明，核对当前版本后重新保存，再发布。'
      : '有已保存的说明草稿。左侧可预览，发布后将显示在右侧的新版本中。', cls: report.notes.conflict ? 'tw-fns-alert' : 'tw-fns-message' });
    if (!report) { p.createEl('p', { text: '读取本机配置与最近接收记录后，显示差异。' }); return; }
    const top = p.createDiv({ cls: 'tw-fns-context' });
    const identity = top.createDiv();
    identity.createEl('strong', { text: report.device.deviceId || '本机身份待识别' });
    identity.createDiv({ text: `本机记录：${report.applied ? 'v' + report.applied.version : '尚无应用记录'}  →  已接收权威版本：${report.publication ? 'v' + report.publication.version : '无'}`, cls: 'tw-fns-caption' });
    top.createSpan({ text: report.application?.allowed === false && !report.blocked ? '此版本暂不可应用' : STATUS[report.status] || report.status, cls: 'tw-pill' });
    for (const warning of report.runtime?.warnings || []) p.createDiv({ text: warning, cls: 'tw-warning' });
    if (report.device.status !== 'ready') {
      p.createEl('p', { text: report.device.message || '将旧配置迁回插件目录后，即可比较和应用。', cls: 'tw-fns-empty' });
      if (report.device.status === 'needs-migration') this.button(p, '迁回本机配置', () => this.confirmOnboard(), true);
      return;
    }
    const layout = p.createDiv({ cls: 'tw-fns-layout' });
    const tabs = layout.createDiv({ cls: 'tw-fns-tabs', attr: { role: 'tablist', 'aria-label': 'FNS 配置分组', 'aria-orientation': 'vertical' } });
    const fieldButtons = [];
    for (const [field, title] of FIELDS) {
      const button = this.button(tabs, title, () => { this.field = field; this.render(); this.panel.querySelector('[role=tab][aria-selected=true]')?.focus(); });
      button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(this.field === field));
      button.tabIndex = this.field === field ? 0 : -1;
      if (report.publication) {
        const local = report.local.rules[field], remote = report.publication.rules[field];
        const count = local.filter(r => !remote.some(s => key(s) === key(r))).length + remote.filter(r => !local.some(s => key(s) === key(r))).length;
        button.createEl('small', { text: count ? `${count} 条增删` : JSON.stringify(local) === JSON.stringify(remote) ? '内容一致' : '顺序或重复项变化' });
      } else button.createEl('small', { text: '等待权威版本' });
      button.addEventListener('keydown', event => {
        if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = FIELDS.findIndex(f => f[0] === field);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : 3)) % 4;
        fieldButtons[next].click();
      });
      fieldButtons.push(button);
    }
    const pane = layout.createEl('section', { cls: 'tw-fns-diff', attr: { role: 'tabpanel', 'aria-label': FIELDS.find(f => f[0] === this.field)[1] } });
    const [, title, description] = FIELDS.find(f => f[0] === this.field);
    pane.createEl('h2', { text: title }); pane.createEl('p', { text: description, cls: 'tw-fns-caption' });
    const columns = pane.createDiv({ cls: 'tw-fns-columns' });
    this.column(columns, '本机配置', report.local.rules[this.field], report.publication?.rules[this.field], 'remove');
    this.column(columns, report.publication ? `权威版本 v${report.publication.version}` : '权威版本', report.publication?.rules[this.field], report.local.rules[this.field], 'add');
    const footer = p.createDiv({ cls: 'tw-fns-footer' });
    const info = footer.createDiv();
    info.createEl('p', { text: report.publication ? `来源：${report.publication.sourceDevice} · ${new Date(report.publication.publishedAt).toLocaleString()}` : '在本机 FNS 中设置规则，再明确发布第一版权威配置。' });
    if (report.checkedAt) info.createEl('small', { text: `最近检查：${new Date(report.checkedAt).toLocaleString()}；此处不显示其他设备的应用状态。` });
    if (report.pending) {
      this.button(footer, `重试推送 v${report.pending.version}`, () => this.run(() => this.service.retryPublish()), true);
      this.button(footer, '放弃待推送记录', () => this.confirmDiscard());
    } else if (report.publication) { const apply = this.button(footer, '比较并应用', () => this.prepare('apply'), true); apply.disabled ||= Boolean(report.blocked) || report.application?.allowed === false; }
    else this.button(footer, '发布本机配置', () => this.prepare('publish'), true);
    p.createEl('p', { text: '同步范围为以上四组。应用会保存恢复记录，并保留本机账号及其他设备设置。', cls: 'tw-fns-caption' });
    if (report.recovery) {
      const details = p.createEl('details'); details.createEl('summary', { text: '上次应用的恢复记录' });
      details.createEl('p', { text: report.recovery, cls: 'tw-fns-caption' });
      this.button(details, '恢复上次应用前的规则', () => this.confirmRecover());
    }
  }
  applicationAlert(parent, report) {
    if (report.application.code !== 'PROTECTED_SCOPE') {
      parent.createDiv({ text: report.application.message + ' 可调整本机规则后发布新版本。', cls: 'tw-fns-alert', attr: { role: 'alert' } });
      return;
    }
    const local = report.localProtection;
    const alert = parent.createDiv({ cls: 'tw-fns-alert tw-fns-alert-action', attr: { role: 'alert' } });
    const content = alert.createDiv({ cls: 'tw-fns-alert-content' });
    content.createDiv({ text: `权威版本 v${report.publication.version} 未满足本机文件排除要求，暂不能应用。` });
    content.createDiv({ text: local?.configured
      ? (local.status === 'configured' ? '本机排除已齐全并生效。' : '本机排除已保存，FNS 加载仍待核验。')
        + (report.pending ? '请先处理页面下方的待推送记录。' : '请比较并发布修正版。')
      : local?.canConfigure ? '可一键补齐本机排除，再比较并发布修正版。'
        : '请先打开本机检查，核对 FNS 配置与排除状态。' });
    const details = content.createEl('details');
    details.createEl('summary', { text: '查看原因' });
    details.createDiv({ text: report.application.message });
    if (local?.configured) {
      const publish = this.button(alert, '比较并发布', () => this.prepare('publish'));
      publish.disabled ||= Boolean(report.pending);
    } else if (local?.canConfigure) {
      const configure = this.button(alert, '补齐本机排除', () => this.run(() => this.view.plugin.configureLocalProtection()));
      configure.title = '自动暂停 FNS、保存恢复材料、补齐本机排除并核验加载';
    } else this.button(alert, '查看本机检查', () => this.checkDialog());
  }
  column(parent, title, rules, other, change) {
    const column = parent.createDiv({ cls: 'tw-fns-column' }); column.createEl('h3', { text: title });
    if (!rules) { column.createEl('p', { text: '接收有效发布后显示。', cls: 'tw-fns-caption' }); return; }
    if (!rules.length) column.createEl('p', { text: '未设置规则', cls: 'tw-fns-caption' });
    for (const rule of rules) {
      const changed = other && !other.some(r => key(r) === key(rule));
      const line = column.createDiv({ cls: `tw-fns-line${changed ? ' is-' + change : ''}` });
      line.createSpan({ text: changed ? change === 'add' ? '＋' : '−' : '·', cls: 'tw-fns-sign' });
      line.createSpan({ text: rule.pattern + (rule.caseSensitive ? ' 〔区分大小写〕' : ''), cls: 'tw-fns-pattern' });
      if (change === 'add') {
        const note = line.createDiv({ cls: 'tw-fns-note' });
        const reason = reasonFor(this.report.publication?.notes, this.field, rule);
        note.createSpan({ text: reason || '暂无说明', cls: reason ? 'tw-fns-reason' : 'tw-fns-caption' });
        if (this.report.local.rules[this.field].some(r => key(r) === key(rule))) {
          const edit = this.button(note, reason ? '编辑' : '填写', () => this.notesDialog(noteKey(this.field, rule)));
          edit.addClass('tw-fns-note-edit'); edit.setAttribute('aria-label', `编辑 ${rule.pattern} 的设置说明`);
          edit.disabled ||= Boolean(this.report.pending);
        }
      } else if (this.report.notes?.draft) {
        const note = reasonFor(this.report.notes.entries, this.field, rule);
        const previous = reasonFor(this.report.publication?.notes, this.field, rule);
        if (note || previous) line.createSpan({ text: note ? '说明草稿：' + note : '说明草稿：清除此说明', cls: 'tw-fns-note tw-fns-reason' });
      }
    }
  }
  notesDialog(focusKey, recompare = false) {
    if (!this.report?.local || this.busy || this.report.pending) return;
    const report = this.report;
    if (!this.notesEditorDraft) this.notesEditorDraft = {
      expected: { ...report.notes.expected }, rules: report.local.rules,
      entries: report.notes.entries.map(note => ({ ...note }))
    };
    const draft = this.notesEditorDraft;
    if (recompare) { draft.expected = { ...report.notes.expected }; draft.rules = report.local.rules; }
    const dialog = this.view.contentEl.createEl('dialog', { cls: 'tw-modal tw-fns-modal', attr: { 'aria-label': '编辑规则设置说明' } });
    dialog.createEl('h2', { text: '规则设置说明' });
    dialog.createEl('p', { text: '说明用于记录为什么设置这条规则。先保存到本机，再通过“发布本机配置”与规则一起发布。', cls: 'tw-fns-caption' });
    if (report.notes.conflict || recompare) dialog.createEl('p', { text: '请对照下方当前权威版本的说明核对输入；保存后，草稿将以当前版本为依据。', cls: 'tw-warning' });
    const fields = new Map(); let selected;
    for (const [field, title] of FIELDS) {
      if (!draft.rules[field].length) continue;
      dialog.createEl('h3', { text: title });
      for (const rule of draft.rules[field]) {
        const id = noteKey(field, rule);
        if (fields.has(id)) continue;
        const label = dialog.createEl('label', { cls: 'tw-fns-note-field' });
        label.createSpan({ text: rule.pattern + (rule.caseSensitive ? ' 〔区分大小写〕' : '') });
        const input = label.createEl('textarea', { attr: { rows: '2', maxlength: '4000', placeholder: '填写设置目的、原因或适用条件', 'aria-label': `${title}：${rule.pattern} 的设置说明` } });
        input.value = reasonFor(draft.entries, field, rule); fields.set(id, { field, rule, input });
        const previous = reasonFor(report.publication?.notes, field, rule);
        if (report.notes.conflict || recompare || previous) label.createEl('small', { text: `当前权威版本：${previous || '暂无说明'}`, cls: 'tw-fns-caption tw-fns-reason' });
        input.addEventListener('input', () => {
          draft.entries = draft.entries.filter(note => noteKey(note.field, note) !== id);
          if (input.value.trim()) draft.entries.push({ field, pattern: rule.pattern, caseSensitive: rule.caseSensitive, reason: input.value });
        });
        if (id === focusKey) selected = input;
      }
    }
    const removed = draft.entries.filter(note => !fields.has(noteKey(note.field, note)));
    if (removed.length) {
      const details = dialog.createEl('details'); details.createEl('summary', { text: `${removed.length} 条说明对应的规则已移除，本次不会发布` });
      for (const note of removed) details.createEl('p', { text: `${note.pattern}：${note.reason}`, cls: 'tw-fns-caption tw-fns-reason' });
    }
    const error = dialog.createDiv({ cls: 'tw-fns-alert', attr: { role: 'alert' } }); error.hidden = true;
    const actions = dialog.createDiv({ cls: 'tw-fns-actions' });
    this.button(actions, '稍后继续', () => dialog.close());
    this.button(actions, '放弃未保存输入', () => { this.notesEditorDraft = null; dialog.close(); this.render(); });
    const compare = this.button(actions, '重新比较', async () => {
      compare.disabled = true;
      try { this.report = await this.readReport(); dialog.close(); this.notesDialog(focusKey, true); }
      catch (failure) { error.textContent = failure.message; error.hidden = false; compare.disabled = false; }
    });
    const save = this.button(actions, report.notes.conflict || recompare ? '核对并保存草稿' : '保存说明草稿', async () => {
      const buttons = [...actions.querySelectorAll('button')];
      for (const button of buttons) button.disabled = true;
      for (const { input } of fields.values()) input.disabled = true;
      this.busy = true;
      try {
        const entries = [...fields.values()].filter(({ input }) => input.value.trim())
          .map(({ field, rule, input }) => ({ field, pattern: rule.pattern, caseSensitive: rule.caseSensitive, reason: input.value.trim() }));
        const result = await this.service.saveNotes(draft.expected, entries);
        this.notesEditorDraft = null; this.message = result.message; this.error = ''; dialog.close();
      } catch (failure) { error.textContent = failure.message; error.hidden = false; }
      finally {
        this.busy = false;
        for (const button of buttons) button.disabled = false;
        for (const { input } of fields.values()) input.disabled = false;
        await this.refresh();
      }
    }, true);
    save.disabled ||= !fields.size;
    dialog.addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); if (this.active()) this.render(); }, { once: true });
    dialog.showModal(); if (selected) selected.focus();
  }
  dialog(title, build, confirmTitle, action) {
    const dialog = this.view.contentEl.createEl('dialog', { cls: 'tw-modal tw-fns-modal', attr: { 'aria-label': title } });
    dialog.createEl('h2', { text: title }); build(dialog);
    const actions = dialog.createDiv({ cls: 'tw-fns-actions' });
    this.button(actions, '取消', () => dialog.close());
    if (action) this.button(actions, confirmTitle, () => { dialog.close(); void this.run(action); }, true);
    dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
  }
  async prepare(action) {
    if (action === 'publish' && this.notesEditorDraft) {
      this.message = '还有未保存的说明输入，请先保存草稿或放弃输入，再发布。';
      this.render(); this.notesDialog(); return;
    }
    let plan;
    await this.run(async () => { plan = await this.service.preview(action); return { message: '请核对本次四组规则的变化。' }; });
    if (!plan || !this.active()) return;
    this.dialog(action === 'publish' ? `发布本机规则为 v${plan.version}` : `应用权威版本 v${plan.version}`, dialog => {
      dialog.createEl('p', { text: action === 'publish' ? '本次将通过 Git 发布本机完整设备配置与版本记录；共享范围仅为四组规则。其他设备仍需接收并应用。' : '将暂停 FNS，保存恢复记录并更新本机四组规则，随后恢复原启用状态并核验。' });
      if (plan.localChanged && action === 'apply') dialog.createEl('p', { text: '本机有未发布修改。确认后将使用权威版本替换这些修改；取消可保留本机并准备发布。', cls: 'tw-warning' });
      for (const [field, title] of FIELDS) {
        const diff = plan.diff[field];
        if (!diff.add.length && !diff.remove.length) continue;
        dialog.createEl('h3', { text: title });
        for (const item of diff.remove) dialog.createDiv({ text: '− ' + item.pattern, cls: 'tw-fns-line is-remove' });
        for (const item of diff.add) dialog.createDiv({ text: '＋ ' + item.pattern, cls: 'tw-fns-line is-add' });
      }
      if (action === 'publish' && plan.noteChanges?.length) {
        dialog.createEl('h3', { text: '设置说明的变化' });
        for (const note of plan.noteChanges) {
          const group = FIELDS.find(([field]) => field === note.field)[1];
          const block = dialog.createDiv({ cls: 'tw-fns-note-preview' });
          block.createEl('strong', { text: `${group} · ${note.pattern}${note.caseSensitive ? '〔区分大小写〕' : ''}` });
          block.createDiv({ text: '原说明：' + (note.before || '暂无说明'), cls: 'tw-fns-caption tw-fns-reason' });
          block.createDiv({ text: '新说明：' + (note.after || '清除说明'), cls: 'tw-fns-reason' });
        }
      }
    }, action === 'publish' ? '确认发布并推送' : '确认应用', () => action === 'publish' ? this.service.publish(plan) : this.service.apply(plan, { replaceLocal: plan.localChanged }));
  }
  checkDialog() {
    this.localUI ||= new FnsLocalUI(this.view, () => this.refresh());
    this.localUI.open();
  }
  confirmOnboard() { this.dialog('迁回本机配置', dialog => dialog.createEl('p', { text: '暂停 FNS，将旧链接指向的完整配置迁回插件目录，保留全部设置并清理本机旧源文件，再恢复原启用状态。' }), '确认迁回', () => this.service.onboard()); }
  confirmDiscard() {
    const id = this.report.pending.publicationId;
    this.dialog('放弃待推送记录', dialog => dialog.createEl('p', { text: '保留本机规则和发布恢复记录；下一次发布前重新接收、比较远端版本。' }), '确认放弃', () => this.service.discardPending(id));
  }
  confirmRecover() {
    const id = this.report.recovery.split('/').at(-1);
    this.dialog('恢复上次应用前的规则', dialog => dialog.createEl('p', { text: '仅当配置自上次操作后没有变化时恢复；若发现后来修改，将停止并保留现场。' }), '确认恢复', () => this.service.recover(id));
  }
  dispose() { this.disposed = true; this.leave(); this.localUI?.dispose(); for (const d of this.view.contentEl.querySelectorAll('.tw-fns-modal')) d.remove(); }
}
module.exports = { FnsUI };
