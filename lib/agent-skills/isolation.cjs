'use strict';
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { parseConfig, normalize, validateScope } = require('../fns/rules.cjs');

// Inspect policy only. Skill registration never changes Git/FNS settings.
async function inspectIsolation(manager, agent) {
  const directories = [manager.host(agent).directory, ...require('../runtime/storage.cjs').protectedDirectories(manager.vault)];
  const reasons = [], notes = [];
  try {
    const options = { cwd: manager.vault, windowsHide: true, encoding: 'utf8', timeout: 10000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } };
    let repository = false;
    try { await execFile('git', ['rev-parse', '--show-toplevel'], options); repository = true; }
    catch (e) { if (e.code !== 128) throw e; }
    if (repository) {
      for (const directory of directories) {
        const tracked = await execFile('git', ['ls-files', '--', directory], options);
        if (tracked.stdout.trim()) reasons.push(`${directory}/ 含 Git 已跟踪内容；请先按知识库约定处理。`);
        // Require the directory itself to be ignored. A child-only glob may
        // leave a specific skill or a future recovery filename unignored.
        try { await execFile('git', ['check-ignore', '--no-index', '-q', '--', directory], options); }
        catch (e) {
          if (e.code !== 1) throw e;
          // Git treats an absent directory as a file. Inspect the matching rule
          // without mkdir; a literal directory rule covers its future contents,
          // whereas child-only globs must still fail this read-only preflight.
          let covered = false;
          try {
            const result = await execFile('git', ['check-ignore', '--no-index', '-v', '--', directory + '/'], options);
            const rule = result.stdout.split('\t')[0].split(':').at(-1);
            covered = Boolean(rule?.endsWith('/') && !rule.startsWith('!') && !/[?*\[\]]/.test(rule));
          } catch (error) { if (error.code !== 1) throw error; }
          if (!covered) reasons.push(`请先在目标库排除 Git 路径 ${directory}/，然后重新检查。`);
        }
      }
    } else notes.push('当前目录未使用 Git；将来接入 Git 时须排除发现入口和运行记录。');
  } catch (e) { reasons.push(`无法核验 Git 排除：${e.code || 'FAILED'}。`); }
  try {
    const relative = `${manager.configDir}/plugins/fast-note-sync`;
    await manager.plain(manager.vault, relative);
    const file = path.join(manager.vault, relative, 'data.json');
    if (await manager.stat(file)) {
      validateScope(normalize(parseConfig(await manager.text(file))), directories);
      notes.push('已核对本机 FNS 磁盘排除；其他设备须分别注册，运行中的 FNS 设置需另行核验。');
    } else notes.push('未发现本机 FNS 配置；启用同步前须排除发现入口和运行记录。');
  } catch (e) { reasons.push(`FNS 排除未通过：${e.message}`); }
  return { ok: reasons.length === 0, reasons, notes, directories };
}
module.exports = { inspectIsolation };
