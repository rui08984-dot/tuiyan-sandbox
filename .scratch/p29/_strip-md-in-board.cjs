'use strict';
/*
 * 一次性工具（2026-09-21）：把 progress.md 表格「现状」列里的 Markdown 标记去掉。
 *
 * 为什么：dashboard.html 由 gen_dashboard.mjs 生成，该生成器**只做 HTML 转义、不解析 Markdown**
 *   （参考项目 D:\agent1super 同款设计）⇒ `**加粗**` 与反引号会以裸符号显示在卡片上。
 * 纪律：只改表格数据行的第 4 列（现状），不动模块/状态/依赖三列，不动表格外正文。
 */
const fs = require('fs');
const P = 'E:/music player/progress.md';
const bt = String.fromCharCode(96); // 反引号（避开 shell 转义）
let t = fs.readFileSync(P, 'utf8');
const lines = t.split(/\r?\n/);
let fixed = 0;
const out = lines.map((ln) => {
  if (!/^\|/.test(ln) || /^\|---/.test(ln) || /模块 \| 状态/.test(ln)) return ln;
  const parts = ln.split('|');
  if (parts.length < 6) return ln;            // 非四列行
  let note = parts[4];
  const before = note;
  note = note.replace(/\*\*/g, '');           // 去加粗
  note = note.split(bt).join('');             // 去反引号
  if (note !== before) fixed++;
  parts[4] = note;
  return parts.join('|');
});
fs.writeFileSync(P, out.join('\n'), 'utf8');
console.log('修正行数:', fixed);
