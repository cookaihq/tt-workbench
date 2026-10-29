#!/usr/bin/env node
import { readdir, readFile, lstat, realpath, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundleState } from './fns/env-sync-support.mjs';
import legacyRules from '../lib/fns/legacy-rules.cjs';
export const { parseRules, matches } = legacyRules;

import target from '../lib/config/target.cjs';
const defaultVault = undefined;
const supportedVersion = '2.4.0';
const within = (item, directory) => item === directory || item.startsWith(`${directory}/`);
const compare = (a, b) => a.path.localeCompare(b.path, 'en');

function relativePath(value) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('路径须为笔记库内的相对路径，不含 . 或 .. 路径段。');
  }
  return normalized;
}

async function readJson(filename, label) {
  let text;
  try {
    text = await readFile(filename, 'utf8');
  } catch {
    throw new Error(`无法读取${label}。`);
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    // JSON parser messages can contain fragments of credentials from data.json.
    throw new Error(`${label}不是有效 JSON。`);
  }
}

async function inventory(vault, configDir) {
  const groups = [];
  const hiddenItems = [];
  const warnings = [];
  async function walk(directory, group = null) {
    let entries;
    try {
      entries = await readdir(path.join(vault, directory), { withFileTypes: true });
    } catch {
      warnings.push(`无法扫描目录：${directory || '/'}`);
      if (group) group.incomplete = true;
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const itemPath = path.posix.join(directory, entry.name);
      const kind = entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file';
      let owner = group;
      // The config directory has a dedicated FNS scanner, not blanket recursive coverage.
      if (itemPath === configDir && kind === 'directory') {
        await walk(itemPath);
        continue;
      }
      if (entry.name.startsWith('.')) {
        hiddenItems.push({ path: itemPath, kind });
        if (!owner) {
          owner = { path: itemPath, kind, files: [], links: [], incomplete: false };
          groups.push(owner);
        }
      }
      if (kind === 'link') {
        warnings.push(`未跟随链接：${itemPath}`);
        if (owner) {
          owner.links.push(itemPath);
          owner.incomplete = true;
        }
      } else if (kind === 'directory') {
        await walk(itemPath, owner);
      } else if (owner) {
        owner.files.push(itemPath);
      }
    }
  }
  await walk('');
  return { groups: groups.sort(compare), hiddenItems: hiddenItems.sort(compare), warnings };
}

async function loadConfig(vault, configDir) {
  const pluginDir = `${configDir}/plugins/fast-note-sync`;
  const settings = await readJson(path.join(vault, pluginDir, 'data.json'), ' FNS 配置');
  const manifest = await readJson(path.join(vault, pluginDir, 'manifest.json'), ' FNS 版本');
  const enabled = await readJson(path.join(vault, configDir, 'community-plugins.json'), '插件启用列表');
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
    || typeof manifest?.version !== 'string' || !Array.isArray(enabled)) {
    throw new Error('FNS 配置或插件启用列表的结构无法识别。');
  }
  if (manifest.version !== supportedVersion) {
    throw new Error(`当前 FNS 为 ${manifest.version}；Harness 已核验版本为 ${supportedVersion}，须先复核扫描规则。`);
  }
  const warnings = [];
  const directories = [];
  const files = [];
  let singleFileSupport = false;
  try {
    singleFileSupport = bundleState(await readFile(path.join(vault, pluginDir, 'main.js'), 'utf8')) === 'repaired';
  } catch { /* Without the verified repair, upstream directory-only behavior applies. */ }
  for (const rule of parseRules(settings.configSyncOtherDirs)) {
    let directory;
    try { directory = relativePath(rule.pattern.trim()); } catch {
      warnings.push('额外目录配置包含无法识别的路径，请检查 FNS 设置。');
      continue;
    }
    try {
      const stat = await lstat(path.join(vault, directory));
      const resolved = await realpath(path.join(vault, directory));
      const location = path.relative(vault, resolved);
      if (stat.isSymbolicLink() || location === '..'
        || location.startsWith(`..${path.sep}`) || path.isAbsolute(location)) {
        warnings.push(`额外目录不是库内普通目录：${directory}`);
        continue;
      }
      if (stat.isDirectory()) directories.push(directory);
      else if (stat.isFile() && singleFileSupport) files.push(directory);
      else warnings.push(`额外目录不是库内普通目录：${directory}`);
    } catch {
      warnings.push(`本机不存在或无法读取已配置的额外目录：${directory}`);
    }
  }
  const blockers = [];
  if (!enabled.includes('fast-note-sync')) blockers.push('FNS 插件未启用');
  if (settings.configSyncEnabled !== true) blockers.push('配置同步未开启');
  if (settings.readonlySyncEnabled === true) blockers.push('只读同步模式不上传本机新文件');
  return {
    configDir, pluginDir, version: manifest.version, directories: [...new Set(directories)],
    files, singleFileSupport,
    excludes: parseRules(settings.syncExcludeFolders),
    whitelist: parseRules(settings.syncExcludeWhitelist), blockers, warnings,
    manualSync: settings.manualSyncEnabled === true,
  };
}

