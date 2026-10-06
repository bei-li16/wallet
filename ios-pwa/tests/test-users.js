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
function harness(session = new Map(), clock = null) {
  let ui, mounted;
  const states = new Map(), recoveries = new Map(), instances = [], downloads = [], blobs = new Map(), watchers = [];
  class TestURL extends URL {
    static createObjectURL(blob) { const url = 'blob:wallet-test-' + blobs.size; blobs.set(url, blob); return url; }
    static revokeObjectURL(url) { blobs.delete(url); }
  }
  const navigator = { onLine: true };
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
    WalletCore: C, WalletStore: Store, WalletIcon: {}, WalletChart: {}, URL: TestURL, Blob, File,
    Date: clock ? class extends Date {
      constructor(...args) { super(...(args.length ? args : [clock.now.getTime()])); }
      static now() { return clock.now.getTime(); }
    } : Date,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    sessionStorage: { getItem: (key) => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: (key) => session.delete(key) },
    location: { href: 'https://wallet.test/ios-pwa/', reload() {} }, navigator,
    matchMedia: () => ({ matches: false }),
    window: { scrollTo() {}, addEventListener() {} },
    document: { addEventListener() {}, body: { appendChild() {} },
      createElement: () => { const a = { click: () => downloads.push(a), remove() {} }; return a; } },
    Vue: {
      ref: (value) => ({ value }), computed: (fn) => ({ get value() { return fn(); } }),
      watch: (source, callback) => watchers.push({ source, callback }), nextTick: (fn) => fn?.(), onMounted: (fn) => mounted = fn,
      createApp: (options) => { ui = options.setup(); return { component() {}, mount() {} }; },
    },
  };
  vm.runInNewContext(source, context);
  return { ui, states, recoveries, instances, users, downloads, blobs, navigator, session, Store, watchers, mounted: () => mounted() };
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

