"use strict";
const { ROOTS } = require("./vault-paths.js");
const http = require("node:http"), fs = require("node:fs/promises"), path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { NoteWriteError, documentParts } = require("./note-editor.js");
const { localCreation } = require("./inbox.js");
const { businessPath } = require("./note-reader.js");
const hash = value => createHash("sha256").update(value).digest("hex");

class AgentBridge {
  constructor(plugin) { this.plugin = plugin; this.requests = new Map(); }
  async start() {
    const p = this.plugin, fns = p.app.plugins.plugins["fast-note-sync"];
    const rules = JSON.parse(fns?.settings?.syncExcludeFolders || "[]");
    if (!rules.some(r => r.pattern === "apps/workbench/data/")) throw Error("Agent 保存入口未启动：请先排除 apps/workbench/data/ 的 FNS 同步。");
    const directory = path.join(p.app.vault.adapter.getBasePath(), "apps/workbench/data");
    for (const relative of ["apps", "apps/workbench"]) if ((await fs.lstat(path.join(p.app.vault.adapter.getBasePath(), relative))).isSymbolicLink()) throw Error("运行数据路径不能包含符号链接。");
    await fs.mkdir(directory, { recursive: true });
    if ((await fs.lstat(directory)).isSymbolicLink()) throw Error("运行数据目录不能是符号链接。");
    this.location = path.join(directory, "agent-bridge.json");
    try { if ((await fs.lstat(this.location)).isSymbolicLink()) throw Error("连接信息不能是符号链接。"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    this.token = randomBytes(32).toString("hex");
    this.server = http.createServer((req, res) => { void this.handle(req, res); });
    await new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen(0, "127.0.0.1", resolve); });
    try {
      await fs.writeFile(this.location, JSON.stringify({ port: this.server.address().port, token: this.token, vault: p.app.vault.adapter.getBasePath(), pid: process.pid }), { mode: 0o600 });
      await fs.chmod(this.location, 0o600);
    } catch (e) { this.server.close(); throw e; }
  }
  async stop() {
    this.server?.close();
    if (this.location) try { const value = JSON.parse(await fs.readFile(this.location, "utf8")); if (value.token === this.token) await fs.unlink(this.location); } catch {}
  }
  async handle(req, res) {
    const respond = (status, value) => { if (!res.destroyed) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); } };
    if (req.method !== "POST" || req.url !== "/request" || req.headers.origin || req.headers.authorization !== `Bearer ${this.token}` || req.headers["content-type"] !== "application/json") { req.resume(); respond(403, { ok: false, code: "FORBIDDEN" }); return; }
    try {
      req.setEncoding("utf8");
      let body = ""; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 12 * 1024 * 1024) throw new NoteWriteError("TOO_LARGE", "此 HTTP 入口单次请求超过 12 MiB；本机原文件可通过 scripts/vault/write.mjs 直接复制。"); }
      const input = JSON.parse(body), readOnly = ["info", "read"].includes(input.action);
      if (!readOnly && input.privacy !== "ordinary") throw new NoteWriteError("PRIVACY_REVIEW", "请先判断内容是否适合当前库；疑似私密内容只提醒，等待本人处置指令。");
      if (!readOnly && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.request_id || "")) throw new NoteWriteError("REQUEST_ID", "写入请求需要 UUID request_id，重试时保留同一值。");
      const signature = hash(JSON.stringify(input)); let pending = this.requests.get(input.request_id);
      if (pending && pending.signature !== signature) throw new NoteWriteError("REQUEST_CHANGED", "同一请求标识不能用于不同内容。");
      if (!pending || readOnly) {
        pending = { signature, result: this.execute(input, signature) };
        if (!readOnly) { this.requests.set(input.request_id, pending); pending.result.catch(() => { if (this.requests.get(input.request_id) === pending) this.requests.delete(input.request_id); }); }
      }
      respond(200, { ok: true, ...(await pending.result) });
    } catch (e) { respond(400, { ok: false, code: e.code || "REQUEST_FAILED", message: e instanceof SyntaxError ? "请求不是有效 JSON。" : e.message, conflictPath: e.conflictPath, attachmentPath: e.attachmentPath }); }
  }
  async execute(input, signature) {
    const p = this.plugin;
    p.reader.assertVault();
    if (input.action === "info") return { vault: p.app.vault.adapter.getBasePath(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, notes: p.reader.list() };
    if (input.action === "read") { const note = await p.reader.read(input.path); return { ...note, sha256: hash(note.content) }; }
    if (input.action === "attach") return p.attachments.save(input);
    const sections = text => `${text || ""}${input.ai_summary ? `\n\n## AI 归纳\n\n${input.ai_summary}` : ""}${input.judgment ? `\n\n## 本人判断\n\n${input.judgment}` : ""}`;
    if (input.action === "capture") {
      const previous = p.reader.list().find(f => p.app.metadataCache.getCache(f.path)?.frontmatter?.id === input.request_id);
      if (previous) {
        const note = await p.reader.read(previous.path), fields = documentParts(note.content, p.editor.parseYaml).fields;
        if (fields.request_hash !== signature) throw new NoteWriteError("REQUEST_CHANGED", `这个标识已用于另一份记录：${previous.path}`);
        return { path: previous.path, saved: true, reused: true };
      }
      const request = p.inbox.prepare({ content: sections(input.content), title: input.title, sources: input.sources, timezone: input.timezone, captureEntry: "agent", requestId: input.request_id, requestHash: signature });
      return { ...(await p.inbox.save(request)), saved: true };
    }
    if (input.action === "create-note") {
      const target = businessPath(input.path), parent = path.posix.dirname(target);
      if (parent === "." || !p.app.vault.getAbstractFileByPath(parent)) throw new NoteWriteError("INVALID_PARENT", "请指定已有课程、项目、任务或业务目录中的笔记位置。");
      if (typeof input.content !== "string" || !input.content.trim()) throw new NoteWriteError("EMPTY_INPUT", "正文不能为空。");
      await p.editor.ensureDirectories(parent);
      const fields = { type: "note", ...localCreation(new Date(), input.timezone), request_id: input.request_id };
      const document = `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n${sections(input.content)}`;
      return { ...(await p.editor.exclusiveFile(target, document)), saved: true };
    }
    const note = await p.reader.read(input.path);
    if (typeof input.expected !== "string") throw new NoteWriteError("EXPECTED_REQUIRED", "更新前先读取原笔记，并将读取的完整 content 作为 expected 提交。");
    const expected = { ...note, content: input.expected };
    let saved;
    if (input.action === "append") saved = await p.editor.update(input.path, input.expected, { append: sections(input.content) });
    else if (input.action === "review") {
      if (!input.path.startsWith(`${ROOTS.inbox}/`) || documentParts(input.expected, p.editor.parseYaml).fields.type !== "inbox" || !["pending", "reviewed"].includes(input.status)) throw new NoteWriteError("INVALID_STATUS", "只支持更新明确收件箱记录的整理状态。");
      saved = await p.editor.update(input.path, input.expected, { fields: { inbox_status: input.status } });
    } else if (input.action === "work-update") saved = await p.work.update(expected, input);
    else throw new NoteWriteError("UNKNOWN_ACTION", "不支持这个保存操作。");
    return { path: saved.path, saved: true, sha256: hash(saved.content) };
  }
}
module.exports = { AgentBridge };