function excluded(item, config) {
  const localFiles = ['configHashMap.json', 'fileHashMap.json', 'syncHashMap.json', 'folderSnapshot.json'];
  if (localFiles.some(name => item === `${config.pluginDir}/${name}`)
    || within(item, `${config.pluginDir}/conflict-notes`)) return true;
  if (config.whitelist.some(rule => matches(item, rule))) return false;
  const builtIns = [`${config.configDir}/plugins/hot-reload/`, `${config.pluginDir}/data.json`];
  return [...config.excludes, ...builtIns.map(pattern => ({ pattern, caseSensitive: false }))]
    .some(rule => matches(item, rule));
}

function coreConfigFile(item, config, directory = config.configDir) {
  if (!within(item, directory)) return false;
  const parts = item.slice(directory.length + 1).split('/');
  const filename = parts.at(-1);
  if (parts.length === 1 && filename.endsWith('.json')) {
    return config.whitelist.some(rule => matches(item, rule))
      || !['workspace.json', 'workspace-mobile.json'].includes(filename);
  }
  if (parts.length === 3 && parts[0] === 'plugins') return /\.(json|js|css)$/.test(filename);
  if (parts.length === 3 && parts[0] === 'themes') return /\.(json|css)$/.test(filename);
  return parts.length === 2 && parts[0] === 'snippets' && filename.endsWith('.css');
}

function coverage(item, kind, config) {
  if (kind === 'link') return 'unknown';
  if (kind === 'file' && config.files.includes(item)) {
    if (excluded(item, config)) return 'excluded';
    return config.blockers.length ? 'blocked' : 'covered';
  }
  const scopes = config.directories.filter(directory => within(item, directory));
  let inScope = false;
  let admitted = false;
  for (const directory of scopes) {
    // FNS special-cases configDir even if it is also in the extra-directory list.
    if (directory.endsWith(config.configDir)) {
      if (kind === 'file' && coreConfigFile(item, config, directory)) {
        inScope = true;
        admitted ||= !excluded(item, config);
      }
      continue;
    }
    inScope = true;
    const segments = item.slice(directory.length + 1).split('/').filter(Boolean);
    let ancestor = directory;
    const pruned = segments.some(segment => {
      ancestor += `/${segment}`;
      return excluded(ancestor, config);
    });
    // The scanner enters each configured root directly; it checks children on descent.
    admitted ||= !pruned;
  }
  if (kind === 'file' && coreConfigFile(item, config)) {
    inScope = true;
    admitted ||= !excluded(item, config);
  }
  if (!inScope) return 'missing';
  if (!admitted) return 'excluded';
  return config.blockers.length ? 'blocked' : 'covered';
}

function summarizeCoverage(files, item, config, incomplete = false) {
  const counts = { covered: 0, missing: 0, excluded: 0, blocked: 0, unknown: 0 };
  for (const file of files) counts[config ? coverage(file, 'file', config) : 'unknown']++;
  const scopeStatus = config ? coverage(item.path, item.kind, config) : 'unknown';
  const statuses = Object.keys(counts).filter(key => counts[key]);
  let status = statuses.length === 1 ? statuses[0] : statuses.length ? 'partial' : scopeStatus;
  if (scopeStatus === 'missing' && counts.covered > 0) status = 'partial';
  if (incomplete || !config) status = 'unknown';
  return { files: counts, scopeStatus, status };
}

