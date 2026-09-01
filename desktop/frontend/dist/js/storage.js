/**
 * 存储适配器
 *
 * - localStorage：主存储（带 schema 版本号；解析失败时备份原始数据而非静默清空）
 * - 桌面文件桥：通过 Wails 绑定（window.go.main.App）读写 CSV、弹原生文件对话框
 * - 浏览器直接打开时桌面能力自动降级（isDesktop=false）
 */
(function (global) {
  'use strict';

  const KEYS = {
    expenses: 'wallet_expenses',
    subcategories: 'wallet_subcategories',
    budget: 'wallet_budget',
    schemaVersion: 'wallet_schema_version',
    csvPath: 'wallet_csv_path',
    lastSync: 'wallet_last_sync_at',
    rev: 'wallet_expenses_rev',
    syncedRev: 'wallet_synced_rev'
  };
  const SCHEMA_VERSION = 1;

  function isDesktop() {
    return typeof window.go !== 'undefined' && !!(window.go.main && window.go.main.App);
  }

  function app() {
    return window.go.main.App;
  }

  /**
   * 安全 JSON 读取：解析失败时把原始内容备份到 <key>_corrupt_<时间戳>，避免静默数据丢失
   */
  function safeGetJSON(key) {
    const raw = localStorage.getItem(key);
    if (raw == null) return { ok: false, value: null };
    try {
      return { ok: true, value: JSON.parse(raw), raw };
    } catch (e) {
      console.error(`storage: ${key} 解析失败，已备份原始数据`, e);
      try {
        localStorage.setItem(`${key}_corrupt_${Date.now()}`, raw);
      } catch (e2) {
        console.error('storage: 脏数据备份失败', e2);
      }
      return { ok: false, value: null, corrupt: true };
    }
  }

  function setJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ---------- 业务数据 ----------

  function loadExpenses() {
    const r = safeGetJSON(KEYS.expenses);
    // 合法 JSON 但不是数组（结构异常）：同样备份原始内容，避免下次保存覆盖
    if (r.value != null && !Array.isArray(r.value)) {
      try {
        localStorage.setItem(`${KEYS.expenses}_invalid_${Date.now()}`, r.raw);
      } catch (e) {
        console.error('storage: 异常结构数据备份失败', e);
      }
      return { list: [], corrupt: true };
    }
    return { list: Array.isArray(r.value) ? r.value : [], corrupt: !!r.corrupt };
  }

  function saveExpenses(list) {
    setJSON(KEYS.expenses, list);
    localStorage.setItem(KEYS.schemaVersion, String(SCHEMA_VERSION));
  }

  function loadSubcategories() {
    const r = safeGetJSON(KEYS.subcategories);
    const value = r.value && typeof r.value === 'object' && !Array.isArray(r.value) ? r.value : null;
    return { value, corrupt: !!r.corrupt };
  }

  function saveSubcategories(obj) {
    setJSON(KEYS.subcategories, obj);
  }

  function loadBudget() {
    return parseFloat(localStorage.getItem(KEYS.budget)) || 0;
  }

  function saveBudget(v) {
    localStorage.setItem(KEYS.budget, String(v));
  }

  // ---------- CSV 同步状态 ----------

  function getCsvPath() {
    return localStorage.getItem(KEYS.csvPath) || '';
  }

  function setCsvPath(path) {
    if (path) {
      localStorage.setItem(KEYS.csvPath, path);
    } else {
      localStorage.removeItem(KEYS.csvPath);
    }
  }

  function getLastSyncAt() {
    return parseInt(localStorage.getItem(KEYS.lastSync)) || 0;
  }

  function setLastSyncAt(ts) {
    localStorage.setItem(KEYS.lastSync, String(ts));
  }

  // ---------- 手动同步的脏状态跟踪 ----------
  // rev：每次数据变动 +1（持久化）；syncedRev：最近一次成功同步时的 rev。
  // 两者不等即存在未同步修改，跨重启依然可判定。

  function getRev() {
    return parseInt(localStorage.getItem(KEYS.rev)) || 0;
  }

  function bumpRev() {
    const r = getRev() + 1;
    localStorage.setItem(KEYS.rev, String(r));
    return r;
  }

  function getSyncedRev() {
    return parseInt(localStorage.getItem(KEYS.syncedRev)) || 0;
  }

  function markSynced() {
    localStorage.setItem(KEYS.syncedRev, String(getRev()));
  }

  // ---------- 桌面文件桥（Wails 绑定） ----------

  /**
   * 原生"另存为"对话框，返回所选路径（取消返回 ''）
   */
  function pickSavePath(defaultName) {
    return app().PickSaveCsv(defaultName || 'wallet-expenses.csv');
  }

  /**
   * 原生"打开文件"对话框，返回所选路径（取消返回 ''）
   */
  function pickOpenPath() {
    return app().PickOpenCsv();
  }

  function readTextFile(path) {
    return app().ReadTextFile(path);
  }

  function writeTextFile(path, content) {
    return app().WriteTextFile(path, content);
  }

  /** 在资源管理器中打开文件所在文件夹 */
  function revealFolder(path) {
    return app().RevealInExplorer(path);
  }

  /** 建议的默认同步路径（系统文档目录） */
  function defaultCsvPath() {
    return app().DefaultCsvPath();
  }

  /**
   * 浏览器模式的 CSV 导出下载
   */
  function downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  global.WalletStorage = {
    KEYS,
    SCHEMA_VERSION,
    isDesktop,
    loadExpenses,
    saveExpenses,
    loadSubcategories,
    saveSubcategories,
    loadBudget,
    saveBudget,
    getCsvPath,
    setCsvPath,
    getLastSyncAt,
    setLastSyncAt,
    getRev,
    bumpRev,
    getSyncedRev,
    markSynced,
    pickSavePath,
    pickOpenPath,
    readTextFile,
    writeTextFile,
    revealFolder,
    defaultCsvPath,
    downloadCSV
  };
})(window);
