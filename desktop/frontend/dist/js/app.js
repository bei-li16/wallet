/**
 * Wallet 桌面版 - Vue 应用主体
 *
 * 功能与网页版对齐：四 Tab、记一笔/编辑、批量删除、子类别管理、预算、
 * 周报/月报/年报/总报（柱状/饼图 + 下钻 + 上期对比）、趋势（折线 + 占比环）。
 *
 * 相对原版的修复与增强：
 * - CSV 同步路径持久化，配置一次后静默自动同步（原版每次启动都要重选文件）
 * - localStorage 脏数据先备份再降级（原版解析失败会静默清空）
 * - alert/confirm 替换为应用内 Toast / 确认弹窗
 * - "全选"覆盖当前筛选的全部记录（原版只选最近 20 条）
 * - 删除支持 Toast 内撤销
 * - 图表随窗口尺寸自适应（ResizeObserver）
 */
(function () {
  'use strict';

  const { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

  const TOTAL_KEY = '总消费';

  const CATEGORY_CONFIG = {
    '餐饮': { icon: '🍜', color: '#f59e0b' },
    '交通': { icon: '🚗', color: '#3b82f6' },
    '购物': { icon: '🛒', color: '#ec4899' },
    '居住': { icon: '🏠', color: '#8b5cf6' },
    '娱乐': { icon: '🎮', color: '#10b981' },
    '医疗': { icon: '💊', color: '#ef4444' },
    '其他': { icon: '📦', color: '#6b7280' }
  };

  const DEFAULT_SUBCATEGORIES = {
    '餐饮': ['早餐', '午餐', '晚餐', '零食', '饮料'],
    '交通': ['打车', '公交', '地铁', '加油', '保险', '停车'],
    '购物': ['日用品', '网购', '服饰', '数码'],
    '居住': ['房租', '水电', '物业', '装修'],
    '娱乐': ['电影', '游戏', '旅游', '运动'],
    '医疗': ['门诊', '买药', '体检'],
    '其他': ['礼品', '捐赠', '其它']
  };

  const categories = Object.entries(CATEGORY_CONFIG).map(([name, config]) => ({
    name,
    icon: config.icon,
    color: config.color
  }));

  const tabs = [
    { id: 'home', name: '首页', icon: '🏠' },
    { id: 'add', name: '记一笔', icon: '✏️' },
    { id: 'report', name: '报表', icon: '📊' },
    { id: 'trend', name: '趋势', icon: '📈' }
  ];

  const periods = [
    { value: 'week', label: '周报' },
    { value: 'month', label: '月报' },
    { value: 'year', label: '年报' },
    { value: 'all', label: '总报' }
  ];

  createApp({
    setup() {
      // ---------- 基础状态 ----------
      const currentTab = ref('home');
      const expenses = ref([]);
      const subcategories = ref({ ...DEFAULT_SUBCATEGORIES });
      const budget = ref(0);
      const loaded = ref(false);
      const fileInput = ref(null);

      // ---------- 报表状态 ----------
      const reportPeriod = ref('month');
      const reportChartType = ref('pie');
      const reportCategory = ref(TOTAL_KEY);
      const reportGranularity = ref('month');
      const reportSpecificPeriod = ref('');

      // ---------- 趋势状态 ----------
      const trendGranularity = ref('month');

      // ---------- 记账表单 ----------
      const expenseForm = ref({
        date: dayjs().format('YYYY-MM-DD'),
        amount: '',
        category: '',
        subcategory: '',
        note: ''
      });
      const editingId = ref(null);
      const showCustomSubcategory = ref(false);
      const customSubcategory = ref('');

      // ---------- 批量模式 ----------
      const batchMode = ref(false);
      const selectedExpenses = ref([]);
      const filterCategory = ref(null);
      const filterSubcategory = ref(null);

      // ---------- CSV 同步状态 ----------
      const csvPath = ref('');
      const csvSyncing = ref(false);
      const lastSyncAt = ref(0);
      // 手动同步：rev 随数据变动递增，syncedRev 记录最近一次成功同步的位置
      const rev = ref(0);
      const syncedRev = ref(0);
      const dirty = computed(() => rev.value !== syncedRev.value);

      // ---------- 弹窗 / Toast ----------
      const confirmModal = ref(null);
      const toasts = ref([]);
      let toastSeq = 0;

      const charts = WalletCharts.createChartManager();

      // ---------- Toast ----------
      function toast(message, type = 'info', options = {}) {
        const id = ++toastSeq;
        const t = {
          id,
          message,
          type,
          actionLabel: options.actionLabel || '',
          onAction: options.onAction || null,
          duration: options.duration || (options.actionLabel ? 6000 : 3000)
        };
        toasts.value.push(t);
        t.timer = setTimeout(() => dismissToast(id), t.duration);
      }

      function dismissToast(id) {
        const idx = toasts.value.findIndex((t) => t.id === id);
        if (idx !== -1) {
          clearTimeout(toasts.value[idx].timer);
          toasts.value.splice(idx, 1);
        }
      }

      function toastAction(t) {
        if (t.onAction) t.onAction();
        dismissToast(t.id);
      }

      // ---------- 确认弹窗 ----------
      function confirmDialog(opts) {
        return new Promise((resolve) => {
          confirmModal.value = {
            title: opts.title || '确认',
            message: opts.message || '',
            confirmText: opts.confirmText || '确定',
            danger: !!opts.danger,
            resolve
          };
        });
      }

      function modalAnswer(yes) {
        if (!confirmModal.value) return;
        confirmModal.value.resolve(yes);
        confirmModal.value = null;
      }

      // ---------- 通用工具 ----------
      function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2);
      }

      function formatAmount(amount) {
        return '¥' + (amount || 0).toFixed(2);
      }

      function formatDate(date) {
        return dayjs(date).format('MM-DD');
      }

      function getCategoryIcon(category) {
        return CATEGORY_CONFIG[category]?.icon || '📦';
      }

      function getCategoryColor(category) {
        return CATEGORY_CONFIG[category]?.color || '#6b7280';
      }

      // ---------- 数据加载 / 保存 ----------
      function loadData() {
        const exp = WalletStorage.loadExpenses();
        expenses.value = exp.list;
        if (exp.corrupt) {
          toast('消费数据文件损坏，原始内容已备份，请通过 CSV 导入恢复', 'error', { duration: 8000 });
        }

        const subs = WalletStorage.loadSubcategories();
        if (subs.value) {
          subcategories.value = subs.value;
        }
        if (subs.corrupt) {
          toast('子类别数据损坏，已恢复默认并备份', 'error', { duration: 8000 });
        }

        budget.value = WalletStorage.loadBudget();
        csvPath.value = WalletStorage.getCsvPath();
        lastSyncAt.value = WalletStorage.getLastSyncAt();
        rev.value = WalletStorage.getRev();
        syncedRev.value = WalletStorage.getSyncedRev();
        pushDirtyToShell();
        loaded.value = true;
      }

      function saveExpenses() {
        // 只写本地存储并标记脏；CSV 由用户点击「同步」时写入
        WalletStorage.saveExpenses(expenses.value);
        rev.value = WalletStorage.bumpRev();
        pushDirtyToShell();
      }

      /** 把脏状态同步给桌面壳（用于退出拦截）；未配置同步文件时无需拦截 */
      function pushDirtyToShell() {
        if (WalletStorage.isDesktop()) {
          const needsAsk = dirty.value && !!csvPath.value;
          window.go.main.App.SetUnsynced(needsAsk).catch(() => {});
        }
      }

      function saveSubcategories() {
        WalletStorage.saveSubcategories(subcategories.value);
      }

      // ---------- CSV 同步（手动触发） ----------
      const csvConnected = computed(() => !!csvPath.value);

      // 串行化写盘：连续点击同步时避免并发写同一文件造成内容交错
      let syncChain = Promise.resolve(true);

      function autoSyncCSV() {
        if (!WalletStorage.isDesktop() || !csvPath.value) return Promise.resolve(true);
        syncChain = syncChain.then(async () => {
          csvSyncing.value = true;
          try {
            const content = WalletCSV.buildCSVContent(expenses.value);
            await WalletStorage.writeTextFile(csvPath.value, content);
            lastSyncAt.value = Date.now();
            WalletStorage.setLastSyncAt(lastSyncAt.value);
            WalletStorage.markSynced();
            syncedRev.value = rev.value;
            pushDirtyToShell();
            return true;
          } catch (e) {
            console.error('CSV sync failed:', e);
            toast('CSV 同步失败：' + e, 'error');
            return false;
          } finally {
            csvSyncing.value = false;
          }
        });
        return syncChain;
      }

      async function configureCsv() {
        if (!WalletStorage.isDesktop()) {
          toast('浏览器模式不支持自动同步，请使用导出/导入 CSV', 'info');
          return;
        }
        try {
          let suggested = csvPath.value;
          if (!suggested) {
            suggested = await WalletStorage.defaultCsvPath();
          }
          const picked = await WalletStorage.pickSavePath(
            (suggested || '').split(/[\\/]/).pop() || 'wallet-expenses.csv'
          );
          if (!picked) return;
          csvPath.value = picked;
          WalletStorage.setCsvPath(picked);
          const ok = await autoSyncCSV();
          if (ok) toast('已配置同步文件并完成首次写入；之后的改动需点击「同步」写入', 'success');
        } catch (e) {
          console.error('configure csv failed:', e);
        }
      }

      async function connectCsv() {
        if (!WalletStorage.isDesktop()) {
          fileInput.value?.click();
          return;
        }
        try {
          const picked = await WalletStorage.pickOpenPath();
          if (!picked) return;
          const text = await WalletStorage.readTextFile(picked);
          const { records, stats } = WalletCSV.parseCSV(text, new Set(expenses.value.map((e) => e.id)));
          csvPath.value = picked;
          WalletStorage.setCsvPath(picked);
          mergeImported(records, stats);
          await autoSyncCSV();
        } catch (e) {
          console.error('connect csv failed:', e);
        }
      }

      async function disconnectCsv() {
        const yes = await confirmDialog({
          title: '断开 CSV 同步',
          message: '断开后将取消与该文件的关联，本地数据仍保留，可随时重新选择同步文件。确定断开？'
        });
        if (!yes) return;
        csvPath.value = '';
        WalletStorage.setCsvPath('');
        pushDirtyToShell();
        toast('已断开 CSV 同步');
      }

      async function syncNow() {
        if (!csvPath.value) {
          configureCsv();
          return;
        }
        const ok = await autoSyncCSV();
        if (ok) toast('已同步到 CSV', 'success');
      }

      // ---------- 退出拦截（桌面壳 OnBeforeClose → ask-before-exit 事件） ----------
      const exitModal = ref(false);

      function resolveExit() {
        if (WalletStorage.isDesktop()) {
          window.go.main.App.ResolveExit();
        }
      }

      /** 同步并退出；写盘失败则留在应用内并提示 */
      async function exitWithSync() {
        exitModal.value = false;
        const ok = await autoSyncCSV();
        if (ok) resolveExit();
      }

      function exitWithoutSync() {
        exitModal.value = false;
        resolveExit();
      }

      function openCsvFolder() {
        if (csvPath.value && WalletStorage.isDesktop()) {
          WalletStorage.revealFolder(csvPath.value).catch(() => {});
        }
      }

      function lastSyncLabel() {
        return lastSyncAt.value ? dayjs(lastSyncAt.value).format('YYYY-MM-DD HH:mm:ss') : '从未';
      }

      // ---------- 导入/导出 ----------
      function mergeImported(records, stats) {
        if (records.length > 0) {
          expenses.value = [...expenses.value, ...records];
          saveExpenses();
        }
        const parts = [`共 ${stats.total} 条`];
        if (stats.successCount > 0) parts.push(`导入 ${stats.successCount} 条`);
        if (stats.duplicateCount > 0) parts.push(`重复跳过 ${stats.duplicateCount} 条`);
        if (stats.invalidCount > 0) parts.push(`无效 ${stats.invalidCount} 条`);
        const type = stats.successCount > 0 ? 'success' : 'info';
        if (stats.total === 0) {
          toast('CSV 文件中没有可导入的记录', 'info');
        } else {
          toast(parts.join('，'), type, { duration: 5000 });
        }
      }

      async function manualExport() {
        const filename = `expenses_${dayjs().format('YYYY-MM-DD')}.csv`;
        const content = WalletCSV.buildCSVContent(expenses.value);
        if (WalletStorage.isDesktop()) {
          try {
            const picked = await WalletStorage.pickSavePath(filename);
            if (!picked) return;
            await WalletStorage.writeTextFile(picked, content);
            toast('已导出：' + picked, 'success', { duration: 5000 });
          } catch (e) {
            console.error('export failed:', e);
          }
        } else {
          WalletStorage.downloadCSV(content, filename);
          toast('已触发浏览器下载', 'success');
        }
      }

      function triggerCSVImport() {
        if (WalletStorage.isDesktop()) {
          connectCsv();
        } else {
          fileInput.value?.click();
        }
      }

      function handleFileImport(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) {
          toast('文件过大，请选择小于 50MB 的 CSV 文件', 'error');
          e.target.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          const { records, stats } = WalletCSV.parseCSV(
            ev.target.result,
            new Set(expenses.value.map((x) => x.id))
          );
          mergeImported(records, stats);
        };
        reader.readAsText(file);
        e.target.value = '';
      }

      // ---------- 计算属性 ----------
      const currentSubcategories = computed(() => {
        if (!expenseForm.value.category) return [];
        return subcategories.value[expenseForm.value.category] || [];
      });

      const filteredExpenses = computed(() => {
        try {
          if (!expenses.value || !Array.isArray(expenses.value)) return [];
          return expenses.value.filter((e) => {
            if (filterCategory.value && e.category !== filterCategory.value) return false;
            if (filterSubcategory.value && e.subcategory !== filterSubcategory.value) return false;
            return true;
          });
        } catch (e) {
          console.error('filteredExpenses error:', e);
          return [];
        }
      });

      const availableFilterSubcategories = computed(() => {
        try {
          if (!filterCategory.value || !expenses.value || !Array.isArray(expenses.value)) return [];
          return Array.from(
            new Set(
              expenses.value
                .filter((e) => e.category === filterCategory.value && e.subcategory)
                .map((e) => e.subcategory)
            )
          ).sort((a, b) => a.localeCompare(b, 'zh-CN'));
        } catch (e) {
          console.error('availableFilterSubcategories error:', e);
          return [];
        }
      });

      const filteredRecentExpenses = computed(() => {
        try {
          if (!filteredExpenses.value || !Array.isArray(filteredExpenses.value)) return [];
          return [...filteredExpenses.value]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 20);
        } catch (e) {
          console.error('filteredRecentExpenses error:', e);
          return [];
        }
      });

      const todayTotal = computed(() => {
        const today = dayjs().format('YYYY-MM-DD');
        return WalletAggregate.round2(
          expenses.value.filter((e) => e.date === today).reduce((sum, e) => sum + e.amount, 0)
        );
      });

      const weekTotal = computed(() => {
        const { start, end } = WalletPeriods.getPeriodRange('week', '');
        const s = start.format('YYYY-MM-DD');
        const e = end.format('YYYY-MM-DD');
        return WalletAggregate.round2(
          expenses.value.filter((x) => x.date >= s && x.date <= e).reduce((sum, x) => sum + x.amount, 0)
        );
      });

      const currentMonthTotal = computed(() => {
        const { start, end } = WalletPeriods.getPeriodRange('month', '');
        const s = start.format('YYYY-MM-DD');
        const e = end.format('YYYY-MM-DD');
        return WalletAggregate.round2(
          expenses.value.filter((x) => x.date >= s && x.date <= e).reduce((sum, x) => sum + x.amount, 0)
        );
      });

      const yearTotal = computed(() => {
        const year = dayjs().year();
        return WalletAggregate.round2(
          expenses.value
            .filter((e) => dayjs(e.date).year() === year)
            .reduce((sum, e) => sum + e.amount, 0)
        );
      });

      const budgetProgress = computed(() => {
        if (budget.value <= 0) return 0;
        return (currentMonthTotal.value / budget.value) * 100;
      });

      const budgetProgressClass = computed(() => {
        const p = budgetProgress.value;
        if (p >= 100) return 'danger';
        if (p >= 80) return 'warning';
        return '';
      });

      const periodLabel = computed(() => {
        const labels = { week: '本周', month: '本月', year: '今年' };
        return labels[reportPeriod.value] || '';
      });

      function filterByPeriodAndCategory(startStr, endStr) {
        return expenses.value
          .filter((exp) => {
            if (exp.date >= startStr && exp.date <= endStr) {
              if (reportCategory.value !== TOTAL_KEY) {
                return exp.category === reportCategory.value;
              }
              return true;
            }
            return false;
          })
          .reduce((sum, exp) => sum + exp.amount, 0);
      }

      const currentPeriodTotal = computed(() => {
        if (reportPeriod.value === 'all') {
          return WalletAggregate.round2(expenses.value.reduce((sum, e) => sum + e.amount, 0));
        }
        const { start, end } = WalletPeriods.getPeriodRange(reportPeriod.value, reportSpecificPeriod.value);
        return WalletAggregate.round2(
          filterByPeriodAndCategory(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'))
        );
      });

      const prevPeriodTotal = computed(() => {
        if (reportPeriod.value === 'all') return 0;
        const r = WalletPeriods.getPrevPeriodRange(reportPeriod.value, reportSpecificPeriod.value);
        if (!r) return 0;
        return WalletAggregate.round2(
          filterByPeriodAndCategory(r.start.format('YYYY-MM-DD'), r.end.format('YYYY-MM-DD'))
        );
      });

      const periodChange = computed(() => {
        if (prevPeriodTotal.value === 0) return 0;
        return (
          Math.round(
            ((currentPeriodTotal.value - prevPeriodTotal.value) / prevPeriodTotal.value) * 1000
          ) / 10
        );
      });

      const availablePeriods = computed(() => {
        try {
          if (reportPeriod.value === 'all') return [];
          if (!expenses.value || !Array.isArray(expenses.value) || !expenses.value.length) return [];
          return WalletPeriods.getAvailablePeriods(
            expenses.value.map((e) => e.date),
            reportPeriod.value
          );
        } catch (e) {
          console.error('availablePeriods error:', e);
          return [];
        }
      });

      const hasAvailablePeriods = computed(() => {
        return Array.isArray(availablePeriods.value) && availablePeriods.value.length > 0;
      });

      const specificPeriodLabel = computed(() => {
        return WalletPeriods.getSpecificPeriodLabel(reportSpecificPeriod.value, reportPeriod.value);
      });

      const totalAllExpenses = computed(() => {
        if (!expenses.value) return 0;
        return WalletAggregate.round2(expenses.value.reduce((sum, e) => sum + e.amount, 0));
      });

      // ---------- 记一笔 / 编辑 ----------
      function selectCategory(name) {
        expenseForm.value.category = name;
        expenseForm.value.subcategory = '';
        showCustomSubcategory.value = false;
      }

      function switchTab(tab) {
        currentTab.value = tab;
        nextTick(() => {
          if (tab === 'report') renderReportCharts();
          else if (tab === 'trend') renderTrendCharts();
        });
      }

      function rememberCustomSubcategory() {
        if (showCustomSubcategory.value && customSubcategory.value) {
          const cat = expenseForm.value.category;
          if (!subcategories.value[cat]) subcategories.value[cat] = [];
          if (!subcategories.value[cat].includes(customSubcategory.value)) {
            subcategories.value[cat].push(customSubcategory.value);
            saveSubcategories();
          }
        }
      }

      function saveExpense() {
        const f = expenseForm.value;
        if (!f.date || !f.amount || !f.category || !f.subcategory) {
          toast('请填写完整信息', 'error');
          return;
        }
        const amount = Number(f.amount);
        if (isNaN(amount) || amount <= 0) {
          toast('金额必须大于 0', 'error');
          return;
        }
        if (!dayjs(f.date).isValid()) {
          toast('日期格式不正确', 'error');
          return;
        }

        const subcategory =
          showCustomSubcategory.value && customSubcategory.value
            ? customSubcategory.value
            : f.subcategory;

        if (editingId.value) {
          // 编辑模式：保存后回首页列表
          const index = expenses.value.findIndex((e) => e.id === editingId.value);
          if (index !== -1) {
            expenses.value[index] = {
              ...expenses.value[index],
              ...f,
              amount,
              subcategory,
              updatedAt: Date.now()
            };
            rememberCustomSubcategory();
          }
          editingId.value = null;
          saveExpenses();
          resetForm();
          toast('修改已保存', 'success');
          currentTab.value = 'home';
        } else {
          // 新增模式：留在记一笔页并重置表单，便于连续记账；首页列表自动更新
          expenses.value.push({
            id: generateId(),
            ...f,
            amount,
            subcategory,
            createdAt: Date.now(),
            updatedAt: Date.now()
          });
          rememberCustomSubcategory();
          saveExpenses();
          resetForm();
          toast('已添加记录，可继续记下一笔', 'success');
        }
      }

      function editExpense(expense) {
        if (batchMode.value) return;
        editingId.value = expense.id;
        expenseForm.value = {
          date: expense.date,
          amount: expense.amount,
          category: expense.category,
          subcategory: expense.subcategory,
          note: expense.note || ''
        };
        showCustomSubcategory.value = false;
        customSubcategory.value = '';
        currentTab.value = 'add';
      }

      /** 删除后允许 Toast 内撤销 */
      function stashForUndo(records, noun) {
        toast(`已删除 ${noun}`, 'info', {
          actionLabel: '撤销',
          onAction: () => {
            expenses.value = [...expenses.value, ...records];
            saveExpenses();
            toast('已恢复', 'success');
          }
        });
      }

      /** @returns {Promise<boolean>} 是否确实删除 */
      async function deleteExpense(id) {
        const idx = expenses.value.findIndex((e) => e.id === id);
        if (idx === -1) return false;
        const record = expenses.value[idx];
        const yes = await confirmDialog({
          title: '删除记录',
          message: `确定删除这条记录吗？（${record.category}-${record.subcategory} ${formatAmount(record.amount)}）`,
          confirmText: '删除',
          danger: true
        });
        if (!yes) return false;
        expenses.value = expenses.value.filter((e) => e.id !== id);
        saveExpenses();
        stashForUndo([record], '1 条记录');
        return true;
      }

      async function deleteCurrentExpense() {
        if (!editingId.value) return;
        const id = editingId.value;
        const deleted = await deleteExpense(id);
        // 仅在确实删除后退出编辑态；用户取消弹窗时停留在编辑页
        if (deleted) {
          cancelEdit();
        }
      }

      function cancelEdit() {
        editingId.value = null;
        resetForm();
        currentTab.value = 'home';
      }

      function resetForm() {
        expenseForm.value = {
          date: dayjs().format('YYYY-MM-DD'),
          amount: '',
          category: '',
          subcategory: '',
          note: ''
        };
        showCustomSubcategory.value = false;
        customSubcategory.value = '';
      }

      // ---------- 批量模式 ----------
      function toggleSelect(id) {
        const idx = selectedExpenses.value.indexOf(id);
        if (idx === -1) {
          selectedExpenses.value.push(id);
        } else {
          selectedExpenses.value.splice(idx, 1);
        }
      }

      async function batchDelete() {
        if (selectedExpenses.value.length === 0) {
          toast('请先选择要删除的记录', 'error');
          return;
        }
        const count = selectedExpenses.value.length;
        const yes = await confirmDialog({
          title: '批量删除',
          message: `确定删除选中的 ${count} 条记录吗？`,
          confirmText: '删除',
          danger: true
        });
        if (!yes) return;
        const removed = expenses.value.filter((e) => selectedExpenses.value.includes(e.id));
        expenses.value = expenses.value.filter((e) => !selectedExpenses.value.includes(e.id));
        saveExpenses();
        exitBatchMode();
        stashForUndo(removed, `${count} 条记录`);
      }

      function exitBatchMode() {
        batchMode.value = false;
        selectedExpenses.value = [];
      }

      async function cancelBatch() {
        if (selectedExpenses.value.length > 0) {
          const yes = await confirmDialog({
            title: '退出批量删除',
            message: '确定退出批量删除吗？已选择的记录将被清除。',
            danger: true
          });
          if (!yes) return;
        }
        exitBatchMode();
      }

      function enterBatchMode() {
        batchMode.value = true;
        selectedExpenses.value = [];
      }

      /** 修复：全选覆盖当前筛选下的全部记录（原版只选最近 20 条） */
      function selectAllInFilter() {
        selectedExpenses.value = filteredExpenses.value.map((e) => e.id);
        if (filteredExpenses.value.length > filteredRecentExpenses.value.length) {
          toast(`已选择全部 ${filteredExpenses.value.length} 条（列表仅显示最近 20 条）`, 'info');
        }
      }

      function deselectAll() {
        selectedExpenses.value = [];
      }

      function toggleCategoryFilter(category) {
        filterCategory.value = filterCategory.value === category ? null : category;
      }

      function setSubcategoryFilter(subcategory) {
        filterSubcategory.value = subcategory;
      }

      function toggleSubcategoryFilter(subcategory) {
        filterSubcategory.value = filterSubcategory.value === subcategory ? null : subcategory;
      }

      watch(filterCategory, () => {
        filterSubcategory.value = null;
      });

      // 筛选变化时，剔除已不可见的选中项
      watch([filterCategory, filterSubcategory], () => {
        if (!batchMode.value) return;
        const visibleIds = new Set(filteredExpenses.value.map((e) => e.id));
        selectedExpenses.value = selectedExpenses.value.filter((id) => visibleIds.has(id));
      });

      // ---------- 子类别管理 ----------
      async function deleteSubcategory(mainCat, sub) {
        const hasRecords = expenses.value.some(
          (e) => e.category === mainCat && e.subcategory === sub
        );
        if (hasRecords) {
          toast(`"${sub}" 类别下有消费记录，无法删除`, 'error');
          return;
        }
        const yes = await confirmDialog({
          title: '删除子类别',
          message: `确定删除主类别「${mainCat}」下的「${sub}」吗？`,
          confirmText: '删除',
          danger: true
        });
        if (!yes) return;
        const subs = subcategories.value[mainCat];
        const index = subs.indexOf(sub);
        if (index > -1) {
          subs.splice(index, 1);
          saveSubcategories();
        }
      }

      function confirmAddSubcategory() {
        const sub = customSubcategory.value.trim();
        if (!sub) return;
        const mainCat = expenseForm.value.category;
        if (!subcategories.value[mainCat]) {
          subcategories.value[mainCat] = [];
        }
        if (!subcategories.value[mainCat].includes(sub)) {
          subcategories.value[mainCat].push(sub);
          saveSubcategories();
        }
        expenseForm.value.subcategory = sub;
        customSubcategory.value = '';
        showCustomSubcategory.value = false;
      }

      // ---------- 预算 ----------
      function saveBudget() {
        WalletStorage.saveBudget(budget.value);
      }

      // ---------- 报表图表 ----------
      function getFilteredExpensesByPeriod() {
        if (reportPeriod.value === 'all') {
          return expenses.value;
        }
        const { start, end } = WalletPeriods.getPeriodRange(
          reportPeriod.value,
          reportSpecificPeriod.value
        );
        const s = start.format('YYYY-MM-DD');
        const e = end.format('YYYY-MM-DD');
        return expenses.value.filter((exp) => exp.date >= s && exp.date <= e);
      }

      function renderReportCharts() {
        if (reportChartType.value === 'bar') {
          charts.dispose('pieChart');
          let chartData;
          let xAxisLabels;
          if (reportPeriod.value === 'all') {
            chartData = WalletAggregate.getAllTimeChartData(
              expenses.value,
              categories,
              subcategories.value,
              reportCategory.value,
              reportGranularity.value
            );
            xAxisLabels = chartData.labels;
          } else {
            chartData = WalletAggregate.getChartDataForPeriod(
              expenses.value,
              categories,
              subcategories.value,
              reportCategory.value,
              reportPeriod.value,
              reportSpecificPeriod.value
            );
            const fmt = reportPeriod.value === 'year' ? 'YYYY/MM' : 'MM/DD';
            xAxisLabels = chartData.labels.map((l) => dayjs(l).format(fmt));
          }
          // 柱状图与饼图行为一致：顶层点击柱条下钻到对应主类的子类别
          const onBarClick =
            reportCategory.value === TOTAL_KEY
              ? (params) => {
                  if (params.componentType !== 'series') return;
                  const subs = subcategories.value[params.seriesName];
                  if (subs && subs.length > 0) {
                    reportCategory.value = params.seriesName;
                  }
                }
              : null;
          charts.render(
            'barChart',
            WalletCharts.barOption(chartData, xAxisLabels, reportPeriod.value !== 'year'),
            onBarClick
          );
        } else {
          charts.dispose('barChart');
          const pieData = WalletAggregate.getCategoryPieData(
            getFilteredExpensesByPeriod(),
            categories,
            subcategories.value,
            reportCategory.value
          );
          const onClick =
            reportCategory.value === TOTAL_KEY
              ? (params) => {
                  const subs = subcategories.value[params.name];
                  if (subs && subs.length > 0) {
                    reportCategory.value = params.name;
                  }
                }
              : null;
          charts.render('pieChart', WalletCharts.pieOption(pieData), onClick);
        }
      }

      // ---------- 趋势图表 ----------
      function renderTrendLine() {
        const { labels, data } = WalletAggregate.getTrendData(expenses.value, trendGranularity.value);
        charts.render('trendChart', WalletCharts.trendOption(labels, data));
      }

      function renderCategoryRing() {
        const pieData = WalletAggregate.getYearPieData(expenses.value, categories);
        charts.render('categoryChart', WalletCharts.pieOption(pieData));
      }

      function renderTrendCharts() {
        renderTrendLine();
        renderCategoryRing();
      }

      // ---------- Watchers ----------
      watch(reportPeriod, () => {
        reportSpecificPeriod.value = '';
      });

      watch(
        [reportPeriod, reportChartType, reportCategory, reportGranularity, reportSpecificPeriod],
        () => {
          if (currentTab.value === 'report') {
            nextTick(() => renderReportCharts());
          }
        }
      );

      watch(trendGranularity, () => {
        if (currentTab.value === 'trend') {
          nextTick(() => renderTrendLine());
        }
      });

      watch(
        expenses,
        () => {
          if (currentTab.value === 'trend') {
            nextTick(() => renderCategoryRing());
          }
        },
        { deep: true }
      );

      // ---------- 生命周期 ----------
      onMounted(() => {
        loadData();
        // 桌面壳关闭窗口时若有未同步修改，会发来 ask-before-exit 事件
        if (WalletStorage.isDesktop() && window.runtime && window.runtime.EventsOn) {
          window.runtime.EventsOn('ask-before-exit', () => {
            exitModal.value = true;
          });
        }
      });

      onUnmounted(() => {
        charts.disposeAll();
      });

      return {
        // 常量
        categories,
        tabs,
        periods,
        TOTAL_KEY,
        // 状态
        currentTab,
        expenses,
        subcategories,
        budget,
        reportPeriod,
        reportChartType,
        reportCategory,
        reportGranularity,
        reportSpecificPeriod,
        trendGranularity,
        expenseForm,
        editingId,
        showCustomSubcategory,
        customSubcategory,
        batchMode,
        selectedExpenses,
        filterCategory,
        filterSubcategory,
        csvConnected,
        csvPath,
        csvSyncing,
        lastSyncAt,
        dirty,
        exitModal,
        loaded,
        fileInput,
        confirmModal,
        toasts,
        // 计算属性
        currentSubcategories,
        filteredExpenses,
        availableFilterSubcategories,
        filteredRecentExpenses,
        todayTotal,
        weekTotal,
        currentMonthTotal,
        yearTotal,
        budgetProgress,
        budgetProgressClass,
        periodLabel,
        specificPeriodLabel,
        currentPeriodTotal,
        prevPeriodTotal,
        periodChange,
        availablePeriods,
        hasAvailablePeriods,
        totalAllExpenses,
        // 方法
        formatAmount,
        formatDate,
        getCategoryIcon,
        getCategoryColor,
        selectCategory,
        switchTab,
        saveExpense,
        editExpense,
        deleteExpense,
        deleteCurrentExpense,
        cancelEdit,
        toggleSelect,
        batchDelete,
        cancelBatch,
        enterBatchMode,
        selectAllInFilter,
        deselectAll,
        toggleCategoryFilter,
        setSubcategoryFilter,
        toggleSubcategoryFilter,
        saveBudget,
        deleteSubcategory,
        confirmAddSubcategory,
        manualExport,
        connectCsv,
        disconnectCsv,
        configureCsv,
        syncNow,
        openCsvFolder,
        lastSyncLabel,
        triggerCSVImport,
        handleFileImport,
        toast,
        dismissToast,
        toastAction,
        modalAnswer,
        exitWithSync,
        exitWithoutSync
      };
    }
  }).mount('#app');
})();