export async function takeSnapshot({ vault = defaultVault, configDir = '.obsidian' } = {}) {
  vault = await realpath(vault);
  configDir = relativePath(configDir);
  const found = await inventory(vault, configDir);
  return { schemaVersion: 1, vault, configDir, capturedAt: new Date().toISOString(),
    hiddenItems: found.hiddenItems, warnings: found.warnings };
}

export async function auditVault({ vault = defaultVault, configDir = '.obsidian', baseline = null } = {}) {
  vault = await realpath(vault);
  configDir = relativePath(configDir);
  const found = await inventory(vault, configDir);
  if (baseline && (baseline.schemaVersion !== 1 || baseline.vault !== vault
    || baseline.configDir !== configDir || !Array.isArray(baseline.hiddenItems))) {
    throw new Error('基线与当前笔记库或配置目录不匹配，请使用本任务的基线。');
  }
  const oldItems = baseline && new Set(baseline.hiddenItems.map(item => `${item.kind}:${item.path}`));
  const newHiddenItems = oldItems
    ? found.hiddenItems.filter(item => !oldItems.has(`${item.kind}:${item.path}`)) : [];
  let config;
  let configError;
  try { config = await loadConfig(vault, configDir); } catch (error) { configError = error.message; }
  const items = found.groups.map(group => {
    return {
      path: group.path, kind: group.kind, fileCount: group.files.length,
      ...summarizeCoverage(group.files, group, config, group.incomplete),
      empty: group.kind === 'directory' && group.files.length === 0,
      newHiddenItems: newHiddenItems.filter(item => within(item.path, group.path)),
    };
  });
  const pending = items.filter(item => item.status !== 'covered');
  const prompts = newHiddenItems.map(item => {
    const group = found.groups.find(group => within(item.path, group.path));
    const files = group.files.filter(file => within(file, item.path));
    return { ...item, fileCount: files.length,
      status: summarizeCoverage(files, item, config, group.incomplete).status };
  }).filter(item => item.status !== 'covered');
  return {
    schemaVersion: 1, configDir, fnsVersion: config?.version ?? null,
    singleFileSupport: config?.singleFileSupport ?? false,
    baselineUsed: Boolean(baseline), newHiddenItems, prompts, items,
    summary: {
      hiddenDirectories: items.filter(item => item.kind === 'directory').length,
      standaloneHiddenFiles: items.filter(item => item.kind === 'file').length,
      pendingDirectories: pending.filter(item => item.kind === 'directory').length,
      pendingStandaloneFiles: pending.filter(item => item.kind === 'file').length,
      pendingLinks: pending.filter(item => item.kind === 'link').length,
      unconfiguredDirectories: items.filter(item => item.kind === 'directory' && item.scopeStatus === 'missing').length,
      unconfiguredStandaloneFiles: items.filter(item => item.kind === 'file' && item.scopeStatus === 'missing').length,
      knownUncoveredFiles: items.reduce((sum, item) => sum + item.files.missing + item.files.excluded + item.files.blocked, 0),
      unknownFiles: items.reduce((sum, item) => sum + item.files.unknown, 0),
      newHiddenItems: newHiddenItems.length, needsDecision: prompts.length,
    },
    blockers: config?.blockers ?? [],
    warnings: [...found.warnings, ...(baseline?.warnings ?? []).map(warning => `基线扫描不完整：${warning}`),
      ...(config?.warnings ?? []), ...(configError ? [configError] : [])],
    complete: !configError && found.warnings.length === 0 && !(baseline?.warnings?.length),
    manualSync: config?.manualSync ?? false,
  };
}

const labels = { covered: '已纳入配置', missing: '未加入同步范围', excluded: '被排除规则拦截',
  blocked: '同步开关／模式阻止上传', partial: '仅部分纳入', unknown: '无法完整核验' };
const cell = value => value.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');

