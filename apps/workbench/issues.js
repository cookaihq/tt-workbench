"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { IssueError, parseIssue, linesOf, PRIORITIES, TRIAGE, patchFields, appendSection } = require("./issue-format.js");
const hash = value => createHash("sha256").update(value).digest("hex");
const runtimeStorage = require('./shared.js').runtimeStorage;

function cleanInput(input) {
  if (!segment(input.feature) || typeof input.title !== "string" || !input.title.trim() || /[\r\n]/.test(input.title) || typeof input.description !== "string") throw new IssueError("INVALID_INPUT", "请填写合法的功能名称、单行标题和 Markdown 描述。");
  if (linesOf(input.description).some(l => !l.code && /^## (Comments|Activity)\s*$/.test(l.text))) throw new IssueError("INVALID_INPUT", "Comments 和 Activity 由评论及历史操作维护，请勿放入描述编辑区。");
  if (linesOf(input.description + "\nEND").at(-1)?.code) throw new IssueError("INVALID_INPUT", "请先闭合 Markdown 代码块后再保存。");
  const labels = input.labels || [], priority = input.priority || "";
  if (!Array.isArray(labels) || !labels.every(v => typeof v === "string" && v.trim() && !/[\r\n]/.test(v)) || !Object.hasOwn(PRIORITIES, priority)) throw new IssueError("INVALID_INPUT", "标签或优先级无效。");
  return { feature: input.feature, title: input.title.trim(), description: input.description, labels: [...new Set(labels.map(v => v.trim()))], priority };
}

function segment(value) { return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 120 && !/[\\/:*?"<>|\u0000-\u001f]/.test(value) && !value.startsWith(".") && !/[ .]$/.test(value); }
function issuePath(value) {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts.length === 4 && parts[0] === ".scratch" && segment(parts[1]) && parts[2] === "issues" && /^\d{2,}-[^/]+\.md$/.test(parts[3]) && segment(parts[3]) && !value.includes("-保存冲突-");
}
function documentPath(value) {
  return typeof value === "string" && (issuePath(value) || /^\.scratch\/[^/]+\/(spec|map|ticket-plan|backlog)\.md$/.test(value) || /^docs\/(workbench|rules|adr)\/.+\.(md|json)$/.test(value))
    && value.split("/").every((s, i) => i === 0 && s === ".scratch" || segment(s));
}

class IssueStore {
  constructor(root, { io = fs } = {}) { this.root = path.resolve(root); this.io = io; this.queue = Promise.resolve(); }
  async safe(relative, { directory = false, create = false } = {}) {
    if (relative.startsWith("/") || relative.split("/").some((s, i) => !(i === 0 && s === ".scratch") && !segment(s))) throw new IssueError("OUT_OF_SCOPE", "路径不在当前库允许的 Issue 范围内。");
    let target = this.root;
    const parts = relative.split("/");
    for (let i = 0; i < parts.length; i++) {
      target = path.join(target, parts[i]);
      const isDir = i < parts.length - 1 || directory;
      if (create && isDir) { try { await this.io.mkdir(target); } catch (e) { if (e.code !== "EEXIST") throw e; } }
      const stat = await this.io.lstat(target);
      if (stat.isSymbolicLink() || (isDir ? !stat.isDirectory() : !stat.isFile())) throw new IssueError("INVALID_PATH", "只访问当前库内的普通文件和目录，不沿符号链接访问。");
    }
    return target;
  }
  async read(relative) {
    if (!documentPath(relative)) throw new IssueError("OUT_OF_SCOPE", "只能读取 Issue、功能规格或允许的开发说明。");
    const file = await this.safe(relative);
    const content = await this.io.readFile(file, "utf8");
    if (issuePath(relative)) return { ...parseIssue(content, relative), mtime: (await this.io.stat(file)).mtimeMs, kind: "issue" };
    return { path: relative, content, title: linesOf(content).find(l => !l.code && /^# /.test(l.text))?.text.slice(2) || relative.split("/").at(-1), kind: "document" };
  }
  async list() {
    const issues = [], groups = [], errors = [];
    let scratch;
    try { scratch = await this.safe(".scratch", { directory: true }); } catch (e) { if (e.code === "ENOENT") return { issues, groups, errors }; throw e; }
    for (const feature of (await this.io.readdir(scratch)).sort()) {
      if (!segment(feature)) continue;
      try {
        await this.safe(`.scratch/${feature}`, { directory: true });
        const group = { feature, title: feature, spec: "", count: 0 };
        try { const spec = await this.read(`.scratch/${feature}/spec.md`); group.title = spec.title; group.spec = spec.path; } catch (e) { if (e.code !== "ENOENT") errors.push(`${feature} 规格：${e.message}`); }
        let names = [];
        try { names = await this.io.readdir(await this.safe(`.scratch/${feature}/issues`, { directory: true })); } catch (e) { if (e.code !== "ENOENT") throw e; }
        for (const name of names.sort()) {
          const relative = `.scratch/${feature}/issues/${name}`;
          if (!issuePath(relative)) continue;
          try { issues.push(await this.read(relative)); group.count++; } catch (e) { errors.push(`${relative}：${e.message}`); }
        }
        if (group.spec || names.length) groups.push(group);
      } catch (e) { if (e.code !== "ENOTDIR") errors.push(`${feature}：${e.message}`); }
    }
    const refs = new Map();
    for (const issue of issues) { if (refs.has(issue.ref)) { issue.errors.push("功能内编号重复，请先核对文件。"); refs.get(issue.ref).errors.push("功能内编号重复，请先核对文件。"); } else refs.set(issue.ref, issue); }
    for (const issue of issues) issue.blocked = issue.blockedBy.filter(ref => refs.get(ref)?.state !== "completed");
    return { issues, groups, errors };
  }

  async withLock(operation) {
    const run = () => runtimeStorage.withRuntime(this.root, async () => {
      const runtime = await runtimeStorage.plain(this.root, runtimeStorage.relative('issues', this.root), { mkdir: true, io: this.io });
      const lock = path.join(runtime, "write.lock"), token = randomUUID();
      const until = Date.now() + 3000; let handle;
      while (!handle) {
        try { handle = await this.io.open(lock, "wx", 0o600); }
        catch (e) {
          if (e.code !== "EEXIST") throw e;
          if (Date.now() >= until) throw new IssueError("BUSY", `另一个 Issue 保存尚未结束。请核对 ${runtime}/write.lock 中的进程记录。`);
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      }
      try {
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, created: new Date().toISOString() }));
        await handle.sync(); await handle.close(); handle = null;
        return await operation(runtime);
      } finally {
        if (handle) await handle.close();
        // Only remove our own transient lock; recoverable operation records are retained.
        try { if (JSON.parse(await this.io.readFile(lock, "utf8")).token === token) await this.io.unlink(lock); } catch {}
      }
    }, this.io);
    const next = this.queue.then(run); this.queue = next.catch(() => {}); return next;
  }

  async exclusive(file, content) {
    const handle = await this.io.open(file, "wx", 0o600);
    try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
  }

  async create(input) {
    const value = cleanInput(input), id = input.id || randomUUID();
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) throw new IssueError("INVALID_INPUT", "创建标识不是有效 UUID。");
    const inputHash = hash(JSON.stringify(value));
    return this.withLock(async () => {
      const directory = `.scratch/${value.feature}/issues`;
      await this.safe(directory, { directory: true, create: true });
      const catalog = await this.list();
      const existing = catalog.issues.find(i => i.fields.ID === id);
      if (existing) {
        if (existing.fields["Input hash"] !== inputHash) throw new IssueError("CREATION_CHANGED", `此创建请求已经保存为 ${existing.ref}，请先打开它，再编辑或新建另一条。`);
        return existing;
      }
      if (catalog.errors.length || catalog.issues.some(i => i.feature === value.feature && i.errors.length)) throw new IssueError("CATALOG_INVALID", "存在不可读或格式错误的 Issue，请先核对后再分配编号。\n" + catalog.errors.join("\n"));
      const number = Math.max(0, ...catalog.issues.filter(i => i.feature === value.feature).map(i => i.number)) + 1;
      const slug = value.title.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, "-").replace(/^[. -]+|[. -]+$/g, "").slice(0, 65) || "issue";
      const relative = `${directory}/${String(number).padStart(2, "0")}-${slug}.md`;
      const now = new Date().toISOString();
      const content = `Status: needs-triage\nState: open\nID: ${id}\nInput hash: ${inputHash}\nCreated: ${now}\nUpdated: ${now}\nLabels: ${JSON.stringify(value.labels)}\nPriority: ${value.priority}\nBlocked by: []\nRelated: []\n\n# ${value.title}\n\n${value.description.trim()}\n\n## Comments\n\n## Activity\n\n- ${now} · ${this.actor(input.actor)}：创建 Issue。\n`;
      await this.exclusive(path.join(this.root, relative), content);
      const saved = await this.read(relative);
      if (saved.content !== content) throw new IssueError("CONFLICT", `创建后文件发生变化，请打开 ${relative} 核对。`, { path: relative });
      return saved;
    });
  }

  actor(value = "本人") {
    if (typeof value !== "string" || !value.trim() || /[\r\n<>]/.test(value) || value.length > 100) throw new IssueError("INVALID_INPUT", "操作者名称无效。");
    return value.trim();
  }

  comment(body, meta) {
    if (typeof body !== "string" || !body.trim() || /<!--\s*\/?tannt-comment/.test(body)) throw new IssueError("INVALID_INPUT", "请填写评论；评论中不能包含保留的 tannt-comment 标记。");
    if (linesOf(body + "\nEND").at(-1)?.code) throw new IssueError("INVALID_INPUT", "请先闭合评论中的代码块。");
    return `<!-- tannt-comment:${JSON.stringify(meta)} -->\n${body.trim()}\n<!-- /tannt-comment -->`;
  }

  async update(relative, expected, input) {
    if (!issuePath(relative) || typeof expected !== "string") throw new IssueError("OUT_OF_SCOPE", "更新前必须读取当前 Issue，并提供完整原文。");
    const note = parseIssue(expected, relative), actor = this.actor(input.actor);
    if (note.errors.length) throw new IssueError("INVALID_FORMAT", note.errors.join("\n"));
    const eol = expected.includes("\r\n") ? "\r\n" : "\n", now = new Date().toISOString();
    let proposed = expected, event, relations = null;
    const conclusion = input.conclusion || "";
    if (typeof conclusion !== "string") throw new IssueError("INVALID_INPUT", "结论必须是文本。");
    if (note.wayfinding && ["close", "reopen", "initialize"].includes(input.action)) throw new IssueError("WAYFINDING", "此记录使用 claimed／resolved 决策流程，请按 issue tracker 规则更新。");
    if (input.action === "edit") {
      const value = cleanInput({ feature: note.feature, title: input.title, description: input.description });
      proposed = expected.slice(0, note.titleLine.start) + `# ${value.title}${eol}` + value.description.replace(/\r?\n/g, eol) + expected.slice(note.bodyEnd);
      // Keep a blank line before managed sections even when the editor trims trailing space.
      if (note.bodyEnd < expected.length && !value.description.endsWith("\n\n") && !value.description.endsWith("\r\n\r\n")) proposed = expected.slice(0, note.titleLine.start) + `# ${value.title}${eol}${eol}` + value.description.trim() + eol + eol + expected.slice(note.bodyEnd);
      event = "编辑标题或描述";
    } else if (input.action === "check") {
      const check = note.checks[input.index];
      if (!check || typeof input.done !== "boolean") throw new IssueError("INVALID_INPUT", "验收项已改变，请重新读取。");
      proposed = expected.slice(0, check.offset) + (input.done ? "x" : " ") + expected.slice(check.offset + 1);
      event = `${input.done ? "勾选" : "取消勾选"}验收项：${check.label}`;
    } else if (input.action === "comment") {
      proposed = appendSection(expected, relative, "Comments", this.comment(input.body, { id: randomUUID(), author: actor, created: now }));
      event = "添加评论";
    } else if (input.action === "edit-comment") {
      const comment = note.comments.find(c => c.id === input.id);
      if (!comment) throw new IssueError("INVALID_INPUT", "找不到这条可编辑评论，请重新读取。");
      const block = this.comment(input.body, { id: comment.id, author: comment.author, created: comment.created, updated: now }).replace(/\r?\n/g, eol);
      proposed = expected.slice(0, comment.start) + block + eol + expected.slice(comment.end);
      event = `编辑评论 ${comment.id}`;
    } else if (input.action === "metadata") {
      const values = {};
      if (Object.hasOwn(input, "triage")) {
        if (note.wayfinding || !Object.hasOwn(TRIAGE, input.triage)) throw new IssueError("INVALID_INPUT", "请选择普通实施 Issue 的分诊结果。");
        values.Status = input.triage;
      }
      if (Object.hasOwn(input, "labels")) values.Labels = JSON.stringify(cleanInput({ feature: note.feature, title: note.title, description: "", labels: input.labels }).labels);
      if (Object.hasOwn(input, "priority")) {
        if (!Object.hasOwn(PRIORITIES, input.priority)) throw new IssueError("INVALID_INPUT", "优先级无效。");
        values.Priority = input.priority;
      }
      for (const [name, key] of [["blockedBy", "Blocked by"], ["related", "Related"]]) if (Object.hasOwn(input, name)) {
        if (name === "blockedBy" && note.wayfinding) throw new IssueError("WAYFINDING", "决策任务依赖仍按 issue tracker 的编号格式维护。");
        if (!Array.isArray(input[name]) || !input[name].every(s => typeof s === "string" && s.trim() === s)) throw new IssueError("INVALID_INPUT", "关联必须是有效标识数组。");
        values[key] = JSON.stringify([...new Set(input[name])]);
      }
      proposed = patchFields(expected, relative, values);
      const labels = { Status: "分诊", Labels: "标签", Priority: "优先级", "Blocked by": "依赖", Related: "关联" };
      relations = input; event = "更新属性：" + Object.entries(values).map(([k, v]) => `${labels[k]}=${k === "Status" ? TRIAGE[v] : k === "Priority" ? PRIORITIES[v] : v}`).join("；");
    } else if (["close", "reopen", "initialize"].includes(input.action)) {
      const state = input.action === "reopen" ? "open" : input.resolution;
      if (!["open", "completed", "not-planned"].includes(state) || input.action === "close" && state === "open") throw new IssueError("INVALID_INPUT", "请选择已完成或不计划实施。");
      if (input.duplicateOf && state !== "not-planned") throw new IssueError("INVALID_INPUT", "标记重复时请选择不计划实施。");
      proposed = patchFields(expected, relative, { State: state, "Duplicate of": input.duplicateOf || null, ...(note.triage === "wontfix" ? { Status: null } : {}) });
      if (input.duplicateOf) relations = { duplicateOf: input.duplicateOf };
      event = input.action === "initialize" ? `依据验收记录登记状态：${state}` : input.action === "reopen" ? "重新打开 Issue" : `关闭 Issue（${state === "completed" ? "已完成" : "不计划实施"}）`;
    } else throw new IssueError("INVALID_ACTION", "不支持的 Issue 操作。");
    if (input.duplicateOf) event += `；重复目标 ${input.duplicateOf}`;
    if (conclusion.trim()) proposed = appendSection(proposed, relative, "Comments", this.comment(conclusion, { id: randomUUID(), author: actor, created: now }));
    proposed = patchFields(proposed, relative, { Updated: now });
    proposed = appendSection(proposed, relative, "Activity", `- ${now} · ${actor}：${event}${conclusion.trim() ? `；${conclusion.trim().replace(/\s+/g, " ")}` : ""}。`);
    return this.save(relative, expected, proposed, { actor, action: input.action }, relations ? () => this.validateRelations(note, relations) : null);
  }

  async validateRelations(note, input) {
    const catalog = await this.list(), refs = new Map(catalog.issues.map(i => [i.ref, i]));
    const lookup = ref => {
      const matches = catalog.issues.filter(i => i.ref === ref);
      if (matches.length !== 1 || matches[0].errors.length) throw new IssueError("INVALID_REFERENCE", `关联目标不存在、编号不唯一或格式错误：${ref}`);
      if (ref === note.ref) throw new IssueError("DEPENDENCY_CYCLE", "不能把 Issue 关联为自己的前置或重复目标。");
      return matches[0];
    };
    if (input.duplicateOf) lookup(input.duplicateOf);
    for (const target of input.related || []) { if (!documentPath(target)) throw new IssueError("OUT_OF_SCOPE", "关联目标不在允许的开发文档范围。"); await this.read(target); }
    if (input.blockedBy) {
      for (const ref of input.blockedBy) lookup(ref);
      const visited = new Set();
      const visit = ref => {
        if (ref === note.ref) throw new IssueError("DEPENDENCY_CYCLE", "这次修改会形成循环依赖，未保存。");
        if (visited.has(ref)) return; visited.add(ref);
        for (const parent of refs.get(ref)?.blockedBy || []) visit(parent);
      };
      for (const ref of input.blockedBy) visit(ref);
    }
  }

  async save(relative, expected, proposed, operation, validate = null) {
    return this.withLock(async runtime => {
      if (validate) await validate();
      const recovery = runtimeStorage.relative(`issues/operations/${randomUUID()}`, this.root);
      const directory = await runtimeStorage.plain(this.root, recovery, { mkdir: true, io: this.io });
      let current = "", status = "prepared";
      const record = { ...operation, path: relative, created: new Date().toISOString(), expectedHash: hash(expected), proposedHash: hash(proposed) };
      try {
        await this.exclusive(path.join(directory, "before.md"), expected);
        await this.exclusive(path.join(directory, "proposed.md"), proposed);
        await this.exclusive(path.join(directory, "operation.json"), JSON.stringify({ ...record, status }));
        const absolute = await this.safe(relative);
        current = await this.io.readFile(absolute, "utf8");
        if (current !== expected) throw new IssueError("CONFLICT", "原文件已被其他操作修改，本次没有覆盖。输入与原文已保留，请重新读取后核对。");
        const stage = path.join(directory, "write-stage.md");
        await this.exclusive(stage, proposed);
        // Recheck after staging; cooperative writers also hold write.lock. A third-party
        // writer ignoring the lock cannot be made transactional by a filesystem rename.
        await this.safe(relative);
        current = await this.io.readFile(absolute, "utf8");
        if (current !== expected) throw new IssueError("CONFLICT", "准备保存期间原文件发生变化，本次没有覆盖。");
        await this.io.rename(stage, absolute);
        current = await this.io.readFile(absolute, "utf8");
        if (current !== proposed) throw new IssueError("CONFLICT", "保存后文件又发生变化，请核对原文件及恢复记录。");
        status = "saved";
        await this.io.writeFile(path.join(directory, "operation.json"), JSON.stringify({ ...record, status }));
        return await this.read(relative);
      } catch (error) {
        try {
          await this.exclusive(path.join(directory, "observed.md"), current);
          await this.io.writeFile(path.join(directory, "operation.json"), JSON.stringify({ ...record, status: "unconfirmed", code: error.code || "WRITE_FAILED" }));
        } catch {}
        throw new IssueError(error.code === "CONFLICT" ? "CONFLICT" : "WRITE_FAILED", error instanceof IssueError ? error.message : "保存未确认，输入已保留。请核对文件后重试。", { recoveryPath: recovery, proposed });
      }
    });
  }
}

module.exports = { IssueStore, issuePath, documentPath, segment };
