"use strict";
const fs = require("node:fs/promises"), path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { VaultError } = require("./errors.js");
const { businessPath } = require("./paths.js");
const { proposedUpdate } = require("./document.js");
const { localCreation } = require("./time.js");
const { configDirectory } = require("../config/target.cjs");
const hash = value => createHash("sha256").update(value).digest("hex");
const runtimeStorage = require('../runtime/storage.cjs');
const RUNTIME = runtimeStorage.relative('vault-io');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class VaultFiles {
  constructor(root, { io = fs, lockTimeout = 5000, configDir = '.obsidian' } = {}) { this.root = path.resolve(root); this.io = io; this.lockTimeout = lockTimeout; this.configDir = configDirectory(configDir); }
  get runtime() { return runtimeStorage.relative('vault-io', this.root); }
  async safe(relative, { parents = false, directory = false } = {}) {
    if (typeof relative !== "string" || !relative || /[\\\u0000-\u001f]/.test(relative) || path.posix.isAbsolute(relative) || relative.split("/").some(p => !p || p === "." || p === "..")) throw new VaultError("OUT_OF_SCOPE", "必须提供当前库内的相对路径。");
    let absolute = this.root;
    const rootStat = await this.io.lstat(absolute);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new VaultError("INVALID_DIRECTORY", "目标库不是普通目录。");
    const parts = relative.split("/");
    for (let i = 0; i < parts.length; i++) {
      absolute = path.join(absolute, parts[i]);
      const needDirectory = i < parts.length - 1 || directory;
      let stat;
      try { stat = await this.io.lstat(absolute); }
      catch (e) {
        if (e.code !== "ENOENT") throw e;
        if (needDirectory && parents) {
          try { await this.io.mkdir(absolute); } catch (error) { if (error.code !== "EEXIST") throw error; }
          stat = await this.io.lstat(absolute);
        } else if (needDirectory) throw e;
      }
      if (stat && (stat.isSymbolicLink() || (needDirectory ? !stat.isDirectory() : !stat.isFile()))) throw new VaultError("INVALID_DIRECTORY", `路径含符号链接或不适用的文件类型：${relative}`);
    }
    return absolute;
  }
  async ensureDirectories(relative) { return this.safe(relative, { parents: true, directory: true }); }
  async read(relative) { businessPath(relative); return this.io.readFile(await this.safe(relative), "utf8"); }
  async exclusiveFile(relative, content) {
    const absolute = await this.safe(relative, { parents: true });
    const handle = await this.io.open(absolute, "wx", 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    if (!Buffer.from(await this.io.readFile(absolute)).equals(Buffer.from(content))) throw new VaultError("VERIFY_FAILED", `写入后内容发生变化：${relative}`, { path: relative });
    return { path: relative };
  }
  async withLock(key, action) {
    return runtimeStorage.withRuntime(this.root, () => this.withFileLock(key, action), this.io);
  }
  async withFileLock(key, action) {
    const parent = `${this.runtime}/locks`, directory = `${parent}/${hash(key)}`;
    await this.ensureDirectories(parent);
    const absolute = path.join(this.root, directory), deadline = Date.now() + this.lockTimeout;
    for (;;) {
      try { await this.io.mkdir(absolute); break; }
      catch (e) {
        if (e.code !== "EEXIST") throw e;
        if (Date.now() >= deadline) throw new VaultError("LOCKED", "同一文件有其他写入操作或未结束的锁，请保留输入并核对；未自动删除锁。", { lockPath: directory });
        await sleep(30);
      }
    }
    try {
      await this.io.writeFile(path.join(absolute, "owner.json"), JSON.stringify({ pid: process.pid, created: new Date().toISOString(), key }), { flag: "wx", mode: 0o600 });
      return await action();
    } finally {
      // Only release the lock directory owned by this invocation.
      await this.io.unlink(path.join(absolute, "owner.json")).catch(e => { if (e.code !== "ENOENT") throw e; });
      await this.io.rmdir(absolute);
    }
  }
  async preserveConflict(notePath, expected, proposed, current) {
    const conflictPath = notePath.replace(/\.md$/i, `-保存冲突-${randomUUID()}.md`);
    const runs = proposed.match(/`+/g) || [], fence = "`".repeat(Math.max(3, ...runs.map(r => r.length + 1)));
    const fields = { type: "workbench-conflict", original: notePath, ...localCreation(new Date()), expected_sha256: hash(expected), current_sha256: hash(current) };
    const document = `---\n${Object.entries(fields).map(([k,v]) => `${k}: ${k === "type" ? v : JSON.stringify(v)}`).join("\n")}\n---\n\n# 保存冲突\n\n请核对 [[${notePath}]] 与下方拟保存版本。本次没有用旧原文覆盖已发现的修改；本文件不是新的收件箱记录。\n\n${fence}markdown\n${proposed}\n${fence}\n`;
    await this.exclusiveFile(conflictPath, document);
    return conflictPath;
  }
  async update(notePath, expected, changes, { now = new Date(), requestId = randomUUID() } = {}) {
    businessPath(notePath);
    if (typeof expected !== "string") throw new VaultError("EXPECTED_REQUIRED", "更新前先读取完整原文并作为 expected 提交。");
    const proposed = proposedUpdate(expected, changes, now);
    return this.withLock(`note:${notePath}`, async () => {
      let current = await this.read(notePath);
      if (current === proposed) return { path: notePath, content: current, reused: true };
      const conflict = async () => {
        let conflictPath;
        try { conflictPath = await this.preserveConflict(notePath, expected, proposed, current); }
        catch { throw new VaultError("CONFLICT_UNSAVED", "原文已变化；冲突副本也未写入，请保留本次输入。", { path: notePath, proposed }); }
        throw new VaultError("CONFLICT", `原文已变化，拟保存内容已保留：${conflictPath}`, { path: notePath, conflictPath, proposed });
      };
      if (current !== expected) return conflict();
      const stage = `${this.runtime}/updates/${randomUUID()}`, absolute = await this.safe(notePath);
      await this.ensureDirectories(stage);
      // Runtime snapshots are not notes: a .md suffix would make Obsidian
      // queue metadata reads for files that disappear after a successful save.
      await this.exclusiveFile(`${stage}/before.txt`, expected);
      await this.exclusiveFile(`${stage}/after.txt`, proposed);
      await this.exclusiveFile(`${stage}/operation.json`, JSON.stringify({ path: notePath, requestId, before: hash(expected), after: hash(proposed) }));
      try {
        current = await this.read(notePath);
        if (current !== expected) return await conflict();
        const originalStat = await this.io.stat(absolute);
        await this.io.chmod(path.join(this.root, stage, "after.txt"), originalStat.mode & 0o777);
        // Atomic replacement prevents partially written Markdown. The lock
        // coordinates participating writers, not arbitrary external editors.
        await this.io.rename(path.join(this.root, stage, "after.txt"), absolute);
        current = await this.read(notePath);
        if (current !== proposed) return await conflict();
        await this.io.unlink(path.join(this.root, stage, "before.txt"));
        await this.io.unlink(path.join(this.root, stage, "operation.json"));
        await this.io.rmdir(path.join(this.root, stage));
        return { path: notePath, content: current };
      } catch (error) {
        if (error instanceof VaultError) { error.recoveryPath = stage; throw error; }
        throw new VaultError("WRITE_FAILED", "写入尚未确认，请检查原文件与恢复记录。", { path: notePath, recoveryPath: stage, proposed, reason: error.message });
      }
    });
  }
}
module.exports = { VaultFiles, RUNTIME, hash };
