#!/usr/bin/env node
"use strict";
const path = require('node:path');
const { IssueStore } = require('../../apps/workbench/issues.js');
async function main() {

  if (process.argv.includes('--help')) { console.log('指定 --vault <知识库绝对路径>，从 stdin 接收 JSON。action 为 list/read/create/update；read 使用 path；create 使用 input；update 使用 path、expected、input。规则见 docs/rules/issues.md。'); return; }
  const root = require('../../lib/config/target.cjs').vaultArgument();
  process.stdin.setEncoding('utf8'); let raw = ''; for await (const chunk of process.stdin) raw += chunk;
  const request = JSON.parse(raw), store = new IssueStore(root); let result;
  if (request.action === 'list') result = await store.list();
  else if (request.action === 'read') result = await store.read(request.path);
  else if (request.action === 'create') result = await store.create({ ...request.input, actor: request.input?.actor || 'Agent' });
  else if (request.action === 'update') result = await store.update(request.path, request.expected, { ...request.input, actor: request.input?.actor || 'Agent' });
  else throw Error('不支持的 action。');
  console.log(JSON.stringify({ ok: true, result }));
}
main().catch(error => { console.error(JSON.stringify({ ok: false, code: error.code || 'FAILED', message: error.message, recoveryPath: error.recoveryPath })); process.exitCode = 1; });
