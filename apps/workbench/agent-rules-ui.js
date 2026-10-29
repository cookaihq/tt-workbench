"use strict";

const { skillPrompt, LABELS } = require("./agent-rules.js");

// Render text with a small set of presentation rules. Never run Obsidian
// Markdown extensions, embeds, HTML, task controls or external resource loads.
function renderRuleText(parent, content) {
  let code = null;
  for (const block of content.split(/\r?\n/)) {
    if (/^\s*```/.test(block)) { code = code ? null : parent.createEl("pre", { cls: "tw-rules-code" }); continue; }
    if (code) { code.appendText(`${block}\n`); continue; }
    const heading = block.match(/^(#{1,6})\s+(.+)/);
    if (heading) parent.createEl(heading[1].length === 1 ? "h3" : "h4", { text: heading[2] });
    else if (block.trim()) parent.createDiv({ text: block, cls: /^\s*[-*]\s/.test(block) ? "tw-rules-line tw-rules-bullet" : "tw-rules-line" });
    else parent.createDiv({ cls: "tw-rules-space" });
  }
}

class AgentRulesUI {
  constructor(view) { this.view = view; this.reader = view.plugin.agentRules; this.agent = "codex"; this.generation = 0; this.selected = ""; }
  active() { return this.view.pageScope === "@agent-rules"; }
  build(parent, actions) {
    const v = this.view;
    this.actions = actions.createDiv({ cls: "tw-rules-actions" }); this.actions.hidden = true;
    this.select = this.actions.createEl("select", { attr: { "aria-label": "查看哪个 Agent" } });
    for (const [value, text] of [["codex", "Codex · 当前电脑"], ["claude", "Claude Code · 当前电脑"]]) this.select.createEl("option", { value, text });
    this.select.addEventListener("change", () => { this.agent = this.select.value; this.selected = ""; v.app.workspace.requestSaveLayout(); void this.refresh(); });
    this.refreshButton = v.button(this.actions, "重新检查本机规则与链接", "重新检查", () => this.refresh());
    this.root = parent.createDiv({ cls: "tw-rules-page" }); this.root.hidden = true;
  }
  enter() {
    this.actions.hidden = false; this.root.hidden = false;
    const v = this.view;
    v.pageEyebrow.setText("TT / AGENT RULES"); v.pageTitle.setText("Agent 规则");
    v.pageDescription.setText("选择正式规则源，只读浏览正文并核对本机入口。");
    if (!this.visible) { this.visible = true; void this.refresh(); }
  }
  leave() {
    if (!this.visible) return;
    this.visible = false; ++this.generation;
    this.actions.hidden = true; this.root.hidden = true;
  }
  async refresh() {
    const request = ++this.generation;
    this.refreshButton.disabled = true;
    this.root.empty(); this.root.createEl("p", { text: "正在读取本机规则与链接…", attr: { role: "status" } });
    try {
      this.reader = this.view.plugin.agentRules;
      const snapshot = await this.reader.scan(this.agent);
      if (request !== this.generation || !this.active() || this.view.closed) return;
      this.snapshot = snapshot; this.render();
    } catch (error) {
      if (request !== this.generation || !this.active() || this.view.closed) return;
      this.root.empty(); this.root.createEl("p", { text: `无法读取规则状态：${error.message}`, cls: "tw-warning", attr: { role: "alert" } });
    } finally { if (request === this.generation) this.refreshButton.disabled = false; }
  }
  render() {
    const s = this.snapshot, v = this.view;
    this.root.empty(); this.root.dataset.status = s.status;
    const source = this.root.createDiv({ cls: 'tw-rules-source' });
    const label = source.createEl('label', { text: '正式规则源目录（包含 AGENTS.md 与 scenarios-agent-instructions）' });
    const input = label.createEl('input', { attr: { type: 'text', 'aria-label': '正式规则源绝对路径', placeholder: '输入已确认的规则目录绝对路径' } }); input.value = s.source;
    const feedback = source.createDiv({ attr: { role: 'status' } });
    const save = v.button(source, '读取并选择规则源', '读取并选择', async () => {
      save.disabled = true;
      try { await v.plugin.setRulesSource(input.value.trim()); this.selected = ''; await this.refresh(); }
      catch (error) { feedback.setText(error.message); save.disabled = false; }
    });
    if (s.status === 'unconfigured') { this.root.createEl('p', { text: '尚未选择规则源。个人正文由你的知识库或规则仓库管理；选择后显示本机接入情况。', cls: 'tw-muted' }); return; }
    const status = this.root.createEl("section", { cls: "tw-rules-status", attr: { "aria-label": "本机接入状态" } });
    const heading = status.createDiv({ cls: "tw-rules-status-heading" });
    heading.createSpan({ text: s.status === "connected" ? "✓" : s.status === "unknown" ? "?" : "!", cls: "tw-rules-mark" });
    const text = heading.createDiv();
    text.createEl("h2", { text: s.status === "connected" ? "已通过符号链接接入所选规则源" : s.status === "unknown" ? "本机接入情况尚无法完整判断" : "本机规则尚未完整接入所选规则源" });
    text.createEl("p", { text: s.status === "connected" ? "主规则与共用场景入口均直接指向所选正式源。" : "下方分别列出主规则、场景入口与覆盖文件的实际情况。" });
    heading.createSpan({ text: s.status === "connected" ? "链接正常" : s.status === "unknown" ? "无法判断" : "需要处理", cls: "tw-rules-badge" });
    const facts = status.createDiv({ cls: "tw-rules-facts" });
    for (const item of s.entries) {
      const fact = facts.createDiv({ cls: "tw-rules-fact" });
      fact.createEl("strong", { text: item.title });
      fact.createSpan({ text: LABELS[item.status], cls: "tw-rules-badge", attr: { "data-status": item.status } });
      fact.createDiv({ text: item.entry, cls: "tw-rules-path" });
      fact.createDiv({ text: `入口类型：${item.type}`, cls: "tw-muted" });
      if (item.target) fact.createDiv({ text: `实际目标：${item.target}`, cls: "tw-rules-path" });
      if (item.resolved && item.resolved !== item.target) fact.createDiv({ text: `最终位置：${item.resolved}`, cls: "tw-rules-path" });
      fact.createDiv({ text: `所选规则源：${item.expected}`, cls: "tw-rules-path" });
      if (item.reason) fact.createDiv({ text: item.reason, cls: "tw-warning" });
    }
    const override = status.createDiv({ cls: "tw-rules-foot" });
    if (s.override.status !== "na") override.createDiv({ text: `${LABELS[s.override.status]}${s.override.entry ? ` · ${s.override.entry}` : ""}${s.override.status === "present" ? "；Codex 优先读取此文件。" : ""}`, cls: s.override.status === "present" ? "tw-warning" : "tw-muted" });
    if (s.override.reason || s.reason) override.createDiv({ text: s.override.reason || s.reason, cls: "tw-warning" });
    for (const error of s.errors) override.createDiv({ text: error, cls: "tw-warning" });
    override.createDiv({ text: `检查时间：${new Date(s.checkedAt).toLocaleString()}。已链接仅表示文件关系，现有 Agent 会话是否已加载需在会话中核验。` });
    override.createDiv({ text: s.custom ? `配置目录来自工作台启动时的 ${s.variable}。其他会话单独设置的目录需在该会话核验。` : "按当前用户默认目录检查；其他会话单独设置的配置目录需在该会话核验。" });
    const columns = this.root.createDiv({ cls: `tw-rules-overview${s.status === "connected" ? " tw-rules-connected" : ""}` });
    const reader = columns.createEl("section", { cls: "tw-rules-reader", attr: { "aria-label": "规则文件只读浏览" } });
    reader.createEl("h2", { text: "规则文件" });
    const browser = reader.createDiv({ cls: "tw-rules-browser" });
    const files = browser.createEl("nav", { cls: "tw-rules-files", attr: { "aria-label": "规则文件" } });
    this.document = browser.createEl("article", { cls: "tw-rules-document", attr: { "aria-label": "规则正文", tabindex: "0" } });
    if (!s.documents.some(d => d.id === this.selected)) this.selected = s.documents[0]?.id || "";
    let group;
    for (const doc of s.documents) {
      if (doc.group !== group) { group = doc.group; files.createDiv({ text: group, cls: "tw-rules-group" }); }
      const b = v.button(files, `阅读规则 ${doc.title}`, "", () => { this.selected = doc.id; this.render(); });
      b.addClass("tw-rules-file"); b.setAttribute("aria-pressed", String(doc.id === this.selected));
      b.createEl("strong", { text: doc.title }); b.createEl("small", { text: doc.path.split(/[\\/]/).pop() });
    }
    const doc = s.documents.find(d => d.id === this.selected);
    if (doc) {
      const head = this.document.createDiv({ cls: "tw-rules-doc-head" });
      head.createSpan({ text: doc.origin, cls: "tw-rules-badge" }); head.createEl("h2", { text: doc.title });
      head.createDiv({ text: doc.path, cls: "tw-rules-path" });
      head.createDiv({ text: "正文只读。规则源与本机入口的关系见上方状态。", cls: "tw-muted" });
      renderRuleText(this.document.createDiv({ cls: "tw-rules-body" }), doc.content);
    } else this.document.createEl("p", { text: "没有可读取的规则文件。", cls: "tw-empty" });
    if (s.status !== "connected") {
      const prompt = columns.createEl("aside", { cls: "tw-rules-prompt", attr: { "aria-label": "调用 Skill 的提示词" } });
      prompt.createEl("h2", { text: "在 Agent 中处理" });
      prompt.createEl("p", { text: "复制以下提示词，在以当前项目为工作目录的 Agent 会话中使用。" });
      prompt.createEl("p", { text: s.skill.available ? "已在项目发现入口读到 Skill，实际可用性由 Agent 会话确认。" : "尚未在项目发现入口读到 Skill。请先在 Skill 安装页面处理，再从库根新开会话核对。", cls: "tw-warning" });
      if (!s.skill.available) v.button(prompt, '打开 Skill 安装', '打开 Skill 安装', () => v.navigate('@skills'));
      const value = skillPrompt(s);
      const field = prompt.createEl("textarea", { attr: { readonly: "", rows: "12", "aria-label": "Skill 调用提示词", spellcheck: "false" } }); field.value = value;
      const message = prompt.createDiv({ cls: "tw-status", attr: { role: "status", "aria-live": "polite" } });
      v.button(prompt, "复制 Skill 调用提示词", "复制提示词", async () => {
        try { await v.contentEl.ownerDocument.defaultView.navigator.clipboard.writeText(value); message.setText("已复制，可粘贴到 Agent 会话。"); }
        catch { field.focus(); field.select(); message.setText("请使用复制快捷键，提示词已选中。"); }
      }).addClass("mod-cta");
    }
  }
}

module.exports = { AgentRulesUI };
