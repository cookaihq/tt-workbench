"use strict";
const { ROOTS } = require("./vault-paths.js");
const { documentParts, NoteWriteError } = require("./note-editor.js");
const { isBusinessPath } = require("./note-reader.js");
const { TaskTransfer, isInboxPath } = require("./shared.js");
const { randomUUID } = require("node:crypto");

function workLinks(fields) {
  return (Array.isArray(fields?.related_work) ? fields.related_work : []).flatMap(value => {
    const match = typeof value === "string" && /^\[\[([^\[\]#|]+\.md)\]\]$/.exec(value);
    return match && isBusinessPath(match[1]) ? [match[1]] : [];
  });
}

class WorkLinks {
  constructor(plugin) { this.plugin = plugin; this.transfers = new Map(); }
  async move(source, targetPath) {
    const transfer = new TaskTransfer(this.plugin.app.vault.adapter.getBasePath());
    const key = `${source.path}\n${targetPath}`;
    let input = this.transfers.get(key);
    if (!input) {
      const pending = await transfer.pending(source.path);
      if (pending && pending.input.target !== targetPath) throw new NoteWriteError("TRANSFER_PENDING", `这条记录正在迁入另一个位置，请先核对：${pending.recoveryPath}`);
      input = pending?.input || { action: "transfer-inbox", request_id: randomUUID(), privacy: "ordinary", path: source.path, expected: source.content,
        target: targetPath, target_expected: (await this.plugin.reader.read(targetPath)).content };
      this.transfers.set(key, input);
    }
    try { return await transfer.run(input); }
    catch (error) {
      // A preflight failure has no durable operation to resume. A later explicit
      // retry after reopening the note must use that newly read source version.
      if (!await transfer.pending(source.path)) this.transfers.delete(key);
      throw error;
    }
  }
  async link(source, targetPath) {
    const { fields } = documentParts(source.content, this.plugin.editor.parseYaml);
    if (!isInboxPath(source.path) || fields.type !== "inbox") throw new NoteWriteError("INVALID_INBOX", "请先应用收件箱模板，再关联工作。");
    const target = this.plugin.work.describe(await this.plugin.reader.read(targetPath));
    if (!target) throw new NoteWriteError("INVALID_TARGET", "所选目标不是有效项目或任务。");
    const existing = fields.related_work;
    if (existing !== undefined && (!Array.isArray(existing) || workLinks(fields).length !== existing.length)) throw new NoteWriteError("INVALID_LINKS", "related_work 属性含无效关联，请先在原笔记中核对。");
    const related = workLinks(fields).includes(targetPath) ? existing : [...(existing || []), `[[${targetPath}]]`];
    return this.plugin.editor.update(source.path, source.content, { fields: { related_work: related } });
  }
}

class LinkUI {
  constructor(view) { this.view = view; }
  renderInbox(note, inbox) {
    const v = this.view, fields = v.app.metadataCache.getCache(note.path)?.frontmatter;
    if (fields?.type !== "inbox" || inbox.invalidYaml) return;
    const panel = v.bodyEl.createDiv({ cls: "tw-link-panel tw-edit-panel" });
    panel.createEl("h3", { text: "整理去向与引用", cls: "tw-field-heading" });
    panel.createEl("p", { text: "选择已有项目、任务、领域或资源笔记，原记录与专属附件一起归入该位置。不因整理材料而自动建立任务。", cls: "tw-help" });
    const moveForm = panel.createEl("form", { cls: "tw-transfer-form" });
    const task = v.workUI.field(moveForm, "归入已有位置", "select");
    const contentTargets = v.reader.list().filter(file => [ROOTS.areas, ROOTS.resources].some(root => file.path.startsWith(`${root}/`)) && !v.app.metadataCache.getCache(file.path)?.frontmatter?.test_fixture);
    v.workUI.options(task, [["", "选择项目、任务、领域或资源笔记"], ...v.workEntries.filter(i => !i.archived && !i.legacy).map(i => [i.path, `${i.type === "task" ? "任务" : "项目"} · ${i.title}`]), ...contentTargets.map(i => [i.path, i.path])]); task.required = true;
    const moveActions = moveForm.createDiv({ cls: "tw-actions" });
    const moveButton = moveActions.createEl("button", { text: "迁入所选位置", attr: { type: "submit" } });
    const moveMessage = moveForm.createDiv({ cls: "tw-status", attr: { role: "status" } });
    const assertSaved = () => { if (v.inboxDrafts.get(note.path)?.supplement?.trim()) throw new NoteWriteError("UNSAVED_INPUT", "先保存或放弃当前补充，再迁入任务。"); };
    v.button(moveActions, "新建任务并迁入资料", "新建任务并迁入资料", () => {
      try {
        assertSaved();
        v.taskUI.openCreate("", async target => { const result = await v.plugin.links.move(note, target); v.inboxDrafts.delete(note.path); return result; });
        v.taskUI.name.value = inbox.title || note.title;
      } catch (error) { moveMessage.dataset.kind = "error"; moveMessage.setText(error.message); }
    });
    moveForm.addEventListener("submit", async event => {
      event.preventDefault(); if (moveButton.disabled) return; moveButton.disabled = task.disabled = true;
      moveMessage.setText("正在迁入资料…");
      try {
        assertSaved(); const result = await v.plugin.links.move(note, task.value);
        const targetWork = v.workEntries.find(item => item.path === task.value);
        v.inboxDrafts.delete(note.path); await v.showSaved(result.path, targetWork ? targetWork.type === "task" ? "@tasks" : "@projects" : task.value.split("/")[0]);
        v.receiptEl.setText("原记录和专属附件已迁入所选位置。"); v.receiptEl.hidden = false;
      } catch (error) { moveMessage.dataset.kind = "error"; moveMessage.dataset.errorCode = error.code; moveMessage.setText(error.message); }
      finally { moveButton.disabled = task.disabled = false; }
    });
    for (const target of workLinks(fields)) v.button(panel, `打开关联 ${target}`, v.workEntries.find(i => i.path === target)?.title || target, () => v.openNote(target)).addClass("tw-related-note");
    const form = panel.createEl("form");
    const select = v.workUI.field(form, "共享资料：仅添加引用", "select");
    v.workUI.options(select, [["", "选择已有项目或任务"], ...v.workEntries.map(i => [i.path, `${i.type === "task" ? "任务" : "项目"} · ${i.title}`])]); select.required = true;
    const actions = form.createDiv({ cls: "tw-actions" });
    const save = actions.createEl("button", { text: "仅添加引用", attr: { type: "submit" } });
    const message = form.createDiv({ cls: "tw-status", attr: { role: "status" } });
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (save.disabled) return; save.disabled = true; select.disabled = true;
      try {
        const result = await v.plugin.links.link(note, select.value);
        const draft = v.inboxDrafts.get(note.path); if (draft?.base === note.content) draft.base = result.content;
        if (v.selectedPath === note.path) await v.openNote(note.path);
        v.receiptEl.setText("已添加引用，资料位置与整理状态保持不变。"); v.receiptEl.hidden = false;
      } catch (error) { message.dataset.kind = "error"; message.dataset.errorCode = error.code; message.setText(error.message); }
      finally { save.disabled = false; select.disabled = false; }
    });
  }
  renderSources(note) {
    const v = this.view;
    const sources = v.inboxEntries.filter(e => e.kind === "record" && workLinks(v.app.metadataCache.getCache(e.path)?.frontmatter).includes(note.path));
    if (!sources.length) return;
    const panel = v.bodyEl.createDiv({ cls: "tw-edit-panel tw-linked-sources" });
    panel.createEl("h3", { text: "来源记录", cls: "tw-field-heading" });
    for (const entry of sources) v.button(panel, `回看来源 ${entry.path}`, entry.inbox.title || entry.title, () => { v.pageScope = ROOTS.inbox; v.inboxFilter = "all"; v.refreshList(); return v.openNote(entry.path); }).addClass("tw-related-note");
  }
}
module.exports = { WorkLinks, LinkUI, workLinks };
