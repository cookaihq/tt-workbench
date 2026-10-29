"use strict";
const path = require("node:path"), { randomUUID } = require("node:crypto");
const { VaultFiles, hash } = require("./files.js");
const { VaultError } = require("./errors.js");
const { ROOTS, isBusinessPath, isInboxPath, assertNewPath } = require("./paths.js");
const { localCreation } = require("./time.js");
const { documentParts, newDocument, parseYaml, getFrontMatterInfo } = require("./document.js");
const { inboxMetadata } = require("./catalog.js");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function folderTitle(title) {
  const cleaned = title.replace(/[\u0000-\u001f<>:"/\\|?*#\[\]^]/g, " ").replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "");
  return Array.from(cleaned || "随手记").slice(0, 40).join("");
}
class InboxStore {
  constructor(root, { io, now = () => new Date(), newId = randomUUID, assertRoot = () => {}, withLock } = {}) {
    this.files = new VaultFiles(root, { io }); this.io = this.files.io; this.root = this.files.root;
    this.now = now; this.newId = newId; this.assertRoot = assertRoot; this.attempts = new WeakMap();
    this.parseYaml = parseYaml; this.getFrontMatterInfo = getFrontMatterInfo;
    this.lock = withLock || (action => this.files.withLock("inbox:create", action));
    this.queue = Promise.resolve();
  }
  prepare({ content, title = "", sources = "", captureEntry = "workbench", timezone = "", requestId = "", requestHash = "" }) {
    this.assertRoot();
    if (typeof content !== "string" || !content.trim()) throw new VaultError("EMPTY_INPUT", "先写下一句话或一个链接，再保存。");
    if (typeof title !== "string" || typeof sources !== "string") throw new VaultError("INVALID_INPUT", "标题与来源应为文字。");
    const sourceUrls = sources.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    for (const value of sourceUrls) {
      try { if (!["http:", "https:"].includes(new URL(value).protocol)) throw Error(); }
      catch { throw new VaultError("INVALID_SOURCE", "来源请使用完整的 http 或 https 地址；其他出处可写在正文。"); }
    }
    const name = title.trim() || Array.from(content.trim().split(/\r?\n/)[0]).slice(0, 60).join("");
    const id = requestId || this.newId(); if (!UUID.test(id)) throw new VaultError("INVALID_ID", "请求标识必须为 UUID。");
    const created = localCreation(this.now(), timezone);
    const directory = `${ROOTS.inbox}/${created.created.slice(0, 7)}/${folderTitle(name)}`;
    const fields = { type: "inbox", inbox_status: "pending", ...created, title: name, id, capture_entry: captureEntry,
      request_hash: requestHash || hash(JSON.stringify({ content, title, sources, captureEntry, timezone })) };
    if (sourceUrls.length) fields.source_urls = sourceUrls;
    const attempt = Object.freeze({ path: `${directory}/记录.md`, directory, id, document: newDocument(fields, content), fields });
    this.attempts.set(attempt, { directory, attempted: false, owned: false }); return attempt;
  }
  describe(content, notePath) {
    if (!isInboxPath(notePath)) return null;
    try {
      const p = documentParts(content); if (p.fields.type && p.fields.type !== "inbox") return null;
      return { ...inboxMetadata(p.fields, true), body: p.body };
    } catch {
      const metadata = inboxMetadata(null, true); metadata.warnings.unshift("YAML 属性无法解析，以下保留完整原文。");
      return { ...metadata, body: content, invalidYaml: true };
    }
  }
  async findId(relative, id, skipDirectory = "") {
    const base = await this.files.safe(relative, { directory: true });
    for (const name of await this.io.readdir(base)) {
      if (name.startsWith(".") || ["tmp", "node_modules"].includes(name.toLowerCase())) continue;
      const child = `${relative}/${name}`; if (child === skipDirectory) continue;
      const stat = await this.io.lstat(path.join(base, name)); if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { const found = await this.findId(child, id, skipDirectory); if (found) return found; }
      else if (stat.isFile() && isBusinessPath(child)) {
        try { const raw = await this.io.readFile(path.join(base, name), "utf8"); if (documentParts(raw).fields.id === id) return { path: child, raw }; }
        catch (e) { if (e.code !== "INVALID_YAML") throw e; }
      }
    }
    return null;
  }
  save(attempt) {
    const operation = this.queue.then(() => this.lock(() => this.saveAttempt(attempt)));
    this.queue = operation.catch(() => {}); return operation;
  }
  async saveAttempt(attempt) {
    this.assertRoot(); const state = this.attempts.get(attempt);
    if (!state) throw new VaultError("INVALID_ATTEMPT", "保存请求已失效，请重新提交。");
    try {
      const planPath = `${this.files.runtime}/inbox/${attempt.id}.json`;
      let plan;
      try { plan = JSON.parse(await this.io.readFile(await this.files.safe(planPath), "utf8")); }
      catch (e) { if (e.code !== "ENOENT") throw new VaultError("PARTIAL_WRITE", "先前保存的目录记录无法读取，未另外创建记录。", { recoveryPath: planPath }); }
      if (plan) {
        if (plan.requestHash !== attempt.fields.request_hash) throw new VaultError("ID_CONFLICT", `同一标识已有不同输入：${plan.directory}/记录.md`, { path: `${plan.directory}/记录.md` });
        state.directory = plan.directory; state.document = plan.document; state.owned = true; state.attempted = true;
      }
      await this.files.ensureDirectories(ROOTS.inbox);
      const previous = await this.findId(ROOTS.inbox, attempt.id, state.owned ? state.directory : "");
      if (previous) {
        const old = documentParts(previous.raw), wanted = documentParts(attempt.document);
        if (old.fields.request_hash === wanted.fields.request_hash && old.body === wanted.body) return { path: previous.path, reused: true };
        throw new VaultError("ID_CONFLICT", `记录标识已存在，未覆盖或合并：${previous.path}`, { path: previous.path });
      }
      await this.files.ensureDirectories(path.posix.dirname(attempt.directory));
      if (!state.owned) {
        for (let i = 1; ; i++) {
          state.directory = attempt.directory + (i === 1 ? "" : ` (${i})`);
          try { await this.io.mkdir(path.join(this.root, state.directory)); state.owned = true; break; }
          catch (e) { if (e.code !== "EEXIST") throw e; }
        }
      }
      const target = `${state.directory}/记录.md`;
      await this.files.safe(state.directory, { directory: true });
      if (!plan) {
        // Persist the selected directory before any business content is written.
        // A restarted process must inspect this same target, including partial files.
        state.document = attempt.document;
        await this.files.exclusiveFile(planPath, JSON.stringify({ directory: state.directory, requestHash: attempt.fields.request_hash, document: state.document }));
      }
      if (state.attempted) {
        try {
          if (await this.files.read(target) === state.document) return { path: target, reused: true };
          throw new VaultError("PARTIAL_WRITE", `目标已留下不同或不完整内容，未覆盖：${target}`, { path: target });
        } catch (e) { if (e.code !== "ENOENT") throw e; }
      }
      assertNewPath(target);
      state.attempted = true; return await this.files.exclusiveFile(target, state.document);
    } catch (e) {
      if (e instanceof VaultError) throw e;
      const code = ["EACCES", "EPERM", "EROFS"].includes(e.code) ? "PERMISSION" : e.code === "ENOSPC" ? "NO_SPACE" : e.code === "EEXIST" ? "PATH_CONFLICT" : "WRITE_FAILED";
      throw new VaultError(code, `保存未确认，请保留输入并核对：${state.directory}/记录.md`, { path: `${state.directory}/记录.md`, reason: e.message });
    }
  }
}
module.exports = { InboxStore, UUID, folderTitle };
