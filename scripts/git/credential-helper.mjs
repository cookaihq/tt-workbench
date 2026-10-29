// Ordinary Git authentication for this repository; never log the credential reply.
import { execFileSync } from 'node:child_process';
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const source = '.credentials/repositories/cookaihq--tt%2Dworkbench.github-token';
const identities = new Set(['protocol', 'host', 'path', 'username']);

function localEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CONFIG|TRACE|CURL_VERBOSE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)/i.test(key)
      || /^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|NODE_OPTIONS|NODE_PATH)$/i.test(key)) delete env[key];
  }
  return { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' };
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], {
    env: localEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024,
  }).trim();
}

function verifyRequest(text) {
  const fields = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) break;
    const equals = line.indexOf('=');
    if (equals < 1 || /[\0\r]/.test(line)) throw new Error('request');
    const key = line.slice(0, equals);
    if (!identities.has(key)) continue;
    if (fields.has(key)) throw new Error('request');
    fields.set(key, line.slice(equals + 1));
  }
  if (fields.get('protocol') !== 'https' || fields.get('host') !== 'github.com'
    || !['cookaihq/tt-workbench', 'cookaihq/tt-workbench.git'].includes(fields.get('path'))
    || (fields.has('username') && fields.get('username') !== 'x-access-token')) throw new Error('target');
}

function verifyWindowsPermissions() {
  // Paths only travel in this environment variable; PowerShell never reads the Token.
  const command = String.raw`
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($relative in @('.credentials', '.credentials/repositories', '.credentials/repositories/cookaihq--tt%2Dworkbench.github-token')) {
  $path = [System.IO.Path]::Combine($env:TT_GIT_CREDENTIAL_ROOT, $relative)
  if (([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'link' }
  $acl = if ([System.IO.Directory]::Exists($path)) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }
  if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner' }
  $allowed = $false
  foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
      if ($rule.IdentityReference.Value -ne $sid.Value) { throw 'access' }
      $allowed = $true
    }
  }
  if (!$allowed) { throw 'access' }
}`;
  execFileSync(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
      env: { ...localEnvironment(), TT_GIT_CREDENTIAL_ROOT: root }, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 65536,
    });
}

function readToken() {
  const common = cwd => realpathSync(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  if (common(process.cwd()) !== common(root)) throw new Error('repository');
  if (git(root, ['ls-files', '--', source])) throw new Error('tracked');
  git(root, ['check-ignore', '-q', '--', source]);

  const paths = [join(root, '.credentials'), join(root, '.credentials/repositories'), join(root, source)];
  const stats = paths.map(path => lstatSync(path));
  for (const [index, info] of stats.entries()) {
    const file = index === paths.length - 1;
    if (info.isSymbolicLink() || (file ? !info.isFile() || info.nlink !== 1 || info.size > 16384 : !info.isDirectory())) throw new Error('file');
    if (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o777) !== (file ? 0o600 : 0o700))) throw new Error('permissions');
  }
  if (process.platform === 'win32') verifyWindowsPermissions();

  const fd = openSync(paths[2], 'r');
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > 16384
      || opened.ino !== stats[2].ino || opened.dev !== stats[2].dev) throw new Error('changed');
    const raw = readFileSync(fd, 'utf8');
    if (raw.length > 16384 || !/^[A-Za-z0-9_]+(?:\r?\n)?$/.test(raw)) throw new Error('format');
    return raw.replace(/\r?\n$/, '');
  } finally {
    closeSync(fd);
  }
}

try {
  const [operation, extra] = process.argv.slice(2);
  if (extra !== undefined || !['get', 'store', 'erase'].includes(operation)) throw new Error('operation');
  if (operation === 'get') {
    let request = '';
    for await (const chunk of process.stdin) {
      request += chunk;
      if (Buffer.byteLength(request) > 32768) throw new Error('request');
    }
    verifyRequest(request);
    process.stdout.write(`username=x-access-token\npassword=${readToken()}\n\n`);
  }
  // Git's store/erase must never duplicate or delete the selected source file.
} catch {
  // Never echo an exception: child-process errors can contain sensitive input.
  process.stderr.write('tt-workbench: Git credential unavailable; check the target, source file and private permissions.\n');
  process.stdout.write('quit=true\n\n');
}
