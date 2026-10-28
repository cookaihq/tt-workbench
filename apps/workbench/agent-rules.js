"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const SKILL = "tannt-organize-agent-rules";
const MAX_BYTES = 1024 * 1024;
const LABELS = Object.freeze({ linked: "直接符号链接", file: "普通文件", directory: "普通目录", other: "指向其他位置", indirect: "经过中间链接", broken: "符号链接已失效", missing: "入口不存在", unknown: "无法判断", invalid: "类型不符合", present: "存在非空覆盖文件", empty: "覆盖文件为空", none: "无覆盖文件", na: "不适用" });
const errorText = error => `${error.code || "READ_FAILED"}：${error.message}`;
const same = (a, b) => {
  const normalize = value => path.resolve(value.replace(/^\\\\\?\\/, ""));
  return process.platform === "win32" ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b);
};

// This reader has no write API and accepts no arbitrary file path from the UI.
// Only fixed Agent entries and ordinary Markdown under the formal source are read.
class AgentRulesReader {
  constructor(root, { home = os.homedir(), env = process.env, io = fs, sourceRoot, sourceDirectory } = {}) {
    // rulesRoot is the previously explicit repository root. New selections name
    // the actual rules directory, so unrelated vaults/packages are never a fallback.
    if (sourceDirectory && !path.isAbsolute(sourceDirectory) || sourceRoot && !path.isAbsolute(sourceRoot)) throw Error('规则源必须是明确的绝对路径。');
    this.root = path.resolve(root); this.sourceRoot = sourceDirectory ? path.resolve(sourceDirectory) : sourceRoot ? path.join(sourceRoot, 'docs/global-agent-instructions') : null;
    this.home = home; this.env = env; this.io = io;
  }

  config(agent) {
    if (!["codex", "claude"].includes(agent)) throw Error("不支持的 Agent");
    const variable = agent === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
    const configured = this.env[variable];
    // A relative environment path depends on the launching process's cwd.
    // Do not silently resolve it against the vault and claim this is the Agent's home.
    if (configured && !path.isAbsolute(configured)) throw Error(`${variable} 为相对路径，无法从工作台确定 Agent 的配置目录：${configured}`);
    return { agent, name: agent === "codex" ? "Codex" : "Claude Code", variable,
      directory: configured || path.join(this.home, agent === "codex" ? ".codex" : ".claude"), custom: Boolean(configured) };
  }

