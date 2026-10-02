// Synthetic data only. Run manually to prepare browser import tests.
const fs = require("node:fs");
const path = require("node:path");
const C = require("../js/domain/core.js");
const dir = path.join(__dirname, "fixtures");
fs.mkdirSync(dir, { recursive: true });
const now = C.today(),
  records = [];
const amounts = { 餐饮: 2850, 交通: 600, 购物: 12900, 居住: 220000, 娱乐: 4500, 医疗: 3800, AI: 19900, 其他: 2000 };
for (let i = 0; i < 76; i++) {
  const cat = C.CATEGORIES[i % C.CATEGORIES.length].name,
    date = i < 21 ? C.addDays(now, -i) : C.shiftMonth(now, -(i - 20));
  records.push(
    C.normalizeRecord({
      id: "fixture-" + i,
      amountCents: amounts[cat],
      category: cat,
      subcategory: C.SUBS[cat][0],
      date,
      note: i === 0 ? '测试数据：咖啡,"燕麦奶"\n第二行备注' : "测试数据 " + i,
      createdAt: 1000 + i,
      updatedAt: 2000 + i,
    }),
  );
}
fs.writeFileSync(path.join(dir, "expenses.csv"), C.toCSV(records));
fs.writeFileSync(
  path.join(dir, "empty-backup.json"),
  C.makeBackup(C.initialState()),
);
fs.writeFileSync(
  path.join(dir, "conflicts.csv"),
  C.toCSV([
    { ...records[0], amountCents: 9999, updatedAt: 999999 },
    records[1],
    { ...records[2], id: "fixture-new" },
  ]),
);
const carSubs = ["停车", "加油", "过路费", "充电", "保险", "轮胎", "保养", "违章", "补胎", "玻璃水"];
const longReport = [];
for (let month = 0; month < 28; month++) {
  const date = C.shiftMonth("2024-06-01", month);
  carSubs.forEach((subcategory, index) => longReport.push(C.normalizeRecord({
    id: `scroll-${month}-${index}`, amountCents: (month + 1) * (index + 1) * 100,
    category: "交通", subcategory, date, note: "纯合成滚动验收数据",
    createdAt: 1000 + month * 10 + index, updatedAt: 1000 + month * 10 + index,
  })));
}
fs.writeFileSync(path.join(dir, "scroll-categories.csv"), C.toCSV(longReport));
console.log("Created synthetic CSV, long report and empty backup in tests/fixtures");
