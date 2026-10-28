"use strict";
const fs = require("node:fs/promises"), path = require("node:path");
const { VaultFiles, RUNTIME, hash } = require("./files.js");
const { VaultError } = require("./errors.js");
const { InboxStore, UUID } = require("./inbox.js");
const { businessPath, READABLE_ROOTS, isBusinessPath, isInboxPath, newBusinessPath } = require("./paths.js");
const { localCreation } = require("./time.js");
const { documentParts, newDocument } = require("./document.js");
const { AttachmentWriter } = require("./attachments.js");
const {WORK_STATES,workMetadata,prepareProject,prepareTask}=require("./work.js");
const {TaskTransfer}=require("./task-transfer.js");
const {ProjectArchive,MaterialArchive}=require("./project-archive.js");
const STATES=Object.keys(WORK_STATES);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const sections = input => `${input.content || ""}${input.ai_summary ? `\n\n## AI 归纳\n\n${input.ai_summary}` : ""}${input.judgment ? `\n\n## 本人判断\n\n${input.judgment}` : ""}`;
function errorResult(error) {
  const result = { ok: false, code: error.code || "WRITE_FAILED", message: error.message };
  for (const key of ["path", "attachmentPath", "conflictPath", "recoveryPath", "lockPath", "proposed", "files", "partial"]) if (error[key] !== undefined) result[key] = error[key];
  return result;
}
async function listNotes(files, relative = "") {
  const result = [];
  for (const entry of await files.io.readdir(path.join(files.root, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".") || ["tmp", "node_modules"].includes(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory() && (relative || READABLE_ROOTS.includes(entry.name))) result.push(...await listNotes(files, child));
    else if (entry.isFile() && isBusinessPath(child)) result.push({ path: child, title: path.posix.basename(child, ".md") });
  }
  return result;
}
function validateFields(notePath, original, fields) {
  for (const key of ["type", "id", "request_id", "request_hash", "created", "created_timezone"]) if (Object.hasOwn(fields, key)) throw new VaultError("IMMUTABLE_FIELD", `普通更新不修改 ${key}。`);
  const before = documentParts(original).fields;
  const work = workMetadata(notePath, before);
  if (Object.hasOwn(fields, "inbox_status") && (!isInboxPath(notePath) || before.type !== "inbox" || !["pending", "reviewed"].includes(fields.inbox_status))) throw new VaultError("INVALID_STATUS", "只能更新明确收件箱记录的有效整理状态。");
  if (work?.archived && ["status", "progress", "next_step"].some(key => Object.hasOwn(fields, key))) throw new VaultError("ARCHIVED_PROJECT", "请先恢复项目，再推进项目或任务。");
  if (Object.hasOwn(fields, "status") && (!work || !STATES.includes(fields.status))) throw new VaultError("INVALID_STATUS", "业务状态只适用于明确的项目或任务。");
  for (const key of ["progress", "next_step"]) if (Object.hasOwn(fields, key) && (work?.type !== "task" || typeof fields[key] !== "string")) throw new VaultError("INVALID_FIELD", "进度和下一步必须是任务的文字属性。");
}
async function execute(root, input, options = {}) {
  const files = new VaultFiles(root, options), attachments = new AttachmentWriter(files);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new VaultError("INVALID_INPUT", "stdin 需要一个 JSON 对象。");
  if (input.action === "info") return { ok: true, vault: files.root, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(input.list ? { notes: await listNotes(files) } : {}) };
  if (input.action === "read") { const content = await files.read(input.path); return { ok: true, path: input.path, content, sha256: hash(content) }; }
  if (["transfer-to-task", "transfer-inbox"].includes(input.action)) return new TaskTransfer(root).run(input);
  if (["archive-project", "restore-project"].includes(input.action)) return new ProjectArchive(root).run(input);
  if (["archive-material", "restore-material"].includes(input.action)) return new MaterialArchive(root).run(input);
  if (!["capture", "create-note", "create-project", "create-task", "update", "append", "review", "work-update", "attach"].includes(input.action)) throw new VaultError("UNKNOWN_ACTION", "未知操作，请查看 scripts/vault/write.mjs --help。");
  if (input.privacy !== "ordinary") throw new VaultError("PRIVACY_REVIEW", "先判断保存范围与隐私；疑似私密内容须等待本人处置指令。");
  if (!UUID.test(input.request_id || "")) throw new VaultError("REQUEST_ID", "写入需要 UUID request_id；相同请求重试沿用该值。");
  if (!["capture","create-project","create-task"].includes(input.action)) businessPath(input.path);
  if (input.action === "create-note") newBusinessPath(input.path);
  if (input.files !== undefined && (!Array.isArray(input.files) || input.files.some(x => !x || typeof x !== "object" || Array.isArray(x)))) throw new VaultError("INVALID_INPUT", "files 必须为文件描述对象数组。");
  const signature = hash(JSON.stringify(stable(input))), recordPath = `${RUNTIME}/requests/${input.request_id}.json`;
  return files.withLock(`request:${input.request_id}`, async () => {
    let record;
    try { record = JSON.parse(await fs.readFile(await files.safe(recordPath), "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    if (record && record.signature !== signature) throw new VaultError("REQUEST_CHANGED", "同一请求标识不能用于不同输入。");
    record ||= { signature, started: new Date().toISOString(), status: "started", completedFiles: {} };
    const checkpoint = async () => {
      const absolute = await files.safe(recordPath, { parents: true }), stage = absolute + ".next";
      await files.safe(recordPath + ".next", {parents:true});
      await fs.writeFile(stage, JSON.stringify(record, null, 2), { mode: 0o600 }); await fs.rename(stage, absolute);
    };
    for (const [index, file] of Object.entries(record.completedFiles)) {
      let actual;
      try { actual = hash(await fs.readFile(await files.safe(file.attachmentPath))); }
      catch { throw new VaultError("REPLAY_CHANGED", "已保存附件无法读回，未重新复制或覆盖。", { attachmentPath: file.attachmentPath }); }
      if (actual !== file.sha256) throw new VaultError("REPLAY_CHANGED", "已保存附件之后发生变化，未覆盖。", { attachmentPath: file.attachmentPath });
      const source = input.action === "attach" ? input.source : input.files?.[Number(index)]?.source;
      if (typeof source === "string") {
        let sourceHash;
        try { sourceHash = hash(await fs.readFile(source)); }
        catch { throw new VaultError("REQUEST_CHANGED", "重试的来源文件已无法读取，请核对原请求与已保存副本。", { attachmentPath: file.attachmentPath }); }
        if (sourceHash !== file.sha256) throw new VaultError("REQUEST_CHANGED", "重试的来源文件内容已变化；不同内容需要新的请求标识。", { attachmentPath: file.attachmentPath });
      }
    }
    if (record.status === "complete") {
      if (hash(await files.read(record.result.path)) !== record.sha256) throw new VaultError("REPLAY_CHANGED", "该请求已完成，但笔记之后发生变化；未重复执行。", { path: record.result.path });
      return { ...record.result, reused: true };
    }
    await checkpoint(); const now = new Date(record.started), options = { now, requestId: input.request_id };
    let result;
    if (["capture", "create-note", "create-project", "create-task"].includes(input.action)) {
      if (record.path) {
        if (hash(await files.read(record.path)) !== record.sha256) throw new VaultError("REPLAY_CHANGED", "部分完成的笔记已变化，请核对后用新请求继续缺少的步骤。", { path: record.path, files: Object.values(record.completedFiles), partial: true });
        result = { path: record.path, reused: true };
      } else if (input.action === "capture") {
        const inbox = new InboxStore(root, { now: () => now });
        result = await inbox.save(inbox.prepare({ ...input, content: sections(input), captureEntry: "agent", requestId: input.request_id, requestHash: signature }));
      } else if (["create-task", "create-project"].includes(input.action)) {
        result=await files.withLock("task-material-transfer",async()=>{
          const task = input.action === "create-task" ? await prepareTask(files,input,now,input.request_id) : prepareProject(input,now,input.request_id);
          if (input.action === "create-task") {
            const pending = await new ProjectArchive(root).pending(input.projectPath);
            if (pending) throw new VaultError("TRANSFER_PENDING", "所属项目有尚未完成的归档或恢复，请先按恢复记录完成移动。", { recoveryPath: pending.recoveryPath });
          }
          return files.withLock(`note:${task.path}`,async()=>{
            try { return await files.exclusiveFile(task.path,task.document); }
            catch(error) { if(error.code==="EEXIST" && await files.read(task.path)===task.document)return {path:task.path,reused:true}; throw error; }
          });
        });
      } else {
        businessPath(input.path);
        if (typeof input.content !== "string" || !input.content.trim()) throw new VaultError("EMPTY_INPUT", "正文不能为空。");
        const content = newDocument({ type: "note", ...localCreation(now, input.timezone), request_id: input.request_id, request_hash: signature }, sections(input));
        result = await files.withLock(`note:${input.path}`, async () => {
          try { return await files.exclusiveFile(input.path, content); }
          catch (error) { if (error.code === "EEXIST" && await files.read(input.path) === content) return { path: input.path, reused: true }; throw error; }
        });
      }
      record.path = result.path; record.sha256 = hash(await files.read(result.path)); await checkpoint();
      const failures = [];
      if (input.files !== undefined && !Array.isArray(input.files)) throw new VaultError("INVALID_INPUT", "files 必须为数组。", { partial: true, path: result.path });
      for (let i = 0; i < (input.files || []).length; i++) {
        if (record.completedFiles[i]) continue;
        try {
          const saved = await attachments.save({ ...input.files[i], path: result.path, expected: await files.read(result.path) }, options);
          record.completedFiles[i] = saved; record.sha256 = hash(await files.read(result.path)); await checkpoint();
        } catch (error) { failures.push({ index: i, ...errorResult(error) }); }
      }
      result = { ok: !failures.length, saved: !failures.length, path: result.path, files: Object.values(record.completedFiles), ...(failures.length ? { partial: true, code: "PARTIAL_WRITE", message: "主笔记已保存，部分附件步骤未完成。", failures } : {}) };
    } else if (input.action === "attach") {
      result = { ok: true, ...await attachments.save(input, options) }; record.completedFiles[0] = result;
    } else {
      let changes;
      if (input.action === "append") changes = { append: sections(input) };
      else if (input.action === "review") changes = { fields: { inbox_status: input.status } };
      else if (input.action === "work-update") {
        changes = { fields: { status: input.status } };
        for (const k of ["progress", "next_step"]) if (Object.hasOwn(input, k)) changes.fields[k] = input[k];
      } else changes = { fields: input.fields || {}, append: input.append || "", ...(Object.hasOwn(input, "body") ? { body: input.body } : {}) };
      if (typeof input.expected !== "string") throw new VaultError("EXPECTED_REQUIRED", "更新前先读取原文并提供 expected。");
      if (!changes.fields || typeof changes.fields !== "object" || Array.isArray(changes.fields)) changes.fields ||= {};
      if (Array.isArray(changes.fields) || typeof changes.fields !== "object") throw new VaultError("INVALID_FIELD", "fields 必须为属性对象。");
      if (!Object.keys(changes.fields).length && !changes.append && changes.body === undefined) throw new VaultError("EMPTY_INPUT", "没有要修改的内容。");
      validateFields(input.path, input.expected, changes.fields || {});
      const saved = await files.update(input.path, input.expected, changes, options);
      result = { ok: true, saved: true, path: saved.path, sha256: hash(saved.content), reused: Boolean(saved.reused) };
    }
    record.result = result; record.sha256 = hash(await files.read(result.path)); record.status = result.ok ? "complete" : "partial";
    await checkpoint(); return result;
  });
}
module.exports = { execute, errorResult, listNotes, validateFields };