  async readText(file) {
    const stat = await this.io.stat(file);
    if (!stat.isFile()) throw Error("规则正文不是普通文件");
    const handle = await this.io.open(file, "r");
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.size > MAX_BYTES) throw Error("规则文件不是普通文件或超过 1 MiB，未读取");
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length, length);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > MAX_BYTES) throw Error("规则文件超过 1 MiB，未读取");
      const text = bytes.subarray(0, length).toString("utf8");
      if (text.includes("\0")) throw Error("文件不是可浏览的文本");
      return text;
    } finally { await handle.close(); }
  }

  async inspect(entry, expected, kind) {
    const result = { entry, expected, target: "", resolved: "", status: "unknown", type: "未确定" };
    try {
      let info;
      try { info = await this.io.lstat(entry); }
      catch (error) { if (error.code === "ENOENT") return { ...result, status: "missing", type: "不存在" }; throw error; }
      if (!info.isSymbolicLink()) {
        return { ...result, status: info.isFile() ? "file" : info.isDirectory() ? "directory" : "invalid", type: info.isFile() ? "普通文件" : info.isDirectory() ? "普通目录" : "其他类型" };
      }
      result.type = "符号链接";
      result.target = path.resolve(path.dirname(entry), await this.io.readlink(entry));
      let targetInfo;
      try { result.resolved = await this.io.realpath(entry); targetInfo = await this.io.stat(entry); }
      catch (error) { if (error.code === "ENOENT" || error.code === "ELOOP") return { ...result, status: "broken", reason: errorText(error) }; throw error; }
      if (kind === "file" ? !targetInfo.isFile() : !targetInfo.isDirectory()) return { ...result, status: "invalid" };
      if (same(result.target, expected) && same(result.resolved, expected)) result.status = "linked";
      else result.status = same(result.resolved, expected) ? "indirect" : "other";
      return result;
    } catch (error) { return { ...result, status: "unknown", reason: errorText(error) }; }
  }

  async assertOrdinary(relative, kind) {
    if (!this.sourceRoot) throw Error('请先选择正式规则源目录。');
    const rootInfo = await this.io.lstat(this.sourceRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !same(await this.io.realpath(this.sourceRoot), this.sourceRoot)) throw Error('规则源目录不是普通目录或经过其他链接。');
    let current = this.sourceRoot;
    const parts = relative.split("/");
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      const info = await this.io.lstat(current);
      if (info.isSymbolicLink() || (i < parts.length - 1 || kind === "directory" ? !info.isDirectory() : !info.isFile())) throw Error(`正式源不是普通${kind === "directory" ? "目录" : "文件"}：${current}`);
    }
    return current;
  }

  async documents() {
    const documents = [], errors = [];
    if (!this.sourceRoot) return { documents, errors: ['请先选择正式规则源目录。'] };
    const add = async relative => {
      const file = path.join(this.sourceRoot, relative);
      try {
        await this.assertOrdinary(relative, "file");
        const content = await this.readText(file);
        if (!content.trim()) throw Error("正式规则为空");
        documents.push({ id: relative, path: file, title: content.match(/^#\s+(.+)$/m)?.[1] || path.basename(file), group: relative === "AGENTS.md" ? "主规则" : "场景规则", origin: "所选规则源", content });
      } catch (error) { errors.push(`${file} · ${errorText(error)}`); }
    };
    await add("AGENTS.md");
    const walk = async (relative, depth) => {
      if (depth > 6 || documents.length >= 128) throw Error("场景目录超出浏览范围（最多 6 层、128 份文件）");
      const directory = await this.assertOrdinary(relative, "directory");
      const entries = (await this.io.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isSymbolicLink()) { errors.push(`${path.join(directory, entry.name)} · 场景内部的符号链接未读取`); continue; }
        if (entry.isDirectory()) await walk(`${relative}/${entry.name}`, depth + 1);
        else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          if (documents.length >= 128) throw Error("场景目录超过 128 份文件");
          await add(`${relative}/${entry.name}`);
        }
      }
    };
    try { await walk("scenarios-agent-instructions", 0); }
    catch (error) { errors.push(errorText(error)); }
    return { documents, errors };
  }

  async override(agent, directory) {
    if (agent !== "codex") return { status: "na" };
    const entry = path.join(directory, "AGENTS.override.md");
    try {
      await this.io.lstat(entry);
      const content = await this.readText(entry);
      return { entry, status: content.trim() ? "present" : "empty", content };
    } catch (error) {
      if (error.code === "ENOENT") {
        // lstat succeeds for dangling links; these must not be called absent.
        try { await this.io.lstat(entry); } catch (second) { if (second.code === "ENOENT") return { entry, status: "none" }; }
      }
      return { entry, status: "unknown", reason: errorText(error) };
    }
  }

  async skillAvailable(agent) {
    const entry = path.join(this.root, agent === "codex" ? ".agents" : ".claude", "skills", SKILL, "SKILL.md");
    try { return { available: Boolean((await this.readText(entry)).trim()), entry }; }
    catch { return { available: false, entry }; }
  }

  async scan(agent = "codex") {
    if (!["codex", "claude"].includes(agent)) throw Error("不支持的 Agent");
    // Canonicalize the vault once for direct-target comparisons.
    this.root = await this.io.realpath(this.root);
    const source = this.sourceRoot;
    const catalog = await this.documents();
    if (!source) return { ...catalog, agent, name: agent === 'codex' ? 'Codex' : 'Claude Code', root: this.root, source: '', status: 'unconfigured', checkedAt: new Date().toISOString(), entries: [], override: { status: 'na' }, skill: await this.skillAvailable(agent) };
    let config;
    try { config = this.config(agent); }
    catch (error) {
      const scenarios = await this.inspect(path.join(this.home, ".agents/scenarios-agent-instructions"), path.join(source, "scenarios-agent-instructions"), "directory");
      return { ...catalog, agent, name: agent === "codex" ? "Codex" : "Claude Code", root: this.root, source, status: "unknown", checkedAt: new Date().toISOString(), entries: [{ ...scenarios, id: "scenarios", title: "共用场景入口" }], override: { status: "unknown", reason: error.message }, skill: await this.skillAvailable(agent), reason: error.message };
    }
    const [main, scenarios, override, skill] = await Promise.all([
      this.inspect(path.join(config.directory, agent === "codex" ? "AGENTS.md" : "CLAUDE.md"), path.join(source, "AGENTS.md"), "file"),
      this.inspect(path.join(this.home, ".agents/scenarios-agent-instructions"), path.join(source, "scenarios-agent-instructions"), "directory"),
      this.override(agent, config.directory), this.skillAvailable(agent)
    ]);
    if (["file", "linked", "other", "indirect"].includes(main.status)) {
      try {
        const content = await this.readText(main.entry);
        if (main.status !== "linked") catalog.documents.push({ id: "local-main", title: "本机现有全局规则", path: main.entry, origin: "本机入口正文", group: "本机文件", content });
      } catch (error) { main.status = "unknown"; main.reason = errorText(error); }
    }
    if (override.status === "present") catalog.documents.push({ id: "local-override", title: "本机覆盖文件", path: override.entry, origin: "本机覆盖文件", group: "本机文件", content: override.content });
    delete override.content;
    const entries = [{ ...main, id: "main", title: "本机主规则" }, { ...scenarios, id: "scenarios", title: "共用场景入口" }];
    const unknown = entries.some(item => item.status === "unknown") || override.status === "unknown" || catalog.errors.length > 0;
    const status = unknown ? "unknown" : entries.every(item => item.status === "linked") && override.status !== "present" ? "connected" : "attention";
    return { ...catalog, ...config, root: this.root, source, entries, override, skill, status, checkedAt: new Date().toISOString() };
  }
}

