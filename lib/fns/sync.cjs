'use strict';
const runtimeStorage = require('../runtime/storage.cjs');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { FnsGit } = require('./git.cjs');
const { safePath, atomicJSON, acquireLock } = require('./files.cjs');
const { validateState, id, oid, date, digest, receipt } = require('./state.cjs');
const { parseJSONC } = require('../config/jsonc.cjs');
const { FIELDS, hash, fail, parseConfig, normalize, fingerprint, difference, validateScope } = require('./rules.cjs');
const { inspectDeviceConfig, migrateDeviceConfig, currentDeviceId } = require('./device-config.cjs');
const { deviceDirectories, workbenchPaths } = require('./protection.cjs');
const { normalizeNotes, notesForRules, notesRevision, noteChanges } = require('./notes.cjs');

class FnsSyncService {
  constructor(options) {
    this.options = options; this.vault = path.resolve(options.vault);
    this.runtime = options.runtime;
    this.git = new FnsGit(this.vault);
    this.publications = new Map();
  }
  get data() { return path.join(this.vault, runtimeStorage.relative('fns-sync', this.vault)); }
  async readState() {
    await runtimeStorage.assertReady(this.vault);
    await safePath(this.vault, path.join(this.data, 'state.json'), { file: true });
    try { return validateState(parseConfig(await fs.readFile(path.join(this.data, 'state.json'), 'utf8')), await this.deviceId(), this.options.configDir || '.obsidian', this.vault); }
    catch (e) { if (e.code === 'ENOENT') return {}; fail('INVALID_STATE', '本机同步记录无法读取，请保留现场并核对恢复记录。'); }
  }
  async saveState(state) {
    Object.assign(state, { schema: 1, deviceId: await this.deviceId(), configDir: this.options.configDir || '.obsidian' });
    validateState(state, state.deviceId, state.configDir, this.vault);
    await atomicJSON(this.vault, path.join(this.data, 'state.json'), state);
  }
  async deviceId() { return this.options.deviceId || currentDeviceId(); }
  async withLock(operation, options = {}) {
    return runtimeStorage.withRuntime(this.vault, () => this.withServiceLock(operation, options));
  }
  async withServiceLock(operation, { onboarding = false, recovering = null } = {}) {
    const device = await inspectDeviceConfig(this.options);
    if (!['ready', 'needs-migration'].includes(device.status)) fail('DEVICE_NOT_READY', device.message || '请先核对本机配置归属。');
    const input = path.join(this.vault, device.input || device.source);
    validateScope(normalize(parseConfig(await fs.readFile(input, 'utf8'))), onboarding ? runtimeStorage.protectedDirectories(this.vault) : deviceDirectories(this.vault));
    const manifest = await safePath(this.vault, path.join(this.vault, this.options.configDir || '.obsidian', 'plugins/fast-note-sync/manifest.json'), { file: true });
    const version = parseConfig(await fs.readFile(manifest, 'utf8')).version;
    if (version !== '2.4.0') fail('UNSUPPORTED_FNS', '当前只核验了 FNS 2.4.0，请先复核此版本的规则语义与加载行为。');
    if (path.resolve((await this.git.command(['rev-parse', '--show-toplevel'])).trim()) !== this.vault) fail('INVALID_REPOSITORY', 'Git 仓库根目录必须是当前库。');
    // Git must see a real directory without a trailing slash: data/* can match data/.
    // Create only the parent if absent; no runtime records are written before validation.
    await safePath(this.vault, path.dirname(this.data), { mkdir: true });
    await this.checkStorage();
    if (device.status === 'ready') {
      if ((await this.git.command(['ls-files', '--', device.source])).trim()) fail('UNSAFE_STORAGE', '本机运行配置已被 Git 跟踪，请先停止跟踪。');
      try { await this.git.command(['check-ignore', '--quiet', device.source]); }
      catch { fail('UNSAFE_STORAGE', '请将本机 FNS data.json 加入 Git 忽略；发布快照不受影响。'); }
    }
    await safePath(this.vault, this.data, { mkdir: true });
    const lockPath = path.join(this.data, 'operation.lock');
    if (recovering && (!id(recovering) || (await this.readState()).recovery !== runtimeStorage.relative(`fns-sync/operations/${recovering}`, this.vault))) fail('INVALID_RECOVERY', '请核对本机上次操作的恢复标识。');
    const lock = await acquireLock(this.vault, lockPath, Boolean(recovering));
    try { await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); return await operation(); }
    finally { await lock.close(); await fs.unlink(lockPath); }
  }
  async checkStorage(files = [runtimeStorage.relative('', this.vault), runtimeStorage.relative('fns-sync/state.json', this.vault), runtimeStorage.relative('fns-sync/operation.lock', this.vault)]) {
    const directory = runtimeStorage.relative('', this.vault);
    if ((await this.git.command(['ls-files', '-z', '--', directory])).length) fail('UNSAFE_STORAGE', `${directory}/ 中已有 Git 跟踪文件，请先核对并停止跟踪；未写入运行数据。`);
    for (const filename of files) {
      try { await this.git.command(['check-ignore', '--quiet', filename]); }
      catch { fail('UNSAFE_STORAGE', `请先将整个 ${directory}/ 及其中运行文件加入本库 Git 忽略规则。`); }
    }
  }
  async local() {
    const device = await inspectDeviceConfig({ ...this.options, vault: this.vault });
    if (device.status !== 'ready') throw Object.assign(new Error(device.message || '请先将旧配置链接迁回插件目录，再重试。'), { code: 'DEVICE_NOT_READY', deviceStatus: device.status });
    const filename = path.join(this.vault, device.source), raw = await fs.readFile(filename, 'utf8');
    const config = parseConfig(raw), rules = normalize(config);
    return { device, filename, raw, config, rules, revision: hash(raw), fingerprint: fingerprint(rules) };
  }
  async inspectLocal() {
    const device = await inspectDeviceConfig({ ...this.options, vault: this.vault });
    if (device.status !== 'ready') return { device, local: null };
    const local = await this.local();
    return { device, local: { rules: local.rules }, runtime: await this.runtimeState(local.rules) };
  }
  async onboard() {
    if ((await inspectDeviceConfig(this.options)).status === 'ready') return this.inspect();
    return this.withLock(async () => {
      if (!this.runtime) fail('RUNTIME_REQUIRED', '迁回需要先暂停 FNS；请使用工作台或独立程序的暂停确认入口。');
      let previous, result, restoreFailed = false;
      try { previous = await this.runtime.suspend(); result = await migrateDeviceConfig(this.options); }
      finally { if (previous) { try { await this.runtime.restore(previous); } catch { restoreFailed = true; } } }
      const report = await this.inspect();
      return { ...report, migration: result, message: restoreFailed ? '配置已迁回，但 FNS 恢复失败，请重新启用并核验。' : '本机配置已迁回；未改变权威版本应用记录。' };
    }, { onboarding: true });
  }
  async publication(commit) {
    if (!commit) return null;
    if (!oid(commit)) fail('INVALID_PUBLICATION', '发布提交标识无效。');
    if (this.publications.has(commit)) return this.publications.get(commit);
    let metadata;
    try { metadata = parseJSONC(await this.git.blob(commit, 'config/fns-config/authority.jsonc')); }
    catch { fail('INVALID_PUBLICATION', '权威发布记录缺失或无法解析。'); }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
        || Object.keys(metadata).some(key => !['schema', 'id', 'previousId', 'version', 'sourceDevice', 'publishedAt', 'fields', 'fingerprint', ...(metadata.schema === 2 ? ['notes'] : [])].includes(key))
        || ![1, 2].includes(metadata.schema) || !/^(darwin|win32)-[a-f0-9]{16}$/.test(metadata.sourceDevice)
        || !Number.isSafeInteger(metadata.version) || metadata.version < 1 || !id(metadata.id)
        || metadata.previousId !== null && !id(metadata.previousId)
        || !date(metadata.publishedAt) || !/^[a-f0-9]{64}$/.test(metadata.fingerprint || '')
        || JSON.stringify(metadata.fields) !== JSON.stringify(FIELDS)) fail('INVALID_PUBLICATION', '权威记录的格式、设备或字段范围无法识别。');
    let source;
    try { source = await this.git.blob(commit, `config/fns-config/${metadata.sourceDevice}/data.json`); }
    catch { fail('INVALID_PUBLICATION', '发布中的来源设备配置缺失或无法读取。'); }
    const config = parseConfig(source);
    const rules = normalize(config);
    if (fingerprint(rules) !== metadata.fingerprint) fail('SOURCE_CHANGED', '来源规则与发布指纹不一致，请来源设备重新发布。');
    let notes;
    try {
      notes = normalizeNotes(metadata.schema === 1 ? [] : metadata.notes);
      if (notesForRules(notes, rules).length !== notes.length) throw Error('orphan note');
    } catch { fail('INVALID_PUBLICATION', '发布中的设置说明无效或未对应此版本的规则。'); }
    const files = (await this.git.command(['ls-tree', '-r', '--full-tree', commit])).trim().split('\n');
    const expected = ['config/fns-config/authority.jsonc', `config/fns-config/${metadata.sourceDevice}/data.json`].sort();
    if (files.length !== 2 || files.some(line => !/^100644 blob [a-f0-9]{40,64}\t/.test(line))
        || JSON.stringify(files.map(line => line.split('\t')[1]).sort()) !== JSON.stringify(expected)) fail('INVALID_PUBLICATION', 'FNS 发布含范围外文件或非普通配置文件，已停止使用。');
    const parents = (await this.git.command(['rev-list', '--parents', '-n', '1', commit])).trim().split(' ').slice(1);
    if (parents.length > 1) fail('INVALID_PUBLICATION', 'FNS 发布必须沿单一前序追加，不能包含合并历史。');
    const previous = parents.length ? await this.publication(parents[0]) : null;
    if (metadata.previousId !== (previous?.id || null) || metadata.version !== (previous?.version || 0) + 1 || metadata.id === previous?.id) fail('INVALID_PUBLICATION', '发布身份、版本与提交前序不一致，请核对发布历史。');
    const publication = { ...metadata, commit, parentCommit: parents[0] || null, rules, notes };
    this.publications.set(commit, publication);
    return publication;
  }
  async runtimeState(rules) {
    let state;
    try { state = this.runtime ? await this.runtime.inspect() : { known: false }; }
    catch { return { loaded: false, warnings: ['无法核验当前 FNS 运行状态。'] }; }
    if (state.known === false) return { loaded: false, enabled: null, verified: false, warnings: ['独立程序未核验 FNS 运行状态，请在工作台确认实际加载。'] };
    const warnings = [];
    if (!state.loaded) warnings.push('FNS 未加载；文件配置与实际加载分别核验。');
    if (state.connected === false) warnings.push('FNS 当前未连接服务端；规则加载通过不代表文件传输已完成。');
    if (state.settings && state.settings.configSyncEnabled !== true) warnings.push('本机配置同步开关未开启，额外目录暂不参与配置同步。');
    if (state.settings?.readonlySyncEnabled) warnings.push('本机处于只读模式，不上传本机文件。');
    let loaded = false;
    if (state.loaded && state.settings) {
      try {
        const actual = normalize(state.settings), internal = `${this.options.configDir || '.obsidian'}/plugins/fast-note-sync`;
        actual.syncExcludeFolders = actual.syncExcludeFolders.filter(r => !(r.pattern === internal || r.pattern.startsWith(internal + '/')));
        loaded = fingerprint(actual) === fingerprint(rules);
        if (!loaded) warnings.push('FNS 当前加载的规则与磁盘不同，需要重新加载并核验。');
      } catch { warnings.push('无法解释当前 FNS 运行时规则。'); }
    }
    return { loaded, enabled: Boolean(state.enabled), warnings };
  }
  async inspect() {
    const device = await inspectDeviceConfig({ ...this.options, vault: this.vault });
    if (device.status === 'missing-config') device.message = '请先安装 Fast Note Sync（FNS），完成本机设置，再接入当前设备。';
    const state = await this.readState(), publication = await this.publication(state.received?.commit);
    if (device.status !== 'ready') return { device, local: null, publication, applied: state.applied || null, pending: state.pending || null, status: device.status };
    const local = await this.local();
    const baseline = state.baseline || state.applied?.fingerprint;
    const dirty = Boolean(baseline && baseline !== local.fingerprint);
    const equal = publication?.fingerprint === local.fingerprint;
    const runtime = await this.runtimeState(local.rules);
    let status = state.pending ? 'pending' : dirty ? 'local-changes' : equal ? 'equal' : publication ? 'update-available' : 'no-publication';
    if (equal && !dirty && !state.pending && state.applied?.publicationId === publication.id) status = runtime.loaded ? 'applied' : 'written';
    if (state.blocked) status = state.blocked.code === 'PROTECTED_SCOPE' ? 'authority-recheck' : 'authority-invalid';
    let application = null;
    if (publication) {
      try { this.assertApplicable(local, publication); application = { allowed: !state.blocked }; }
      catch (error) { application = { allowed: false, code: error.code, message: '此版本不能直接应用到本机：' + error.message }; }
    }
    return { device, local: { rules: local.rules, revision: local.revision, fingerprint: local.fingerprint }, publication, blocked: state.blocked || null,
      application,
      applied: state.applied || null, pending: state.pending || null, checkedAt: state.received?.checkedAt || null,
      localChanged: dirty, status, runtime, recovery: state.recovery || null,
      notes: this.notesReport(state, local, publication) };
  }
  notesReport(state, local, publication) {
    const authorityCommit = publication?.commit || null;
    return {
      expected: { authorityCommit, localRevision: local.revision, notesRevision: notesRevision(state) },
      draft: Boolean(state.notesDraft), conflict: Boolean(state.notesDraft && state.notesDraft.authorityCommit !== authorityCommit),
      entries: notesForRules(state.notesDraft?.notes || publication?.notes || [], local.rules)
    };
  }
  saveNotes(expected, entries) {
    return this.withLock(async () => {
      const local = await this.local(), state = await this.readState();
      const publication = await this.publication(state.received?.commit);
      const current = this.notesReport(state, local, publication).expected;
      if (!expected || Object.keys(current).some(key => current[key] !== expected[key])) fail('STALE_NOTES', '规则、已接收版本或说明草稿已变化；输入仍保留，请重新比较后保存。');
      if (state.pending) fail('PENDING_PUBLICATION', '已有待推送发布，请先完成推送或放弃后再编辑说明。');
      const notes = normalizeNotes(entries);
      if (notesForRules(notes, local.rules).length !== notes.length) fail('INVALID_NOTES', '说明必须对应当前本机的一条规则。');
      const inherited = notesForRules(publication?.notes || [], local.rules);
      state.notesDraft = JSON.stringify(notes) === JSON.stringify(inherited) ? null : { authorityCommit: current.authorityCommit, notes };
      if ((await this.local()).revision !== local.revision) fail('STALE_NOTES', '本机规则在保存期间发生变化，未保存说明，请重新比较。');
      await this.saveState(state);
      if (JSON.stringify((await this.readState()).notesDraft) !== JSON.stringify(state.notesDraft)) fail('VERIFY_FAILED', '说明保存后的读回核验未通过，请保留输入。');
      return { status: 'notes-saved', message: state.notesDraft ? '说明草稿已保存到本机；发布后，其他设备才能接收。' : '说明与已接收版本一致，已清除本机说明草稿。' };
    });
  }
  checkUpdates() { return this.withLock(() => this.receive()); }
  async receive() {
    const state = await this.readState(), commit = await this.git.head();
    try {
      if (commit) { await this.git.receive(commit); await this.publication(commit); }
      if (state.received?.commit && (!commit || !await this.git.isAncestor(state.received.commit, commit))) fail('REMOTE_HISTORY_CHANGED', '远端 FNS 历史被删除或改写，保留最近收到的版本，请先核对。');
    } catch (error) {
      if (['SOURCE_CHANGED', 'INVALID_PUBLICATION', 'INVALID_CONFIG', 'INVALID_RULES', 'REMOTE_HISTORY_CHANGED'].includes(error.code)) {
        state.blocked = { code: error.code, commit, checkedAt: new Date().toISOString() }; await this.saveState(state);
      }
      throw error;
    }
    state.received = { commit, checkedAt: new Date().toISOString() };
    state.blocked = null;
    await this.git.accept(commit);
    await this.saveState(state);
    return this.inspect();
  }
  async preview(action) {
    if (!['publish', 'apply'].includes(action)) fail('INVALID_ACTION', '只支持发布或应用预览。');
    if (action === 'publish') await this.checkUpdates();
    const local = await this.local(), state = await this.readState(), publication = await this.publication(state.received?.commit);
    if (state.blocked) fail('AUTHORITY_BLOCKED', '已发现远端发布异常；最近收到的版本仅供回查，请修复发布并重新检查更新后再操作。');
    validateScope(local.rules, deviceDirectories(this.vault));
    if (action === 'apply' && !publication) fail('NO_PUBLICATION', '请先接收一个有效的权威版本。');
    if (action === 'apply') this.assertApplicable(local, publication);
    const notes = this.notesReport(state, local, publication);
    if (action === 'publish' && notes.conflict) fail('NOTES_CONFLICT', '说明草稿基于较早版本。请打开“编辑说明”，比较当前版本后重新保存，再发布。');
    const empty = Object.fromEntries(FIELDS.map(f => [f, []]));
    return { action, deviceId: local.device.deviceId, localRevision: local.revision, authorityCommit: publication?.commit || null,
      publicationId: publication?.id || null, version: action === 'publish' ? (publication?.version || 0) + 1 : publication.version,
      localChanged: Boolean((state.baseline || state.applied?.fingerprint) && (state.baseline || state.applied?.fingerprint) !== local.fingerprint),
      ...(action === 'publish' ? { notes: notes.entries, notesRevision: notes.expected.notesRevision, noteChanges: noteChanges(publication?.notes || [], notes.entries) } : {}),
      diff: action === 'publish' ? difference(publication?.rules || empty, local.rules) : difference(local.rules, publication.rules) };
  }
  async validatePlan(plan, action) {
    const local = await this.local(), state = await this.readState();
    if (plan?.action !== action || plan.deviceId !== local.device.deviceId || plan.localRevision !== local.revision
        || plan.authorityCommit !== (state.received?.commit || null)) fail('STALE_PLAN', '配置或版本在预览后变化，请重新比较。');
    return { local, state };
  }
  publish(plan) { return this.withLock(() => this.publishLocked(plan)); }
  async publishLocked(plan) {
    const { local, state } = await this.validatePlan(plan, 'publish');
    if (state.blocked) fail('AUTHORITY_BLOCKED', '已发现远端发布异常，请修复发布并重新检查更新。');
    validateScope(local.rules, deviceDirectories(this.vault));
    if (state.pending) fail('PENDING_PUBLICATION', '已有待推送发布，请先重试或处理版本争用。');
    if (await this.git.head() !== plan.authorityCommit) fail('REMOTE_CHANGED', '远端已有其他发布，请重新接收并比较。');
    const previous = await this.publication(plan.authorityCommit);
    const notes = this.notesReport(state, local, previous);
    if (notes.conflict || plan.notesRevision !== notes.expected.notesRevision || JSON.stringify(plan.notes) !== JSON.stringify(notes.entries)) fail('STALE_PLAN', '说明在预览后发生变化，请重新比较再发布。');
    const metadata = { schema: 2, id: randomUUID(), previousId: previous?.id || null, version: (previous?.version || 0) + 1,
      sourceDevice: local.device.deviceId, publishedAt: new Date().toISOString(), fields: FIELDS, fingerprint: local.fingerprint, notes: notes.entries };
    const commit = await this.git.create(metadata, local.raw, plan.authorityCommit);
    state.pending = { commit, publicationId: metadata.id, version: metadata.version, parent: plan.authorityCommit };
    await this.saveState(state);
    return this.retryLocked();
  }
  retryPublish() { return this.withLock(() => this.retryLocked()); }
  discardPending(publicationId) {
    return this.withLock(async () => {
      const state = await this.readState();
      if (!state.pending || state.pending.publicationId !== publicationId) fail('STALE_PLAN', '待推送版本已变化，请重新检查。');
      const head = await this.git.head();
      if (head === state.pending.commit) return this.retryLocked();
      await this.git.archivePending(state.pending.commit);
      state.discarded = [...(state.discarded || []), { ...state.pending, discardedAt: new Date().toISOString() }];
      state.pending = null; await this.saveState(state);
      return { status: 'discarded', message: '已放弃这次待推送记录；本机规则继续保留，可重新比较后发布。' };
    });
  }
  async retryLocked() {
    const state = await this.readState(), pending = state.pending;
    if (!pending) fail('NO_PENDING_PUBLICATION', '没有待推送发布。');
    const publication = await this.publication(pending.commit);
    if (publication.id !== pending.publicationId || publication.version !== pending.version || publication.parentCommit !== pending.parent) fail('INVALID_STATE', '待推送记录与发布对象不符，未推送。');
    const head = await this.git.head();
    if (head && head !== pending.commit && head !== pending.parent) {
      await this.git.receive(head);
      if (await this.git.isAncestor(pending.commit, head)) {
        await this.publication(head);
        await this.git.accept(head);
        state.received = { commit: head, checkedAt: new Date().toISOString() };
        state.baseline = (await this.publication(pending.commit)).fingerprint; state.pending = null; state.notesDraft = null; await this.saveState(state);
        return { status: 'published', version: pending.version, publicationId: pending.publicationId, message: '该发布已被远端接受；之后已有新版本，请重新比较。' };
      }
      fail('REMOTE_CHANGED', '远端已推进，请接收新版本并重新比较，不能覆盖。');
    }
    if (head === null && pending.parent !== null) fail('REMOTE_CHANGED', '远端发布历史已删除，不能推送旧待发布记录。');
    try { if (head !== pending.commit) await this.git.push(pending.commit); }
    catch (error) { return { status: 'pending', version: pending.version, message: error.message }; }
    await this.git.accept(pending.commit);
    state.received = { commit: pending.commit, checkedAt: new Date().toISOString() }; state.pending = null; state.blocked = null;
    state.baseline = (await this.publication(pending.commit)).fingerprint;
    state.notesDraft = null;
    await this.saveState(state);
    return { status: 'published', version: pending.version, publicationId: pending.publicationId };
  }
  apply(plan, options = {}) { return this.withLock(() => this.applyLocked(plan, options)); }
  async applyLocked(plan, { replaceLocal = false } = {}) {
    const { local, state } = await this.validatePlan(plan, 'apply');
    if (state.blocked) fail('AUTHORITY_BLOCKED', '已发现远端发布异常，请修复发布并重新检查更新后再应用。');
    const baseline = state.baseline || state.applied?.fingerprint;
    if (baseline && baseline !== local.fingerprint && !replaceLocal) fail('LOCAL_CHANGES', '本机有未发布修改，请明确选择是否使用权威版本。');
    if (!this.runtime) fail('RUNTIME_REQUIRED', '无法控制运行中的 FNS，请在工作台应用，或暂停 FNS 后使用独立程序。');
    const publication = await this.publication(plan.authorityCommit);
    return this.writeRules(plan, local, state, publication);
  }
  recover(operationId) {
    return this.withLock(async () => {
      if (!/^[a-f0-9-]{36}$/.test(operationId || '')) fail('INVALID_RECOVERY', '恢复记录标识无效。');
      const state = await this.readState(), local = await this.local();
      const directory = path.join(this.data, 'operations', operationId);
      if (state.recovery !== path.relative(this.vault, directory).split(path.sep).join('/')) fail('INVALID_RECOVERY', '只能恢复当前设备上次操作；请重新检查记录。');
      const receiptPath = await safePath(this.vault, path.join(directory, 'receipt.json'), { file: true });
      const operation = parseConfig(await fs.readFile(receiptPath, 'utf8'));
      if (operation.id !== operationId || operation.deviceId !== local.device.deviceId || !digest(operation.beforeHash)
          || operation.previousApplied !== null && !receipt(operation.previousApplied, local.device.deviceId)
          || operation.previousBaseline !== null && !digest(operation.previousBaseline)
          || operation.previousEnabled !== undefined && typeof operation.previousEnabled !== 'boolean') fail('INVALID_RECOVERY', '恢复记录与本机身份或原应用记录不符。');
      const interruptedBeforeWrite = ['prepared', 'pausing', 'paused', 'replacing'].includes(operation.phase) && operation.beforeHash === local.revision;
      if (operation.afterHash !== local.revision && !interruptedBeforeWrite) fail('RECOVERY_CONFLICT', '当前配置已变化；未覆盖，请核对恢复材料。');
      const backup = await safePath(this.vault, path.join(directory, 'before.json'), { file: true });
      const raw = await fs.readFile(backup, 'utf8');
      if (hash(raw) !== operation.beforeHash) fail('INVALID_RECOVERY', '恢复备份指纹不符，未采用。');
      const rules = normalize(parseConfig(raw));
      const plan = { action: 'apply', deviceId: local.device.deviceId, localRevision: local.revision, authorityCommit: state.received?.commit || null };
      const result = await this.writeRules(plan, local, state, { id: operation.previousApplied?.publicationId || null,
        version: operation.previousApplied?.version || null, rules, fingerprint: fingerprint(rules),
        restore: { applied: operation.previousApplied, baseline: operation.previousBaseline, enabled: operation.phase === 'complete' ? undefined : operation.previousEnabled } });
      return { ...result, status: result.status === 'applied' ? 'restored' : result.status,
        message: result.status === 'applied' ? '已恢复上次应用前的四组规则，并核验 FNS 加载。' : result.message };
    }, { recovering: operationId });
  }
  assertApplicable(local, publication) {
    validateScope(publication.rules, deviceDirectories(this.vault));
    // Preserve local installation and file protections when replacing shared rules.
    for (const directory of workbenchPaths(this.options.configDir, this.vault)) {
      let protectedLocally = false;
      try { validateScope(local.rules, [directory]); protectedLocally = true; } catch { /* Not yet configured here. */ }
      if (protectedLocally) validateScope(publication.rules, [directory]);
    }
  }
  async writeRules(plan, local, state, publication) {
    if (!this.runtime) fail('RUNTIME_REQUIRED', '本机写入需要可核验的 FNS 暂停与恢复入口。');
    this.assertApplicable(local, publication);
    const replacement = { ...local.config };
    for (const field of FIELDS) replacement[field] = JSON.stringify(publication.rules[field]);
    // Preserve byte representation of semantically unchanged fields.
    for (const field of FIELDS) if (JSON.stringify(local.rules[field]) === JSON.stringify(publication.rules[field])) replacement[field] = local.config[field];
    const recovery = path.join(this.data, 'operations', randomUUID());
    await this.checkStorage(['before.json', 'after.json', 'receipt.json', 'replacement.staging'].map(name => path.relative(this.vault, path.join(recovery, name)).split(path.sep).join('/')));
    await safePath(this.vault, recovery, { mkdir: true });
    await fs.writeFile(path.join(recovery, 'before.json'), local.raw, { flag: 'wx', mode: 0o600 });
    const receiptPath = path.join(recovery, 'receipt.json');
    const operation = { id: path.basename(recovery), deviceId: local.device.deviceId, publicationId: publication.id,
      beforeHash: local.revision, previousApplied: state.applied || null, previousBaseline: state.baseline || null,
      phase: 'prepared', kind: publication.restore ? 'recovery' : 'apply', createdAt: new Date().toISOString() };
    const saveOperation = () => atomicJSON(this.vault, receiptPath, operation);
    await saveOperation();
    state.recovery = path.relative(this.vault, recovery).split(path.sep).join('/'); await this.saveState(state);
    let previous, writeError, restoreError;
    try {
      operation.previousEnabled = (await this.runtime.inspect()).enabled; operation.phase = 'pausing'; await saveOperation();
      previous = await this.runtime.suspend();
      if (typeof publication.restore?.enabled === 'boolean') previous.enabled = publication.restore.enabled;
      operation.previousEnabled = previous.enabled; operation.phase = 'paused'; await saveOperation();
      await this.validatePlan(plan, 'apply');
      const after = local.fingerprint === publication.fingerprint ? local.raw : JSON.stringify(replacement, null, 2) + '\n';
      await fs.writeFile(path.join(recovery, 'after.json'), after, { flag: 'wx', mode: 0o600 });
      const staged = path.join(recovery, 'replacement.staging');
      await fs.writeFile(staged, after, { flag: 'wx', mode: 0o600 });
      await this.validatePlan(plan, 'apply');
      operation.phase = 'replacing'; operation.afterHash = hash(after); await saveOperation();
      await fs.rename(staged, local.filename);
      operation.phase = 'written'; operation.afterHash = hash(after); await saveOperation();
      state.applied = { deviceId: local.device.deviceId, publicationId: publication.id, version: publication.version,
        fingerprint: publication.fingerprint, loaded: false, appliedAt: new Date().toISOString() };
      state.baseline = publication.fingerprint;
      if (publication.restore) { state.applied = publication.restore.applied; state.baseline = publication.restore.baseline; }
      await this.saveState(state);
    } catch (error) { writeError = error; }
    finally { if (previous) { try { await this.runtime.restore(previous); } catch { restoreError = true; } } }
    if (writeError) {
      operation.error = writeError.code || 'WRITE_FAILED'; await saveOperation();
      writeError.recovery = state.recovery; throw writeError;
    }
    const result = await this.local(), runtime = await this.runtimeState(publication.rules);
    if (result.fingerprint !== publication.fingerprint) { operation.phase = 'verification-failed'; await saveOperation(); fail('VERIFY_FAILED', '写入后规则不匹配，请查看恢复记录。'); }
    operation.afterHash = result.revision;
    const loaded = !restoreError && runtime.loaded;
    if (state.applied) state.applied.loaded = loaded;
    operation.phase = loaded ? 'complete' : 'written'; await saveOperation();
    await this.saveState(state);
    return { status: loaded ? 'applied' : 'written', recovery: state.recovery,
      message: loaded ? '四组规则已写入，并已核验 FNS 加载。' : '四组规则已写入，但 FNS 尚未恢复或加载未通过核验。', warnings: runtime.warnings };
  }
}
module.exports = { FnsSyncService };
