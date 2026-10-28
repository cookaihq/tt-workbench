"use strict";

const fs = require("node:fs/promises");
const nodePath = require("node:path");

const { BUSINESS_ROOTS } = require("./vault-paths.js");

class NoteReadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NoteReadError";
    this.code = code;
  }
}

const {businessPath,isBusinessPath} = require("./shared.js");

class NoteReader {
  constructor(vault, { lstat = fs.lstat } = {}) {
    this.vault = vault;
    this.lstat = lstat;
  }

  assertVault() {
    if (typeof this.vault.adapter.getBasePath !== "function") {
      throw new NoteReadError("WRONG_VAULT", "工作台需要桌面端的本地知识库。");
    }
  }

  list() {
    this.assertVault();
    return this.vault.getMarkdownFiles()
      .filter(file => isBusinessPath(file.path))
      .map(file => ({ path: file.path, title: file.basename }))
      .sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
  }

  async resolve(value) {
    this.assertVault();
    const path = businessPath(value);
    // Do not follow a symbolic link before checking each component. In particular,
    // never resolve a business-directory link into a different vault.
    let absolute = this.vault.adapter.getBasePath();
    try {
      for (const part of path.split("/")) {
        absolute = nodePath.join(absolute, part);
        const stat = await this.lstat(absolute);
        if (stat.isSymbolicLink()) {
          throw new NoteReadError("SYMLINK", "此路径包含符号链接，工作台不会沿链接读取其他位置。");
        }
      }
    } catch (error) {
      if (error instanceof NoteReadError) throw error;
      if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        throw new NoteReadError("NOT_FOUND", "找不到这份笔记。请检查路径，或重新读取笔记列表。");
      }
      if (error.code === "EACCES" || error.code === "EPERM") {
        throw new NoteReadError("PERMISSION", "当前设备没有读取这份笔记的权限。");
      }
      throw new NoteReadError("READ_FAILED", "无法检查这份笔记的文件状态，请检查文件是否可访问。");
    }
    const file = this.vault.getAbstractFileByPath(path);
    if (!file || typeof file.extension !== "string") {
      throw new NoteReadError("NOT_FOUND", "文件尚未出现在 Obsidian 的笔记列表中，请稍后重新读取。");
    }
    if (file.extension.toLowerCase() !== "md") {
      throw new NoteReadError("NOT_MARKDOWN", "请选择 Markdown 笔记（.md 文件）。");
    }
    return file;
  }

  async read(value) {
    const file = await this.resolve(value);
    try {
      // read(), rather than cachedRead(), is intentional for the refresh action.
      const content = await this.vault.read(file);
      return { path: file.path, title: file.basename, content };
    } catch (error) {
      if (error.code === "ENOENT") throw new NoteReadError("NOT_FOUND", "读取时笔记已不存在，请重新读取列表。");
      if (error.code === "EACCES" || error.code === "EPERM") {
        throw new NoteReadError("PERMISSION", "当前设备没有读取这份笔记的权限。");
      }
      throw new NoteReadError("READ_FAILED", "笔记读取失败，请检查文件是否可访问后重试。");
    }
  }
}

module.exports = { BUSINESS_ROOTS, NoteReader, NoteReadError, businessPath, isBusinessPath };
