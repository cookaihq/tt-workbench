const test = require('node:test');
const assert = require('node:assert/strict');
const { AttachmentStore } = require('../attachments.js');

async function render(content) {
  const elements = [], rendered = [];
  const article = { createEl: (tag, options) => elements.push({ tag, ...options }), querySelectorAll: () => [] };
  await new AttachmentStore({}).render(content, article, { path: '01.收件箱/记录.md' }, {}, async text => rendered.push(text));
  return { elements, rendered };
}

for (const [name, content] of [
  ['default attachment directory', '[原始会话.jsonl](<attachments/%E5%8E%9F%E5%A7%8B.jsonl>)'],
  ['explicit Chinese directory', '[原始笔记.md](<%E5%8E%9F%E5%A7%8B/file.md>)'],
  ['extensionless target', '[来源](<source>)'],
  ['reference destination', '[来源][原始]\n\n[原始]: <attachments/source.jsonl>'],
  ['URL autolink', '<https://example.org/material>'],
]) test('render supported Markdown: ' + name, async () => {
  const result = await render(content);
  assert.deepEqual(result.rendered, [content]);
  assert.deepEqual(result.elements, []);
});

for (const [name, content] of [
  ['HTML image', '<img src="https://example.org/image.png">'],
  ['HTML after Markdown destination', '[来源](<attachments/source.jsonl>)\n<script>alert(1)</script>'],
  ['multiline HTML', '<iframe\nsrc="https://example.org"></iframe>'],
  ['HTML comment', '<!-- retained source -->'],
  ['unsupported embed', '! [[missing-image]]'],
]) test('keep unsupported markup as source: ' + name, async () => {
  const result = await render(content);
  assert.deepEqual(result.rendered, []);
  assert.equal(result.elements.find(element => element.tag === 'pre')?.text, content);
});