export function renderReport(report) {
  const s = report.summary;
  const lines = [
    'FNS 隐藏项检查（本机配置；不代表远端已同步）',
    `未添加到范围：${s.unconfiguredDirectories} 个目录、${s.unconfiguredStandaloneFiles} 个独立隐藏文件。`,
    `尚未完整覆盖：${s.pendingDirectories} 个目录、${s.pendingStandaloneFiles} 个独立隐藏文件、${s.pendingLinks} 个链接；已知未覆盖文件 ${s.knownUncoveredFiles} 个。`,
    report.baselineUsed
      ? `本次新增隐藏项：${s.newHiddenItems}；需核对是否询问：${s.needsDecision} 项。`
      : '未提供基线；新增项及是否需要询问须结合本任务操作记录判断。',
  ];
  if (report.items.length) {
    lines.push('', '| 路径 | 类型 | 状态 | 文件总数 | 已纳入／未加入／排除／阻止／未知 |',
      '| --- | --- | --- | ---: | --- |');
    for (const item of report.items) {
      const counts = item.files;
      lines.push(`| ${cell(item.path)} | ${{ directory: '目录', file: '文件', link: '链接' }[item.kind]} | ${labels[item.status]} | ${item.fileCount} | ${counts.covered}／${counts.missing}／${counts.excluded}／${counts.blocked}／${counts.unknown} |`);
    }
  }
  if (report.prompts.length) {
    lines.push('', '新增且尚未覆盖的隐藏项（Agent 核对是否由本任务创建后询问用户）：');
    for (const item of report.prompts) lines.push(`- ${cell(item.path)}：${labels[item.status]}`);
  }
  if (s.unconfiguredStandaloneFiles) lines.push('', report.singleFileSupport
    ? '已识别受管理的单文件扫描修复；独立隐藏文件仍须逐项明确授权和登记。'
    : '独立隐藏文件不能直接填入原生 FNS 的目录列表；需要已核验的单文件扫描支持。');
  if (report.items.some(item => item.empty)) lines.push('空目录暂无文件可传输；登记目录不代表远端会出现空目录。');
  for (const blocker of report.blockers) lines.push(`同步状态：${blocker}。`);
  if (report.manualSync) lines.push('当前为手动同步模式，实际传输需要触发同步。');
  for (const warning of report.warnings) lines.push(`待核验：${warning}`);
  lines.push('', `${report.configDir}/ 由 FNS 核心配置规则管理；其内部新增点号项仍单独检查。`);
  return lines.join('\n');
}

async function main(args) {
  const command = args.shift() ?? 'check';
  if (command === '--help' || command === 'help') {
    console.log('用法：node scripts/fns-hidden-audit.mjs <snapshot|check> [--vault PATH] [--config-dir PATH] [--baseline PATH] [--json]\n'
      + 'snapshot：在系统临时目录写入基线，仅输出基线文件路径。\n'
      + 'check：只读扫描；--baseline 用于识别本次新增隐藏项，--json 输出结构化结果。\n'
      + '退出码：0 检查完成（可包含待确认项）；2 检查不完整或执行失败。');
    return;
  }
  if (!['snapshot', 'check'].includes(command)) throw new Error('未知命令，请使用 --help。');
  const options = {};
  let json = false;
  let baselinePath;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--json') { json = true; continue; }
    if (!['--vault', '--config-dir', '--baseline'].includes(flag) || !args.length || args[0].startsWith('--')) {
      throw new Error('参数无效，请使用 --help。');
    }
    const value = args.shift();
    if (flag === '--vault') options.vault = value;
    if (flag === '--config-dir') options.configDir = value;
    if (flag === '--baseline') baselinePath = value;
  }
  options.vault = target.resolveVault(options.vault);
  if (command === 'snapshot') {
    if (baselinePath || json) throw new Error('snapshot 仅接受 --vault 和 --config-dir。');
    const snapshot = await takeSnapshot(options);
    const folder = await mkdtemp(path.join(os.tmpdir(), 'tt-fns-audit-'));
    const filename = path.join(folder, 'baseline.json');
    await writeFile(filename, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    console.log(filename);
    if (snapshot.warnings.length) {
      console.error(snapshot.warnings.join('\n'));
      process.exitCode = 2;
    }
    return;
  }
  if (baselinePath) options.baseline = await readJson(baselinePath, '隐藏项基线');
  const report = await auditVault(options);
  console.log(json ? JSON.stringify(report, null, 2) : renderReport(report));
  if (!report.complete) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });
}
