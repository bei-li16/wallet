# 本地前端依赖

从本仓库 `desktop/frontend/dist/js/vendor/` 原样复制，未修改压缩库代码：

- Vue 3.5.33，MIT，保留文件头版权声明。
- Apache ECharts 5.4.3，Apache License 2.0，保留文件头许可声明。

所有运行时依赖均随应用离线缓存，不使用 CDN。应用自身图标为本目录之外 `js/icons.js` 和 `icons/` 中的原创 SVG/程序绘制资源。

分发时一并保留本目录的 `vue-LICENSE.txt`、`echarts-LICENSE.txt`、`echarts-NOTICE.txt` 和 `echarts-LICENSE-d3.txt`，分别来自对应上游版本的 [Vue 许可](https://github.com/vuejs/core/blob/v3.5.33/LICENSE)、[ECharts 许可](https://github.com/apache/echarts/blob/5.4.3/LICENSE)、[NOTICE](https://github.com/apache/echarts/blob/5.4.3/NOTICE) 和 [d3 组件许可](https://github.com/apache/echarts/blob/5.4.3/licenses/LICENSE-d3)。
