import fs from 'node:fs/promises';
import path from 'node:path';
import releases from '../../lib/agent-skills/releases.cjs';
import packages from '../../lib/agent-skills/package.cjs';
import core from '../../lib/workbench/package.cjs';
import { encodePluginZip } from '../workbench/zip.mjs';
import publishing from '../../lib/agent-skills/publish.cjs';

// Both local preparation and Actions assemble the same reviewed catalog. Only
// changed Skill assets are uploaded; inherited packages remain at their origin.
export async function assembleRelease({ root, build, readArtifact }) {
  if (!releases.isWorkbenchTag(build.catalog.batch)) return build;
  const version = build.catalog.batch.slice(1);
  const source = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  if (source.version !== version) packages.fail('VERSION_MISMATCH', '联合发布 Tag 必须与工作台源码版本一致。');
  const released = await core.skillsFromCatalog(build.raw, item => build.artifacts.get(item.artifact.name) || readArtifact(item));
  const bundle = await core.collectPackage(root, released);
  if (bundle.release.version !== version) packages.fail('VERSION_MISMATCH', '工作台 manifest 与联合发布 Tag 不一致。');
  const result = { ...build, coreArtifacts: new Map([
    ['release.json', Buffer.from(JSON.stringify(bundle.release, null, 2) + '\n')],
    ['tt-workbench.bundle.json.gz', core.encodeBundle(bundle)],
    ['tt-workbench.zip', encodePluginZip(bundle)]
  ]) };
  await publishing.validateWorkbenchAssets(result, build.catalog);
  return result;
}