test('AI entries and custom subcategories support CRUD independently for each user', async () => {
  const h = harness(), u = h.ui; await u.boot();
  assert.equal(u.categoryInfo('unknown').name, '其他');
  u.selectCategory('AI'); u.form.value.subcategory = '订阅';
  await save(u, '20', 'user1 AI');
  u.manageCategory.value = 'AI'; u.newSub.value = 'ChatGPT'; await u.addSub();
  const id = u.state.value.expenses[0].id;
  await choose(h, 'user2');
  assert.deepEqual(u.state.value.subcategories.AI, C.SUBS.AI);
  u.selectCategory('AI'); u.form.value.subcategory = 'API 用量';
  await save(u, '3', 'user2 API');
  const other = C.clone(h.states.get('user2'));
  await choose(h, 'user1');
  assert.ok(u.state.value.subcategories.AI.includes('ChatGPT'));
  await u.editExpense(u.state.value.expenses[0]); u.form.value.amount = '30'; await u.saveExpense();
  const deleting = u.remove([id]); u.answer(true); await deleting;
  assert.equal(u.state.value.expenses.length, 0);
  await u.toast.value.undo();
  assert.equal(u.state.value.expenses[0].amountCents, 3000);
  assert.equal(u.state.value.expenses[0].category, 'AI');
  assert.deepEqual(h.states.get('user2'), other);
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
  u.exportBackup(); u.beginCSVExport(); u.exportCSV();
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

test('CSV export supports all, single and multiple categories with exact per-user payloads and filenames', async () => {
  const clock = { now: new Date(2026, 9, 2, 11, 30, 45) }, h = harness(new Map(), clock), u = h.ui;
  await u.boot();
  const rows = [
    { id: 'ai', category: 'AI', subcategory: '订阅', amountCents: 19900, date: '2025-03-01' },
    { id: 'car', category: '交通', subcategory: '充电', amountCents: 3000, date: '2026-10-02' },
    { id: 'food', category: '餐饮', subcategory: '午餐', amountCents: 1000, date: '2026-10-01' },
  ].map((row) => C.normalizeRecord({ note: '合成,"备注"\n第二行', createdAt: 1000, updatedAt: 2000, ...row }));
  u.state.value.expenses = rows;
  u.filter.value = '娱乐'; u.filterSub.value = '不会匹配'; u.search.value = '不会匹配';
  u.period.value = 'month'; u.periodKey.value = '2026-10';
  const before = C.clone(u.state.value);
  const exported = async () => C.parseCSV(await h.blobs.get(h.downloads.at(-1).href).text()).records;
  u.beginCSVExport(); assert.equal(u.sheet.value, 'export'); u.exportCSV();
  assert.equal(h.downloads.at(-1).download, 'user1_全部_20261002_113045.csv');
  assert.deepEqual(await exported(), [rows[1], rows[2], rows[0]]);
  u.exportMode.value = 'selected'; u.exportCategories.value = ['AI']; u.exportCSV();
  assert.deepEqual(await exported(), [rows[0]]);
  assert.equal(h.downloads.at(-1).download, 'user1_AI_20261002_113045.csv');
  u.exportCategories.value = ['AI', '交通', 'AI']; u.exportCSV();
  assert.deepEqual(await exported(), [rows[1], rows[0]]);
  assert.equal(u.exportTotal.value, 22900);
  assert.equal(h.downloads.at(-1).download, 'user1_交通+AI_20261002_113045.csv');
  u.exportCategories.value = C.CATEGORIES.map((c) => c.name); u.exportCSV();
  assert.equal(h.downloads.at(-1).download, 'user1_全部_20261002_113045.csv');
  assert.deepEqual(u.state.value, before, 'exports must never mutate the ledger');
  await choose(h, 'user2');
  u.selectCategory('AI'); await save(u, '3', 'other user'); u.beginCSVExport(); u.exportCSV();
  assert.equal(h.downloads.at(-1).download, 'user2_全部_20261002_113045.csv');
  assert.equal((await exported()).length, 1); assert.equal((await exported())[0].note, 'other user');
});

test('CSV export blocks empty choices, stale or hidden panels and in-flight writes, but allows an empty category CSV', async () => {
  const h = harness(), u = h.ui; await u.boot();
  u.exportCSV(); assert.equal(h.downloads.length, 0);
  u.beginCSVExport(); u.exportMode.value = 'selected'; u.exportCategories.value = []; u.exportCSV();
  assert.equal(h.downloads.length, 0); assert.match(u.toast.value.message, /至少选择/);
  u.exportCategories.value = ['未知']; u.exportCSV(); assert.equal(h.downloads.length, 0);
  u.exportCategories.value = ['AI']; u.busy.value = true; u.exportCSV(); assert.equal(h.downloads.length, 0);
  u.busy.value = false; u.exportCSV();
  assert.equal(C.parseCSV(await h.blobs.get(h.downloads[0].href).text()).records.length, 0);
  u.closeSheet(); u.exportCSV(); assert.equal(h.downloads.length, 1);
  u.beginCSVExport(); u.exportMode.value = 'selected'; u.exportCategories.value = ['AI'];
  await choose(h, 'user2');
  assert.equal(u.exportCategories.value.length, 0); assert.equal(u.exportMode.value, 'all');
  u.exportCSV(); assert.equal(h.downloads.length, 1);
  u.beginCSVExport(); assert.equal(u.exportRows.value.length, 0);
});

test('JSON exports and sharing stay complete, filenames sanitize user names and use the click time across midnight', async () => {
  const clock = { now: new Date(2026, 9, 2, 23, 59, 58) }, h = harness(new Map(), clock), u = h.ui;
  await u.boot(); await save(u, '10', 'kept');
  u.state.value.budgetCents = 50000; u.state.value.subcategories.AI.push('ChatGPT');
  h.users[0].name = 'AI/私人:*账本'; await h.instances[0].onchange();
  u.beginCSVExport(); u.exportMode.value = 'selected'; u.exportCategories.value = ['AI'];
  assert.equal(u.exportName.value, 'AI_私人__账本_AI_20261002_235958.csv');
  clock.now = new Date(2026, 9, 3, 0, 0, 1);
  u.exportCSV(); assert.equal(h.downloads.at(-1).download, 'AI_私人__账本_AI_20261003_000001.csv');
  u.exportBackup(); assert.equal(h.downloads.at(-1).download, 'AI_私人__账本_全部_20261003_000001.json');
  const backup = C.readBackupEnvelope(await h.blobs.get(h.downloads.at(-1).href).text());
  assert.deepEqual(backup.state, u.state.value); assert.equal(backup.profile.name, 'AI/私人:*账本');
  let shared;
  h.navigator.canShare = () => true; h.navigator.share = async (data) => { shared = data; };
  await u.shareBackup();
  assert.equal(shared.files[0].name, 'AI_私人__账本_全部_20261003_000001.json');
  assert.deepEqual(C.readBackup(await shared.files[0].text()), u.state.value);
});

test('report arrows include empty periods, refresh totals and comparisons, and preserve category/type', async () => {
  const h=harness(), u=h.ui; await u.boot(); u.now.value='2026-10-03';
  u.state.value.expenses=[
    C.normalizeRecord({id:'sep',date:'2026-09-15',amountCents:1000,category:'交通',subcategory:'停车'}),
    C.normalizeRecord({id:'oct',date:'2026-10-01',amountCents:1500,category:'交通',subcategory:'停车'}),
    C.normalizeRecord({id:'other',date:'2026-10-01',amountCents:500,category:'AI',subcategory:'订阅'}),
  ];
  u.period.value='month'; u.periodKey.value='2026-10'; u.reportCategory.value='交通'; u.chartType.value='bar';
  const ledger=C.clone(u.state.value);
  assert.equal(u.reportTotal.value,1500); assert.match(u.comparison.value,/增加 50\.0%/);
  u.stepReport(-1); assert.equal(u.periodKey.value,'2026-09'); assert.equal(u.reportTotal.value,1000);
  assert.equal(u.reportCategory.value,'交通'); assert.equal(u.chartType.value,'bar');
  u.stepReport(-1); assert.equal(u.periodKey.value,'2026-08'); assert.equal(u.reportRows.value.length,0);
  assert.ok(u.periodOptions.value.includes('2026-08'));
  u.stepReport(1); u.stepReport(1); assert.equal(u.reportTotal.value,1500);
  u.stepReport(1); assert.equal(u.periodKey.value,'2026-11'); assert.ok(u.periodOptions.value.includes('2026-11'));
  assert.equal(u.reportTotal.value,0); assert.match(u.comparison.value,/减少 100\.0%/);
  u.period.value='week'; u.periodKey.value='2020-W53'; u.stepReport(1); assert.equal(u.periodKey.value,'2021-W01');
  u.period.value='year'; u.periodKey.value='2026'; u.stepReport(-1); assert.equal(u.periodKey.value,'2025');
  u.period.value='all'; const key=u.periodKey.value; u.stepReport(1);
  assert.equal(u.periodKey.value,key); assert.equal(u.reportPrevious.value,null); assert.equal(u.reportNext.value,null);
  assert.deepEqual(u.state.value,ledger);
});

test('trend window and annual navigation are independent, handle limits and reset per user', async () => {
  const h=harness(), u=h.ui; await u.boot(); u.now.value='2026-10-03';
  u.form.value.date=u.now.value; // Keep the blank form aligned with the fixture date so switching needs no draft confirmation.
  u.state.value.expenses=[
    C.normalizeRecord({id:'past',date:'2025-10-01',amountCents:1000,category:'交通',subcategory:'停车'}),
    C.normalizeRecord({id:'today',date:'2026-10-01',amountCents:2000,category:'AI',subcategory:'订阅'}),
  ];
  u.periodKey.value='2026-10'; u.trendType.value='month'; u.trendKey.value='2026-10'; u.annualYear.value='2026';
  assert.equal(u.trendTotal.value,2000); u.stepTrend(-1);
  assert.equal(u.trendKey.value,'2026-09'); assert.equal(u.trendRows.value.length,12);
  assert.equal(u.trendRows.value[0].start,'2025-10-01'); assert.equal(u.trendRows.value[11].start,'2026-09-01');
  assert.equal(u.trendTotal.value,1000); assert.equal(u.periodKey.value,'2026-10'); assert.equal(u.annualYear.value,'2026');
  u.stepAnnual(-1); assert.equal(u.annualYear.value,'2025'); assert.equal(C.sum(u.annualRows.value),1000);
  u.stepAnnual(-1); assert.ok(u.annualYears.value.includes('2024')); assert.equal(u.annualRows.value.length,0);
  u.annualYear.value='1900'; assert.equal(u.annualPrevious.value,null); u.stepAnnual(-1); assert.equal(u.annualYear.value,'1900');
  u.annualYear.value='2199'; assert.equal(u.annualNext.value,null); u.stepAnnual(1); assert.equal(u.annualYear.value,'2199');
  u.trendType.value='week'; u.trendKey.value='2020-W53'; u.stepTrend(1);
  assert.equal(u.trendKey.value,'2021-W01'); assert.equal(u.trendRows.value.length,8);
  u.trendType.value='year'; u.trendKey.value='2026'; u.stepTrend(-1);
  assert.equal(u.trendKey.value,'2025'); assert.equal(u.trendRows.value.length,5);
  await choose(h,'user2'); assert.equal(u.trendType.value,'month'); assert.equal(u.trendKey.value,'2026-10');
  assert.equal(u.periodKey.value,'2026-10'); assert.equal(u.annualYear.value,'2026'); assert.equal(u.trendTotal.value,0);
  assert.ok(!u.trendOptions.value.includes('2025-10')); assert.ok(!u.annualYears.value.includes('2025'));
});

test('period type watchers reset anchors and current trend follows rollover without moving historical views', async () => {
  const h=harness(), u=h.ui; await u.boot(); u.now.value='2026-10-03';
  const changed=(ref,...args)=>h.watchers.find(w=>w.source===ref).callback(...args);
  u.period.value='week'; changed(u.period,'week');
  assert.equal(u.periodKey.value,C.keyFor('week',u.now.value));
  u.trendType.value='year'; changed(u.trendType,'year'); assert.equal(u.trendKey.value,'2026');
  u.trendType.value='month'; changed(u.trendType,'month'); assert.equal(u.trendKey.value,'2026-10');
  u.now.value='2026-11-01'; changed(u.now,'2026-11-01','2026-10-31'); assert.equal(u.trendKey.value,'2026-11');
  u.stepTrend(-1); changed(u.now,'2026-12-01','2026-11-30'); assert.equal(u.trendKey.value,'2026-10');
});

test('pie/bar/curve report totals match for all periods and every main category, without changing the ledger', async () => {
  const h=harness(), u=h.ui; await u.boot(); u.now.value='2026-10-06';
  u.state.value.expenses=[
    C.normalizeRecord({id:'past',date:'2025-10-01',amountCents:725,category:'交通',subcategory:'停车'}),
    ...C.CATEGORIES.map((c,i)=>C.normalizeRecord({id:'category-'+i,date:'2026-10-05',amountCents:10001+i,category:c.name,subcategory:c.name==='AI'?'订阅':'测试子类'})),
    C.normalizeRecord({id:'ai-api',date:'2026-10-06',amountCents:308,category:'AI',subcategory:'API 用量'}),
  ];
  const ledger=C.clone(u.state.value);
  for(const period of ['week','month','year','all']){
    u.period.value=period; u.periodKey.value=C.keyFor(period==='all'?'month':period,u.now.value);
    for(const granularity of period==='all'?['month','year']:['month']){
      u.granularity.value=granularity;
      for(const category of ['',...C.CATEGORIES.map(c=>c.name)]){
        u.reportCategory.value=category;
        const expected=C.sum(ledger.expenses.filter(e=>(period==='all'||e.date>=C.range(period,u.periodKey.value).start&&e.date<=C.range(period,u.periodKey.value).end)&&(!category||e.category===category)));
        for(const kind of ['pie','bar','line']){
          u.chartType.value=kind;
          assert.equal(u.reportTotal.value,expected,`${period}/${granularity}/${category||'all'}/${kind}`);
          assert.equal(u.reportGroups.value.reduce((sum,g)=>sum+g.value,0),expected);
          assert.equal(u.reportBuckets.value.reduce((sum,r)=>sum+r.value,0),expected);
          for(const row of u.reportBuckets.value) assert.equal(Object.values(row.parts).reduce((a,b)=>a+b,0),row.value);
        }
      }
    }
  }
  assert.deepEqual(u.state.value,ledger);
});

test('curve category selection, all-time grouping, arrows and user reset stay consistent', async () => {
  const h=harness(), u=h.ui; await u.boot(); u.now.value='2026-10-06';
  u.form.value.date=u.now.value;
  u.state.value.expenses=[
    C.normalizeRecord({id:'old-ai',date:'2025-10-01',amountCents:1000,category:'AI',subcategory:'订阅'}),
    C.normalizeRecord({id:'new-ai',date:'2026-10-05',amountCents:2000,category:'AI',subcategory:'订阅'}),
    C.normalizeRecord({id:'car',date:'2026-10-05',amountCents:725,category:'交通',subcategory:'停车'}),
  ];
  const ledger=C.clone(u.state.value);
  u.period.value='all'; u.chartType.value='line'; u.reportCategory.value='AI'; u.granularity.value='month';
  h.states.set('user1',C.clone(ledger));
  assert.equal(u.reportBuckets.value.length,13); assert.equal(u.reportBuckets.value[1].value,0);
  u.granularity.value='year'; assert.equal(u.reportBuckets.value.length,2);
  assert.deepEqual(Array.from(u.reportBuckets.value,r=>r.value),[1000,2000]);
  u.reportCategory.value=''; assert.equal(u.reportTotal.value,3725);
  u.drill('交通'); assert.equal(u.reportCategory.value,'交通'); assert.equal(u.reportTotal.value,725);
  assert.equal(u.chartType.value,'line'); assert.equal(u.granularity.value,'year');
  u.period.value='month'; u.periodKey.value='2026-10'; u.reportCategory.value='AI';
  u.stepReport(-1); assert.equal(u.reportRows.value.length,0); assert.equal(u.reportTotal.value,0);
  assert.equal(u.chartType.value,'line'); assert.equal(u.reportCategory.value,'AI');
  u.stepReport(1); assert.equal(u.reportTotal.value,2000); assert.match(u.comparison.value,/上期无支出/);
  u.reportCategory.value='医疗'; assert.equal(u.reportRows.value.length,0);
  assert.deepEqual(u.state.value,ledger);
  await choose(h,'user2'); assert.equal(u.reportCategory.value,''); assert.equal(u.chartType.value,'pie');
  u.chartType.value='line'; u.period.value='all'; assert.equal(u.reportTotal.value,0);
  assert.equal(u.reportGroups.value.length,0); assert.ok(u.reportBuckets.value.every(r=>r.value===0));
  await choose(h,'user1'); assert.deepEqual(u.state.value,ledger);
});

test('actual Vue report controls select curves/categories and expose both all-time granularities', async () => {
  const h=harness(), u=h.ui; await u.boot(); u.tab.value='report'; u.period.value='all';
  u.state.value.expenses=[
    C.normalizeRecord({id:'ai',date:'2026-10-05',amountCents:19900,category:'AI',subcategory:'订阅'}),
    C.normalizeRecord({id:'car',date:'2025-10-05',amountCents:725,category:'交通',subcategory:'停车'}),
  ];
  const decode=text=>text.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const context={console,document:{createElement:()=>{let html;return {
    set innerHTML(value){html=value;},get textContent(){return decode(html);},
    get children(){return [{getAttribute:()=>decode(html.slice(10,-2))}];},
  };}}};
  context.Function=function(...args){return vm.runInContext('(function('+args.slice(0,-1).join(',')+') {'+args.at(-1)+'\n})',context);};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/vendor/vue.global.prod.js'),'utf8'),context);
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const start=html.lastIndexOf('<section',html.indexOf('aria-labelledby="report-title"'));
  const render=context.Vue.compile(html.slice(start,html.indexOf('</section>',start)+10));
  const state=new Proxy(u,{
    get(target,key){const value=target[key];return value&&typeof value==='object'&&'value' in value?value.value:value;},
    set(target,key,value){if(target[key]&&typeof target[key]==='object'&&'value' in target[key])target[key].value=value;else target[key]=value;return true;},
  });
  const flatten=(node)=>[node,...(Array.isArray(node.children)?node.children.flatMap(child=>child&&typeof child==='object'?flatten(child):[]):[])];
  const nodes=()=>flatten(render(state,[]));
  const control=(label)=>nodes().find(n=>n.props?.['aria-label']===label);
  control('曲线图').props.onClick(); assert.equal(u.chartType.value,'line');
  assert.equal(control('曲线图').props['aria-pressed'],true);
  const selector=control('选择报表大分类');
  const options=flatten(selector).filter(n=>n.type==='option');
  assert.deepEqual(Array.from(options,n=>n.props.value),['',...C.CATEGORIES.map(c=>c.name)]);
  selector.props['onUpdate:modelValue']('AI'); assert.equal(u.reportTotal.value,19900);
  const chart=()=>nodes().find(n=>n.type==='wallet-chart');
  assert.equal(chart().props.kind,'line'); assert.equal(chart().props.groups[0].name,'订阅');
  assert.equal(chart().props.rows.length,1); assert.match(chart().props.label,/AI支出曲线/);
  const chips=nodes().find(n=>n.props?.class==='chips centered-chips');
  const buttons=flatten(chips).filter(n=>n.type==='button');
  assert.equal(buttons.length,2); buttons[1].props.onClick(); assert.equal(u.granularity.value,'year');
  control('选择报表大分类').props['onUpdate:modelValue']('');
  assert.equal(chart().props.rows.length,2); assert.equal(u.reportTotal.value,20625);
  for(const label of ['饼图','柱状图','曲线图']){
    control(label).props.onClick(); assert.equal(control(label).props['aria-pressed'],true);
    assert.equal(nodes().some(n=>n.props?.class==='chips centered-chips'),label!=='饼图');
  }
});
