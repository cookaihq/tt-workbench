#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import vault from '../../lib/vault/index.js';
import targets from '../../lib/config/target.cjs';

export async function request(input, target, options = {}) {
  try { return await vault.execute(targets.resolveVault(target), input, options); } catch (error) { return vault.errorResult(error); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('从 stdin 接收 JSON，显式 --vault <知识库绝对路径>，可选 --config-dir <Obsidian配置目录>；直接读取和写入文件，不需要启动 Obsidian。');
    console.log('action: info / read / capture / create-note / create-project / create-task / transfer-inbox / transfer-to-task / archive-project / restore-project / archive-material / restore-material / update / attach；写入提供 request_id 和 privacy: ordinary。');
    console.log('字段与示例：docs/agents/vault-file-operations.md；业务规则：docs/rules/README.md。');
  } else {
    try {
      const { values } = parseArgs({ options: { vault: { type: 'string' }, 'config-dir': { type: 'string' } } });
      const target = targets.vaultArgument();
      process.stdin.setEncoding('utf8');
      let source = ''; for await (const chunk of process.stdin) source += chunk;
      const result = await request(JSON.parse(source), target, { configDir: values['config-dir'] });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (!result.ok) process.exitCode = 1;
    } catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code || 'INVALID_JSON', message: error.message }) + '\n'); process.exitCode = 1; }
  }
}
