# AGENTS.md

## Repo
- Single-page app with **no build system, package manager, or test runner**. Open `index.html` in Chrome/Edge directly.
- `index.html` (~2130 lines) is the sole entrypoint. All app code and vendored Vue 3 / ECharts / Day.js are inline. App code starts ~line 630 (`const { createApp, ... } = Vue`).
- `css/style.css` **is loaded** from `index.html` via `<link>` (it imports `css/variables.css` via `@import`). The `lib/` directory exists but is **not loaded** (standalone copies for reference only).
- Dark theme only (CSS custom properties in `css/variables.css`).

## Run & Verify
- No lint, typecheck, test, or build commands exist. Verify manually in Chrome/Edge (File System Access API required for CSV auto-sync).
- Smoke test: open `index.html`, add/edit/delete an expense, switch tabs, confirm charts render, test CSV export/import.

## Architecture
- **4 tabs** (home / add / report / trend) — use `v-show` (not `v-if`) to preserve chart DOM state on tab switches.
- **localStorage keys**: `wallet_expenses` (JSON array), `wallet_subcategories`, `wallet_budget`.
- **Expense object shape**: `{id, amount, category, subcategory, date, note, createdAt, updatedAt}`.
- **7 categories**: 餐饮, 交通, 购物, 居住, 娱乐, 医疗, 其他 — each with predefined subcategories.
- CSV file is `data/expenses.csv` (gitignored, created on first File System Access sync).
- Report watchers at end of file re-init charts on changes to `reportPeriod`, `reportChartType`, `reportCategory`, `reportGranularity`, `reportSpecificPeriod`.

## Editing
- **Avoid editing the vendored library blobs** at the top of `index.html`. The app code starts after them.
- `CLAUDE.md` has detailed verified refs, chart helpers, and storage flows — check it before non-trivial changes.

## Desktop App (desktop-app branch)

- `desktop/` is a **Wails v2** Windows app (Go + system WebView2). Build: `cd desktop && wails build` → `desktop/build/bin/Wallet.exe` (~12MB). Requires Go + Wails CLI; no Node, no admin.
- Frontend lives in `desktop/frontend/dist/` and is served/embedded as-is (no bundler): `js/domain/` (pure logic: periods/csv/aggregate), `js/storage.js` (localStorage + desktop file bridge), `js/charts.js`, `js/app.js` (Vue). Vendor libs mirror root `lib/`.
- Run domain golden tests with `node desktop/tests/test-domain.js`.
- Desktop-only fixes over the web version are listed in `desktop/README.md` (persistent CSV sync path, corrupt-data backup, in-app confirm/toast with undo, ISO week-1 Monday time-of-day fix, ResizeObserver chart resize).
- The root `index.html` web version remains unchanged and independent.
