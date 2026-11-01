#!/usr/bin/env node
// Read the authoritative shared cloud-storage targets JSONC without modifying it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import vaultFiles from '../../lib/vault/files.js';
import jsonc from '../../lib/config/jsonc.cjs';
import target from '../../lib/config/target.cjs';

const { VaultFiles, hash } = vaultFiles;
export const CONFIG_PATH = 'config/cloud-storage-targets.jsonc';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validAlias = value => typeof value === 'string' && value.trim() === value && value.length > 0 && !/[\u0000-\u001f\u007f]/u.test(value);

export function validateTargets(value) {
  if (!plainObject(value) || Object.keys(value).some(key => !['default_account', 'remote_parents'].includes(key)) || !plainObject(value.remote_parents)) fail('INVALID_TARGETS', '网盘目标只能包含默认账号和父目录对象；不存入凭据。');
  for (const [alias, parent] of Object.entries(value.remote_parents)) {
    if (!validAlias(alias)) fail('INVALID_TARGETS', '账号别名须为非空文字，不含首尾空白或控制字符。');
    if (typeof parent !== 'string' || !parent.startsWith('/') || /[\\\u0000-\u001f\u007f]/u.test(parent) || parent.split('/').some(part => part === '.' || part === '..')) fail('INVALID_TARGETS', '账号父目录须为网盘绝对路径，不含反斜杠、控制字符或相对路径段。');
  }
  if (value.default_account !== null && (!validAlias(value.default_account) || !Object.hasOwn(value.remote_parents, value.default_account))) fail('INVALID_TARGETS', '默认账号必须为空，或对应已配置父目录的账号。');
  return value;
}

export function parseTargets(source) {
  let targets;
  try { targets = jsonc.parseJSONC(source); }
  catch (error) {
    if (error.code === 'DUPLICATE_KEY') fail('DUPLICATE_KEY', '网盘目标配置含重复键；先处理冲突，不采用最后一个值覆盖。');
    if (error.code === 'INVALID_JSONC') fail('INVALID_JSONC', '网盘目标配置不是有效 JSONC；未修改。');
    throw error;
  }
  return validateTargets(targets);
}

export function selectUploadTarget(targets, account = undefined, vaultDirectory) {
  validateTargets(targets);
  const selected = account === undefined ? targets.default_account : account;
  if (!validAlias(selected) || !Object.hasOwn(targets.remote_parents, selected)) fail('ACCOUNT_UNCONFIGURED', '选定上传账号未配置父目录；未回退到其他账号。');
  if (typeof vaultDirectory !== 'string' || !vaultDirectory || vaultDirectory.trim() !== vaultDirectory || ['.', '..'].includes(vaultDirectory) || /[\/\\\u0000-\u001f\u007f]/u.test(vaultDirectory)) fail('VAULT_DIRECTORY_REQUIRED', '需要目标库规则或本次明确选择的库网盘目录名；须为单个非空路径段，未采用软件默认值。');
  return { account_ref: selected, remote_parent: targets.remote_parents[selected], remote_root: path.posix.join(targets.remote_parents[selected], vaultDirectory) };
}

export async function inspectConfig(root, { configPath = CONFIG_PATH, files = new VaultFiles(root) } = {}) {
  let bytes;
  try { bytes = await files.io.readFile(await files.safe(configPath)); }
  catch (error) {
    if (error.code === 'ENOENT') return { ok: false, state: 'missing', source: configPath, message: '共享网盘目标 JSONC 尚未到达；先核对 FNS，不创建空文件覆盖远端。' };
    throw error;
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) fail('INVALID_ENCODING', '网盘目标配置不是有效 UTF-8；未修改。');
  const targets = parseTargets(text);
  const configured = targets.default_account !== null;
  return { ok: configured, state: configured ? 'configured' : 'unconfigured', source: configPath, source_sha256: hash(bytes), targets,
    message: configured ? undefined : '尚未配置默认上传账号；已配置父目录的账号仍可按次明确选择。' };
}

async function main() {
  try {
    const { values } = parseArgs({ options: { check: { type: 'boolean' }, help: { type: 'boolean' }, vault: { type: 'string' } } });
    if (values.help) {
      console.log('用法：node scripts/cloud-files/config.mjs --vault <知识库绝对路径> --check。只读检查 ' + CONFIG_PATH + '，不生成、不修改文件；未配置时退出码为 1。需要 Node.js 22 或更新版本。');
      return;
    }
    const root = target.resolveVault(values.vault);
    const result = await inspectConfig(root);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code ?? 'CONFIG_FAILED', message: error.message }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
