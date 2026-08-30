/**
 * ECharts 图表模块
 *
 * - option 工厂：柱状/饼图/趋势线（配色与原版一致）
 * - 图表管理器：懒 init、切类型时 dispose、ResizeObserver 自适应
 *   （修复原版窗口尺寸变化后图表不自适应的问题）
 * - 饼图 tooltip 改用自定义 formatter 并对名称做 HTML 转义（子类名是用户输入）
 */
(function (global) {
  'use strict';

  const AXIS_TEXT = '#94a3b8';
  const AXIS_LINE = '#475569';
  const SPLIT_LINE = '#334155';

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function colorHexOf(color) {
    return typeof color === 'string' ? color : (color && color.color) || '#6b7280';
  }

  // ---------- option 工厂 ----------

  function barOption(chartData, xAxisLabels, rotateLabels) {
    const catNames = chartData.datasets.map((ds) => ds.name);
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (params) {
          if (!params || params.length === 0) return '';
          const label = escapeHtml(params[0].axisValue || params[0].name || '');
          const items = params.filter((p) => p.seriesName !== '总量');
          let total = 0;
          items.forEach((p) => {
            total += p.value || 0;
          });
          total = Math.round((total + Number.EPSILON) * 100) / 100;

          let html = `<div style="font-weight:bold;margin-bottom:5px">${label}</div>`;
          html += `<div style="margin-bottom:5px">总计: ¥${total.toFixed(2)}</div>`;
          [...items].reverse().forEach((p) => {
            if (p.value > 0) {
              const pct = total > 0 ? ((p.value / total) * 100).toFixed(1) : 0;
              html += `<div style="color:${colorHexOf(p.color)}">● ${escapeHtml(p.seriesName)}: ¥${(p.value || 0).toFixed(2)} (${pct}%)</div>`;
            }
          });
          return html;
        }
      },
      legend: {
        data: catNames,
        textStyle: { color: AXIS_TEXT },
        bottom: 0
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '3%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: xAxisLabels,
        axisLabel: { color: AXIS_TEXT, rotate: rotateLabels ? 45 : 0 },
        axisLine: { lineStyle: { color: AXIS_LINE } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: AXIS_TEXT },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        splitLine: { lineStyle: { color: SPLIT_LINE } }
      },
      series: chartData.datasets.map((ds) => ({
        name: ds.name,
        type: 'bar',
        stack: 'total',
        data: ds.data,
        itemStyle: ds.itemStyle,
        emphasis: { focus: 'self' }
      }))
    };
  }

  function pieOption(pieData) {
    return {
      tooltip: {
        trigger: 'item',
        formatter: function (params) {
          const name = escapeHtml(params.name);
          return `${name}: ¥${Number(params.value).toFixed(2)} (${params.percent}%)`;
        }
      },
      legend: {
        orient: 'vertical',
        right: 10,
        top: 'center',
        textStyle: { color: AXIS_TEXT }
      },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['35%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
            borderColor: '#1e293b',
            borderWidth: 2
          },
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 14, fontWeight: 'bold' }
          },
          data: pieData
        }
      ]
    };
  }

  function trendOption(labels, data) {
    return {
      tooltip: {
        trigger: 'axis',
        formatter: function (params) {
          if (!params || !params.length) return '';
          return `${escapeHtml(params[0].name)}: ¥${Number(params[0].value).toFixed(2)}`;
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '3%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: AXIS_TEXT },
        axisLine: { lineStyle: { color: AXIS_LINE } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: AXIS_TEXT },
        axisLine: { lineStyle: { color: AXIS_LINE } },
        splitLine: { lineStyle: { color: SPLIT_LINE } }
      },
      series: [
        {
          type: 'line',
          data,
          smooth: true,
          lineStyle: { color: '#3b82f6', width: 2 },
          itemStyle: { color: '#3b82f6' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0.05)' }
            ])
          }
        }
      ]
    };
  }

  // ---------- 图表管理器 ----------

  function createChartManager() {
    const instances = new Map(); // domId -> echarts instance
    const observer =
      'ResizeObserver' in window
        ? new ResizeObserver((entries) => {
            entries.forEach((entry) => {
              const inst = instances.get(entry.target.id);
              if (inst) {
                try {
                  inst.resize();
                } catch (e) {
                  /* 容器已销毁时忽略 */
                }
              }
            });
          })
        : null;

    function ensure(domId) {
      const dom = document.getElementById(domId);
      if (!dom) return null;
      let inst = instances.get(domId);
      if (!inst) {
        try {
          inst = echarts.init(dom);
          instances.set(domId, inst);
          if (observer) observer.observe(dom);
        } catch (e) {
          console.error('echarts init failed:', domId, e);
          return null;
        }
      }
      return inst;
    }

    /**
     * 渲染图表；替换 option（notMerge），并重绑点击事件
     * @param {Function|null} onClick
     */
    function render(domId, option, onClick) {
      const inst = ensure(domId);
      if (!inst) return null;
      inst.setOption(option, { notMerge: true });
      inst.off('click');
      if (onClick) inst.on('click', onClick);
      return inst;
    }

    function dispose(domId) {
      const inst = instances.get(domId);
      if (inst) {
        if (observer) observer.unobserve(inst.getDom());
        try {
          inst.dispose();
        } catch (e) {
          /* ignore */
        }
        instances.delete(domId);
      }
    }

    function disposeAll() {
      Array.from(instances.keys()).forEach(dispose);
    }

    return { render, dispose, disposeAll };
  }

  global.WalletCharts = { escapeHtml, barOption, pieOption, trendOption, createChartManager };
})(window);
