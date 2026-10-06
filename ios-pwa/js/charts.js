(function () {
  const C = WalletCore;
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const safeColor = (color) => typeof color === "string" && /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#3979df";
  const withAlpha = (hex, alpha) => {
    let h = hex.slice(1);
    if (h.length < 6) h = [...h.slice(0, 3)].map((c) => c + c).join("");
    return `rgba(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",")},${alpha})`;
  };
  // Each period needs ~8px, so a full month of days or 12 months fits a phone-width card.
  const SLOT = 8;
  function latestIndex(rows) {
    const today = C.today();
    const current = rows.findIndex((r) => r.start && r.end && r.start <= today && today <= r.end);
    let spent = -1;
    rows.forEach((r, i) => { if (r.value) spent = i; });
    return current < 0 && spent < 0 ? rows.length - 1 : Math.max(current, spent);
  }
  function periodTitle(row) {
    if (!row.start || !row.end) return row.label;
    if (row.start === row.end) return row.start.replace(/-/g, "/");
    if (row.start.endsWith("-01") && row.end === C.addDays(C.shiftMonth(row.start, 1), -1))
      return `${row.start.slice(0, 4)}年${Number(row.start.slice(5, 7))}月`;
    if (row.start.endsWith("-01-01") && row.end.endsWith("-12-31")) return `${row.start.slice(0, 4)}年`;
    return `${row.start.replace(/-/g, "/")}–${row.end.slice(5).replace("-", "/")}`;
  }
  window.WalletChart = {
    props: { kind: String, rows: Array, groups: Array, visible: Boolean, label: String },
    emits: ["select"],
    template: `
      <div class="wallet-chart">
        <div class="chart" ref="canvas" role="img" :aria-label="label"></div>
        <div v-if="detail" class="chart-detail-dock" :style="dockStyle">
          <section class="chart-detail" ref="panel" aria-label="选中时间的支出明细" aria-live="polite" :style="panelStyle">
            <header class="chart-detail-header"><strong>{{ detail.title }}</strong><b>¥{{ money(detail.total) }}</b></header>
            <div v-if="detail.items.length" class="chart-detail-rows" ref="detailRows" role="region" aria-label="图表分类明细" tabindex="0">
              <template v-for="item in detail.items" :key="item.name">
                <i :style="{ background: item.color }" aria-hidden="true"></i><span>{{ item.name }}</span><strong>¥{{ money(item.value) }}</strong>
              </template>
            </div>
            <p v-if="detail.items.length > 5" class="chart-detail-scroll-hint">上下滑动查看全部分类</p>
            <footer class="chart-detail-footer">
              <button type="button" :disabled="selected <= firstVisible" @click="choose(selected - 1)" aria-label="查看上一期">‹</button>
              <span>{{ kind === 'bar' ? '已选柱条' : '已选数据点' }}</span>
              <button type="button" :disabled="selected >= lastVisible" @click="choose(selected + 1)" aria-label="查看下一期">›</button>
            </footer>
          </section>
        </div>
        <p v-if="kind !== 'pie' && !detail" class="chart-navigation-hint">{{ kind === 'bar' ? '轻点柱条，查看该期明细' : '轻点曲线，查看该期支出' }}</p>
        <p v-if="zoomed" class="chart-navigation-hint">拖动滑动条查看其他时间</p>
      </div>`,
    setup(props, { emit }) {
      const canvas = Vue.ref(null), panel = Vue.ref(null), detailRows = Vue.ref(null);
      const zoomed = Vue.ref(false), selected = Vue.ref(-1), detail = Vue.ref(null);
      const firstVisible = Vue.ref(0), lastVisible = Vue.ref(0);
      const dockStyle = Vue.ref({}), panelStyle = Vue.ref({});
      let chart, observer, zoomWindow;
      const media = matchMedia("(prefers-color-scheme: dark)");
      // Read the stylesheet's chart tokens so charts follow the light/dark theme.
      function palette() {
        const dark = media.matches;
        const colors = { accent: "#3979df", axis: dark ? "#989ca9" : "#8b909c", grid: dark ? "#303441" : "#edf0f5",
          surface: dark ? "#252936" : "#ffffff", text: dark ? "#ffffff" : "#202536" };
        if (typeof getComputedStyle !== "function" || typeof document === "undefined") return colors;
        const style = getComputedStyle(document.documentElement);
        for (const [key, name] of [["accent", "--chart-accent"], ["axis", "--chart-axis"], ["grid", "--chart-grid"], ["surface", "--surface"], ["text", "--text"]]) {
          const value = style.getPropertyValue(name).trim();
          if (/^#[0-9a-f]{3,8}$/i.test(value)) colors[key] = value;
        }
        return colors;
      }
      let colors = palette();
      function layoutDetail() {
        if (!detail.value || !panel.value) return;
        const x = chart.convertToPixel({ xAxisIndex: 0 }, selected.value);
        if (!Number.isFinite(x)) return;
        const width = canvas.value.clientWidth, panelWidth = panel.value.offsetWidth;
        const left = Math.max(0, Math.min(x - panelWidth / 2, width - panelWidth));
        dockStyle.value = { "--chart-anchor": `${x}px` };
        panelStyle.value = { marginLeft: `${left}px`, "--detail-anchor": `${x - left}px` };
      }
      function selectionStyle(index) {
        return { opacity: selected.value < 0 || index === selected.value ? 1 : 0.4 };
      }
      function seriesData() {
        const rows = props.rows || [], today = C.today();
        // Stop the curve at today: empty future periods are not "zero spending".
        if (props.kind === "line") return [{ data: rows.map((r) => r.start > today && !r.value ? null : r.value / 100),
          showSymbol: rows.length === 1 || firstVisible.value === lastVisible.value }];
        return (props.groups || []).map((g) => ({ data: rows.map((r, index) => ({
          value: (r.parts[g.name] || 0) / 100, itemStyle: selectionStyle(index),
        })) }));
      }
      function paintSelection() {
        if (!chart || props.kind === "pie") return;
        const row = (props.rows || [])[selected.value], graphics = [];
        if (row) {
          const x = chart.convertToPixel({ xAxisIndex: 0 }, selected.value);
          const baseline = chart.convertToPixel({ yAxisIndex: 0 }, 0);
          const top = chart.convertToPixel({ yAxisIndex: 0 }, row.value / 100);
          if ([x, baseline, top].every(Number.isFinite)) {
            if (props.kind === "bar") {
              const neighbor = chart.convertToPixel({ xAxisIndex: 0 }, selected.value === lastVisible.value ? selected.value - 1 : selected.value + 1);
              const width = Math.max(8, Math.min(28, Number.isFinite(neighbor) ? Math.abs(neighbor - x) * 0.8 + 6 : 28));
              graphics.push({ type: "rect", silent: true, z: 10,
                shape: { x: x - width / 2, y: top - 4, width, height: Math.max(2, baseline - top) + 8, r: 5 },
                style: { fill: "transparent", stroke: colors.accent, lineWidth: 2 } });
            } else {
              graphics.push({ type: "circle", silent: true, z: 10, shape: { cx: x, cy: top, r: 6 },
                style: { fill: colors.surface, stroke: colors.accent, lineWidth: 3 } });
            }
            graphics.push({ type: "circle", silent: true, z: 10, shape: { cx: x, cy: baseline + 5, r: 3 }, style: { fill: colors.accent } });
            graphics.push({ type: "text", silent: true, z: 10,
              style: { text: row.label, x, y: baseline + 10, align: "center", verticalAlign: "top",
                font: "600 11px -apple-system, BlinkMacSystemFont, sans-serif", fill: "#fff",
                backgroundColor: colors.accent, padding: [3, 6], borderRadius: 8 } });
            graphics.push({ type: "line", silent: true, z: 0,
              shape: { x1: x, x2: x, y1: baseline + 30, y2: canvas.value.clientHeight || 250 },
              style: { stroke: colors.accent, lineWidth: 1, opacity: 0.35 } });
          }
        }
        chart.setOption({ series: seriesData(), graphic: graphics }, { replaceMerge: ["graphic"], silent: true });
        Vue.nextTick(layoutDetail);
      }
      function choose(index) {
        const row = (props.rows || [])[index];
        if (!row || index < firstVisible.value || index > lastVisible.value) return;
        selected.value = index;
        detail.value = { title: periodTitle(row), total: row.value,
          items: row.parts ? (props.groups || []).map((g) => ({
            name: g.name, value: row.parts[g.name] || 0, color: safeColor(g.color),
          })) : [] };
        paintSelection();
        Vue.nextTick(() => { if (detailRows.value) detailRows.value.scrollTop = 0; });
      }
      function clearSelection() { selected.value = -1; detail.value = null; }
      function render() {
        if (!props.visible || !canvas.value || canvas.value.clientWidth === 0) return;
        if (!chart) {
          chart = echarts.init(canvas.value, null, { renderer: "svg" });
          chart.on("click", (p) => { if (props.kind === "pie") emit("select", p.name); });
          // Grid clicks also select empty periods, which have no bar/line symbol to tap.
          chart.getZr().on("click", (event) => {
            if (props.kind === "pie" || !chart.containPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY])) return;
            choose(Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, event.offsetX)));
          });
          chart.on("datazoom", () => {
            const zoom = chart.getOption().dataZoom[0];
            zoomWindow = { start: zoom.start, end: zoom.end };
            const last = (props.rows || []).length - 1;
            firstVisible.value = Math.ceil(zoom.start / 100 * last - 0.00001);
            lastVisible.value = Math.floor(zoom.end / 100 * last + 0.00001);
            if (selected.value < firstVisible.value || selected.value > lastVisible.value) clearSelection();
            paintSelection();
          });
        }
        colors = palette();
        const base = { animationDuration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350,
          textStyle: { fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", sans-serif" } };
        let option;
        if (props.kind === "pie") {
          zoomed.value = false;
          option = { ...base,
            tooltip: { renderMode: "html", trigger: "item", confine: true, className: "wallet-chart-tooltip",
              backgroundColor: colors.surface, borderWidth: 0,
              textStyle: { color: colors.text, fontSize: 13 },
              formatter: (p) => `<div class="chart-tooltip-title">${escapeHTML(p.name)}</div>¥${C.money(Math.round(p.value * 100))} · ${p.percent}%` },
            series: [{ type: "pie", radius: ["63%", "86%"], center: ["50%", "50%"],
              avoidLabelOverlap: true, padAngle: 2, label: { show: false }, itemStyle: { borderRadius: 7 }, emphasis: { scaleSize: 4 },
              data: (props.groups || []).map((r) => ({ name: r.name, value: r.value / 100, itemStyle: { color: safeColor(r.color) } })) }] };
        } else {
          const rows = props.rows || [], line = props.kind === "line";
          const visibleCount = Math.max(6, Math.min(62, Math.floor((canvas.value.clientWidth - 40) / SLOT)));
          zoomed.value = rows.length > visibleCount;
          if (!zoomed.value) zoomWindow = undefined;
          // Open long timelines on today or the latest spending, not on empty future periods.
          const end = Math.max(visibleCount - 1, latestIndex(rows)), start = end - visibleCount + 1;
          firstVisible.value = zoomWindow ? Math.ceil(zoomWindow.start / 100 * (rows.length - 1) - 0.00001) : zoomed.value ? start : 0;
          lastVisible.value = zoomWindow ? Math.floor(zoomWindow.end / 100 * (rows.length - 1) + 0.00001) : zoomed.value ? end : rows.length - 1;
          if (selected.value < firstVisible.value || selected.value > lastVisible.value) clearSelection();
          const data = seriesData();
          const series = line ? [{ name: "支出", type: "line", smooth: 0.35, smoothMonotone: "x", showSymbol: data[0].showSymbol, symbolSize: 7,
            lineStyle: { width: 2.5, color: colors.accent }, itemStyle: { color: colors.accent },
            areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: withAlpha(colors.accent, 0.24) }, { offset: 1, color: withAlpha(colors.accent, 0) }]) },
            data: data[0].data }]
            : (props.groups || []).map((g, i) => ({ name: g.name, type: "bar", stack: "total", barMaxWidth: 20,
              emphasis: { disabled: true }, itemStyle: { color: safeColor(g.color), borderRadius: [3, 3, 0, 0] }, data: data[i].data }));
          option = { ...base, tooltip: { show: false }, axisPointer: { show: false },
            grid: { left: 2, right: line ? 18 : 10, top: 20, bottom: zoomed.value ? 56 : 22, containLabel: true },
            xAxis: { type: "category", data: rows.map((r) => r.label), boundaryGap: !line,
              axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: colors.axis, fontSize: 11, margin: 10, hideOverlap: true } },
            yAxis: { type: "value", splitNumber: 3,
              axisLabel: { color: colors.axis, fontSize: 11, formatter: (n) => n >= 10000 ? `${+(n / 10000).toFixed(1)}万` : n },
              splitLine: { lineStyle: { color: colors.grid } } },
            dataZoom: zoomed.value ? [{ type: "slider", bottom: 14, height: 20,
              ...(zoomWindow || { startValue: start, endValue: end }),
              handleSize: "130%", showDataShadow: false, showDetail: false, borderColor: "transparent", borderRadius: 10,
              backgroundColor: withAlpha(colors.axis, 0.12), fillerColor: withAlpha(colors.accent, 0.16),
              handleStyle: { color: colors.surface, borderColor: colors.accent }, moveHandleStyle: { color: withAlpha(colors.accent, 0.4) } }] : [], series };
        }
        chart.setOption(option, true);
        chart.resize();
        paintSelection();
      }
      Vue.onMounted(() => {
        observer = new ResizeObserver(render); observer.observe(canvas.value);
        media.addEventListener("change", render); render();
      });
      Vue.watch(() => [props.kind, props.rows, props.groups], () => {
        clearSelection(); zoomWindow = undefined; Vue.nextTick(render);
      }, { deep: true });
      Vue.watch(() => props.visible, () => Vue.nextTick(render));
      Vue.onUnmounted(() => { observer?.disconnect(); chart?.dispose(); media.removeEventListener("change", render); });
      return { canvas, panel, detailRows, zoomed, selected, detail, dockStyle, panelStyle, firstVisible, lastVisible, choose, money: C.money };
    },
  };
})();
