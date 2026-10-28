#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import skills from '../../lib/agent-skills/manager.cjs';
import target from '../../lib/config/target.cjs';
try {
  const { values, tokens } = parseArgs({ options: {
    check: { type: 'boolean' }, help: { type: 'boolean' }, agent: { type: 'string', default: 'all' }, vault: { type: 'string' },
    skill: { type: 'string', multiple: true }, action: { type: 'string', default: 'install' },
    'config-dir': { type: 'string', default: '.obsidian' }, 'migrate-from': { type: 'string' }
  }, tokens: true });
  if (values.help) console.log('install.mjs --vault <知识库绝对路径> [--agent codex|claude|all] [--skill <名称> ...] [--check | --action install|repair|remove] [--config-dir .obsidian] [--migrate-from <已核实旧 skills 绝对目录>]\n只读检查或显式管理项目发现入口。默认安装所选宿主全部未安装项，冲突与损坏逐项跳过；修复、移除须明确 --skill。不会配置 Git/FNS、服务或全局规则。');
  else {
    for (const name of ['vault', 'agent', 'action', 'config-dir', 'migrate-from']) if (tokens.filter(t => t.name === name).length > 1) throw Error(`--${name} 只能指定一次。`);
    if (!['codex', 'claude', 'all'].includes(values.agent)) throw Error('--agent 须为 codex、claude 或 all。');
    if (!['install', 'repair', 'remove'].includes(values.action)) throw Error('--action 须为 install、repair 或 remove。');
    if (!values.check && values.action !== 'install' && !values.skill?.length) throw Error('修复或移除须用 --skill 明确选择入口。');
    if (values['migrate-from'] && (!path.isAbsolute(values['migrate-from']) || values.action !== 'repair' && !values.check)) throw Error('--migrate-from 须为已核实旧目录的绝对路径，且只用于检查或显式 repair。');
    const vault = target.resolveVault(values.vault), configDir = target.configDirectory(values['config-dir']);
    const packageRoot = path.join(vault, configDir, 'plugins/tannt-workbench');
    const manager = new skills.SkillManager({ vault, packageRoot, configDir, migrateFrom: values['migrate-from'] });
    const catalog = await manager.catalog();
    if (values.skill && (new Set(values.skill).size !== values.skill.length || values.skill.some(n => !catalog.names.includes(n)))) throw Error('--skill 含重复或非活动名称。');
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
} catch (error) { console.error(JSON.stringify({ ok: false, code: error.code || 'FAILED', message: error.message })); process.exitCode = 1; }
