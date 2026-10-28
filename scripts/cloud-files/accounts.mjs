#!/usr/bin/env node
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Public personal OAuth application from https://github.com/baidu-netdisk/mcp.
export const CLIENT_ID = 'QHOuRXiepJBMjtk0esLhrPoNlQyYd0mF';
export const defaultStore = path.join(os.homedir(), '.config/tannt-cloud-files/accounts.json');
import target from '../../lib/config/target.cjs';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validAlias = value => typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function authorizationUrl(state) {
  if (!/^[a-f0-9]{64}$/u.test(state)) fail('INVALID_STATE', '授权请求须使用新生成的 32 字节随机 state。');
  const url = new URL('https://openapi.baidu.com/oauth/2.0/authorize');
  url.search = new URLSearchParams({ response_type: 'token', client_id: CLIENT_ID, redirect_uri: 'oob', scope: 'basic,netdisk', state }).toString();
  return url.toString();
}

export function parseAuthorizationResult(responseUrl, expectedState, now = Date.now()) {
  let url;
  try { url = new URL(responseUrl); } catch { fail('INVALID_RESULT', '授权结果不是有效网址。'); }
  if (url.origin !== 'https://openapi.baidu.com' || !url.pathname.startsWith('/oauth/2.0/') || url.username || url.password) fail('INVALID_RESULT', '授权结果必须来自百度官方 OAuth 页面。');
  const values = new URLSearchParams(url.hash.slice(1));
  if (!/^[a-f0-9]{64}$/u.test(expectedState ?? '') || !safeEqual(values.get('state'), expectedState)) fail('STATE_MISMATCH', '授权结果与本次请求不匹配；未保存。');
  if (values.has('error')) fail('AUTH_DENIED', '百度未授予本次请求的授权。');
  if (['access_token', 'expires_in', 'state', 'token_type'].some(key => values.getAll(key).length > 1)) fail('INVALID_RESULT', '授权结果包含重复字段。');
  const token = values.get('access_token');
  if (!token || /\s/u.test(token) || token.length > 8192) fail('INVALID_RESULT', '授权结果缺少有效访问令牌。');
  const type = values.get('token_type');
  if (type && type.toLowerCase() !== 'bearer') fail('INVALID_RESULT', '授权结果的令牌类型不受支持。');
  const seconds = values.get('expires_in');
  if (!/^\d+$/u.test(seconds ?? '') || !Number.isSafeInteger(Number(seconds)) || Number(seconds) <= 0 || !Number.isFinite(new Date(now + Number(seconds) * 1000).getTime())) fail('INVALID_EXPIRY', '授权结果缺少有效到期时间；未保存。');
  return { access_token: token, auth_method: 'implicit', client_id: CLIENT_ID,
    authorized_at: new Date(now).toISOString(), expires_at: new Date(now + Number(seconds) * 1000).toISOString() };
}

export async function queryIdentity(token, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || !token || /\s/u.test(token)) fail('TOKEN_MISSING', '未取得可用访问令牌。');
  const url = new URL('https://pan.baidu.com/rest/2.0/xpan/nas');
  url.search = new URLSearchParams({ method: 'uinfo', access_token: token }).toString();
  let response;
  try { response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { fail('IDENTITY_UNAVAILABLE', '百度账号接口暂不可用；未输出请求网址或令牌。'); }
  if (!response.ok) fail('IDENTITY_UNAVAILABLE', '百度账号接口未成功响应；未保存授权。');
  let body;
  try { body = await response.json(); } catch { fail('INVALID_IDENTITY', '百度账号接口未返回有效 JSON。'); }
  if (body.errno !== 0) fail('AUTH_INVALID', '访问令牌未通过百度账号核验，可能已失效或权限不足。');
  if ((typeof body.uk === 'number' && (!Number.isSafeInteger(body.uk) || body.uk <= 0)) || !/^[1-9]\d*$/u.test(String(body.uk ?? ''))) fail('INVALID_IDENTITY', '百度未返回可精确记录的账号 UK。');
  const nickname = typeof body.netdisk_name === 'string' ? body.netdisk_name : typeof body.baidu_name === 'string' ? body.baidu_name : null;
  return { account_id: String(body.uk), nickname };
}

