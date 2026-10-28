#!/usr/bin/env node
import { lstat, mkdir, readFile, realpath, readlink, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import jsonc from '../../lib/config/jsonc.cjs';
import target from '../../lib/config/target.cjs';
const packageRoot = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const stat = async p => lstat(p).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
const same = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
try {
  const { values, tokens } = parseArgs({ options: { check: { type: 'boolean' }, help: { type: 'boolean' }, agent: { type: 'string', default: 'all' }, vault: { type: 'string' }, 'migrate-from': { type: 'string' } }, tokens: true });
  const agent = values.agent;
  if (!['codex', 'claude', 'all'].includes(agent) || tokens.filter(t => t.name === 'agent').length > 1) throw Error('--agent 只能指定一次，值为 codex、claude 或 all。');
  if (values.help) console.log('install.mjs --vault <知识库绝对路径> [--agent codex|claude|all] [--check] [--migrate-from <已核实旧 skills 目录>]\n独立执行 Skill 注册；普通插件安装不调用此命令。');
  else {
    const root = target.resolveVault(values.vault), check = Boolean(values.check);
    const settings = jsonc.parseJSONC(await readFile(path.join(packageRoot, 'skills/manifest.jsonc'), 'utf8'));
    if (values['migrate-from'] && !path.isAbsolute(values['migrate-from'])) throw Error('--migrate-from 必须为已核实旧目录的绝对路径。');
    const oldRoot = values['migrate-from'] && path.resolve(values['migrate-from']);
    const plan = [], retired = [], changed = [];
    const surfaces = agent === 'all' ? ['.agents', '.claude'] : [agent === 'codex' ? '.agents' : '.claude'];
    for (const name of [...settings.skills, ...settings.retired]) if (!/^[a-z0-9-]+$/.test(name)) throw Error('技能清单含无效名称。');
    for (const surface of surfaces) {
      for (const directory of [surface, `${surface}/skills`]) {
        const info = await stat(path.join(root, directory));
        if (info && (!info.isDirectory() || info.isSymbolicLink())) throw Error(directory + ' 不是普通目录。');
      }
      for (const name of settings.skills) {
        const source = path.join(packageRoot, 'skills', name), entry = `${surface}/skills/${name}`, destination = path.join(root, entry);
        const sourceStat = await stat(source);
        if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink() || !(await readFile(path.join(source, 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n').includes(`name: ${name}\n`)) throw Error('无效 Skill 源码：' + name);
        const info = await stat(destination);
        let previous = null, correct = false;
        if (info) {
          if (!info.isSymbolicLink()) throw Error('入口被普通文件或目录占用：' + entry);
          previous = await readlink(destination);
          const resolved = await realpath(destination).catch(() => path.resolve(path.dirname(destination), previous));
          correct = same(resolved, source);
          if (!correct && (!oldRoot || !same(resolved, path.join(oldRoot, name)))) throw Error('入口指向其他来源：' + entry);
        }
        plan.push({ entry, target: path.relative(path.dirname(destination), source), previous, correct });
      }
      for (const name of settings.retired) {
        const entry = `${surface}/skills/${name}`, destination = path.join(root, entry), info = await stat(destination);
        if (!info) continue;
        if (!info.isSymbolicLink()) throw Error('退役入口被普通内容占用：' + entry);
        const previous = await readlink(destination), resolved = path.resolve(path.dirname(destination), previous);
        if (![path.join(packageRoot, 'skills', name), ...(oldRoot ? [path.join(oldRoot, name)] : [])].some(expected => same(resolved, expected))) throw Error('退役入口来源未知：' + entry);
        retired.push({ entry, previous });
      }
    }
    if (!check) {
      try {
        for (const item of plan.filter(item => !item.correct)) {
          const file = path.join(root, item.entry);
          await mkdir(path.dirname(file), { recursive: true });
          if (item.previous !== null) {
            if (await readlink(file) !== item.previous) throw Error('入口已被其他程序修改：' + item.entry);
            await unlink(file);
          }
          changed.push(item);
          await symlink(item.target, file, 'dir');
        }
        for (const item of retired) {
          const file = path.join(root, item.entry);
          if (await readlink(file) !== item.previous) throw Error('退役入口发生变化：' + item.entry);
          await unlink(file); changed.push({ ...item, removed: true });
        }
      } catch (error) {
        for (const item of changed.reverse()) {
          const file = path.join(root, item.entry), info = await stat(file);
          if (info?.isSymbolicLink() && await readlink(file) === item.target) await unlink(file);
          if (!(await stat(file)) && item.previous !== null) await symlink(item.previous, file, 'dir');
        }
        throw error;
      }
    }
    const ok = !check || plan.every(p => p.correct) && !retired.length;
    console.log(JSON.stringify({ ok, mode: check ? 'check' : 'install', agent, vault: root, packageRoot, entries: plan.map(({ entry, correct }) => ({ entry, configured: check ? correct : true })), retired: retired.map(x => x.entry) }, null, 2));
    if (!ok) process.exitCode = 1;
  }
} catch (error) { console.error(JSON.stringify({ ok: false, message: error.message })); process.exitCode = 1; }
