#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { FnsSyncService } = require('../../lib/fns/sync.cjs');

async function main() {
  if (process.argv.includes('--help')) {
    console.log('指定 --vault <知识库绝对路径>，从 stdin 接收 JSON：action 为 check / receive / preview / publish / apply / retry / discard / onboard / recover / save-notes。save-notes 传 check 返回的 notes.expected 和完整 notes 数组。preview 另传 kind: publish|apply；发布/应用须传预览返回的 plan。独立程序写本机配置前须手动停用 FNS，并传 fnsStopped: true；原停用状态保持，不报告已加载。');
    return;
  }
  let raw = ''; process.stdin.setEncoding('utf8'); for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 1024 * 1024) throw Error('请求过大。'); }
  let request; try { request = JSON.parse(raw); } catch { throw Error('请求必须是 JSON 对象。'); }
  const vault = require('../../lib/config/target.cjs').vaultArgument(), configDir = request.configDir || '.obsidian';
  const runtime = {
    async inspect() { return { known: false }; },
    async suspend() {
      if (request.fnsStopped !== true) throw Error('请先在 Obsidian 停用 FNS，并通过 fnsStopped: true 确认；不能只编辑磁盘启用列表。');
      const enabled = JSON.parse(await fs.readFile(path.join(vault, configDir, 'community-plugins.json'), 'utf8'));
      if (!Array.isArray(enabled) || enabled.includes('fast-note-sync')) throw Error('FNS 仍在启用列表中，未执行写入。');
      return { enabled: false };
    },
    async restore() {}
  };
  const service = new FnsSyncService({ vault, configDir, runtime });
  const actions = {
    check: () => service.inspect(), receive: () => service.checkUpdates(), preview: () => service.preview(request.kind),
    publish: () => service.publish(request.plan), apply: () => service.apply(request.plan, { replaceLocal: request.replaceLocal === true }),
    retry: () => service.retryPublish(), discard: () => service.discardPending(request.publicationId), onboard: () => service.onboard(),
    recover: () => service.recover(request.operationId), 'save-notes': () => service.saveNotes(request.expected, request.notes)
  };
  if (!Object.hasOwn(actions, request.action)) throw Error('不支持的操作，请使用 --help 查看。');
  console.log(JSON.stringify({ ok: true, result: await actions[request.action]() }));
}
main().catch(error => { console.error(JSON.stringify({ ok: false, code: error.code || 'FAILED', message: error.message, recovery: error.recovery })); process.exitCode = 1; });
