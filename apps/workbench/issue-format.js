"use strict";

const TRIAGE = Object.freeze({ "needs-triage": "待评估", "needs-info": "待补充信息", "ready-for-agent": "可交给 Agent", "ready-for-human": "需人工实施" });
const STATES = Object.freeze({ open: "未关闭", completed: "已关闭 · 已完成", "not-planned": "已关闭 · 不计划实施", unknown: "关闭状态待确认" });
const PRIORITIES = Object.freeze({ "": "未设置", high: "高", medium: "中", low: "低" });
const WAYFINDING = new Set(["research", "prototype", "grilling", "task"]);
const validTime = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

class IssueError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = "IssueError"; this.code = code; Object.assign(this, extra); }
}

// Offsets refer to the original bytes-as-JS-string, preserving CRLF and untouched sections.
function linesOf(content) {
  const lines = []; let offset = 0, fence = null;
  for (const raw of content.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const text = raw.replace(/\r?\n$/, "");
    const marker = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const inFence = Boolean(fence);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], size: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.size && !marker[2].trim()) fence = null;
    }
    lines.push({ text, raw, start: offset, end: offset + raw.length, code: inFence || Boolean(marker) });
    offset += raw.length;
  }
  return lines;
}

function parseIssue(content, relative) {
  const lines = linesOf(content), titleLine = lines.find(l => !l.code && /^#\s+/.test(l.text));
  const warnings = [], errors = [], fields = {}, fieldLines = {};
  const prefixEnd = titleLine?.start ?? 0;
  for (const line of lines.filter(l => l.start < prefixEnd)) {
    const match = line.text.match(/^([A-Za-z][A-Za-z -]*):\s*(.*)$/);
    if (!match) continue;
    if (Object.hasOwn(fields, match[1])) errors.push(`属性重复：${match[1]}`);
    fields[match[1]] = match[2]; fieldLines[match[1]] = line;
  }
  if (!titleLine) errors.push("缺少一级标题，暂不能通过表单修改。");
  const sections = lines.filter(l => !l.code && /^## (Comments|Activity)\s*$/.test(l.text));
  const commentsLine = sections.find(l => l.text.trim() === "## Comments");
  const activityLine = sections.find(l => l.text.trim() === "## Activity");
  if (sections.length !== Number(Boolean(commentsLine)) + Number(Boolean(activityLine))) errors.push("Comments 或 Activity 标题重复，请先在文件中整理。");
  if (commentsLine && activityLine && commentsLine.start > activityLine.start) errors.push("Comments 必须位于 Activity 之前。");
  const bodyStart = titleLine?.end ?? 0;
  const bodyEnd = sections[0]?.start ?? content.length;
  const description = content.slice(bodyStart, bodyEnd);
  const commentsRaw = commentsLine ? content.slice(commentsLine.end, activityLine?.start ?? content.length) : "";
  const activity = activityLine ? content.slice(activityLine.end) : "";
  const list = name => {
    if (!fields[name]) return [];
    try { const value = JSON.parse(fields[name]); if (!Array.isArray(value) || !value.every(v => typeof v === "string" && v.trim())) throw Error(); return value; }
    catch { errors.push(`${name} 必须是 JSON 字符串数组。`); return []; }
  };
  const wayfinding = WAYFINDING.has(fields.Type);
  let state = ["open", "completed", "not-planned"].includes(fields.State) ? fields.State : "unknown";
  if (fields.State && state === "unknown") errors.push(`无法识别 State：${fields.State}`);
  if (wayfinding) state = fields.Status === "resolved" ? "completed" : ["claimed", "unclaimed", "open", "pending", ""].includes(fields.Status || "") ? "open" : "unknown";
  const triage = fields.Status || "";
  if (!wayfinding && triage && !Object.hasOwn(TRIAGE, triage) && triage !== "wontfix") errors.push(`无法识别分诊结果：${triage}`);
  if (triage === "wontfix") warnings.push("旧 wontfix 尚未迁入关闭结果。");
  if (state === "unknown") warnings.push("关闭状态未登记，不根据正文或清单推断。");
  const priority = fields.Priority || "";
  if (!Object.hasOwn(PRIORITIES, priority)) errors.push(`无法识别优先级：${priority}`);
  const checks = linesOf(description).filter(l => !l.code && /^\s*[-*+] \[[ xX]\] /.test(l.text)).map((l, index) => ({ index, done: /\[[xX]\]/.test(l.text), label: l.text.replace(/^\s*[-*+] \[[ xX]\] /, ""), offset: bodyStart + l.start + l.text.indexOf("[") + 1 }));
  const comments = []; let legacyComments = commentsRaw;
  const commentLines = linesOf(commentsRaw); let cursor = 0, legacy = "";
  for (let i = 0; i < commentLines.length; i++) {
    const start = commentLines[i]; if (start.code || !start.text.startsWith("<!-- tannt-comment:")) continue;
    const endIndex = commentLines.findIndex((l, j) => j > i && !l.code && l.text === "<!-- /tannt-comment -->");
    try {
      const match = start.text.match(/^<!-- tannt-comment:(\{.*\}) -->$/);
      const meta = JSON.parse(match?.[1] || "");
      if (typeof meta.id !== "string" || !meta.id || typeof meta.author !== "string" || !validTime(meta.created) || meta.updated && !validTime(meta.updated) || endIndex < 0 || comments.some(c => c.id === meta.id)) throw Error();
      const end = commentLines[endIndex];
      comments.push({ ...meta, body: commentsRaw.slice(start.end, end.start).replace(/\r?\n$/, ""), start: (commentsLine?.end || 0) + start.start, end: (commentsLine?.end || 0) + end.end });
      legacy += commentsRaw.slice(cursor, start.start); cursor = end.end; i = endIndex;
    } catch { errors.push("评论标记损坏或重复，请先核对原文件。"); }
  }
  if (comments.length) legacyComments = legacy + commentsRaw.slice(cursor);
  for (const name of ["Created", "Updated"]) if (fields[name] && !validTime(fields[name])) errors.push(`${name} 时间无效或缺少时区。`);
  if (fields["Duplicate of"] && state !== "not-planned") errors.push("重复标记只适用于关闭为不计划实施的记录。");
  const match = relative.match(/^\.scratch\/([^/]+)\/issues\/(\d+)-[^/]+\.md$/);
  const feature = match?.[1] || "", number = match ? Number(match[2]) : 0;
  if (!Number.isSafeInteger(number) || number < 1) errors.push("Issue 编号必须是有效的正整数。");
  return { path: relative, content, fields, fieldLines, titleLine, description, bodyStart, bodyEnd, commentsLine, activityLine, comments, legacyComments, activity, checks,
    feature, number, ref: `${feature}#${String(number).padStart(2, "0")}`, title: titleLine?.text.replace(/^#\s+/, "") || relative.split("/").at(-1),
    state, triage, wayfinding, priority, labels: list("Labels"), blockedBy: wayfinding ? (fields["Blocked by"] || "").split(",").map(s => s.trim()).filter(Boolean).map(s => s.includes("#") ? s : `${feature}#${s.padStart(2, "0")}`) : list("Blocked by"), related: list("Related"), duplicateOf: fields["Duplicate of"] || "", created: validTime(fields.Created) ? fields.Created : "", updated: validTime(fields.Updated) ? fields.Updated : "", warnings, errors };
}

function patchFields(content, relative, values) {
  const note = parseIssue(content, relative), eol = content.includes("\r\n") ? "\r\n" : "\n";
  const edits = [], additions = [];
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && (typeof value !== "string" || /[\r\n]/.test(value))) throw new IssueError("INVALID_INPUT", `属性 ${key} 必须是单行文本。`);
    const line = note.fieldLines[key];
    if (line) edits.push({ start: line.start, end: line.end, value: value === null ? "" : `${key}: ${value}${eol}` });
    else if (value !== null) additions.push(`${key}: ${value}${eol}`);
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.value + content.slice(edit.end);
  return additions.join("") + content;
}

function appendSection(content, relative, name, value) {
  const note = parseIssue(content, relative), eol = content.includes("\r\n") ? "\r\n" : "\n";
  value = value.replace(/\r?\n/g, eol);
  const before = name === "Comments" ? note.activityLine?.start ?? content.length : content.length;
  const exists = name === "Comments" ? note.commentsLine : note.activityLine;
  const head = content.slice(0, before), tail = content.slice(before);
  return head + (head.endsWith(eol + eol) ? "" : head.endsWith(eol) ? eol : eol + eol) + (exists ? "" : `## ${name}${eol}${eol}`) + value + eol + eol + tail;
}

module.exports = { IssueError, TRIAGE, STATES, PRIORITIES, linesOf, parseIssue, patchFields, appendSection };
