"use strict";

class UpdatesUI {
  constructor(view) {
    this.view = view; this.service = view.plugin.updates;
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
  open() {
    if (this.dialog) return;
    this.dialog = this.view.contentEl.createEl("dialog", { cls: "tw-modal tw-updates-modal", attr: { "aria-label": "工作台版本与更新" } });
    this.body = this.dialog.createDiv();
    this.dialog.addEventListener("close", () => this.close());
    this.render(this.service.status);
    this.dialog.showModal();
  }
  close() {
    const dialog = this.dialog;
    this.dialog = null; this.body = null;
    dialog?.remove();
  }
  dispose() { this.unsubscribe?.(); this.close(); }
}

module.exports = { UpdatesUI };
