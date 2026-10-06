# Wallet - 消费记录管理

简洁实用的浏览器端消费记录管理应用。

## 功能特点

- **消费记录管理** - 添加、编辑、删除消费记录
- **多维度报表** - 周报、月报、年报、总报
- **可视化图表** - 堆叠柱状图、饼图（支持 drill-down）
- **趋势分析** - 周/月/年消费趋势折线图
- **预算管理** - 月预算设置与进度跟踪
- **数据持久化** - localStorage + CSV 导入导出
- **深色主题** - 护眼深色模式 UI

## 技术栈

| 技术 | 用途 |
|------|------|
| Vue 3 | 前端框架 |
| ECharts 5 | 图表库 |
| Day.js | 日期处理 |
| 自定义工具类 | 样式（Tailwind 风格） |
| localStorage | 本地存储 |
| CSV | 数据导入导出 |

## 使用方法

### 直接运行

1. 双击 `index.html` 在浏览器中打开
2. 推荐使用 Chrome 或 Edge（支持 File System Access API）

### 记一笔

1. 点击底部导航「记一笔」
2. 选择日期、金额、主类别、子类别
3. 可添加备注信息
4. 点击「添加记录」保存

### 查看报表

1. 点击「报表」Tab
2. 选择时间维度：周报/月报/年报/总报
3. 切换图表类型：柱状图/饼图
4. 点击饼图扇区可 drill-down 查看子类占比
5. 总报模式支持按月/按年切换颗粒度

### 数据导入导出

- **首页**：导出 CSV、导入 CSV
- **趋势页**：CSV 同步状态、手动导出/导入

> CSV 文件包含字段：id, amount, category, subcategory, date, note, createdAt, updatedAt

## 消费类别

| 主类别 | 子类别 |
|--------|--------|
| 餐饮 | 早餐、午餐、晚餐、零食、饮料 |
| 交通 | 打车、公交、地铁、加油、保险、停车 |
| 购物 | 日用品、网购、服饰、数码 |
| 居住 | 房租、水电、物业、装修 |
| 娱乐 | 电影、游戏、旅游、运动 |
| 医疗 | 门诊、买药、体检 |
| 其他 | 礼品、捐赠、其它 |

支持自定义添加子类别。

## 数据存储

- **主要存储**：浏览器 localStorage
- **本地文件**：data/expenses.csv（Chrome/Edge 自动同步）
- **隐私说明**：消费数据存储在本地，不会随代码上传

## 文件结构

```
wallet/
├── index.html               # 完整应用（～2130行）
├── AGENTS.md                # OpenCode 指令
├── CLAUDE.md                # Claude Code 指令
├── css/
│   ├── variables.css        # CSS 变量（通过 style.css 加载）
│   └── style.css            # 全局样式（已从 index.html 加载）
├── data/
│   └── expenses_template.csv # CSV 模板
├── docs/
│   └── 开发计划书.md        # 开发计划
├── lib/                     # 独立库文件（未从 index.html 加载，仅供参考）
├── .gitignore               # Git 忽略配置
└── README.md               # 本文件
```

## 发布产物管理

Git 跟踪源代码、文档、配置和应用所需的静态资源。安装包、EXE、ZIP、发布校验文件以及 `release/`、`ios-pwa/release/` 中的本地发布/部署产物由 `.gitignore` 排除，发布附件只上传 [GitHub Releases](https://github.com/bei-li16/wallet/releases)。

本地清理分别保留 Windows 桌面版和 iOS PWA 的最新版本；PWA 当前部署目录、Windows HTTPS 证书与服务配置保留。GitHub 历史 Release 和源码标签继续保留。`desktop/frontend/dist/` 是直接嵌入桌面程序的前端源码，`desktop/build/` 中的图标及 Windows 清单是构建输入，仍需跟踪。

## License

MIT
