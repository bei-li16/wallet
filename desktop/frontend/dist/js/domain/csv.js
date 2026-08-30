/**
 * CSV 领域逻辑（纯函数，零框架依赖）
 *
 * CSV 格式规格（与原版完全一致，保证老数据可无缝迁移）：
 * - UTF-8 带 BOM（\uFEFF），保证 Excel 直接打开不乱码
 * - \r\n 行尾
 * - 除 amount/createdAt/updatedAt 外所有字段一律加双引号，内部 " 转义为 ""
 * - 列序固定：id,amount,category,subcategory,date,note,createdAt,updatedAt
 */
(function (global) {
  'use strict';

  const HEADERS = ['id', 'amount', 'category', 'subcategory', 'date', 'note', 'createdAt', 'updatedAt'];
  const NUMERIC_INDEXES = new Set([1, 6, 7]); // amount, createdAt, updatedAt
  const BOM = '\uFEFF';

  /**
   * 记录数组 → CSV 文本（带 BOM）
   */
  function buildCSVContent(expenses) {
    const rows = expenses.map((e) => [
      e.id,
      e.amount,
      e.category,
      e.subcategory,
      e.date,
      e.note || '',
      e.createdAt,
      e.updatedAt
    ]);
    return (
      BOM +
      [HEADERS, ...rows]
        .map((row) =>
          row
            .map((cell, i) =>
              NUMERIC_INDEXES.has(i)
                ? cell
                : `"${String(cell == null ? '' : cell).replace(/"/g, '""')}"`
            )
            .join(',')
        )
        .join('\r\n')
    );
  }

  /**
   * CSV 行状态机解析器：正确处理引号内逗号与转义引号
   */
  function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  }

  /**
   * 解析 CSV 文本并与已有 id 集合去重合并（不做副作用，返回新记录）
   *
   * @param {string} text CSV 文本（可带 BOM）
   * @param {Set<string>} existingIds 已存在的 id 集合
   * @returns {{ records: Array, stats: { total, duplicateCount, invalidCount, successCount } }}
   */
  function parseCSV(text, existingIds) {
    const clean = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const lines = clean.split(/\r?\n/).filter((line) => line.trim());
    const stats = { total: 0, duplicateCount: 0, invalidCount: 0, successCount: 0 };
    if (lines.length < 2) {
      return { records: [], stats };
    }

    const dataLines = lines.slice(1);
    stats.total = dataLines.length;
    const now = Date.now();
    const records = [];

    for (const line of dataLines) {
      const fields = parseCSVLine(line);
      if (fields.length < 6) {
        stats.invalidCount++;
        continue;
      }
      const [id, amount, category, subcategory, date, note, createdAt, updatedAt] = fields;
      if (!amount || !category || !date || !dayjs(date).isValid()) {
        stats.invalidCount++;
        continue;
      }
      if (id && existingIds.has(id)) {
        stats.duplicateCount++;
        continue;
      }
      records.push({
        id: id || generateId(),
        amount: parseFloat(amount) || 0,
        category,
        subcategory: subcategory || '',
        date,
        note: note || '',
        createdAt: parseInt(createdAt) || now,
        updatedAt: parseInt(updatedAt) || now
      });
    }
    stats.successCount = records.length;
    return { records, stats };
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }

  global.WalletCSV = { HEADERS, buildCSVContent, parseCSVLine, parseCSV };
})(window);
