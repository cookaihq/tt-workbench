const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJSONC } = require('../jsonc.cjs');

test('line and block comments, BOM and CRLF leave JSON values intact', () => {
  const value = { url: 'https://example.com/a//b', literal: '/*文本*/ //', quote: '"//', slash: '\\', unicode: '中文' };
  const source = '\uFEFF/* 配置 */\r\n' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n// 末尾注释';
  assert.deepEqual(parseJSONC(source), value);
  assert.deepEqual(parseJSONC('{"a"/*键*/:/*值*/[1,// 行注释\n2]}'), { a: [1, 2] });
});

test('malformed JSONC, token splicing and JSON5 extensions are rejected', () => {
  for (const source of ['', '// only a comment', '/* unfinished', '{"a":1,}', '[1,]', "{'a':1}", '{a:1}',
    '{"a":NaN}', '{"a":Infinity}', '{"a":0x10}', '{"a":+1}', '{"a":.5}', '{"a":1/*x*/2}',
    '{"a":t/*x*/rue}', '{"a":1} garbage', '{"a":1/*unfinished}', '{"a":1 "b":2}', '{"a":"raw\nnewline"}']) {
    assert.throws(() => parseJSONC(source), { code: 'INVALID_JSONC' });
  }
});

test('duplicates include escaped keys and nested objects, but not separate objects', () => {
  for (const source of ['{"a":1,/*说明*/"a":2}', '{"a":1,"\\u0061":2}', '[{"nested":{"a":1,"a":2}}]']) {
    assert.throws(() => parseJSONC(source), { code: 'DUPLICATE_KEY' });
  }
  assert.deepEqual(parseJSONC('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
});

test('errors give positions without disclosing configuration values', () => {
  assert.throws(() => parseJSONC('{\n "token": "test-only-secret",\n invalid\n}'), error => {
    assert.equal(error.code, 'INVALID_JSONC');
    assert.equal(error.line, 3);
    assert(!error.message.includes('test-only-secret'));
    assert(!error.message.includes('token'));
    return true;
  });
});

test('JSON values and prototype-like keys preserve JSON.parse semantics', () => {
  for (const source of ['null', 'true', '42', '"text"', '[false, null, -1.5e2]', '{"__proto__":{"polluted":true},"constructor":"literal"}']) {
    assert.deepEqual(parseJSONC(source), JSON.parse(source));
  }
  assert.equal({}.polluted, undefined);
});
