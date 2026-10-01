/* One versioned snapshot per transaction: a mutation always sees the latest committed state. */
(function (global) {
  "use strict";
  const C = global.WalletCore;
  class WalletStore {
    constructor(name, profileId = "user1") {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profileId))
        throw new Error("无效的用户标识");
      this.name = name;
      Object.defineProperty(this, "profileId", { value: profileId });
      this.stateKey = `user:${profileId}:state`;
      this.recoveryKey = `user:${profileId}:recovery`;
      this.db = null;
      this.channel =
        typeof BroadcastChannel === "function"
          ? new BroadcastChannel(name)
          : null;
      this.onchange = () => {};
      if (this.channel) this.channel.onmessage = ({ data }) => {
        if (data?.profileId === this.profileId || data?.type === "profiles")
          this.onchange();
      };
    }
    open() {
      return new Promise((resolve, reject) => {
        if (this.db) return resolve(this);
        let blocked = false;
        const request = indexedDB.open(this.name, 2);
        request.onupgradeneeded = (event) => {
          // All legacy snapshots move atomically, including unvalidated raw data.
          const db = request.result, tx = request.transaction;
          const wallet = event.oldVersion === 0
            ? db.createObjectStore("wallet") : tx.objectStore("wallet");
          const profiles = db.createObjectStore("profiles", { keyPath: "id" });
          profiles.add({ id: "user1", name: "user1", createdAt: 1 });
          profiles.add({ id: "user2", name: "user2", createdAt: 2 });
          for (const key of ["state", "recovery"]) {
            const old = wallet.get(key);
            old.onsuccess = () => {
              if (old.result !== undefined) {
                wallet.put(old.result, `user:user1:${key}`);
                wallet.delete(key);
              }
            };
          }
        };
        request.onerror = () =>
          reject(new Error("无法打开本地账本，请检查浏览器存储权限"));
        request.onblocked = () => {
          blocked = true;
          reject(new Error("请关闭其他 Wallet 窗口后重试"));
        };
        request.onsuccess = () => {
          if (blocked) { request.result.close(); return; }
          this.db = request.result;
          this.db.onversionchange = () => {
            this.db.close();
            this.db = null;
            this.onchange();
          };
          resolve(this);
        };
      });
    }
    close() {
      this.onchange = () => {};
      this.db?.close();
      this.db = null;
      this.channel?.close();
    }
    profiles() {
      return new Promise((resolve, reject) => {
        const request = this.db.transaction("profiles", "readonly")
          .objectStore("profiles").getAll();
        request.onsuccess = () => resolve(request.result.sort((a, b) =>
          a.createdAt - b.createdAt || a.id.localeCompare(b.id)));
        request.onerror = () => reject(new Error("读取用户列表失败"));
      });
    }
    createProfile(name) {
      return new Promise((resolve, reject) => {
        name = String(name).trim();
        if (!name || name.length > 24) return reject(new Error("用户名为 1–24 个字符"));
        const tx = this.db.transaction("profiles", "readwrite"),
          profiles = tx.objectStore("profiles"), request = profiles.getAll();
        let profile, failure;
        request.onsuccess = () => {
          if (request.result.some((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
            failure = new Error("这个用户名已经存在");
            tx.abort();
            return;
          }
          profile = { id: C.newId(), name, createdAt: Date.now() };
          profiles.add(profile);
        };
        tx.oncomplete = () => {
          this.channel?.postMessage({ type: "profiles" });
          resolve(profile);
        };
        tx.onabort = tx.onerror = () => reject(failure || new Error("创建用户失败，请重试"));
      });
    }
    renameProfile(id, name) {
      return new Promise((resolve, reject) => {
        name = String(name).trim();
        if (!name || name.length > 24) return reject(new Error("用户名为 1–24 个字符"));
        const tx = this.db.transaction("profiles", "readwrite"),
          profiles = tx.objectStore("profiles"), request = profiles.getAll();
        let updated, failure;
        request.onsuccess = () => {
          const profile = request.result.find((p) => p.id === id);
          if (!profile) failure = new Error("用户不存在，请重新选择");
          else if (request.result.some((p) => p.id !== id &&
            p.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
            failure = new Error("这个用户名已经存在");
          if (failure) { tx.abort(); return; }
          updated = { ...profile, name };
          profiles.put(updated);
        };
        tx.oncomplete = () => {
          this.channel?.postMessage({ type: "profiles" });
          resolve(updated);
        };
        tx.onabort = tx.onerror = () => reject(failure || new Error("修改用户名失败，请重试"));
      });
    }
    deleteProfile(id) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(["profiles", "wallet"], "readwrite"),
          profiles = tx.objectStore("profiles"), wallet = tx.objectStore("wallet"),
          request = profiles.getAll();
        let remaining, failure;
        request.onsuccess = () => {
          if (!request.result.some((p) => p.id === id))
            failure = new Error("用户不存在，请重新选择");
          else if (request.result.length === 1)
            failure = new Error("至少保留一个用户，不能删除最后一个用户");
          if (failure) { tx.abort(); return; }
          remaining = request.result.filter((p) => p.id !== id)
            .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
          profiles.delete(id);
          wallet.delete(`user:${id}:state`);
          wallet.delete(`user:${id}:recovery`);
        };
        tx.oncomplete = () => {
          this.channel?.postMessage({ type: "profiles" });
          resolve(remaining);
        };
        tx.onabort = tx.onerror = () => reject(failure || new Error("删除用户失败，请重试"));
      });
    }
    load() {
      return new Promise((resolve, reject) => {
        if (!this.db)
          return reject(new Error("账本连接已关闭，请重新打开应用"));
        const tx = this.db.transaction(["wallet", "profiles"], "readonly"),
          request = tx.objectStore("wallet").get(this.stateKey);
        const profile = tx.objectStore("profiles").get(this.profileId);
        let state, failure;
        profile.onsuccess = () => {
          if (!profile.result) { failure = new Error("用户不存在，请重新选择"); tx.abort(); }
        };
        request.onsuccess = () => {
          try {
            state = request.result ? C.validateState(request.result) : C.initialState();
          } catch (e) {
            failure = new Error("本地数据无法读取，原始数据已保留。" + e.message);
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve(state);
        tx.onabort = tx.onerror = () => reject(failure || new Error("读取账本失败，请重试"));
      });
    }
    mutate(change, saveRecovery = false) {
      return new Promise((resolve, reject) => {
        if (!this.db)
          return reject(new Error("账本连接已关闭，请重新打开应用"));
        let result, next, failure;
        const tx = this.db.transaction(["wallet", "profiles"], "readwrite"),
          store = tx.objectStore("wallet"),
          request = store.get(this.stateKey);
        const profile = tx.objectStore("profiles").get(this.profileId);
        profile.onsuccess = () => {
          if (!profile.result) { failure = new Error("用户不存在"); tx.abort(); }
        };
        request.onsuccess = () => {
          try {
            const current = request.result
              ? C.validateState(request.result)
              : C.initialState();
            if (saveRecovery) store.put(current, this.recoveryKey);
            next = C.clone(current);
            result = change(next);
            next = C.validateState(next);
            next.revision = current.revision + 1;
            store.put(next, this.stateKey);
          } catch (e) {
            failure = e;
            tx.abort();
          }
        };
        tx.oncomplete = () => {
          if (this.channel) this.channel.postMessage({ profileId: this.profileId, revision: next.revision });
          resolve({ state: next, result });
        };
        tx.onabort = tx.onerror = () =>
          reject(
            failure ||
              new Error(
                tx.error && tx.error.name === "QuotaExceededError"
                  ? "设备存储空间不足，尚未保存。请释放空间后重试"
                  : "保存失败，输入仍然保留，请重试",
              ),
          );
      });
    }
    recovery() {
      return new Promise((resolve, reject) => {
        const request = this.db
          .transaction("wallet", "readonly")
          .objectStore("wallet")
          .get(this.recoveryKey);
        request.onsuccess = () => {
          try {
            resolve(request.result ? C.validateState(request.result) : null);
          } catch (e) {
            reject(e);
          }
        };
        request.onerror = () => reject(new Error("读取恢复点失败"));
      });
    }
  }
  global.WalletStore = WalletStore;
})(window);
