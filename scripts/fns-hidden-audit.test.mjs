import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { auditVault, takeSnapshot, renderReport } from './fns-hidden-audit.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('./fns-hidden-audit.mjs', import.meta.url));

async function cleanTemp(directory, prefix) {
  const target = path.resolve(directory);
  const parent = await realpath(os.tmpdir());
  assert.equal(await realpath(path.dirname(target)), parent);
  assert(path.basename(target).startsWith(prefix));
  assert.equal(await realpath(target), path.join(parent, path.basename(target)));
  await rm(target, { recursive: true, force: true });
}

async function fixture(t, overrides = {}, configDir = '.obsidian') {
  const vault = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tannt-fns-test-')));
  t.after(() => cleanTemp(vault, 'tannt-fns-test-'));
  const put = async (relative, content = '') => {
    await mkdir(path.dirname(path.join(vault, relative)), { recursive: true });
    await writeFile(path.join(vault, relative), content);
  };
  const settings = { syncEnabled: true, configSyncEnabled: true, configSyncOtherDirs: '',
    syncExcludeFolders: '', syncExcludeWhitelist: '', syncExcludeExtensions: '',
    apiToken: 'TEST_SECRET_MUST_NOT_APPEAR', ...overrides };
  const plugin = `${configDir}/plugins/fast-note-sync`;
  await put(`${plugin}/manifest.json`, JSON.stringify({ version: '2.4.0' }));
  await put(`${plugin}/data.json`, JSON.stringify(settings));
  await put(`${configDir}/community-plugins.json`, '["fast-note-sync"]');
  const update = async values => {
    Object.assign(settings, values);
    await put(`${plugin}/data.json`, JSON.stringify(settings));
  };
  return { vault, put, update, configDir, plugin,
    scan: baseline => auditVault({ vault, configDir, baseline }),
    snapshot: () => takeSnapshot({ vault, configDir }) };
}

test('groups hidden trees once, counts all contained files, and finds nested standalone files', async t => {
  const f = await fixture(t);
  await f.put('.scratch/a.md', 'private note');
  await f.put('.scratch/.nested/b.md');
  await f.put('notes/.local');
  await f.put('visible.md');
  const report = await f.scan();
  assert.deepEqual(report.items.map(item => item.path), ['.scratch', 'notes/.local']);
  assert.equal(report.items[0].fileCount, 2);
  assert.equal(report.summary.unconfiguredDirectories, 1);
  assert.equal(report.summary.unconfiguredStandaloneFiles, 1);
  assert.equal(report.summary.knownUncoveredFiles, 3);
  assert.equal(report.summary.needsDecision, 0);
  assert.equal(report.baselineUsed, false);
  assert.equal(report.complete, true);
  assert(!JSON.stringify(report).includes('TEST_SECRET'));
  assert(!JSON.stringify(report).includes('private note'));
});

test('baseline finds new hidden roots, nested items and renames without prompting for old items', async t => {
  const f = await fixture(t);
  await f.put('.existing/a.md');
  await f.put('rename-me');
  const baseline = await f.snapshot();
  await f.put('.existing/.new.md');
  await f.put('.new-dir/file.md');
  await f.put('.existing/ordinary.md');
  await rename(path.join(f.vault, 'rename-me'), path.join(f.vault, '.renamed'));
  const report = await f.scan(baseline);
  assert.deepEqual(report.prompts.map(item => item.path), ['.existing/.new.md', '.new-dir', '.renamed']);
  assert.equal(report.summary.newHiddenItems, 3);
  assert.equal(report.summary.knownUncoveredFiles, 5);
});

test('a configured parent covers nested hidden files and does not repeat a sync question', async t => {
  const f = await fixture(t, { configSyncOtherDirs: '[{"pattern":".shared/","caseSensitive":false}]' });
  await f.put('.shared/a.md');
  const baseline = await f.snapshot();
  await f.put('.shared/.nested/.settings');
  const report = await f.scan(baseline);
  assert.equal(report.summary.newHiddenItems, 2);
  assert.equal(report.summary.needsDecision, 0);
  assert.equal(report.items[0].status, 'covered');
  assert.equal(report.items[0].files.covered, 2);
  await f.put('.shared-other/b.md');
  const next = await f.scan();
  assert.equal(next.items.find(item => item.path === '.shared-other').status, 'missing');
});

