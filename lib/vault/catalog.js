"use strict";
const { isInboxPath } = require("./paths.js");
const { localCreation, creationInstant } = require("./time.js");
function inboxMetadata(frontmatter, allowIncomplete = false) {
  if (frontmatter?.type !== "inbox" && !allowIncomplete) return null;
  frontmatter = frontmatter || {};
  const timestamp = creationInstant(frontmatter.created, frontmatter.created_timezone);
  const shown = timestamp === null ? null : localCreation(new Date(timestamp));
  const warnings = [];
  if (frontmatter.type !== "inbox") warnings.push("尚未应用收件箱模板，或记录类型需要核对。");
  if (!["pending", "reviewed"].includes(frontmatter.inbox_status)) warnings.push("整理状态缺失或无效，请在原笔记中核对。");
  if (timestamp === null) warnings.push("创建时间或时区缺失／无效，无法确定排序时间。");
  return {
    title: typeof frontmatter.title === "string" ? frontmatter.title : "",
    status: { pending: "待整理", reviewed: "已整理" }[frontmatter.inbox_status] || "整理状态缺失或无效",
    statusValue: frontmatter.inbox_status, warnings,
    created: frontmatter.created, offset: frontmatter.created_timezone, timestamp,
    displayTime: shown ? `${shown.created} UTC${shown.created_timezone}` : "创建时间或时区缺失／无效",
    sources: Array.isArray(frontmatter.source_urls) ? frontmatter.source_urls.filter(value => typeof value === "string") : []
  };
}

function inAttachmentFolder(notePath, setting) {
  if (typeof setting !== "string" || !setting || setting === "." || setting === "/") return false;
  const clean = setting.replace(/\/$/, "");
  if (clean.startsWith("./")) return (`/${notePath}`).includes(`/${clean.slice(2)}/`);
  return notePath.startsWith(`${clean}/`);
}

// Metadata decides identity; directory depth and the filename do not identify
// a record. Ambiguous nested Markdown remains separately reachable for review.
function inboxCatalog(files, getFields, attachmentSetting) {
  const referenced = new Set(files.flatMap(file => {
    const values = getFields(file.path)?.attachments;
    return Array.isArray(values) ? values.filter(value => typeof value === "string") : [];
  }));
  const entries = files.filter(file => isInboxPath(file.path)).map(file => {
    const fields = getFields(file.path) || {};
    const auxiliary = referenced.has(file.path) || inAttachmentFolder(file.path, attachmentSetting) || file.path.endsWith("/源文件位置.md");
    const kind = auxiliary ? "auxiliary" : fields.type === "inbox" ? "record"
      : fields.type ? "auxiliary" : file.path.split("/").length === 2 ? "incomplete" : "uncertain";
    return { ...file, kind, id: typeof fields.id === "string" && fields.id ? fields.id : null,
      inbox: inboxMetadata(fields, kind === "incomplete" || kind === "uncertain") };
  });
  const byId = new Map();
  for (const entry of entries.filter(e => e.kind !== "auxiliary" && e.id)) {
    if (!byId.has(entry.id)) byId.set(entry.id, []);
    byId.get(entry.id).push(entry.path);
  }
  for (const entry of entries) {
    entry.duplicates = byId.get(entry.id)?.filter(value => value !== entry.path) || [];
    if (entry.duplicates.length && entry.inbox) entry.inbox.warnings.push(`标识重复，请核对：${entry.duplicates.join("；")}`);
    if (entry.kind === "uncertain") entry.inbox.warnings.unshift("嵌套文件身份不明，请核对是否为独立收件箱记录。");
  }
  return entries;
}


module.exports = {inboxMetadata,inboxCatalog,inAttachmentFolder};
