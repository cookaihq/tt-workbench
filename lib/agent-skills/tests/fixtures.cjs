'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const packages = require('../package.cjs');
const core = require('../../workbench/package.cjs');
const base = path.resolve(__dirname, '../../../tmp/skill-versioned-tests');
async function fixture(t) {
  await fs.mkdir(base, { recursive: true });
  const vault = await fs.mkdtemp(path.join(base, '库 '));
  t.after(async () => { if (path.dirname(vault) !== base) throw Error('unsafe cleanup'); await fs.rm(vault, { recursive: true, force: true }); });
  return { vault, configDir: 'custom', packageRoot: path.join(vault, 'custom/plugins/tt-workbench') };
}
function skill(name = 'one', version = '1.0.0', content = 'behavior', requirements = {}) {
  const c = { workbench: '0.26.0', node: '22.0.0', platforms: ['win32', 'darwin', 'linux'], hosts: ['codex', 'claude'], ...requirements };
  const text = `---\nname: ${name}\ndescription: Sample ${name}\nmetadata:\n  version: "${version}"\n  workbench-min: "${c.workbench}"\n  node-min: "${c.node}"\n  platforms: "${c.platforms.join(',')}"\n  hosts: "${c.hosts.join(',')}"\n  release-notes: "Changes ${version}"\n---\n${content}\n`;
  const files = new Map([['SKILL.md', Buffer.from(text)], ['runtime/scripts/probe.cjs', Buffer.from('console.log(process.versions.node);')]]);
  const hashes = Object.fromEntries([...files].map(([name, bytes]) => [name, packages.hash(bytes)]));
  return { files, manifest: { schema: 1, kind: 'tt-skill-package', name, version, notes: `Changes ${version}`, compatibility: c, contentHash: packages.contentHash(hashes), files: hashes } };
}
function workbench(version = '0.26.0', skills = [skill()]) {
  const files = new Map(Object.entries({ 'main.js': 'core ' + version, 'styles.css': 'body{}', 'manifest.json': JSON.stringify({ id: 'tt-workbench', version, minAppVersion: '1.8.7' }), 'skills/manifest.jsonc': JSON.stringify({ skills: skills.map(s => s.manifest.name) }) }).map(([name, value]) => [name, Buffer.from(value)]));
  const skillPackages = {};
  for (const s of skills) {
    const prefix = `skills/${s.manifest.name}/`;
    for (const [name, bytes] of s.files) files.set(prefix + name, bytes);
    files.set(prefix + packages.MANIFEST, Buffer.from(JSON.stringify(s.manifest, null, 2) + '\n'));
    skillPackages[s.manifest.name] = { version: s.manifest.version, contentHash: s.manifest.contentHash };
  }
  return { files, release: { schema: 1, id: 'tt-workbench', version, skillPackages, skillSource: { kind: 'development' }, files: Object.fromEntries([...files].map(([name, bytes]) => [name, core.hash(bytes)])) } };
}
function remote() {
  const releases = [], assets = new Map(), calls = []; let id = 10;
  function add(build, extra = {}) {
    const items = new Map([...build.artifacts, ...build.coreArtifacts || []]); items.set('skills-release.json', build.raw);
    const release = { tag_name: build.catalog.batch, draft: false, prerelease: false, assets: [], ...extra };
    for (const [name, bytes] of items) { const key = ++id; assets.set(key, bytes); release.assets.push({ id: key, name, size: bytes.length }); }
    releases.unshift(release); return release;
  }
  const request = async url => {
    calls.push(url);
    if (url.includes('/releases?')) return Buffer.from(JSON.stringify(releases));
    const bytes = assets.get(Number(url.split('/').at(-1)));
    if (!bytes) throw Error('missing asset'); return bytes;
  };
  return { releases, assets, calls, add, request };
}
module.exports = { fixture, skill, workbench, remote };
