'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FnsUI } = require('../fns-ui.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const pending = [], rendered = [];
  let calls = 0, inFlight = 0, peak = 0;
  const view = { closed: false, pageScope: '@fns', contentEl: { querySelectorAll: () => [] }, plugin: { fns: {
    inspect: () => {
      calls++; peak = Math.max(peak, ++inFlight);
      return new Promise((resolve, reject) => pending.push({
        resolve: report => { inFlight--; resolve(report); },
        reject: error => { inFlight--; reject(error); }
      }));
    }
  } } };
  const ui = new FnsUI(view);
  ui.render = () => rendered.push(ui.error || ui.report);
  return { ui, view, pending, rendered, get calls() { return calls; }, get peak() { return peak; } };
}

test('a burst of FNS refresh requests keeps one read in flight and reads the latest state once more', async () => {
  const h = fixture();
  const first = h.ui.refresh();
  const burst = Array.from({ length: 40 }, () => h.ui.refresh());
  assert.equal(h.calls, 1);
  h.pending.shift().resolve({ revision: 'old' }); await tick();
  assert.equal(h.calls, 2);
  assert.deepEqual(h.rendered, [], 'superseded report must not render');
  h.pending.shift().resolve({ revision: 'latest' });
  await Promise.all([first, ...burst]);
  assert.equal(h.peak, 1);
  assert.deepEqual(h.rendered, [{ revision: 'latest' }]);
});

for (const leave of ['navigate', 'close']) {
  test(`${leave} drops queued FNS reads and ignores late results`, async () => {
    const h = fixture(); const first = h.ui.refresh(); const second = h.ui.refresh();
    if (leave === 'navigate') h.view.pageScope = '@tasks';
    else { h.view.closed = true; h.ui.dispose(); }
    assert.equal(h.calls, 1);
    h.pending.shift().resolve({ revision: 'old' });
    await first; await second;
    assert.equal(h.calls, 1); assert.deepEqual(h.rendered, []);
  });
}

test('a failed FNS read reports the error and allows a subsequent refresh', async () => {
  const h = fixture(); const first = h.ui.refresh();
  h.pending.shift().reject(Error('read failed')); await first;
  assert.equal(h.ui.error, 'read failed');
  const next = h.ui.refresh(); h.pending.shift().resolve({ revision: 'recovered' }); await next;
  assert.equal(h.ui.error, ''); assert.deepEqual(h.ui.report, { revision: 'recovered' });
});

test('leaving during inspection skips the follow-up local protection check', async () => {
  const h = fixture(); let checks = 0;
  h.view.plugin.inspectLocalProtection = async () => { checks++; return {}; };
  const refresh = h.ui.refresh(); h.view.pageScope = '@tasks'; h.ui.leave();
  h.pending.shift().resolve({ application: { code: 'PROTECTED_SCOPE' } }); await refresh;
  assert.equal(checks, 0); assert.deepEqual(h.rendered, []);
});

test('finishing an action after leaving FNS does not start a background report read', async () => {
  const h = fixture(); let finish;
  const action = h.ui.run(() => new Promise(resolve => { finish = resolve; }));
  await tick();
  h.view.pageScope = '@tasks'; finish({ message: 'done' }); await tick();
  assert.equal(h.calls, 0);
  await action;
});

test('returning to FNS while an old read completes only renders the new entry', async () => {
  const h = fixture(); const first = h.ui.refresh();
  h.view.pageScope = '@tasks'; h.ui.leave(); h.view.pageScope = '@fns';
  const next = h.ui.refresh();
  assert.equal(h.calls, 1);
  h.pending.shift().resolve({ revision: 'old entry' }); await tick();
  assert.deepEqual(h.rendered, []);
  h.pending.shift().resolve({ revision: 'new entry' }); await Promise.all([first, next]);
  assert.deepEqual(h.rendered, [{ revision: 'new entry' }]);
});

test('FNS actions wait for an existing read, then refresh without overlap', async () => {
  const h = fixture(); const first = h.ui.refresh(); let actions = 0;
  const action = h.ui.run(async () => { actions++; return { message: 'done' }; });
  await tick(); assert.equal(actions, 0);
  h.pending.shift().resolve({ revision: 'before action' }); await first; await tick();
  assert.equal(actions, 1); assert.equal(h.calls, 2);
  h.pending.shift().resolve({ revision: 'after action' }); await action;
  assert.equal(h.peak, 1); assert.equal(h.ui.report.revision, 'after action');
});

test('only FNS inputs trigger a debounced refresh, including custom settings and runtime paths', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture();
  h.ui.service.options = { configDir: 'settings' };
  h.ui.statePath = 'local/runtime/fns-sync/state.json';
  for (let i = 0; i < 100; i++) h.ui.fileChanged(`1.项目/notes-${i}.md`);
  h.ui.fileChanged('.obsidian/plugins/fast-note-sync/data.json');
  t.mock.timers.tick(200); assert.equal(h.calls, 0);
  for (const filename of ['settings/plugins/fast-note-sync/data.json', 'local/runtime/fns-sync/state.json', '.system/workbench/runtime.jsonc']) h.ui.fileChanged(filename);
  t.mock.timers.tick(149); assert.equal(h.calls, 0);
  t.mock.timers.tick(1); assert.equal(h.calls, 1);
  h.pending.shift().resolve({ revision: 'changed' }); await h.ui.refreshPromise;
  h.ui.fileChanged('settings\\plugins\\fast-note-sync\\data.json');
  h.ui.leave(); h.view.pageScope = '@tasks'; t.mock.timers.tick(200);
  assert.equal(h.calls, 1);
});

test('business file refreshes do not enter the FNS list/report path', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  vm.runInNewContext(source + '\nmodule.exports.WorkbenchView = WorkbenchView;', {
    module, require: name => name === 'obsidian' ? { Plugin: class {}, ItemView: class {} } : require(name)
  });
  const view = Object.create(module.exports.WorkbenchView.prototype);
  Object.assign(view, { listEl: {}, pageScope: '@fns', reader: { list: () => { throw Error('unexpected scan'); } },
    showError: error => { throw error; } });
  for (let i = 0; i < 100; i++) view.refreshList({ automatic: true });
  assert.throws(() => view.refreshList(), /unexpected scan/, 'explicit navigation still enters refresh');
});
