/**
 * 周期/日期领域逻辑（纯函数，零框架依赖）
 *
 * 从原 index.html 平移，行为保持一致：
 * - ISO 8601 周（周一为一周起点，第 1 周 = 包含 1 月 4 日的那一周）
 * - 依赖 dayjs zh-cn locale 的 weekStart:1，使"本周"与 ISO 周口径一致
 */
(function (global) {
  'use strict';

  /**
   * ISO 8601 某年第 1 周的周一（包含 1 月 4 日的那一周的周一）
   *
   * 修复：必须 startOf('day') 截掉当前时刻的时分秒，否则与 startOf('day')
   * 的日期做 isBefore/diff 比较时，跨年边界周一会被错分到上一年。
   */
  function getISOWeek1Monday(year) {
    const jan4 = dayjs().year(year).month(0).date(4).startOf('day');
    const dow = jan4.day(); // 0=Sun ... 6=Sat
    return jan4.subtract(dow === 0 ? 6 : dow - 1, 'day');
  }

  /**
   * ISO 周字符串 YYYY-Www，正确处理 12 月底/1 月初的跨年归属
   */
  function getISOWeekString(date) {
    const d = dayjs(date).startOf('day');
    let year = d.year();
    let weekStart = getISOWeek1Monday(year);
    if (d.isBefore(weekStart)) {
      year -= 1;
      weekStart = getISOWeek1Monday(year);
    } else {
      const nextWeekStart = getISOWeek1Monday(year + 1);
      if (!d.isBefore(nextWeekStart)) {
        year += 1;
        weekStart = nextWeekStart;
      }
    }
    const daysDiff = d.diff(weekStart, 'day');
    const weekNum = Math.floor(daysDiff / 7) + 1;
    return `${year}-W${weekNum.toString().padStart(2, '0')}`;
  }

  /**
   * "2026-W35" → "2026/08/24 - 2026/08/30" 形式的可读标签
   */
  function getWeekDateRangeLabel(periodStr) {
    if (!periodStr || typeof periodStr !== 'string') {
      return '';
    }
    const parts = periodStr.split('-W');
    if (parts.length !== 2) {
      return periodStr;
    }
    const year = parseInt(parts[0], 10);
    const week = parseInt(parts[1], 10);
    if (isNaN(year) || isNaN(week) || week < 1 || week > 53) {
      return periodStr;
    }
    const weekStart = getISOWeek1Monday(year).add((week - 1) * 7, 'day');
    const weekEnd = weekStart.add(6, 'day');
    return `${weekStart.format('YYYY/MM/DD')} - ${weekEnd.format('YYYY/MM/DD')}`;
  }

  /**
   * 周期类型 + 可选具体周期 → { start, end } dayjs 对象
   */
  function getPeriodRange(period, specificPeriod) {
    if (specificPeriod) {
      const p = specificPeriod;
      if (period === 'week') {
        const [year, week] = p.split('-W');
        const weekStart = getISOWeek1Monday(parseInt(year)).add((parseInt(week) - 1) * 7, 'day');
        return { start: weekStart, end: weekStart.clone().add(6, 'day') };
      } else if (period === 'month') {
        const d = dayjs(p + '-01');
        return { start: d.startOf('month'), end: d.endOf('month') };
      } else if (period === 'year') {
        const d = dayjs(p + '-01-01');
        return { start: d.startOf('year'), end: d.endOf('year') };
      }
    }

    const now = dayjs();
    if (period === 'week') {
      return { start: now.startOf('week'), end: now.endOf('week') };
    } else if (period === 'month') {
      return { start: now.startOf('month'), end: now.endOf('month') };
    } else if (period === 'year') {
      return { start: now.startOf('year'), end: now.endOf('year') };
    }
    // 未知周期回退到当前月份
    return { start: now.startOf('month'), end: now.endOf('month') };
  }

  /**
   * 上一周期的 { start, end }；'all' 返回 null
   */
  function getPrevPeriodRange(period, specificPeriod) {
    if (period === 'all') return null;
    if (specificPeriod) {
      const p = specificPeriod;
      if (period === 'week') {
        const r = getPeriodRange(period, specificPeriod);
        const start = r.start.subtract(7, 'day');
        return { start, end: start.clone().add(6, 'day') };
      } else if (period === 'month') {
        const d = dayjs(p + '-01').subtract(1, 'month');
        return { start: d.startOf('month'), end: d.endOf('month') };
      } else if (period === 'year') {
        const d = dayjs(p + '-01-01').subtract(1, 'year');
        return { start: d.startOf('year'), end: d.endOf('year') };
      }
    }
    const now = dayjs();
    if (period === 'week') {
      const start = now.subtract(1, 'week').startOf('week');
      return { start, end: start.clone().endOf('week') };
    } else if (period === 'month') {
      const start = now.subtract(1, 'month').startOf('month');
      return { start, end: start.clone().endOf('month') };
    } else if (period === 'year') {
      const start = now.subtract(1, 'year').startOf('year');
      return { start, end: start.clone().endOf('year') };
    }
    return null;
  }

  /**
   * 周期选择器可选项：从数据推导并附加当前周期，最近在前
   */
  function getAvailablePeriods(dates, period) {
    const periods = new Set();
    const now = dayjs();
    dates.forEach((dateStr) => {
      const d = dayjs(dateStr);
      if (period === 'week') {
        periods.add(getISOWeekString(d));
      } else if (period === 'month') {
        periods.add(d.format('YYYY-MM'));
      } else if (period === 'year') {
        periods.add(d.format('YYYY'));
      }
    });
    if (period === 'week') {
      periods.add(getISOWeekString(now));
    } else if (period === 'month') {
      periods.add(now.format('YYYY-MM'));
    } else if (period === 'year') {
      periods.add(now.format('YYYY'));
    }
    const sorted = Array.from(periods).sort();
    return sorted
      .map((p) => {
        let label;
        if (period === 'week') {
          label = getWeekDateRangeLabel(p);
        } else if (period === 'month') {
          label = `${p.slice(0, 4)}年${parseInt(p.slice(5))}月`;
        } else if (period === 'year') {
          label = `${p}年`;
        }
        return { value: p, label };
      })
      .reverse();
  }

  /**
   * 具体周期的展示标签，如 "2026年8月" / "2026/08/24 - 2026/08/30"
   */
  function getSpecificPeriodLabel(specificPeriod, period) {
    if (!specificPeriod) return '';
    const p = specificPeriod;
    if (period === 'week') {
      return getWeekDateRangeLabel(p);
    } else if (period === 'month') {
      return `${p.slice(0, 4)}年${parseInt(p.slice(5))}月`;
    } else if (period === 'year') {
      return `${p}年`;
    }
    return p;
  }

  global.WalletPeriods = {
    getISOWeek1Monday,
    getISOWeekString,
    getWeekDateRangeLabel,
    getPeriodRange,
    getPrevPeriodRange,
    getAvailablePeriods,
    getSpecificPeriodLabel
  };
})(window);
