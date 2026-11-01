"use strict";

const { Plugin, ItemView, Component, MarkdownRenderer, Notice, setIcon, parseYaml, getFrontMatterInfo, apiVersion } = require("obsidian");
const { createRequire } = require("node:module");
const nodePath = require("node:path");
let NoteReader, NoteReadError, isBusinessPath;
let InboxStore, InboxError, inboxMetadata, inboxCatalog;
let NoteEditor, NoteWriteError;
let WorkStore, WorkUI, TaskUI;
let WorkLinks, LinkUI;
let AgentBridge;
let BrowseUI;
let AttachmentStore;
let ROOTS, mapPreviousPath;
let IssueStore, IssueUI, isIssuePath, isIssueDocumentPath;
let AgentRulesReader, AgentRulesUI;
let SkillInstallationUI;
let FnsUI;
let UpdatesUI;
let RuntimeSettingsUI;
const VIEW_TYPE = "tt-workbench";

class WorkbenchView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.reader = plugin.reader;
    this.selectedPath = "";
    this.pageScope = "@tasks";
    this.sequence = 0;
    this.modifyGeneration = 0;
    this.closed = false;
    this.inboxFilter = "pending";
    this.inboxDrafts = new Map();
    this.query = "";
    this.noteHistory = [];
    this.showFixtures = false;
    this.rulesAgent = "codex";
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "tt 工作台"; }
  getIcon() { return "panels-top-left"; }
  getState() { return { path: this.selectedPath, scope: this.pageScope, rulesAgent: this.agentRulesUI?.agent || this.rulesAgent, skillsAgent: this.skillsUI?.agent || this.skillsAgent }; }

  onResize() {
    if (this.resizeFrame) return;
    this.resizeFrame = this.contentEl.ownerDocument.defaultView.requestAnimationFrame(() => {
      this.resizeFrame = null;
      if (!this.closed) this.fitListToWindow();
    });
  }

  fitListToWindow() {
    if (!this.listEl || !this.workspaceEl) return;
    const view = this.contentEl.getBoundingClientRect();
    if (view.width <= 900) {
      if (this.listEl.style.maxHeight) this.listEl.style.removeProperty("max-height");
      return;
    }
    const top = this.listEl.getBoundingClientRect().top - view.top + this.workspaceEl.scrollTop;
    const height = `${Math.max(160, Math.floor(view.height - top - 16))}px`;
    if (this.listEl.style.maxHeight !== height) this.listEl.style.maxHeight = height;
  }

  async setState(state, result) {
    this.selectedPath = mapPreviousPath(state?.path);
    this.pageScope = typeof state?.scope === "string" ? mapPreviousPath(state.scope) : "@tasks";
    this.rulesAgent = ["codex", "claude"].includes(state?.rulesAgent) ? state.rulesAgent : "codex";
    this.skillsAgent = ["codex", "claude"].includes(state?.skillsAgent) ? state.skillsAgent : "codex";
    if (this.skillsUI) { this.skillsUI.leave(); this.skillsUI.agent = this.skillsAgent; }
    if (this.agentRulesUI) {
      this.agentRulesUI.leave();
      this.agentRulesUI.agent = this.rulesAgent;
      this.agentRulesUI.select.value = this.rulesAgent;
    }
    if (this.pathInput) {
      this.refreshList();
      if (this.selectedPath) await this.openNote(this.selectedPath);
    }
    await super.setState(state, result);
  }

  async onOpen() {
    this.closed = false;
    const root = this.contentEl;
    root.empty();
    root.addClass("tt-workbench");
    const header = root.createDiv({ cls: "tw-header" });
    const brand = header.createDiv({ cls: "tw-brand" });
    const mark = brand.createSpan({ cls: "tw-brandmark" });
    for (let i = 0; i < 4; i++) mark.createEl("i");
    brand.createEl("strong", { text: "tt" });
    header.createSpan({ text: "个人学习、研究与工作空间", cls: "tw-tagline" });
    const search = header.createDiv({ cls: "tw-search" });
    setIcon(search.createSpan(), "search");
    this.searchInput = search.createEl("input", { attr: { "aria-label": "搜索当前列表的标题或路径", placeholder: "搜索标题或路径…", type: "search" } });
    this.searchInput.addEventListener("input", () => { this.query = this.searchInput.value; this.refreshList(); });
    this.updatesUI = new UpdatesUI(this);
    this.updatesUI.mount(header);
    this.runtimeSettingsUI = new RuntimeSettingsUI(this);
    this.runtimeSettingsUI.mount(header);
    this.button(header, "在 Obsidian 独立窗口打开工作台", "独立窗口", () => this.plugin.openWorkbench(true, this.selectedPath, this.getState()));
    const shell = root.createDiv({ cls: "tw-shell" });
    this.nav = shell.createEl("nav", { cls: "tw-nav", attr: { "aria-label": "工作台导航" } });
    this.workspaceEl = shell.createEl("main", { cls: "tw-workspace" });
    const intro = this.workspaceEl.createDiv({ cls: "tw-page-intro" });
    const heading = intro.createDiv();
    this.pageEyebrow = heading.createDiv({ cls: "tw-eyebrow" });
    this.pageTitle = heading.createEl("h1");
    this.pageDescription = heading.createEl("p", { cls: "tw-subtitle" });
    const pageActions = intro.createDiv({ cls: "tw-page-actions" });
    this.workUI = new WorkUI(this);
    this.taskUI = new TaskUI(this);
    this.linkUI = new LinkUI(this);
    this.browseUI = new BrowseUI(this);
    this.issueUI = new IssueUI(this, (text, element, source, child) => MarkdownRenderer.render(this.app, text, element, source, child), Component);
    this.agentRulesUI = new AgentRulesUI(this);
    this.agentRulesUI.build(this.workspaceEl, pageActions);
    this.agentRulesUI.agent = this.rulesAgent;
    this.agentRulesUI.select.value = this.rulesAgent;
    this.skillsUI = new SkillInstallationUI(this);
    this.skillsUI.build(this.workspaceEl);
    this.skillsUI.agent = this.skillsAgent || "codex";
    this.fnsUI = new FnsUI(this);
    this.fnsUI.build(this.workspaceEl);
    this.newIssueButton = this.button(pageActions, "新建开发 Issue", "新建 Issue", () => this.issueUI.openCreate());
    this.newProjectButton = this.button(pageActions, "新建项目", "新建项目", () => this.workUI.openCreate());
    this.newTaskButton = this.button(pageActions, "新建任务", "新建任务", () => this.taskUI.openCreate());
    this.captureButton = this.button(pageActions, "写下想法或链接", "随手记", () => {
      this.capturePanel.hidden = false; this.capturePanel.showModal(); this.captureContent.focus();
    });
    this.captureButton.addClass("mod-cta");
    setIcon(this.captureButton.createSpan({ cls: "tw-button-icon", prepend: true }), "plus");
    this.statsEl = this.workspaceEl.createDiv({ cls: "tw-stats" });
    this.filterEl = this.workspaceEl.createDiv({ cls: "tw-filters" });
    const grid = this.workspaceEl.createDiv({ cls: "tw-grid" });
    const listPanel = grid.createEl("section", { cls: "tw-list-panel", attr: { "aria-label": "业务笔记列表" } });
    const listHeader = listPanel.createDiv({ cls: "tw-list-header" });
    this.countEl = listHeader.createSpan({ text: "笔记" });
    this.button(listHeader, "重新读取列表", "刷新", () => this.refreshList());
    this.listEl = listPanel.createDiv({ cls: "tw-list" });
    const detail = grid.createEl("section", { cls: "tw-detail", attr: { "aria-label": "笔记详情" } });
    this.buildCapture(root);
    this.workUI.build(root);
    this.taskUI.build(root);
    this.receiptEl = detail.createDiv({ cls: "tw-receipt", attr: { role: "status", "aria-live": "polite" } });
    this.receiptEl.hidden = true;
    const toolbar = detail.createDiv({ cls: "tw-toolbar" });
    this.noteInfoEl = toolbar.createDiv({ cls: "tw-note-info" });
    const location = detail.createEl("details", { cls: "tw-location" });
    location.createEl("summary", { text: "笔记位置与读取信息" });
    const form = location.createEl("form", { cls: "tw-path-form" });
    const label = form.createEl("label", { text: "笔记路径" });
    this.pathInput = label.createEl("input", {
      type: "text", placeholder: "选择左侧笔记，或输入库内路径.md",
      attr: { "aria-label": "笔记路径", spellcheck: "false", autocomplete: "off" }
    });
    form.createEl("button", { text: "打开", attr: { type: "submit" } });
    form.addEventListener("submit", event => { event.preventDefault(); void this.openNote(this.pathInput.value); });
    const actions = toolbar.createDiv({ cls: "tw-actions" });
    this.backButton = this.button(actions, "返回上一份笔记", "返回", async () => {
      const previous = this.noteHistory.pop(); if (!previous) return;
      this.returning = true; try { await this.openNote(previous); } finally { this.returning = false; }
    });
    this.refreshButton = this.button(actions, "重新读取当前笔记", "重新读取", () => this.openNote(this.selectedPath));
    this.editButton = this.button(actions, "在 Obsidian 中编辑原笔记", "编辑原笔记", async () => {
      if (isIssuePath(this.selectedPath)) return this.issueUI.editCurrent();
      try {
        const file = await this.reader.resolve(this.selectedPath);
        await this.app.workspace.getLeaf("tab").openFile(file);
      } catch (error) { this.showError(error); }
    });
    this.statusEl = detail.createDiv({ cls: "tw-status tw-read-status", attr: { role: "status", "aria-live": "polite" } });
    this.bodyEl = detail.createEl("article", { cls: "tw-body", attr: { tabindex: "0", "aria-label": "笔记正文" } });
    detail.append(location);
    // Preview is read-only. Capture before native handlers can toggle task boxes
    // or open a file/URI outside the selected business-note boundary.
    this.bodyEl.addEventListener("click", event => {
      if (event.target.closest?.(".tw-edit-panel")) return;
      const control = event.target.closest?.("a, input, button");
      if (!control) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (control.tagName === "A") {
        const target = control.getAttribute("data-href") || control.getAttribute("href") || "";
        if (control.classList.contains("internal-link") && !/^[a-z][a-z0-9+.-]*:/i.test(target)) {
          const file = this.app.metadataCache.getFirstLinkpathDest(target.split("#")[0], this.selectedPath);
          if (file && isBusinessPath(file.path)) void this.openNote(file.path);
          else new Notice("链接目标不存在，或不在工作台业务笔记范围内。");
        } else {
          new Notice("请在原笔记中打开外部链接。");
        }
      }
    }, true);
    this.refreshList();
    this.setStatus("从列表选择一篇笔记，直接在这里阅读。", "empty");
    this.setActions(false);
    if (this.selectedPath) await this.openNote(this.selectedPath);
    else this.navigate(this.pageScope);
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file.path === this.selectedPath) {
        ++this.modifyGeneration;
        this.setStatus("原笔记已更新，点击“重新读取”查看最新内容。", "stale");
      }
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      this.refreshList({ automatic: true });
      if (file.path === this.selectedPath) {
        ++this.sequence;
        this.clearBody();
        this.showError(new NoteReadError("NOT_FOUND", "这份笔记已不存在，请选择其他笔记。"));
      }
    }));
    this.registerEvent(this.app.vault.on("create", () => this.refreshList({ automatic: true })));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.refreshList({ automatic: true });
      if (oldPath === this.selectedPath) void this.openNote(file.path);
    }));
    this.registerEvent(this.app.metadataCache.on("changed", file => {
      if (isBusinessPath(file.path)) this.refreshList({ automatic: true });
    }));
    // Raw events include hidden plugin settings and runtime receipts, which
    // normal business-note events do not reliably report.
    this.registerEvent(this.app.vault.on("raw", filename => this.fnsUI.fileChanged(filename)));
    this.issueTimer = window.setInterval(() => { if (!this.closed && this.issueUI.active()) void this.issueUI.refresh({ automatic: true }); }, 5000);
  }

  buildCapture(detail) {
    this.capturePanel = detail.createEl("dialog", { cls: "tw-capture tw-modal", attr: { "aria-label": "新建收件箱记录" } });
    this.capturePanel.hidden = true;
    this.capturePanel.createDiv({ text: "INBOX / 随手记", cls: "tw-eyebrow" });
    this.capturePanel.createEl("h2", { text: "先把内容留下来" });
    this.captureForm = this.capturePanel.createEl("form");
    const titleLabel = this.captureForm.createEl("label", { text: "标题（选填）" });
    this.captureTitle = titleLabel.createEl("input", { type: "text", attr: { "aria-label": "标题（选填）", placeholder: "不填时使用正文第一行" } });
    const contentLabel = this.captureForm.createEl("label", { text: "想法、文字或链接" });
    this.captureContent = contentLabel.createEl("textarea", { attr: { "aria-label": "想法、文字或链接", rows: "5", placeholder: "想到什么就写下来…" } });
    const sourcesLabel = this.captureForm.createEl("label", { text: "来源链接（选填，每行一条）" });
    this.captureSources = sourcesLabel.createEl("textarea", { attr: { "aria-label": "来源链接（选填，每行一条）", rows: "2", placeholder: "https://…" } });
    this.captureForm.insertBefore(contentLabel, titleLabel);
    const actions = this.captureForm.createDiv({ cls: "tw-actions" });
    this.saveButton = actions.createEl("button", { text: "保存到收件箱", attr: { type: "submit" }, cls: "mod-cta" });
    this.hideCaptureButton = this.button(actions, "收起输入，暂不保存", "收起", () => { this.capturePanel.close(); this.capturePanel.hidden = true; });
    this.capturePanel.addEventListener("close", () => { this.capturePanel.hidden = true; });
    this.captureStatus = this.captureForm.createDiv({ cls: "tw-status", attr: { role: "status", "aria-live": "polite" } });
    this.captureForm.addEventListener("submit", event => { event.preventDefault(); void this.saveCapture(); });
    this.captureForm.addEventListener("input", () => { this.captureAttempt = null; this.captureStatus.setText(""); });
  }

  async saveCapture() {
    if (this.saving) return;
    this.saving = true;
    const controls = [this.captureTitle, this.captureContent, this.captureSources, this.saveButton, this.hideCaptureButton];
    controls.forEach(control => { control.disabled = true; });
    delete this.captureStatus.dataset.errorCode;
    this.captureStatus.dataset.kind = "loading";
    this.captureStatus.setText("正在保存…");
    this.receiptEl.hidden = true;
    try {
      if (!this.captureAttempt) this.captureAttempt = this.plugin.inbox.prepare({
        title: this.captureTitle.value, content: this.captureContent.value, sources: this.captureSources.value, captureEntry: this.captureEntry || "workbench"
      });
      const saved = await this.plugin.inbox.save(this.captureAttempt);
      this.captureStatus.dataset.kind = "saved";
      this.captureStatus.setText(`已保存到本机：${saved.path}`);
      this.captureTitle.value = "";
      this.captureContent.value = "";
      this.captureSources.value = "";
      this.captureAttempt = null;
      this.captureEntry = "workbench";
      this.capturePanel.close(); this.capturePanel.hidden = true;
      this.receiptEl.setText(`已保存到本机 · ${saved.path}`);
      this.receiptEl.hidden = false;
      this.pageScope = ROOTS.inbox;
      // Files created exclusively on disk are picked up by Obsidian's watcher.
      // Saving is already confirmed; a slow index must not be reported as data loss.
      const until = Date.now() + 5000;
      while (!this.closed && !this.app.vault.getAbstractFileByPath(saved.path) && Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      if (!this.closed) { this.refreshList(); await this.openNote(saved.path); }
    } catch (error) {
      this.captureStatus.dataset.kind = "error";
      this.captureStatus.dataset.errorCode = error.code || "WRITE_FAILED";
      this.captureStatus.setText(error instanceof InboxError || error instanceof NoteReadError ? error.message : "保存未完成，输入已保留，请重试。");
    } finally {
      this.saving = false;
      controls.forEach(control => { control.disabled = false; });
    }
  }

  button(parent, label, text, action) {
    const button = parent.createEl("button", { text, attr: { type: "button", "aria-label": label } });
    button.addEventListener("click", () => { void action(); });
    return button;
  }

  async showSaved(path, scope) {
    this.pageScope = scope;
    this.receiptEl.setText(`已保存到本机 · ${path}`); this.receiptEl.hidden = false;
    const until = Date.now() + 5000;
    while (!this.closed && !this.app.metadataCache.getCache(path) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 80));
    if (!this.closed) { this.refreshList(); await this.openNote(path); }
  }

  navigate(scope) {
    this.receiptEl.hidden = true;
    this.pageScope = scope; this.query = ""; this.searchInput.value = "";
    this.contentEl.dataset.issueMode = "list";
    this.selectedPath = ""; ++this.sequence; this.clearBody(); this.setActions(false); this.refreshList();
    this.app.workspace.requestSaveLayout();
    if (scope === "@issues") { this.issueUI.selectFirst = true; return; }
    if (["@fns", "@agent-rules", "@skills"].includes(scope)) return;
    const first = this.listEl.querySelector("button[data-path]");
    if (first) first.click();
    else { this.noteInfoEl.createEl("h2", { text: "从这里开始" }); this.bodyEl.createEl("p", { text: scope === "@projects" ? "创建一个项目，记录共同目标与资料。" : scope === "@tasks" ? "任务会在这里显示进度、下一步和相关笔记。" : "选择一份笔记，直接在这里阅读。", cls: "tw-empty" }); this.setStatus("", "empty"); }
  }

  refreshList({ automatic = false } = {}) {
    if (!this.listEl || this.closed) return;
    if (automatic && this.pageScope === "@fns") return;
    if (this.pageScope !== "@fns") this.fnsUI?.leave();
    let files;
    try { files = this.reader.list(); } catch (error) { this.showError(error); return; }
    this.allWorkEntries = this.workUI.catalog(files);
    this.fixtureDirectories = this.allWorkEntries.filter(item => item.test_fixture).map(item => item.directory);
    const isFixture = file => this.app.metadataCache.getCache(file.path)?.frontmatter?.test_fixture === true || this.fixtureDirectories.some(directory => file.path === directory || file.path.startsWith(`${directory}/`));
    this.workEntries = this.allWorkEntries.filter(item => this.showFixtures || !item.test_fixture);
    if (!this.showFixtures) files = files.filter(file => !isFixture(file));
    this.inboxEntries = inboxCatalog(files, path => this.app.metadataCache.getCache(path)?.frontmatter, this.app.vault.getConfig("attachmentFolderPath"));
    this.nav.empty();
    this.nav.createDiv({ text: "我的空间", cls: "tw-nav-label" });
    const scopes = [["@tasks", "任务", "list-todo"], [ROOTS.inbox, "0.收件箱", "inbox"], ["@projects", "1.项目", "folder"], [ROOTS.areas, "2.领域", "compass"], [ROOTS.resources, "3.资源", "book-open"], [ROOTS.archives, "4.存档", "archive"], ["", "全部笔记", "file-text"], ["@issues", "开发 Issue", "circle-dot"]];
    if (files.some(file => file.path === "首页.md")) this.button(this.nav, "打开库根首页", "首页", () => { this.pageScope = ""; return this.openNote("首页.md"); }).addClass("tw-nav-item");
    for (const [value, label, icon] of scopes) {
      const button = this.button(this.nav, `查看${label}`, "", () => this.navigate(value));
      setIcon(button.createSpan({ cls: "tw-nav-icon" }), icon); button.createSpan({ text: label });
      const count = value === "@projects" ? this.workEntries.filter(i => i.type === "project" && !i.archived).length : value === "@tasks" ? this.workEntries.filter(i => i.type === "task" && !i.archived).length : value === ROOTS.inbox ? this.inboxEntries.filter(i => i.kind === "record" && i.inbox.statusValue === "pending").length : value === "" ? files.length : null;
      if (count !== null) button.createSpan({ text: String(count), cls: "tw-nav-count" });
      button.classList.add("tw-nav-item");
      button.setAttribute("aria-current", this.pageScope === value || value && !value.startsWith("@") && this.pageScope.startsWith(`${value}/`) ? "page" : "false");
    }
    const system = this.nav.createDiv({ cls: "tw-nav-system", attr: { role: "group", "aria-label": "系统" } });
    system.createDiv({ text: "系统", cls: "tw-nav-label tw-system-label" });
    const skillsNav = this.button(system, "Skill 安装", "", () => this.navigate("@skills"));
    skillsNav.addClass("tw-nav-item"); setIcon(skillsNav.createSpan({ cls: "tw-nav-icon" }), "puzzle");
    skillsNav.createSpan({ text: "Skill 安装" }); skillsNav.setAttribute("aria-current", this.pageScope === "@skills" ? "page" : "false");
    const rulesNav = this.button(system, "Agent 规则", "", () => this.navigate("@agent-rules"));
    rulesNav.addClass("tw-nav-item"); setIcon(rulesNav.createSpan({ cls: "tw-nav-icon" }), "book-open-check");
    rulesNav.createSpan({ text: "Agent 规则" }); rulesNav.setAttribute("aria-current", this.pageScope === "@agent-rules" ? "page" : "false");
    const fnsNav = this.button(system, "FNS 配置同步", "", () => this.navigate("@fns"));
    fnsNav.addClass("tw-nav-item"); setIcon(fnsNav.createSpan({ cls: "tw-nav-icon" }), "settings-2");
    fnsNav.createSpan({ text: "FNS 配置同步" }); fnsNav.setAttribute("aria-current", this.pageScope === "@fns" ? "page" : "false");
    const foot = this.nav.createDiv({ cls: "tw-nav-foot" }); foot.createEl("strong", { text: "先记录，再决定下一步" }); foot.createEl("p", { text: "项目保存共同目标与资料。任务保留具体进展。收件箱保留尚待整理的输入。" });
    const isProject = this.pageScope === "@projects", isTask = this.pageScope === "@tasks";
    const page = isProject ? ["PROJECTS / 项目", "从项目找到目标与资料", "集中管理范围与目标，分别查看活跃、暂停、已结束和已存档项目。"] : isTask ? ["TASKS / 工作任务", "继续手上的工作", "查看进展、下一步和相关笔记，恢复这项工作的上下文。"] : this.pageScope === ROOTS.inbox ? ["INBOX / 收件箱", "先记下，稍后整理", "一句话、一个链接、一段摘录，都可以从这里开始。"] : this.pageScope.startsWith(ROOTS.areas) ? ["AREAS / 领域", "维持持续责任与标准", "领域保存需要持续维护的要求和管理记录，通过链接关联项目与资源。"] : this.pageScope.startsWith(ROOTS.resources) ? ["RESOURCES / 资源", "连接认识、来源与可复用内容", "围绕实际问题阅读、加工和连接内容；按需要建立主题索引。"] : this.pageScope.startsWith(ROOTS.archives) ? ["ARCHIVES / 存档", "找回过去的工作与依据", "存档保留完整上下文，项目与任务仍可阅读和检索；从项目说明恢复项目。"] : ["NOTES / 浏览笔记", "浏览你的笔记", "从真实笔记中找回资料、知识与工作记录。"];
    if (this.pageScope !== "@issues") { this.pageEyebrow.setText(page[0]); this.pageTitle.setText(page[1]); this.pageDescription.setText(page[2]); }
    this.newProjectButton.hidden = !isProject;
    this.newTaskButton.hidden = !isTask;
    this.newIssueButton.hidden = this.pageScope !== "@issues";
    const isRules = this.pageScope === "@agent-rules", isSkills = this.pageScope === "@skills", isSystem = isRules || isSkills || this.pageScope === "@fns";
    this.contentEl.dataset.page = isSkills ? "skills" : isRules ? "agent-rules" : this.pageScope === "@fns" ? "fns" : this.pageScope === "@issues" ? "issues" : "business";
    this.fnsUI.panel.hidden = this.pageScope !== "@fns";
    if (!isRules) this.agentRulesUI.leave();
    if (!isSkills) this.skillsUI.leave();
    this.searchInput.disabled = isSystem;
    this.captureButton.hidden = this.pageScope === "@issues" || isSystem;
    this.editButton.setText(this.pageScope === "@issues" ? "编辑内容" : "编辑原笔记");
    this.editButton.setAttribute("aria-label", this.pageScope === "@issues" ? "编辑 Issue 内容" : "在 Obsidian 中编辑原笔记");
    if (isSkills) {
      ++this.browseUI.generation; ++this.issueUI.generation;
      this.skillsUI.enter(); return;
    }
    if (isRules) {
      ++this.browseUI.generation; ++this.issueUI.generation;
      this.agentRulesUI.enter(); return;
    }
    if (this.pageScope === "@fns") {
      ++this.browseUI.generation; ++this.issueUI.generation;
      this.pageEyebrow.setText("系统 / 配置同步"); this.pageTitle.setText("FNS 配置同步");
      this.pageDescription.setText("让各台设备使用一致的同步规则，各自保留连接与身份。");
      void this.fnsUI.refresh(); return;
    }
    // Keep the Issue header and controls present while the filesystem scan runs.
    if (this.pageScope === "@issues") { ++this.browseUI.generation; this.issueUI.renderList(); void this.issueUI.refresh(); return; }
    this.statsEl.empty();
    this.filterEl.empty();
    if (this.fixtureDirectories.length) {
      const label = this.filterEl.createEl("label", { cls: "tw-filter-info" });
      const fixtures = label.createEl("input", { attr: { type: "checkbox", "aria-label": "显示验收样例" } }); fixtures.checked = this.showFixtures;
      label.createSpan({ text: "显示验收样例" });
      fixtures.addEventListener("change", () => { this.showFixtures = fixtures.checked; this.refreshList(); });
    }
    this.searchInput.placeholder = "搜索标题或路径…";
    this.searchInput.setAttribute("aria-label", "搜索当前列表的标题或路径");
    if (this.browseUI.active()) { this.browseUI.render(files); this.fitListToWindow(); return; }
    ++this.browseUI.generation;
    if (isProject) this.workUI.renderFilters(this.filterEl, this.workEntries.filter(i => i.type === "project"));
    if (isTask) {
      const tasks = this.workEntries.filter(i => i.type === "task");
      this.taskUI.renderFilters(this.filterEl, tasks);
      for (const [value, label] of [["in_progress", "进行中"], ["not_started", "待开始"], ["paused", "暂停"]]) {
        const stat = this.statsEl.createDiv({ cls: "tw-stat" }); stat.createEl("b", { text: String(tasks.filter(i => !i.archived && i.status === value).length) }); stat.createSpan({ text: label });
      }
      const projects = this.statsEl.createDiv({ cls: "tw-stat" });
      projects.createEl("b", { text: String(this.workEntries.filter(i => i.type === "project" && !i.archived).length) }); projects.createSpan({ text: "项目" });
    }
    if (this.pageScope === ROOTS.inbox) {
      this.filterEl.createDiv({ text: `显示时区：${Intl.DateTimeFormat().resolvedOptions().timeZone} · 按创建时间倒序，详情保留原始时间`, cls: "tw-filter-info" });
      for (const [value, label] of [["pending", "待整理"], ["reviewed", "已整理"], ["all", "全部记录"]]) {
        const count = this.inboxEntries.filter(i => i.kind !== "auxiliary" && i.kind !== "uncertain" && i.inbox?.statusValue === value).length;
        const button = this.button(this.filterEl, `查看${label}收件箱记录`, value === "all" ? label : `${label} ${count}`, () => { this.inboxFilter = value; this.refreshList(); });
        button.addClass("tw-filter-tab"); button.dataset.filter = value; button.setAttribute("aria-pressed", String(this.inboxFilter === value));
      }
    }
    const byPath = new Map(this.inboxEntries.map(entry => [entry.path, entry]));
    const visible = (isProject ? this.workUI.visible(this.workEntries.filter(i => i.type === "project")) : isTask ? this.taskUI.visible(this.workEntries) : files.filter(file => !this.pageScope || (this.pageScope === "根目录" ? !file.path.includes("/") : file.path.startsWith(`${this.pageScope}/`))))
      .map(file => byPath.get(file.path) || file)
      .filter(file => this.pageScope !== ROOTS.inbox || (file.kind !== "auxiliary" && (this.inboxFilter === "all" || !["pending", "reviewed"].includes(file.inbox?.statusValue) || file.inbox.statusValue === this.inboxFilter)))
      .filter(file => !this.query || `${file.title} ${file.path}`.toLowerCase().includes(this.query.toLowerCase()));
    if (this.pageScope === ROOTS.inbox) visible.sort((a, b) => Number(a.kind === "uncertain") - Number(b.kind === "uncertain") || (b.inbox?.timestamp ?? -Infinity) - (a.inbox?.timestamp ?? -Infinity) || a.path.localeCompare(b.path));
    const uncertainCount = this.pageScope === ROOTS.inbox ? visible.filter(file => file.kind === "uncertain").length : 0;
    this.countEl.setText(`${isProject ? "项目列表" : isTask ? "任务列表" : this.pageScope === ROOTS.inbox ? "记录" : "笔记"} · ${visible.length - uncertainCount}${uncertainCount ? ` · 待核对 ${uncertainCount}` : ""}`);
    const listScrollTop = this.listEl.scrollTop;
    this.listEl.empty();
    if (!visible.length) this.listEl.createEl("p", { text: isProject ? "没有匹配的项目。可以新建项目，或更换筛选条件。" : isTask ? "当前还没有任务。" : "当前范围还没有匹配的笔记。", cls: "tw-empty" });
    let uncertainHeading = false;
    for (const file of visible) {
      if (this.pageScope === ROOTS.inbox && file.kind === "uncertain" && !uncertainHeading) {
        this.listEl.createDiv({ text: "待核对文件（未计入记录）", cls: "tw-timezone" });
        uncertainHeading = true;
      }
      const button = this.button(this.listEl, `阅读 ${file.path}`, "", () => this.openNote(file.path));
      button.classList.add("tw-note");
      button.dataset.path = file.path;
      button.setAttribute("aria-pressed", String(this.selectedPath === file.path));
      if (file.inbox) {
        const row = button.createDiv({ cls: "tw-item-meta" });
        const entry = this.app.metadataCache.getCache(file.path)?.frontmatter?.capture_entry;
        row.createSpan({ text: ({ workbench: "工作台随手记", agent: "与 Agent 对话", browser: "浏览器剪藏" })[entry] || "笔记录入" });
        row.createSpan({ text: file.inbox.displayTime });
      }
      if (file.type === "task" || file.type === "project") {
        const meta = button.createDiv({ cls: "tw-item-meta" });
        meta.createSpan({ text: file.statusLabel, cls: "tw-pill", attr: { "data-state": file.status } });
        meta.createSpan({ text: file.archived ? "已存档" : file.legacy ? "待迁移" : file.type === "project" ? "项目" : "项目任务" });
      }
      button.createEl("strong", { text: file.inbox?.title || file.title });
      if (file.type === "project") { button.createSpan({ text: [file.area, file.group].filter(Boolean).join(" / "), cls: "tw-note-path" }); }
      if (file.type === "task") {
        const project = this.workEntries.find(i => i.type === "project" && i.path === file.projectPath);
        button.createSpan({ text: file.projectPath ? [file.area, file.group, project?.title || "项目暂不可读"].filter(Boolean).join(" / ") : "待迁移的旧任务", cls: "tw-note-path" });
        button.createDiv({ text: file.progress || "尚未填写进度说明", cls: "tw-note-preview" });
        button.createDiv({ text: `下一步：${file.next_step || "待确定"}`, cls: "tw-note-source" });
      }
      if (file.inbox) {
        const snippet = button.createDiv({ cls: "tw-note-preview" });
        void this.reader.read(file.path).then(note => {
          if (!snippet.isConnected) return;
          const body = this.plugin.inbox.describe(note.content, note.path)?.body || "";
          snippet.setText(body.trim().split(/\n## 后续补充/)[0].replace(/\s+/g, " ").slice(0, 180));
        }).catch(() => { if (snippet.isConnected) snippet.setText("暂时无法读取摘要，请打开笔记核对。"); });
        button.createSpan({ text: file.inbox.sources.length ? `${file.inbox.sources.length} 条来源记录` : file.inbox.status, cls: "tw-note-source" });
        if (file.kind === "uncertain") button.createSpan({ text: "待核对文件 · 尚未确定为独立记录", cls: "tw-warning" });
        else if (file.inbox.warnings.length) button.createSpan({ text: file.inbox.warnings.join(" "), cls: "tw-warning" });
      }
      if (!file.inbox && !file.type) button.createSpan({ text: file.path, cls: "tw-note-path" });
    }
    this.fitListToWindow();
    this.listEl.scrollTop = listScrollTop;
  }

  clearBody() {
    if (this.renderChild) { this.removeChild(this.renderChild); this.renderChild = null; }
    this.bodyEl?.empty();
    this.noteInfoEl?.empty();
  }

  renderInboxEditor(note, metadata) {
    const entry = this.inboxEntries?.find(entry => entry.path === note.path);
    if (!entry || !["record", "incomplete"].includes(entry.kind) || metadata.invalidYaml) return;
    const existing = this.inboxDrafts.get(note.path);
    const draft = existing || { base: note.content, supplement: "", status: metadata.statusValue || "" };
    const section = this.bodyEl.createEl("section", { cls: "tw-edit-panel" });
    const form = section.createEl("form");
    const label = form.createEl("label", { text: "自己的补充（选填）" });
    const input = label.createEl("textarea", { attr: { "aria-label": "追加自己的文字或来源链接", rows: "4" } });
    input.value = draft.supplement;
    const controls = form.createDiv({ cls: "tw-actions" });
    const save = controls.createEl("button", { text: "保存补充", attr: { type: "submit" } });
    const reset = this.button(controls, "放弃当前表单并读取原文件", "放弃表单并重新读取", () => { this.inboxDrafts.delete(note.path); void this.openNote(note.path); });
    const status = form.createDiv({ cls: "tw-status", attr: { role: "status", "aria-live": "polite" } });
    const remember = () => { draft.supplement = input.value; this.inboxDrafts.set(note.path, draft); };
    form.addEventListener("input", remember);
    if (existing && existing.base !== note.content) status.setText("本表单仍保留之前的输入。原文已有变化；提交时会保留冲突副本。请核对后再决定。 ");
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (save.disabled) return; remember();
      if (!draft.supplement.trim()) { status.setText("先填写要补充的内容。"); return; }
      [save, reset, input].forEach(el => { el.disabled = true; });
      status.setText("正在保存…"); status.dataset.kind = "loading";
      try {
        await this.plugin.editor.update(note.path, draft.base, { append: draft.supplement });
        this.inboxDrafts.delete(note.path);
        this.receiptEl.setText(`已保存到本机 · ${note.path}`); this.receiptEl.hidden = false;
        if (this.selectedPath === note.path) await this.openNote(note.path);
      } catch (error) {
        status.dataset.kind = "error"; status.dataset.errorCode = error.code || "WRITE_FAILED";
        status.setText(error instanceof NoteWriteError ? error.message : "保存未完成，表单输入已保留。");
        if (error.conflictPath) this.button(status, "打开本次保存冲突记录", "打开冲突副本", () => this.openNote(error.conflictPath));
      } finally { [save, reset, input].forEach(el => { el.disabled = false; }); }
    });
    const review = section.createDiv({ cls: "tw-review-actions" });
    review.createEl("p", { text: "整理后保留原记录，可以随时找回。", cls: "tw-muted tw-help" });
    const next = metadata.statusValue === "reviewed" ? "pending" : "reviewed";
    const reviewButton = this.button(review, next === "reviewed" ? "标为已整理" : "重新放回待整理", next === "reviewed" ? "标为已整理" : "重新放回待整理", async () => {
      if (reviewButton.disabled) return;
      reviewButton.disabled = true;
      try {
        const saved = await this.plugin.editor.update(note.path, note.content, { fields: { inbox_status: next } });
        const kept = this.inboxDrafts.get(note.path);
        if (kept?.base === note.content) kept.base = saved.content;
        if (this.selectedPath === note.path) await this.openNote(note.path);
        this.receiptEl.setText(next === "reviewed" ? "已标为已整理，可从已整理列表找回。" : "已重新放回待整理。"); this.receiptEl.hidden = false;
      } catch (error) { status.dataset.kind = "error"; status.dataset.errorCode = error.code; status.setText(error.message); }
      finally { reviewButton.disabled = false; }
    });
    reviewButton.addClass("mod-cta"); reviewButton.dataset.reviewStatus = next;
  }

  setActions(enabled) {
    if (this.refreshButton) this.refreshButton.disabled = !this.selectedPath;
    if (this.editButton) this.editButton.disabled = !enabled;
  }

  setStatus(text, kind) {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.statusEl.dataset.kind = kind;
  }

  showError(error) {
    this.clearBody();
    this.setActions(false);
    this.setStatus(error instanceof NoteReadError ? error.message : "读取未完成，请重新选择笔记后重试。", "error");
    if (this.statusEl) this.statusEl.dataset.errorCode = error.code || "RENDER_FAILED";
  }

  async openNote(path) {
    if (this.issueUI && (isIssuePath(path) || this.issueUI.active() && isIssueDocumentPath(path))) return this.issueUI.open(path);
    if (!this.returning && this.selectedPath && path !== this.selectedPath) this.noteHistory.push(this.selectedPath);
    this.backButton.disabled = !this.noteHistory.length;
    if (path !== this.selectedPath) this.receiptEl.hidden = true;
    const request = ++this.sequence;
    const modifiedAtStart = this.modifyGeneration;
    this.selectedPath = typeof path === "string" ? path.trim() : "";
    this.pathInput.value = this.selectedPath;
    this.clearBody();
    this.setActions(false);
    this.setStatus("正在读取笔记…", "loading");
    this.refreshList();
    let renderChild;
    try {
      const note = await this.reader.read(this.selectedPath);
      if (request !== this.sequence || this.closed) return;
      const article = this.contentEl.ownerDocument.createElement("div");
      article.className = "tw-markdown markdown-rendered";
      const inbox = this.plugin.inbox.describe(note.content, note.path);
      const work = this.plugin.work.describe(note);
      const displayContent = inbox ? inbox.body : work ? work.body.replace(/^\s*# [^\n]*\n/, "") : note.content;
      renderChild = new Component();
      this.addChild(renderChild);
      await this.plugin.attachments.render(displayContent, article, note, renderChild,
        safe => MarkdownRenderer.render(this.app, safe, article, note.path, renderChild));
      if (request !== this.sequence || this.closed) {
        if (renderChild) this.removeChild(renderChild);
        return;
      }
      this.renderChild = renderChild || null;
      if (inbox) {
        this.noteInfoEl.createDiv({ text: `收件箱 / ${inbox.displayTime}`, cls: "tw-breadcrumb" });
        this.noteInfoEl.createEl("h2", { text: inbox.title || note.title });
        this.noteInfoEl.createSpan({ text: inbox.status, cls: "tw-pill" });
        const original = typeof inbox.created === "string" && typeof inbox.offset === "string" ? `${inbox.created} UTC${inbox.offset}` : "创建时间或时区缺失／无效";
        this.noteInfoEl.createDiv({ text: `原始创建时间：${original}` });
        const entry = this.inboxEntries?.find(entry => entry.path === note.path);
        const warnings = new Set([...inbox.warnings, ...(entry?.inbox?.warnings || [])]);
        for (const warning of warnings) this.noteInfoEl.createDiv({ text: warning, cls: "tw-warning" });
      }
      if (work?.type === "project") this.workUI.renderDetail(note, work);
      if (work?.type === "task") this.taskUI.renderDetail(note, work);
      if (!inbox && !work) this.noteInfoEl.createEl("h2", { text: note.title });
      if (inbox) { this.bodyEl.createEl("h3", { text: "当时记下的内容", cls: "tw-field-heading" }); article.addClass("tw-raw-input"); }
      this.bodyEl.append(article);
      if (!inbox) this.workUI.renderUses(note);
      if (!inbox && !work) this.workUI.renderMaterialArchive(note);
      if (work) this.taskUI.related(note, work);
      if (work) this.linkUI.renderSources(note);
      if (work?.type === "task") this.taskUI.finishTabs(note, work);
      if (inbox) {
        this.bodyEl.createEl("h3", { text: "来源与材料", cls: "tw-field-heading" });
        if (inbox.sources.length) for (const source of inbox.sources) this.bodyEl.createDiv({ text: source, cls: "tw-source-entry" });
        else this.bodyEl.createEl("p", { text: "尚未单独整理来源信息；正文中的链接仍保留。", cls: "tw-muted tw-help" });
        this.renderInboxEditor(note, inbox);
        this.linkUI.renderInbox(note, inbox);
      }
      this.bodyEl.scrollTop = 0;
      const selected = this.listEl.querySelector('.tw-note[aria-pressed="true"]');
      if (selected) {
        const row = selected.getBoundingClientRect(), list = this.listEl.getBoundingClientRect();
        if (row.top < list.top || row.height > this.listEl.clientHeight) this.listEl.scrollTop += row.top - list.top;
        else if (row.bottom > list.bottom) this.listEl.scrollTop += row.bottom - list.bottom;
      }
      this.setActions(true);
      delete this.statusEl.dataset.errorCode;
      if (this.modifyGeneration !== modifiedAtStart) {
        this.setStatus("读取期间原笔记有更新，请重新读取确认最新内容。", "stale");
      } else {
        this.setStatus(`已读取 · ${new Date().toLocaleTimeString()} · ${note.path}`, "loaded");
      }
      this.app.workspace.requestSaveLayout();
    } catch (error) {
      if (renderChild) this.removeChild(renderChild);
      if (request === this.sequence && !this.closed) this.showError(error);
    }
  }

  async onClose() {
    this.closed = true;
    if (this.issueTimer) window.clearInterval(this.issueTimer);
    if (this.issueUI) ++this.issueUI.generation;
    this.agentRulesUI?.leave();
    this.skillsUI?.leave();
    if (this.fnsUI) this.fnsUI.dispose();
    if (this.updatesUI) this.updatesUI.dispose();
    this.runtimeSettingsUI?.dispose();
    ++this.sequence;
    this.clearBody();
  }
}

