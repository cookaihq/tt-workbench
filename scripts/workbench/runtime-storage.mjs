#!/usr/bin/env node
import { parseArgs } from 'node:util';
import runtime from '../../lib/runtime/migrate.cjs';
try {
  const { values } = parseArgs({ options: { help: { type: 'boolean' }, vault: { type: 'string' }, 'config-dir': { type: 'string' }, directory: { type: 'string' }, reset: { type: 'boolean' }, 'configure-isolation': { type: 'boolean' }, check: { type: 'boolean' }, apply: { type: 'boolean' }, resume: { type: 'boolean' }, restore: { type: 'boolean' }, backup: { type: 'string' }, expected: { type: 'string' }, 'writers-stopped': { type: 'boolean' } } });
  if (values.help) console.log('runtime-storage.mjs --vault <实例绝对路径> [--config-dir .obsidian] [--directory <实例内相对目录> | --reset] --check\n默认位置：.system/.workbench-runtime；固定配置：.system/workbench/runtime.jsonc\n迁移并保存位置：同一 directory/reset 参数加 --apply --expected <检查指纹> --backup <库外独立备份目录> --writers-stopped\n补齐本实例 Git/FNS 排除：加 --configure-isolation，仅修改必要排除并保留原配置备份\n中断续做：--resume --backup <原备份目录> --writers-stopped\n恢复旧位置：--restore --backup <原备份目录> --writers-stopped\n先实际停止旧版工作台、CLI 和 FNS。安装与检查不迁移。恢复拒绝覆盖后续变化，保留安全排除；旧锁和连接记录须先核对。');
  else {
    if ([values.check, values.apply, values.resume, values.restore].filter(Boolean).length !== 1) throw Error('明确选择 --check、--apply、--resume 或 --restore。');
    if (values.reset && values.directory !== undefined) throw Error('--directory 与 --reset 不能同时使用。');
    const options = { vault: values.vault, configDir: values['config-dir'], directory: values.directory, reset: values.reset, configureIsolation: values['configure-isolation'], backup: values.backup, expected: values.expected, resume: values.resume, restore: values.restore, writersStopped: values['writers-stopped'] };
    console.log(JSON.stringify(values.check ? await runtime.inspect(options) : await runtime.migrate(options), null, 2));
  }
} catch (e) { console.error(JSON.stringify({ ok: false, code: e.code || 'MIGRATION_FAILED', message: e.message })); process.exitCode = 1; }
