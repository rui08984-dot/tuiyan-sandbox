'use strict';
// 一次性：坑总表加「数据未发布 ≠ 窗口未开始」条（2026-09-22 诊断产出）
const fs = require('fs');
const P = 'C:/Users/crx/.zcode/cli/memories/projects/music-player-7d1623ec4df6adfd/memory/sandbox-env-gotchas.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');
// 找「③ 判据统计」节的位置（该坑属判据/口径族）
const anchor = '## 三、判据统计与口径';
const i = t.indexOf(anchor);
if (i < 0) {
  // 退化：找任一三级标题后插入
  const j = t.indexOf('## ');
  if (j < 0) { console.log('★未找到插入点'); process.exit(1); }
}
const add = [
'',
'- **★「数据未发布」≠「窗口未开始」**〔有疤有闸·2026-09-22 诊断〕：出题时若把目标期选成**当期/当年**（期已开始），',
'  即使该期数据尚未发布，**判词仍能接触期内信息** ⇒ **真泄漏**（gate 判 ' + BQ + 'leak' + BQ + '）。',
'  ★实测两例（同型错，先犯后修）：① **I1 生成器 v1/v2**——v1 取「下一个即将发布的期」⇒ 目标期落当期 ⇒ leak；',
'  v2 改「期已结束但数据未发布」⇒ **仍 leak**（cutoff 晚于期起点）；**v3 才对**＝「**期首日严格晚于 cutoff**」。',
'  ② **历史生产题 ' + BQ + 'eurostat_live_*' + BQ + ' 9 条中 6 条判 leak**（过锚率 33%）：3 条问「未来期」（' + BQ + 'month=2026-10' + BQ + '，pass）／',
'  3 条问「当期」（' + BQ + 'month=2026-09' + BQ + '，leak）／3 条问「当年」（' + BQ + 'year=2026' + BQ + '，leak）；生成器已不在盘上（疑为一次性脚本）。',
'  **判据**：出题时目标期必须**整体晚于 cutoff**（期首日 > cutoff），**不是**「数据尚未发布」。',
'  **闸**：' + BQ + 'calendar-questions.test.cjs' + BQ + ' ①（零泄漏锁：断言期首日 > cutoff）＋反向锁（不得回退 v1/v2 口径）。',
'  **处置纪律**：已入账的历史题**不改**（账本不可变）；把 6 条移出池＝**按读数反推口径＝事后择优**，禁。',
].join('\n');
// 插到第三节标题后（若有）或文件末
if (i >= 0) {
  const lineEnd = t.indexOf('\n', i);
  t = t.slice(0, lineEnd + 1) + add + '\n' + t.slice(lineEnd + 1);
} else {
  t = t + '\n' + add + '\n';
}
fs.writeFileSync(P, t, 'utf8');
console.log('坑总表已加「数据未发布 ≠ 窗口未开始」');
