"use strict";

const { WORK_STATES, USE_STATES, USE_FIELDS, workMetadata, workVisible } = require("./work-items.js");
const { randomUUID } = require("node:crypto");
const { ROOTS } = require("./vault-paths.js");

class WorkUI {
  constructor(view) { this.view = view; this.store = view.plugin.work; this.statusFilter = "current"; this.areaFilter = ""; this.groupFilter = ""; this.drafts = new Map(); this.useDrafts = new Map(); }

  field(form, label, tag = "input", attributes = {}) {
    const wrapper = form.createEl("label", { text: label, cls: "tw-field" });
    return wrapper.createEl(tag, { attr: { "aria-label": label, ...attributes } });
  }

  options(select, values) { for (const [value, text] of values) select.createEl("option", { text, attr: { value } }); }

  build(root) {
    const v = this.view;
    this.dialog = root.createEl("dialog", { cls: "tw-modal", attr: { "aria-label": "新建项目" } });
    this.dialog.createEl("h2", { text: "新建项目" });
    const form = this.dialog.createEl("form"); this.createForm = form;
    this.name = this.field(form, "项目名称", "input", { required: "", maxlength: "80" });
    this.goal = this.field(form, "项目目标与范围", "textarea", { required: "", rows: "4", placeholder: "决定推进什么？本阶段关注什么，不包含什么？" });
    form.createDiv({ text: "项目集中保存。领域、客户和创作方向可在项目正文中按需关联；长期研究也可建立范围明确的项目。", cls: "tw-muted tw-help" });
    const actions = form.createDiv({ cls: "tw-actions" });
    this.cancel = v.button(actions, "取消新建项目", "取消", () => this.dialog.close());
    this.submit = actions.createEl("button", { text: "创建项目", cls: "mod-cta", attr: { type: "submit" } });
    this.message = form.createDiv({ cls: "tw-status", attr: { role: "status", "aria-live": "polite" } });
    form.addEventListener("input", () => { this.attempt = null; this.message.setText(""); });
    form.addEventListener("change", () => { this.attempt = null; });
    form.addEventListener("submit", event => { event.preventDefault(); void this.saveProject(); });
  }

  openCreate() { this.dialog.showModal(); this.name.focus(); }

  async saveProject() {
    if (this.submit.disabled) return;
    const controls = [this.name, this.goal, this.cancel, this.submit]; controls.forEach(c => { c.disabled = true; });
    this.message.setText("正在创建…"); this.message.dataset.kind = "loading";
    try {
      if (!this.attempt) this.attempt = this.store.prepareProject({ name: this.name.value, goal: this.goal.value });
      const saved = await this.store.save(this.attempt);
      this.attempt = null; this.name.value = ""; this.goal.value = ""; this.dialog.close();
      this.message.dataset.kind = "saved";
      await this.view.showSaved(saved.path, "@projects");
    } catch (error) {
      this.message.dataset.kind = "error"; this.message.dataset.errorCode = error.code || "WRITE_FAILED";
      this.message.setText(error.message || "创建未完成，输入已保留。");
    } finally { controls.forEach(c => { c.disabled = false; }); }
  }

  catalog(files) {
    const items = files.map(file => {
      const fields = this.view.app.metadataCache.getCache(file.path)?.frontmatter;
      const item = workMetadata(file.path, fields);
      return item ? { ...item, test_fixture: fields?.test_fixture === true } : null;
    }).filter(Boolean);
    const fixtureProjects = new Set(items.filter(item => item.type === "project" && item.test_fixture).map(item => item.path));
    return items.map(item => ({ ...item, test_fixture: item.test_fixture || fixtureProjects.has(item.projectPath) }));
  }

