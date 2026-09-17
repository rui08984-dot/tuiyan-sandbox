'use strict';
// 一次性维护脚本（修正版）：把（十九）批块登记进 p19 倒序索引
// ★坑：索引文件是 CRLF ⇒ 用 `sep + '\n'` 做替换会静默不命中（indexOf 命中、replace 落空）⇒ 此处按 \r?\n 处理
const fs = require('fs');
const IDX = 'E:/music player/docs/sandbox/p1b/itest/p19-ANCHOR-INDEX.md';
const P19 = 'E:/music player/docs/sandbox/p1b/itest/p19-PROGRESS.md';
const p19 = fs.readFileSync(P19, 'utf8');
const lines = p19.split('\n').length;
const bytes = Buffer.byteLength(p19);
let cur = fs.readFileSync(IDX, 'utf8');
console.log('行尾 CRLF=' + /\r\n/.test(cur));

const newRow = '| 123 | L2127 | 【2026-09-17（十九）· 9 臂解耦实验（3 变体 × 3 温度 ＋ 重复对照臂）⇒ 出口 ③-b 交裁决 ＋ ★v3 退化臂 ＋ ★L6 口径污染】 | '
  + '**PREREG 冻结** sha `072e8486…`（判据三件套 C0/C1/C2/C3＋16④4B 两出口＋**补出口③**）；**锚题 40**（L6/30 局，**按局轮转**零 RNG；★「按 id 等距」与题型周期混叠故弃用）＋工件 `prereg_sha256` 互锁；'
  + '**执行** 400 条件（9 臂＋同批重复臂；3 个按题分片）⇒ 调用 **608**／成功 **534**／唯一条件 **400**／未成功 **10**（覆盖 97.5%）／成本 **≈¥3.25**；'
  + '★**失败非随机**（全在 v1 臂，延迟由输出长度定 `Corr=0.961` ⇒ 撞 60s 网关超时）；★**过程缺陷**（重试未带 --qshard ⇒ 154 行重复执行；改白名单＋判据机「首个成功行胜出」）；'
  + '**读数**：C0 通过（σ̂_R=0.1061）／**C1 角色效应不可辨**（Holm 全 p=1.0）／C2 不可辨／**λ̂_lo=−0.0792 ⇒ 低重叠** ⇒ **出口 ③-b**（交裁决）；'
  + '★**v3_baserate 是退化臂**（T=0.7 40/40=0.58；**存量 0.58×202**）⇒ 池＝两路有信息＋一路常数、**L6 读数约 1/3 是常数**、涉及 v3 的 λ̂ 是构造性读数（换干净对 v1−v2：N=2 MLE 0.3775–0.5012 仍<0.8）；'
  + '★**判据只测位置、主导差异在离散度**（|d̄|≤0.033 vs 平均绝对差 0.15–0.25；同族第 7 次）；★**L6 口径污染**（max-id 无 run_id 过滤 ⇒ 假想写入 37/38 题读数会变、平均 |Δp|=0.0753）⇒ **零账本写**（SQL 指纹六表逐位相同）；'
  + '测试 **486→497/497**；脚本 **106→108**（prereg-freeze 重构＋导出 freezeSha）。 |';

// 1) 新行插到表头（分隔行之后）
const sepRe = /\|---\|---\|---\|---\|(\r?\n)/;
if (!sepRe.test(cur)) throw new Error('表头分隔行未匹配');
cur = cur.replace(sepRe, (m, nl) => m + newRow + nl);

// 2) 头部规模行
const headRe = /规模：\d+ 行 \/ \d+ B \/ \*\*\d+ 个断点块\*\*/;
if (!headRe.test(cur)) throw new Error('头部规模行未匹配');
cur = cur.replace(headRe, '规模：' + lines + ' 行 / ' + bytes + ' B / **123 个断点块**');

// 3) 页脚写死计数更正（120 → 123；幂等：已是 123 则跳过）
if (cur.indexOf('· 120 块 ·') >= 0) cur = cur.replace('· 120 块 ·', '· 123 块 ·');
else if (cur.indexOf('· 123 块 ·') < 0) throw new Error('页脚计数形态未知（既非 120 也非 123）');

fs.writeFileSync(IDX, cur, 'utf8');
const after = fs.readFileSync(IDX, 'utf8');
const rows = after.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
const nums = rows.map((l) => Number(l.match(/^\|\s*(\d+)/)[1]));
console.log('索引行数=' + rows.length + '｜编号范围 ' + Math.min.apply(null, nums) + '–' + Math.max.apply(null, nums));
console.log('首行数据行=' + rows[0].slice(0, 60));
console.log('头部=' + (after.match(/规模：[^。]*/) || [])[0]);
console.log('页脚=' + (after.match(/（索引完[^）]*）/) || [])[0]);
const p19L = p19.split('\n');
console.log('L2127 实际=' + p19L[2126].slice(0, 50));
console.log('行尾 CRLF 保持=' + /\r\n/.test(after));
