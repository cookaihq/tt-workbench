import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const directories = ['apps/workbench/tests', 'lib/vault/tests', 'lib/fns/tests', 'lib/config/tests', 'scripts/cloud-files', 'scripts/fns', 'scripts'];
const tests = [];
for (const directory of directories) for (const file of await readdir(directory)) if (/\.test\.(cjs|mjs)$/.test(file)) tests.push(`${directory}/${file}`);
const result = spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...tests], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