  renderFilters(parent, items) {
    const add = (label, values, value, change) => {
      const select = parent.createEl("select", { attr: { "aria-label": label } }); this.options(select, values); select.value = value;
      select.addEventListener("change", () => { change(select.value); this.view.refreshList(); }); return select;
    };
    this.areaSelect = add("按领域筛选", [["", "全部领域"], ...[...new Set(items.map(i => i.area))].filter(Boolean).map(x => [x, x])], this.areaFilter, value => { this.areaFilter = value; this.groupFilter = ""; });
    const groups = [...new Set(items.filter(i => !this.areaFilter || i.area === this.areaFilter).map(i => i.group))].filter(Boolean);
    this.groupSelect = add("按企业或分组筛选", [["", "全部企业／分组"], ...groups.map(x => [x, x])], this.groupFilter, value => { this.groupFilter = value; });
    this.areaSelect.hidden = this.areaSelect.options.length === 1;
    this.groupSelect.hidden = this.groupSelect.options.length === 1;
    this.statusSelect = add("按项目状态筛选", [["current", "活跃项目"], ["paused", "暂停"], ["history", "已结束（未存档）"], ["archived", "已存档"], ["all", "全部项目"], ["not_started", "待开始"], ["in_progress", "进行中"], ["completed", "已完成（未存档）"], ["cancelled", "已取消（未存档）"]], this.statusFilter, value => { this.statusFilter = value; });
  }

  visible(items) {
    return items.filter(i => (!this.areaFilter || i.area === this.areaFilter) && (!this.groupFilter || i.group === this.groupFilter)
      && workVisible(i, this.statusFilter));
  }

