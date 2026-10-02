"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const C = require("../js/domain/core.js");
const row = (props = {}) =>
  C.normalizeRecord({
    id: "a",
    amountCents: 1234,
    category: "餐饮",
    subcategory: "午餐",
    date: "2026-10-01",
    note: "",
    createdAt: 1000,
    updatedAt: 2000,
    ...props,
  });
test("amounts use integer cents, reject malformed, nonfinite, negative and excessive precision", () => {
  assert.equal(C.cents("0.29"), 29);
  assert.equal(C.cents("12.3"), 1230);
  assert.equal(C.cents("0", true), 0);
  for (const v of [
    "0",
    "-5",
    "12abc",
    "Infinity",
    "NaN",
    "1.234",
    "",
    "1e4",
    "1000000000",
  ])
    assert.throws(() => C.cents(v));
  assert.equal(C.sum([row({ amountCents: 10 }), row({ amountCents: 20 })]), 30);
});
test("calendar validation and ISO cross-year week boundaries", () => {
  assert.equal(C.validDate("2026-02-31"), false);
  assert.equal(C.validDate("2024-02-29"), true);
  assert.equal(C.validDate("2025-02-29"), false);
  assert.equal(C.weekKey("2021-01-01"), "2020-W53");
  assert.equal(C.weekKey("2024-12-30"), "2025-W01");
  assert.deepEqual(C.range("week", "2020-W53"), {
    start: "2020-12-28",
    end: "2021-01-03",
  });
  assert.deepEqual(C.previous("month", "2026-01"), {
    start: "2025-12-01",
    end: "2025-12-31",
  });
  assert.equal(C.range("month", "2024-02").end, "2024-02-29");
});
test("CSV round-trip preserves commas, quotation marks, multiline notes and Unicode", () => {
  const rows = [
    row({ note: '第一行,"咖啡"\r\n第二行\n第三行🍵' }),
    row({ id: "b", amountCents: 1 }),
  ];
  const text = C.toCSV(rows);
  assert.ok(text.startsWith("\uFEFF"));
  assert.ok(text.includes("\r\n"));
  assert.deepEqual(C.parseCSV(text).records, rows);
  assert.throws(() => C.parseCSV("id,amount\na,12"));
  assert.throws(() => C.csvRows('"unclosed'));
});
test("CSV rejects invalid dates/amounts/categories and handles duplicate IDs in a single file", () => {
  const text = C.toCSV([row(), row(), row({ id: "b" })]);
  assert.equal(C.parseCSV(text).duplicateCount, 1);
  assert.equal(C.parseCSV(text).records.length, 2);
  for (const bad of ["-5", "Infinity", "abc"])
    assert.equal(
      C.parseCSV(C.toCSV([row()]).replace("12.34", bad)).errors.length,
      1,
    );
  assert.equal(
    C.parseCSV(C.toCSV([row()]).replace("2026-10-01", "2026-02-31")).errors
      .length,
    1,
  );
  assert.equal(
    C.parseCSV(C.toCSV([row()]).replace("餐饮", "未知")).errors.length,
    1,
  );
});
test("import preview and merge never silently overwrite existing IDs", () => {
  const state = C.initialState();
  state.expenses = [row()];
  const newer = row({ amountCents: 999, updatedAt: 3000 });
  assert.equal(C.previewImport(state.expenses, [row()]).duplicates, 1);
  assert.equal(C.previewImport(state.expenses, [newer]).conflicts.length, 1);
  C.mergeCSV(state, [newer]);
  assert.equal(state.expenses[0].amountCents, 1234);
  C.mergeCSV(state, [newer], true);
  assert.equal(state.expenses[0].amountCents, 999);
  C.mergeCSV(state, [row()], true);
  assert.equal(state.expenses[0].amountCents, 999);
  C.mergeCSV(state, [row({ id: "b", subcategory: "早午餐" })]);
  assert.ok(state.subcategories.餐饮.includes("早午餐"));
});
test("complete backup round-trip and invalid schema/duplicate detection", () => {
  const state = C.initialState();
  state.expenses = [row()];
  state.budgetCents = 300000;
  state.subcategories.餐饮.push("早午餐");
  assert.deepEqual(C.readBackup(C.makeBackup(state)), state);
  assert.throws(() => C.readBackup('{"version":9}'));
  assert.throws(() => C.validateState({ ...state, expenses: [row(), row()] }));
  assert.throws(() => C.validateState({ ...state, budgetCents: -100 }));
});
test("per-user backups preserve provenance without changing account identity on import", () => {
  const state = C.initialState();
  state.expenses = [row()];
  const profile = { id: "user2", name: "user2", privateMetadata: "excluded" };
  const text = C.makeBackup(state, profile);
  const raw = JSON.parse(text);
  assert.equal(raw.version, 2);
  assert.deepEqual(raw.profile, { id: "user2", name: "user2" });
  assert.deepEqual(C.readBackupEnvelope(text), { state, profile: raw.profile });
  assert.deepEqual(C.readBackup(text), state);
  assert.equal(C.readBackupEnvelope(C.makeBackup(state)).profile, null);
  assert.throws(() => C.readBackup(JSON.stringify({ ...raw, profile: null })));
  assert.throws(() => C.readBackup("null"));
});
test("empty calendar buckets are zeros and annual / all-time totals agree", () => {
  const records = [
    row({ date: "2026-01-01", amountCents: 10 }),
    row({ id: "b", date: "2026-03-30", amountCents: 20 }),
  ];
  const buckets = C.buckets(records, "all", "", "month");
  assert.deepEqual(
    buckets.map((b) => b.value),
    [10, 0, 20],
  );
  assert.equal(C.buckets(records, "year", "2026").length, 12);
  assert.equal(
    C.buckets(records, "year", "2026").reduce((s, b) => s + b.value, 0),
    30,
  );
  assert.equal(C.breakdown(records)[0].value, 30);
  assert.equal(C.breakdown(records, "餐饮")[0].name, "午餐");
  assert.equal(C.buckets([], "month", "2024-02").length, 29);
});
test("trend contains fixed ranges, zero fills, cross-year periods", () => {
  assert.equal(C.trend([], "week", "2026-01-01").length, 8);
  assert.equal(C.trend([], "month", "2026-01-01").length, 12);
  const years = C.trend([row()], "year", "2026-10-01");
  assert.equal(years.length, 5);
  assert.equal(years[4].value, 1234);
  assert.equal(years[0].start, "2022-01-01");
});
test("drilled-down bar buckets preserve separate subcategories", () => {
  const records = [
    row({ subcategory: "早餐" }),
    row({ id: "b", subcategory: "午餐", amountCents: 20 }),
  ];
  const b = C.buckets(records, "month", "2026-10", "month", "餐饮")[0];
  assert.deepEqual(b.parts, { 早餐: 1234, 午餐: 20 });
  assert.equal(b.value, 1254);
});
test('backup validation rejects missing identity or invalid timestamps without inventing replacements', () => {
  const state = C.initialState();
  for (const props of [{id:''},{id:123},{updatedAt:'invalid'},{createdAt:0}]) assert.throws(() => C.validateState({...state, expenses:[{...row(),...props}]}));
});

