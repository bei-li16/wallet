# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wallet is a browser-based consumer spending record management SPA. It runs as a single HTML file with all Vue components, charts, and business logic embedded.

## Running the Application

Open `index.html` directly in a browser (Chrome/Edge recommended for File System Access API support). No build step required.

## Architecture

### File Structure
- `index.html` - **Required**. Complete application (~1270 lines). Contains Vue 3 setup, ECharts chart functions, CSV operations, and all template/CSS/script
- `css/variables.css` - CSS custom properties (colors, fonts, spacing, shadows, transitions)
- `css/style.css` - Global styles (imports variables.css), dark theme scrollbar styles and fade animations
- `data/expenses_template.csv` - CSV template for data import/export
- `docs/` - User documentation and development plan (Chinese)

### Vue App Structure (in index.html)

**State refs:**
- `currentTab` - Navigation state (home/add/report/trend)
- `expenses` - All expense records
- `reportPeriod` - Report time range (week/month/year/all)
- `reportChartType` - Bar or pie chart toggle
- `reportCategory` - Selected category for drill-down (总消费 or specific category)
- `reportGranularity` - For all-time reports (month/year)

**Computed properties for chart data:**
- `weekChartData`, `monthChartData`, `yearChartData`, `allChartData` - Period-specific stacked bar data
- `displayCategories` - Returns main categories or subcategories based on `reportCategory`
- `filteredReportExpenses` - Expenses filtered by selected category

**Chart initialization functions:**
- `initCategoryChart(domId, data, clickHandler)` - Pie chart with click-to-drilldown
- `initPeriodBarChart(domId, chartData, xAxisLabels, categories)` - Stacked bar chart
- `initTrendChart(domId, labels, values)` - Line trend chart

### Data Storage

- **localStorage** (`wallet_expenses`) - Primary storage, JSON array of expense objects
- **CSV file** - `data/expenses.csv` (created on first sync via File System Access API in Chrome/Edge)
- **Expense object**: `{id, amount, category, subcategory, date, note, createdAt, updatedAt}`
- **Subcategories** stored in localStorage (`wallet_subcategories`) alongside main category definitions

### Category System

7 main categories: 餐饮, 交通, 购物, 居住, 娱乐, 医疗, 其他
Each has predefined subcategories stored in `subcategories` ref (localStorage backed).

## Key Behaviors

- **Tab navigation**: Uses `v-show` (not `v-if`) to preserve chart state when switching tabs
- **Report drill-down**: Click pie chart sector to drill into category → subcategory view
- **All-time reports**: Date range spans earliest to latest expense; granularity toggle (month/year)
- **CSV sync**: Automatic when File System Access API is available; falls back to manual export/import

## Documentation

- `docs/README.md` - User guide (Chinese)
- `docs/开发计划书.md` - Feature spec and implementation progress (Chinese)
