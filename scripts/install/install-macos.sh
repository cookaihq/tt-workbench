#!/bin/bash
# First installation using only tools shipped with macOS. Bash 3.2 compatible.
set -euo pipefail
vault=''
config_dir='.obsidian'
package_dir=''
vault_from_prompt='false'
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      echo 'install-macos.sh [--vault /absolute/vault] [--config-dir .obsidian] [--package-dir /absolute/downloads]'
      echo 'Close Obsidian first. Existing installations are never overwritten.'
      echo 'Without --vault, drag the vault folder into the terminal and press Enter when prompted.'
      echo '--package-dir uses an offline release.json and tt-workbench.bundle.json.gz.'
      exit 0 ;;
    --vault|--config-dir|--package-dir)
      [ "$#" -ge 2 ] && [ -n "$2" ] || { echo "Missing value for $1" >&2; exit 1; }
      case "$1" in
        --vault) vault="$2" ;;
        --config-dir) config_dir="$2" ;;
        --package-dir) package_dir="$2" ;;
      esac
      shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[ "$(uname -s)" = Darwin ] || { echo 'This script requires macOS.' >&2; exit 1; }
if [ -z "$vault" ]; then
  printf '请先退出 Obsidian。\n请将知识库文件夹拖入此窗口（也可粘贴完整路径），然后按回车：' >/dev/tty
  IFS= read -r vault </dev/tty
  vault_from_prompt='true'
