#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import releases from '../../lib/agent-skills/releases.cjs';
import { assembleRelease } from './assemble-release.mjs';
try {
  const { values } = parseArgs({ options: { help: { type: 'boolean' }, batch: { type: 'string' }, repository: { type: 'string', default: 'cookaihq/tt-workbench' }, skill: { type: 'string', multiple: true }, previous: { type: 'string' }, 'previous-assets': { type: 'string' }, output: { type: 'string' } } });
  if (values.help) console.log('build-release.mjs --batch <skills-YYYYMMDD.N|v工作台版本> --skill <名称> [--skill <名称> ...] [--previous <上一正式 skills-release.json>] [--previous-assets <继承附件目录>] [--repository owner/repo] [--output <新输出目录>]\n仅生成候选，不上传、不提交、不推送。v Tag 同时生成工作台三个附件。首批须选择全部活动 Skill。输出目录必须不存在。');
  else {
    if (Number(process.versions.node.split('.')[0]) < 22) throw Error('需要 Node.js 22 或更新版本。');
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const build = await releases.buildRelease({ root, batch: values.batch, repository: values.repository, names: values.skill, previousRaw: values.previous ? await fs.readFile(values.previous) : null });
    const result = await assembleRelease({ root, build, readArtifact: async item => {
      if (!values['previous-assets']) throw Error('联合发布需通过 --previous-assets 提供继承的固定 Skill 附件。');
      const file = path.join(values['previous-assets'], item.artifact.name), info = await fs.lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw Error('继承附件必须为普通文件。');
      return fs.readFile(file);
    } });
    const output = path.resolve(values.output || path.join(root, 'dist/skills', values.batch));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.mkdir(output); // Exclusive output; never overwrite an earlier candidate.
    for (const [name, bytes] of [...result.artifacts, ...result.coreArtifacts || []]) await fs.writeFile(path.join(output, name), bytes, { flag: 'wx' });
    await fs.writeFile(path.join(output, releases.CATALOG), result.raw, { flag: 'wx' });
    console.log(JSON.stringify({ batch: result.catalog.batch, changed: result.catalog.changed, versions: result.catalog.skills.map(({ name, version }) => ({ name, version })), output, published: false }, null, 2));
  }
} catch (error) { console.error(JSON.stringify({ ok: false, code: error.code || 'BUILD_FAILED', message: error.message })); process.exitCode = 1; }
