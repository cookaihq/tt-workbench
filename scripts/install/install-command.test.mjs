import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import packages from '../../lib/workbench/package.cjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const supported = ['darwin', 'win32'].includes(process.platform);
const windows = process.platform === 'win32';
const skip = supported ? false : 'Native installer tests require macOS or Windows';
function run(vault, source, config = '.obsidian') {
  const args = windows
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/install/install-windows.ps1'), '-Vault', vault, '-ConfigDir', config, '-PackageDirectory', source]
    : [path.join(root, 'scripts/install/install-macos.sh'), '--vault', vault, '--config-dir', config, '--package-dir', source];
  const result = spawnSync(windows ? 'powershell.exe' : '/bin/bash', args, { encoding: 'utf8', timeout: 60000 });
  assert.ifError(result.error);
  return { ...result, output: result.stdout + result.stderr };
}
async function runPrompt(input, source) {
  const script = path.join(root, 'scripts/install', windows ? 'install-windows.ps1' : 'install-macos.sh');
  // Exercise the README's script-text invocation; script supplies a real macOS TTY.
  const args = windows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::InputEncoding = [Text.Encoding]::UTF8; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $source = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($env:TT_INSTALLER_SCRIPT)); & ([scriptblock]::Create($source.TrimStart([char]0xFEFF))) -PackageDirectory $env:TT_INSTALLER_PACKAGE']
    : ['-c', '/bin/cat | /usr/bin/script -q /dev/null "$@"', 'tt-prompt-test',
      '/bin/bash', '-c', '"$@"; tt_status=$?; printf "\\nTT_INSTALLER_TEST_STATUS=%s\\n" "$tt_status"; exit "$tt_status"', 'tt-installer-result',
      '/bin/bash', '-c', await fs.readFile(script, 'utf8'), '--', '--package-dir', source];
  return new Promise((resolve, reject) => {
    const child = spawn(windows ? 'powershell.exe' : '/bin/bash', args, {
      env: { ...process.env, TT_INSTALLER_SCRIPT: script, TT_INSTALLER_PACKAGE: source },
      detached: !windows,
    });
    let output = '', sent = false;
    const timeout = setTimeout(() => {
      if (windows) child.kill(); else process.kill(-child.pid, 'SIGTERM');
      reject(new Error('Interactive installer timed out: ' + output));
    }, 30000);
    const receive = chunk => {
      output += chunk;
      if (!sent && output.includes('然后按回车')) {
        sent = true;
        if (windows) child.stdin.end(input + '\n'); else child.stdin.write(input + '\n');
      }
      // BSD script injects EOT on pipe EOF: keep input open until the installer exits.
      if (!windows && output.includes('TT_INSTALLER_TEST_STATUS=')) child.stdin.end();
    };
    child.stdout.setEncoding('utf8').on('data', receive);
    child.stderr.setEncoding('utf8').on('data', receive);
    child.stdin.on('error', () => {}); // Child may close stdin when rejecting input.
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', status => { clearTimeout(timeout); resolve({ status, output, prompted: sent }); });
  });
}
async function fixture(t, config = '.obsidian') {
  const base = path.join(root, 'tmp/command-install/tests');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, '安装 [test] '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const vault = path.join(directory, '知识库'), source = path.join(directory, 'downloads');
  await fs.mkdir(path.join(vault, config), { recursive: true });
  await fs.mkdir(source);
  const files = new Map([
    ['manifest.json', Buffer.from(JSON.stringify({ id: 'tt-workbench', version: '1.2.3', minAppVersion: '1.8.7', isDesktopOnly: true }))],
    ['main.js', Buffer.from('module.exports = {};')],
    ['styles.css', Buffer.from('/* fixture */')],
    ['templates/中文 资料.bin', Buffer.from([0, 255, 128, 10])],
  ]);
  const release = { schema: 1, id: 'tt-workbench', version: '1.2.3', files: Object.fromEntries([...files].map(([name, bytes]) => [name, packages.hash(bytes)])) };
  const object = { release, files: Object.fromEntries([...files].map(([name, bytes]) => [name, bytes.toString('base64')])) };
  async function save(independent = release) {
    await fs.writeFile(path.join(source, 'release.json'), JSON.stringify(independent, null, 2) + '\n');
    await fs.writeFile(path.join(source, 'tt-workbench.bundle.json.gz'), gzipSync(JSON.stringify(object)));
  }
  await save();
  return { directory, vault, source, files, release, object, save, plugins: path.join(vault, config, 'plugins') };
}

