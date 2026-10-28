#!/usr/bin/env node
import { lstat, mkdir, readFile, readlink, realpath, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

let source;
const userDirectory = os.homedir();
const stat = async file => lstat(file).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});

try {
  const { values, tokens } = parseArgs({ options: { check: { type: 'boolean' }, help: { type: 'boolean' }, agent: { type: 'string', default: 'all' }, source: { type: 'string' } }, tokens: true });
  const agent = values.agent;
  if (!['codex', 'claude', 'all'].includes(agent) || tokens.filter(token => token.name === 'agent').length > 1) throw Error('--agent 只能指定一次，值为 codex、claude 或 all');
  const agents = agent === 'all' ? ['codex', 'claude'] : [agent];
  if (values.help) {
    console.log('用法：node scripts/global-agent-instructions/install.mjs --source <已确认规则源绝对路径> [--agent codex|claude|all] [--check]。默认 all；只处理所选宿主及共用场景入口。软件包不提供个人规则正文。');
  } else {
    if (!values.source || !path.isAbsolute(values.source) || tokens.filter(t => t.name === 'source').length !== 1) throw Error('必须用 --source 显式指定一次已确认的规则源绝对路径。');
    source = path.resolve(values.source);
    if (!(await stat(source))?.isDirectory() || (await stat(source)).isSymbolicLink() || await realpath(source) !== source) throw Error('规则源必须是未经链接转向的普通目录。');
    const scenes = await stat(path.join(source, 'scenarios-agent-instructions'));
    if (!scenes?.isDirectory() || scenes.isSymbolicLink()) throw Error('规则场景源必须是普通目录。');
    const check = Boolean(values.check);
    for (const [host, name, expected] of [['codex', 'CODEX_HOME', '.codex'], ['claude', 'CLAUDE_CONFIG_DIR', '.claude']]) {
      if (!agents.includes(host)) continue;
      if (process.env[name] && path.resolve(process.env[name]) !== path.join(userDirectory, expected)) {
        throw Error(`${name} 使用自定义位置，本脚本仅支持默认用户目录；未修改入口`);
      }
    }
    for (const name of [
      'AGENTS.md',
      'README.md',
      'scenarios-agent-instructions/maintaining-agent-instructions-and-project-rules.md',
      'scenarios-agent-instructions/temporary-files-and-reusable-scripts.md',
      'scenarios-agent-instructions/proposing-and-evaluating-plans.md',
      'scenarios-agent-instructions/reviewing-related-features.md',
      'scenarios-agent-instructions/lark-cli-and-hermes-feishu-config.md',
    ]) {
      const file = path.join(source, name);
      const info = await stat(file);
      if (!info?.isFile() || info.isSymbolicLink() || !(await readFile(file, 'utf8')).trim()) throw Error(`缺少普通源文件：${file}`);
    }
    const override = path.join(userDirectory, '.codex/AGENTS.override.md');
    if (agents.includes('codex') && await stat(override)) {
      if ((await readFile(override, 'utf8')).trim()) throw Error(`存在其他全局指令入口：${override}；先核对其用途`);
    }
    const legacy = path.join(userDirectory, '.agents/global-instructions');
    const main = path.join(source, 'AGENTS.md');
    const plan = [
      { entry: path.join(userDirectory, '.agents/scenarios-agent-instructions'), target: path.join(source, 'scenarios-agent-instructions'), type: 'dir' },
      ...(agents.includes('codex') ? [{ entry: path.join(userDirectory, '.codex/AGENTS.md'), target: main, type: 'file' }] : []),
      ...(agents.includes('claude') ? [{ entry: path.join(userDirectory, '.claude/CLAUDE.md'), target: main, type: 'file' }] : []),
    ];
    for (const item of plan) {
      const parent = await stat(path.dirname(item.entry));
      if (parent && (!parent.isDirectory() || parent.isSymbolicLink())) throw Error(`入口父目录不是普通目录：${path.dirname(item.entry)}`);
      const info = await stat(item.entry);
      item.previousTarget = null;
      item.action = 'create';
      if (info) {
        if (!info.isSymbolicLink()) throw Error(`入口被普通文件或目录占用，未覆盖：${item.entry}`);
        item.previousTarget = await readlink(item.entry);
        const target = path.resolve(path.dirname(item.entry), item.previousTarget);
        if (await realpath(item.entry).catch(() => null) !== item.target) {
          throw Error(`入口指向其他目标，未修改：${item.entry} → ${target}`);
        }
        item.action = target === item.target ? 'keep' : 'replace';
        if (check && item.action === 'replace') throw Error(`入口仍经过中间链接，需迁移为直接指向正式源：${item.entry}`);
      } else if (check) throw Error(`缺少入口：${item.entry}`);
    }
    // A host outside this operation may still load its main file through this shared directory.
    const legacyInfo = agent === 'all' ? await stat(legacy) : null;
    let legacyTarget = null;
    if (legacyInfo) {
      if (!legacyInfo.isSymbolicLink() || await realpath(legacy).catch(() => null) !== source) {
        throw Error(`旧入口不是指向当前正式源的链接，未移除：${legacy}`);
      }
      legacyTarget = await readlink(legacy);
      if (check) throw Error(`仍存在旧目录入口，需完成迁移：${legacy}`);
    }
    const assertUnchanged = async (entry, previousTarget) => {
      const info = await stat(entry);
      if (previousTarget === null ? Boolean(info) : !info?.isSymbolicLink() || await readlink(entry) !== previousTarget) {
        throw Error(`入口在检查后发生变化，停止修改：${entry}`);
      }
    };
    const changed = [];
    try {
      if (!check) {
        for (const item of plan.filter(item => item.action !== 'keep')) {
          await assertUnchanged(item.entry, item.previousTarget);
          await mkdir(path.dirname(item.entry), { recursive: true });
          changed.push({ ...item });
          if (item.previousTarget !== null) await unlink(item.entry);
          await symlink(item.target, item.entry, item.type);
        }
      }
      for (const item of plan) {
        if (await realpath(item.entry) !== item.target || path.resolve(path.dirname(item.entry), await readlink(item.entry)) !== item.target) {
          throw Error(`入口未直接指向预期源：${item.entry}`);
        }
      }
      if (!check && legacyTarget !== null) {
        await assertUnchanged(legacy, legacyTarget);
        changed.push({ entry: legacy, previousTarget: legacyTarget, target: null, type: 'dir' });
        await unlink(legacy);
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const item of changed.reverse()) {
        try {
          const info = await stat(item.entry);
          if (info) {
            if (!info.isSymbolicLink()) throw Error('入口已被其他内容占用');
            const current = await readlink(item.entry);
            if (current === item.previousTarget) continue;
            if (current !== item.target) throw Error('链接已被其他操作修改');
            await unlink(item.entry);
          }
          if (item.previousTarget !== null) await symlink(item.previousTarget, item.entry, item.type);
        } catch (rollbackError) {
          rollbackErrors.push(`${item.entry}: ${rollbackError.message}`);
        }
      }
      if (rollbackErrors.length) error.message += `；部分链接未恢复：${rollbackErrors.join('；')}`;
      throw error;
    }
    console.log(JSON.stringify({ ok: true, mode: check ? 'check' : 'install', agent, source, entries: plan, legacyCleanup: agent === 'all' ? 'checked' : 'not-checked-for-single-agent', removed: legacyTarget === null ? [] : [legacy] }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, message: error.message }));
  process.exitCode = 1;
}