test('configuring a child does not imply coverage of its whole hidden parent', async t => {
  const f = await fixture(t, { configSyncOtherDirs: '.scratch/shared' });
  await f.put('.scratch/shared/yes.md');
  await f.put('.scratch/private/no.md');
  const report = await f.scan();
  assert.equal(report.items[0].status, 'partial');
  assert.equal(report.items[0].files.covered, 1);
  assert.equal(report.items[0].files.missing, 1);
  assert.equal(report.summary.unconfiguredDirectories, 1);
});

test('config exclusions, case sensitivity and whitelist follow FNS traversal pruning', async t => {
  const f = await fixture(t, {
    configSyncOtherDirs: '.shared',
    syncExcludeFolders: '.shared/blocked\n.shared/UPPER',
    syncExcludeWhitelist: '.shared/blocked/allow.md',
    syncExcludeExtensions: '.bin',
  });
  await f.put('.shared/blocked/allow.md');
  await f.put('.shared/upper.md');
  await f.put('.shared/attachment.bin');
  let report = await f.scan();
  assert.equal(report.items[0].files.excluded, 2);
  // Extension exclusions are not used by FNS's config-directory scanner.
  assert.equal(report.items[0].files.covered, 1);
  await f.update({ syncExcludeWhitelist: '.shared/blocked\n.shared/upper.md' });
  report = await f.scan();
  assert.equal(report.items[0].status, 'covered');
  await f.update({ syncExcludeFolders: '[{"pattern":".shared/UPPER","caseSensitive":true}]', syncExcludeWhitelist: '' });
  assert.equal((await f.scan()).items[0].status, 'covered');
});

test('new configured roots whose files are excluded still require a decision', async t => {
  const f = await fixture(t, { configSyncOtherDirs: '.new', syncExcludeFolders: '.new' });
  const baseline = await f.snapshot();
  await f.put('.new/no.md');
  const report = await f.scan(baseline);
  assert.equal(report.items[0].status, 'excluded');
  assert.equal(report.prompts[0].path, '.new');
  assert.equal(report.prompts[0].status, 'excluded');
});

test('a standalone hidden file cannot be registered as a directory', async t => {
  const f = await fixture(t, { configSyncOtherDirs: '.single' });
  const baseline = await f.snapshot();
  await f.put('.single');
  const report = await f.scan(baseline);
  assert.equal(report.items[0].status, 'missing');
  assert.equal(report.summary.unconfiguredStandaloneFiles, 1);
  assert.equal(report.prompts[0].kind, 'file');
  assert(report.warnings.some(warning => warning.includes('不是库内普通目录')));
  assert(renderReport(report).includes('不能直接填入'));
});

for (const [label, settings, disablePlugin] of [
  ['config sync off', { configSyncEnabled: false }, false],
  ['readonly mode', { readonlySyncEnabled: true }, false],
  ['plugin disabled', {}, true],
]) {
  test(`${label} is not reported as working coverage`, async t => {
    const f = await fixture(t, { configSyncOtherDirs: '.shared', ...settings });
    await f.put('.shared/a.md');
    if (disablePlugin) await f.put('.obsidian/community-plugins.json', '[]');
    const report = await f.scan();
    assert.equal(report.items[0].status, 'blocked');
    assert.equal(report.summary.unconfiguredDirectories, 0);
    assert.equal(report.summary.pendingDirectories, 1);
    assert.equal(report.blockers.length, 1);
  });
}

test('core config coverage is selective and custom config directories are supported', async t => {
  const f = await fixture(t, {}, '.obsidian-test');
  await f.put('.obsidian-test/.custom.json', '{}');
  await f.put('.obsidian-test/.custom.md');
  await f.put('.obsidian-test/.extra/a.md');
  const report = await f.scan();
  assert(!report.items.some(item => item.path === '.obsidian-test'));
  assert.equal(report.items.find(item => item.path.endsWith('.custom.json')).status, 'covered');
  assert.equal(report.items.find(item => item.path.endsWith('.custom.md')).status, 'missing');
  assert.equal(report.items.find(item => item.path.endsWith('.extra')).status, 'missing');
});