fi
exec /usr/bin/osascript -l JavaScript - "$vault" "$config_dir" "$package_dir" "$vault_from_prompt" <<'JXA'
ObjC.import('Foundation');
var fm = $.NSFileManager.defaultManager;
var MAX = 64 * 1024 * 1024;
function fail(message) { throw new Error(message); }
function info(file) {
  var value = fm.attributesOfItemAtPathError(file, null);
  return value.isNil() ? null : value;
}
function type(file) {
  var value = info(file);
  return value ? ObjC.unwrap(value.objectForKey($.NSFileType)) : null;
}
function size(file) { return Number(ObjC.unwrap(info(file).objectForKey($.NSFileSize))); }
function droppedPath(input) {
  // Interpret terminal quoting as text only. Never evaluate pasted shell code.
  var literal = input.trim();
  if (!literal) fail('没有输入路径，请重新运行并拖入一个知识库文件夹。');
  if (type(literal)) return literal; // Also accept an unescaped path pasted from Finder.
  var result = '', quote = '', started = false, ended = false;
  for (var i = 0; i < input.length; i++) {
    var char = input.charAt(i);
    if (!quote && /\s/.test(char)) { if (started) ended = true; continue; }
    if (ended) fail('请只拖入一个知识库文件夹。');
    started = true;
    if (quote === "'") {
      if (char === "'") quote = ''; else result += char;
    } else if (char === '\\') {
      if (i + 1 === input.length) fail('路径末尾的转义不完整，请重新拖入文件夹。');
      var next = input.charAt(i + 1);
      if (!quote || /[\\"$`]/.test(next)) { result += next; i++; } else result += char;
    } else if (quote) {
      if (char === quote) quote = ''; else result += char;
    } else if (char === "'" || char === '"') quote = char;
    else result += char;
  }
  if (quote) fail('路径引号不完整，请重新拖入文件夹。');
  return result;
}
function plainDirectory(file) {
  if (file.charAt(0) !== '/' || /[\x00-\x1f]/.test(file)) fail('An absolute directory path is required: ' + file);
  var current = '';
  file.split('/').slice(1).forEach(function (part) {
    if (!part) return;
    if (part === '.' || part === '..') fail('Dot path segments are not allowed.');
    current += '/' + part;
    if (type(current) !== 'NSFileTypeDirectory') fail('Directory missing, linked or invalid: ' + current);
  });
  return current || '/';
}
function relative(name) {
  if (typeof name !== 'string' || !name || /[\\:*?"<>|\x00-\x1f\x7f]/.test(name) || name.split('/').some(function (part) {
    return !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part);
  })) fail('Unsafe relative path: ' + name);
  return name;
}
function mkdir(file) {
  if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(file, true, $.NSDictionary.dictionary, null)) fail('Cannot create directory: ' + file);
}
function runTool(executable, args) {
  var task = $.NSTask.alloc.init, pipe = $.NSPipe.pipe;
  task.launchPath = executable;
  task.arguments = args;
  task.standardOutput = pipe;
  task.standardError = pipe;
  task.launch;
  var output = pipe.fileHandleForReading.readDataToEndOfFile;
  task.waitUntilExit;
  var text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(output, $.NSUTF8StringEncoding)) || '';
  if (task.terminationStatus !== 0) fail(executable + ' failed. ' + text.trim());
  return text;
}
function read(file, limit) {
  if (type(file) !== 'NSFileTypeRegular' || size(file) > limit) fail('Missing, linked or oversized file: ' + file);
  return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(file, $.NSUTF8StringEncoding, null));
}
function download(url, file, limit) {
  runTool('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https',
    '--connect-timeout', '15', '--max-time', '180', '--retry', '2', '--max-filesize', String(limit),
    '--header', 'User-Agent: tt-workbench-installer', '--output', file, url]);
  if (size(file) > limit) fail('Download exceeds size limit.');
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function validateRelease(release) {
  if (!object(release) || release.schema !== 1 || release.id !== 'tt-workbench' || !/^\d+\.\d+\.\d+$/.test(release.version) || !object(release.files)) fail('Invalid release manifest.');
  var names = Object.keys(release.files), paths = Object.create(null);
  if (!names.length || names.length > 2000) fail('Invalid file count.');
  names.forEach(function (name) {
    relative(name);
    var lower = name.toLowerCase();
    if (/^(release\.json|data\.json|data|apps\/workbench\/data|\.system|\.workbench-runtime)(\/|$)/.test(lower) || !/^[a-f0-9]{64}$/.test(release.files[name])) fail('Invalid release file: ' + name);
    var parts = name.split('/');
    parts.forEach(function (_, i) {
      var exact = parts.slice(0, i + 1).join('/'), key = exact.toLowerCase(), kind = i === parts.length - 1 ? 'file' : 'directory';
      if (paths[key] && (paths[key].exact !== exact || paths[key].kind !== kind || kind === 'file')) fail('Conflicting package paths: ' + name);
      paths[key] = { exact: exact, kind: kind };
    });
  });
  ['main.js', 'styles.css', 'manifest.json'].forEach(function (name) { if (!release.files[name]) fail('Missing plugin entry: ' + name); });
  return names;
}
function verify(root, release, names) {
  names.forEach(function (name) {
    plainDirectory(root + '/' + name.split('/').slice(0, -1).join('/'));
    if (type(root + '/' + name) !== 'NSFileTypeRegular') fail('Missing or unsafe installed file: ' + name);
  });
  for (var i = 0; i < names.length; i += 40) {
    var batch = names.slice(i, i + 40);
    var lines = runTool('/usr/bin/shasum', ['-a', '256', '--'].concat(batch.map(function (name) { return root + '/' + name; }))).trim().split('\n');
    if (lines.length !== batch.length) fail('Unexpected checksum output.');
    batch.forEach(function (name, index) { if (lines[index].slice(0, 64) !== release.files[name]) fail('SHA-256 mismatch: ' + name); });
  }
}
function run(args) {
  var vault = plainDirectory(args[3] === 'true' ? droppedPath(args[0]) : args[0]), config = relative(args[1]), source = args[2];
  var configPath = plainDirectory(vault + '/' + config), parent = configPath + '/plugins';
  if (source) source = plainDirectory(source);
  if (type(parent) && type(parent) !== 'NSFileTypeDirectory') fail('Plugin directory is linked or invalid.');
  var target = parent + '/tt-workbench', legacy = parent + '/tannt-workbench';
  function checkTarget() {
    plainDirectory(configPath);
    if (type(parent)) plainDirectory(parent);
    if (type(target)) fail('tt-workbench already exists. Use the workbench version menu to update; nothing was overwritten.');
    if (type(legacy)) fail('tannt-workbench exists. Follow docs/workbench/updates.md migration instructions first.');
  }
  checkTarget();
  console.log('Close Obsidian before installing. Target: ' + target);
  mkdir(parent);
  var lock = parent + '/tt-workbench.install-lock';
  // mkdir is exclusive and shares the existing installer's lock pathname.
  runTool('/bin/mkdir', [lock]);
  var work = null;
  try {
    checkTarget();
    var recovery = parent + '/tt-workbench-recovery';
    if (type(recovery) && type(recovery) !== 'NSFileTypeDirectory') fail('Recovery directory is linked or invalid.');
    mkdir(recovery);
    work = recovery + '/command-' + ObjC.unwrap($.NSUUID.UUID.UUIDString);
    runTool('/bin/mkdir', [work]);
    var releaseFile = work + '/release.json', bundleFile = work + '/tt-workbench.bundle.json.gz';
    if (source) {
      [ ['release.json', 2 * 1024 * 1024], ['tt-workbench.bundle.json.gz', MAX] ].forEach(function (entry) {
        var file = source + '/' + entry[0];
        if (type(file) !== 'NSFileTypeRegular' || size(file) > entry[1]) fail('Invalid offline file: ' + file);
        if (!fm.copyItemAtPathToPathError(file, work + '/' + entry[0], null)) fail('Cannot copy offline package.');
      });
    } else {
      var metadata = work + '/github.json';
      download('https://api.github.com/repos/cookaihq/tt-workbench/releases/latest', metadata, 2 * 1024 * 1024);
      var github = JSON.parse(read(metadata, 2 * 1024 * 1024));
      if (github.draft || github.prerelease || !Array.isArray(github.assets)) fail('No stable release is available.');
      console.log('Downloading release ' + github.tag_name + ' ...');
      [ ['release.json', releaseFile, 2 * 1024 * 1024], ['tt-workbench.bundle.json.gz', bundleFile, MAX] ].forEach(function (entry) {
        var assets = github.assets.filter(function (asset) { return asset.name === entry[0]; });
        if (assets.length !== 1 || assets[0].size <= 0 || assets[0].size > entry[2]) fail('Missing or invalid release asset: ' + entry[0]);
        var asset = assets[0];
        if (asset.browser_download_url !== 'https://github.com/cookaihq/tt-workbench/releases/download/' + encodeURIComponent(github.tag_name) + '/' + entry[0]) fail('Unexpected release download URL.');
        download(asset.browser_download_url, entry[1], entry[2]);
        if (size(entry[1]) !== asset.size) fail('Incomplete download: ' + entry[0]);
      });
    }
    var release = JSON.parse(read(releaseFile, 2 * 1024 * 1024)), names = validateRelease(release);
    // Bound decompressed output before parsing JSON (including corrupt gzip input).
    var jsonFile = work + '/bundle.json';
    runTool('/bin/bash', ['-c', 'set -o pipefail; /usr/bin/gzip -dc "$1" | /usr/bin/head -c 100663297 > "$2"', 'tt-installer', bundleFile, jsonFile]);
    var bundle = JSON.parse(read(jsonFile, 96 * 1024 * 1024));
    validateRelease(bundle.release);
    if (bundle.release.version !== release.version || Object.keys(bundle.release.files).length !== names.length || names.some(function (name) { return bundle.release.files[name] !== release.files[name]; })) fail('Release manifests differ.');
    if (!object(bundle.files) || Object.keys(bundle.files).length !== names.length || names.some(function (name) { return !Object.prototype.hasOwnProperty.call(bundle.files, name); })) fail('Package has missing or unlisted files.');
    var stage = work + '/plugin', total = 0;
    mkdir(stage);
    names.forEach(function (name) {
      var encoded = bundle.files[name];
      if (typeof encoded !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('Invalid base64: ' + name);
      var bytes = $.NSData.alloc.initWithBase64EncodedStringOptions(encoded, 0);
      if (bytes.isNil()) fail('Cannot decode: ' + name);
      total += Number(bytes.length);
      if (total > MAX) fail('Package exceeds size limit.');
      var file = stage + '/' + name;
      mkdir(file.slice(0, file.lastIndexOf('/')));
      if (!bytes.writeToFileAtomically(file, true)) fail('Cannot write: ' + name);
    });
    var manifest = JSON.parse(read(stage + '/manifest.json', MAX));
    if (manifest.id !== release.id || manifest.version !== release.version || !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion)) fail('Plugin metadata does not match release.');
    if (!fm.copyItemAtPathToPathError(releaseFile, stage + '/release.json', null)) fail('Cannot save release manifest.');
    verify(stage, release, names);
    checkTarget();
    if (!fm.moveItemAtPathToPathError(stage, target, null)) fail('Cannot install; target may have appeared. Nothing was overwritten.');
    verify(target, release, names);
    if (read(target + '/release.json', 2 * 1024 * 1024) !== read(releaseFile, 2 * 1024 * 1024)) fail('Installed release manifest changed.');
    return 'Installed tt-workbench ' + release.version + '\nLocation: ' + target + '\nSHA-256 verified: ' + names.length + ' files. Requires Obsidian ' + manifest.minAppVersion + '+.\nReopen Obsidian, enable tt 工作台 in Settings > Community plugins, then open tt 工作台.';
  } finally {
    if (work && !fm.removeItemAtPathError(work, null)) console.log('Could not remove installer workspace: ' + work);
    if (!fm.removeItemAtPathError(lock, null)) console.log('Could not remove installer lock: ' + lock);
  }
}
JXA