  renderDetail(note, item) {
    const v = this.view;
    v.noteInfoEl.createDiv({ text: [item.area, item.group, "项目"].filter(Boolean).join(" / "), cls: "tw-breadcrumb" });
    v.noteInfoEl.createEl("h2", { text: item.title });
    v.noteInfoEl.createSpan({ text: item.statusLabel, cls: "tw-pill", attr: { "data-state": item.status } });
    if (item.archived) v.noteInfoEl.createSpan({ text: "已存档", cls: "tw-pill" });
    if (item.archived) { this.renderArchive(note, item); return; }
    const draft = this.drafts.get(note.path) || { base: note, status: item.status };
    const form = v.bodyEl.createEl("form", { cls: "tw-work-form tw-edit-panel" });
    const select = this.field(form, "项目状态", "select"); this.options(select, Object.entries(WORK_STATES));
    select.value = draft.status;
    const actions = form.createDiv({ cls: "tw-actions" }); actions.createSpan({ text: "任务完成不会自动结束项目", cls: "tw-muted tw-help" });
    const save = actions.createEl("button", { text: "保存项目状态", cls: "mod-cta", attr: { type: "submit" } });
    const message = form.createDiv({ cls: "tw-status", attr: { role: "status", "aria-live": "polite" } });
    if (draft.base.content !== note.content) message.setText("原文已变化，当前表单仍保留之前的修改；请核对后提交。");
    select.addEventListener("change", () => { draft.status = select.value; this.drafts.set(note.path, draft); });
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (save.disabled) return;
      draft.status = select.value; this.drafts.set(note.path, draft); select.disabled = save.disabled = true;
      try {
        await this.store.update(draft.base, { status: draft.status }); this.drafts.delete(note.path);
        v.receiptEl.setText(`已保存到本机 · ${note.path}`); v.receiptEl.hidden = false;
        if (v.selectedPath === note.path) await v.openNote(note.path);
      } catch (error) { message.dataset.kind = "error"; message.dataset.errorCode = error.code || "WRITE_FAILED"; message.setText(error.message); }
      finally { select.disabled = save.disabled = false; }
    });
    this.renderArchive(note, item);
  }

  renderArchive(note, item) {
    const v = this.view, section = v.bodyEl.createDiv({ cls: "tw-edit-panel" });
    section.createEl("p", { text: item.archived ? "项目已退出当前管理集合。恢复后保持原来的工作状态。" : "完成或暂停不会自动移动文件。归档将整个项目、任务与专属材料移入存档，保留当前工作状态。", cls: "tw-help" });
    const message = section.createDiv({ cls: "tw-status", attr: { role: "status" } });
    const button = v.button(section, item.archived ? "恢复项目" : "归档项目", item.archived ? "恢复项目" : "归档项目", async () => {
      if (button.disabled) return;
      if (this.drafts.has(note.path) || [...v.taskUI.drafts.keys(), ...this.useDrafts.keys()].some(path => path === note.path || path.startsWith(`${item.directory}/`))) { message.setText("先保存或放弃项目、任务与用途表单中的修改，再归档或恢复。"); return; }
      button.disabled = true; message.setText(item.archived ? "正在恢复项目…" : "正在归档项目…");
      try {
        const result = await this.store.relocate(note, item.archived ? "restore" : "archive");
        this.statusFilter = item.archived ? "all" : "archived";
        await v.showSaved(result.path, "@projects");
        v.receiptEl.setText(item.archived ? "项目已恢复，工作状态保持不变。" : "项目及其任务已存档，工作状态保持不变。"); v.receiptEl.hidden = false;
      } catch (error) { message.dataset.kind = "error"; message.dataset.errorCode = error.code || "MOVE_FAILED"; message.setText(error.message || "移动未完成，请核对原文件与恢复记录。"); }
      finally { button.disabled = false; }
    });
  }

  renderUses(note) {
    const v = this.view, section = v.bodyEl.createEl("details", { cls: "tw-edit-panel tw-output-uses" });
    section.createEl("summary", { text: "用途记录（可选）" });
    section.createEl("p", { text: "为这份内容或相关成果记录具体用途。各项用途独立更新；已使用时记录实际采用版本的链接或历史交付位置。", cls: "tw-help" });
    let uses;
    try { uses = this.store.uses(note); }
    catch (error) { section.createEl("p", { text: error.message, cls: "tw-warning" }); return; }
    if (uses.length) section.open = true;
    const list = section.createDiv();
    const draftNotice = section.createDiv({ cls: "tw-status", attr: { role: "status" } });
    const edit = use => {
      if (this.useDrafts.has(note.path)) { draftNotice.setText("先保存或取消当前用途修改，再编辑另一项。"); return; }
      draftNotice.setText("");
      this.useDrafts.set(note.path, { base: note, values: { ...Object.fromEntries(USE_FIELDS.map(key => [key, ""])), status: "planned", ...(use || { id: randomUUID() }) } });
      showForm();
    };
    for (const use of uses) {
      const row = list.createDiv({ cls: "tw-use-record" });
      row.createEl("strong", { text: use.title || "未命名用途" });
      row.createSpan({ text: ` · ${USE_STATES[use.status] || "状态待核对"}`, cls: "tw-muted" });
      if (use.purpose) row.createEl("p", { text: use.purpose });
      for (const [label, value] of [["成果", use.artifact], ["采用版本", use.version], ["使用对象", use.audience], ["日期", use.date], ["备注", use.note]]) {
        if (!value) continue;
        const line = row.createDiv({ cls: "tw-help" }); line.createSpan({ text: `${label}：${value}` });
        const match = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(value.trim());
        const target = match && v.app.metadataCache.getFirstLinkpathDest(match[1].split("#")[0], note.path);
        if (target?.extension === "md") v.button(line, `查看${label} ${target.path}`, "查看", () => v.openNote(target.path));
      }
      v.button(row, `更新用途 ${use.title || use.id}`, "更新用途", () => edit(use));
    }
    const formHost = section.createDiv();
    const add = v.button(section, "添加用途记录", "添加用途", () => edit(null));
    const showForm = () => {
      formHost.empty(); const draft = this.useDrafts.get(note.path); if (!draft) { add.hidden = false; return; }
      add.hidden = true; section.open = true;
      const form = formHost.createEl("form", { cls: "tw-use-form" }), inputs = {};
      for (const [key, label, tag] of [["title", "用途名称", "input"], ["artifact", "成果链接（选填）", "input"], ["version", "实际采用版本或交付位置", "input"], ["audience", "使用对象（选填）", "input"], ["purpose", "用途说明（选填）", "textarea"], ["status", "用途状态", "select"], ["date", "计划或实际使用日期（选填）", "input"], ["note", "用途备注（选填）", "textarea"]]) {
        inputs[key] = this.field(form, label, tag, key === "title" ? { required: "" } : {});
        if (key === "status") this.options(inputs[key], Object.entries(USE_STATES));
        inputs[key].value = draft.values[key] || "";
      }
      const remember = () => { for (const key of USE_FIELDS) draft.values[key] = inputs[key].value; inputs.version.required = inputs.status.value === "used"; };
      form.addEventListener("input", remember); form.addEventListener("change", remember); remember();
      const actions = form.createDiv({ cls: "tw-actions" });
      const cancel = v.button(actions, "放弃用途修改", "取消", () => { this.useDrafts.delete(note.path); draftNotice.setText(""); showForm(); });
      const save = actions.createEl("button", { text: "保存这项用途", cls: "mod-cta", attr: { type: "submit" } });
      const message = form.createDiv({ cls: "tw-status", attr: { role: "status" } });
      if (draft.base.content !== note.content) message.setText("原文已有变化，表单仍保留之前的输入；保存时会检查冲突。");
      form.addEventListener("submit", async event => {
        event.preventDefault(); if (save.disabled) return; remember();
        const controls = [...Object.values(inputs), save, cancel]; controls.forEach(control => { control.disabled = true; });
        try {
          await this.store.saveUse(draft.base, draft.values); this.useDrafts.delete(note.path);
          if (v.selectedPath === note.path) await v.openNote(note.path);
          v.receiptEl.setText("这项用途已保存，其他用途保持原有记录。"); v.receiptEl.hidden = false;
        } catch (error) { message.dataset.kind = "error"; message.dataset.errorCode = error.code || "WRITE_FAILED"; message.setText(error.message || "保存未完成，输入已保留。"); }
        finally { controls.forEach(control => { control.disabled = false; }); }
      });
    };
    showForm();
  }

  renderMaterialArchive(note) {
    const parts = note.path.split("/"), restoring = parts[0] === ROOTS.archives && ["领域", "资源"].includes(parts[1]);
    if (![ROOTS.areas, ROOTS.resources].includes(parts[0]) && !restoring) return;
    const v = this.view, section = v.bodyEl.createEl("details", { cls: "tw-edit-panel" });
    section.createEl("summary", { text: restoring ? "恢复领域或资源目录" : "归档领域或资源目录" });
    section.createEl("p", { text: "填写包含当前笔记的完整目录。操作会移动该目录内的所有笔记与附件；关联项目和其他资源保留原处。请选择一个具体内容包，避免把整类资料一起归档。", cls: "tw-help" });
    const form = section.createEl("form"), directory = this.field(form, "整包目录", "input", { required: "", placeholder: restoring ? "4.存档/资源/课程/课程名" : `${parts[0]}/具体内容目录` });
    const preview = form.createDiv({ cls: "tw-help" }), save = form.createEl("button", { text: restoring ? "恢复这个目录" : "归档这个目录", attr: { type: "submit" } });
    const message = form.createDiv({ cls: "tw-status", attr: { role: "status" } }); save.disabled = true;
    directory.addEventListener("input", () => {
      const value = directory.value.trim().replace(/\/$/, ""), segments = value.split("/");
      const valid = value && note.path.startsWith(`${value}/`) && segments.length >= (restoring ? 3 : 2) && segments.every(segment => segment && !segment.startsWith(".") && !["tmp", "node_modules"].includes(segment));
      save.disabled = !valid;
      if (!valid) { preview.setText("填写当前笔记所在的具体目录后，可查看移动范围。"); return; }
      const files = v.reader.list().filter(file => file.path.startsWith(`${value}/`));
      const target = restoring ? `${parts[1] === "领域" ? ROOTS.areas : ROOTS.resources}/${segments.slice(2).join("/")}` : `${ROOTS.archives}/${parts[0] === ROOTS.areas ? "领域" : "资源"}/${segments.slice(1).join("/")}`;
      preview.setText(`整个目录 ${value} → ${target}。包含 ${files.length} 份可读笔记，以及该目录中的全部附件与其他文件。`);
    });
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (save.disabled) return;
      if ([...this.useDrafts.keys(), ...this.drafts.keys(), ...v.taskUI.drafts.keys()].some(path => path.startsWith(`${directory.value.trim().replace(/\/$/, "")}/`))) { message.setText("先保存或放弃这个目录内的表单修改，再移动目录。"); return; }
      save.disabled = directory.disabled = true;
      try {
        const result = await this.store.relocateMaterial(note, directory.value.trim().replace(/\/$/, ""), restoring ? "restore" : "archive");
        await v.showSaved(result.path, result.path.split("/")[0]);
        v.receiptEl.setText(restoring ? "目录及其内容已恢复。" : "目录及其内容已存档。"); v.receiptEl.hidden = false;
      } catch (error) { message.dataset.kind = "error"; message.dataset.errorCode = error.code || "MOVE_FAILED"; message.setText(error.message || "移动未完成，请核对恢复记录。"); }
      finally { save.disabled = directory.disabled = false; }
    });
  }
}

module.exports = { WorkUI };
