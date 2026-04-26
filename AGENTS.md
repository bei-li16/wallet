# AGENTS.md

## Repo Shape
- This repo is a single-page app with no build system, package manager, or test runner. Open `index.html` directly in a browser to run it.
- The real app entrypoint is `index.html`. It contains the HTML, app CSS, Vue app setup, chart logic, CSV import/export, and embedded copies of Vue, ECharts, and Day.js.
- `css/` and `lib/` exist, but the current `index.html` does not load files from them. Do not assume edits there affect the running app unless you also wire them into `index.html`.

## Run And Verify
- Preferred verification is manual in Chrome or Edge because CSV auto-sync depends on the File System Access API.
- There is no repo-defined lint, typecheck, test, or build command to run.
- The simplest smoke test is: open `index.html`, add/edit/delete an expense, switch tabs, verify charts render, and verify CSV import/export or sync behavior.

## Architecture Notes
- Keep the tab pages on `v-show`, not `v-if`; the app relies on preserved DOM/chart state when switching tabs.
- Report behavior depends on these refs/computed flows in `index.html`: `reportPeriod`, `reportChartType`, `reportCategory`, `reportGranularity`, `reportSpecificPeriod`, plus the chart data computed values and chart re-init watchers near the end of the file.
- Data persistence is browser-local first: `wallet_expenses`, `wallet_subcategories`, and `wallet_budget` in `localStorage`.
- CSV persistence is a secondary sync/export path. User data file is `data/expenses.csv`, which is gitignored and may not exist until the browser creates/syncs it.

## Editing Gotchas
- Because dependencies are vendored inline at the top of `index.html`, avoid accidental edits inside the embedded library blobs. The application code starts much later in the file around the Vue `createApp` setup.
- Treat `README.md` and `docs/开发计划书.md` as secondary references. If they conflict with runtime behavior in `index.html`, trust `index.html`.
- Preserve the current local-first privacy model: expense data should stay in browser storage / user-selected CSV files, not new remote services.

## Existing Guidance
- `CLAUDE.md` is worth checking for the verified state refs, chart helpers, storage keys, and key behaviors before making non-trivial changes.