module.exports = class TTWorkbenchPlugin extends Plugin {
  async onload() {
    if (typeof this.app.vault.adapter.getBasePath !== "function") {
      new Notice("工作台需要桌面端的本地知识库。");
      return;
    }
    // Obsidian supplies its own require() for the API module. Anchor sibling
    // modules to this installed plugin instead of the Electron renderer entry.
    const localRequire = createRequire(nodePath.join(this.app.vault.adapter.getBasePath(), this.manifest.dir, "main.js"));
    const moduleRoot = nodePath.join(this.app.vault.adapter.getBasePath(), this.manifest.dir) + nodePath.sep;
    for (const filename of Object.keys(localRequire.cache)) if (filename.startsWith(moduleRoot)) delete localRequire.cache[filename];
    delete localRequire.cache[localRequire.resolve("./vault-paths.js")];
    ({ ROOTS, mapPreviousPath } = localRequire("./vault-paths.js"));
    delete localRequire.cache[localRequire.resolve("./note-reader.js")];
    ({ NoteReader, NoteReadError, isBusinessPath } = localRequire("./note-reader.js"));
    delete localRequire.cache[localRequire.resolve("./inbox.js")];
    ({ InboxStore, InboxError, inboxMetadata, inboxCatalog } = localRequire("./inbox.js"));
    delete localRequire.cache[localRequire.resolve("./note-editor.js")];
    ({ NoteEditor, NoteWriteError } = localRequire("./note-editor.js"));
    delete localRequire.cache[localRequire.resolve("./work-items.js")];
    ({ WorkStore } = localRequire("./work-items.js"));
    delete localRequire.cache[localRequire.resolve("./work-ui.js")];
    ({ WorkUI } = localRequire("./work-ui.js"));
    delete localRequire.cache[localRequire.resolve("./task-ui.js")];
    ({ TaskUI } = localRequire("./task-ui.js"));
    delete localRequire.cache[localRequire.resolve("./work-links.js")];
    ({ WorkLinks, LinkUI } = localRequire("./work-links.js"));
    delete localRequire.cache[localRequire.resolve("./agent-bridge.js")];
    ({ AgentBridge } = localRequire("./agent-bridge.js"));
    delete localRequire.cache[localRequire.resolve("./browse-ui.js")];
    ({ BrowseUI } = localRequire("./browse-ui.js"));
    delete localRequire.cache[localRequire.resolve("./attachments.js")];
    ({ AttachmentStore } = localRequire("./attachments.js"));
    for (const module of ["./issue-format.js", "./issues.js", "./issue-ui.js"]) delete localRequire.cache[localRequire.resolve(module)];
    ({ IssueStore, issuePath: isIssuePath, documentPath: isIssueDocumentPath } = localRequire("./issues.js"));
    ({ IssueUI } = localRequire("./issue-ui.js"));
    ({ AgentRulesReader } = localRequire("./agent-rules.js"));
    ({ AgentRulesUI } = localRequire("./agent-rules-ui.js"));
    ({ SkillInstallationUI } = localRequire("./skill-installation-ui.js"));
    const { SkillManager } = localRequire("./lib/agent-skills/manager.cjs");
    ({ FnsUI } = localRequire("./fns-ui.js"));
    ({ UpdatesUI } = localRequire("./updates-ui.js"));
    ({ RuntimeSettingsUI } = localRequire("./runtime-settings-ui.js"));
    const { RuntimeSettings } = localRequire("./runtime-settings.js");
    const { WorkbenchUpdates } = localRequire("./updates.js");
    this.settings = (await this.loadData()) || {};
    this.updates = new WorkbenchUpdates({ repository: this.settings.updateRepository || "", saveRepository: async repository => { this.settings.updateRepository = repository; await this.saveData(this.settings); }, vault: this.app.vault.adapter.getBasePath(), configDir: this.app.vault.configDir, version: this.manifest.version, appVersion: apiVersion });
    this.app.workspace.onLayoutReady(() => { void this.updates.check(); });
    this.registerInterval(window.setInterval(() => { void this.updates.check(); }, 6 * 60 * 60 * 1000));
    const { FnsSyncService } = localRequire("./lib/fns/sync.cjs");
    const { createFnsRuntime } = localRequire("./fns-runtime.js");
    this.fns = new FnsSyncService({ vault: this.app.vault.adapter.getBasePath(), configDir: this.app.vault.configDir, runtime: createFnsRuntime(this.app) });
    const { applyWorkbenchExclusions, inspectWorkbenchExclusions, assertWorkbenchExclusions } = localRequire("./lib/fns/workbench-scope.cjs");
    const { validateScope } = localRequire("./lib/fns/rules.cjs");
    this.configureLocalProtection = () => applyWorkbenchExclusions(this.fns);
    this.inspectLocalProtection = () => inspectWorkbenchExclusions(this.fns);
    this.updates.beforeInstall = () => assertWorkbenchExclusions(this.fns);
    this.issues = new IssueStore(this.settings.developmentRoot || this.app.vault.adapter.getBasePath());
    this.runtimeSettings = new RuntimeSettings(this);
    this.agentRules = new AgentRulesReader(this.app.vault.adapter.getBasePath(), { sourceRoot: this.settings.rulesRoot, sourceDirectory: this.settings.rulesSource });
    this.setRulesSource = async sourceDirectory => {
      const reader = new AgentRulesReader(this.app.vault.adapter.getBasePath(), { sourceDirectory });
      const checked = await reader.documents();
      if (checked.errors.length) throw Error(checked.errors.join('；'));
      const next = { ...this.settings, rulesSource: sourceDirectory };
      await this.saveData(next); this.settings = next; this.agentRules = reader;
    };
    this.skills = new SkillManager({ vault: this.app.vault.adapter.getBasePath(), packageRoot: moduleRoot, configDir: this.app.vault.configDir });
    const { SkillUpdates } = localRequire('./lib/agent-skills/updates.cjs');
    this.skillUpdates = new SkillUpdates({ manager: this.skills, repository: () => this.updates.repository, workbenchVersion: this.manifest.version,
      beforeInstall: async agent => { await this.beforeSkillWrite(agent); await assertWorkbenchExclusions(this.fns); } });
    this.beforeSkillWrite = async agent => {
      const runtime = await this.fns.runtime.inspect();
      if (runtime.enabled) {
        if (!runtime.loaded || !runtime.settings) throw Error('FNS 当前加载状态无法核验，请先检查 FNS 配置同步页面。');
        const { normalize } = localRequire('./lib/fns/rules.cjs');
        const storage = localRequire('./lib/runtime/storage.cjs');
        validateScope(normalize(runtime.settings), [this.skills.host(agent).directory, ...storage.protectedDirectories(this.app.vault.adapter.getBasePath())]);
      }
    };
    this.reader = new NoteReader(this.app.vault);
    this.inbox = new InboxStore(this.reader, { parseYaml, getFrontMatterInfo });
    this.editor = new NoteEditor(this.reader, { parseYaml });
    this.work = new WorkStore(this.reader, this.editor);
    this.links = new WorkLinks(this);
    this.attachments = new AttachmentStore(this);
    try { this.reader.assertVault(); } catch (error) { new Notice(error.message); return; }
    this.registerView(VIEW_TYPE, leaf => new WorkbenchView(leaf, this));
    // Restore saved layouts from the previous ID; the next save uses VIEW_TYPE.
    this.registerView("tannt-workbench", leaf => new WorkbenchView(leaf, this));
    this.addRibbonIcon("panels-top-left", "打开 tt 工作台", () => this.openWorkbench());
    this.addCommand({ id: "open-workbench", name: "打开工作台", callback: () => this.openWorkbench() });
    this.addCommand({ id: "open-workbench-window", name: "在独立窗口打开工作台", callback: () => this.openWorkbench(true) });
    this.addCommand({ id: "open-issues", name: "打开开发 Issue", callback: async () => { const view = await this.openWorkbench(); view.navigate("@issues"); } });
    this.addCommand({ id: "open-agent-rules", name: "打开 Agent 规则", callback: async () => { const view = await this.openWorkbench(); view.navigate("@agent-rules"); } });
    this.addCommand({ id: "open-skill-installation", name: "打开 Skill 安装", callback: async () => { const view = await this.openWorkbench(); view.navigate("@skills"); } });
    this.addCommand({ id: "open-fns-sync", name: "打开 FNS 配置同步", callback: async () => { const view = await this.openWorkbench(); view.navigate("@fns"); } });
    this.addCommand({ id: "runtime-storage", name: "设置运行数据位置", callback: async () => { const view = await this.openWorkbench(); view.runtimeSettingsUI.open(); } });
    this.addCommand({ id: "check-workbench-updates", name: "检查工作台更新", callback: async () => { const view = await this.openWorkbench(); view.updatesUI.open(); void this.updates.check(); } });
    const capture = async params => {
      if (params.target !== this.app.vault.getName() || typeof params.source !== "string" || !/^https?:\/\//i.test(params.source)) { new Notice("剪藏目标或来源无效，请从网页重新发起。"); return; }
      if (typeof params.text !== "string" || !params.text.trim() || params.text.length > 12000) { new Notice("未收到有效选区；请缩小选区后重试，原网页内容未保存。"); return; }
      const view = await this.openWorkbench();
      if (view.captureContent.value.trim() || view.saving) { new Notice("工作台还有未保存输入，请先保存或清空，再从原网页重新剪藏。"); return; }
      view.captureTitle.value = params.title || ""; view.captureContent.value = params.text; view.captureSources.value = params.source;
      view.captureEntry = "browser"; view.captureAttempt = null; view.captureButton.click();
      view.captureStatus.setText("已取得网页选区与来源，点击保存后写入收件箱。");
    };
    this.registerObsidianProtocolHandler("tt-capture", capture);
    this.registerObsidianProtocolHandler("tannt-capture", capture);
    this.agentBridge = new AgentBridge(this);
    let unloading = false;
    const stopBridge = () => {
      unloading = true;
      return this.agentBridge.stop().catch(error => console.error('tt 工作台连接服务清理失败：', error));
    };
    this.register(stopBridge);
    this.registerDomEvent(window, 'unload', stopBridge);
    // Enabled plugins can finish loading in a different order. Resolve FNS
    // after startup, while preventing a deferred callback from reviving unload.
    this.app.workspace.onLayoutReady(async () => {
      if (!unloading && this.app.plugins.plugins["fast-note-sync"]) {
        try { await this.agentBridge.start(); } catch (error) { new Notice(error.message); }
      }
    });
  }

  async openWorkbench(newWindow = false, selectedPath = "", viewState = {}) {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    let leaf = newWindow ? null : leaves.find(l => l.view instanceof WorkbenchView && l.view.captureContent && !l.view.closed) || leaves[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(newWindow ? "window" : "tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { ...viewState, path: selectedPath } });
    }
    if (typeof leaf.loadIfDeferred === "function") await leaf.loadIfDeferred();
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof WorkbenchView) || !leaf.view.captureContent) {
      await leaf.setViewState({ type: "empty" });
      await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { ...viewState, path: selectedPath } });
    }
    return leaf.view;
  }
};
