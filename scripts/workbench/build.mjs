import { mkdir, writeFile, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import packages from '../../lib/workbench/package.cjs';
import { encodePluginZip } from './zip.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { help: { type: 'boolean' }, 'skills-catalog': { type: 'string' }, 'skills-assets': { type: 'string' } } });
if (values.help) { console.log('build.mjs [--skills-catalog <固定 skills-release.json> --skills-assets <完整清单所需附件目录>]\n默认生成开发候选；仅工作台发布使用此前正式 Skill 清单。联合发布使用 scripts/agent-skills/build-release.mjs --batch v<工作台版本> 一次准备全部附件。'); process.exit(0); }
if (Boolean(values['skills-catalog']) !== Boolean(values['skills-assets'])) throw Error('--skills-catalog 与 --skills-assets 必须同时指定。');
const released = values['skills-catalog'] ? await packages.releasedSkills(values['skills-catalog'], values['skills-assets']) : {};
const bundle = await packages.collectPackage(root, released);
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
const generated = path.resolve(output, 'plugin');
if (path.dirname(generated) !== path.resolve(root, 'dist') || (await lstat(output)).isSymbolicLink()) throw Error('构建输出目录无效。');
try { if ((await lstat(generated)).isSymbolicLink()) throw Error('构建输出不能是链接。'); await rm(generated, { recursive: true }); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const [name, bytes] of bundle.files) {
  const file = path.join(output, 'plugin', name);
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
}
await writeFile(path.join(output, 'plugin/release.json'), JSON.stringify(bundle.release, null, 2) + '\n');
await writeFile(path.join(output, 'release.json'), JSON.stringify(bundle.release, null, 2) + '\n');
await writeFile(path.join(output, 'tt-workbench.bundle.json.gz'), packages.encodeBundle(bundle));
await writeFile(path.join(output, 'tt-workbench.zip'), encodePluginZip(bundle));
const legacyBundle = path.join(output, 'tannt-workbench.bundle.json.gz');
try {
  const info = await lstat(legacyBundle);
  if (!info.isFile() || info.isSymbolicLink()) throw Error('旧构建包路径不是普通文件。');
  await rm(legacyBundle);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log(JSON.stringify({ version: bundle.release.version, files: bundle.files.size, output }));
