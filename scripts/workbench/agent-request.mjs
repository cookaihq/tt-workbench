#!/usr/bin/env node
// Historical entry point. Actual file operations are independent of Obsidian.
import { request } from '../vault/write.mjs';
import targets from '../../lib/config/target.cjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export { request };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('已迁至 node scripts/vault/write.mjs --vault <知识库绝对路径>；直接读写本库文件，不需要 Obsidian。');
  else {
    try {
      process.stdin.setEncoding('utf8'); let raw = ''; for await (const chunk of process.stdin) raw += chunk;
      const result = await request(JSON.parse(raw), targets.vaultArgument()); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;
    } catch (error) { console.error(JSON.stringify({ok:false,code:'INVALID_JSON',message:error.message})); process.exitCode = 1; }
  }
}
