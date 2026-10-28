#!/usr/bin/env node
// Legacy FNS 2.4.0 single-file support: identify or retire, never install.
// Upstream: https://github.com/haierkeys/obsidian-fast-note-sync/tree/2.4.0
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import checkedFiles from '../../lib/fns/files.cjs';
import deviceConfig from '../../lib/fns/device-config.cjs';
export const { replaceChecked } = checkedFiles;
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inspectConfig, CONFIG_PATH } from '../cloud-files/config.mjs';

export const upstreamHash = '31d6a03e1e6995748503d33a28cadfd51204c57d9ef916c695c55a08cc46442d';
export const originalBranch = '}else await l(r)}catch(u){T(`Error processing config dir ${r}:`,u)}return n},gT=';
export const repairedBranch = '}else{let h=(0,ve.normalizePath)(r),a=await t.stat(h);a?.type==="file"?(e(h)||n.push(h)):a?.type==="folder"&&await l(h)}}catch(u){T(`Error processing config dir ${r}:`,u)}return n},gT=';
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function bundleState(source) {
  if (sha256(source) === upstreamHash) return 'upstream';
  if (source.split(repairedBranch).length === 2
      && sha256(source.replace(repairedBranch, originalBranch)) === upstreamHash) return 'repaired';
  return 'unsupported';
}

export function repairBundle(source) {
  const state = bundleState(source);
  if (state === 'repaired') return source;
  if (state !== 'upstream' || source.split(originalBranch).length !== 2) {
    throw new Error('FNS 源码不是已核对的 2.4.0 构建；未修改，先复核新版本。');
  }
  return source.replace(originalBranch, repairedBranch);
}

function rules(value) {
  if (!value) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some(rule => typeof rule?.pattern !== 'string')) {
    throw new Error('FNS 规则格式无法识别；未修改。');
  }
  return parsed;
}

const controlledKeys = ['configSyncEnabled', 'configSyncOtherDirs', 'syncExcludeFolders', 'pdfSyncEnabled'];
export function envOnlySettings(settings, configDir = '.obsidian') {
  const targets = rules(settings.configSyncOtherDirs);
  if (targets.some(rule => rule.pattern !== '.env') || rules(settings.syncExcludeWhitelist).length) {
    throw new Error('存在其他配置同步目标或白名单，须先核对范围；未扩大或覆盖。');
  }
  const excludes = rules(settings.syncExcludeFolders);
  if (settings.configSyncEnabled && !['.obsidian', '_localStorage'].every(prefix =>
    excludes.some(rule => rule.pattern.replace(/\/$/, '') === prefix))) {
    throw new Error('已有配置同步正在覆盖其他内容；未修改其范围。');
  }
  for (const prefix of [configDir, '_localStorage']) {
    if (!excludes.some(rule => rule.pattern.replace(/\/$/, '') === prefix)) {
      excludes.push({ pattern: prefix, caseSensitive: false });
    }
  }
  return { ...settings, configSyncEnabled: true,
    configSyncOtherDirs: JSON.stringify([{ pattern: '.env', caseSensitive: true }]),
    syncExcludeFolders: JSON.stringify(excludes), pdfSyncEnabled: false };
}

export function retiredSettings(settings) {
  const targets = rules(settings.configSyncOtherDirs);
  const remaining = targets.filter(rule => rule.pattern.trim().replace(/\/+$/, '') !== '.env');
  return remaining.length === targets.length ? { ...settings }
    : { ...settings, configSyncOtherDirs: JSON.stringify(remaining) };
}

export function originalBundle(source) {
  const state = bundleState(source);
  if (state === 'upstream') return source;
  if (state !== 'repaired') throw new Error('FNS 构建无法识别；未覆盖，先复核版本。');
  return source.replace(repairedBranch, originalBranch);
}

async function main() {
  const [command = '--check'] = process.argv.slice(2);
  if (!['--check', '--retire'].includes(command)) {
    throw new Error('根目录 .env 安装方案已退役。当前配置为 ' + CONFIG_PATH + '；仅支持 --check 或 --retire。');
  }
  const { default: target } = await import('../../lib/config/target.cjs');
  const vault = target.vaultArgument();
  const device = await deviceConfig.inspectDeviceConfig({ vault });
  if (device.status !== 'ready') throw new Error(device.message || '先将 FNS 旧链接迁回插件目录，再检查或修改配置。');
  const pluginDir = path.join(vault, '.obsidian/plugins/fast-note-sync');
  const mainPath = path.join(pluginDir, 'main.js'), settingsPath = path.join(pluginDir, 'data.json');
  const manifest = JSON.parse(await readFile(path.join(pluginDir, 'manifest.json'), 'utf8'));
  const source = await readFile(mainPath, 'utf8'), rawSettings = await readFile(settingsPath, 'utf8');
  const settings = JSON.parse(rawSettings), state = bundleState(source), desired = retiredSettings(settings);
  const settingsChanged = desired.configSyncOtherDirs !== settings.configSyncOtherDirs;
  if (command === '--check') {
    console.log(JSON.stringify({ version: manifest.version, scanner: state, legacyEnvRegistered: settingsChanged,
      legacySupportRetired: state === 'upstream' && !settingsChanged, currentConfig: CONFIG_PATH }));
    return;
  }
  if (manifest.version !== '2.4.0' || state === 'unsupported') throw new Error('不支持当前 FNS 构建；未修改。');
  const config = await inspectConfig(vault);
  if (config.state === 'missing') throw new Error('先完成共享网盘目标 JSONC 迁移，再移除旧支持。');
  const enabled = JSON.parse(await readFile(path.join(vault, '.obsidian/community-plugins.json'), 'utf8'));
  if (enabled.includes('fast-note-sync')) throw new Error('先在 Obsidian 中暂时关闭 FNS，再退役旧补丁，以避免运行中覆盖配置。');
  for (const rule of rules(desired.configSyncOtherDirs)) {
    const relative = rule.pattern.trim().replace(/\/+$/, '');
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('存在无法识别的额外目标；未修改。');
    const entry = await lstat(path.join(vault, relative)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (entry && !entry.isDirectory()) throw new Error('存在其他单文件或链接同步目标；先核对其需求，未移除支持。');
  }
  const upstream = originalBundle(source);
  if (source === upstream && !settingsChanged) { console.log(JSON.stringify({ changed: false, scanner: state, legacySupportRetired: true })); return; }
  const id = randomUUID(), recovery = path.join(vault, 'apps/workbench/data/fns-env-support', id);
  await mkdir(recovery, { recursive: true, mode: 0o700 });
  await writeFile(path.join(recovery, 'main.before.js'), source, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(recovery, 'settings.before.json'), rawSettings, { flag: 'wx', mode: 0o600 });
  const receipt = { id, operation: 'retire-root-env', createdAt: new Date().toISOString(), configSource: CONFIG_PATH,
    configSha256: config.source_sha256, beforeSourceHash: sha256(source), afterSourceHash: sha256(upstream),
    beforeSettingsHash: sha256(rawSettings), changedSetting: settingsChanged ? 'configSyncOtherDirs' : null };
  await writeFile(path.join(recovery, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (settingsChanged) await replaceChecked(settingsPath, rawSettings, JSON.stringify(desired, null, 2) + '\n', recovery);
  if (source !== upstream) await replaceChecked(mainPath, source, upstream, recovery);
  console.log(JSON.stringify({ changed: true, scanner: 'upstream', legacySupportRetired: true, recoveryId: id, restartRequired: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
