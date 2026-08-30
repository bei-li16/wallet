/**
 * dayjs 初始化：zh-cn locale（weekStart:1，周一为一周起点）+ 比较插件
 * 必须在 app.js 之前加载
 */
dayjs.locale('zh-cn');
dayjs.extend(dayjs_plugin_isSameOrAfter);
dayjs.extend(dayjs_plugin_isSameOrBefore);
