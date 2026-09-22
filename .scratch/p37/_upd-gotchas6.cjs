'use strict';
// 一次性：坑总表加「判据完整性」条（本日第 2 次同类教训，升级为通用条）
const fs = require('fs');
const P = 'C:/Users/crx/.zcode/cli/memories/projects/music-player-7d1623ec4df6adfd/memory/sandbox-env-gotchas.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');
const anchor = '  - **★自称「全库扫描」前先核目标工具的完整字段规则**';
const i = t.indexOf(anchor);
if (i < 0) { console.log('★未找到锚'); process.exit(1); }
const lineEnd = t.indexOf('\n', i);
const add = '\n'
  + '  - **★★判据必须完整（一个「是」不够，可能还有「但是」）**〔有疤有闸·2026-09-22 两次同族教训〕：'
  + '①**leak 扫描**：首版只查 3 个字段（date/month/year）⇒ 276 条「推不出」；用 gate 完整 11 字段 ⇒ 57；'
  + '②**数据质量普查**：判「空 URL 缺陷」**只查「需要 URL」** ⇒ **误报 7 条**（crossref 3／nvd 3／mlb 1）；'
  + '**补查「有无派生层」**（' + BQ + 'URL_DERIVE' + BQ + '）⇒ 三个 kind 全有 ⇒ 7 条**全部正常**（0 条真缺陷）。'
  + '**纪律**：写任何「缺陷判据」前，先问「**这个条件之外，还有什么能让它不成立？**」；'
  + '判据**双向**（正条件 ＋ 反条件）都写进脚本，别只写一半。'
  + '\n'
  + '  - **★「时间倒挂」可能是 backfill 的正常形态**〔环境事实·2026-09-22〕：'
  + BQ + 'matures_at' + BQ + ' < ' + BQ + 'created_at' + BQ + ' 在 **backfill 题**上是**语义正确**的'
  + '（用过去事件回填 ⇒ 事件日必然早于落库时点）。实测全库 529 条**逐条核实 529/529 全为 backfill**，0 条例外。'
  + '**判据**：见到「时间倒挂」先按 ' + BQ + 'phase' + BQ + '/题面前缀分窗，别直接当缺陷。';
t = t.slice(0, lineEnd) + add + t.slice(lineEnd);
fs.writeFileSync(P, t, 'utf8');
console.log('坑总表已加 2 条（判据完整性 + 时间倒挂澄清）');
