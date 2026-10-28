'use strict';
const { fail } = require('./rules.cjs');
const { validNotes } = require('./notes.cjs');
const id = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const version = value => Number.isSafeInteger(value) && value > 0;
const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
const nullable = (value, valid) => value === null || value === undefined || valid(value);
const pending = value => object(value, ['commit', 'publicationId', 'version', 'parent', 'discardedAt']) && oid(value.commit) && id(value.publicationId) && version(value.version) && (value.parent === null || oid(value.parent));
const receipt = (value, deviceId) => object(value, ['deviceId', 'publicationId', 'version', 'fingerprint', 'loaded', 'appliedAt'])
  && value.deviceId === deviceId && id(value.publicationId) && version(value.version) && digest(value.fingerprint) && typeof value.loaded === 'boolean' && date(value.appliedAt);
function validateState(state, deviceId, configDir) {
  const valid = object(state, ['schema', 'deviceId', 'configDir', 'received', 'applied', 'baseline', 'pending', 'discarded', 'blocked', 'recovery', 'notesDraft'])
    && state.schema === 1 && state.deviceId === deviceId && state.configDir === configDir
    && nullable(state.baseline, digest) && nullable(state.applied, value => receipt(value, deviceId))
    && nullable(state.pending, pending)
    && nullable(state.notesDraft, value => object(value, ['authorityCommit', 'notes'])
      && (value.authorityCommit === null || oid(value.authorityCommit)) && validNotes(value.notes))
    && nullable(state.discarded, value => Array.isArray(value) && value.every(v => pending(v) && date(v.discardedAt)))
    && nullable(state.received, value => object(value, ['commit', 'checkedAt']) && (value.commit === null || oid(value.commit)) && date(value.checkedAt))
    && nullable(state.blocked, value => object(value, ['code', 'commit', 'checkedAt']) && ['SOURCE_CHANGED', 'INVALID_PUBLICATION', 'INVALID_CONFIG', 'INVALID_RULES', 'PROTECTED_SCOPE', 'REMOTE_HISTORY_CHANGED'].includes(value.code) && (value.commit === null || oid(value.commit)) && date(value.checkedAt))
    && nullable(state.recovery, value => typeof value === 'string' && value.startsWith('apps/workbench/data/fns-sync/operations/') && id(value.slice('apps/workbench/data/fns-sync/operations/'.length)));
  if (!valid) fail('INVALID_STATE', '本机同步记录损坏或不属于当前设备与配置目录，请保留现场并核对恢复记录。');
  return state;
}
module.exports = { validateState, id, oid, digest, date, receipt };
