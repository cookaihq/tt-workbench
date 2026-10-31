#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import skills from '../../lib/agent-skills/manager.cjs';
import target from '../../lib/config/target.cjs';
import fs from 'node:fs/promises';
import updates from '../../lib/agent-skills/updates.cjs';
try {
  const { values, tokens } = parseArgs({ options: {
    check: { type: 'boolean' }, help: { type: 'boolean' }, agent: { type: 'string', default: 'all' }, vault: { type: 'string' },
    skill: { type: 'string', multiple: true }, action: { type: 'string', default: 'install' },
    'config-dir': { type: 'string', default: '.obsidian' }, 'migrate-from': { type: 'string' },
    'check-updates': { type: 'boolean' }, repository: { type: 'string' }, recover: { type: 'string' }, 'finish-update': { type: 'boolean' }
  }, tokens: true });
  if (values.help) console.log('install.mjs --vault <知识库绝对路径> [--agent codex|claude|all] [--skill <名称> ...] [--check | --action install|repair|remove|update] [--config-dir .obsidian] [--migrate-from <已核实旧 skills 绝对目录>]\n--check-updates [--repository owner/repo]：只读查询正式 Skill 版本；省略仓库时读取工作台设置。\n--action update --skill <名称> --agent codex|claude：核验正式包后更新；两个已注册宿主共用包，不额外注册入口。\n--recover <操作标识> [--finish-update] --agent codex|claude：原进程退出后恢复此前版本；明确 --finish-update 则接续新版。\n默认管理项目发现入口，冲突与损坏逐项跳过；修复、移除、更新须明确 --skill。不会配置 Git/FNS、服务或全局规则。');
  else {
    for (const name of ['vault', 'agent', 'action', 'config-dir', 'migrate-from', 'repository', 'recover']) if (tokens.filter(t => t.name === name).length > 1) throw Error(`--${name} 只能指定一次。`);
    if (!['codex', 'claude', 'all'].includes(values.agent)) throw Error('--agent 须为 codex、claude 或 all。');
    if (!['install', 'repair', 'remove', 'update'].includes(values.action)) throw Error('--action 须为 install、repair、remove 或 update。');
    if ((values.action === 'update' || values.recover) && values.agent === 'all') throw Error('更新或恢复请选择一个检查宿主；安装包仍由两宿主共用。');
    if (values['finish-update'] && !values.recover) throw Error('--finish-update 只能与 --recover 同时使用。');
    if (values.recover && (values.check || values['check-updates'] || values.action !== 'install' || values.skill || values['migrate-from'])) throw Error('--recover 不能与其他操作组合。');
    if (values.check && values['check-updates']) throw Error('--check 与 --check-updates 请分别使用。');
    if (values.check && values.action === 'update') throw Error('只读查询新版请使用 --check-updates；--check 不执行更新。');
    if (!values.check && values.action !== 'install' && !values.skill?.length) throw Error('修复或移除须用 --skill 明确选择入口。');
    if (values['migrate-from'] && (!path.isAbsolute(values['migrate-from']) || values.action !== 'repair' && !values.check)) throw Error('--migrate-from 须为已核实旧目录的绝对路径，且只用于检查或显式 repair。');
    const vault = target.resolveVault(values.vault), configDir = target.configDirectory(values['config-dir']);
    const packageRoot = path.join(vault, configDir, 'plugins/tt-workbench');
    const manager = new skills.SkillManager({ vault, packageRoot, configDir, migrateFrom: values['migrate-from'] });
    const catalog = await manager.catalog();
    if (values.skill && (new Set(values.skill).size !== values.skill.length || values.skill.some(n => !catalog.names.includes(n)))) throw Error('--skill 含重复或非活动名称。');
    if (values['check-updates'] || values.action === 'update' || values.recover) {
      const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'manifest.json'), 'utf8'));
      let repository = values.repository;
      if (repository === undefined) {
        try { repository = JSON.parse(await fs.readFile(path.join(packageRoot, 'data.json'), 'utf8')).updateRepository || ''; }
        catch (error) { if (error.code === 'ENOENT') repository = ''; else throw error; }
      }
      const service = new updates.SkillUpdates({ manager, repository, workbenchVersion: manifest.version });
      if (values.recover) console.log(JSON.stringify(await service.recover({ operation: values.recover, agent: values.agent, mode: values['finish-update'] ? 'finish' : 'rollback' }), null, 2));
      else {
        const checked = await service.check();
        if (values['check-updates']) {
          const reports = [];
          for (const agent of values.agent === 'all' ? ['codex', 'claude'] : [values.agent]) {
            const snapshot = await manager.scan(agent);
            reports.push({ agent, items: snapshot.items.filter(i => !values.skill || values.skill.includes(i.name)).map(item => ({ ...item, update: service.forItem(item, agent) })) });
          }
          console.log(JSON.stringify({ kind: checked.kind, message: checked.message, batch: checked.catalog?.batch, reports }, null, 2));
          if (checked.kind !== 'ready') process.exitCode = 1;
        } else {
          const reports = [];
          for (const name of values.skill) {
            try { reports.push(await service.install({ name, agent: values.agent })); }
            catch (error) { reports.push({ ok: false, name, code: error.code || 'FAILED', message: error.message }); }
          }
          console.log(JSON.stringify({ ok: reports.every(r => r.ok), reports }, null, 2));
          if (reports.some(r => !r.ok)) process.exitCode = 1;
        }
      }
    } else {
    const reports = [];
    for (const agent of values.agent === 'all' ? ['codex', 'claude'] : [values.agent]) {
      try {
        if (values.check) {
          const snapshot = await manager.scan(agent);
          if (values.skill) snapshot.items = snapshot.items.filter(i => values.skill.includes(i.name));
          reports.push({ agent, ok: snapshot.items.every(i => i.status === 'installed'), snapshot });
        } else reports.push(await manager.apply({ agent, names: values.skill, action: values.action }));
      } catch (e) { reports.push({ agent, ok: false, code: e.code || 'FAILED', message: e.message }); }
    }
    const result = { ok: reports.every(r => r.ok), mode: values.check ? 'check' : values.action, vault: manager.vault, packageRoot: manager.packageRoot, reports };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    }
  }
} catch (error) { console.error(JSON.stringify({ ok: false, code: error.code || 'FAILED', message: error.message })); process.exitCode = 1; }
