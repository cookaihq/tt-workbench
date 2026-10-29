"use strict";
const path = require("node:path");
const { VaultFiles, hash } = require("./files.js");
const { VaultError } = require("./errors.js");
const { ROOTS, businessPath, isBusinessPath, isInboxPath, newBusinessPath } = require("./paths.js");
const { documentParts, patchFields } = require("./document.js");
const { workMetadata } = require("./work.js");
const { folderTitle, UUID } = require("./inbox.js");
const { attachmentPath, linkTo } = require("./attachments.js");
const { assertOrdinaryMove } = require("./move-safety.js");
const runtimeStorage = require('../runtime/storage.cjs');

async function exists(io, name) {
  try { return await io.lstat(name); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// Names of real local link targets, including read-only engineering documents.
// Callers still restrict document reads/edits with isBusinessPath. Never traverse
// hidden directories, runtime data, dependencies, temporary files, or symlinks.
async function inventory(files, relative = "") {
  const result = [];
  for (const entry of await files.io.readdir(path.join(files.root, relative), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["tmp", "node_modules"].includes(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (child === "apps/workbench/data" || child === runtimeStorage.relative('', files.root)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) result.push(...await inventory(files, child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

function resolveLink(raw, from, names, root) {
  const encoded = raw.replace(/\\([\[\]() ])/g, "$1"), split = encoded.indexOf("#");
  const suffix = split < 0 ? "" : encoded.slice(split);
  let value;
  try { value = decodeURIComponent(split < 0 ? encoded : encoded.slice(0, split)); } catch { return null; }
  if (!value || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (value.startsWith(root + "/")) value = value.slice(root.length + 1);
  if (value.startsWith("/")) return null;
  const candidates = [path.posix.normalize(path.posix.join(path.posix.dirname(from), value)), value];
  for (const candidate of candidates) {
    if (names.has(candidate)) return { target: candidate, suffix };
    if (names.has(candidate + ".md")) return { target: candidate + ".md", suffix };
  }
  if (!value.includes("/")) {
    const matches = [...names].filter(name => path.posix.basename(name) === value || path.posix.basename(name, ".md") === value);
    if (matches.length === 1) return { target: matches[0], suffix };
  }
  return null;
}

// Rewrites links, not quoted paths or historical code examples. Attachment originals
// are never passed here; only the captured note and referring business notes are.
function rewriteLinks(content, from, to, moves, names, root, references = new Set()) {
  const parts = documentParts(content);
  let fence = "";
  const resolve = raw => {
    const found = resolveLink(raw, from, names, root);
    if (found) references.add(found.target);
    return found;
  };
  const markdownTarget = raw => {
    const found = resolve(raw);
    if (!found) return null;
    const target = moves[found.target] || found.target;
    if (from === to && target === found.target) return null;
    // Obsidian keeps encoded reserved characters in cached link paths. A plus
    // is valid literally in a filename, so %2B would no longer resolve there.
    return path.posix.relative(path.posix.dirname(to), target).split("/").map(encodeURIComponent).join("/").replace(/%2B/g, "+") + found.suffix;
  };
  const body = parts.body.split(/(?<=\n)/).map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ""; return line; }
    if (fence) return line;
    return line.split(/(`+[^`\n]*`+)/g).map((chunk, i) => {
      if (i % 2) return chunk;
      let next = chunk.replace(/\[\[([^\]\n]+)\]\]/g, (all, raw) => {
        const [target, ...alias] = raw.split("|"); const found = resolve(target);
        if (!found || from === to && !moves[found.target]) return all;
        return `[[${moves[found.target] || found.target}${found.suffix}${alias.length ? "|" + alias.join("|") : ""}]]`;
      });
      next = next.replace(/(\]\()(<[^>\n]+>|[^\s()]+)(\s+(?:"[^"\n]*"|'[^'\n]*'))?(\))/g, (all, a, raw, title = "", end) => {
        const changed = markdownTarget(raw.startsWith("<") ? raw.slice(1, -1) : raw);
        return changed === null ? all : `${a}<${changed}>${title}${end}`;
      });
      return next.replace(/^(\s{0,3}\[[^\]\n]+\]:\s*)(<[^>\n]+>|\S+)(.*)$/, (all, prefix, raw, tail) => {
        const changed = markdownTarget(raw.startsWith("<") ? raw.slice(1, -1) : raw);
        return changed === null ? all : `${prefix}<${changed}>${tail}`;
      });
    }).join("");
  }).join("");
  let result = parts.prefix + body;
  if (Array.isArray(parts.fields.attachments)) {
    for (const name of parts.fields.attachments) references.add(name);
    const attachments = parts.fields.attachments.map(name => moves[name] || name);
    if (attachments.some((name, i) => name !== parts.fields.attachments[i])) result = patchFields(result, { attachments });
  }
  if (Array.isArray(parts.fields.related_work)) {
    const related_work = parts.fields.related_work.map(value => typeof value !== "string" ? value : value.replace(/\[\[([^\]\n]+)\]\]/g, (all, raw) => {
      const [target, ...alias] = raw.split("|"), found = resolve(target);
      return found && (moves[found.target] || from !== to) ? `[[${moves[found.target] || found.target}${found.suffix}${alias.length ? "|" + alias.join("|") : ""}]]` : all;
    }));
    if (related_work.some((value, i) => value !== parts.fields.related_work[i])) result = patchFields(result, { related_work });
  }
  if (Array.isArray(parts.fields.output_uses)) {
    const output_uses = parts.fields.output_uses.map(value => {
      if (!value || typeof value !== "object") return value;
      let updated = value;
      for (const key of ["artifact", "version"]) {
        if (typeof value[key] !== "string") continue;
        const wiki = /^\[\[([^\]|]+)(\|[^\]]*)?\]\]$/.exec(value[key]);
        // A prose version label such as "v1" is not a filename lookup.
        if (!wiki && !/[/.]/.test(value[key])) continue;
        const found = resolve(wiki ? wiki[1] : value[key]);
        if (!found || !moves[found.target] && from === to) continue;
        const target = moves[found.target] || found.target;
        updated = { ...updated, [key]: wiki ? `[[${target}${found.suffix}${wiki[2] || ""}]]` : `${target}${found.suffix}` };
      }
      return updated;
    });
    if (output_uses.some((value, i) => value !== parts.fields.output_uses[i])) result = patchFields(result, { output_uses });
  }
  return result;
}

class TaskTransfer {
  constructor(root, options) { this.files = new VaultFiles(root, options); this.io = this.files.io; }
  async bytes(relative) { return this.io.readFile(await this.files.safe(relative)); }
  async pending(source) {
    const directory = `${this.files.runtime}/transfers`;
    if (!(await exists(this.io, path.join(this.files.root, directory)))) return null;
    for (const name of await this.io.readdir(await this.files.safe(directory, { directory: true }))) {
      if (!UUID.test(name.replace(/\.json$/, "")) || !name.endsWith(".json")) continue;
      const record = JSON.parse(await this.io.readFile(await this.files.safe(`${directory}/${name}`), "utf8"));
      if (record.source === source && record.phase !== "complete") return { input: record.input, recoveryPath: `${directory}/${name}` };
    }
    return null;
  }

  async plan(input) {
    const { files } = this;
    const original = await files.read(input.path);
    if (original !== input.expected) throw new VaultError("CONFLICT", "收件箱原文已变化，迁移尚未开始。", { path: input.path });
    const fields = documentParts(original).fields;
    if (!isInboxPath(input.path) || fields.type !== "inbox") throw new VaultError("INVALID_INBOX", "迁移来源必须是明确的收件箱记录。");
    const targetBefore = await files.read(input.target);
    if (targetBefore !== input.target_expected) throw new VaultError("CONFLICT", "任务说明已变化，迁移尚未开始。", { path: input.target });
    const targetFields = documentParts(targetBefore).fields;
    let target = workMetadata(input.target, targetFields);
    newBusinessPath(input.target);
    if (target?.archived) throw new VaultError("ARCHIVED_PROJECT", "请先恢复项目，再迁入资料。");
    if (input.action === "transfer-inbox") {
      if (!target && [ROOTS.areas, ROOTS.resources].includes(input.target.split("/")[0]) && !["inbox", "task", "project"].includes(targetFields.type)) target = { directory: path.posix.dirname(input.target) };
      if (!target) throw new VaultError("INVALID_TARGET", "分流目标必须是有效项目、任务说明或领域、资源笔记。");
    } else if (target?.type !== "task") throw new VaultError("INVALID_TARGET", "迁移目标必须是有效的任务说明。");
    const names = new Set(await inventory(files));
    const sourceDirectory = path.posix.dirname(input.path);
    const bundled = path.posix.basename(input.path) === "记录.md" && sourceDirectory.split("/").length >= 3;
    const selected = new Set([input.path]);
    if (bundled) {
      const visit = async relative => {
        for (const entry of await this.io.readdir(await files.safe(relative, { directory: true }), { withFileTypes: true })) {
          const child = `${relative}/${entry.name}`;
          attachmentPath(child);
          if (entry.isSymbolicLink()) throw new VaultError("INVALID_DIRECTORY", `迁移范围含符号链接：${child}`);
          if (entry.isDirectory()) await visit(child);
          else if (entry.isFile()) selected.add(child);
          else throw new VaultError("INVALID_DIRECTORY", `不能迁移特殊文件：${child}`);
        }
      };
      await visit(sourceDirectory);
    }
    if (fields.attachments !== undefined && (!Array.isArray(fields.attachments) || fields.attachments.some(p => typeof p !== "string"))) throw new VaultError("INVALID_FIELD", "来源附件属性无效，未迁移。");
    for (const name of fields.attachments || []) {
      attachmentPath(name); await files.safe(name);
      if (!(await exists(this.io, path.join(files.root, name)))) throw new VaultError("NOT_FOUND", `登记的附件不存在：${name}`);
      // Already owned by a course, task, or another business collection: reference it.
      if (isInboxPath(name) || !name.includes("/")) selected.add(name);
    }
    const originals = new Map();
    for (const name of selected) {
      const bytes = await this.bytes(name); assertOrdinaryMove(name, bytes); originals.set(name, bytes);
    }
    for (const name of selected) {
      if (name === input.path || !/\.md$/i.test(name)) continue;
      let type;
      try { type = documentParts(originals.get(name).toString("utf8")).fields.type; }
      catch (error) { if (error.code !== "INVALID_YAML") throw error; }
      if (["inbox", "task", "project"].includes(type)) throw new VaultError("MIXED_MATERIAL", `同一目录还有独立记录，不能整体迁移：${name}`);
    }
    const documents = new Map();
    for (const name of names) {
      if (!isBusinessPath(name) || selected.has(name)) continue;
      const raw = await files.read(name), refs = new Set();
      rewriteLinks(raw, name, name, {}, names, files.root, refs);
      const shared = [...refs].filter(ref => selected.has(ref) && ref !== input.path);
      if (shared.length) throw new VaultError("SHARED_MATERIAL", `附件仍被其他笔记引用，请先确认归属：${shared.join("、")}；引用者：${name}`);
      documents.set(name, raw);
    }
    const title = fields.title || (bundled ? path.posix.basename(sourceDirectory) : path.posix.basename(input.path, ".md"));
    let directory = `${target.directory}/资料/${folderTitle(title)}`;
    const base = directory;
    for (let i = 2; await exists(this.io, path.join(files.root, directory)); i++) directory = `${base} (${i})`;
    const moves = {}, used = new Set();
    for (const name of selected) {
      let destination = name === input.path ? `${directory}/记录.md`
        : bundled && name.startsWith(sourceDirectory + "/") ? directory + name.slice(sourceDirectory.length)
        : `${directory}/attachments/${path.posix.basename(name)}`;
      const initial = destination, ext = path.posix.extname(initial);
      for (let i = 2; used.has(destination); i++) destination = initial.slice(0, initial.length - ext.length) + ` (${i})` + ext;
      used.add(destination); moves[name] = destination;
    }
    const sourceAfter = patchFields(rewriteLinks(original, input.path, moves[input.path], moves, names, files.root), {
      type: "note", capture_origin: { path: input.path, type: "inbox", moved_at: new Date().toISOString() }
    });
    const entries = [...selected].map(name => {
      const before = originals.get(name), after = name === input.path ? Buffer.from(sourceAfter) : before;
      return { from: name, to: moves[name], before: hash(before), after: hash(after), bytes: after.length, ...(name === input.path ? { content: sourceAfter } : {}) };
    });
    const edits = [];
    for (const [name, before] of documents) {
      let after = rewriteLinks(before, name, name, moves, names, files.root);
      if (name === input.target) after += `${after.endsWith("\n") ? "\n" : "\n\n"}## 迁入资料\n\n${linkTo(moves[input.path], name)}\n`;
      if (after !== before) { assertOrdinaryMove(name, Buffer.from(before)); edits.push({ path: name, before, after }); }
    }
    return { source: input.path, sourceDirectory: bundled ? sourceDirectory : null, target: input.target, directory, entries, edits, phase: "copy", result: { ok: true, saved: true, path: input.target, sourcePath: moves[input.path], directory, moved: entries.map(({ from, to, after: sha256, bytes }) => ({ from, to, sha256, bytes })), updatedLinks: edits.map(edit => edit.path) } };
  }

  async run(input) {
    businessPath(input.path); businessPath(input.target);
    if (!UUID.test(input.request_id || "")) throw new VaultError("REQUEST_ID", "迁移需要 UUID request_id。");
    if (input.privacy !== "ordinary") throw new VaultError("PRIVACY_REVIEW", "先确认资料保存范围与隐私。");
    if (typeof input.expected !== "string" || typeof input.target_expected !== "string") throw new VaultError("EXPECTED_REQUIRED", "迁移前读取原记录与目标任务说明，提交 expected 与 target_expected。");
    const { files } = this;
    const signature = hash(JSON.stringify([input.action || "transfer-to-task", input.path, input.expected, input.target, input.target_expected, input.directory || ""]));
    return files.withLock("task-material-transfer", async () => {
      const receipt = `${files.runtime}/transfers/${input.request_id}.json`;
      let plan;
      try { plan = JSON.parse(await this.io.readFile(await files.safe(receipt), "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const previousSignature = hash(JSON.stringify([input.path, input.expected, input.target, input.target_expected]));
      if (plan && plan.signature !== signature && !(input.action === "transfer-to-task" && plan.signature === previousSignature)) throw new VaultError("REQUEST_CHANGED", "同一迁移标识不能用于不同输入。");
      if (!plan) {
        const pending = await this.pending(input.path);
        if (pending) throw new VaultError("TRANSFER_PENDING", "这条记录已有未完成迁移，请使用恢复记录中的原请求继续。", { recoveryPath: pending.recoveryPath });
        plan = { signature, input, ...await this.plan(input) };
        await files.exclusiveFile(receipt, JSON.stringify(plan));
      }
      const checkpoint = async () => {
        const stage = receipt + ".next";
        await this.io.writeFile(await files.safe(stage, { parents: true }), JSON.stringify(plan), { mode: 0o600 });
        await this.io.rename(path.join(files.root, stage), await files.safe(receipt));
      };
      const verifyTargets = async () => {
        for (const entry of plan.entries) if (hash(await this.bytes(entry.to)) !== entry.after) throw new VaultError("REPLAY_CHANGED", `迁入后的文件已变化：${entry.to}`);
        for (const edit of plan.edits) if (await files.read(edit.path) !== edit.after) throw new VaultError("REPLAY_CHANGED", `更新后的引用已变化：${edit.path}`);
      };
      if (plan.phase === "complete") { await verifyTargets(); return { ...plan.result, reused: true }; }
      newBusinessPath(input.target);
      const keys = [...new Set([...plan.entries.flatMap(e => [e.from, e.to]), ...plan.edits.map(e => e.path)])].sort();
      const locked = async index => index < keys.length ? files.withLock(`note:${keys[index]}`, () => locked(index + 1)) : apply();
      const apply = async () => {
        try {
          // Check all affected versions before writing or resuming any step.
          for (const entry of plan.entries) {
            const present = await exists(this.io, await files.safe(entry.from).catch(error => { if (error.code === "ENOENT") return path.join(files.root, entry.from); throw error; }));
            if (present ? hash(await this.bytes(entry.from)) !== entry.before : plan.phase !== "cleanup") throw new VaultError("CONFLICT", `源文件已变化或缺失：${entry.from}`);
          }
          for (const edit of plan.edits) {
            const current = await files.read(edit.path);
            if (current !== edit.before && current !== edit.after) throw new VaultError("CONFLICT", `相关笔记已变化：${edit.path}`);
          }
          for (const directory of plan.directories || []) await files.ensureDirectories(directory);
          for (const entry of plan.entries) {
            const absolute = await files.safe(entry.to, { parents: true });
            if (await exists(this.io, absolute)) {
              if (hash(await this.bytes(entry.to)) !== entry.after) throw new VaultError("PATH_CONFLICT", `目标已有不同内容，未覆盖：${entry.to}`);
            } else {
              const bytes = entry.content === undefined ? await this.bytes(entry.from) : Buffer.from(entry.content);
              if (hash(bytes) !== entry.after) throw new VaultError("CONFLICT", `复制前源文件发生变化：${entry.from}`);
              await files.exclusiveFile(entry.to, bytes);
            }
          }
          for (const edit of plan.edits) {
            if (await files.read(edit.path) === edit.after) continue;
            const stage = `${files.runtime}/transfers/${input.request_id}-${hash(edit.path)}.next`;
            await this.io.writeFile(await files.safe(stage, { parents: true }), edit.after, { mode: 0o600 });
            if (await files.read(edit.path) !== edit.before) throw new VaultError("CONFLICT", `替换前原文发生变化：${edit.path}`);
            await this.io.rename(await files.safe(stage), await files.safe(edit.path));
            if (await files.read(edit.path) !== edit.after) throw new VaultError("CONFLICT", `写入后原文发生变化：${edit.path}`);
          }
          await verifyTargets();
          plan.phase = "cleanup"; await checkpoint();
          // Never remove a source until every destination and referring note was checked.
          for (const entry of plan.entries) {
            let absolute;
            try { absolute = await files.safe(entry.from); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
            if (!(await exists(this.io, absolute))) continue;
            if (hash(await this.bytes(entry.from)) !== entry.before || hash(await this.bytes(entry.to)) !== entry.after) throw new VaultError("CONFLICT", `移除源文件前内容发生变化：${entry.from}`);
            await this.io.unlink(absolute);
          }
          if (plan.sourceDirectory) {
            const prune = async relative => {
              const absolute = await files.safe(relative, { directory: true });
              for (const entry of await this.io.readdir(absolute, { withFileTypes: true })) {
                if (entry.isDirectory() && !entry.isSymbolicLink()) await prune(`${relative}/${entry.name}`);
                else throw new VaultError("CONFLICT", `源目录出现未迁移的新文件，已保留：${relative}/${entry.name}`);
              }
              await this.io.rmdir(absolute);
            };
            if (await exists(this.io, path.join(files.root, plan.sourceDirectory))) await prune(plan.sourceDirectory);
          }
          await verifyTargets(); plan.phase = "complete"; await checkpoint();
          return plan.result;
        } catch (error) {
          throw new VaultError(error.code || "TRANSFER_FAILED", `迁移未完成：${error.message}；保留迁移记录，可核对后使用同一请求继续。`, { partial: true, path: plan.target, recoveryPath: receipt, files: plan.entries.map(({ from, to }) => ({ from, to })) });
        }
      };
      return locked(0);
    });
  }
}

module.exports = { TaskTransfer, rewriteLinks, resolveLink, inventory, exists };
