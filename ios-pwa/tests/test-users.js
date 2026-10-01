/* Exercise the actual Vue setup functions with controllable async storage/file I/O.
   Real IndexedDB migration/transactions are covered by storage.html. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../js/domain/core.js');
const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise((r) => resolve = r); return { promise, resolve }; };
function harness(session = new Map()) {
  let ui, mounted;
  const states = new Map(), recoveries = new Map(), instances = [], downloads = [];
  const users = [{ id: 'user1', name: 'user1' }, { id: 'user2', name: 'user2' }];
  class Store {
    constructor(name, profileId = 'user1') { this.profileId = profileId; instances.push(this); }
    async open() { return this; }
    close() {}
    async profiles() { return C.clone(users); }
    async createProfile(name) { const p = { id: C.newId(), name }; users.push(p); return p; }
    async renameProfile(id, name) {
      name = name.trim();
      const p = users.find((p) => p.id === id);
      if (!p) throw new Error('用户不存在');
      if (!name || name.length > 24) throw new Error('用户名为 1–24 个字符');
      if (users.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) throw new Error('这个用户名已经存在');
      p.name = name; return C.clone(p);
    }
    async deleteProfile(id) {
      const index = users.findIndex((p) => p.id === id);
      if (index < 0) throw new Error('用户不存在');
      if (users.length <= 1) throw new Error('至少保留一个用户');
      users.splice(index, 1); states.delete(id); recoveries.delete(id);
      return C.clone(users);
    }
    async load() { return C.clone(states.get(this.profileId) || C.initialState()); }
    async recovery() { return C.clone(recoveries.get(this.profileId) || null); }
    async mutate(fn, saveRecovery) {
      if (this.pending) await this.pending.promise;
      if (!users.some((p) => p.id === this.profileId)) throw new Error('用户不存在');
      const current = await this.load(), next = C.clone(current);
      const result = fn(next);
      C.validateState(next); next.revision = current.revision + 1;
      if (saveRecovery) recoveries.set(this.profileId, current);
      states.set(this.profileId, next);
      return { state: C.clone(next), result };
    }
  }
  const context = {
    WalletCore: C, WalletStore: Store, WalletIcon: {}, WalletChart: {}, URL, Blob,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    sessionStorage: { getItem: (key) => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: (key) => session.delete(key) },
    location: { href: 'https://wallet.test/ios-pwa/', reload() {} }, navigator: { onLine: true },
    matchMedia: () => ({ matches: false }),
    window: { scrollTo() {}, addEventListener() {} },
    document: { addEventListener() {}, body: { appendChild() {} },
      createElement: () => { const a = { click: () => downloads.push(a), remove() {} }; return a; } },
    Vue: {
      ref: (value) => ({ value }), computed: (fn) => ({ get value() { return fn(); } }),
      watch() {}, nextTick: (fn) => fn?.(), onMounted: (fn) => mounted = fn,
      createApp: (options) => { ui = options.setup(); return { component() {}, mount() {} }; },
    },
  };
  vm.runInNewContext(source, context);
  return { ui, states, recoveries, instances, users, downloads, session, Store, mounted: () => mounted() };
}
async function save(ui, amount, note) {
  ui.form.value.amount = amount; ui.form.value.note = note;
  await ui.saveExpense();
}
async function choose(h, id) { await h.ui.switchProfile(h.users.find((p) => p.id === id)); }
function input(h) { h.ui.importInput.value = { value: '', click() {} }; h.ui.beginImport(); }

test('CRUD, budget, subcategories, and same IDs stay with their active user', async () => {
  const h = harness(), u = h.ui; await u.boot();
  await save(u, '12.34', 'user1 record');
  u.budgetInput.value = '100'; await u.saveBudget();
  u.newSub.value = 'user1 special'; await u.addSub();
  const original = C.clone(u.state.value), id = original.expenses[0].id;
  await choose(h, 'user2');
  assert.equal(u.state.value.expenses.length, 0);
  assert.equal(u.state.value.budgetCents, 0);
  assert.ok(!u.state.value.subcategories.餐饮.includes('user1 special'));
  await save(u, '99.01', 'user2 record');
  h.states.get('user2').expenses[0].id = id;
  await choose(h, 'user1');
  await u.editExpense(u.state.value.expenses[0]); u.form.value.amount = '15.67'; await u.saveExpense();
  const deleting = u.remove([id]); u.answer(true); await deleting;
  assert.equal(u.state.value.expenses.length, 0);
  assert.equal(h.states.get('user2').expenses[0].amountCents, 9901);
  await u.toast.value.undo();
  assert.equal(u.state.value.expenses[0].amountCents, 1567);
  assert.equal(h.states.get('user2').expenses[0].note, 'user2 record');
});

test('renaming keeps user identity and all ledger data, and rejects duplicate names', async () => {
  const h = harness(), u = h.ui; await u.boot(); await save(u, '15', 'kept');
  const before = C.clone(u.state.value);
  u.editProfile(h.users[0]); u.profileNameInput.value = '用车记录'; await u.saveProfileName();
  assert.equal(u.activeProfile.value.id, 'user1'); assert.equal(u.activeProfile.value.name, '用车记录');
  assert.deepEqual(u.state.value, before); assert.deepEqual(h.states.get('user1'), before);
  u.exportBackup(); assert.match(h.downloads[0].download, /用车记录/);
  u.editProfile(h.users[0]); u.profileNameInput.value = 'USER2'; await u.saveProfileName();
  assert.equal(u.activeProfile.value.name, '用车记录'); assert.match(u.toast.value.message, /已经存在/);
  assert.equal(u.sheet.value, 'profile-edit');
});

test('deleting another user requires confirmation, removes its recovery and keeps current ledger', async () => {
  const h = harness(), u = h.ui; await u.boot(); await save(u, '15', 'keep');
  const before = C.clone(u.state.value);
  h.states.set('user2', { ...C.initialState(), expenses: [C.normalizeRecord({ id:'two', amountCents:200, category:'交通', date:C.today() })] });
  h.recoveries.set('user2', C.initialState());
  let removing = u.removeProfile(h.users[1]); await tick();
  assert.match(u.confirm.value.body, /1 笔账目/); u.answer(false); await removing;
  assert.ok(h.states.has('user2')); assert.equal(h.users.length, 2);
  removing = u.removeProfile(h.users[1]); await tick(); u.answer(true); await removing;
  assert.equal(h.users.length, 1); assert.ok(!h.states.has('user2')); assert.ok(!h.recoveries.has('user2'));
  assert.deepEqual(u.state.value, before); assert.equal(u.activeProfile.value.id, 'user1');
  await u.removeProfile(h.users[0]); assert.equal(u.confirm.value, null); assert.match(u.toast.value.message, /至少保留/);
});

test('deleting the active user clears its pending drafts and switches to an intact survivor', async () => {
  const h = harness(), u = h.ui; await u.boot(); await save(u, '15', 'gone');
  h.states.set('user2', { ...C.initialState(), budgetCents:50000 });
  h.session.set('wallet-ios-pwa:/ios-pwa/:draft:user1', 'old');
  u.form.value.note = 'unsaved'; u.search.value = 'old'; u.selected.value = ['old'];
  const removing = u.removeProfile(h.users[0]); await tick();
  assert.match(u.confirm.value.body, /未保存/); u.answer(true); await removing;
  assert.equal(u.activeProfile.value.id, 'user2'); assert.equal(u.state.value.budgetCents, 50000);
  assert.equal(u.form.value.note, ''); assert.equal(u.search.value, ''); assert.equal(u.selected.value.length, 0);
  assert.ok(!h.states.has('user1')); assert.ok(!h.session.has('wallet-ios-pwa:/ios-pwa/:draft:user1'));
  assert.equal(h.session.get('wallet-ios-pwa:/ios-pwa/:active-user'), 'user2');
});

test('other-window rename refreshes the name and deletion revokes a pending confirmation and old file read', async () => {
  const h = harness(), u = h.ui; await u.boot(); await save(u, '15', 'gone');
  const first = h.instances[0]; h.users[0].name = '新名字'; await first.onchange();
  assert.equal(u.activeProfile.value.name, '新名字');
  input(h); const file = deferred();
  const reading = u.readImport({target:{value:'selected',files:[{name:'old.json',size:10,text:()=>file.promise}]}});
  u.form.value.note = 'old draft';
  const switching = choose(h, 'user2'); assert.ok(u.confirm.value);
  h.users.shift(); h.states.delete('user1'); await first.onchange();
  file.resolve(C.makeBackup(C.initialState())); await Promise.all([switching, reading]);
  assert.equal(u.activeProfile.value.id, 'user2'); assert.equal(u.form.value.note, '');
  assert.equal(u.confirm.value, null); assert.equal(u.importData.value, null);
});

test('switching clears old undo, selection, filters, imports and cancelled drafts cannot switch', async () => {
  const h = harness(), u = h.ui; await u.boot(); await save(u, '10', 'one');
  const deletion = u.remove([u.state.value.expenses[0].id]); u.answer(true); await deletion;
  const oldUndo = u.toast.value.undo;
  u.selected.value = ['old']; u.search.value = 'old'; u.importData.value = { type: 'csv' };
  u.form.value.note = 'unsaved';
  let switching = choose(h, 'user2'); u.answer(false); await switching;
  assert.equal(u.activeProfile.value.id, 'user1'); assert.equal(u.form.value.note, 'unsaved');
  switching = choose(h, 'user2'); u.answer(true); await switching;
  assert.equal(u.form.value.note, ''); assert.equal(u.selected.value.length, 0);
  assert.equal(u.search.value, ''); assert.equal(u.importData.value, null);
  await oldUndo();
  assert.equal(u.state.value.expenses.length, 0);
  await choose(h, 'user1'); await oldUndo();
  assert.equal(u.state.value.expenses.length, 0, 'switching back cannot resurrect a stale undo');
});

test('an in-flight file read cannot open a preview after switching away and back', async () => {
  const h = harness(), u = h.ui; await u.boot(); input(h);
  const file = deferred();
  const reading = u.readImport({ target: { files: [{ name: 'backup.json', size: 12, text: () => file.promise }], value: 'selected' } });
  await choose(h, 'user2'); await choose(h, 'user1');
  file.resolve(C.makeBackup(C.initialState())); await reading;
  assert.equal(u.importData.value, null); assert.equal(u.sheet.value, '');
});

test('CSV / JSON imports and recovery affect only the explicitly selected user', async () => {
  const h = harness(), u = h.ui; await u.boot(); await save(u, '10', 'one');
  const user1 = C.clone(u.state.value);
  await choose(h, 'user2'); await save(u, '20', 'two');
  input(h);
  await u.readImport({ target: { value: '', files: [{ name: 'one.csv', size: 100, text: async () => C.toCSV(user1.expenses) }] } });
  await u.applyImport();
  assert.equal(u.state.value.expenses.length, 2); assert.equal(h.states.get('user1').expenses.length, 1);
  const restore = u.restoreRecovery(); await tick(); u.answer(true); await restore;
  assert.equal(u.state.value.expenses.length, 1); assert.equal(u.state.value.expenses[0].note, 'two');
  input(h);
  await u.readImport({ target: { value: '', files: [{ name: 'one.json', size: 100, text: async () => C.makeBackup(user1, h.users[0]) }] } });
  assert.equal(u.importData.value.profile.name, 'user1');
  const importing = u.applyImport(); assert.match(u.confirm.value.title, /user2/); u.answer(true); await importing;
  assert.equal(u.activeProfile.value.id, 'user2'); assert.equal(u.state.value.expenses[0].note, 'one');
  assert.deepEqual(h.states.get('user1'), user1);
  assert.equal(h.recoveries.get('user2').expenses[0].note, 'two');
});

test('old refresh and recovery responses cannot overwrite another user or open a confirmation', async () => {
  const h = harness(), u = h.ui; await u.boot(); await save(u, '10', 'one');
  const first = h.instances[0], stale = C.clone(u.state.value), loading = deferred(), recovering = deferred();
  first.load = () => loading.promise; first.recovery = () => recovering.promise;
  const refresh = first.onchange(), restore = u.restoreRecovery();
  await choose(h, 'user2');
  loading.resolve(stale); recovering.resolve(stale); await Promise.all([refresh, restore]);
  assert.equal(u.state.value.expenses.length, 0); assert.equal(u.confirm.value, null);
});

test('switching is locked during a write and a failed switch keeps the original user intact', async () => {
  const h = harness(), u = h.ui; await u.boot();
  const pending = deferred(); h.instances[0].pending = pending;
  const saving = save(u, '3', 'pending');
  await choose(h, 'user2'); assert.equal(u.activeProfile.value.id, 'user1');
  pending.resolve(); await saving; assert.equal(h.states.get('user1').expenses.length, 1);
  await u.switchProfile({ id: 'missing', name: 'missing' });
  assert.equal(u.activeProfile.value.id, 'user1'); assert.equal(u.state.value.expenses.length, 1);
});

test('pending user switch cannot open an old-record editor or replace its confirmation', async () => {
  const h = harness(), u = h.ui; await u.boot(); await save(u, '10', 'one');
  const row = C.clone(u.state.value.expenses[0]), opening = deferred();
  h.Store.prototype.open = async function () { if (this.profileId === 'user2') await opening.promise; return this; };
  u.form.value.note = 'discarded draft';
  const switching = choose(h, 'user2'); u.answer(true); await tick();
  assert.equal(u.busy.value, true);
  await u.editExpense(row); await u.cancelEdit(); await u.remove([row.id]);
  assert.equal(u.confirm.value, null); assert.equal(u.editing.value, null);
  opening.resolve(); await switching;
  assert.equal(u.activeProfile.value.id, 'user2'); assert.equal(u.form.value.note, '');
  assert.equal(h.states.get('user1').expenses.length, 1);
});

test('update drafts and current user survive reload per tab; exports identify only that user', async () => {
  const h = harness(), u = h.ui; await u.boot(); await choose(h, 'user2');
  await save(u, '42', 'two');
  u.exportBackup(); u.exportCSV();
  assert.match(h.downloads[0].download, /user2.*\.json$/);
  assert.match(h.downloads[1].download, /user2.*\.csv$/);
  u.form.value.amount = '7.89';
  const update = u.updateApp(); u.answer(true); await update;
  const draft = JSON.parse(h.session.get('wallet-ios-pwa:/ios-pwa/:draft:user2'));
  assert.equal(draft.profileId, 'user2'); assert.equal(draft.form.amount, '7.89');
  const reloaded = harness(h.session); await reloaded.mounted();
  assert.equal(reloaded.ui.activeProfile.value.id, 'user2');
  assert.equal(reloaded.ui.form.value.amount, '7.89');
  const otherTab = harness(); await otherTab.ui.boot();
  assert.equal(otherTab.ui.activeProfile.value.id, 'user1');
});
