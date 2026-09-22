'use strict';
// 一次性：交接件 §0 补 09-22 完成行（避开 bash 反引号）
const fs = require('fs');
const P = '.scratch/handoff/推演沙盘-交接-20260921-终态.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');
// 用「行前缀」定位，不用含反引号的完整串
const lines = t.split('\n');
const idx = lines.findIndex((l) => l.indexOf('| 待拍板 |') === 0 && l.indexOf('待拍板决策清单') >= 0);
if (idx < 0) { console.log('★未找到待拍板行'); process.exit(1); }
const add = '| **09-22 完成** | ①例行结算 3 条补结（已解 1658→**1661**）②角色③候选留痕旁路（' + BQ + '--record-candidates' + BQ + '，严格口径跑通）③修「跑测试写仓库产物」缺陷 | 本件头部刷新注 |';
lines.splice(idx + 1, 0, add);
fs.writeFileSync(P, lines.join('\n'), 'utf8');
console.log('§0 已补（在第 ' + (idx + 1) + ' 行后）');
