"use strict";
const fs = require("node:fs/promises"), path = require("node:path");
const { VaultError } = require("./errors.js");
const { documentParts } = require("./document.js");
const { hash } = require("./files.js");
const { workMetadata } = require("./work.js");
const { assertNewPath } = require("./paths.js");
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
function attachmentPath(value) {
  if (typeof value !== "string" || !value || /[\\\u0000-\u001f]/.test(value) || value.split("/").some(x => !x || x.startsWith(".") || ["tmp", "node_modules"].includes(x.toLowerCase())) || /^[a-z][a-z0-9+.-]*:/i.test(value) || ["apps", "scripts", "docs", "skills", "templates", "lib", "data"].includes(value.split("/")[0])) throw new VaultError("ATTACHMENT_PATH", "附件必须位于库内普通目录，不能使用隐藏、临时、规则、程序或运行数据目录。");
  return value;
}
function attachmentDirectory(setting, notePath) {
  if (typeof setting !== "string") throw new VaultError("ATTACHMENT_SETTING", "没有取得有效附件设置，请明确本次保存目录。");
  const parent = path.posix.dirname(notePath);
  if (setting === "" || setting === "/") return "";
  if (setting === ".") return parent === "." ? "" : parent;
  if (setting.startsWith("./")) {
    const sub = setting.slice(2); attachmentPath(sub);
    return path.posix.join(parent, sub);
  }
  return attachmentPath(setting.replace(/\/$/, ""));
}
function linkTo(relative, notePath) {
  const target = path.posix.relative(path.posix.dirname(notePath), relative).split("/").map(encodeURIComponent).join("/").replace(/%2B/g, "+");
  const label = path.posix.basename(relative).replace(/[\[\]\\]/g, "\\$&");
  return `${IMAGE.test(relative) ? "!" : ""}[${label}](<${target}>)`;
}
class AttachmentWriter {
  constructor(files) { this.files = files; }
  async taskDirectory(notePath) {
    let directory = path.posix.dirname(notePath);
    while (directory !== ".") {
      const candidate = `${directory}/任务说明.md`;
      if (workMetadata(candidate, { type: "task" })) {
        try {
          if (workMetadata(candidate, documentParts(await this.files.read(candidate)).fields)?.type === "task") return directory;
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      directory = path.posix.dirname(directory);
    }
    return null;
  }
  async setting() {
    let value;
    try { value = JSON.parse(await this.files.io.readFile(await this.files.safe(`${this.files.configDir}/app.json`), "utf8")).attachmentFolderPath; }
    catch (error) { throw new VaultError("ATTACHMENT_SETTING", "无法读取库内 Obsidian 附件设置，请明确本次保存目录。", { reason: error.message }); }
    if (typeof value !== "string") throw new VaultError("ATTACHMENT_SETTING", "附件设置缺失，请明确本次保存目录。");
    return value;
  }
  async copy(input) {
    let filename = input.filename, bytes;
    if (typeof input.source === "string") {
      const stat = await fs.lstat(input.source);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new VaultError("SOURCE_FILE", "来源必须是已获授权的普通文件。");
      filename ||= path.basename(input.source); bytes = await fs.readFile(input.source);
    } else if (typeof input.base64 === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) bytes = Buffer.from(input.base64, "base64");
    else throw new VaultError("ATTACHMENT_DATA", "请提供实际来源文件或有效 Base64 数据。");
    if (typeof filename !== "string" || !filename || /[/\\\u0000-\u001f]/.test(filename) || filename.startsWith(".") || Buffer.byteLength(filename) > 240) throw new VaultError("ATTACHMENT_NAME", "附件名无法安全保存，请明确可用名称；不会擅自修改扩展名。");
    let directory = Object.hasOwn(input, "directory") ? input.directory : attachmentDirectory(await this.setting(), input.path);
    if (typeof directory !== "string") throw new VaultError("ATTACHMENT_PATH", "附件目录必须为库内相对路径。");
    if (directory) attachmentPath(directory);
    const task = await this.taskDirectory(input.path);
    if (task && directory !== task && !directory.startsWith(task + "/")) {
      if (Object.hasOwn(input, "directory")) throw new VaultError("TASK_ATTACHMENT_PATH", "任务专属附件必须保存到所属任务目录内；共享来源请引用已有文件。");
      directory = `${task}/attachments`;
    }
    return this.files.withLock(`attachments:${directory}`, async () => {
      const ext = path.posix.extname(filename), stem = filename.slice(0, filename.length - ext.length);
      for (let i = 1; ; i++) {
        const name = i === 1 ? filename : `${stem} (${i})${ext}`;
        const relative = attachmentPath(directory ? `${directory}/${name}` : name);
        assertNewPath(relative);
        const absolute = await this.files.safe(relative, { parents: true });
        try {
          const existing = await this.files.io.readFile(absolute);
          if (existing.equals(bytes)) return { path: relative, bytes: bytes.length, sha256: hash(bytes), reused: true };
          continue;
        } catch (error) { if (error.code !== "ENOENT") throw error; }
        try { await this.files.exclusiveFile(relative, bytes); }
        catch (error) { if (error.code === "EEXIST") continue; error.attachmentPath = relative; throw error; }
        return { path: relative, bytes: bytes.length, sha256: hash(bytes), reused: false };
      }
    });
  }
  async save(input, options = {}) {
    const current = await this.files.read(input.path);
    if (typeof input.expected !== "string") throw new VaultError("EXPECTED_REQUIRED", "先读取目标笔记并提供 expected。");
    if (current !== input.expected) throw new VaultError("CONFLICT", "原笔记已变化，附件尚未写入。", { path: input.path });
    const fields = documentParts(current).fields;
    if (fields.attachments !== undefined && (!Array.isArray(fields.attachments) || fields.attachments.some(x => typeof x !== "string"))) throw new VaultError("INVALID_FIELD", "attachments 已有内容不是路径数组，请先核对。");
    const file = await this.copy(input), link = linkTo(file.path, input.path);
    const attachments = [...new Set([...(fields.attachments || []), file.path])];
    try {
      const saved = await this.files.update(input.path, input.expected, { fields: { attachments }, append: current.includes(link) ? "" : link }, options);
      return { saved: true, path: saved.path, attachmentPath: file.path, link, bytes: file.bytes, sha256: file.sha256, reused: file.reused };
    } catch (error) {
      error.attachmentPath = file.path; error.message = `附件已保留到 ${file.path}，笔记链接尚未确认：${error.message}`; throw error;
    }
  }
}
module.exports = { AttachmentWriter, attachmentPath, attachmentDirectory, linkTo };