async function inspectDirectory(storePath, create = false, vault) {
  const directory = path.dirname(storePath);
  if (create) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let stat;
  try { stat = await fs.lstat(directory); }
  catch (error) { if (!create && error.code === 'ENOENT') return false; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_STORE', '授权目录必须是本机普通目录。');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())) fail('UNSAFE_STORE', '授权目录须由当前用户拥有，且仅当前用户可访问（0700）。');
  if (vault || path.resolve(storePath) === path.resolve(defaultStore)) {
    const actual = await fs.realpath(directory);
    const root = target.resolveVault(vault);
    const relative = path.relative(root, actual);
    if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) fail('UNSAFE_STORE', '授权秘密不能保存到当前同步仓库内。');
  }
  return true;
}

async function readStore(storePath, vault) {
  if (!(await inspectDirectory(storePath, false, vault))) return { raw: null, data: { schema: 'tannt-cloud-accounts/v1', accounts: {} } };
  // Windows does not implement O_NOFOLLOW; inspect the entry before opening it.
  const entry = await fs.lstat(storePath).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (entry && (!entry.isFile() || entry.isSymbolicLink())) fail('UNSAFE_STORE', '授权档案必须是普通文件。');
  let handle;
  try { handle = await fs.open(storePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if (error.code === 'ENOENT') return { raw: null, data: { schema: 'tannt-cloud-accounts/v1', accounts: {} } };
    fail('UNSAFE_STORE', '无法安全读取本机授权档案。');
  }
  try {
    const stat = await handle.stat();
    const after = await fs.lstat(storePath);
    if (after.isSymbolicLink() || after.dev !== stat.dev || after.ino !== stat.ino) fail('UNSAFE_STORE', '授权档案在读取时发生替换。');
    if (!stat.isFile() || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) fail('UNSAFE_STORE', '授权档案须为当前用户独有的普通文件（0600）。');
    const raw = await handle.readFile('utf8');
    let data;
    try { data = JSON.parse(raw); } catch { fail('INVALID_STORE', '本机授权档案格式损坏；未覆盖。'); }
    if (!object(data) || data.schema !== 'tannt-cloud-accounts/v1' || !object(data.accounts)) fail('INVALID_STORE', '本机授权档案的 schema 或账号集合无效。');
    for (const [alias, item] of Object.entries(data.accounts)) {
      if (!validAlias(alias) || !object(item) || item.provider !== 'baidu' || typeof item.account_id !== 'string' || !/^[1-9]\d*$/u.test(item.account_id) || typeof item.access_token !== 'string' || !item.access_token) fail('INVALID_STORE', '本机授权档案包含无效账号记录；未输出凭据。');
    }
    return { raw, data };
  } finally { await handle.close(); }
}

function publicProfile(alias, profile, now = Date.now()) {
  return { account_ref: alias, provider: profile.provider, account_id: profile.account_id,
    nickname: profile.nickname ?? null, auth_method: profile.auth_method,
    expires_at: profile.expires_at ?? null,
    expiry: !profile.expires_at ? 'unknown' : !Number.isFinite(Date.parse(profile.expires_at)) ? 'invalid' : Date.parse(profile.expires_at) <= now ? 'expired' : 'valid',
    verified_at: profile.verified_at ?? null };
}

export async function listAccounts({ vault, storePath = defaultStore } = {}) {
  const { data } = await readStore(storePath, vault);
  return Object.entries(data.accounts).map(([alias, profile]) => publicProfile(alias, profile));
}

export async function checkAccount(alias, { vault, storePath = defaultStore, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!validAlias(alias)) fail('INVALID_ALIAS', '需要明确的账号别名。');
  const { data } = await readStore(storePath, vault);
  if (!Object.hasOwn(data.accounts, alias)) fail('ACCOUNT_MISSING', '本机没有该别名的授权；未回退到其他账号。');
  const profile = data.accounts[alias], publicData = publicProfile(alias, profile, now);
  if (['expired', 'invalid'].includes(publicData.expiry)) fail('AUTH_EXPIRED', '本机授权已到期或到期记录无效，请重新授权。');
  const identity = await queryIdentity(profile.access_token, { fetchImpl });
  if (identity.account_id !== profile.account_id) fail('ACCOUNT_MISMATCH', '实际百度账号与本机档案不符；停止该账号的远端操作。');
  return { ...publicData, ...identity, verified: true, checked_at: new Date(now).toISOString() };
}

export async function saveAuthorization(alias, authorization, { vault, storePath = defaultStore, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!validAlias(alias)) fail('INVALID_ALIAS', '需要明确的账号别名。');
  if (!object(authorization) || authorization.auth_method !== 'implicit' || authorization.client_id !== CLIENT_ID || !Number.isFinite(Date.parse(authorization.expires_at)) || Date.parse(authorization.expires_at) <= now) fail('INVALID_AUTHORIZATION', '授权信息或到期时间无效；未保存。');
  const initial = await readStore(storePath, vault);
  const identity = await queryIdentity(authorization.access_token, { fetchImpl });
  const existing = Object.hasOwn(initial.data.accounts, alias) ? initial.data.accounts[alias] : null;
  if (existing && existing.account_id !== identity.account_id) fail('ACCOUNT_MISMATCH', '该别名已绑定另一个百度账号；未覆盖现有授权。');
  await inspectDirectory(storePath, true, vault);
  const lock = path.join(path.dirname(storePath), 'accounts.lock');
  try { await fs.mkdir(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') fail('STORE_LOCKED', '另一个授权操作占用档案；未抢占锁。'); throw error; }
  let pending;
  try {
    if ((await readStore(storePath, vault)).raw !== initial.raw) fail('STORE_CHANGED', '账号档案在核验期间发生变化；未覆盖。');
    const profile = { ...existing, provider: 'baidu', ...identity,
      auth_method: authorization.auth_method, client_id: authorization.client_id,
      access_token: authorization.access_token, expires_at: authorization.expires_at,
      authorized_at: authorization.authorized_at, verified_at: new Date(now).toISOString() };
    const data = { ...initial.data, accounts: { ...initial.data.accounts, [alias]: profile } };
    const next = JSON.stringify(data, null, 2) + '\n';
    pending = path.join(path.dirname(storePath), `accounts-${randomUUID()}.pending`);
    await fs.writeFile(pending, next, { flag: 'wx', mode: 0o600 });
    if ((await readStore(storePath, vault)).raw !== initial.raw) fail('STORE_CHANGED', '账号档案在写入前发生变化；未覆盖。');
    if (initial.raw === null) {
      try { await fs.link(pending, storePath); }
      catch (error) { if (error.code === 'EEXIST') fail('STORE_CHANGED', '另一个进程已创建账号档案；未覆盖。'); throw error; }
      await fs.unlink(pending);
    } else { await fs.rename(pending, storePath); }
    pending = null;
    if ((await readStore(storePath, vault)).raw !== next) fail('READBACK_MISMATCH', '保存后账号档案发生变化；请核对本机结果。');
    return { ...publicProfile(alias, profile, now), saved: true, verified: true };
  } finally {
    if (pending) await fs.unlink(pending).catch(() => {});
    await fs.rmdir(lock);
  }
}

async function main() {
  try {
    const { values } = parseArgs({ options: { list: { type: 'boolean' }, check: { type: 'boolean' }, account: { type: 'string' }, help: { type: 'boolean' }, vault: { type: 'string' } } });
    if (values.help) { console.log('指定 --vault <知识库绝对路径>。只读：--list 或 --check --account <别名>。授权由 Skill 通过官方网页取得，并在进程内调用保存函数；不接受命令行令牌。'); return; }
    if (values.check === values.list || (values.check && !values.account) || (values.list && values.account)) fail('INVALID_ARGS', '使用 --list 或 --check --account <别名>。');
    const options = { vault: target.resolveVault(values.vault) };
    const result = values.check ? await checkAccount(values.account, options) : await listAccounts(options);
    console.log(JSON.stringify({ ok: true, result }, null, 2));
  } catch (error) {
    // Do not echo fetch errors, callback URLs or arbitrary exception messages.
    console.error(JSON.stringify({ ok: false, code: error.code?.startsWith?.('ERR_') ? 'INVALID_ARGS' : error.code ?? 'AUTH_OPERATION_FAILED', message: error.code && !error.code.startsWith('ERR_') ? error.message : '授权操作未完成；凭据未输出。' }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
