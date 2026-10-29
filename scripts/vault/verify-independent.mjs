import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import shared from '../../lib/vault/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, '.scratch/vault-rules-and-skills/verification');
const state = process.argv[2];
if (!['plugin-off', 'vault-closed', 'app-stopped'].includes(state)) throw Error('state must be plugin-off, vault-closed or app-stopped');
const report = { state, started: new Date().toISOString(), checks: [], files: [] };
const hash = x => createHash('sha256').update(x).digest('hex');
const exists = p => fs.access(p).then(() => true, () => false);
async function bridgeState() {
  const location = path.join(root, '.system/.workbench-runtime/agent-bridge.json');
  if (!await exists(location)) return { bridgeFilePresent: false, bridgeReachable: false };
  const { port, pid } = JSON.parse(await fs.readFile(location, 'utf8'));
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'invalid bridge port');
  const reachable = await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? resolve(false) : reject(error); });
    socket.once('timeout', () => { socket.destroy(); reject(Error('bridge probe timed out')); });
  });
  const bridgeProcessPresent = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).status === 0;
  return { bridgeFilePresent: true, bridgeReachable: reachable, bridgeProcessPresent };
}
async function precondition() {
  const running = spawnSync('pgrep', ['-x', 'Obsidian'], { encoding: 'utf8' }).status === 0;
  if (state === 'app-stopped') assert.equal(running, false, 'Obsidian is still running');
  else {
    const proof = JSON.parse(await fs.readFile(path.join(out, state + '-state.json'), 'utf8'));
    assert.ok(Date.now() - Date.parse(proof.time) < 20 * 60 * 1000, 'runtime state proof is stale');
    if (state === 'plugin-off') assert.equal(proof.pluginLoaded, false);
    else {
      assert.equal(running, true, 'Obsidian must remain running for vault-closed');
      assert.equal(proof.tanntWindowCount, 0);
    }
    report.stateProof = proof;
  }
  const bridge = await bridgeState();
  assert.equal(bridge.bridgeReachable, false, 'old bridge is still reachable');
  if (state === 'plugin-off') assert.equal(bridge.bridgeFilePresent, false, 'plugin unload did not remove bridge file');
  else if (bridge.bridgeFilePresent) assert.equal(bridge.bridgeProcessPresent, false, 'bridge renderer process is still present');
  return { obsidianRunning: running, ...bridge };
}
const cli = input => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts/vault/write.mjs')], { cwd: root });
  let output = '', errors = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', x => output += x); child.stderr.on('data', x => errors += x);
  child.on('error', reject); child.on('close', code => {
    try { const result = JSON.parse(output); if (code || !result.ok) throw Error(output + errors); resolve(result); } catch (e) { reject(e); }
  }); child.stdin.end(JSON.stringify(input));
});
const request = (action, value) => ({ action, privacy: 'ordinary', request_id: randomUUID(), ...value });
try {
  report.before = await precondition();
  const info = await cli({ action: 'info' }); assert.equal(path.resolve(info.vault), path.resolve(root));
  const source = path.join(out, '原始会话样例.jsonl');
  const created = await cli(request('capture', { title: `工作台验收-独立读写-${state}-20261021`, content: `合成验收：${state}，中文 🌱\n原始输入保留。`, files: [{ source }] }));
  report.files.push(created.path, ...created.files.map(x => x.attachmentPath));
  const before = await cli({ action: 'read', path: created.path }), original = shared.documentParts(before.content).fields;
  assert.equal(original.inbox_status, 'pending');
  assert.equal(hash(await fs.readFile(path.join(root, created.files[0].attachmentPath))), hash(await fs.readFile(source)));
  assert.equal(created.files[0].attachmentPath, path.posix.join(path.posix.dirname(created.path), 'attachments/原始会话样例.jsonl'));
  report.checks.push('info, capture, read, default attachment setting, original byte copy');
  const update = request('update', { path: created.path, expected: before.content, append: '独立运行时追加正文', fields: { inbox_status: 'reviewed' } });
  await cli(update); assert.equal((await cli(update)).reused, true);
  const after = await cli({ action: 'read', path: created.path }), updated = shared.documentParts(after.content).fields;
  assert.equal(updated.inbox_status, 'reviewed'); assert.equal(updated.created, original.created); assert.equal(updated.created_timezone, original.created_timezone);
  assert.equal(after.content.split('独立运行时追加正文').length, 2);
  report.checks.push('append, authorized state update, retry, creation fields preserved');
  const attached = await cli(request('attach', { path: created.path, expected: after.content, source: path.join(out, '原始笔记样例.md'), directory: path.posix.dirname(created.path) + '/原始资料' }));
  report.files.push(attached.attachmentPath);
  assert.equal(hash(await fs.readFile(path.join(root, attached.attachmentPath))), hash(await fs.readFile(path.join(out, '原始笔记样例.md'))));
  const final = await cli({ action: 'read', path: created.path }); assert.ok(final.content.includes(attached.link));
  report.checks.push('existing note attachment and link update, original Markdown bytes preserved');
  report.noteSha256 = hash(final.content); report.after = await precondition(); report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; process.exitCode = 1; }
report.finished = new Date().toISOString(); await fs.writeFile(path.join(out, state + '.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
