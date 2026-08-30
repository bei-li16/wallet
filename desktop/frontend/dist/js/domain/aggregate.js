/**
 * 报表/趋势聚合逻辑（纯函数，零框架依赖）
 *
 * 从原 index.html 平移，两处行为修正：
 * - 所有金额求和结果 round2，消除浮点累计误差（如 0.1+0.2）
 * - 下钻时子类颜色仍按调色板取模，与原版一致
 */
(function (global) {
  'use strict';

  const SUBCATEGORY_COLORS = [
    '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#10b981', '#ef4444',
    '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#eab308',
    '#a855f7', '#22c55e', '#0ea5e9', '#d946ef', '#64748b', '#fb923c'
  ];

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function sumAmounts(list) {
    return round2(list.reduce((sum, e) => sum + e.amount, 0));
  }

  /**
   * 指定周期（周/月/年，含具体周期）的堆叠柱状图数据
   *
   * @returns {{ labels: string[], datasets: Array<{name, data, itemStyle}> }}
   */
  function getChartDataForPeriod(expenses, categories, subcategories, reportCategory, period, specificPeriod) {
    const TOTAL_KEY = '总消费';
    const format = period === 'year' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const { start, end } = WalletPeriods.getPeriodRange(period, specificPeriod);

    const labels = [];
    const isDrilldown = reportCategory !== TOTAL_KEY;
    const displayItems = isDrilldown
      ? (subcategories[reportCategory] || []).map((sub) => ({
          name: sub,
          color: SUBCATEGORY_COLORS[(subcategories[reportCategory] || []).indexOf(sub) % SUBCATEGORY_COLORS.length]
        }))
      : categories.map((c) => ({ name: c.name, color: c.color }));

    const dataMap = {};
    let current = start.clone();
    while (current.isBefore(end) || current.isSame(end)) {
      const key = current.format(format);
      labels.push(key);
      displayItems.forEach((item) => {
        if (!dataMap[item.name]) dataMap[item.name] = [];
      });
      current = period === 'year' ? current.add(1, 'month') : current.add(1, 'day');
    }

    const filtered = expenses.filter((e) => {
      const d = dayjs(e.date);
      return d.isSameOrAfter(start) && d.isSameOrBefore(end);
    });

    labels.forEach((label) => {
      const dayExpenses = filtered.filter((e) => {
        const d = dayjs(e.date);
        if (period === 'year') {
          return d.format('YYYY-MM') === label;
        }
        return d.format('YYYY-MM-DD') === label;
      });

      displayItems.forEach((item) => {
        const total = dayExpenses
          .filter((e) => {
            if (isDrilldown) {
              return e.category === reportCategory && e.subcategory === item.name;
            }
            return e.category === item.name;
          })
          .reduce((sum, e) => sum + e.amount, 0);
        dataMap[item.name].push(round2(total));
      });
    });

    return {
      labels,
      datasets: displayItems.map((item) => ({
        name: item.name,
        data: dataMap[item.name] || [],
        itemStyle: { color: item.color }
      }))
    };
  }

  /**
   * 总报（最早→最晚记录）按月/按年颗粒度的堆叠柱状图数据
   */
  function getAllTimeChartData(expenses, categories, subcategories, reportCategory, granularity) {
    const TOTAL_KEY = '总消费';
    if (expenses.length === 0) {
      return { labels: [], datasets: [] };
    }

    const sorted = [...expenses].sort((a, b) => new Date(a.date) - new Date(b.date));
    const firstDate = dayjs(sorted[0].date);
    const lastDate = dayjs(sorted[sorted.length - 1].date);

    const isDrilldown = reportCategory !== TOTAL_KEY;
    const subCats = isDrilldown ? subcategories[reportCategory] || [] : [];
    const displayItems = isDrilldown
      ? subCats.map((sub, idx) => ({ name: sub, color: SUBCATEGORY_COLORS[idx % SUBCATEGORY_COLORS.length] }))
      : categories.map((c) => ({ name: c.name, color: c.color }));

    const isMonth = granularity === 'month';
    const fmt = isMonth ? 'YYYY-MM' : 'YYYY';
    const unit = isMonth ? 'month' : 'year';

    const labels = [];
    const dataMap = {};
    let current = isMonth ? firstDate.startOf('month') : firstDate.startOf('year');

    while (current.isBefore(lastDate) || current.isSame(lastDate)) {
      const key = current.format(fmt);
      labels.push(key);
      displayItems.forEach((item) => {
        if (!dataMap[item.name]) dataMap[item.name] = [];
      });
      current = current.add(1, unit);
    }

    sorted.forEach((e) => {
      const key = dayjs(e.date).format(fmt);
      const idx = labels.indexOf(key);
      if (idx !== -1) {
        displayItems.forEach((item) => {
          if (isDrilldown) {
            if (e.category === reportCategory && e.subcategory === item.name) {
              dataMap[item.name][idx] = (dataMap[item.name][idx] || 0) + e.amount;
            }
          } else if (e.category === item.name) {
            dataMap[item.name][idx] = (dataMap[item.name][idx] || 0) + e.amount;
          }
        });
      }
    });

    return {
      labels,
      datasets: displayItems.map((item) => ({
        name: item.name,
        data: (dataMap[item.name] || []).map(round2),
        itemStyle: { color: item.color }
      }))
    };
  }

  /**
   * 饼图数据：顶层按主类，下钻按子类；过滤 0 值
   */
  function getCategoryPieData(filteredExpenses, categories, subcategories, reportCategory) {
    const TOTAL_KEY = '总消费';
    if (!filteredExpenses || filteredExpenses.length === 0) {
      return [];
    }

    const targetExpenses =
      reportCategory === TOTAL_KEY
        ? filteredExpenses
        : filteredExpenses.filter((e) => e.category === reportCategory);

    const data = {};
    targetExpenses.forEach((e) => {
      const key = reportCategory === TOTAL_KEY ? e.category : e.subcategory;
      data[key] = (data[key] || 0) + e.amount;
    });

    const entries = Object.entries(data)
      .filter(([, v]) => v > 0)
      .map(([name, v]) => [name, round2(v)]);

    if (reportCategory === TOTAL_KEY) {
      const colorOf = (name) => {
        const c = categories.find((x) => x.name === name);
        return c ? c.color : '#6b7280';
      };
      return entries.map(([name, value]) => ({ name, value, itemStyle: { color: colorOf(name) } }));
    }
    return entries.map(([name, value], idx) => ({
      name,
      value,
      itemStyle: { color: SUBCATEGORY_COLORS[idx % SUBCATEGORY_COLORS.length] }
    }));
  }

  /**
   * 趋势页折线数据：近 8 周 / 近 12 月 / 近 5 年
   */
  function getTrendData(expenses, granularity) {
    const labels = [];
    const data = [];

    if (granularity === 'week') {
      for (let i = 7; i >= 0; i--) {
        const start = dayjs().subtract(i, 'week').startOf('week');
        const end = dayjs().subtract(i, 'week').endOf('week');
        labels.push(start.format('MM/DD'));
        data.push(
          sumAmounts(
            expenses.filter((e) => {
              const d = dayjs(e.date);
              return d.isSameOrAfter(start) && d.isSameOrBefore(end);
            })
          )
        );
      }
    } else if (granularity === 'month') {
      for (let i = 11; i >= 0; i--) {
        const d = dayjs().subtract(i, 'month');
        labels.push(d.format('YYYY/MM'));
        data.push(
          sumAmounts(expenses.filter((e) => dayjs(e.date).format('YYYY-MM') === d.format('YYYY-MM')))
        );
      }
    } else {
      const currentYear = dayjs().year();
      for (let y = currentYear - 4; y <= currentYear; y++) {
        labels.push(y.toString());
        data.push(sumAmounts(expenses.filter((e) => dayjs(e.date).year() === y)));
      }
    }
    return { labels, data };
  }

  /**
   * 趋势页"今年类别占比"环形图数据
   */
  function getYearPieData(expenses, categories) {
    const yearStart = dayjs().startOf('year').format('YYYY-MM-DD');
    const yearEnd = dayjs().endOf('year').format('YYYY-MM-DD');
    const data = {};
    expenses
      .filter((e) => e.date >= yearStart && e.date <= yearEnd)
      .forEach((e) => {
        data[e.category] = (data[e.category] || 0) + e.amount;
      });
    return Object.entries(data)
      .filter(([, v]) => v > 0)
      .map(([name, v]) => {
        const c = categories.find((x) => x.name === name);
        return { name, value: round2(v), itemStyle: { color: c ? c.color : '#6b7280' } };
      });
  }

  global.WalletAggregate = {
    SUBCATEGORY_COLORS,
    round2,
    sumAmounts,
    getChartDataForPeriod,
    getAllTimeChartData,
    getCategoryPieData,
    getTrendData,
    getYearPieData
  };
})(window);
