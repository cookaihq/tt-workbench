"use strict";
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { NoteWriteError, documentParts } = require("./note-editor.js");

const {WORK_STATES,segment,projectDirectory,workMetadata,prepareProject,prepareTask}=require("./shared.js");
const USE_STATES = Object.freeze({ planned: "计划使用", used: "已使用", cancelled: "已取消" });
const USE_FIELDS = ["title", "artifact", "version", "audience", "purpose", "status", "date", "note"];

function outputUses(fields) {
  const uses = fields.output_uses;
  if (uses === undefined) return [];
  if (!Array.isArray(uses) || uses.some(use => !use || typeof use !== "object" || Array.isArray(use) || typeof use.id !== "string" || !use.id || USE_FIELDS.some(key => use[key] !== undefined && typeof use[key] !== "string")) || new Set(uses.map(use => use.id)).size !== uses.length) {
    throw new NoteWriteError("INVALID_USES", "用途记录格式无效或身份重复，请先在原笔记中核对；现有记录未改写。");
  }
  return uses;
}

function workVisible(item, filter = "current") {
  if (filter === "all") return true;
  if (filter === "archived") return !!item.archived;
  if (item.archived) return false;
  if (filter === "current") return !["paused", "completed", "cancelled"].includes(item.status);
  if (filter === "history") return ["completed", "cancelled"].includes(item.status);
  return item.status === filter;
}

class WorkStore {
  constructor(reader, editor) { this.reader = reader; this.editor = editor; this.vault = reader.vault; this.attempts = new WeakMap(); this.relocations = new Map(); }

  describe(note) {
    try { const parts = documentParts(note.content, this.editor.parseYaml); const item = workMetadata(note.path, parts.fields); return item ? { ...item, body: parts.body, fields: parts.fields } : null; }
    catch { return null; }
  }

  prepareProject(input) {
    this.reader.assertVault();
    const attempt = Object.freeze({ ...prepareProject(input, new Date(), randomUUID()), type: "project" });
    this.attempts.set(attempt, { ownsDirectory: false, attempted: false });
    return attempt;
  }

  async prepareTask({ name, goal, projectPath = "" }) {
    this.reader.assertVault();
    const prepared = await prepareTask({ read: async value => (await this.reader.read(value)).content }, { name, goal, projectPath }, new Date(), randomUUID());
    const attempt = Object.freeze({ ...prepared, type: "task", projectPath });
    this.attempts.set(attempt, { ownsDirectory: false, attempted: false });
    return attempt;
  }

