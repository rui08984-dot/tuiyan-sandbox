'use strict';
// 口径B 微步2 补丁4：修 ddDraw 两位年比较 bug（DLT '26105' 年段='26' 而非 2026）
const fs = require('fs');
const F = 'E:/music player/p1b/scripts/g2-report.cjs';
let src = fs.readFileSync(F, 'utf8');
const LF = String.fromCharCode(10);
const A1 = "  const cfg = { 7: { yl: 4, issue: 106, date: '2026-09-13', offs: [0, 2, 4] }, 5: { yl: 2, issue: 105, date: '2026-09-14', offs: [0, 2, 5] } }[s.length];" + LF
+ "  if (!cfg) return null;" + LF
+ "  const y = Number(s.slice(0, cfg.yl)); if (y !== 2026) return null;";
const B1 = "  const cfg = { 7: { yl: 4, year: 2026, issue: 106, date: '2026-09-13', offs: [0, 2, 4] }, 5: { yl: 2, year: 26, issue: 105, date: '2026-09-14', offs: [0, 2, 5] } }[s.length];" + LF
+ "  if (!cfg) return null;" + LF
+ "  const y = Number(s.slice(0, cfg.yl)); if (y !== cfg.year) return null; // 7位年=2026（4位）；5位年段=26（2位）";
const n1 = src.split(A1).length - 1;
if (n1 !== 1) throw new Error('锚点非唯一或缺失(' + n1 + ')');
src = src.replace(A1, B1);
fs.writeFileSync(F, src, 'utf8');
console.log('PATCH4 ok: ddDraw year compare fixed');