test('AI records retain their category through CSV, JSON, import and report aggregation', () => {
  const records = [
    row({ category: 'AI', subcategory: '订阅', amountCents: 19900 }),
    row({ id: 'api', category: 'AI', subcategory: 'API 用量', amountCents: 3000 }),
  ];
  assert.deepEqual(C.parseCSV(C.toCSV(records)).records, records);
  const state = C.initialState();
  C.mergeCSV(state, [...records, row({ id: 'custom', category: 'AI', subcategory: 'ChatGPT', amountCents: 100 })]);
  assert.ok(state.subcategories.AI.includes('ChatGPT'));
  assert.deepEqual(C.readBackup(C.makeBackup(state, { id: 'user1', name: 'AI 账本' })), state);
  assert.deepEqual(C.breakdown(records).map(({ name, value }) => ({ name, value })), [{ name: 'AI', value: 22900 }]);
  assert.deepEqual(C.buckets(records, 'all', '', 'month', 'AI')[0].parts, { 订阅: 19900, 'API 用量': 3000 });
});

test('seven-category snapshots and both backup versions gain AI without changing legacy data', () => {
  const legacy = C.initialState();
  legacy.expenses = [row()]; legacy.budgetCents = 300000; legacy.revision = 42;
  legacy.subcategories.餐饮.push('旧自定义分类');
  delete legacy.subcategories.AI;
  const before = C.clone(legacy), upgraded = C.validateState(legacy);
  assert.deepEqual(legacy, before, 'validation must not mutate stored raw data');
  assert.deepEqual(upgraded, { ...legacy, subcategories: { ...legacy.subcategories, AI: C.SUBS.AI } });
  for (const version of [1, 2]) {
    const backup = { format: 'wallet-ios-pwa', version, data: legacy };
    if (version === 2) backup.profile = { id: 'user1', name: '旧账本' };
    assert.deepEqual(C.readBackup(JSON.stringify(backup)), upgraded);
  }
});

test('AI defaults never overwrite explicit custom or empty lists or conceal invalid data', () => {
  const state = C.initialState();
  state.subcategories.AI = [];
  assert.deepEqual(C.validateState(state).subcategories.AI, []);
  state.subcategories.AI = ['ChatGPT'];
  assert.deepEqual(C.validateState(state).subcategories.AI, ['ChatGPT']);
  for (const invalid of [undefined, null, '订阅', [''], ['订阅', '订阅']]) {
    assert.throws(() => C.validateState({ ...state, subcategories: { ...state.subcategories, AI: invalid } }));
  }
  delete state.subcategories.餐饮;
  assert.throws(() => C.validateState(state), 'other missing categories still indicate invalid data');
});
