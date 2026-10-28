'use strict';
const fs = require('node:fs');
const path = require('node:path');

function resolveVault(value) {
  if (!value || typeof value !== 'string' || !path.isAbsolute(value)) {
    throw Object.assign(new Error('请显式提供 --vault <知识库绝对路径>。'), { code: 'VAULT_REQUIRED' });
  }
  const root = fs.realpathSync(value);
  if (!fs.statSync(root).isDirectory()) throw Error('目标知识库必须是目录。');
  return root;
}

function vaultArgument(args = process.argv.slice(2)) {
  const matches = args.flatMap((value, index) => value === '--vault' ? [args[index + 1]] : value.startsWith('--vault=') ? [value.slice(8)] : []);
  if (matches.length !== 1) throw Object.assign(new Error('必须且只能指定一次 --vault <知识库绝对路径>。'), { code: 'VAULT_REQUIRED' });
  return resolveVault(matches[0]);
}

function configDirectory(value = '.obsidian') {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || /[\\:\x00-\x1f]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Obsidian 配置目录须为库内相对目录。');
  return value;
}

module.exports = { resolveVault, vaultArgument, configDirectory };
