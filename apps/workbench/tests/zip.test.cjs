'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const packages = require('../../../lib/workbench/package.cjs');

test('系统解压完整 ZIP，保留中文、隐藏、空与二进制资源，并能继续升级', async t => {
  const { encodePluginZip } = await import('../../../scripts/workbench/zip.mjs');
  const base = path.resolve(__dirname, '../../../tmp/zip-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'zip-'));
  assert.equal(path.dirname(root), base);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = path.join(root, '知识库 with spaces'), configDir = 'custom-settings';
  const destination = path.join(vault, configDir, 'plugins');
  await fs.mkdir(destination, { recursive: true });
  const files = new Map([
    ['manifest.json', Buffer.from(JSON.stringify({ id: packages.ID, version: '1.0.0' }))],
    ['main.js', Buffer.from('module.exports = {};')],
    ['styles.css', Buffer.alloc(0)],
    ['templates/收件箱.md', Buffer.from('中文模板\n')],
    ['resources/.hidden', Buffer.from('hidden resource')],
    ['resources/binary.bin', Buffer.from(Array.from({ length: 256 }, (_, index) => index))]
  ]);
  const release = { schema: 1, id: packages.ID, version: '1.0.0', files: Object.fromEntries([...files].map(([name, bytes]) => [name, packages.hash(bytes)])) };
  const bundle = { release, files }, zipPath = path.join(root, 'plugin.zip');
  await fs.writeFile(zipPath, encodePluginZip(bundle));
  // Use an independent OS extractor, never a decoder that mirrors our ZIP writer.
  const extraction = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:TT_ZIP_TEST_ARCHIVE -DestinationPath $env:TT_ZIP_TEST_DESTINATION"], { encoding: 'utf8', windowsHide: true, env: { ...process.env, TT_ZIP_TEST_ARCHIVE: zipPath, TT_ZIP_TEST_DESTINATION: destination } })
    : spawnSync('unzip', ['-q', zipPath, '-d', destination], { encoding: 'utf8' });
  if (extraction.error?.code === 'ENOENT') return t.skip('System ZIP extraction needs Windows PowerShell or unzip.');
  assert.equal(extraction.status, 0, extraction.stderr || String(extraction.error));
  assert.deepEqual(await fs.readdir(vault), [configDir]);
  assert.deepEqual(await fs.readdir(destination), [packages.ID]);
  const target = path.join(destination, packages.ID), extracted = await packages.readTree(target);
  assert.deepEqual(JSON.parse(extracted.get('release.json')), release);
  extracted.delete('release.json');
  assert.equal(packages.fingerprint(extracted), packages.fingerprint(files));
  packages.validateFiles(release, extracted);
  const check = await packages.installPackage(bundle, { vault, configDir, check: true });
  assert.equal(check.ok, true); assert.equal(check.changed, false);

  await fs.writeFile(path.join(target, 'data.json'), '{"mine":true}');
  const nextFiles = new Map(files);
  nextFiles.set('manifest.json', Buffer.from(JSON.stringify({ id: packages.ID, version: '1.0.1' })));
  const next = { files: nextFiles, release: { ...release, version: '1.0.1', files: Object.fromEntries([...nextFiles].map(([name, bytes]) => [name, packages.hash(bytes)])) } };
  const result = await packages.installPackage(next, { vault, configDir });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(await fs.readFile(path.join(target, 'manifest.json'))).version, '1.0.1');
  assert.equal(await fs.readFile(path.join(target, 'data.json'), 'utf8'), '{"mine":true}');
  assert.equal(JSON.parse(await fs.readFile(path.join(result.recovery, 'manifest.json'))).version, '1.0.0');
});
