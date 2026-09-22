'use strict';
// 一次性：坑总表加「粒度口径」条 + 补「自称全库扫描须核完整字段规则」
const fs = require('fs');
const P = 'C:/Users/crx/.zcode/cli/memories/projects/music-player-7d1623ec4df6adfd/memory/sandbox-env-gotchas.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');
const anchor = '  - **★2026-09-22 全库扫描（把点做成面）**：';
const i = t.indexOf(anchor);
if (i < 0) { console.log('★未找到锚'); process.exit(1); }
const lineEnd = t.indexOf('\n', i);
const add = '\n'
  + '  - **★★「粒度口径」是系统性议题**〔有疤有闸·2026-09-22〕：三次发现指向同一处——**gate 用粗粒度判泄漏**：'
  + '①**U 型路径题**（126 条）：**日期粒度**（gate）vs **序列粒度**（局内事件：cutoff=发言末、事件=计票，同一天）；'
  + '②**cwl 双色球**（2 条）：**日粒度**（gate）vs **时点粒度**（cutoff 01:07 早于开奖当晚）；'
  + '③（eurostat/noaa 7 条）：**非粒度问题**——是**出题时目标期选择错**（真泄漏）。'
  + '**判据**：前两类同族（gate 粒度不够细），第三类是另一个错。**处置**：两类均已在**决策①**覆盖（用户裁 A 维持现状）；**零改动**。'
  + '\n'
  + '  - **★自称「全库扫描」前先核目标工具的完整字段规则**〔有疤有闸·2026-09-22〕：初版全库 leak 扫描**只用了 3 个字段**'
  + '（' + BQ + 'date/month/year' + BQ + '）⇒ **276 条推不出**（被当成「未判」，但读者易误读为「没问题」）；'
  + '改用 gate 的**完整 11 字段规则**后 ⇒ **收窄到 57**（pass 1085→1302、leak 7→9）。'
  + '**纪律**：写扫描器前**先读目标判定器的字段清单**，别自己拍脑袋列字段；报告须显式写「未覆盖 N 条」（非「通过」）。';
t = t.slice(0, lineEnd) + add + t.slice(lineEnd);
fs.writeFileSync(P, t, 'utf8');
console.log('坑总表已加 2 条（粒度议题 + 全库扫描纪律）');
