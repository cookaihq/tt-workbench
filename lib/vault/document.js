"use strict";
const YAML = require("./vendor/yaml/dist/index.js");
const { isDeepStrictEqual } = require("node:util");
const { VaultError } = require("./errors.js");
const { localCreation } = require("./time.js");

function parseDocument(source) {
  const doc = YAML.parseDocument(source, { keepSourceTokens: true, uniqueKeys: true, merge: true });
  if (doc.errors.length) throw new VaultError("INVALID_YAML", "YAML 属性无法解析，未修改原笔记。", { reason: doc.errors[0].message });
  if (doc.contents && !YAML.isMap(doc.contents)) throw new VaultError("INVALID_YAML", "笔记属性必须是键值形式。");
  return doc;
}
function parseYaml(source) { return parseDocument(source).toJS({ maxAliasCount: 100 }) || {}; }
function documentParts(content) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  if (!match) {
    if (/^(?:\uFEFF)?---(?:\r?\n|$)/.test(content)) throw new VaultError("INVALID_YAML", "笔记属性未正确结束，未修改原笔记。");
    return { fields: {}, yaml: "", prefix: "", body: content, eol };
  }
  return { fields: parseYaml(match[1]), yaml: match[1], prefix: match[0], body: content.slice(match[0].length), eol };
}
function getFrontMatterInfo(content) {
  const p = documentParts(content);
  return { exists: Boolean(p.prefix), frontmatter: p.yaml, contentStart: p.prefix.length };
}
function patchFields(content, changes) {
  if (!Object.keys(changes).length) return content;
  const p = documentParts(content), doc = parseDocument(p.yaml), replacements = [], additions = [];
  for (const [key, value] of Object.entries(changes)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || value === undefined) throw new VaultError("INVALID_FIELD", "属性名或属性值无效。");
    if (isDeepStrictEqual(p.fields[key], value)) continue;
    const pair = doc.contents?.items.find(item => item.key?.value === key);
    if (!pair) {
      if (Object.hasOwn(p.fields, key) || doc.contents?.flow) throw new VaultError("UNSUPPORTED_YAML", `属性 ${key} 的写法暂不支持局部修改。`);
      additions.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      if (!pair.value?.range || pair.value.anchor) throw new VaultError("UNSUPPORTED_YAML", `属性 ${key} 的锚点或写法需要人工核对。`);
      const [start, end] = pair.value.range;
      const old = p.yaml.slice(start, end);
      replacements.push({ start, end, value: JSON.stringify(value) + (old.endsWith(p.eol) ? p.eol : "") });
    }
  }
  let nextYaml = p.yaml;
  for (const r of replacements.sort((a, b) => b.start - a.start)) nextYaml = nextYaml.slice(0, r.start) + r.value + nextYaml.slice(r.end);
  if (additions.length) nextYaml += (nextYaml && !nextYaml.endsWith(p.eol) ? p.eol : "") + additions.join(p.eol);
  const after = parseYaml(nextYaml);
  for (const [key, value] of Object.entries({ ...p.fields, ...changes })) {
    if (!isDeepStrictEqual(after[key], value)) throw new VaultError("UNSUPPORTED_YAML", `修改会影响属性 ${key}，未写回。`);
  }
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  return `${bom}---${p.eol}${nextYaml}${nextYaml.endsWith(p.eol) ? "" : p.eol}---${p.eol}${p.prefix ? p.body : p.eol + p.body}`;
}
function appendSupplement(content, text, now = new Date()) {
  if (typeof text !== "string" || !text.trim()) throw new VaultError("EMPTY_INPUT", "没有要追加的文字或来源。");
  const time = localCreation(now), eol = content.includes("\r\n") ? "\r\n" : "\n";
  return `${content}${content.endsWith(eol) ? eol : eol + eol}## 后续补充 · ${time.created} UTC${time.created_timezone}${eol}${eol}${text}${text.endsWith(eol) ? "" : eol}`;
}
function proposedUpdate(expected, { fields = {}, append = "", body } = {}, now = new Date()) {
  let proposed = patchFields(expected, fields);
  if (body !== undefined) {
    if (typeof body !== "string") throw new VaultError("INVALID_INPUT", "正文必须为字符串。");
    const parts = documentParts(proposed); proposed = parts.prefix + body;
  }
  return append ? appendSupplement(proposed, append, now) : proposed;
}
function newDocument(fields, body) { return `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n${body}`; }
module.exports = { parseYaml, documentParts, getFrontMatterInfo, patchFields, appendSupplement, proposedUpdate, newDocument };
