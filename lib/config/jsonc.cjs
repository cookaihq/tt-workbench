'use strict';

const { parseTree, stripComments } = require('./vendor/jsonc-parser/lib/umd/main.js');

function configError(code, message, text, offset) {
  const before = text.slice(0, offset);
  const line = before.split(/\r\n|\r|\n/u).length;
  const column = offset - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
  return Object.assign(new SyntaxError(`${message}（第 ${line} 行，第 ${column} 列）`), { code, line, column });
}

// JSON plus comments only. Never accept the parser's recovered partial result.
function parseJSONC(source) {
  const text = source.replace(/^\uFEFF/u, '');
  const errors = [];
  const tree = parseTree(text, errors, { disallowComments: false, allowTrailingComma: false, allowEmptyContent: false });
  if (errors.length || !tree) throw configError('INVALID_JSONC', 'JSONC 语法错误', text, errors[0]?.offset ?? 0);

  const pending = [tree];
  while (pending.length) {
    const node = pending.pop();
    if (node.type === 'object') {
      const keys = new Set();
      for (const property of node.children) {
        const key = property.children[0];
        if (keys.has(key.value)) throw configError('DUPLICATE_KEY', 'JSONC 对象含重复键', text, key.offset);
        keys.add(key.value);
      }
    }
    if (node.children) pending.push(...node.children);
  }

  // Keep JSON.parse's ordinary object semantics (including literal __proto__).
  // The scanner preserves comment-like text inside strings and token boundaries.
  try { return JSON.parse(stripComments(text, ' ')); }
  catch { throw configError('INVALID_JSONC', 'JSONC 语法错误', text, 0); }
}

module.exports = { parseJSONC };
