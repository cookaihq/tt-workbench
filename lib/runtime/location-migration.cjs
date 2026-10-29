'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const exec = require('node:util').promisify(require('node:child_process').execFile);
const { resolveVault, configDirectory } = require('../config/target.cjs');
const { modify, applyEdits } = require('../config/vendor/jsonc-parser/lib/umd/main.js');
const storage = require('./storage.cjs');
const { ROOT, LEGACY, PREVIOUS, CONTROL, CONFIG, GATE, JOURNAL, plain, stat, fail, contains } = storage;
const { inventory, backupDirectory, saveManifest, copyVerified, verify, prune, hash, KNOWN, lockName } = require('./migrate.cjs');
const quiet = value => ({ files: value.files.filter(f => !lockName(f.path) && f.path !== 'agent-bridge.json'), directories: value.directories.filter(d => d !== 'writers' && !d.startsWith('writers/') && !d.startsWith('vault-io/locks/')), unknown: value.unknown });
const rawFile = async file => fs.readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
const git = (vault, args) => exec('git', args, { cwd: vault, windowsHide: true, encoding: 'utf8', timeout: 15000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
async function isGit(vault) {
  try { return Boolean((await git(vault, ['rev-parse', '--show-toplevel'])).stdout.trim()); }
  catch (e) { if (e.code === 128) return false; throw e; }
}
async function readPending(vault) {
  await plain(vault, JOURNAL, { file: true });
  const raw = await rawFile(path.join(vault, JOURNAL));
  if (raw === null) return null;
  let value; try { value = JSON.parse(raw); } catch { fail('INVALID_MANIFEST', '迁移协调记录损坏，请保留现场。'); }
  if (value.vault !== vault || !path.isAbsolute(value.backup || '')) fail('INVALID_MANIFEST', '迁移协调记录不属于本实例。');
  return value;
}
async function inspect(options) {
  const vault = resolveVault(options.vault), configDir = configDirectory(options.configDir || '.obsidian');
  const current = storage.location(vault), pending = await readPending(vault);
  const to = storage.directory(options.reset ? ROOT : options.directory ?? current.directory);
  if (contains(configDir, to) || contains(to, configDir)) fail('INVALID_RUNTIME_PATH', '运行数据不能放在 Obsidian 配置目录中或包含该目录。');
  const old = [];
  for (const name of current.previousDirectories) {
    await plain(vault, name);
    if (await stat(path.join(vault, name))) old.push(name);
  }
  const from = old.length === 1 ? old[0] : current.directory;
  if (old.length && from === to) fail('INVALID_RUNTIME_PATH', '此处仍是待迁移旧目录，请先迁到默认位置或另一独立目录。');
  if (from !== to && (contains(from, to) || contains(to, from))) fail('INVALID_RUNTIME_PATH', '新旧运行目录不能互相包含。');
  const source = await inventory(vault, from), target = from === to ? source : await inventory(vault, to);
  const conflicts = source.files.filter(f => target.files.some(g => f.path === g.path && f.sha256 !== g.sha256)).map(f => f.path);
  const retiringParents = [];
  if (from === LEGACY && await stat(path.join(vault, from)) && (await fs.readdir(path.join(vault, 'apps/workbench'))).every(n => n === 'data')) {
    retiringParents.push('apps/workbench');
    if ((await fs.readdir(path.join(vault, 'apps'))).every(n => n === 'workbench')) retiringParents.push('apps');
  }
  const isolationPaths = [...new Set([to, CONTROL, ...old, ...(from !== to ? [from] : []), ...retiringParents])];
  const fingerprint = hash(JSON.stringify({ vault, configDir, from, to, raw: current.raw, old, source: quiet(source), target: quiet(target), retiringParents }));
  return { vault, configDir, current: current.directory, default: ROOT, configuration: CONFIG, from, to,
    status: pending ? 'recovery-required' : old.length > 1 ? 'ambiguous-sources' : from !== to || old.length ? 'needs-migration' : 'ready',
    fingerprint, configurationRevision: hash(current.raw ?? ''), source, target, conflicts, retiringParents, isolationPaths, pending, old };
}
async function isolation(vault, configDir, paths) {
  if (await isGit(vault)) {
    if ((await git(vault, ['ls-files', '--', ...paths])).stdout.trim()) fail('UNSAFE_STORAGE', '运行位置或位置配置包含 Git 已跟踪文件。');
    for (const directory of paths) {
      // Git distinguishes an absent directory from a file. Verify a literal
      // directory exclusion as well as future descendants without creating it.
      let covered = false;
      try { await git(vault, ['check-ignore', '--no-index', '-q', '--', directory]); covered = true; } catch (e) { if (e.code !== 1) throw e; }
      if (!covered) {
        try {
          const rule = (await git(vault, ['check-ignore', '--no-index', '-v', '--', directory + '/'])).stdout.split('\t')[0].split(':').at(-1);
          covered = Boolean(rule?.endsWith('/') && !rule.startsWith('!') && !/[?*\[\]]/.test(rule));
        } catch (e) { if (e.code !== 1) throw e; }
      }
      if (!covered) fail('UNSAFE_STORAGE', `请先在本实例 Git 忽略整个 ${directory}/，或明确选择补齐本机排除。`);
      try { await git(vault, ['check-ignore', '--no-index', '-q', '--', `${directory}/fns-device-config/backup.json`]); }
      catch { fail('UNSAFE_STORAGE', `Git 排除未覆盖 ${directory}/ 的运行记录。`); }
    }
  }
  const config = await plain(vault, `${configDir}/plugins/fast-note-sync/data.json`, { file: true });
  const raw = await rawFile(config);
  if (raw !== null) {
    const { parseConfig, normalize, validateScope } = require('../fns/rules.cjs');
    validateScope(normalize(parseConfig(raw)), paths);
  }
}
async function replace(vault, name, before, after) {
  const file = await plain(vault, name, { file: true, mkdir: true });
  if (await rawFile(file) !== before) fail('CONFIG_CHANGED', `文件在操作期间变化：${name}`);
  if (before === after) return;
  if (after === null) { await fs.unlink(file); return; }
  const stage = await plain(vault, `${name}.${randomUUID()}.next`, { file: true });
  await fs.writeFile(stage, after, { flag: 'wx', mode: 0o600 });
  if (await rawFile(file) !== before) { await fs.unlink(stage); fail('CONFIG_CHANGED', `文件在操作期间变化：${name}`); }
  await fs.rename(stage, file);
  if (await rawFile(file) !== after) fail('VERIFY_FAILED', `保存后读回不一致：${name}`);
}
async function configureIsolation(plan, backup) {
  const changes = [], { vault, configDir, isolationPaths } = plan;
  if (await isGit(vault)) {
    if ((await git(vault, ['ls-files', '--', ...isolationPaths])).stdout.trim()) fail('UNSAFE_STORAGE', '运行位置包含 Git 已跟踪文件，请先核对。');
    const before = await rawFile(await plain(vault, '.gitignore', { file: true }));
    const lines = (before || '').split(/\r?\n/), additions = isolationPaths.map(p => '/' + p + '/').filter(p => !lines.includes(p));
    if (additions.length) changes.push({ path: '.gitignore', before, after: (before || '') + (before && !before.endsWith('\n') ? '\n' : '') + additions.join('\n') + '\n' });
  }
  const name = `${configDir}/plugins/fast-note-sync/data.json`, before = await rawFile(await plain(vault, name, { file: true }));
  if (before !== null) {
    const { parseConfig, normalize, validateScope } = require('../fns/rules.cjs');
    const config = parseConfig(before), rules = normalize(config);
    let changed = false;
    for (const p of isolationPaths) {
      try { validateScope(rules, [p]); }
      catch { rules.syncExcludeFolders.push({ pattern: '^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:/|$)', caseSensitive: false }); changed = true; }
    }
    validateScope(rules, isolationPaths);
    if (changed) changes.push({ path: name, before, after: JSON.stringify({ ...config, syncExcludeFolders: JSON.stringify(rules.syncExcludeFolders) }, null, 2) + '\n' });
  }
  if (changes.length) {
    // Contains local configuration, potentially credentials. Never return it.
    const saved = path.join(backup, `isolation-${randomUUID()}.json`);
    const raw = JSON.stringify({ vault, changes });
    await fs.writeFile(saved, raw, { flag: 'wx', mode: 0o600 });
    if (await fs.readFile(saved, 'utf8') !== raw) fail('VERIFY_FAILED', '排除设置备份核验失败。');
    for (const change of changes) await replace(vault, change.path, change.before, change.after);
  }
  await isolation(vault, configDir, isolationPaths);
}
function nextConfig(raw, selected, previous) {
  let text = raw ?? '// 本机运行位置；路径相对于所属实例根目录。通过工作台迁移后更新。\n{}\n';
  for (const [key, value] of Object.entries({ schema: 1, directory: selected, previousDirectories: [...new Set(previous)].filter(p => p !== selected) })) {
    text = applyEdits(text, modify(text, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }));
  }
  return text;
}
async function acquire(vault, name, backup, recover) {
  const file = await plain(vault, name, { file: true, mkdir: true }), previous = await rawFile(file);
  if (previous !== null) {
    let owner; try { owner = JSON.parse(previous); } catch { fail('RUNTIME_BUSY', `迁移锁无法识别：${name}`); }
    if (!recover || owner.backup !== backup || !Number.isSafeInteger(owner.pid) || owner.pid < 1) fail('RUNTIME_BUSY', '存在另一迁移锁，请保留现场。');
    try { process.kill(owner.pid, 0); fail('RUNTIME_BUSY', '迁移进程仍在运行。'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    if (await rawFile(file) !== previous) fail('RUNTIME_BUSY', '迁移锁发生变化。');
    await fs.unlink(file);
  }
  const raw = JSON.stringify({ pid: process.pid, backup });
  await fs.writeFile(file, raw, { flag: 'wx', mode: 0o600 });
  return async () => { if (await rawFile(file) !== raw) fail('RUNTIME_BUSY', '迁移锁发生变化，保留现场。'); await fs.unlink(file); };
}
function validateManifest(m, vault, configDir) {
  if (m.schema !== 2 || m.vault !== vault || m.configDir !== configDir || !Array.isArray(m.files) || !Array.isArray(m.directories) || !Array.isArray(m.existing) || !Array.isArray(m.isolationPaths)) fail('INVALID_MANIFEST', '恢复清单不属于当前实例与配置目录。');
  for (const p of [m.from, m.to]) if (p !== LEGACY) storage.directory(p);
  if (m.from === m.to || contains(m.from, m.to) || contains(m.to, m.from)) fail('INVALID_MANIFEST', '恢复清单的源目标不合法。');
  for (const item of m.files) if (!/^[a-f0-9]{64}$/.test(item.sha256) || !KNOWN.has(item.path?.split('/')[0]) || lockName(item.path) || item.path === 'agent-bridge.json') fail('INVALID_MANIFEST', '恢复清单包含非法条目。');
}
async function migrate(options) {
  if (!options.writersStopped) fail('WRITERS_REQUIRED', '先停止相关 CLI、旧版工作台与 FNS，再确认 writers-stopped。');
  const vault = resolveVault(options.vault), configDir = configDirectory(options.configDir || '.obsidian');
  const recover = Boolean(options.resume || options.restore), pending = await readPending(vault);
  let manifest, plan, backup;
  if (recover) {
    backup = await backupDirectory(vault, options.backup || pending?.backup);
    manifest = JSON.parse(await fs.readFile(await plain(backup, 'manifest.json', { file: true }), 'utf8'));
    validateManifest(manifest, vault, configDir);
    plan = { vault, configDir, ...manifest };
  } else {
    plan = await inspect(options);
    if (pending) fail('RUNTIME_BUSY', '上次迁移尚未结束，请使用原备份续做或恢复。');
    if (plan.fingerprint !== options.expected) fail('STALE_PLAN', '位置设置或运行记录在预览后变化，请重新检查。');
    if (plan.status === 'ambiguous-sources') fail('AMBIGUOUS_SOURCES', '存在多个旧运行目录，先核对各目录归属，未自动合并。');
    if (plan.status === 'ready') return { changed: false, status: 'ready', vault, runtime: plan.to };
    if (!options.configureIsolation) await isolation(vault, configDir, plan.isolationPaths);
    backup = await backupDirectory(vault, options.backup);
    if ((await fs.readdir(backup)).length) fail('BACKUP_OCCUPIED', '备份目录非空，请使用独立目录或原清单恢复。');
  }
  if (pending && pending.backup !== backup) fail('RUNTIME_BUSY', '恢复目录与本实例的未完成迁移不一致。');
  const from = plan.from, to = plan.to;
  let source = await inventory(vault, from), target = await inventory(vault, to);
  const check = () => {
    if (source.unknown.length || target.unknown.length) fail('UNKNOWN_FILES', '源或目标含未知内容，保留现场并先核对。');
    if ([...source.locks, ...target.locks].some(p => !recover || p !== 'migration.lock')) fail('ACTIVE_RECORDS', '存在写入租约、模块锁或 Agent 连接，请先结束操作并核对恢复材料。');
    if (source.files.some(f => target.files.some(g => f.path === g.path && f.sha256 !== g.sha256))) fail('TARGET_CONFLICT', '目标已有不同版本的运行记录，未覆盖。');
  };
  check();
  if (!manifest) {
    const current = storage.location(vault);
    manifest = { schema: 2, vault, configDir, from, to, softwareVersion: require('../../apps/workbench/manifest.json').version,
      created: new Date().toISOString(), phase: 'prepared', files: source.files, directories: source.directories, existing: target.files,
      retiringParents: plan.retiringParents, isolationPaths: plan.isolationPaths, configBefore: current.raw,
      configAfter: nextConfig(current.raw, to, [...current.previousDirectories, current.directory, from]) };
    await saveManifest(backup, manifest);
  }
  if (options.configureIsolation) await configureIsolation(plan, backup);
  else await isolation(vault, configDir, manifest.isolationPaths);
  const releases = [];
  try {
    releases.push(await acquire(vault, GATE, backup, recover));
    // The per-directory gate also stops version 0.24 writers.
    for (const p of [...new Set([from, to])]) if (p !== LEGACY) releases.push(await acquire(vault, `${p}/migration.lock`, backup, recover));
    const journal = JSON.stringify({ vault, backup, from, to });
    const oldJournal = await rawFile(path.join(vault, JOURNAL));
    if (oldJournal !== null && oldJournal !== journal) fail('RUNTIME_BUSY', '迁移协调记录变化。');
    if (oldJournal === null) await fs.writeFile(path.join(vault, JOURNAL), journal, { flag: 'wx', mode: 0o600 });
    source = await inventory(vault, from); target = await inventory(vault, to);
    if ([...source.locks, ...target.locks].some(p => p !== 'migration.lock')) fail('ACTIVE_RECORDS', '迁移准备期间出现新的写入操作。');
    if (!recover && (hash(manifest.configBefore ?? '') !== plan.configurationRevision || storage.location(vault).raw !== manifest.configBefore
      || JSON.stringify(quiet(source)) !== JSON.stringify(quiet(plan.source)) || JSON.stringify(quiet(target)) !== JSON.stringify(quiet(plan.target)))) fail('STALE_PLAN', '迁移准备期间源目标或位置配置变化，已保留现场。');
    const known = new Map(manifest.files.map(f => [f.path, f.sha256]));
    if (source.unknown.length || target.unknown.length || source.files.some(f => f.path !== 'migration.lock' && known.get(f.path) !== f.sha256)) fail('SOURCE_CHANGED', '源目录出现清单以外内容或新版本。');
    const config = await rawFile(path.join(vault, CONFIG));
    if (config !== manifest.configBefore && config !== manifest.configAfter) fail('CONFIG_CHANGED', '位置配置在迁移后发生变化，未覆盖。');
    const sourceRoot = path.join(vault, from), targetRoot = path.join(vault, to);
    await plain(backup, 'files', { mkdir: true });
    const saved = path.join(backup, 'files');
    if (options.restore) {
      await verify(saved, manifest.files);
      const expected = new Map([...manifest.existing, ...manifest.files].map(f => [f.path, f.sha256]));
      if (target.files.some(f => f.path !== 'migration.lock' && expected.get(f.path) !== f.sha256)) fail('SOURCE_CHANGED', '目标已产生后续记录或新版本，不能恢复旧位置。');
      await verify(targetRoot, manifest.files, true);
      await plain(vault, from, { mkdir: true });
      for (const entry of manifest.files) await copyVerified(saved, sourceRoot, entry);
      await verify(sourceRoot, manifest.files);
      for (const entry of manifest.files) if (!manifest.existing.some(f => f.path === entry.path)) {
        const filename = await plain(targetRoot, entry.path, { file: true });
        if (await stat(filename)) { await verify(targetRoot, [entry]); await fs.unlink(filename); }
      }
      await replace(vault, CONFIG, config, manifest.configBefore);
      manifest.phase = 'restored';
    } else {
      for (const entry of manifest.files) if (!await stat(await plain(saved, entry.path, { file: true }))) await copyVerified(sourceRoot, saved, entry);
      await verify(saved, manifest.files); await verify(sourceRoot, manifest.files, true);
      manifest.phase = 'copy'; await saveManifest(backup, manifest);
      for (const entry of manifest.files) await copyVerified(saved, targetRoot, entry);
      for (const d of manifest.directories) await plain(targetRoot, d, { mkdir: true });
      await verify(targetRoot, manifest.files);
      await options.afterCopy?.();
      const latest = await inventory(vault, from);
      if (latest.files.some(f => f.path !== 'migration.lock' && known.get(f.path) !== f.sha256) || latest.unknown.length || latest.locks.some(p => p !== 'migration.lock') || latest.directories.some(d => !manifest.directories.includes(d))) fail('SOURCE_CHANGED', '复制期间源目录变化，已保留源与备份。');
      manifest.phase = 'cleanup'; await saveManifest(backup, manifest);
      for (const entry of manifest.files) {
        if (!await stat(sourceRoot)) break;
        const filename = await plain(sourceRoot, entry.path, { file: true });
        if (await stat(filename)) { await verify(sourceRoot, [entry]); await verify(targetRoot, [entry]); await fs.unlink(filename); }
      }
      await verify(targetRoot, manifest.files);
      await options.beforeCommit?.();
      await replace(vault, CONFIG, config, manifest.configAfter);
      await options.afterCommit?.();
      manifest.phase = 'complete'; manifest.completed = new Date().toISOString();
    }
    await saveManifest(backup, manifest);
    // Keep the journal until both gates and empty source directories are gone.
    while (releases.length) await releases.pop()();
    const retired = options.restore ? to : from;
    await prune(vault, [...manifest.directories.map(d => `${retired}/${d}`), retired, ...(!options.restore ? manifest.retiringParents : [])]);
    if (!options.restore && await stat(path.join(vault, from))) fail('SOURCE_CHANGED', '旧目录出现未清理内容；位置已保存，等待核对恢复。');
    if (await rawFile(path.join(vault, JOURNAL)) !== journal) fail('RUNTIME_BUSY', '迁移协调记录变化。');
    await fs.unlink(path.join(vault, JOURNAL));
    return { changed: true, status: manifest.phase, backup, runtime: options.restore ? from : to, files: manifest.files.length, appsRemoved: !await stat(path.join(vault, 'apps')) };
  } finally {
    // A handled failure releases process locks but retains the journal. A crash
    // retains the locks too; recovery proves their original owner has exited.
    while (releases.length) await releases.pop()();
  }
}
module.exports = { inspect, migrate, isolation, nextConfig };
