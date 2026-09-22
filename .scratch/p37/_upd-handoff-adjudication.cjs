'use strict';
// 一次性：交接件记录裁决（§4 拍板记录 + §5 待办清空）
const fs = require('fs');
const P = '.scratch/handoff/推演沙盘-交接-20260921-终态.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');

// ① §4 拍板记录追加
const anchor4 = '- **09-21**：「继续推进不要停」（本日多轮）⇒ 按推荐逐项执行';
if (t.indexOf(anchor4) < 0) { console.log('★未找到 §4 锚'); process.exit(1); }
t = t.replace(anchor4, anchor4 + '\n'
  + '- **★09-22 裁决（两项待拍板）**：用户裁决 **①U 型题 gate 口径＝A 维持现状／②cta-elexon 处置＝A 维持现状**（均按推荐）'
  + '⇒ **零改动**（U 型题留产物层不进 gate 判读；cta/elexon 每日 fail 如实记录）；'
  + '归档 ' + BQ + '.scratch/p37/待拍板决策清单-20260922.md' + BQ + '（头部含裁决结果）');

// ② §5 待办更新（两项结案）
const anchor5 = '## 5. 待用户事项（**当前 2 项待拍板**；其余等数据/知会）';
if (t.indexOf(anchor5) < 0) { console.log('★未找到 §5 标题'); process.exit(1); }
t = t.replace(anchor5, '## 5. 待用户事项（**★09-22 裁决后：待拍板 0 项**；其余等数据/知会）\n\n'
  + '**★两项待拍板已于 09-22 裁决（均 A 维持现状，零改动）**：\n'
  + '1. ~~U 型路径题的 gate 口径~~ ⇒ **A 维持现状**（U 型题留产物层，不进 gate 判读；无需求驱动，改判据须版本递进）\n'
  + '2. ~~被拦域处置~~ ⇒ **A 维持现状**（dlt ✅已修；cta/elexon 地域封禁为环境事实，每日 fail 如实记录）\n');
fs.writeFileSync(P, t, 'utf8');
console.log('交接件 §4／§5 已更新');
