'use strict';
const { createHash } = require('node:crypto');
const { parseJSONC } = require('../config/jsonc.cjs');
const FIELDS = ['configSyncOtherDirs', 'syncExcludeFolders', 'syncExcludeExtensions', 'syncExcludeWhitelist'];
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function parseConfig(raw) {
  try {
    const result = JSON.parse(raw);
    parseJSONC(raw); // Reject duplicate keys without exposing parser excerpts.
    if (result && typeof result === 'object' && !Array.isArray(result)) return result;
  } catch { /* No credential-bearing parser diagnostics. */ }
  fail('INVALID_CONFIG', 'FNS 配置不是有效且无重复键的 JSON 对象。');
}
function parseRules(value, field) {
  if (value === undefined || value === '') return [];
  if (typeof value !== 'string') fail('INVALID_RULES', `${field} 必须使用 FNS 字符串格式。`);
  let entries;
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try { entries = parseJSONC(text); JSON.parse(text); } catch { fail('INVALID_RULES', `${field} 的规则数组无法解析。`); }
    if (!Array.isArray(entries)) fail('INVALID_RULES', `${field} 不是规则数组。`);
  } else entries = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return entries.map(entry => {
    const r = typeof entry === 'string' ? { pattern: entry } : entry;
    if (!r || typeof r.pattern !== 'string' || !r.pattern.trim() || Object.keys(r).some(k => !['pattern', 'caseSensitive'].includes(k))
        || r.caseSensitive !== undefined && typeof r.caseSensitive !== 'boolean') fail('INVALID_RULES', `${field} 含无法识别的规则或选项。`);
    let pattern = r.pattern;
    if (field === 'configSyncOtherDirs') {
      pattern = pattern.trim().replace(/\\/g, '/').replace(/\/+$/, '');
      if (!pattern || pattern.startsWith('/') || /^[a-z]:/i.test(pattern) || pattern.split('/').some(p => !p || p === '.' || p === '..')) fail('INVALID_RULES', '额外目录必须是库内相对目录。');
    }
    if (field === 'syncExcludeExtensions') pattern = pattern.replace(/^\./, '').toLowerCase();
    return { pattern, caseSensitive: field === 'syncExcludeExtensions' ? false : Boolean(r.caseSensitive) };
  });
}
const normalize = config => Object.fromEntries(FIELDS.map(field => [field, parseRules(config[field], field)]));
const fingerprint = rules => hash(JSON.stringify(rules));
function difference(from, to) {
  const key = r => JSON.stringify(r);
  return Object.fromEntries(FIELDS.map(field => [field, {
    add: to[field].filter(r => !from[field].some(p => key(r) === key(p))),
    remove: from[field].filter(r => !to[field].some(p => key(r) === key(p)))
  }]));
}
function validateScope(rules, protectedDirs = ['config/fns-config', 'apps/workbench/data']) {
  for (const directory of protectedDirs) {
    const segments = directory.split('/');
    const prefixes = segments.map((_, i) => segments.slice(0, i + 1).join('/'));
    const escaped = prefixes.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!rules.syncExcludeFolders.some(r => [...prefixes, ...escaped].some(p => [p, p + '/', '^' + p, '^' + p + '/', '^' + p + '(?:/|$)'].includes(r.pattern)))) {
      fail('PROTECTED_SCOPE', `必须保留 ${directory}/ 的明确目录排除；请在 FNS 设置中修正后重试。`);
    }
    for (const r of rules.syncExcludeWhitelist) {
      // A whitelist with no provably disjoint literal prefix may admit a future
      // recovery file even when it matches none of today's files. Fail closed.
      const text = r.pattern.replace(/^\^/, '');
      if (text.includes('|')) fail('PROTECTED_SCOPE', '白名单含分支表达式，无法证明不会覆盖受保护目录，请使用明确目录。');
      const literal = text.match(/^(?:[a-z0-9_/-]|\\[.\-/])+/i)?.[0] || '';
      let prefix = literal.replace(/\\(.)/g, '$1');
      if (['*', '?', '{'].includes(text[literal.length])) prefix = prefix.slice(0, -1);
      const a = prefix.toLowerCase(), b = directory.toLowerCase();
      if (!a || a.startsWith(b) || b.startsWith(a)) fail('PROTECTED_SCOPE', `白名单可能覆盖 ${directory}/；请收窄为明确的其他目录。`);
    }
  }
}
module.exports = { FIELDS, hash, fail, parseConfig, normalize, fingerprint, difference, validateScope };
