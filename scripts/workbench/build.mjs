import { mkdir, writeFile, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packages from '../../lib/workbench/package.cjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await packages.collectPackage(root);
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
await writeFile(path.join(output, 'tannt-workbench.bundle.json.gz'), packages.encodeBundle(bundle));
console.log(JSON.stringify({ version: bundle.release.version, files: bundle.files.size, output }));