test('native command installer: complete offline install, custom config, exact bytes and no business changes', { skip }, async t => {
  const f = await fixture(t, 'custom settings');
  const note = path.join(f.vault, 'note.md');
  const enabled = path.join(f.vault, 'custom settings/community-plugins.json');
  await fs.writeFile(note, 'keep note');
  await fs.writeFile(enabled, '["another-plugin"]');
  const result = run(f.vault, f.source, 'custom settings');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Installed tt-workbench 1\.2\.3/);
  const target = path.join(f.plugins, 'tt-workbench');
  const installed = await packages.readTree(target);
  const releaseBytes = installed.get('release.json');
  installed.delete('release.json');
  packages.validateFiles(packages.parseRelease(releaseBytes), installed);
  assert.deepEqual(installed, f.files);
  assert.deepEqual(releaseBytes, await fs.readFile(path.join(f.source, 'release.json')));
  assert.equal(await fs.readFile(note, 'utf8'), 'keep note');
  assert.equal(await fs.readFile(enabled, 'utf8'), '["another-plugin"]');
  assert.deepEqual((await fs.readdir(f.vault)).sort(), ['custom settings', 'note.md']);
  assert.deepEqual((await fs.readdir(f.plugins)).sort(), ['tt-workbench', 'tt-workbench-recovery']);
  assert.deepEqual(await fs.readdir(path.join(f.plugins, 'tt-workbench-recovery')), []);
  assert.notEqual(run(f.vault, f.source, 'custom settings').status, 0);
  assert.deepEqual(await packages.readTree(target), new Map([...f.files, ['release.json', releaseBytes]]));
});

test('native command installer: drag or paste a folder after the prompt, without a vault argument', { skip }, async t => {
  const quoteDouble = value => '"' + value.replace(windows ? /([`"$])/g : /([\\"$`])/g, windows ? '`$1' : '\\$1') + '"';
  const quoteSingle = value => "'" + value.replace(/'/g, windows ? "''" : "'\\''") + "'";
  const formats = {
    'pasted raw path': value => value,
    'double quoted path': quoteDouble,
    'single quoted path': quoteSingle,
    'terminal drag format with trailing space': value => windows ? '& ' + quoteSingle(value) + ' ' : value.replace(/([^A-Za-z0-9_./-])/gu, '\\$1') + ' ',
  };
  if (windows) formats['Windows quoted literal path'] = value => '"' + value + '"';
  for (const [label, format] of Object.entries(formats)) {
    await t.test(label, async t => {
      const f = await fixture(t);
      const vault = path.join(f.directory, "知识库 O'Brien $x `$ [拖入]");
      await fs.rename(f.vault, vault);
      const result = await runPrompt(format(vault), f.source);
      assert.equal(result.prompted, true, result.output);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /Installed tt-workbench 1\.2\.3/);
      const installed = await packages.readTree(path.join(vault, '.obsidian/plugins/tt-workbench'));
      installed.delete('release.json');
      assert.deepEqual(installed, f.files);
    });
  }
});

test('native command installer: invalid prompted input does not execute commands or install', { skip }, async t => {
  const f = await fixture(t);
  const marker = path.join(f.directory, 'must-not-exist');
  const command = windows ? 'New-Item -ItemType File -Path ' + "'" + marker + "'" : 'touch ' + "'" + marker + "'";
  for (const input of ['', '"' + f.vault, '"$(' + command + ')"', '"' + f.vault + '" "' + f.source + '"']) {
    const result = await runPrompt(input, f.source);
    assert.equal(result.prompted, true, result.output);
    assert.notEqual(result.status, 0, result.output);
    assert.equal(await fs.stat(f.plugins).catch(() => null), null);
    assert.equal(await fs.stat(marker).catch(() => null), null);
  }
});

