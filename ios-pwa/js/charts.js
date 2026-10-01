(function () {
  const C = WalletCore;
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  function axisTooltip(params) {
    const items = Array.isArray(params) ? params : [params];
    const title = escapeHTML(items[0]?.axisValueLabel || items[0]?.name || "支出");
    const rows = items.map((p) => {
      const color = typeof p.color === "string" && /^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : "#3879df";
      const value = Number.isFinite(Number(p.value)) ? Number(p.value) : 0;
      return `<div class="chart-tooltip-row"><i style="background:${color}"></i><span>${escapeHTML(p.seriesName)}</span><strong>¥${C.money(Math.round(value * 100))}</strong></div>`;
    }).join("");
    return `<div class="chart-tooltip"><div class="chart-tooltip-title">${title}</div><div class="chart-tooltip-rows" role="region" aria-label="图表分类明细" tabindex="0">${rows}</div>${items.length > 5 ? '<div class="chart-tooltip-hint">上下滑动查看全部分类</div>' : ""}</div>`;
  }
  window.WalletChart = {
    props: {
      kind: String,
      rows: Array,
      groups: Array,
      visible: Boolean,
      label: String,
    },
    emits: ["select"],
    template:
      '<div><div class="chart" ref="canvas" role="img" :aria-label="label"></div><p v-if="zoomed" class="chart-navigation-hint">拖动下方滑动条查看其他时间</p></div>',
    setup(props, { emit }) {
      const canvas = Vue.ref(null);
      const zoomed = Vue.ref(false);
      let chart, observer;
      const media = matchMedia("(prefers-color-scheme: dark)");
      function render() {
        if (!props.visible || !canvas.value || canvas.value.clientWidth === 0)
          return;
        if (!chart) {
          chart = echarts.init(canvas.value, null, { renderer: "svg" });
          chart.on("click", (p) =>
            emit("select", props.kind === "pie" ? p.name : p.seriesName),
          );
        }
        const muted = media.matches ? "#989ca9" : "#8b909c",
          grid = media.matches ? "#303441" : "#edf0f5";
        let option;
        const base = {
          animationDuration: matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? 0
            : 350,
          textStyle: {
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          },
          tooltip: {
            renderMode: "html",
            confine: true,
            enterable: true,
            hideDelay: 600,
            className: "wallet-chart-tooltip",
            backgroundColor: media.matches ? "#252936" : "#fff",
            borderWidth: 0,
            textStyle: {
              color: media.matches ? "#fff" : "#202536",
              fontSize: 12,
            },
          },
        };
        if (props.kind === "pie") {
          zoomed.value = false;
          option = {
            ...base,
            tooltip: {
              ...base.tooltip,
              trigger: "item",
              formatter: (p) =>
                `<div class="chart-tooltip-title">${escapeHTML(p.name)}</div>¥${C.money(Math.round(p.value * 100))} · ${p.percent}%`,
            },
            series: [
              {
                type: "pie",
                radius: ["65%", "85%"],
                center: ["50%", "50%"],
                avoidLabelOverlap: true,
                padAngle: 3,
                label: { show: false },
                itemStyle: { borderRadius: 6 },
                emphasis: { scaleSize: 3 },
                data: (props.groups || []).map((r) => ({
                  name: r.name,
                  value: r.value / 100,
                  itemStyle: { color: r.color },
                })),
              },
            ],
          };
        } else {
          const rows = props.rows || [],
            line = props.kind === "line";
          const visibleCount = Math.max(6, Math.min(40, Math.floor((canvas.value.clientWidth - 40) / 26)));
          zoomed.value = rows.length > visibleCount;
          const series = line
            ? [
                {
                  name: "支出",
                  type: "line",
                  smooth: 0.3,
                  showSymbol: false,
                  symbolSize: 7,
                  lineStyle: { width: 3, color: "#3979df" },
                  itemStyle: { color: "#3979df" },
                  areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                      { offset: 0, color: "rgba(57,121,223,.22)" },
                      { offset: 1, color: "rgba(57,121,223,0)" },
                    ]),
                  },
                  data: rows.map((r) => r.value / 100),
                },
              ]
            : (props.groups || []).map((c) => ({
                name: c.name,
                type: "bar",
                stack: "total",
                barMaxWidth: 22,
                itemStyle: { color: c.color, borderRadius: [2, 2, 0, 0] },
                data: rows.map((r) => (r.parts[c.name] || 0) / 100),
              }));
          option = {
            ...base,
            tooltip: {
              ...base.tooltip,
              trigger: "axis",
              formatter: axisTooltip,
            },
            grid: {
              left: 4,
              right: 12,
              top: 24,
              bottom: zoomed.value ? 54 : 18,
              containLabel: true,
            },
            xAxis: {
              type: "category",
              data: rows.map((r) => r.label),
              boundaryGap: !line,
              axisLine: { show: false },
              axisTick: { show: false },
              axisLabel: { color: muted, fontSize: 10, hideOverlap: true },
            },
            yAxis: {
              type: "value",
              splitNumber: 3,
              axisLabel: {
                color: muted,
                fontSize: 10,
                formatter: (n) =>
                  n >= 10000 ? `${+(n / 10000).toFixed(1)}万` : n,
              },
              splitLine: { lineStyle: { color: grid, type: "dashed" } },
            },
            dataZoom:
              zoomed.value
                ? [
                    {
                      type: "slider",
                      bottom: 16,
                      height: 22,
                      startValue: rows.length - visibleCount,
                      endValue: rows.length - 1,
                      handleSize: "140%",
                      showDataShadow: false,
                      borderColor: grid,
                      showDetail: false,
                    },
                  ]
                : [],
            series,
          };
        }
        chart.setOption(option, true);
        chart.resize();
      }
      Vue.onMounted(() => {
        observer = new ResizeObserver(render);
        observer.observe(canvas.value);
        media.addEventListener("change", render);
        render();
      });
      Vue.watch(
        () => [props.kind, props.rows, props.groups, props.visible],
        () => Vue.nextTick(render),
        { deep: true },
      );
      Vue.onUnmounted(() => {
        observer?.disconnect();
        chart?.dispose();
        media.removeEventListener("change", render);
      });
      return { canvas, zoomed };
    },
  };
})();
