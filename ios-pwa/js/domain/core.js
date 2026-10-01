/* Pure domain functions. Amounts are integer cents; calendar arithmetic uses UTC. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WalletCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const CATEGORIES = [
    { name: "餐饮", icon: "food", color: "#f09945" },
    { name: "交通", icon: "bus", color: "#5596ed" },
    { name: "购物", icon: "bag", color: "#dc7ba6" },
    { name: "居住", icon: "home", color: "#9b85d7" },
    { name: "娱乐", icon: "game", color: "#51b7a1" },
    { name: "医疗", icon: "heart", color: "#e97a7b" },
    { name: "其他", icon: "grid", color: "#8b97a7" },
  ];
  const SUBS = {
    餐饮: ["早餐", "午餐", "晚餐", "零食", "饮料"],
    交通: ["打车", "公交", "地铁", "加油", "保险", "停车"],
    购物: ["日用品", "网购", "服饰", "数码"],
    居住: ["房租", "水电", "物业", "装修"],
    娱乐: ["电影", "游戏", "旅游", "运动"],
    医疗: ["门诊", "买药", "体检"],
    其他: ["礼品", "捐赠", "其它"],
  };
  const HEADERS = [
    "id",
    "amount",
    "category",
    "subcategory",
    "date",
    "note",
    "createdAt",
    "updatedAt",
  ];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const pad = (v) => String(v).padStart(2, "0");
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function validDate(s) {
    if (
      typeof s !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
      s < "1900-01-01" ||
      s > "2199-12-31"
    )
      return false;
    const d = new Date(s + "T00:00:00Z");
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
  }
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) =>
    iso(new Date(Date.parse(s + "T00:00:00Z") + n * 86400000));
  function shiftMonth(s, n) {
    const d = new Date(s.slice(0, 7) + "-01T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + n);
    return iso(d);
  }
  function monday(s) {
    const day = new Date(s + "T00:00:00Z").getUTCDay();
    return addDays(s, -(day || 7) + 1);
  }
  function weekKey(s) {
    const thursday = addDays(monday(s), 3),
      year = thursday.slice(0, 4);
    return `${year}-W${pad(Math.round((Date.parse(monday(s)) - Date.parse(monday(year + "-01-04"))) / 604800000) + 1)}`;
  }
  function weekStart(key) {
    return addDays(
      monday(key.slice(0, 4) + "-01-04"),
      (Number(key.slice(6)) - 1) * 7,
    );
  }
  function keyFor(type, date) {
    return type === "week"
      ? weekKey(date)
      : type === "year"
        ? date.slice(0, 4)
        : date.slice(0, 7);
  }
  function range(type, key, now = today()) {
    key = key || keyFor(type, now);
    if (type === "all") return { start: "1900-01-01", end: "2199-12-31" };
    if (type === "week") {
      const start = weekStart(key);
      return { start, end: addDays(start, 6) };
    }
    if (type === "year") return { start: key + "-01-01", end: key + "-12-31" };
    const start = key + "-01";
    return { start, end: addDays(shiftMonth(start, 1), -1) };
  }
  function previous(type, key) {
    if (type === "all") return null;
    const r = range(type, key);
    return range(type, keyFor(type, addDays(r.start, -1)));
  }
  function periodLabel(type, key) {
    if (type === "year") return `${key}年`;
    if (type === "month")
      return `${key.slice(0, 4)}年${Number(key.slice(5))}月`;
    const start = weekStart(key),
      end = addDays(start, 6);
    return `${start.slice(0, 4)} · ${Number(start.slice(5, 7))}/${Number(start.slice(8))}–${Number(end.slice(5, 7))}/${Number(end.slice(8))}`;
  }
  function periods(records, type, now = today()) {
    return [
      ...new Set([
        keyFor(type, now),
        ...records.map((e) => keyFor(type, e.date)),
      ]),
    ]
      .sort()
      .reverse();
  }
  function cents(value, allowZero = false) {
    const s = String(value).trim();
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(s))
      throw new Error("请输入有效金额，最多两位小数");
    const [a, b = ""] = s.split("."),
      n = Number(a) * 100 + Number(b.padEnd(2, "0"));
    if (!Number.isSafeInteger(n) || (!allowZero && n <= 0))
      throw new Error("金额需要大于 0");
    return n;
  }
  const money = (value) =>
    (value / 100).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  function newId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  function textField(value, max, label) {
    if (typeof value !== "string" || value.length > max)
      throw new Error(`${label}格式不正确`);
    return value;
  }
  function normalizeRecord(raw, legacy = false) {
    if (!raw || typeof raw !== "object") throw new Error("记录格式不正确");
    const amountCents = legacy ? cents(raw.amount) : raw.amountCents;
    if (
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > 99999999999
    )
      throw new Error("金额超出范围");
    if (!validDate(raw.date))
      throw new Error("日期无效，请使用 1900–2199 年的真实日期");
    const category = textField(raw.category, 40, "分类");
    if (!CATEGORIES.some((c) => c.name === category))
      throw new Error(`不支持的分类：${category}`);
    const now = Date.now();
    const stamp = (v) => {
      const n = Number(v);
      return Number.isSafeInteger(n) && n > 0 && n <= 8640000000000000
        ? n
        : now;
    };
    const id = raw.id ? textField(raw.id, 160, "记录 ID") : newId();
    return {
      id,
      amountCents,
      category,
      subcategory: textField(raw.subcategory || "", 40, "子分类"),
      date: raw.date,
      note: textField(raw.note || "", 2000, "备注"),
      createdAt: stamp(raw.createdAt),
      updatedAt: stamp(raw.updatedAt),
    };
  }
  function initialState() {
    return {
      version: 1,
      revision: 0,
      expenses: [],
      subcategories: clone(SUBS),
      budgetCents: 0,
    };
  }
  function validateState(raw) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.expenses))
      throw new Error("不支持的备份或数据版本");
    if (
      !Number.isSafeInteger(raw.budgetCents) ||
      raw.budgetCents < 0 ||
      raw.budgetCents > 99999999999
    )
      throw new Error("预算数据无效");
    const state = initialState(),
      ids = new Set();
    state.budgetCents = raw.budgetCents;
    state.revision = Number.isSafeInteger(raw.revision) ? raw.revision : 0;
    for (const c of CATEGORIES) {
      const subs = raw.subcategories && raw.subcategories[c.name];
      if (
        !Array.isArray(subs) ||
        subs.some((s) => typeof s !== "string" || !s.trim() || s.length > 40) ||
        new Set(subs).size !== subs.length
      )
        throw new Error("子分类数据无效");
      state.subcategories[c.name] = [...subs];
    }
    state.expenses = raw.expenses.map((e) => {
      if (!e || typeof e.id !== 'string' || !e.id || ![e.createdAt, e.updatedAt].every(t => Number.isSafeInteger(t) && t > 0 && t <= 8640000000000000)) throw new Error('账目 ID 或时间戳无效');
      const row = normalizeRecord(e);
      if (ids.has(row.id)) throw new Error("备份中存在重复记录 ID");
      ids.add(row.id);
      return row;
    });
    sum(state.expenses);
    reconcileSubs(state);
    return state;
  }
  function reconcileSubs(state) {
    for (const e of state.expenses)
      if (
        e.subcategory &&
        !state.subcategories[e.category].includes(e.subcategory)
      )
        state.subcategories[e.category].push(e.subcategory);
  }
  const within = (records, r) =>
    r ? records.filter((e) => e.date >= r.start && e.date <= r.end) : [];
  function sum(records) {
    const n = records.reduce((v, e) => v + e.amountCents, 0);
    if (!Number.isSafeInteger(n)) throw new Error("账目总额超出精确计算范围");
    return n;
  }
  function breakdown(records, category = "") {
    const map = new Map();
    for (const e of records) {
      if (category && e.category !== category) continue;
      const name = category ? e.subcategory || "未分类" : e.category;
      map.set(name, (map.get(name) || 0) + e.amountCents);
    }
    const colors = CATEGORIES.map((c) => c.color);
    return [...map]
      .map(([name, value], i) => ({
        name,
        value,
        color: !category
          ? (CATEGORIES.find((c) => c.name === name) || {}).color
          : colors[i % colors.length],
      }))
      .sort((a, b) => b.value - a.value);
  }
  function buckets(records, type, key, granularity = "month", category = "") {
    let start, end, step, label;
    if (type === "all") {
      const dates = records.map((e) => e.date).sort();
      start = dates[0] || today();
      end = dates[dates.length - 1] || today();
      if (granularity === "year") {
        start = start.slice(0, 4) + "-01-01";
        step = (s) => shiftMonth(s, 12);
        label = (s) => s.slice(0, 4);
      } else {
        start = start.slice(0, 7) + "-01";
        step = (s) => shiftMonth(s, 1);
        label = (s) => s.slice(0, 7);
      }
    } else {
      ({ start, end } = range(type, key));
      step = type === "year" ? (s) => shiftMonth(s, 1) : (s) => addDays(s, 1);
      label =
        type === "year"
          ? (s) => Number(s.slice(5, 7)) + "月"
          : (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`;
    }
    const rows = [];
    for (let s = start; s <= end; s = step(s))
      rows.push({
        start: s,
        end: addDays(step(s), -1),
        label: label(s),
        value: 0,
        parts: {},
      });
    const index = new Map(
      rows.map((b, i) => [
        type === "year" || (type === "all" && granularity === "month")
          ? b.start.slice(0, 7)
          : type === "all"
            ? b.start.slice(0, 4)
            : b.start,
        i,
      ]),
    );
    for (const e of records) {
      const k =
        type === "year" || (type === "all" && granularity === "month")
          ? e.date.slice(0, 7)
          : type === "all"
            ? e.date.slice(0, 4)
            : e.date;
      const i = index.get(k);
      if (i === undefined) continue;
      const part = category ? e.subcategory || "未分类" : e.category;
      rows[i].value += e.amountCents;
      rows[i].parts[part] = (rows[i].parts[part] || 0) + e.amountCents;
    }
    return rows;
  }
  function trend(records, type, now = today()) {
    const count = type === "week" ? 8 : type === "month" ? 12 : 5,
      list = [];
    for (let i = count - 1; i >= 0; i--) {
      const date =
        type === "week"
          ? addDays(now, -i * 7)
          : shiftMonth(now, -i * (type === "year" ? 12 : 1));
      const key = keyFor(type, date),
        r = range(type, key);
      list.push({
        label:
          type === "week"
            ? `${Number(r.start.slice(5, 7))}/${Number(r.start.slice(8))}`
            : type === "month"
              ? key.slice(2).replace("-", "/")
              : key,
        value: sum(within(records, r)),
        start: r.start,
        end: r.end,
      });
    }
    return list;
  }
  // Parse records across line boundaries, including quoted embedded CR/LF.
  function csvRows(text) {
    text = String(text).replace(/^\uFEFF/, "");
    const rows = [];
    let row = [],
      cell = "",
      quoted = false,
      closed = false;
    const pushCell = () => {
      row.push(cell);
      cell = "";
      closed = false;
    };
    const pushRow = () => {
      pushCell();
      if (row.some((s) => s.trim())) rows.push(row);
      row = [];
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            quoted = false;
            closed = true;
          }
        } else cell += ch;
      } else if (ch === ",") pushCell();
      else if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        pushRow();
      } else if (ch === '"') {
        if (cell || closed) throw new Error("CSV 引号格式不正确");
        quoted = true;
      } else {
        if (closed) throw new Error("CSV 引号后出现多余内容");
        cell += ch;
      }
    }
    if (quoted) throw new Error("CSV 存在未闭合的引号");
    if (cell || row.length || closed) pushRow();
    return rows;
  }
  function parseCSV(text) {
    const rows = csvRows(text),
      header = rows.shift();
    if (
      !header ||
      HEADERS.some((h, i) => header[i] !== h) ||
      header.length !== HEADERS.length
    )
      throw new Error("CSV 表头不匹配，请导入 Wallet 导出的文件");
    const records = [],
      errors = [],
      seen = new Set();
    let duplicateCount = 0;
    rows.forEach((values, i) => {
      try {
        if (values.length !== HEADERS.length) throw new Error("列数不正确");
        const raw = Object.fromEntries(HEADERS.map((h, n) => [h, values[n]])),
          e = normalizeRecord(raw, true);
        if (seen.has(e.id)) {
          duplicateCount++;
          return;
        }
        seen.add(e.id);
        records.push(e);
      } catch (e) {
        errors.push({ row: i + 2, message: e.message });
      }
    });
    return { records, errors, duplicateCount, total: rows.length };
  }
  function toCSV(records) {
    const rows = records.map((e) => [
      e.id,
      (e.amountCents / 100).toFixed(2),
      e.category,
      e.subcategory,
      e.date,
      e.note,
      e.createdAt,
      e.updatedAt,
    ]);
    return (
      "\uFEFF" +
      [HEADERS, ...rows]
        .map((row) =>
          row
            .map((v, i) =>
              [1, 6, 7].includes(i)
                ? String(v)
                : '"' + String(v).replace(/"/g, '""') + '"',
            )
            .join(","),
        )
        .join("\r\n")
    );
  }
  function same(a, b) {
    return [
      "amountCents",
      "category",
      "subcategory",
      "date",
      "note",
      "createdAt",
      "updatedAt",
    ].every((k) => a[k] === b[k]);
  }
  function previewImport(existing, incoming) {
    const map = new Map(existing.map((e) => [e.id, e])),
      adds = [],
      conflicts = [];
    let duplicates = 0;
    for (const e of incoming) {
      const old = map.get(e.id);
      if (!old) adds.push(e);
      else if (same(old, e)) duplicates++;
      else
        conflicts.push({
          before: old,
          after: e,
          newer: e.updatedAt > old.updatedAt,
        });
    }
    return { adds, conflicts, duplicates };
  }
  function mergeCSV(state, incoming, updateNewer = false) {
    const p = previewImport(state.expenses, incoming),
      updates = new Map(
        p.conflicts
          .filter((c) => updateNewer && c.newer)
          .map((c) => [c.after.id, c.after]),
      );
    state.expenses = state.expenses
      .map((e) => updates.get(e.id) || e)
      .concat(p.adds);
    reconcileSubs(state);
    return { added: p.adds.length, updated: updates.size };
  }
  function makeBackup(state, profile) {
    return JSON.stringify(
      {
        format: "wallet-ios-pwa",
        version: profile ? 2 : 1,
        ...(profile ? { profile: { id: profile.id, name: profile.name } } : {}),
        exportedAt: new Date().toISOString(),
        data: validateState(state),
      },
      null,
      2,
    );
  }
  function readBackup(text) {
    return readBackupEnvelope(text).state;
  }
  function readBackupEnvelope(text) {
    const raw = JSON.parse(text);
    if (!raw || raw.format !== "wallet-ios-pwa" || ![1, 2].includes(raw.version))
      throw new Error("这不是支持的 Wallet 完整备份");
    if (raw.version === 2 && (!raw.profile ||
      typeof raw.profile.id !== "string" || !raw.profile.id ||
      typeof raw.profile.name !== "string" || !raw.profile.name.trim() ||
      raw.profile.name.length > 24)) throw new Error("备份中的用户信息无效");
    return { state: validateState(raw.data), profile: raw.version === 2
      ? { id: raw.profile.id, name: raw.profile.name } : null };
  }
  return {
    CATEGORIES,
    SUBS,
    HEADERS,
    clone,
    today,
    validDate,
    addDays,
    shiftMonth,
    monday,
    weekKey,
    weekStart,
    keyFor,
    range,
    previous,
    periodLabel,
    periods,
    cents,
    money,
    newId,
    normalizeRecord,
    initialState,
    validateState,
    reconcileSubs,
    within,
    sum,
    breakdown,
    buckets,
    trend,
    csvRows,
    parseCSV,
    toCSV,
    previewImport,
    mergeCSV,
    makeBackup,
    readBackup,
    readBackupEnvelope,
  };
});
