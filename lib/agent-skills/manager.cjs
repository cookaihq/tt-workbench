'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { resolveVault, configDirectory } = require('../config/target.cjs');
const { parseJSONC } = require('../config/jsonc.cjs');
const { inspectIsolation } = require('./isolation.cjs');
const HOSTS = Object.freeze({ codex: { name: 'Codex', directory: '.agents/skills' }, claude: { name: 'Claude Code', directory: '.claude/skills' } });
const LABELS = Object.freeze({ absent: '未安装', installed: '已安装', broken: '入口损坏', conflict: '同名冲突', error: '检查失败' });
const hash = value => createHash('sha256').update(value).digest('hex');
const normal = p => path.resolve(p.replace(/^\\\\\?\\/, ''));
const same = (a, b) => process.platform === 'win32' ? normal(a).toLowerCase() === normal(b).toLowerCase() : normal(a) === normal(b);
const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
const message = error => `${error.code || 'FAILED'}：${error.message}`;
const validName = name => typeof name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
const identity = info => info ? [String(info.dev), String(info.ino), info.birthtimeMs, info.mtimeMs, info.size] : null;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A lock serializes this module's CLI/UI writers. Other programs do not obey it:
// exclusive creation, repeated checks and verified quarantine preserve their content.
// This is deliberately not advertised as a transaction with external writers.
class SkillManager {
  constructor({ vault, packageRoot, configDir = '.obsidian', io = fs, migrateFrom = null }) {
    this.vault = resolveVault(vault);
    if (!path.isAbsolute(packageRoot || '')) fail('INVALID_SOURCE', 'Skill 软件资源目录必须是绝对路径。');
    this.packageRoot = path.resolve(packageRoot); this.io = io; this.configDir = configDirectory(configDir);
    if (migrateFrom && !path.isAbsolute(migrateFrom)) fail('INVALID_SOURCE', '已核实的旧 Skill 目录必须是绝对路径。');
    this.migrateFrom = migrateFrom;
    this.runtime = 'apps/workbench/data/agent-skills';
  }
  host(agent) { if (!Object.hasOwn(HOSTS, agent)) fail('INVALID_AGENT', '请选择 Codex 或 Claude Code。'); return HOSTS[agent]; }
  async stat(file) { try { return await this.io.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  async plain(root, relative, create = false) {
    if (!relative || path.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f]/.test(p) || /[. ]$/.test(p))) fail('UNSAFE_PATH', '路径不在允许范围内。');
    const rootInfo = await this.stat(root);
    if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink() || !same(await this.io.realpath(root), root)) fail('UNSAFE_PATH', `根路径含链接或不是普通目录：${root}`);
    let current = root;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      let info = await this.stat(current);
      if (!info && create) { try { await this.io.mkdir(current); } catch (e) { if (e.code !== 'EEXIST') throw e; } info = await this.stat(current); }
      if (info && (!info.isDirectory() || info.isSymbolicLink())) fail('UNSAFE_PATH', `父目录不是普通目录：${current}`);
    }
    return current;
  }
  async text(file) {
    const s = await this.stat(file);
    if (!s?.isFile() || s.isSymbolicLink() || s.size > 1024 * 1024) fail('INVALID_FILE', `文件缺失、含链接或超过 1 MiB：${file}`);
    const content = await this.io.readFile(file, 'utf8');
    if (Buffer.byteLength(content) > 1024 * 1024 || content.includes('\0')) fail('INVALID_FILE', `文件不是可读取的文本：${file}`);
    return content;
  }
  async catalog() {
    await this.plain(this.packageRoot, 'skills');
    const raw = await this.text(path.join(this.packageRoot, 'skills/manifest.jsonc'));
    const manifest = parseJSONC(raw);
    if (!Array.isArray(manifest.skills) || !manifest.skills.length || manifest.skills.length > 100 || manifest.skills.some(n => !validName(n)) || new Set(manifest.skills).size !== manifest.skills.length) fail('INVALID_MANIFEST', 'Skill 清单无效。');
    if (manifest.presentation && (typeof manifest.presentation !== 'object' || Array.isArray(manifest.presentation))) fail('INVALID_MANIFEST', 'Skill 展示信息无效。');
    return { names: manifest.skills, presentation: manifest.presentation || {}, hash: hash(raw) };
  }
  async registry() {
    await this.plain(this.vault, this.runtime);
    const file = path.join(this.vault, this.runtime, 'registry.json');
    if (!await this.stat(file)) return { schema: 1, entries: {} };
    const record = parseJSONC(await this.text(file));
    if (record.schema !== 1 || !record.entries || typeof record.entries !== 'object' || Array.isArray(record.entries)) fail('INVALID_REGISTRY', 'Skill 安装记录无法读取。');
    for (const [key, value] of Object.entries(record.entries)) {
      if (!/^(codex|claude)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || !value || typeof value.target !== 'string' || typeof value.source !== 'string' || !path.isAbsolute(value.source) || !Array.isArray(value.identity)) fail('INVALID_REGISTRY', 'Skill 安装记录中的来源无效。');
    }
    return record;
  }
  async inspect(agent, name, catalog, registry) {
    const directory = this.host(agent).directory;
    const entry = path.join(this.vault, directory, name), source = path.join(this.packageRoot, 'skills', name);
    const p = catalog.presentation[name] || {};
    const result = { name, title: typeof p.title === 'string' ? p.title : name, description: '', example: typeof p.example === 'string' ? p.example : '', next: typeof p.next === 'string' ? p.next : '在当前库根目录新开 Agent 会话，核对 Skill 列表后调用。', related: ['@agent-rules', '@fns'].includes(p.related) ? p.related : '', entry, source, agent, status: 'error', reason: '', target: null, token: null };
    try {
      await this.plain(this.packageRoot, `skills/${name}`);
      const content = (await this.text(path.join(source, 'SKILL.md'))).replace(/\r\n/g, '\n');
      const front = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
      if (!front || !new RegExp(`^name: ${name}$`, 'm').test(front) || !/^description:\s*\S/m.test(front)) fail('INVALID_SKILL', 'Skill 元数据与清单不一致。');
      result.description = typeof p.summary === 'string' ? p.summary : front.match(/^description:\s*(.+)$/m)?.[1] || name;
      await this.plain(this.vault, directory);
      const info = await this.stat(entry);
      result.identity = identity(info);
      if (!info) result.status = 'absent';
      else if (!info.isSymbolicLink()) { result.status = 'conflict'; result.reason = '同名位置是已有的普通文件或目录，请保留或自行处理后重新检查。'; }
      else {
        result.target = await this.io.readlink(entry);
        const lexical = path.resolve(path.dirname(entry), result.target);
        const owned = registry.entries[`${agent}/${name}`];
        const recognized = owned?.target === result.target && same(lexical, owned.source);
        if (same(lexical, source)) {
          if (same(await this.io.realpath(entry), await this.io.realpath(source))) result.status = 'installed';
          else { result.status = 'conflict'; result.reason = '入口经过其他链接，最终目标与内置资源不同。'; }
        } else if (recognized || this.migrateFrom && same(lexical, path.join(this.migrateFrom, name))) {
          result.status = 'broken'; result.reason = recognized ? '安装记录证明入口指向之前的工作台资源，可单独修复。' : '入口与本次明确指定的旧资源目录一致，可单独修复。';
        } else { result.status = 'conflict'; result.reason = '入口指向其他来源或来源不明，请核对原内容后重新检查。'; }
      }
      result.token = hash(JSON.stringify([catalog.hash, hash(content), result.identity, result.target, result.status, registry.entries[`${agent}/${name}`] || null]));
    } catch (e) { result.status = 'error'; result.reason = message(e); }
    return result;
  }
  async scan(agent = 'codex') {
    this.host(agent);
    const catalog = await this.catalog();
    let registry, error;
    try { registry = await this.registry(); } catch (e) { error = message(e); registry = { entries: {} }; }
    const [items, isolation] = await Promise.all([
      Promise.all(catalog.names.map(n => this.inspect(agent, n, catalog, registry))),
      inspectIsolation(this, agent)
    ]);
    if (error) for (const item of items) { item.status = 'error'; item.reason = error; item.token = null; }
    const pending = await this.stat(path.join(this.vault, this.runtime, 'operation.lock')).catch(() => null);
    return { agent, vault: this.vault, packageRoot: this.packageRoot, checkedAt: new Date().toISOString(), items, isolation, busy: Boolean(pending) };
  }
  async writeRegistry(value, expected) {
    const directory = await this.plain(this.vault, this.runtime, true), file = path.join(directory, 'registry.json');
    const existing = await this.stat(file);
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) fail('UNSAFE_PATH', '安装记录路径被其他内容占用。');
    if (!equal(await this.registry(), expected)) fail('STALE_REGISTRY', '安装记录已被其他程序修改，停止写入。');
    const temporary = path.join(directory, `registry-${randomUUID()}.json`), content = JSON.stringify(value, null, 2) + '\n';
    try {
      await this.io.writeFile(temporary, content, { flag: 'wx' });
      await this.plain(this.vault, this.runtime);
      if (!equal(await this.registry(), expected)) fail('STALE_REGISTRY', '安装记录已变化，停止写入。');
      await this.io.rename(temporary, file);
      if (await this.text(file) !== content) fail('VERIFY_FAILED', '安装记录保存后校验失败。');
    } finally { if (await this.stat(temporary)) await this.io.unlink(temporary); }
  }
  async apply({ agent = 'codex', names, action = 'install', expected = {} }) {
    this.host(agent);
    if (!['install', 'repair', 'remove'].includes(action)) fail('INVALID_ACTION', '不支持的 Skill 操作。');
    const catalog = await this.catalog();
    names = names || catalog.names;
    if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length || names.some(n => !catalog.names.includes(n))) fail('INVALID_SELECTION', '所选 Skill 不在活动清单中。');
    const isolation = await inspectIsolation(this, agent);
    if (!isolation.ok) fail('ISOLATION_REQUIRED', isolation.reasons.join('；'));
    const runtime = await this.plain(this.vault, this.runtime, true), lockFile = path.join(runtime, 'operation.lock');
    let lock, lockIdentity;
    try { lock = await this.io.open(lockFile, 'wx'); } catch (e) { if (e.code === 'EEXIST') fail('BUSY', `另一项 Skill 操作尚未结束。异常退出时先核对持有进程及恢复记录：${lockFile}`); throw e; }
    const operation = randomUUID(), report = { operation, action, agent, at: new Date().toISOString(), results: [], warnings: [] };
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, ...report }));
      lockIdentity = identity(await lock.stat());
      for (const name of names) {
        let old, quarantine, movedIdentity, created = false, committed = false;
        try {
          // Re-read persisted ownership for every item, including after failed writes.
          const registry = await this.registry();
          old = await this.inspect(agent, name, await this.catalog(), registry);
          if (Object.hasOwn(expected, name) && expected[name] !== old.token) fail('STALE', '入口或内置资源已变化，请重新检查后再操作。');
          if (action === 'install' && old.status === 'installed' || action === 'remove' && old.status === 'absent') { report.results.push({ name, outcome: 'unchanged', message: '保持现状。' }); continue; }
          if (action === 'install' ? old.status !== 'absent' : action === 'repair' ? old.status !== 'broken' : !['installed', 'broken'].includes(old.status)) { report.results.push({ name, outcome: 'skipped', message: old.reason || `当前为${LABELS[old.status]}，未执行。` }); continue; }
          const parent = await this.plain(this.vault, this.host(agent).directory, true);
          const fresh = await this.inspect(agent, name, await this.catalog(), await this.registry());
          if (fresh.token !== old.token) fail('STALE', '操作前入口已变化，请重新检查。');
          const journal = path.join(runtime, `${operation}-${agent}-${name}.json`);
          await this.io.writeFile(journal, JSON.stringify({ operation, action, agent, name, entry: old.entry, source: old.source, previousTarget: old.target, identity: old.identity }, null, 2), { flag: 'wx' });
          await this.plain(this.vault, this.host(agent).directory);
          await this.plain(this.vault, this.runtime);
          if (old.status !== 'absent') {
            const destination = path.join(runtime, `${operation}-${agent}-${name}.link`);
            await this.io.rename(old.entry, destination); quarantine = destination;
            const moved = await this.stat(quarantine); movedIdentity = identity(moved);
            if (!moved?.isSymbolicLink() || !equal(movedIdentity, old.identity) || await this.io.readlink(quarantine) !== old.target) fail('STALE', '入口被其他程序替换，已保留捕获内容，需核对恢复位置。');
          }
          if (action !== 'remove') {
            await this.plain(this.vault, this.host(agent).directory);
            await this.io.symlink(path.relative(parent, old.source), old.entry, 'dir'); created = true;
            const verified = await this.inspect(agent, name, await this.catalog(), registry);
            if (verified.status !== 'installed') fail('VERIFY_FAILED', '新入口验证失败。');
            const next = { ...registry, entries: { ...registry.entries, [`${agent}/${name}`]: { target: verified.target, source: old.source, identity: verified.identity, installedAt: new Date().toISOString() } } };
            await this.writeRegistry(next, registry);
          } else {
            if (await this.stat(old.entry)) fail('STALE', '移除后出现新的同名内容，已保留，请重新检查。');
            const next = { ...registry, entries: { ...registry.entries } }; delete next.entries[`${agent}/${name}`];
            await this.writeRegistry(next, registry);
          }
          committed = true;
          if (quarantine) { await this.discardKnown(quarantine, movedIdentity, old.target); quarantine = null; }
          report.results.push({ name, outcome: 'success', message: action === 'remove' ? '已移除发现入口。' : action === 'repair' ? '入口已修复。' : '已安装到当前知识库。' });
        } catch (e) {
          let recovery = '';
          if (quarantine) {
            // Restore a verified old link by exclusive creation, never by rename-overwrite.
            // If a writer replaced it, retain the captured file/directory for manual recovery.
            if (!created && !committed && equal(movedIdentity, old?.identity)) {
              try {
                await this.plain(this.vault, this.host(agent).directory);
                await this.io.symlink(old.target, old.entry, 'dir');
                await this.discardKnown(quarantine, movedIdentity, old.target); quarantine = null;
                recovery = ' 原入口已恢复。';
              } catch { /* Occupied or unreadable: preserve both locations. */ }
            }
            if (quarantine) recovery = ` 恢复材料保留于 ${quarantine}。`;
          }
          report.results.push({ name, outcome: 'failed', message: message(e) + recovery + (created ? ' 入口曾建立；请以下方重新检查的实际状态为准，记录或清理尚未完成。' : '') });
        }
      }
      try { await this.io.writeFile(path.join(runtime, `${operation}.json`), JSON.stringify(report, null, 2), { flag: 'wx' }); }
      catch (e) { report.warnings.push(`结果回执未保存：${message(e)}。逐项结果仍如下所示。`); }
    } finally {
      await lock.close();
      try {
        if (!lockIdentity || !equal(identity(await this.stat(lockFile)), lockIdentity)) fail('STALE', '操作锁已变化，保留当前内容。');
        await this.io.unlink(lockFile);
      } catch (e) { report.warnings.push(`操作锁未释放：${message(e)}；请核对 ${lockFile}。`); }
    }
    try { report.snapshot = await this.scan(agent); }
    catch (e) { report.warnings.push(`操作后检查失败：${message(e)}。`); report.snapshot = null; }
    report.ok = !report.warnings.length && report.results.every(r => ['success', 'unchanged'].includes(r.outcome));
    return report;
  }
  async discardKnown(file, stamp, target) {
    await this.plain(this.vault, this.runtime);
    const info = await this.stat(file);
    if (!info?.isSymbolicLink() || !equal(identity(info), stamp) || await this.io.readlink(file) !== target) fail('STALE', `恢复材料发生变化，已保留：${file}`);
    await this.io.unlink(file);
  }
}
module.exports = { SkillManager, HOSTS, LABELS };
