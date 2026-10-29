#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import packages from '../../lib/workbench/package.cjs';
try {
  const { values } = parseArgs({ options: { help: { type: 'boolean' }, check: { type: 'boolean' }, vault: { type: 'string' }, 'config-dir': { type: 'string' }, bundle: { type: 'string' }, 'migrate-legacy': { type: 'boolean' } } });
  if (values.help) console.log('install.mjs --vault <知识库绝对路径> [--config-dir .obsidian] [--bundle <安装包.json.gz>] [--check] [--migrate-legacy]\n只安装插件文件及内置资源；不创建业务目录、不注册 Skill、不配置 FNS 或用户规则。--check 只比较安装文件。\n--migrate-legacy：关闭 Obsidian 后迁移旧 tannt-workbench 安装，保留插件设置和旧目录恢复材料；重启后启用「tt 工作台」，再单独修复旧 Skill 入口。');
  else {
    let bundle;
    if (values.bundle) {
      if ((await stat(values.bundle)).size > 64 * 1024 * 1024) throw Error('安装包过大。');
      bundle = packages.decodeBundle(await readFile(values.bundle));
    } else bundle = await packages.collectPackage(fileURLToPath(new URL('../../', import.meta.url)));
    const result = await packages.installPackage(bundle, { vault: values.vault, configDir: values['config-dir'], check: values.check, migrateLegacy: values['migrate-legacy'] });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) { console.error(JSON.stringify({ ok: false, code: error.code || 'INSTALL_FAILED', message: error.message })); process.exitCode = 1; }
