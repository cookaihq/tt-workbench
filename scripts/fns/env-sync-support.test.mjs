import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { bundleState, repairBundle, originalBranch, repairedBranch, envOnlySettings, retiredSettings, originalBundle } from './env-sync-support.mjs';
import { spawnSync } from 'node:child_process';
import { auditVault } from '../fns-hidden-audit.mjs';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';

// Exercise the scanner from the installed, hash-verified upstream build in isolation.
// No plugin initialization, credentials, filesystem writes or network calls occur.
const installed = process.env.TEST_FNS_BUNDLE ? await readFile(process.env.TEST_FNS_BUNDLE, 'utf8') : null;
if (installed) assert.notEqual(bundleState(installed), 'unsupported', 'The supplied FNS build needs review before these integration checks.');
const upstream = installed?.replace(repairedBranch, originalBranch);
const repaired = upstream && repairBundle(upstream);
const integrationTest = (name, fn) => test(name, { skip: installed ? false : 'Optional integration: set TEST_FNS_BUNDLE to a supported FNS main.js' }, fn);

async function scan(source, roots, excluded = []) {
  const start = source.indexOf('ul=async function(') + 3;
  const end = source.indexOf(',gT=async function', start);
  const files = new Set(['.env', '资料/first.mp4.yaml', '资料/.keep']);
  const folders = new Map([
    ['.obsidian', { files: ['.obsidian/app.json'], folders: [] }],
    ['资料', { files: ['资料/first.mp4.yaml', '资料/.keep'], folders: [] }],
  ]);
  const listed = [], errors = [];
  const adapter = {
    exists: async p => files.has(p) || folders.has(p),
    stat: async p => files.has(p) ? { type: 'file' } : folders.has(p) ? { type: 'folder' } : null,
    list: async p => { listed.push(p); if (!folders.has(p)) throw new Error('not a directory'); return folders.get(p); },
  };
  const scanner = vm.runInNewContext('(' + source.slice(start, end) + ')', {
    Ie: p => excluded.some(prefix => p === prefix || p.startsWith(prefix + '/')),
    ve: { normalizePath: p => p.replaceAll('\\', '/') },
    T: (...args) => errors.push(args[0]), $r: () => false, Rh: ['workspace.json'],
    Bh: ['.json', '.js', '.css'], zh: ['.json', '.css'],
  });
  const found = await scanner(roots, { app: { vault: { adapter, configDir: '.obsidian' } } });
  return { found: Array.from(found), listed, errors };
}

integrationTest('upstream reproduces the missing .env bug; repaired scan includes only the requested file', async () => {
  assert.deepEqual((await scan(upstream, ['.env'])).found, []);
  const result = await scan(repaired, ['.env']);
  assert.deepEqual(result.found, ['.env']);
  assert.deepEqual(result.listed, []);
  assert.deepEqual(result.errors, []);
});

integrationTest('existing directories keep their original traversal and exclusions', async () => {
  const before = await scan(upstream, ['资料'], ['资料/.keep']);
  const after = await scan(repaired, ['资料'], ['资料/.keep']);
  assert.deepEqual(after, before);
  assert.deepEqual(after.found, ['资料/first.mp4.yaml']);
});

integrationTest('an excluded or absent single file is not added', async () => {
  assert.deepEqual((await scan(repaired, ['.env'], ['.env'])).found, []);
  assert.deepEqual((await scan(repaired, ['missing.env'])).found, []);
});

integrationTest('the existing core config branch stays excluded in the .env-only setup', async () => {
  const result = await scan(repaired, ['.obsidian', '.env'], ['.obsidian']);
  assert.deepEqual(result.found, ['.env']);
});

integrationTest('repair is idempotent, reversible and rejects unknown builds', () => {
  assert.equal(bundleState(repaired), 'repaired');
  assert.equal(repairBundle(repaired), repaired);
  assert.equal(repaired.replace(repairedBranch, originalBranch), upstream);
  assert.throws(() => repairBundle(upstream + 'changed'));
});

