"use strict";
const { VaultError } = require("./errors.js");
const { documentParts } = require("./document.js");

// These objects need their owning workflow to coordinate remote state. A local
// file transaction cannot claim to have completed a cloud or Lark move.
function assertOrdinaryMove(name, bytes) {
  const text = /\.(?:md|ya?ml|json)$/i.test(name) ? bytes.toString("utf8") : "";
  if (/\.(?:mp3|mp4|mov|wav|zip)(?:\.ya?ml)?$/i.test(name) || /(?:^|\n)\s*schema:\s*["']?tannt-cloud-file\/v1/.test(text)) {
    throw new VaultError("CLOUD_WORKFLOW_REQUIRED", `包含网盘托管文件：${name}；请使用 tt-cloud-files 统筹网盘路径、本地文件与引用。`, { path: name });
  }
  let fields = {};
  if (/\.md$/i.test(name)) {
    try { fields = documentParts(text).fields; }
    catch (error) {
      if (error.code !== "INVALID_YAML") throw error;
      // Original Markdown attachments can be incomplete documents. Inspect
      // potential sync metadata without treating them as editable notes.
      if (/^---\r?\n[\s\S]*?^lark_[^:\n]+:/m.test(text)) fields.lark_unknown = true;
    }
  }
  if (name.split("/").includes("飞书知识库") || Object.keys(fields).some(key => key.startsWith("lark_"))) {
    throw new VaultError("LARK_WORKFLOW_REQUIRED", `涉及飞书同步内容：${name}；请通过飞书知识库编辑与同步流程核对并迁移完整同步单元。`, { path: name });
  }
}

module.exports = { assertOrdinaryMove };
