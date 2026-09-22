'use strict';
// 一次性：坑总表补「全库扫描」数字（把点升级为面）
const fs = require('fs');
const P = 'C:/Users/crx/.zcode/cli/memories/projects/music-player-7d1623ec4df6adfd/memory/sandbox-env-gotchas.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');
const anchor = '**处置纪律**：已入账的历史题**不改**（账本不可变）；把 6 条移出池＝**按读数反推口径＝事后择优**，禁。';
if (t.indexOf(anchor) < 0) { console.log('★未找到锚'); process.exit(1); }
const add = anchor + '\n'
  + '  - **★2026-09-22 全库扫描（把点做成面）**：1368 条有 ' + BQ + 'meta.cutoff' + BQ + ' 的题 ⇒ **leak 7 条／pass 1085／窗口起点推不出 276（单列）**；'
  + 'leak 分属 **3 个 kind**——eurostat_live 两 kind（6 条）＋**noaa_solar_cycle_ssn_monthly 1 条（新发现）**。'
  + '★**同批对照**（同 kind 6 条）：backfill 4 条 pass／未来期 forward 1 条 pass／**当期 forward 1 条 leak** ⇒ **同批里只有「当期」出错**。'
  + '⇒ **第三个同型实例**（前两＝I1 v1/v2、eurostat_live）⇒ 证明这是**跨 3 生成器/3 域的系统性易犯错**，非孤立事件。'
  + '**诚实边界**：扫描只覆盖有 cutoff 的题（1368/1994）⇒ 其余 626 条**未判**（非「通过」，是未覆盖）。';
t = t.replace(anchor, add);
fs.writeFileSync(P, t, 'utf8');
console.log('坑总表已补全库数字');
