#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import deviceConfig from '../../lib/fns/device-config.cjs';
export const { profileDirectory, deviceIdFromMachineId, currentDeviceId, inspectDeviceConfig, migrateDeviceConfig } = deviceConfig;

async function main() {
  if (process.argv.includes('--help')) { console.log('device-config.mjs --check|--apply --vault <知识库绝对路径> [--config-dir <目录>]'); return; }
  const args = process.argv.slice(2), mode = args.shift() || '--check', options = {};
  if (!['--check', '--apply'].includes(mode)) throw new Error('用法：device-config.mjs --check|--apply [--vault <库>] [--config-dir <目录>]');
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    if (!['--vault', '--config-dir'].includes(flag) || !value || value.startsWith('--')) throw new Error('无效参数。');
    options[flag === '--vault' ? 'vault' : 'configDir'] = value;
  }
  const report = await (mode === '--check' ? inspectDeviceConfig(options) : migrateDeviceConfig(options));
  console.log(JSON.stringify(report, null, 2));
  if (!['ready', 'needs-migration'].includes(report.status)) process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
