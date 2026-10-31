'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const YAML = require('../vault/vendor/yaml/dist/index.js');
const { parseJSONC } = require('../config/jsonc.cjs');
const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validName = value => typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split('.').every(n => Number.isSafeInteger(Number(n)));
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const MANIFEST = 'skill-package.json';
const LIMIT = 24 * 1024 * 1024;
function compareVersions(a, b) {
  if (!validVersion(a) || !validVersion(b)) fail('INVALID_VERSION', '版本号必须为主版本.次版本.修订号。');
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function relative(name) {
  if (typeof name !== 'string' || !name || /[\\:*?"<>|\x00-\x1f]/.test(name) || name.split('/').some(s => !s || s === '.' || s === '..' || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) fail('INVALID_SKILL_PACKAGE', 'Skill 包路径无效。');
  return name;
}
function metadata(content, expectedName, { legacy = false } = {}) {
  const front = String(content).replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  if (!front) fail('INVALID_SKILL', 'Skill 缺少 YAML 元数据。');
  const doc = YAML.parseDocument(front, { uniqueKeys: true });
  if (doc.errors.length) fail('INVALID_SKILL', 'Skill YAML 元数据无效。');
  let value;
  try { value = doc.toJS({ maxAliasCount: 0 }); } catch { fail('INVALID_SKILL', 'Skill 元数据不能包含别名。'); }
  if (!validName(value?.name) || expectedName && value.name !== expectedName || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 1024) fail('INVALID_SKILL', 'Skill 名称或简介无效。');
  if (legacy && value.metadata?.version === undefined) return { name: value.name, description: value.description, version: null };
  const m = value.metadata;
  if (!m || typeof m !== 'object' || Array.isArray(m) || Object.values(m).some(v => typeof v !== 'string') || !validVersion(m.version)) fail('INVALID_SKILL', 'Skill metadata.version 必须是独立的三段版本字符串。');
  const compatibility = { workbench: m['workbench-min'], node: m['node-min'], platforms: m.platforms?.split(','), hosts: m.hosts?.split(',') };
  validateCompatibility(compatibility);
  if (typeof m['release-notes'] !== 'string' || !m['release-notes'].trim()) fail('INVALID_SKILL', 'Skill 缺少更新说明。');
  return { name: value.name, description: value.description, version: m.version, compatibility, notes: m['release-notes'] };
}
function validateCompatibility(value) {
  if (!value || !validVersion(value.workbench) || !validVersion(value.node) || !Array.isArray(value.platforms) || !value.platforms.length || value.platforms.some(p => !['win32', 'darwin', 'linux'].includes(p)) || new Set(value.platforms).size !== value.platforms.length || !Array.isArray(value.hosts) || !value.hosts.length || value.hosts.some(h => !['codex', 'claude'].includes(h)) || new Set(value.hosts).size !== value.hosts.length) fail('INVALID_SKILL_PACKAGE', 'Skill 兼容要求无效。');
  return value;
}
function compatibilityReason(requirements, { workbench, node = process.versions.node, platform = process.platform, host } = {}) {
  validateCompatibility(requirements);
  if (!workbench || compareVersions(workbench, requirements.workbench) < 0) return `请先将工作台升级至 v${requirements.workbench}。`;
  if (compareVersions(node, requirements.node) < 0) return `运行工具需要 Node.js ${requirements.node} 或更新版本。`;
  if (!requirements.platforms.includes(platform)) return '此 Skill 版本尚不支持当前系统。';
  if (host && !requirements.hosts.includes(host)) return '此 Skill 版本尚不支持所选 Agent。';
  return '';
}
const contentHash = files => hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
function parseManifest(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { fail('INVALID_SKILL_PACKAGE', 'Skill 包清单不是有效 JSON。'); }
  if (value?.schema !== 1 || value.kind !== 'tt-skill-package' || !validName(value.name) || !validVersion(value.version) || !value.files || Array.isArray(value.files) || typeof value.files !== 'object' || typeof value.notes !== 'string') fail('INVALID_SKILL_PACKAGE', 'Skill 包清单不完整。');
  validateCompatibility(value.compatibility);
  const names = Object.keys(value.files), seen = new Set();
  if (!names.length || names.length > 2000 || !value.files['SKILL.md']) fail('INVALID_SKILL_PACKAGE', 'Skill 包文件数量或入口无效。');
  for (const name of names) {
    relative(name);
    if (name.toLowerCase() === MANIFEST || seen.has(name.toLowerCase()) || !validHash(value.files[name])) fail('INVALID_SKILL_PACKAGE', 'Skill 包文件清单无效。');
    seen.add(name.toLowerCase());
  }
  for (const name of names) for (let parent = path.posix.dirname(name); parent !== '.'; parent = path.posix.dirname(parent)) if (seen.has(parent.toLowerCase())) fail('INVALID_SKILL_PACKAGE', 'Skill 包文件与目录重名。');
  if (contentHash(value.files) !== value.contentHash) fail('VERIFY_FAILED', 'Skill 内容摘要不一致。');
  return value;
}
function validateFiles(manifest, files, { allowUserFiles = false } = {}) {
  manifest = parseManifest(JSON.stringify(manifest));
  if (!allowUserFiles && files.size !== Object.keys(manifest.files).length) fail('INVALID_SKILL_PACKAGE', 'Skill 包有未登记或缺少的文件。');
  let total = 0;
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = files.get(name);
    if (!Buffer.isBuffer(bytes) || hash(bytes) !== expected) fail('SKILL_CONTENT_CHANGED', `Skill 内容需要恢复：${manifest.name}/${name}。原文件已保留。`);
    total += bytes.length;
  }
  if (total > LIMIT) fail('INVALID_SKILL_PACKAGE', 'Skill 包过大。');
  const actual = metadata(files.get('SKILL.md').toString('utf8'), manifest.name);
  if (actual.version !== manifest.version || JSON.stringify(actual.compatibility) !== JSON.stringify(manifest.compatibility) || actual.notes !== manifest.notes) fail('INVALID_SKILL_PACKAGE', 'Skill 包与实际入口元数据不一致。');
  return actual;
}
async function readTree(root, prefix = '', io = fs) {
  const info = await io.lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('UNSAFE_PATH', 'Skill 包目录不是普通目录。');
  const files = new Map();
  for (const entry of await io.readdir(root, { withFileTypes: true })) {
    const name = relative(prefix + entry.name), file = path.join(root, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) fail('UNSAFE_PATH', 'Skill 目录包含链接或特殊文件。');
    if (entry.isDirectory()) for (const [key, bytes] of await readTree(file, name + '/', io)) files.set(key, bytes);
    else files.set(name, await io.readFile(file));
  }
  return files;
}
function inspectTree(files) {
  const manifest = parseManifest(files.get(MANIFEST));
  const managed = new Map(files); managed.delete(MANIFEST);
  const actual = validateFiles(manifest, managed, { allowUserFiles: true });
  return { manifest, actual, files, userFiles: new Map([...managed].filter(([name]) => !Object.hasOwn(manifest.files, name))) };
}
function encodeBundle({ manifest, files }) {
  validateFiles(manifest, files);
  return gzipSync(Buffer.from(JSON.stringify({ manifest, files: Object.fromEntries([...files].map(([name, bytes]) => [name, bytes.toString('base64')])) })), { level: 9 });
}
function decodeBundle(bytes) {
  if (bytes.length > LIMIT) fail('INVALID_SKILL_PACKAGE', 'Skill 下载包过大。');
  let value;
  try { value = JSON.parse(gunzipSync(bytes, { maxOutputLength: LIMIT * 2 })); } catch { fail('INVALID_SKILL_PACKAGE', 'Skill 包无法解压读取。'); }
  const manifest = parseManifest(JSON.stringify(value.manifest));
  if (!value.files || typeof value.files !== 'object' || Array.isArray(value.files)) fail('INVALID_SKILL_PACKAGE', 'Skill 包缺少文件。');
  const files = new Map(Object.entries(value.files).map(([name, data]) => {
    relative(name);
    if (typeof data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) fail('INVALID_SKILL_PACKAGE', 'Skill 包编码无效。');
    return [name, Buffer.from(data, 'base64')];
  }));
  validateFiles(manifest, files);
  return { manifest, files };
}
// One source tree, generated private runtime per Skill. Never include another
// Skill's development content, install data, tests, or publishing credentials.
async function collectPackage(root, name) {
  if (!validName(name)) fail('INVALID_SKILL', 'Skill 名称无效。');
  const source = await readTree(path.join(root, 'skills', name));
  const actual = metadata(source.get('SKILL.md')?.toString('utf8'), name);
  const files = new Map(source);
  if ([...files.keys()].some(n => n === MANIFEST || n.startsWith('runtime/'))) fail('INVALID_SKILL', 'runtime 与包清单由构建生成，不能在 Skill 源码中维护。');
  async function collect(directory) {
    for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      if (['tests', 'data', 'verification', 'vendor-tests'].includes(entry.name) || /\.test\.(cjs|mjs)$/.test(entry.name)) continue;
      const relative = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) fail('UNSAFE_SOURCE', 'Skill 打包源包含链接或特殊文件。');
      if (entry.isDirectory()) await collect(relative);
      else files.set('runtime/' + relative, await fs.readFile(path.join(root, relative)));
    }
  }
  for (const dir of ['lib', 'templates', 'docs/rules', 'docs/agents', 'docs/workbench', 'docs/adr', 'scripts/cloud-files', 'scripts/fns', 'scripts/global-agent-instructions']) await collect(dir);
  for (const file of ['scripts/agent-skills/install.mjs', 'scripts/vault/write.mjs', 'scripts/workbench/issue-request.cjs', 'scripts/workbench/agent-request.mjs', 'scripts/workbench/install.mjs', 'scripts/workbench/runtime-storage.mjs', 'scripts/fns-hidden-audit.mjs', 'apps/workbench/issues.js', 'apps/workbench/issue-format.js', 'apps/workbench/shared.js', 'apps/workbench/manifest.json', 'GLOSSARY.md', 'README.md', 'LICENSE']) files.set('runtime/' + file, await fs.readFile(path.join(root, file)));
  const catalog = parseJSONC(await fs.readFile(path.join(root, 'skills/manifest.jsonc'), 'utf8'));
  files.set('runtime/skills/manifest.jsonc', Buffer.from(JSON.stringify({ skills: [name], presentation: { [name]: catalog.presentation?.[name] || {} } }, null, 2) + '\n'));
  const hashes = Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, bytes]) => [name, hash(bytes)]));
  const manifest = { schema: 1, kind: 'tt-skill-package', name, version: actual.version, compatibility: actual.compatibility, notes: actual.notes, contentHash: contentHash(hashes), files: hashes };
  validateFiles(manifest, files);
  return { manifest, files };
}
module.exports = { MANIFEST, LIMIT, hash, validName, validHash, validVersion, relative, metadata, compareVersions, validateCompatibility, compatibilityReason, contentHash, parseManifest, validateFiles, readTree, inspectTree, encodeBundle, decodeBundle, collectPackage, fail };
