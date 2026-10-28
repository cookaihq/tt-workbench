'use strict';
const within = (item, directory) => item === directory || item.startsWith(`${directory}/`);
// FNS 2.4.0 accepts both a legacy newline list and a JSON rule list.
function parseRules(value) {
  if (!value) return [];
  if (typeof value !== 'string') throw new Error('FNS 规则格式无法识别。');
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith('[') && text.endsWith(']')) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { /* FNS falls back to newline rules. */ }
    if (Array.isArray(parsed)) {
      return parsed.map(rule => typeof rule === 'string'
        ? { pattern: rule, caseSensitive: false }
        : { pattern: rule?.pattern || '', caseSensitive: Boolean(rule?.caseSensitive) })
        .filter(rule => typeof rule.pattern === 'string' && rule.pattern !== '');
    }
  }
  return text.split(/\r?\n/).map(pattern => pattern.trim()).filter(Boolean)
    .map(pattern => ({ pattern, caseSensitive: false }));
}

function matches(item, rule) {
  try {
    if (new RegExp(`^${rule.pattern}`, rule.caseSensitive ? '' : 'i').test(item)) return true;
  } catch { /* FNS falls back to literal path matching for an invalid regex. */ }
  const normalize = value => {
    const result = value.replace(/\\/g, '/');
    return rule.caseSensitive ? result : result.toLowerCase();
  };
  return within(normalize(item), normalize(rule.pattern).replace(/\/$/, ''));
}

module.exports = { parseRules, matches };