test('native command installer: existing plugins and installation locks remain untouched', { skip }, async t => {
  for (const name of ['tt-workbench', 'tannt-workbench', 'tt-workbench.install-lock']) {
    await t.test(name, async t => {
      const f = await fixture(t);
      await fs.mkdir(f.plugins, { recursive: true });
      const existing = path.join(f.plugins, name);
      if (name.endsWith('install-lock')) await fs.writeFile(existing, 'busy');
      else { await fs.mkdir(existing); await fs.writeFile(path.join(existing, 'data.json'), 'user settings'); }
      const before = await packages.readTree(f.plugins);
      assert.notEqual(run(f.vault, f.source).status, 0);
      assert.deepEqual(await packages.readTree(f.plugins), before);
    });
  }
});

test('native command installer: malformed packages never become installed plugins', { skip }, async t => {
  const cases = {
    'hash mismatch': f => { f.object.files['main.js'] = Buffer.from('tampered').toString('base64'); },
    'traversal': f => { f.release.files['../escape'] = packages.hash('x'); f.object.files['../escape'] = 'eA=='; },
    'case collision': f => { f.release.files['Templates/other.txt'] = packages.hash('x'); f.object.files['Templates/other.txt'] = 'eA=='; },
    'file as directory': f => { f.release.files['main.js/child'] = packages.hash('x'); f.object.files['main.js/child'] = 'eA=='; },
    'reserved Windows path': f => { f.release.files['AUX.txt'] = packages.hash('x'); f.object.files['AUX.txt'] = 'eA=='; },
    'local settings': f => { f.release.files['data.json'] = packages.hash('x'); f.object.files['data.json'] = 'eA=='; },
    'unlisted file': f => { f.object.files['extra.txt'] = 'eA=='; },
    'missing file': f => { delete f.object.files['styles.css']; },
    'bad base64': f => { f.object.files['main.js'] = '*invalid*'; },
    'manifest mismatch': f => {
      const bytes = Buffer.from('{"id":"another-plugin","version":"1.2.3","minAppVersion":"1.8.7"}');
      f.release.files['manifest.json'] = packages.hash(bytes); f.object.files['manifest.json'] = bytes.toString('base64');
    },
  };
  for (const [label, mutate] of Object.entries(cases)) {
    await t.test(label, async t => {
      const f = await fixture(t);
      mutate(f); await f.save();
      const result = run(f.vault, f.source);
      assert.notEqual(result.status, 0, result.output);
      assert.equal(await fs.stat(path.join(f.plugins, 'tt-workbench')).catch(() => null), null);
      assert.equal(await fs.stat(path.join(f.plugins, 'tt-workbench.install-lock')).catch(() => null), null);
      assert.deepEqual(await fs.readdir(path.join(f.plugins, 'tt-workbench-recovery')), []);
      assert.equal(await fs.stat(path.join(f.plugins, 'escape')).catch(() => null), null);
    });
  }
});

test('native command installer: mismatched releases and corrupt gzip are rejected', { skip }, async t => {
  const f = await fixture(t);
  await f.save({ ...f.release, version: '1.2.4' });
  assert.match(run(f.vault, f.source).output, /manifests differ/);
  await f.save();
  await fs.writeFile(path.join(f.source, 'tt-workbench.bundle.json.gz'), 'not gzip');
  assert.notEqual(run(f.vault, f.source).status, 0);
  assert.equal(await fs.stat(path.join(f.plugins, 'tt-workbench')).catch(() => null), null);
});

test('native command installer: explicit existing vault and config required, linked directories refused', { skip }, async t => {
  const f = await fixture(t);
  assert.notEqual(run('relative-vault', f.source).status, 0);
  assert.notEqual(run(path.join(f.directory, 'missing'), f.source).status, 0);
  assert.notEqual(run(f.vault, f.source, '../downloads').status, 0);
  assert.notEqual(run(f.vault, f.source, 'missing-config').status, 0);
  const linked = path.join(f.vault, 'linked-config');
  await fs.symlink(path.join(f.vault, '.obsidian'), linked, windows ? 'junction' : 'dir');
  assert.notEqual(run(f.vault, f.source, 'linked-config').status, 0);
  await fs.symlink(f.source, f.plugins, windows ? 'junction' : 'dir');
  assert.notEqual(run(f.vault, f.source).status, 0);
  assert.deepEqual((await fs.readdir(f.source)).sort(), ['release.json', 'tt-workbench.bundle.json.gz']);
});