  save(attempt) {
    return this.editor.enqueue(() => this.editor.withLock("task-material-transfer", async () => {
      const state = this.attempts.get(attempt);
      if (!state) throw new NoteWriteError("INVALID_ATTEMPT", "创建请求已失效，请重新填写。");
      const io = this.editor.io;
      const absolute = path.join(this.vault.adapter.getBasePath(), attempt.directory);
      try {
        if (attempt.projectPath) {
          const { ProjectArchive } = require("./shared.js");
          const pending = await new ProjectArchive(this.vault.adapter.getBasePath()).pending(attempt.projectPath);
          if (pending) throw new NoteWriteError("TRANSFER_PENDING", `项目有未完成的移动，请先核对：${pending.recoveryPath}`);
          const project = this.describe(await this.reader.read(attempt.projectPath));
          if (project?.type !== "project" || project.archived || project.legacy) throw new NoteWriteError("INVALID_PROJECT", "项目归属已变化、已存档或尚未迁移，本次未创建任务。");
        }
        await this.editor.ensureDirectories(path.posix.dirname(attempt.directory));
        if (!state.ownsDirectory) { await io.mkdir(absolute); state.ownsDirectory = true; }
        const stat = await io.lstat(absolute);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new NoteWriteError("INVALID_DIRECTORY", `目标不是普通目录：${attempt.directory}`);
        if (state.attempted) {
          try {
            const fileStat = await io.lstat(path.join(this.vault.adapter.getBasePath(), attempt.path));
            if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw new NoteWriteError("PATH_CONFLICT", `目标已变化，未覆盖：${attempt.path}`);
            if (await io.readFile(path.join(this.vault.adapter.getBasePath(), attempt.path), "utf8") === attempt.document) return { path: attempt.path };
            throw new NoteWriteError("PATH_CONFLICT", `目标已留下不同内容，未覆盖。请检查：${attempt.path}`);
          } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        state.attempted = true;
        return await this.editor.exclusiveFile(attempt.path, attempt.document);
      } catch (error) {
        if (error instanceof NoteWriteError) throw error;
        if (error.code === "EEXIST") throw new NoteWriteError("PATH_CONFLICT", `同位置已存在目录或笔记，未覆盖：${attempt.directory}`);
        throw new NoteWriteError("WRITE_FAILED", `创建未确认，输入已保留，请检查：${attempt.path}`);
      }
    }));
  }

  async update(note, values) {
    const item = this.describe(note);
    if (!item) throw new NoteWriteError("INVALID_WORK_ITEM", "不是可更新的项目或任务说明。");
    if (item.archived) throw new NoteWriteError("ARCHIVED_PROJECT", "请先恢复项目，再推进项目或任务。");
    if (!Object.hasOwn(WORK_STATES, values.status)) throw new NoteWriteError("INVALID_STATUS", "请选择有效的业务状态。");
    const fields = { status: values.status };
    if (item.type === "task") {
      for (const key of ["progress", "next_step"]) {
        if (typeof values[key] !== "string") throw new NoteWriteError("INVALID_FIELD", "进度与下一步必须为文字。");
        fields[key] = values[key];
      }
    }
    return this.editor.update(note.path, note.content, { fields });
  }

  async relocate(note, action) {
    const { execute, ProjectArchive } = require("./shared.js");
    if (!["archive", "restore"].includes(action)) throw new NoteWriteError("INVALID_ACTION", "请选择归档或恢复项目。");
    const key = `${action}\n${note.path}\n${note.content}`;
    if (!this.relocations.has(key)) this.relocations.set(key, randomUUID());
    const requestId = this.relocations.get(key);
    const root = this.vault.adapter.getBasePath();
    const pending = await new ProjectArchive(root).pending(note.path);
    if (pending && pending.input.action !== `${action}-project`) throw new NoteWriteError("TRANSFER_PENDING", `已有未完成的项目移动，请先核对：${pending.recoveryPath}`);
    const result = await execute(root, pending?.input || { action: `${action}-project`, path: note.path, expected: note.content, request_id: requestId, privacy: "ordinary" });
    if (this.relocations.get(key) === requestId) this.relocations.delete(key);
    return result;
  }

  async relocateMaterial(note, directory, action) {
    const { execute, MaterialArchive } = require("./shared.js");
    if (!["archive", "restore"].includes(action)) throw new NoteWriteError("INVALID_ACTION", "请选择归档或恢复。");
    const key = `${action}\n${directory}\n${note.path}\n${note.content}`;
    if (!this.relocations.has(key)) this.relocations.set(key, randomUUID());
    const requestId = this.relocations.get(key);
    const root = this.vault.adapter.getBasePath(), pending = await new MaterialArchive(root).pending(note.path);
    if (pending && (pending.input.action !== `${action}-material` || pending.input.directory !== directory)) throw new NoteWriteError("TRANSFER_PENDING", `已有未完成的目录移动，请先核对：${pending.recoveryPath}`);
    const result = await execute(root, pending?.input || { action: `${action}-material`, path: note.path, directory, expected: note.content, request_id: requestId, privacy: "ordinary" });
    if (this.relocations.get(key) === requestId) this.relocations.delete(key);
    return result;
  }

  uses(note) { return outputUses(documentParts(note.content, this.editor.parseYaml).fields); }

  async saveUse(note, input) {
    if (!input || typeof input.id !== "string" || !input.id || typeof input.title !== "string" || !input.title.trim()) throw new NoteWriteError("REQUIRED", "请填写这项用途的名称。");
    if (!Object.hasOwn(USE_STATES, input.status)) throw new NoteWriteError("INVALID_USE_STATUS", "请选择有效的用途状态。");
    if (USE_FIELDS.some(key => typeof input[key] !== "string")) throw new NoteWriteError("INVALID_USE", "用途记录各项内容必须为文字。");
    if (input.status === "used" && !input.version.trim()) throw new NoteWriteError("VERSION_REQUIRED", "已使用的记录需要填写实际采用的版本或历史交付位置。");
    const uses = this.uses(note).map(use => ({ ...use }));
    const index = uses.findIndex(use => use.id === input.id);
    const record = { ...(index < 0 ? {} : uses[index]), id: input.id, ...Object.fromEntries(USE_FIELDS.map(key => [key, input[key]])) };
    if (index < 0) uses.push(record); else uses[index] = record;
    return this.editor.update(note.path, note.content, { fields: { output_uses: uses } });
  }
}

module.exports = { WorkStore, WORK_STATES, USE_STATES, USE_FIELDS, outputUses, segment, projectDirectory, workMetadata, workVisible };
