"use strict";
const path = require("node:path");
const { TaskTransfer, inventory, exists, rewriteLinks } = require("./task-transfer.js");
const { hash } = require("./files.js");
const { ROOTS, businessPath, isBusinessPath } = require("./paths.js");
const { documentParts } = require("./document.js");
const { workMetadata } = require("./work.js");
const { VaultError } = require("./errors.js");
const { assertOrdinaryMove } = require("./move-safety.js");

class ProjectArchive extends TaskTransfer {
  location(input) {
    businessPath(input.path);
    const source = workMetadata(input.path, { type: "project" });
    if (!source || source.legacy) throw new VaultError("INVALID_PROJECT", "归档与恢复需要新目录中的有效项目说明；旧项目请先完成迁移。");
    const restoring = input.action === "restore-project";
    if (!["archive-project", "restore-project"].includes(input.action) || source.archived !== restoring) throw new VaultError("INVALID_ARCHIVE", "请选择在办项目进行归档，或选择存档项目进行恢复。");
    const directory = `${restoring ? ROOTS.projects : `${ROOTS.archives}/项目`}/${path.posix.basename(source.directory)}`;
    return { sourceDirectory: source.directory, directory, target: `${directory}/项目说明.md` };
  }

  async run(input) {
    const { target } = this.location(input);
    return super.run({ ...input, target, target_expected: "" });
  }

  async plan(input) {
    const { files } = this;
    const original = await files.read(input.path);
    if (original !== input.expected) throw new VaultError("CONFLICT", "项目说明已变化，归档或恢复尚未开始。", { path: input.path });
    const fields = documentParts(original).fields;
    if (input.action.endsWith("-project") && workMetadata(input.path, fields)?.type !== "project") throw new VaultError("INVALID_PROJECT", "来源不是有效项目说明。");
    const { sourceDirectory, directory } = this.location(input);
    if (await exists(this.io, path.join(files.root, directory))) throw new VaultError("PATH_CONFLICT", `目标目录已经存在，未合并或覆盖：${directory}`, { path: directory });
    const names = new Set(await inventory(files)), originals = new Map(), sourceDirectories = [];
    const visit = async relative => {
      sourceDirectories.push(relative);
      for (const entry of await this.io.readdir(await files.safe(relative, { directory: true }), { withFileTypes: true })) {
        const name = `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new VaultError("INVALID_DIRECTORY", `项目中含符号链接，未移动：${name}`);
        if (entry.isDirectory()) await visit(name);
        else if (entry.isFile()) {
          const bytes = await this.bytes(name); assertOrdinaryMove(name, bytes); originals.set(name, bytes); names.add(name);
        } else throw new VaultError("INVALID_DIRECTORY", `不能迁移特殊文件：${name}`);
      }
    };
    await visit(sourceDirectory);
    const moves = Object.fromEntries([...originals.keys()].map(name => [name, directory + name.slice(sourceDirectory.length)]));
    const documents = new Map(), rawAttachments = new Set(), malformed = new Map();
    for (const name of names) {
      if (!isBusinessPath(name)) continue;
      const before = originals.has(name) ? originals.get(name).toString("utf8") : await files.read(name);
      let fields = {};
      try { fields = documentParts(before).fields; }
      catch (error) { if (error.code !== "INVALID_YAML") throw error; malformed.set(name, error); }
      for (const attachment of Array.isArray(fields.attachments) ? fields.attachments : []) if (typeof attachment === "string") rawAttachments.add(attachment);
      documents.set(name, before);
    }
    for (const [name, error] of malformed) if (!rawAttachments.has(name) && !name.split("/").includes("attachments")) throw error;
    const edits = [], entries = [];
    for (const [name, before] of documents) {
      // Registered originals and conventional attachment directories retain
      // their exact bytes, even when the original happens to be Markdown.
      if (rawAttachments.has(name) || name.split("/").includes("attachments")) continue;
      const after = rewriteLinks(before, name, moves[name] || name, moves, names, files.root);
      if (after !== before) {
        assertOrdinaryMove(name, Buffer.from(before));
        if (!originals.has(name)) edits.push({ path: name, before, after });
        else documents.set(name, after);
      }
    }
    for (const [name, bytes] of originals) {
      const after = documents.has(name) && !rawAttachments.has(name) && !name.split("/").includes("attachments") ? Buffer.from(documents.get(name)) : bytes;
      entries.push({ from: name, to: moves[name], before: hash(bytes), after: hash(after), bytes: after.length, ...(after.equals(bytes) ? {} : { content: after.toString("utf8") }) });
    }
    return {
      source: input.path, sourceDirectory, target: input.target, directory,
      directories: sourceDirectories.map(name => directory + name.slice(sourceDirectory.length)), entries, edits, phase: "copy",
      result: { ok: true, saved: true, path: input.target, sourcePath: input.path, directory, archived: input.action.startsWith("archive-"), moved: entries.map(({ from, to, after: sha256, bytes }) => ({ from, to, sha256, bytes })), updatedLinks: edits.map(edit => edit.path) }
    };
  }
}

class MaterialArchive extends ProjectArchive {
  location(input) {
    businessPath(input.path);
    if (typeof input.directory !== "string" || !input.directory || !input.path.startsWith(input.directory + "/")) throw new VaultError("DIRECTORY_REQUIRED", "请明确指定包含主说明笔记的完整领域或资源包目录 directory；不会推断附件归属。");
    businessPath(`${input.directory}/范围.md`);
    const parts = input.directory.split("/"), restoring = input.action === "restore-material";
    let directory;
    if (input.action === "archive-material" && parts.length >= 2 && [ROOTS.areas, ROOTS.resources].includes(parts[0])) {
      directory = [ROOTS.archives, parts[0] === ROOTS.areas ? "领域" : "资源", ...parts.slice(1)].join("/");
    } else if (restoring && parts[0] === ROOTS.archives && ["领域", "资源"].includes(parts[1]) && parts.length >= 3) {
      directory = [parts[1] === "领域" ? ROOTS.areas : ROOTS.resources, ...parts.slice(2)].join("/");
    } else throw new VaultError("INVALID_ARCHIVE", "仅支持明确的领域或资源包归档与恢复，不能归档整个业务根目录。");
    return { sourceDirectory: input.directory, directory, target: directory + input.path.slice(input.directory.length) };
  }
}

module.exports = { ProjectArchive, MaterialArchive };