test('extra paths ending in the config directory name use the FNS core scan pattern', async t => {
  const f = await fixture(t, { configSyncOtherDirs: '.backup.obsidian' });
  await f.put('.backup.obsidian/.settings.json', '{}');
  await f.put('.backup.obsidian/nested/note.md');
  const report = await f.scan();
  assert.equal(report.items[0].files.covered, 1);
  assert.equal(report.items[0].files.missing, 1);
  assert.equal(report.items[0].status, 'partial');
});

test('bad or unsupported configuration reports unknown and never prints credentials', async t => {
  const f = await fixture(t);
  await f.put('.scratch/a.md');
  await f.put(`${f.plugin}/data.json`, '{"apiToken":"TEST_SECRET_MUST_NOT_APPEAR",broken}');
  let report = await f.scan();
  assert.equal(report.complete, false);
  assert.equal(report.items[0].status, 'unknown');
  assert.equal(report.summary.unknownFiles, 1);
  assert(!JSON.stringify(report).includes('TEST_SECRET'));
  await f.update({});
  await f.put(`${f.plugin}/manifest.json`, '{"version":"9.0.0"}');
  report = await f.scan();
  assert.equal(report.complete, false);
  assert(report.warnings.some(warning => warning.includes('先复核扫描规则')));
});

test('empty hidden directories and mismatched baselines have explicit results', async t => {
  const f = await fixture(t, { configSyncOtherDirs: '.empty' });
  await mkdir(path.join(f.vault, '.empty'));
  const baseline = await f.snapshot();
  const report = await f.scan(baseline);
  assert.equal(report.items[0].empty, true);
  assert.equal(report.items[0].status, 'covered');
  assert(renderReport(report).includes('空目录暂无文件可传输'));
  await assert.rejects(f.scan({ ...baseline, vault: '/wrong-vault' }), /基线.*不匹配/);
});

test('directory links are never traversed or considered fully checked', async t => {
  const f = await fixture(t);
  const outside = await fixture(t);
  await outside.put('not-in-vault.md');
  const baseline = await f.snapshot();
  try {
    await symlink(outside.vault, path.join(f.vault, '.linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symlink creation unavailable'); return; }
    throw error;
  }
  const report = await f.scan(baseline);
  assert.equal(report.complete, false);
  assert.equal(report.items[0].fileCount, 0);
  assert.equal(report.items[0].status, 'unknown');
  assert.equal(report.prompts[0].kind, 'link');
});

test('CLI snapshot and JSON check work end to end without modifying FNS settings', async t => {
  const f = await fixture(t);
  const settingsPath = path.join(f.vault, f.plugin, 'data.json');
  const before = await readFile(settingsPath, 'utf8');
  const snapshotRun = await exec(process.execPath, [cli, 'snapshot', '--vault', f.vault]);
  const baselinePath = snapshotRun.stdout.trim();
  t.after(() => cleanTemp(path.dirname(baselinePath), 'tannt-fns-audit-'));
  const saved = JSON.parse(await readFile(baselinePath, 'utf8'));
  assert(!JSON.stringify(saved).includes('TEST_SECRET'));
  await f.put('.fresh/task.md');
  const check = await exec(process.execPath, [cli, 'check', '--vault', f.vault, '--baseline', baselinePath, '--json']);
  const report = JSON.parse(check.stdout);
  assert.equal(report.summary.needsDecision, 1);
  assert.equal(report.prompts[0].path, '.fresh');
  assert.equal(await readFile(settingsPath, 'utf8'), before);
  await f.put(`${f.plugin}/data.json`, 'bad JSON');
  await assert.rejects(exec(process.execPath, [cli, 'check', '--vault', f.vault, '--json']),
    error => error.code === 2 && JSON.parse(error.stdout).complete === false);
});
