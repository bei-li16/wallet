"use strict";
document.querySelector("#run").onclick = async () => {
  const out = document.querySelector("#result"),
    button = document.querySelector("#run");
  button.disabled = true;
  out.textContent = "Running…\n";
  const C = WalletCore,
    name = "wallet-disposable-test-" + crypto.randomUUID(),
    a = new WalletStore(name),
    b = new WalletStore(name);
  const profileName = name + "-profiles", corruptName = name + "-corrupt", managementName = name + "-management", categoryName = name + "-categories";
  const connections = [a, b];
  const seedLegacy = (database, state, recovery) => new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("wallet");
      store.put(state, "state");
      if (recovery) store.put(recovery, "recovery");
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
  let passed = 0;
  const assert = (value, message) => {
    if (!value) throw new Error(message);
    passed++;
    out.textContent += "PASS " + message + "\n";
  };
  const row = (id) =>
    C.normalizeRecord({
      id,
      amountCents: 29,
      category: "餐饮",
      subcategory: "早餐",
      date: "2026-10-01",
      note: id,
    });
  try {
    await a.open();
    await b.open();
    assert((await a.load()).expenses.length === 0, "new database starts empty");
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        (i % 2 ? a : b).mutate((s) => s.expenses.push(row(String(i)))),
      ),
    );
    let state = await a.load();
    assert(
      state.expenses.length === 50 && state.revision === 50,
      "50 concurrent mutations across connections preserve every record",
    );
    assert(C.sum(state.expenses) === 1450, "stored integer totals stay exact");
    let aborted = false;
    try {
      await a.mutate((s) => {
        s.expenses = [];
        throw new Error("intentional failure");
      });
    } catch {
      aborted = true;
    }
    assert(
      aborted && (await b.load()).expenses.length === 50,
      "thrown mutation rolls back atomically",
    );
    aborted = false;
    try {
      await a.mutate((s) => {
        s.budgetCents = -1;
      });
    } catch {
      aborted = true;
    }
    assert(
      aborted && (await b.load()).budgetCents === 0,
      "invalid data cannot overwrite committed snapshot",
    );
    await a.mutate((s) => {
      s.expenses = [row("restored")];
      s.budgetCents = 20000;
    }, true);
    assert(
      (await a.load()).expenses.length === 1,
      "replacement commits as one snapshot",
    );
    assert(
      (await a.recovery()).expenses.length === 50,
      "replacement retains previous snapshot recovery",
    );
    a.db.close();
    a.db = null;
    await a.open();
    assert(
      (await a.load()).budgetCents === 20000,
      "closing and reopening persists settings",
    );
    await a.mutate((s) => C.mergeCSV(s, [row("csv")]), true);
    assert(
      (await b.load()).expenses.length === 2,
      "CSV merge commits with fresh transaction state",
    );
    const backup = C.readBackup(C.makeBackup(await a.load()));
    assert(
      backup.expenses.length === 2 && backup.budgetCents === 20000,
      "backup reflects committed records and settings",
    );
    const legacy = C.initialState(), prior = C.initialState();
    legacy.expenses = [row("same-id")];
    legacy.budgetCents = 10000;
    legacy.subcategories.餐饮.push("user1-only");
    prior.expenses = [row("legacy-recovery")];
    delete legacy.subcategories.AI; delete prior.subcategories.AI;
    await seedLegacy(profileName, legacy, prior);
    const u1 = new WalletStore(profileName, "user1"), u2 = new WalletStore(profileName, "user2"),
      otherTab = new WalletStore(profileName, "user1");
    connections.push(u1, u2, otherTab);
    await u1.open(); await u2.open(); await otherTab.open();
    assert(JSON.stringify(await u1.load()) === JSON.stringify(C.validateState(legacy)), "seven-category v1 state migrates intact to user1 and gains AI");
    assert((await u1.recovery()).expenses[0].id === "legacy-recovery", "legacy recovery migrates to user1");
    assert((await u2.load()).expenses.length === 0 && (await u2.recovery()) === null, "user2 starts empty without user1 recovery");
    assert((await u1.profiles()).map((p) => p.name).join() === "user1,user2", "default users persist in profile registry");
    await u2.mutate((s) => {
      s.expenses = [{ ...row("same-id"), amountCents: 888 }];
      s.budgetCents = 20000;
      s.subcategories.餐饮.push("user2-only");
    });
    assert((await u1.load()).expenses[0].amountCents === 29 && (await u2.load()).expenses[0].amountCents === 888,
      "identical expense IDs remain independent between users");
    assert((await u1.load()).budgetCents === 10000 && !(await u1.load()).subcategories.餐饮.includes("user2-only"),
      "budgets and custom subcategories are per user");
    await u1.mutate((s) => { s.expenses[0].note = "only-user1"; });
    const unchangedU2 = JSON.stringify(await u2.load());
    await u1.mutate((s) => { s.expenses = []; });
    assert(JSON.stringify(await u2.load()) === unchangedU2, "editing and deleting user1 does not modify user2");
    await u1.mutate((s) => C.mergeCSV(s, C.parseCSV(C.toCSV([row("csv-user1")])).records), true);
    assert((await u1.recovery()).expenses.length === 0 && (await u2.recovery()) === null,
      "CSV imports save only the target user's recovery point");
    const snapshot = C.makeBackup(await u2.load(), { id: "user2", name: "user2" });
    assert(C.parseCSV(C.toCSV((await u1.load()).expenses)).records.every((r) => r.id === "csv-user1") &&
      C.readBackup(snapshot).expenses[0].amountCents === 888, "CSV and JSON exports contain only the selected user's data");
    await u2.mutate((s) => Object.assign(s, C.readBackup(C.makeBackup(prior))), true);
    assert((await u1.load()).expenses[0].id === "csv-user1" && (await u2.recovery()).expenses[0].amountCents === 888,
      "legacy JSON replacement affects only its chosen target user");
    const recovery = await u2.recovery();
    await u2.mutate((s) => Object.assign(s, recovery), true);
    assert((await u2.load()).expenses[0].amountCents === 888 && (await u1.recovery()).expenses.length === 0,
      "restoring user2 does not replace user1 state or recovery");
    const created = await u1.createProfile("Personal");
    let duplicate = false;
    try { await u2.createProfile("personal"); } catch { duplicate = true; }
    assert(duplicate && (await otherTab.profiles()).some((p) => p.id === created.id),
      "profile registry is shared and rejects duplicate names atomically");
    const custom = new WalletStore(profileName, created.id);
    connections.push(custom); await custom.open();
    assert((await custom.load()).expenses.length === 0, "created profiles have an independent empty ledger");
    const invalid = new WalletStore(profileName, "missing-user");
    connections.push(invalid); await invalid.open();
    let unknown = false;
    try { await invalid.mutate((s) => s.expenses.push(row("invalid"))); } catch { unknown = true; }
    assert(unknown, "mutations cannot create orphan data for unknown users");
    u2.db.close(); u2.db = null; await u2.open();
    assert((await u2.load()).expenses[0].amountCents === 888, "user2 state persists across reopened connections");
    // Wait for a same-user broadcast; sibling-user messages must be filtered.
    let u2Notices = 0;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("same-user broadcast timed out")), 2000);
      otherTab.onchange = () => { clearTimeout(timeout); resolve(); };
      u2.onchange = () => u2Notices++;
      u1.mutate((s) => { s.budgetCents = 10100; }).catch(reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(u2Notices === 0 && (await otherTab.load()).budgetCents === 10100,
      "cross-tab notifications refresh the same user without switching another user");
    const m1 = new WalletStore(managementName), m2 = new WalletStore(managementName, "user2");
    connections.push(m1, m2); await m1.open(); await m2.open();
    await m1.mutate((s) => { s.expenses = [row("managed")]; s.budgetCents = 50000; s.subcategories.餐饮.push("special"); });
    await m1.mutate((s) => { s.expenses[0].note = "updated"; }, true);
    await m2.mutate((s) => { s.expenses = [row("survivor")]; });
    const managedBefore = JSON.stringify(await m1.load()), recoveryBefore = JSON.stringify(await m1.recovery());
    const renamed = await m2.renameProfile("user1", "用车消费");
    assert(renamed.id === "user1" && renamed.name === "用车消费" &&
      JSON.stringify(await m1.load()) === managedBefore && JSON.stringify(await m1.recovery()) === recoveryBefore,
      "rename preserves stable identity, records, budget, subcategories and recovery");
    let renameRejected = 0;
    for (const candidate of ["USER2", " ", "a".repeat(25)]) {
      try { await m1.renameProfile("user1", candidate); } catch { renameRejected++; }
    }
    assert(renameRejected === 3 && (await m1.profiles()).find((p) => p.id === "user1").name === "用车消费",
      "duplicate, blank and oversized names cannot overwrite a profile");
    const racingNames = await Promise.allSettled([m1.renameProfile("user1", "共享名字"), m2.renameProfile("user2", "共享名字")]);
    assert(racingNames.filter((r) => r.status === "fulfilled").length === 1 &&
      new Set((await m1.profiles()).map((p) => p.name)).size === 2,
      "concurrent renames enforce uniqueness in serialized IndexedDB transactions");
    const survivorBefore = JSON.stringify(await m2.load());
    const deletedAndLateWrite = await Promise.allSettled([
      m1.deleteProfile("user1"), m1.mutate((s) => s.expenses.push(row("late-write"))),
    ]);
    const rawDeleted = await new Promise((resolve) => {
      const wallet = m1.db.transaction("wallet").objectStore("wallet"), values = {};
      wallet.get("user:user1:state").onsuccess = (event) => { values.state = event.target.result; };
      wallet.get("user:user1:recovery").onsuccess = (event) => { values.recovery = event.target.result; resolve(values); };
    });
    assert(deletedAndLateWrite[0].status === "fulfilled" && deletedAndLateWrite[1].status === "rejected" &&
      rawDeleted.state === undefined && rawDeleted.recovery === undefined &&
      !(await m1.profiles()).some((p) => p.id === "user1"),
      "deletion atomically removes profile, snapshot and recovery; stale writes cannot resurrect it");
    assert(JSON.stringify(await m2.load()) === survivorBefore,
      "deleting a user leaves another user's ledger byte-for-byte intact");
    let missingReads = false;
    try { await m1.load(); } catch { missingReads = true; }
    assert(missingReads, "deleted users cannot be loaded as misleading empty ledgers");
    const recreated = await m2.createProfile("用车消费"), fresh = new WalletStore(managementName, recreated.id);
    connections.push(fresh); await fresh.open();
    assert(recreated.id !== "user1" && (await fresh.load()).expenses.length === 0,
      "reusing a deleted display name creates a new identity without old records");
    const deletionRace = await Promise.allSettled([m2.deleteProfile("user2"), fresh.deleteProfile(recreated.id)]);
    const survivors = await fresh.profiles();
    assert(deletionRace.filter((r) => r.status === "fulfilled").length === 1 && survivors.length === 1,
      "concurrent deletions cannot remove the last surviving user");
    let lastRejected = false;
    try { await fresh.deleteProfile(survivors[0].id); } catch { lastRejected = true; }
    assert(lastRejected && (await fresh.profiles()).length === 1, "last-user protection is enforced in storage, not only the UI");
    const corrupt = { version: 1, expenses: "broken-original-data" };
    await seedLegacy(corruptName, corrupt);
    const bad = new WalletStore(corruptName); connections.push(bad); await bad.open();
    let corruptRejected = false;
    try { await bad.load(); } catch { corruptRejected = true; }
    const raw = await new Promise((resolve) => {
      const request = bad.db.transaction("wallet").objectStore("wallet").get("user:user1:state");
      request.onsuccess = () => resolve(request.result);
    });
    assert(corruptRejected && JSON.stringify(raw) === JSON.stringify(corrupt),
      "migration preserves corrupt legacy bytes instead of silently replacing them with an empty ledger");
    const c1 = new WalletStore(categoryName), c2 = new WalletStore(categoryName, "user2");
    connections.push(c1, c2); await c1.open(); await c2.open();
    const own = C.initialState(); own.subcategories.AI = []; own.budgetCents = 500;
    await new Promise((resolve, reject) => {
      const tx = c1.db.transaction("wallet", "readwrite"), wallet = tx.objectStore("wallet");
      wallet.put(legacy, c1.stateKey); wallet.put(prior, c1.recoveryKey); wallet.put(own, c2.stateKey);
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error);
    });
    assert(JSON.stringify(await c1.load()) === JSON.stringify(C.validateState(legacy)) &&
      JSON.stringify((await c1.recovery()).subcategories.AI) === JSON.stringify(C.SUBS.AI),
      "existing v2 ledger and recovery gain AI while preserving original data");
    const rawLegacy = await new Promise((resolve) => {
      const request = c1.db.transaction("wallet").objectStore("wallet").get(c1.stateKey);
      request.onsuccess = () => resolve(request.result);
    });
    assert(JSON.stringify(rawLegacy) === JSON.stringify(legacy), "reading an old ledger never modifies the raw snapshot");
    const ai = { ...row("ai-subscription"), category: "AI", subcategory: "ChatGPT", amountCents: 19900 };
    await c1.mutate((s) => C.mergeCSV(s, C.parseCSV(C.toCSV([ai])).records), true);
    assert((await c1.load()).expenses.some((e) => e.category === "AI" && e.amountCents === 19900) &&
      (await c1.load()).subcategories.AI.includes("ChatGPT") &&
      (await c1.recovery()).expenses[0].id === "same-id",
      "AI CSV import commits with custom subcategory and retains a compatible recovery point");
    c1.db.close(); c1.db = null; await c1.open();
    assert((await c1.load()).subcategories.AI.includes("ChatGPT") &&
      JSON.stringify(await c2.load()) === JSON.stringify(own),
      "AI data persists across reopening without modifying another user's explicit empty list or budget");
    out.textContent += `\n${passed} / ${passed} PASSED`;
  } catch (e) {
    out.textContent += "\nFAILED: " + e.stack;
  } finally {
    connections.forEach((store) => store.close());
    for (const database of [name, profileName, corruptName, managementName, categoryName]) indexedDB.deleteDatabase(database);
    button.disabled = false;
  }
};