function skillPrompt(snapshot) {
  if (!snapshot.source) return '请先在 Agent 规则页面选择已确认的正式规则源，再核对本机入口。';
  const lines = [`${snapshot.agent === 'claude' ? '/' : '$'}${SKILL}`, "", `请在当前项目 ${snapshot.root} 中，检查当前电脑的 ${snapshot.name} 全局 Agent 规则。`, "页面读取到以下文件与链接事实："];
  for (const item of snapshot.entries) lines.push(`- ${item.title}：${item.entry}；${LABELS[item.status]}${item.target ? `；实际目标：${item.target}` : ""}；预期正式源：${item.expected}${item.reason ? `；${item.reason}` : ""}`);
  if (snapshot.override.entry) lines.push(`- 覆盖文件：${snapshot.override.entry}；${LABELS[snapshot.override.status]}`);
  if (snapshot.reason) lines.push(`- ${snapshot.reason}`);
  for (const error of snapshot.errors) lines.push(`- 读取问题：${error}`);
  lines.push(`目标主规则：${path.join(snapshot.source, "AGENTS.md")}`, `目标场景目录：${path.join(snapshot.source, "scenarios-agent-instructions")}`, "");
  lines.push('正式规则源由本人选择的知识库或规则仓库维护；重新核对该目录中的 README.md 与维护场景说明。', '');
  const main = snapshot.entries.find(item => item.id === "main");
  const scenarios = snapshot.entries.find(item => item.id === "scenarios");
  if (!main || main.status === "unknown" || main.status === "linked" && (!scenarios || scenarios.status === "unknown")) {
    lines.push("当前任务：核实入口状态。", "请先核实实际配置目录和无法读取的入口。确认主文件未按项目约定接入后，再提出已有规则的整理及接入方案；若主文件已接入、只有场景入口未接入，则保留已正确接入的主文件，核查并补齐场景入口。具体文件及入口操作与我确认后再执行。");
  } else if (main.status !== "linked") {
    lines.push("当前任务：整理并接入主规则。", "主规则入口尚未按项目约定直接链接到正式源。请重新核实实际配置目录、已有规则原文及引用，梳理含义不明确的条款，按当前项目约定提出主规则与场景规则的拆分及接入方案。先向我展示具体条款、去向和文件／入口操作，与我确认后再按获准范围写入正式源、建立或修复所需链接，并验证主规则与场景的读取。");
  } else if (scenarios.status !== "linked") {
    lines.push("当前任务：补齐场景规则入口。", "主规则已经直接链接到所选规则正式源，请保留其正文与链接。请重新核实共用场景入口的实际状态，以及主文件中引用的场景路径；如入口已有普通目录、其他来源链接或遗留内容，先读取必要旧内容并说明去向。向我展示拟建立或修复的场景目录链接、已有内容处置及对共用入口使用方的影响，与我确认后再执行，并验证通过主规则中的路径可读取场景文件。仅发现确需澄清或合并的内容时，就这些内容另行提出方案。");
  } else {
    lines.push("当前任务：核查覆盖文件或读取问题。", "主规则与场景入口均已直接链接到所选规则正式源，请保留已正确接入的入口，核实页面列出的覆盖文件或读取问题。涉及已有内容处置或文件修改时，展示具体方案，与我确认后再执行并验证读取结果。");
  }
  lines.push("", `在 ${snapshot.name} 会话中执行，默认仅处理当前 Agent；共用场景入口的影响须说明。页面状态不代表任何现有 Agent 会话已加载这些规则。`);
  if (!snapshot.skill.available) lines.push("", `工作台尚未在此 Agent 的项目发现入口读到 ${SKILL}。请先在 Skill 安装页面处理，再由宿主新会话核对发现结果。`);
  return lines.join("\n");
}

module.exports = { AgentRulesReader, skillPrompt, LABELS };
