# Wallet 桌面版（Wails v2）

Windows 桌面记账应用：Go + 系统 WebView2 壳，前端为无构建的原生 HTML/JS 模块。
单文件 `Wallet.exe` 约 12MB，运行内存约 30-40MB，无任何运行时依赖（WebView2 系统自带）。

## 功能

与网页版（`../index.html`）完全对齐：四 Tab（首页/记一笔/报表/趋势）、
消费记录增删改查、批量删除、类别/子类别筛选与管理、月预算、
周报/月报/年报/总报（堆叠柱状图 + 饼图 + 点击下钻 + 上期对比）、
消费趋势（周/月/年折线 + 年度类别占比环形图）。

### 相对网页版的修复与增强

| 项 | 网页版 | 桌面版 |
|---|---|---|
| CSV 同步 | File System Access API，句柄刷新即丢，每次启动重连 | 同步路径持久化；**手动同步**——改动后点「同步」才写盘，卡片显示未同步状态；退出时若有未同步修改弹窗询问（同步并退出/直接退出） |
| CSV 读写弹窗 | 浏览器 save/open picker | 原生文件对话框（`PickSaveCsv`/`PickOpenCsv`） |
| 脏数据处理 | JSON 解析失败静默清空 | 先备份原始内容到 `<key>_corrupt_<时间戳>` 再降级，并提示用户 |
| 确认框/提示 | `alert()` / `confirm()` 原生弹窗 | 应用内确认弹窗 + Toast（删除支持撤销） |
| 全选范围 | 只选最近 20 条可见记录 | 当前筛选下全部记录 |
| 图表自适应 | 不响应窗口尺寸变化 | ResizeObserver 自动 resize |
| ISO 周边界 bug | `getISOWeek1Monday` 未截断时分秒，跨年周归属受运行时刻影响 | 已修复（`startOf('day')`），并有金样例测试锁定 |
| 金额浮点误差 | 直接累加显示 | `round2` 归一后再显示 |
| 添加后跳转 | 添加记录后强制跳回首页 | 留在记一笔页并重置表单，便于连续记账（编辑保存仍回首页） |
| 柱状图下钻 | 仅饼图支持点击下钻 | 柱状图点击柱条同样下钻到子类别（顶层有效，下钻态不响应） |

## 目录结构

```
desktop/
├── main.go                  Go 壳：窗口 + 原生对话框/文件读写绑定
├── wails.json               Wails 配置（无前端构建步骤）
├── go.mod
├── frontend/dist/           前端静态资源（Wails 直接内嵌）
│   ├── index.html
│   ├── css/                 style.css（含桌面补充样式）、variables.css
│   └── js/
│       ├── vendor/          vue / dayjs(+插件+locale) / echarts（与根 lib/ 相同）
│       ├── domain/          纯函数领域层：periods.js / csv.js / aggregate.js
│       ├── storage.js       存储适配器（localStorage + 桌面文件桥）
│       ├── charts.js        ECharts option 工厂 + 图表管理器
│       ├── boot.js          dayjs 初始化（zh-cn，weekStart:1）
│       └── app.js           Vue 应用主体
├── build/
│   ├── appicon.png          应用图标源图
│   ├── gen_icon.py          图标生成脚本（Pillow）
│   ├── windows/icon.ico
│   └── bin/Wallet.exe       构建产物（已 gitignore）
└── tests/test-domain.js     领域层金样例测试（node 直跑）
```

## 构建与运行

依赖：Go ≥ 1.21、Wails CLI v2（`go install github.com/wailsapp/wails/v2/cmd/wails@latest`）。
Windows 首次构建会自动下载依赖；无需 Node/管理员权限。

```bash
cd desktop
wails build          # 产物: build/bin/Wallet.exe
wails dev            # 开发模式（热加载）
node tests/test-domain.js   # 领域层测试（需 Node）
```

发布：各版本安装包（`Wallet.exe` + `SHA256SUMS.txt`）发布在
[GitHub Releases](https://github.com/bei-li16/wallet/releases)，tag 为 `v1.0.x`；
发布目录 `release/`、安装包、EXE 和校验文件均不进入 Git；全部发布附件只上传 GitHub Releases。本地仅保留桌面版最新发布包，构建产生的重复 EXE 可在校验一致后清理。

## 数据与迁移

- 主存储：localStorage（`wallet_expenses` / `wallet_subcategories` / `wallet_budget`，
  另有 `wallet_schema_version`、`wallet_csv_path`、`wallet_last_sync_at`）。
  WebView2 的 localStorage 落盘于 `%LOCALAPPDATA%\com.wails.wallet`。
- 从网页版迁移：在网页版导出 CSV → 桌面版"导入CSV"选择该文件（按 id 去重合并）。
- CSV 格式与网页版逐字节兼容（BOM + CRLF + 定列序 + 引号规则），导出文件可直接用 Excel 打开。

## 浏览器降级模式

`frontend/dist` 也可直接静态托管（如 `python -m http.server`）在浏览器打开：
此时原生对话框不可用，导入/导出自动降级为文件选择 + 下载，其余功能不变。

go test ./...        # 原生文件桥测试（读写往返/默认路径/目录回退）
