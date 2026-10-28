"use strict";

// Physical directory names. UI labels remain independent of these prefixes.
const ROOTS = Object.freeze({
  inbox: "0.收件箱",
  projects: "1.项目",
  areas: "2.领域",
  resources: "3.资源",
  archives: "4.存档"
});
const BUSINESS_ROOTS = Object.freeze(Object.values(ROOTS));
const LEGACY_ROOTS = Object.freeze({ inbox: "01.收件箱", independent: "02.独立任务", knowledge: "03.知识", resources: "04.资料", areas: "05.领域", experience: "06.经验" });
const READABLE_ROOTS = Object.freeze([...BUSINESS_ROOTS, ...Object.values(LEGACY_ROOTS)]);
const RENAMED_ROOTS = Object.freeze({
  "收件箱": ROOTS.inbox,
  "独立任务": LEGACY_ROOTS.independent,
  "知识": LEGACY_ROOTS.knowledge,
  "资料": ROOTS.resources,
  "领域": ROOTS.areas
});

// Only restore paths persisted in an older workbench view. Read/write APIs still
// require current paths, so stale Agent input cannot recreate the old roots.
function mapPreviousPath(value) {
  if (typeof value !== "string") return "";
  const [first, ...rest] = value.split("/");
  return [RENAMED_ROOTS[first] || first, ...rest].join("/");
}

const ROOT_DOCUMENTS = new Set(["readme.md", "agents.md", "claude.md", "glossary.md"]);

const { VaultError: NoteReadError } = require("./errors.js");

function businessPath(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new NoteReadError("EMPTY_PATH", "请先选择笔记，或输入相对于当前库的笔记路径。");
  }
  const path = value.trim();
  const parts = path.split("/");
  if (/[\\\u0000-\u001f]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)
    || parts.some(part => !part || part === ".." || part.startsWith("."))) {
    throw new NoteReadError("OUT_OF_SCOPE", "只能打开当前库业务范围内的相对路径。");
  }
  if (!/\.md$/i.test(path)) {
    throw new NoteReadError("NOT_MARKDOWN", "请选择 Markdown 笔记（.md 文件）。");
  }
  if (parts.some(part => ["tmp", "node_modules"].includes(part.toLowerCase()))
    || (parts.length === 1 ? ROOT_DOCUMENTS.has(path.toLowerCase()) : !READABLE_ROOTS.includes(parts[0]))) {
    throw new NoteReadError("OUT_OF_SCOPE", "这份文件不在工作台的业务笔记范围内。");
  }
  return path;
}

function isBusinessPath(path) {
  try { businessPath(path); return true; } catch { return false; }
}

function isInboxPath(value) {
  return typeof value === "string" && [ROOTS.inbox, LEGACY_ROOTS.inbox].some(root => value.startsWith(root + "/"));
}

// Existing notes remain editable during migration. New notes and attachments
// must never reintroduce one of the retired roots.
function assertNewPath(value) {
  const root = typeof value === "string" ? value.split("/")[0] : "";
  if (Object.values(LEGACY_ROOTS).includes(root)) throw new NoteReadError("LEGACY_WRITE", "旧目录仅供读取与维护已有记录；请先迁入新的五个目录，再新增内容。");
  return value;
}

function newBusinessPath(value) { return assertNewPath(businessPath(value)); }


module.exports = { ROOTS, BUSINESS_ROOTS, LEGACY_ROOTS, READABLE_ROOTS, RENAMED_ROOTS, mapPreviousPath, businessPath, isBusinessPath, isInboxPath, assertNewPath, newBusinessPath };
