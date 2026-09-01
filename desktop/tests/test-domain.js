/**
 * 领域层金样例测试（node tests/test-domain.js）
 * 直接加载 frontend/dist 下的模块源码，保证测的就是打包进应用的代码。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'frontend', 'dist');
const V = (p) => path.join(DIST, 'js', 'vendor', p);
const J = (p) => path.join(DIST, 'js', p);

// ---------- 模拟浏览器环境并加载模块 ----------
global.window = global;

function loadUMD(file, requireMap = {}) {
  const m = { exports: {} };
  const req = (name) => (name in requireMap ? requireMap[name] : require(name));
  new Function('module', 'exports', 'require', fs.readFileSync(file, 'utf8'))(m, m.exports, req);
  return m.exports;
}
function loadWindowIIFE(file) {
  new Function('window', fs.readFileSync(file, 'utf8'))(global);
}

const dayjs = loadUMD(V('dayjs.min.js'));
global.dayjs = dayjs;
dayjs.locale(loadUMD(V('zh-cn.js'), { dayjs }));
dayjs.extend(loadUMD(V('isSameOrAfter.js'), { dayjs }));
dayjs.extend(loadUMD(V('isSameOrBefore.js'), { dayjs }));

loadWindowIIFE(J('domain/periods.js'));
loadWindowIIFE(J('domain/csv.js'));
loadWindowIIFE(J('domain/aggregate.js'));

const P = global.WalletPeriods;
const C = global.WalletCSV;
const A = global.WalletAggregate;

// ---------- 断言工具 ----------
let passed = 0;
let failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

// ---------- 1. ISO 周跨年边界 ----------
console.log('ISO 周：');
eq(P.getISOWeekString('2026-01-01'), '2026-W01', '2026-01-01(周四) → 2026-W01');
eq(P.getISOWeekString('2025-12-29'), '2026-W01', '2025-12-29(周一) 跨年 → 2026-W01');
eq(P.getISOWeekString('2025-12-28'), '2025-W52', '2025-12-28(周日) → 2025-W52');
eq(P.getISOWeekString('2020-12-31'), '2020-W53', '2020-12-31(周四) → 2020-W53(53周闰年)');
eq(P.getISOWeekString('2021-01-01'), '2020-W53', '2021-01-01(周五) → 归属上一年 2020-W53');
eq(P.getISOWeekString('2026-08-31'), '2026-W36', '2026-08-31(周一) → 2026-W36');
eq(P.getWeekDateRangeLabel('2026-W36'), '2026/08/31 - 2026/09/06', 'W36 周标签为 08/31-09/06');
eq(P.getWeekDateRangeLabel('2026-W01'), '2025/12/29 - 2026/01/04', 'W01 周标签跨年 12/29-01/04');

// ---------- 2. 周期范围 ----------
console.log('周期范围：');
{
  const r = P.getPeriodRange('month', '2026-02');
  eq(r.start.format('YYYY-MM-DD'), '2026-02-01', '指定月起始');
  eq(r.end.format('YYYY-MM-DD'), '2026-02-28', '指定月结束（非闰年）');
  const r2 = P.getPeriodRange('month', '2028-02');
  eq(r2.end.format('YYYY-MM-DD'), '2028-02-29', '指定月结束（闰年）');
  const p = P.getPrevPeriodRange('month', '2026-01');
  eq(p.start.format('YYYY-MM-DD'), '2025-12-01', '2026-01 的上期跨年 → 2025-12-01');
  eq(P.getPrevPeriodRange('all', ''), null, "总报无上期 → null");
}

// ---------- 2.5 周期标签与可用周期推导 ----------
console.log('周期标签：');
eq(P.getSpecificPeriodLabel('2026-08', 'month'), '2026年8月', '月份标签');
eq(P.getSpecificPeriodLabel('2026', 'year'), '2026年', '年份标签');
eq(P.getSpecificPeriodLabel('2026-W36', 'week'), '2026/08/31 - 2026/09/06', '周标签');
eq(P.getSpecificPeriodLabel('', 'month'), '', '空具体周期 → 空标签');
{
  // 当前月动态计算，避免用例在跨日/跨月时失效
  const cur = dayjs().format('YYYY-MM');
  const ap = P.getAvailablePeriods(['2026-07-01', '2026-08-15'], 'month');
  eq(
    ap.map((x) => x.value),
    [...new Set([cur, '2026-08', '2026-07'])],
    '可用周期：数据推导 + 当前月，最近在前'
  );
  eq(ap[0].label, `${cur.slice(0, 4)}年${parseInt(cur.slice(5))}月`, '可用周期带中文标签');
  eq(P.getAvailablePeriods([], 'month').length, 1, '无数据时仅当前月');
}

// ---------- 3. CSV 往返 ----------
console.log('CSV 往返：');
{
  const records = [
    {
      id: 'abc123',
      amount: 12.5,
      category: '餐饮',
      subcategory: '午餐',
      date: '2026-08-31',
      note: '含逗号, 含"引号", 中文备注',
      createdAt: 1756598400000,
      updatedAt: 1756598401000
    },
    {
      id: 'def456',
      amount: 0.1,
      category: '购物',
      subcategory: '日用品',
      date: '2026-08-30',
      note: '',
      createdAt: 1756512000000,
      updatedAt: 1756512000000
    }
  ];
  const csv = C.buildCSVContent(records);
  eq(csv.charCodeAt(0), 0xfeff, 'CSV 以 BOM 开头');
  eq(csv.includes('\r\n'), true, 'CSV 使用 CRLF 行尾');
  eq(csv.split(/\r\n/).length, 3, '表头 + 2 行数据');

  const parsed = C.parseCSV(csv, new Set());
  eq(parsed.stats, { total: 2, duplicateCount: 0, invalidCount: 0, successCount: 2 }, '往返统计');
  eq(parsed.records[0].note, '含逗号, 含"引号", 中文备注', '逗号/引号/中文备注往返无损');
  eq(parsed.records[0].amount, 12.5, '金额解析');
  eq(parsed.records[1].note, '', '空备注往返');

  // 去重与无效行（existingIds 已含 abc123，故两条 abc123 都算重复）
  const csv2 = C.buildCSVContent([
    ...records,
    { id: 'abc123', amount: 1, category: '餐饮', subcategory: 'x', date: '2026-08-01', note: '', createdAt: 1, updatedAt: 1 },
    { id: '', amount: '', category: '', date: '', note: '', createdAt: 0, updatedAt: 0 }
  ]);
  const parsed2 = C.parseCSV(csv2, new Set(['abc123']));
  eq(parsed2.stats.duplicateCount, 2, '重复 id 计数（含已存在的）');
  eq(parsed2.stats.invalidCount, 1, '无效行计数');
  eq(parsed2.stats.successCount, 1, '有效新记录计数');
}

// ---------- 4. 聚合与浮点取整 ----------
console.log('聚合：');
{
  const categories = [
    { name: '餐饮', color: '#f59e0b' },
    { name: '购物', color: '#ec4899' }
  ];
  const subcategories = { '餐饮': ['午餐', '晚餐'] };
  const expenses = [
    { id: '1', amount: 0.1, category: '餐饮', subcategory: '午餐', date: '2026-08-01', note: '', createdAt: 1, updatedAt: 1 },
    { id: '2', amount: 0.2, category: '餐饮', subcategory: '午餐', date: '2026-08-02', note: '', createdAt: 1, updatedAt: 1 },
    { id: '3', amount: 5, category: '购物', subcategory: '日用品', date: '2026-08-03', note: '', createdAt: 1, updatedAt: 1 }
  ];
  const chart = A.getChartDataForPeriod(expenses, categories, subcategories, '总消费', 'month', '2026-08');
  eq(chart.labels.length, 31, '2026-08 生成全月 31 天标签');
  eq(chart.labels.slice(0, 3), ['2026-08-01', '2026-08-02', '2026-08-03'], '前三天标签');
  eq(chart.datasets[0].data.slice(0, 3), [0.1, 0.2, 0], '餐饮序列前三天（0.1/0.2/0）');
  eq(chart.datasets[1].data.slice(0, 3), [0, 0, 5], '购物序列前三天（第三天 5）');
  eq(chart.datasets[0].data[30], 0, '无记录日期补 0');
  const pie = A.getCategoryPieData(expenses, categories, subcategories, '餐饮');
  eq(pie, [{ name: '午餐', value: 0.3, itemStyle: { color: A.SUBCATEGORY_COLORS[0] } }], '下钻小计 0.1+0.2 → 0.3');
  const total = A.sumAmounts(expenses);
  eq(total, 5.3, '总和 0.1+0.2+5 → 5.3');
  // 趋势数据形状
  const trend = A.getTrendData(expenses, 'year');
  eq(trend.labels.length, 5, '近 5 年标签数');
  eq(trend.data.length, 5, '近 5 年数据点数');
}

// ---------- 结果 ----------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
