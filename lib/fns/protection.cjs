'use strict';
const fs = require('node:fs');
const path = require('node:path');
const storage = require('../runtime/storage.cjs');
const { configDirectory } = require('../config/target.cjs');

// Inspect existence without following legacy links into another instance.
function exists(vault, relative) {
  if (!vault) return false;
  let current = vault;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) return true; }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; }
  }
  return true;
}
const legacyDirectories = vault => ['config/fns-config', '.fns-config'].filter(name => exists(vault, name));
const deviceDirectories = vault => [...storage.protectedDirectories(vault), ...legacyDirectories(vault)];

function workbenchPaths(configDir = '.obsidian', vault) {
  configDir = configDirectory(configDir);
  const result = storage.protectedDirectories(vault).map(path => ({ path, kind: 'directory' }));
  for (const directory of legacyDirectories(vault)) result.push({ path: directory, kind: 'directory', legacy: true });
  const pluginPaths = id => [
    { path: `${configDir}/plugins/${id}`, kind: 'directory' },
    { path: `${configDir}/plugins/${id}-recovery`, kind: 'directory' },
    { path: `${configDir}/plugins/${id}.install-lock`, kind: 'file' }
  ];
  result.push(...pluginPaths('tt-workbench'), { path: `${configDir}/community-plugins.json`, kind: 'file' });
  const old = pluginPaths('tannt-workbench');
  if (old.some(item => exists(vault, item.path))) result.push(...old.map(item => ({ ...item, legacy: true })));
  return result;
}
module.exports = { deviceDirectories, legacyDirectories, workbenchPaths };