test('settings enable only .env and preserve unrelated sync behavior', () => {
  const before = { configSyncEnabled: false, configSyncOtherDirs: '', syncExcludeWhitelist: '',
    syncExcludeFolders: '[{"pattern":".system/.workbench-runtime","caseSensitive":false},{"pattern":".system/workbench","caseSensitive":false}]',
    pdfSyncEnabled: true, syncEnabled: true, offlineDeleteSyncEnabled: false,
    syncExcludeExtensions: '[{"pattern":".mp4"}]' };
  const after = envOnlySettings(before);
  assert.equal(after.configSyncEnabled, true);
  assert.equal(after.pdfSyncEnabled, false);
  assert.deepEqual(JSON.parse(after.configSyncOtherDirs).map(x => x.pattern), ['.env']);
  assert.deepEqual(JSON.parse(after.syncExcludeFolders).map(x => x.pattern), ['.system/.workbench-runtime', '.system/workbench', '.obsidian', '_localStorage']);
  for (const key of ['syncEnabled', 'offlineDeleteSyncEnabled', 'syncExcludeExtensions']) assert.equal(after[key], before[key]);
  assert.deepEqual(envOnlySettings(after), after);
});

test('unexpected extra roots or whitelist rules require scope review', () => {
  assert.throws(() => envOnlySettings({ configSyncOtherDirs: '[{"pattern":".private"}]' }));
  assert.throws(() => envOnlySettings({ syncExcludeWhitelist: '[{"pattern":".*"}]' }));
  assert.throws(() => envOnlySettings({ configSyncEnabled: true }));
});

test('retirement removes only the old env target and preserves other scopes and settings', () => {
  const remaining = [{ pattern: '.scratch', caseSensitive: true }, { pattern: '.env.local', caseSensitive: false }];
  const before = { configSyncOtherDirs: JSON.stringify([{ pattern: '.env', caseSensitive: true }, ...remaining]),
    configSyncEnabled: true, syncExcludeWhitelist: 'existing', syncExcludeFolders: 'existing',
    syncExcludeExtensions: 'existing', apiToken: 'test-only-secret', pdfSyncEnabled: false, offlineDeleteSyncEnabled: false };
  const after = retiredSettings(before);
  assert.deepEqual(JSON.parse(after.configSyncOtherDirs), remaining);
  assert.deepEqual({ ...after, configSyncOtherDirs: before.configSyncOtherDirs }, before);
  assert.deepEqual(retiredSettings(after), after);
  assert.equal(JSON.parse(before.configSyncOtherDirs)[0].pattern, '.env');
});

integrationTest('retirement restores the exact upstream bundle and refuses an unknown build', () => {
  assert.equal(originalBundle(repaired), upstream);
  assert.equal(originalBundle(upstream), upstream);
  assert.equal(bundleState(originalBundle(repaired)), 'upstream');
  assert.throws(() => originalBundle(repaired + 'unexpected change'));
});

test('the old install command fails before it can modify a device', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./env-sync-support.mjs', import.meta.url)), '--apply'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /已退役/);
  assert.match(result.stderr, /config\/cloud-storage-targets\.jsonc/);
});

integrationTest('hidden-item audit recognizes exact-file coverage only with the verified repair', async t => {
  const tempRoot = new URL('../../tmp/fns-validation/', import.meta.url);
  await mkdir(tempRoot, { recursive: true });
  const vault = await mkdtemp(fileURLToPath(new URL('audit-', tempRoot)));
  t.after(() => rm(vault, { recursive: true, force: true }));
  const plugin = vault + '/.obsidian/plugins/fast-note-sync';
  await mkdir(plugin, { recursive: true });
  await writeFile(plugin + '/manifest.json', JSON.stringify({ version: '2.4.0' }));
  await writeFile(plugin + '/data.json', JSON.stringify(envOnlySettings({ configSyncEnabled: false })));
  await writeFile(vault + '/.obsidian/community-plugins.json', '["fast-note-sync"]');
  await writeFile(vault + '/.env', 'TANNT_CLOUD_DEFAULT_ACCOUNT=');
  await writeFile(plugin + '/main.js', upstream);
  assert.equal((await auditVault({ vault })).items.find(x => x.path === '.env').status, 'missing');
  await writeFile(plugin + '/main.js', repaired);
  const report = await auditVault({ vault });
  assert.equal(report.singleFileSupport, true);
  assert.equal(report.items.find(x => x.path === '.env').status, 'covered');
});
