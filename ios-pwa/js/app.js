(function () {
  "use strict";
  const C = WalletCore,
    { ref, computed, watch, nextTick, onMounted } = Vue;
  const app = Vue.createApp({
    setup() {
      const state = ref(C.initialState()),
        ready = ref(false),
        loadError = ref(""),
        busy = ref(false),
        tab = ref("home"),
        now = ref(C.today());
      const databaseName = "wallet-ios-pwa:" + new URL("./", location.href).pathname;
      let store = new WalletStore(databaseName);
      const profiles = ref([]),
        activeProfile = ref({ id: "user1", name: "user1" }),
        newProfileName = ref(""),
        editingProfile = ref(null),
        profileNameInput = ref("");
      let refreshPending = false;
      const activeProfileKey = databaseName + ":active-user";
      const draftKey = () => databaseName + ":draft:" + activeProfile.value.id;
      const categories = C.CATEGORIES,
        tabs = [
          { id: "home", label: "概览", icon: "wallet" },
          { id: "add", label: "记一笔", icon: "plus" },
          { id: "report", label: "报表", icon: "report" },
          { id: "trend", label: "趋势", icon: "trend" },
        ];
      const sheet = ref(""),
        confirm = ref(null),
        toast = ref(null);
      let toastTimer, confirmResolve, focusBefore;
      const sorted = computed(() =>
        [...state.value.expenses].sort(
          (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt,
        ),
      );
      const monthRows = computed(() =>
        C.within(state.value.expenses, C.range("month", "", now.value)),
      );
      const monthTotal = computed(() => C.sum(monthRows.value));
      const summary = computed(() => [
        {
          name: "今日",
          value: C.sum(
            state.value.expenses.filter((e) => e.date === now.value),
          ),
        },
        {
          name: "本周",
          value: C.sum(
            C.within(state.value.expenses, C.range("week", "", now.value)),
          ),
        },
        {
          name: "今年",
          value: C.sum(
            C.within(state.value.expenses, C.range("year", "", now.value)),
          ),
        },
      ]);
      const budgetRate = computed(() =>
        state.value.budgetCents
          ? Math.round((monthTotal.value / state.value.budgetCents) * 100)
          : 0,
      );
      const blankForm = () => ({
        amount: "",
        category: "餐饮",
        subcategory: "",
        date: now.value,
        note: "",
      });
      const form = ref(blankForm()),
        editing = ref(null),
        formError = ref(""),
        keepAdding = ref(false);
      const dirty = computed(
        () => !!(form.value.amount || form.value.note || editing.value ||
          form.value.category !== "餐饮" || form.value.subcategory || form.value.date !== now.value),
      );
      const formSubs = computed(
        () => state.value.subcategories[form.value.category] || [],
      );
      const categoryInfo = (name) =>
        categories.find((c) => c.name === name) || categories.find((c) => c.name === "其他");
      function notify(message, undo = null) {
        clearTimeout(toastTimer);
        toast.value = { message, undo };
        toastTimer = setTimeout(
          () => (toast.value = null),
          undo ? 10000 : 4500,
        );
      }
      function ask(title, body, action = "确认", danger = false) {
        if (busy.value || confirm.value) return Promise.resolve(false);
        return new Promise((resolve) => {
          confirmResolve = resolve;
          confirm.value = { title, body, action, danger };
        });
      }
      function answer(ok) {
        confirm.value = null;
        confirmResolve?.(ok);
        confirmResolve = null;
      }
      async function commit(fn, recovery = false, target = store) {
        if (busy.value || target !== store || !ready.value) return null;
        busy.value = true;
        try {
          const result = await target.mutate(fn, recovery);
          state.value = result.state;
          return result;
        } catch (e) {
          notify(e.message);
          return null;
        } finally {
          busy.value = false;
        }
      }
      async function boot() {
        loadError.value = "";
        try {
          await store.open();
          profiles.value = await store.profiles();
          let saved;
          try { saved = sessionStorage.getItem(activeProfileKey); } catch { /* Optional preference. */ }
          const profile = profiles.value.find((p) => p.id === saved) || profiles.value[0];
          if (profile.id !== store.profileId) {
            const next = await new WalletStore(databaseName, profile.id).open();
            store.close();
            store = next;
          }
          state.value = await store.load();
          activeProfile.value = profile;
          store.onchange = refresh;
          ready.value = true;
        } catch (e) {
          loadError.value = e.message;
        }
      }
      async function refresh() {
        const old = now.value;
        now.value = C.today();
        if (!dirty.value && form.value.date === old) form.value.date = now.value;
        const target = store;
        if (!ready.value) return;
        if (busy.value) { refreshPending = true; return; }
        refreshPending = false;
        try {
          const users = await target.profiles();
          if (target !== store) return;
          if (busy.value) { refreshPending = true; return; }
          const current = users.find((p) => p.id === target.profileId);
          if (!current) {
            if (confirm.value) answer(false);
            clearProfileDraft(target.profileId);
            ready.value = false;
            resetUserViews();
            state.value = C.initialState();
            busy.value = true;
            try {
              await adoptProfile(users[0]);
              ready.value = true;
              notify(`原用户已在其他窗口删除，已切换到 ${activeProfile.value.name}`);
            } catch (e) { loadError.value = e.message; }
            finally { busy.value = false; }
            return;
          }
          const latest = await target.load();
          if (target !== store) return;
          if (busy.value) { refreshPending = true; return; }
          if (latest.revision >= state.value.revision) state.value = latest;
          profiles.value = users;
          activeProfile.value = current;
          if (editingProfile.value && !users.some((p) => p.id === editingProfile.value.id)) {
            editingProfile.value = null;
            sheet.value = "profiles";
          }
        } catch (e) {
          if (target === store) notify(e.message);
        }
      }
      watch(busy, (value) => {
        if (!value && refreshPending) nextTick(refresh);
      });
      function clearProfileDraft(id) {
        try {
          sessionStorage.removeItem(databaseName + ":draft:" + id);
          if (id === "user1") sessionStorage.removeItem("wallet-pwa-draft");
        } catch { /* Optional session drafts. */ }
      }
      function resetUserViews() {
        clearTimeout(toastTimer);
        toast.value = null;
        form.value = blankForm();
        editing.value = null;
        formError.value = "";
        keepAdding.value = false;
        search.value = filter.value = filterSub.value = "";
        selected.value = [];
        batch.value = false;
        historyLimit.value = 60;
        period.value = granularity.value = "month";
        periodKey.value = C.keyFor("month", now.value);
        reportCategory.value = "";
        chartType.value = "pie";
        trendType.value = "month";
        annualYear.value = now.value.slice(0, 4);
        budgetInput.value = newSub.value = newProfileName.value = "";
        editingProfile.value = null;
        profileNameInput.value = "";
        manageCategory.value = "餐饮";
        importData.value = null;
        importName.value = "";
        importNewer.value = false;
        importTarget = previewStore = null;
        importSequence++;
        exportTarget = null;
        exportMode.value = "all";
        exportCategories.value = [];
        if (importInput.value) importInput.value.value = "";
        sheet.value = "";
        setTab("home");
      }
      async function switchProfile(profile) {
        if (busy.value || confirm.value || profile.id === store.profileId) return;
        if (dirty.value && !(await ask("切换用户并放弃当前输入？",
          `${activeProfile.value.name} 还有未保存的记账内容。已保存的记录会保留在原用户中。`, "切换用户", true))) return;
        if (busy.value) return;
        busy.value = true;
        try {
          await adoptProfile(profile);
          notify(`已切换到 ${activeProfile.value.name}`);
        } catch (e) { notify(e.message); }
        finally { busy.value = false; }
      }
      async function adoptProfile(profile) {
        if (!profile) throw new Error("没有可用用户，请重新打开应用");
        const next = new WalletStore(databaseName, profile.id);
        try {
          await next.open();
          const users = await next.profiles();
          const selectedProfile = users.find((p) => p.id === profile.id);
          if (!selectedProfile) throw new Error("用户不存在，请重新选择");
          const nextState = await next.load();
          store.close();
          store = next;
          store.onchange = refresh;
          state.value = nextState;
          activeProfile.value = selectedProfile;
          profiles.value = users;
          resetUserViews();
          try { sessionStorage.setItem(activeProfileKey, profile.id); } catch { /* Keep working in this tab. */ }
        } catch (e) {
          next.close();
          throw e;
        }
      }
      async function addProfile() {
        if (busy.value) return;
        busy.value = true;
        try {
          const profile = await store.createProfile(newProfileName.value);
          profiles.value = await store.profiles();
          newProfileName.value = "";
          notify(`${profile.name} 已创建，点击即可切换`);
        } catch (e) { notify(e.message); }
        finally { busy.value = false; }
      }
      function editProfile(profile) {
        if (busy.value || confirm.value) return;
        editingProfile.value = { ...profile };
        profileNameInput.value = profile.name;
        sheet.value = "profile-edit";
      }
      async function saveProfileName() {
        if (busy.value || confirm.value || !editingProfile.value) return;
        busy.value = true;
        try {
          const renamed = await store.renameProfile(editingProfile.value.id, profileNameInput.value);
          profiles.value = await store.profiles();
          if (activeProfile.value.id === renamed.id) activeProfile.value = renamed;
          editingProfile.value = null;
          sheet.value = "profiles";
          notify(`用户名已改为 ${renamed.name}，账本保持不变`);
        } catch (e) { notify(e.message); }
        finally { busy.value = false; }
      }
      async function removeProfile(profile) {
        if (busy.value || confirm.value || !profile) return;
        const target = store, inspecting = new WalletStore(databaseName, profile.id);
        let users, snapshot;
        busy.value = true;
        try {
          await inspecting.open();
          users = await inspecting.profiles();
          if (!users.some((p) => p.id === profile.id)) throw new Error("用户不存在，请重新选择");
          if (users.length <= 1) throw new Error("至少保留一个用户，不能删除最后一个用户");
          snapshot = await inspecting.load();
        } catch (e) { notify(e.message); return; }
        finally { inspecting.close(); busy.value = false; }
        if (target !== store) return;
        const selected = users.find((p) => p.id === profile.id);
        const draftWarning = profile.id === activeProfile.value.id && dirty.value
          ? "当前未保存的输入也会被放弃。" : "";
        if (!(await ask(`删除用户「${selected.name}」？`,
          `该用户的 ${snapshot.expenses.length} 笔账目、预算、子分类和导入恢复点会一并删除，无法撤销。${draftWarning}其他用户不受影响。建议先取消并切换到该用户，导出 JSON 完整备份。`,
          "删除用户", true))) return;
        if (busy.value || target !== store) return;
        busy.value = true;
        let deleted = false;
        try {
          const remaining = await target.deleteProfile(profile.id);
          deleted = true;
          clearProfileDraft(profile.id);
          if (profile.id === activeProfile.value.id) {
            ready.value = false;
            state.value = C.initialState();
            resetUserViews();
            await adoptProfile(remaining[0]);
            ready.value = true;
          } else {
            profiles.value = remaining;
            editingProfile.value = null;
            sheet.value = "profiles";
          }
          notify(`${selected.name} 已删除`);
        } catch (e) {
          if (deleted && !ready.value) loadError.value = "用户已删除，切换剩余账本失败，请重新加载。" + e.message;
          else notify(e.message);
        } finally { busy.value = false; }
      }
      function setTab(value) {
        tab.value = value;
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      function selectCategory(name) {
        form.value.category = name;
        form.value.subcategory = "";
      }
      async function saveExpense() {
        formError.value = "";
        let record;
        try {
          const old = editing.value;
          record = C.normalizeRecord({
            ...form.value,
            amountCents: C.cents(form.value.amount),
            id: old?.id || C.newId(),
            createdAt: old?.createdAt || Date.now(),
            updatedAt: Date.now(),
          });
        } catch (e) {
          formError.value = e.message;
          return;
        }
        const result = await commit((s) => {
          if (editing.value) {
            const index = s.expenses.findIndex((e) => e.id === record.id);
            if (
              index < 0 ||
              ![
                "amountCents",
                "category",
                "subcategory",
                "date",
                "note",
                "updatedAt",
              ].every((k) => s.expenses[index][k] === editing.value[k])
            )
              throw new Error("这笔记录已在其他窗口修改，请重新打开记录");
            s.expenses[index] = record;
          } else s.expenses.push(record);
          C.reconcileSubs(s);
        });
        if (result) {
          const edited = !!editing.value;
          editing.value = null;
          form.value = blankForm();
          notify(edited ? "修改已保存" : "记下了这一笔");
          if (!keepAdding.value || edited) setTab("home");
        }
      }
      async function editExpense(e) {
        if (busy.value) return;
        if (
          dirty.value &&
          !(await ask("替换当前输入？", "记账页还有未保存的内容。", "打开记录"))
        )
          return;
        editing.value = C.clone(e);
        form.value = { ...e, amount: (e.amountCents / 100).toFixed(2) };
        formError.value = "";
        sheet.value = "";
        setTab("add");
      }
      async function cancelEdit() {
        if (busy.value) return;
        if (
          dirty.value &&
          !(await ask(
            "放弃当前输入？",
            "已经保存的账目不会受影响。",
            "放弃",
            true,
          ))
        )
          return;
        editing.value = null;
        form.value = blankForm();
        formError.value = "";
        setTab("home");
      }
      async function remove(ids) {
        const target = store;
        if (
          !ids.length ||
          !(await ask(
            `删除 ${ids.length} 笔记录？`,
            "删除后可以通过底部提示撤销。",
            "删除",
            true,
          ))
        )
          return;
        const result = await commit((s) => {
          const gone = s.expenses.filter((e) => ids.includes(e.id));
          s.expenses = s.expenses.filter((e) => !ids.includes(e.id));
          return gone;
        }, false, target);
        if (!result) return;
        selected.value = [];
        batch.value = false;
        if (editing.value && ids.includes(editing.value.id)) {
          editing.value = null;
          form.value = blankForm();
          setTab("home");
        }
        notify(`已删除 ${result.result.length} 笔记录`, async () => {
          const restored = await commit((s) => {
            const existing = new Set(s.expenses.map((e) => e.id));
            s.expenses.push(
              ...result.result.filter((e) => !existing.has(e.id)),
            );
            C.reconcileSubs(s);
          }, false, target);
          if (restored) notify("记录已恢复");
        });
      }
      const search = ref(""),
        filter = ref(""),
        filterSub = ref(""),
        batch = ref(false),
        selected = ref([]),
        historyLimit = ref(60);
      const history = computed(() =>
        sorted.value.filter(
          (e) =>
            (!filter.value || e.category === filter.value) &&
            (!filterSub.value || e.subcategory === filterSub.value) &&
            (!search.value.trim() ||
              `${e.date} ${e.category} ${e.subcategory} ${e.note} ${(e.amountCents / 100).toFixed(2)}`
                .toLowerCase()
                .includes(search.value.trim().toLowerCase())),
        ),
      );
      watch([search, filter, filterSub], () => {
        selected.value = [];
        historyLimit.value = 60;
      });
      watch(filter, () => (filterSub.value = ""));
      function toggleSelected(id) {
        selected.value = selected.value.includes(id)
          ? selected.value.filter((x) => x !== id)
          : [...selected.value, id];
      }
      function selectAll() {
        selected.value =
          selected.value.length === history.value.length
            ? []
            : history.value.map((e) => e.id);
      }
      const historyTotal = computed(() => C.sum(history.value));
      function grouped(rows) {
        const map = new Map();
        for (const row of rows) {
          if (!map.has(row.date)) map.set(row.date, []);
          map.get(row.date).push(row);
        }
        return [...map].map(([date, items]) => ({
          date,
          items,
          total: C.sum(items),
        }));
      }
      const recentGroups = computed(() => grouped(sorted.value.slice(0, 6)));
      const historyGroups = computed(() =>
        grouped(history.value.slice(0, historyLimit.value)),
      );
      function dateLabel(date) {
        if (date === now.value) return "今天";
        if (date === C.addDays(now.value, -1)) return "昨天";
        return `${date.slice(0, 4) !== now.value.slice(0, 4) ? date.slice(0, 4) + "年" : ""}${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
      }
      const period = ref("month"),
        periodKey = ref(C.keyFor("month", now.value)),
        reportCategory = ref(""),
        chartType = ref("pie"),
        granularity = ref("month");
      const periodOptions = computed(() =>
        C.periods(state.value.expenses, period.value, now.value),
      );
      watch(period, (p) => {
        periodKey.value = C.keyFor(p, now.value);
        reportCategory.value = "";
      });
      const reportRows = computed(() =>
        C.within(
          state.value.expenses,
          C.range(period.value, periodKey.value),
        ).filter(
          (e) => !reportCategory.value || e.category === reportCategory.value,
        ),
      );
      const reportTotal = computed(() => C.sum(reportRows.value));
      const reportGroups = computed(() =>
        C.breakdown(reportRows.value, reportCategory.value),
      );
      const reportBuckets = computed(() =>
        C.buckets(
          reportRows.value,
          period.value,
          periodKey.value,
          granularity.value,
          reportCategory.value,
        ),
      );
      const comparison = computed(() => {
        const previous = C.previous(period.value, periodKey.value);
        if (!previous) return "记录每一笔，了解每一分";
        const value = C.sum(
          C.within(state.value.expenses, previous).filter(
            (e) => !reportCategory.value || e.category === reportCategory.value,
          ),
        );
        if (!value)
          return reportTotal.value ? "上期无支出" : "本期与上期均无支出";
        const change = ((reportTotal.value - value) / value) * 100;
        return `较上期${change >= 0 ? "增加" : "减少"} ${Math.abs(change).toFixed(1)}%`;
      });
      function drill(name) {
        if (!reportCategory.value && categories.some((c) => c.name === name))
          reportCategory.value = name;
      }
      const trendType = ref("month"),
        trendRows = computed(() =>
          C.trend(state.value.expenses, trendType.value, now.value),
        );
      const trendTotal = computed(() =>
        trendRows.value.reduce((v, r) => v + r.value, 0),
      );
      const annualYear = ref(now.value.slice(0, 4));
      const annualYears = computed(() =>
        C.periods(state.value.expenses, "year", now.value),
      );
      const annualRows = computed(() =>
        C.within(state.value.expenses, C.range("year", annualYear.value)),
      );
      const annualGroups = computed(() => C.breakdown(annualRows.value));
      const budgetInput = ref(""),
        manageCategory = ref("餐饮"),
        newSub = ref("");
      function openBudget() {
        budgetInput.value = state.value.budgetCents
          ? (state.value.budgetCents / 100).toFixed(2)
          : "";
        sheet.value = "budget";
      }
      async function saveBudget() {
        let value;
        try {
          value = C.cents(budgetInput.value || "0", true);
        } catch (e) {
          notify(e.message);
          return;
        }
        if (
          await commit((s) => {
            s.budgetCents = value;
          })
        ) {
          sheet.value = "";
          notify(value ? "月预算已更新" : "月预算已关闭");
        }
      }
      async function addSub() {
        const name = newSub.value.trim(),
          cat = manageCategory.value;
        if (!name || name.length > 40)
          return notify("子分类名称为 1–40 个字符");
        if (
          await commit((s) => {
            if (s.subcategories[cat].includes(name))
              throw new Error("这个子分类已经存在");
            s.subcategories[cat].push(name);
          })
        ) {
          newSub.value = "";
          notify("子分类已添加");
        }
      }
      async function deleteSub(name) {
        const cat = manageCategory.value;
        if (
          !(await ask(
            `删除“${name}”？`,
            "已被账目使用的子分类不能删除。",
            "删除",
            true,
          ))
        )
          return;
        if (
          await commit((s) => {
            if (
              s.expenses.some(
                (e) => e.category === cat && e.subcategory === name,
              )
            )
              throw new Error("该子分类还有账目，暂时不能删除");
            s.subcategories[cat] = s.subcategories[cat].filter(
              (n) => n !== name,
            );
          })
        )
          notify("子分类已删除");
      }
      const importInput = ref(null),
        importData = ref(null),
        importNewer = ref(false),
        importName = ref("");
      let importTarget = null, previewStore = null, importSequence = 0;
      function beginImport() {
        if (busy.value) return;
        importTarget = store;
        importSequence++;
        importInput.value.click();
      }
      const importPreview = computed(() =>
        importData.value?.type === "csv"
          ? C.previewImport(
              state.value.expenses,
              importData.value.parsed.records,
            )
          : null,
      );
      async function readImport(event) {
        const target = importTarget, sequence = importSequence;
        const file = event.target.files[0];
        event.target.value = "";
        if (!file || target !== store) return;
        if (file.size > 20 * 1024 * 1024)
          return notify("文件超过 20 MB，请拆分 CSV 后导入");
        try {
          const text = await file.text();
          if (target !== store || sequence !== importSequence) return;
          importData.value = file.name.toLowerCase().endsWith(".json")
            ? { type: "backup", ...C.readBackupEnvelope(text) }
            : { type: "csv", parsed: C.parseCSV(text) };
          previewStore = target;
          importName.value = file.name;
          importNewer.value = false;
          sheet.value = "import";
        } catch (e) {
          if (target === store && sequence === importSequence) notify("无法导入：" + e.message);
        }
      }
      async function applyImport() {
        const data = importData.value, target = previewStore, updateNewer = importNewer.value;
        if (!data || target !== store) return;
        if (data.type === "backup") {
          if (
            !(await ask(
              `用备份替换 ${activeProfile.value.name} 的账本？`,
              `将恢复 ${data.state.expenses.length} 笔记录及预算、子分类，仅影响 ${activeProfile.value.name}。替换前会保留该用户的本地恢复点。`,
              "替换并恢复",
              true,
            ))
          )
            return;
          if (
            await commit((s) => Object.assign(s, C.clone(data.state)), true, target)
          ) {
            sheet.value = "";
            notify("完整备份已恢复");
          }
        } else {
          const result = await commit(
            (s) => C.mergeCSV(s, data.parsed.records, updateNewer),
            true, target,
          );
          if (result) {
            sheet.value = "";
            notify(
              `已导入 ${result.result.added} 笔，更新 ${result.result.updated} 笔`,
            );
          }
        }
      }
      function download(text, name, type) {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      const exportMode = ref("all"), exportCategories = ref([]), exportTime = ref(new Date());
      let exportTarget = null;
      const selectedExportCategories = computed(() => categories
        .map((c) => c.name).filter((name) => exportCategories.value.includes(name)));
      const exportRows = computed(() => exportMode.value === "all" ? sorted.value :
        sorted.value.filter((row) => selectedExportCategories.value.includes(row.category)));
      const exportTotal = computed(() => C.sum(exportRows.value));
      const exportCounts = computed(() => {
        const counts = {};
        for (const row of state.value.expenses) counts[row.category] = (counts[row.category] || 0) + 1;
        return counts;
      });
      const exportCategoryLabel = computed(() => exportMode.value === "all" ||
        selectedExportCategories.value.length === categories.length ? "全部" : selectedExportCategories.value.join("+"));
      const exportName = computed(() => exportFileName(exportCategoryLabel.value, "csv", exportTime.value));
      function beginCSVExport() {
        if (busy.value || !ready.value) return;
        exportTarget = store;
        exportMode.value = "all";
        exportCategories.value = [];
        exportTime.value = new Date();
        sheet.value = "export";
      }
      function exportCSV() {
        if (busy.value || !ready.value || exportTarget !== store || sheet.value !== "export") return;
        if (exportMode.value !== "all" && !selectedExportCategories.value.length)
          return notify("请至少选择一个大分类");
        exportTime.value = new Date();
        download(
          C.toCSV(exportRows.value),
          exportName.value,
          "text/csv;charset=utf-8",
        );
        notify(`已生成 ${exportRows.value.length} 笔账目的 CSV，请保存到“文件”`);
      }
      function exportBackup() {
        if (busy.value || !ready.value) return;
        download(
          C.makeBackup(state.value, activeProfile.value),
          exportFileName("全部", "json"),
          "application/json",
        );
        notify("完整备份已生成，请保存到“文件”");
      }
      const canShare = typeof navigator.share === "function";
      function fileUser() {
        const p = activeProfile.value;
        return p.name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").replace(/[. ]+$/, "") || p.id;
      }
      function exportFileName(category, extension, at = new Date()) {
        const pad = (value) => String(value).padStart(2, "0");
        const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
        const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
        return `${fileUser()}_${category}_${date}_${time}.${extension}`;
      }
      async function shareBackup() {
        if (busy.value || !ready.value) return;
        const target = store;
        try {
          const file = new File(
            [C.makeBackup(state.value, activeProfile.value)],
            exportFileName("全部", "json"),
            { type: "application/json" },
          );
          if (!navigator.canShare?.({ files: [file] })) return exportBackup();
          await navigator.share({ files: [file], title: "Wallet 完整备份" });
        } catch (e) {
          if (target === store && e.name !== "AbortError") notify("分享失败，请使用导出完整备份");
        }
      }
      async function restoreRecovery() {
        if (busy.value || confirm.value) return;
        const target = store, profileName = activeProfile.value.name;
        try {
          const backup = await target.recovery();
          if (target !== store) return;
          if (!backup) return notify("还没有导入前恢复点");
          if (
            !(await ask(
              `恢复 ${profileName} 上次导入前的账本？`,
              `将恢复 ${backup.expenses.length} 笔记录，仅替换 ${profileName} 的账本。`,
              "恢复",
              true,
            ))
          )
            return;
          if (await commit((s) => Object.assign(s, backup), true, target))
            notify("已恢复上次导入前的账本");
        } catch (e) {
          if (target === store) notify(e.message);
        }
      }
      const offline = ref(!navigator.onLine),
        cacheReady = ref(false),
        updateReady = ref(false),
        swError = ref(""),
        persistent = ref(false);
      let registration,
        applyingUpdate = false;
      const standalone =
        matchMedia("(display-mode: standalone)").matches ||
        navigator.standalone === true;
      async function initPWA() {
        if (!("serviceWorker" in navigator) || !isSecureContext) {
          swError.value = "离线模式需要通过 HTTPS 或 localhost 打开";
          return;
        }
        try {
          registration = await navigator.serviceWorker.register("./sw.js");
          const watchWorker = (worker) => {
            if (!worker) return;
            worker.addEventListener("statechange", () => {
              if (worker.state === "installed") {
                if (navigator.serviceWorker.controller)
                  updateReady.value = true;
                else cacheReady.value = true;
              }
            });
          };
          updateReady.value = !!registration.waiting;
          registration.addEventListener("updatefound", () =>
            watchWorker(registration.installing),
          );
          watchWorker(registration.installing);
          await navigator.serviceWorker.ready;
          cacheReady.value = true;
          persistent.value = !!(await navigator.storage?.persisted?.());
        } catch (e) {
          swError.value = "离线资源尚未准备好，请联网后重试";
        }
      }
      async function updateApp() {
        if (busy.value || confirm.value) return;
        if (
          dirty.value &&
          !(await ask(
            "保存草稿并更新？",
            "当前输入会暂存，更新后继续填写。",
            "更新",
          ))
        )
          return;
        try {
          sessionStorage.setItem(
            draftKey(),
            JSON.stringify({
              profileId: activeProfile.value.id,
              form: form.value,
              editing: editing.value,
              tab: tab.value,
            }),
          );
        } catch (e) {
          notify("草稿暂存失败，请先保存记账后更新");
          return;
        }
        const reload = () => {
          if (applyingUpdate) return;
          applyingUpdate = true;
          location.reload();
        };
        if (registration?.waiting) {
          notify("正在启用新版本…");
          navigator.serviceWorker.addEventListener("controllerchange", reload, {
            once: true,
          });
          registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
        } else reload();
      }
      async function checkUpdate() {
        if (!registration) {
          await initPWA();
        } else {
          try {
            await registration.update();
            notify(registration.waiting ? "有新版本可以更新" : "已检查更新");
          } catch (e) {
            notify("更新检查失败，请确认网络连接");
          }
        }
      }
      async function persistStorage() {
        try {
          persistent.value = !!(await navigator.storage?.persist?.());
          notify(
            persistent.value
              ? "已开启持久存储，仍建议定期备份"
              : "系统未授予持久存储，请定期导出备份",
          );
        } catch (e) {
          notify("当前环境无法申请持久存储");
        }
      }
      const titles = {
        profiles: "切换用户",
        "profile-edit": "编辑用户",
        settings: "设置",
        history: "全部账目",
        budget: "月预算",
        categories: "子分类",
        import: "导入预览",
        export: "导出账目 CSV",
        install: "放到主屏幕",
      };
      function closeSheet() {
        sheet.value = "";
      }
      watch(
        () => !!sheet.value || !!confirm.value,
        (active) => {
          if (active) {
            focusBefore = document.activeElement;
            document.body.classList.add("modal-open");
          } else {
            document.body.classList.remove("modal-open");
            nextTick(() => focusBefore?.focus());
          }
        },
      );
      watch([sheet, confirm], () =>
        nextTick(() => {
          const dialogs = document.querySelectorAll('[role="dialog"]');
          dialogs[dialogs.length - 1]?.focus();
        }),
      );
      onMounted(async () => {
        await boot();
        initPWA();
        try {
          // The pre-profile update draft belongs to the legacy user1 only.
          const legacy = activeProfile.value.id === "user1" ? sessionStorage.getItem("wallet-pwa-draft") : null;
          const draft = JSON.parse(sessionStorage.getItem(draftKey()) || legacy);
          if (ready.value && (!draft?.profileId || draft.profileId === activeProfile.value.id) && draft?.form && typeof draft.form.amount === "string") {
            form.value = draft.form;
            editing.value = draft.editing;
            tab.value = draft.tab || "add";
          }
          sessionStorage.removeItem(draftKey());
          if (legacy) sessionStorage.removeItem("wallet-pwa-draft");
        } catch (e) {
          /* Optional update draft only. */
        }
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) refresh();
        });
        setInterval(() => {
          if (!document.hidden) refresh();
        }, 60000);
        window.addEventListener("online", () => (offline.value = false));
        window.addEventListener("offline", () => (offline.value = true));
        window.addEventListener("beforeunload", (e) => {
          if (dirty.value && !applyingUpdate) {
            e.preventDefault();
            e.returnValue = "";
          }
        });
        const viewport = window.visualViewport;
        if (viewport) {
          const adaptViewport = () => {
            const keyboard =
              ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) &&
              window.innerHeight - viewport.height > 140;
            document.body.classList.toggle("keyboard-open", keyboard);
            document.documentElement.style.setProperty(
              "--visible-height",
              viewport.height + "px",
            );
            document.documentElement.style.setProperty(
              "--viewport-top",
              viewport.offsetTop + "px",
            );
          };
          viewport.addEventListener("resize", adaptViewport);
          viewport.addEventListener("scroll", adaptViewport);
          document.addEventListener("focusin", adaptViewport);
          document.addEventListener("focusout", adaptViewport);
          adaptViewport();
        }
        window.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            if (confirm.value) answer(false);
            else closeSheet();
          }
          if (e.key !== "Tab" || (!sheet.value && !confirm.value)) return;
          const dialogs = document.querySelectorAll('[role="dialog"]'),
            dialog = dialogs[dialogs.length - 1];
          const nodes = [
            ...dialog.querySelectorAll(
              'button,input,select,textarea,[tabindex="0"]',
            ),
          ].filter((el) => !el.disabled && el.getClientRects().length);
          if (!nodes.length) {
            e.preventDefault();
            return;
          }
          const first = nodes[0],
            last = nodes[nodes.length - 1];
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === dialog)
          ) {
            e.preventDefault();
            last.focus();
          } else if (
            !e.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === dialog)
          ) {
            e.preventDefault();
            first.focus();
          }
        });
      });
      return {
        C,
        profiles,
        activeProfile,
        newProfileName,
        editingProfile,
        profileNameInput,
        switchProfile,
        addProfile,
        editProfile,
        saveProfileName,
        removeProfile,
        state,
        ready,
        loadError,
        boot,
        busy,
        tab,
        tabs,
        categories,
        sheet,
        titles,
        confirm,
        answer,
        toast,
        notify,
        sorted,
        monthRows,
        monthTotal,
        summary,
        budgetRate,
        now,
        form,
        editing,
        formError,
        keepAdding,
        formSubs,
        categoryInfo,
        setTab,
        selectCategory,
        saveExpense,
        editExpense,
        cancelEdit,
        remove,
        search,
        filter,
        filterSub,
        batch,
        selected,
        historyLimit,
        history,
        historyTotal,
        historyGroups,
        recentGroups,
        dateLabel,
        toggleSelected,
        selectAll,
        period,
        periodKey,
        periodOptions,
        reportCategory,
        chartType,
        granularity,
        reportRows,
        reportTotal,
        reportGroups,
        reportBuckets,
        comparison,
        drill,
        trendType,
        trendRows,
        trendTotal,
        annualYear,
        annualYears,
        annualRows,
        annualGroups,
        budgetInput,
        manageCategory,
        newSub,
        openBudget,
        saveBudget,
        addSub,
        deleteSub,
        importInput,
        importData,
        importPreview,
        importNewer,
        importName,
        beginImport,
        readImport,
        applyImport,
        beginCSVExport,
        exportMode,
        exportCategories,
        selectedExportCategories,
        exportRows,
        exportTotal,
        exportCounts,
        exportCategoryLabel,
        exportName,
        exportCSV,
        exportBackup,
        canShare,
        shareBackup,
        restoreRecovery,
        offline,
        cacheReady,
        swError,
        persistent,
        standalone,
        updateReady,
        updateApp,
        checkUpdate,
        persistStorage,
        closeSheet,
      };
    },
  });
  app.component("w-icon", WalletIcon);
  app.component("wallet-chart", WalletChart);
  app.mount("#app");
})();
