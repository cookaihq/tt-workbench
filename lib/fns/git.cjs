'use strict';
const { spawn } = require('node:child_process');
const { fail } = require('./rules.cjs');
const REF = 'refs/heads/tannt-fns-config';
class FnsGit {
  constructor(vault) { this.vault = vault; }
  command(args, input = '') {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_NO_REPLACE_OBJECTS: '1' };
      for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[name];
      const child = spawn('git', args, { cwd: this.vault, windowsHide: true,
        env, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', size = 0;
      const timer = setTimeout(() => child.kill(), 30000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => { size += Buffer.byteLength(data, 'utf8'); if (size > 16 * 1024 * 1024) child.kill(); else output += data; });
      child.stderr.resume(); // Git may include credential-bearing URLs in errors.
      child.stdin.on('error', () => {});
      child.once('error', () => { clearTimeout(timer); reject(Object.assign(new Error('无法运行 Git；请检查安装和 PATH。'), { code: 'GIT_UNAVAILABLE' })); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0 && size <= 16 * 1024 * 1024) resolve(output);
        else reject(Object.assign(new Error(`Git ${args[0]} 未完成，请检查仓库、远端连接与本机授权。`), { code: 'GIT_FAILED', exitCode: code }));
      });
      child.stdin.end(input);
    });
  }
  async head() {
    const output = await this.command(['ls-remote', '--refs', 'origin', REF]);
    const lines = output.trim().split('\n').filter(Boolean);
    if (!lines.length) return null;
    if (lines.length !== 1 || !/^[a-f0-9]{40,64}\s/.test(lines[0]) || lines[0].split(/\s+/)[1] !== REF) fail('INVALID_REMOTE', '远端 FNS 引用无法识别。');
    return lines[0].split(/\s+/)[0];
  }
  async receive(commit) {
    await this.command(['fetch', '--no-tags', '--no-write-fetch-head', 'origin', commit]);
    await this.command(['update-ref', 'refs/tannt/fns-config/incoming', commit]);
  }
  async accept(commit) { if (commit) await this.command(['update-ref', 'refs/tannt/fns-config/received', commit]); }
  async archivePending(commit) { await this.command(['update-ref', `refs/tannt/fns-config/discarded/${commit}`, commit]); }
  async isAncestor(before, after) {
    if (before === after) return true;
    try { await this.command(['merge-base', '--is-ancestor', before, after]); return true; }
    catch (error) { if (error.exitCode === 1) return false; throw error; }
  }
  async blob(commit, filename) { return this.command(['cat-file', 'blob', `${commit}:${filename}`]); }
  async create(metadata, raw, parent) {
    const blob = async text => (await this.command(['hash-object', '-w', '--stdin'], text)).trim();
    const tree = async entries => (await this.command(['mktree'], entries.map(([mode, type, oid, name]) => `${mode} ${type} ${oid}\t${name}\n`).join(''))).trim();
    const profile = await tree([['100644', 'blob', await blob(raw), 'data.json']]);
    const profiles = await tree([['040000', 'tree', profile, metadata.sourceDevice], ['100644', 'blob', await blob(JSON.stringify(metadata, null, 2) + '\n'), 'authority.jsonc']]);
    const config = await tree([['040000', 'tree', profiles, 'fns-config']]);
    const root = await tree([['040000', 'tree', config, 'config']]);
    const commit = (await this.command(['commit-tree', root, ...(parent ? ['-p', parent] : [])], `FNS rules v${metadata.version}\n`)).trim();
    await this.command(['update-ref', 'refs/tannt/fns-config/pending', commit]);
    return commit;
  }
  async push(commit) { await this.command(['push', '--porcelain', 'origin', `${commit}:${REF}`]); }
}
module.exports = { FnsGit, REF };
