"use strict";

class UpdatesUI {
  constructor(view) {
    this.view = view; this.service = view.plugin.updates;
    this.scopeGeneration = 0; this.scopeOpen = false;
  }
  mount(header) {
    this.button = header.createEl("button", { cls: "tw-version", attr: { "aria-label": "工作台版本与更新" } });
    this.button.addEventListener("click", () => this.open());
    this.unsubscribe = this.service.subscribe(status => this.render(status));
  }
  render(s) {
    const label = s.kind === "available" ? `v${s.current} · 有更新` : s.kind === "installed" ? `v${s.current} · 待重启` : `v${s.current}`;
    this.button.setText(label);
    this.button.dataset.update = String(["available", "installed"].includes(s.kind));
    this.button.title = s.kind === "error" ? s.message : "工作台版本与更新";
    if (!this.body) return;
    const scopeOpen = this.scopeEl?.open ?? this.scopeOpen;
    this.body.empty();
    this.body.createEl("h2", { text: "工作台版本" });
    this.body.createEl("p", { text: `当前运行 v${s.current}` });
    const message = {
      unconfigured: "尚未设置公开的 GitHub 仓库，设置后可检查发布版本。",
      idle: "打开工作台后自动检查，也可以手动检查新版本。",
      checking: "正在检查新版本…",
      current: "当前已是最新发布版本。",
      ahead: `当前版本比已发布的 v${s.latest} 更新。`,
      available: `有新版本 v${s.latest} 可以安装。`,
      installing: `正在下载并校验 v${s.latest}…`,
      installed: `已安装 v${s.latest}。请保存未提交的输入，再重启 Obsidian 生效。`,
      error: s.message
    }[s.kind];
    this.body.createEl("p", { text: message, cls: "tw-update-message", attr: { role: "status", "aria-live": "polite" } });
    this.body.createEl("p", { text: "版本来自独立工作台的 GitHub Releases。点击更新后下载安装，保留旧版与本机设置，重启时加载新版本。", cls: "tw-muted" });
    const sourceForm = this.body.createDiv({ cls: "tw-actions" });
    const repository = sourceForm.createEl("input", { attr: { "aria-label": "公开 GitHub 仓库", placeholder: "owner/repository" } });
    repository.value = this.service.repository;
    const saveSource = sourceForm.createEl("button", { text: "保存更新来源" });
    saveSource.disabled = ["checking", "installing"].includes(s.kind);
    saveSource.addEventListener("click", async () => {
      try { await this.service.configure(repository.value); }
      catch (error) { this.service.setStatus({ kind: "error", message: error.message }); }
    });
    if (s.checkedAt) this.body.createEl("small", { text: `最近成功检查：${new Date(s.checkedAt).toLocaleString()}` });
    const scope = this.body.createEl("details", { cls: "tw-update-scope" });
    this.scopeEl = scope;
    scope.open = scopeOpen;
    scope.createEl("summary", { text: "代码同步设置" });
    scope.addEventListener("toggle", () => {
      const newlyExpanded = scope.open && !this.scopeOpen;
      this.scopeOpen = scope.open;
      if (newlyExpanded) void this.refreshScope();
    });
    scope.createEl("p", { text: "以下安装文件、更新恢复材料和运行记录应保留在本机，排除 FNS 同步。路径相对于当前笔记库，排除范围包含目录内的所有文件和子目录；已有上级目录排除规则也算覆盖。" });
    this.scopeList = scope.createEl("ul", { cls: "tw-update-scope-list", attr: { "aria-label": "需要排除 FNS 同步的目录" } });
    const configDir = this.view.plugin.app.vault.configDir;
    scope.createEl("p", { text: "运行记录使用本实例设置的位置，默认 .system/.workbench-runtime/；位置配置保存在 .system/workbench/。更新恢复目录保存旧版及设备设置，不参加同步。", cls: "tw-muted" });
    scope.createEl("p", { text: `${configDir}/community-plugins.json 保存本机所有第三方插件的启用列表。若已排除整个 ${configDir}/，启用列表与工作台插件目录都已覆盖，无需重复添加。`, cls: "tw-muted" });
    const scopeActions = scope.createDiv({ cls: "tw-update-scope-actions" });
    this.scopeSetup = scopeActions.createEl("button", { text: "排除代码的 FNS 同步" });
    this.scopeStatus = scopeActions.createSpan({ cls: "tw-update-scope-status", attr: { role: "status", "aria-live": "polite" } });
    this.scopeMessage = scope.createEl("p", { cls: "tw-update-scope-message" });
    this.scopeSetup.addEventListener("click", () => void this.configureScope());
    this.renderScope();
    const actions = this.body.createDiv({ cls: "tw-actions" });
    const busy = ["checking", "installing"].includes(s.kind);
    const check = actions.createEl("button", { text: "检查更新" });
    check.disabled = busy || s.kind === "installed";
    check.addEventListener("click", () => void this.service.check());
    if (s.kind === "available") {
      const install = actions.createEl("button", { text: `安装 v${s.latest}` });
      install.addEventListener("click", () => void this.service.install());
    }
    const close = actions.createEl("button", { text: "关闭" });
    close.addEventListener("click", () => this.close());
  }
  renderScope() {
    if (!this.scopeList) return;
    const report = this.scopeReport;
    const directories = report?.directories || this.view.plugin.codeSyncDirectories.map(path => ({ path, excluded: null }));
    this.scopeList.empty();
    for (const directory of directories) {
      const item = this.scopeList.createEl("li");
      item.createEl("code", { text: directory.path + "/" });
      const status = directory.excluded === true ? "已排除" : directory.excluded === false ? "需设置" : "待核验";
      const badge = item.createSpan({ text: status, cls: "tw-update-directory-status" });
      badge.dataset.state = directory.excluded === true ? "configured" : "pending";
      if (directory.reason) badge.title = directory.reason;
    }
    const kind = this.scopeApplying ? "applying" : this.scopeChecking ? "checking" : report?.status || "checking";
    const count = directories.filter(item => item.excluded).length;
    this.scopeStatus.setText({ checking: "正在检测…", applying: "正在设置…", configured: "已设置 · 已生效", pending: "已设置 · 待生效", unknown: "无法确认", "needs-setup": `尚未完成 · ${count}/${directories.length} 已排除` }[kind]);
    this.scopeStatus.dataset.state = kind;
    this.scopeSetup.disabled = this.scopeApplying || this.scopeChecking || report?.canConfigure === false || report?.configured === true || ["checking", "installing"].includes(this.service.status.kind);
    this.scopeMessage.setText(this.scopeError || report?.message || "正在读取本机 FNS 配置与加载状态。");
    this.scopeMessage.dataset.error = String(Boolean(this.scopeError));
  }
  async refreshScope() {
    if (!this.dialog || this.scopeApplying) return;
    const generation = ++this.scopeGeneration;
    this.scopeChecking = true;
    this.renderScope();
    try {
      const report = await this.view.plugin.inspectCodeSync();
      if (generation !== this.scopeGeneration) return;
      this.scopeReport = report;
    } catch {
      if (generation !== this.scopeGeneration) return;
      this.scopeReport = { status: "unknown", canConfigure: false, message: "无法读取本机 FNS 状态，请重新打开弹窗检查。" };
    } finally {
      if (generation === this.scopeGeneration) { this.scopeChecking = false; this.renderScope(); }
    }
  }
  async configureScope() {
    if (this.scopeApplying) return;
    ++this.scopeGeneration;
    this.scopeApplying = true; this.scopeChecking = false; this.scopeError = "";
    this.renderScope();
    try { await this.view.plugin.configureCodeSync(); }
    catch (error) { this.scopeError = error.message; }
    finally { this.scopeApplying = false; await this.refreshScope(); }
  }
  open() {
    if (this.dialog) return;
    this.dialog = this.view.contentEl.createEl("dialog", { cls: "tw-modal tw-updates-modal", attr: { "aria-label": "工作台版本与更新" } });
    this.body = this.dialog.createDiv();
    this.dialog.addEventListener("close", () => this.close());
    this.render(this.service.status);
    this.dialog.showModal();
    void this.refreshScope();
  }
  close() {
    ++this.scopeGeneration;
    this.scopeOpen = this.scopeEl?.open ?? this.scopeOpen;
    const dialog = this.dialog;
    this.dialog = null; this.body = null; this.scopeEl = null; this.scopeList = null;
    dialog?.remove();
  }
  dispose() { this.unsubscribe?.(); this.close(); }
}

module.exports = { UpdatesUI };
