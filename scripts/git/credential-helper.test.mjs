import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = join(project, 'tmp/git-credential-repair');
const relativeSource = '.credentials/repositories/cookaihq--tt%2Dworkbench.github-token';
const request = 'protocol=https\nhost=github.com\npath=cookaihq/tt-workbench.git\n\n';
const token = 'github_pat_TEST_FIXTURE_ONLY';
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' };
for (const name of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CONFIG|TRACE|CURL_VERBOSE)/i.test(name)) delete env[name];

function run(program, args, options = {}) {
  return spawnSync(program, args, { env, encoding: 'utf8', windowsHide: true, timeout: 30000, ...options });
}
function git(cwd, ...args) {
  const result = run('git', ['-C', cwd, ...args]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
git(project, 'check-ignore', '-q', '--', 'tmp/git-credential-repair/');
mkdirSync(scratch, { recursive: true });
const sandbox = mkdtempSync(join(scratch, 'test-'));
after(() => {
  const actual = realpathSync(sandbox);
  assert.ok(actual.startsWith(realpathSync(scratch) + sep));
  rmSync(actual, { recursive: true, force: true });
});

const repo = join(sandbox, 'primary checkout');
mkdirSync(join(repo, 'scripts/git'), { recursive: true });
git(repo, 'init', '-b', 'main');
writeFileSync(join(repo, '.gitignore'), '/.credentials/\n');
writeFileSync(join(repo, 'empty-excludes'), '');
git(repo, 'config', 'core.excludesFile', join(repo, 'empty-excludes'));
const helper = join(repo, 'scripts/git/credential-helper.mjs');
copyFileSync(join(project, 'scripts/git/credential-helper.mjs'), helper);
mkdirSync(join(repo, '.credentials'), { mode: 0o700 });
mkdirSync(join(repo, '.credentials/repositories'), { mode: 0o700 });
const source = join(repo, relativeSource);
writeFileSync(source, token + '\n', { mode: 0o600 });

function protectSource() {
  if (process.platform !== 'win32') return;
  const code = String.raw`
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($relative in @('.credentials', '.credentials/repositories', '.credentials/repositories/cookaihq--tt%2Dworkbench.github-token')) {
  $path = [System.IO.Path]::Combine($env:TT_GIT_CREDENTIAL_TEST_ROOT, $relative)
  $isDirectory = [System.IO.Directory]::Exists($path)
  $acl = if ($isDirectory) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'fixture owner' }
  $inheritance = if ($isDirectory) { 'ContainerInherit,ObjectInherit' } else { 'None' }
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inheritance, 'None', 'Allow')
  $acl.AddAccessRule($rule)
  if ($isDirectory) { [System.IO.Directory]::SetAccessControl($path, $acl) } else { [System.IO.File]::SetAccessControl($path, $acl) }
}`;
  const result = run(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')],
    { env: { ...env, TT_GIT_CREDENTIAL_TEST_ROOT: repo } });
  assert.equal(result.status, 0, result.stderr);
}
protectSource();

function invoke(input = request, operation = 'get', cwd = repo) {
  return run(process.execPath, [helper, operation], { input, cwd });
}
function rejected(input, cwd) {
  const result = invoke(input, 'get', cwd);
  assert.equal(result.stdout, 'quit=true\n\n');
  assert.ok(!result.stderr.includes(token));
}
function shellQuote(value) { return "'" + value.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'"; }
const command = `!f() { ${shellQuote(process.execPath)} ${shellQuote(helper)} "$@" || printf 'quit=true\\n\\n'; }; f`;
for (const url of ['https://github.com/cookaihq/tt-workbench.git', 'https://github.com/cookaihq/tt-workbench']) {
  git(repo, 'config', '--add', `credential.${url}.helper`, '');
  git(repo, 'config', '--add', `credential.${url}.helper`, command);
  git(repo, 'config', `credential.${url}.useHttpPath`, 'true');
  git(repo, 'config', `credential.${url}.username`, 'x-access-token');
}

test('ordinary Git reads the selected file, supports spaces, and rereads a rotated Token', () => {
  const fill = input => run('git', ['credential', 'fill'], { cwd: repo, input });
  const first = fill(request);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, new RegExp(`password=${token}\\n`));
  try {
    writeFileSync(source, 'github_pat_ROTATED_FIXTURE\r\n');
    const next = fill(request.replace('.git', ''));
    assert.equal(next.status, 0, next.stderr);
    assert.match(next.stdout, /password=github_pat_ROTATED_FIXTURE\n/);
  } finally { writeFileSync(source, token + '\n'); }
});

test('rejects a different host, protocol, repository, username and duplicate identity', () => {
  for (const input of [
    request.replace('https', 'http'), request.replace('github.com', 'github.com.evil.invalid'),
    request.replace('tt-workbench.git', 'other.git'), request.replace('tt-workbench.git', 'tt-workbench.git/subpath'),
    request.replace('\n\n', '\nusername=another-user\n\n'), request.replace('host=github.com', 'host=github.com\nhost=github.com'),
    request.replace('path=cookaihq/tt-workbench.git\n', ''),
  ]) rejected(input);
  const repeatedOptional = invoke(request.replace('\n\n', '\ncapability[]=one\ncapability[]=two\n\n'));
  assert.equal(repeatedOptional.stdout, `username=x-access-token\npassword=${token}\n\n`);
});

test('store and erase preserve the source and emit no credential', () => {
  for (const operation of ['store', 'erase']) {
    const result = invoke('password=ignored\n\n', operation);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(readFileSync(source, 'utf8'), token + '\n');
  }
});

test('rejects malformed, tracked, non-ignored and hardlinked source files', () => {
  try {
    for (const value of ['', 'two\nlines', '"quoted"', 'TOKEN=value']) {
      writeFileSync(source, value);
      rejected(request);
    }
  } finally { writeFileSync(source, token + '\n'); }
  git(repo, 'add', '-f', '--', relativeSource);
  try { rejected(request); } finally { git(repo, 'rm', '--cached', '--', relativeSource); }
  writeFileSync(join(repo, '.gitignore'), '');
  try { rejected(request); } finally { writeFileSync(join(repo, '.gitignore'), '/.credentials/\n'); }
  const extraLink = join(sandbox, 'fake-token-hardlink');
  linkSync(source, extraLink);
  try { rejected(request); } finally { rmSync(extraLink); }
});

test('rejects another repository and works from a linked Worktree', () => {
  const outsider = join(sandbox, 'independent');
  mkdirSync(outsider);
  git(outsider, 'init', '-b', 'main');
  rejected(request, outsider);
  git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture');
  const checkout = join(sandbox, 'linked checkout');
  git(repo, 'worktree', 'add', '--detach', checkout, 'HEAD');
  const filled = run('git', ['credential', 'fill'], { cwd: checkout, input: request });
  assert.equal(filled.status, 0, filled.stderr);
  assert.match(filled.stdout, new RegExp(`password=${token}\\n`));
});

test('rejects a linked credential directory and non-private permissions', () => {
  const directory = join(repo, '.credentials/repositories');
  const saved = join(repo, '.credentials/original');
  renameSync(directory, saved);
  symlinkSync(saved, directory, process.platform === 'win32' ? 'junction' : 'dir');
  try { rejected(request); } finally {
    rmSync(directory);
    renameSync(saved, directory);
  }
  if (process.platform === 'win32') {
    const code = '$p=$env:TT_GIT_CREDENTIAL_TEST_FILE; $a=[System.IO.File]::GetAccessControl($p); $a.SetAccessRuleProtection($false,$true); [System.IO.File]::SetAccessControl($p,$a)';
    const result = run(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')],
      { env: { ...env, TT_GIT_CREDENTIAL_TEST_FILE: source } });
    assert.equal(result.status, 0, result.stderr);
    try { rejected(request); } finally { protectSource(); }
  } else {
    chmodSync(source, 0o644);
    try { rejected(request); } finally { chmodSync(source, 0o600); }
  }
});

test('a missing source or runtime aborts Git without falling through to another helper', () => {
  const marker = join(repo, 'fallback-ran');
  const fallbackScript = join(repo, 'fallback.mjs');
  writeFileSync(fallbackScript, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'called');`);
  const fallback = `!${shellQuote(process.execPath)} ${shellQuote(fallbackScript)}`;
  const key = 'credential.https://github.com/cookaihq/tt-workbench.git.helper';
  git(repo, 'config', '--add', key, fallback);
  rmSync(source);
  try {
    const result = run('git', ['credential', 'fill'], { cwd: repo, input: request });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.throws(() => readFileSync(marker), { code: 'ENOENT' });
  } finally {
    writeFileSync(source, token + '\n', { mode: 0o600 });
    protectSource();
  }
  git(repo, 'config', '--unset-all', key);
  git(repo, 'config', '--add', key, '');
  git(repo, 'config', '--add', key, command.replace(shellQuote(process.execPath), shellQuote(join(repo, 'missing-node'))));
  git(repo, 'config', '--add', key, fallback);
  const unavailable = run('git', ['credential', 'fill'], { cwd: repo, input: request });
  assert.notEqual(unavailable.status, 0);
  assert.equal(unavailable.stdout, '');
  assert.throws(() => readFileSync(marker), { code: 'ENOENT' });
});
