# AGENTS.md

## Repo
- Single-page app with **no build system, package manager, or test runner**. Open `index.html` in Chrome/Edge directly.
- `index.html` (~2920 lines) is the sole entrypoint. All app code, styles, and vendored Vue 3 / ECharts / Day.js are inline. App code starts ~line 1334 (`const { createApp, ... } = Vue`).
- `css/` and `lib/` exist but **`index.html` does not load them** — edits there have no effect unless you also wire them in.
- Dark theme only (CSS custom properties in `css/variables.css` but not linked from `index.html`).

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
