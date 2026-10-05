#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/where-i-bias.cjs —— 「我在哪类事上偏」只读件（2026-09-30 · MCP 缺口第 ② 组）
 *
 * ── 为什么有这件 ────────────────────────────────────────────────────────────
 *   「你在哪类事上说大了/说小了」是本项目最核心的那个价值，而它原先**只活在一个 React
 *   组件的 useMemo 里**（web/src/pages/WhereOffPage.tsx），后端零命中 ⇒ 没有任何外部
 *   调用方够得着。2026-09-30 另两轨已把判据抽成 `p1b/src/disclosure/habitRank.mjs`
 *   并挂了只读端点 `GET /api/disclosure/habits`（HTTP 形态齐了）。
 *   ⇒ **MCP 形态还缺**：本件就是那一形态，且**判据一行都不重写**——它 require 同一份
 *   `habitRank.mjs`，与端点、与网页组件三方共用同一个口径。
 *
 * ── 上游件：与端点同源 ──────────────────────────────────────────────────────
 *   读 `p1b/sim/out/calibration-report-<日期>[字母].json` 的 `cells`（`latestByPattern`
 *   同款：日期后允许可选小写字母后缀，照 `routes/disclosure.js:26-28` 的既有修法）。
 *   ★**不重跑引擎、不重算任何分数**：cells 是现成列，本件只做那一步纯归并。
 *
 * ── 纪律 ────────────────────────────────────────────────────────────────────
 *   · **只读**：零写盘、零写库、零网络、零 LLM、零引擎重跑。产物只打 stdout。
 *   · **缺件照实说**：读不到披露件就 exit 1 并打出生成命令，**不编数、不返回空榜**。
 *   · **禁词**：stdout 会被 MCP 逐位透传成对外文案，故不得出现「预测」二字。
 *
 * 用法：
 *   node p1b/scripts/where-i-bias.cjs                      # 人读文本
 *   node p1b/scripts/where-i-bias.cjs --json               # 机器读（与端点同形）
 *   node p1b/scripts/where-i-bias.cjs --calibration <path> # 指定披露件（测试用）
 *
 * 退出码：0 有答案｜2 用法错｜1 缺件/不可解析
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'p1b', 'sim', 'out');
// ★require(ESM)：Node ≥22.12 起 CJS 可同步加载 ESM（本机 v24.19.0 已实测通过）。
//   口径真源是 ESM 的 habitRank.mjs（前端也要 import 同一份），本件不为了"顺手"改写成 CJS
//   ——那会立刻变成第二份实现，正是本项目最恨的那种漂移。
const { rankHabits, habitBuckets, HABIT_RANK_BASIS } = require(path.join(ROOT, 'p1b', 'src', 'disclosure', 'habitRank.mjs'));

const EXIT = { OK: 0, ERR: 1, USAGE: 2 };

function argOf(name) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v === undefined || v.slice(0, 2) === '--' ? null : v;
}
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i];
  if (['--calibration', '--json'].indexOf(t) < 0) {
    process.stderr.write('✗ 未知参数：' + t + '（本件只认 --calibration <path> 与 --json）\n');
    process.exit(EXIT.USAGE);
  }
  // ★带值的开关要把它的值跳过，否则 `--calibration x.json` 里的路径会被当成未知参数打红。
  if (t === '--calibration') i += 1;
}
const AS_JSON = process.argv.indexOf('--json') >= 0;

/** 最新披露件。日期后允许可选小写字母后缀（照 routes/disclosure.js 的既有修法）。 */
function latestCalibration() {
  try {
    const c = fs.readdirSync(OUT).filter((f) => /^calibration-report-\d{8}[a-z]?\.json$/.test(f)).sort();
    if (c.length) return path.join(OUT, c[c.length - 1]);
  } catch (e) { /* 目录不可读 ⇒ 视为缺件 */ }
  return null;
}

const file = argOf('calibration') || latestCalibration();
if (!file) {
  process.stderr.write('✗ 缺披露件：p1b/sim/out 下没有 calibration-report-<日期>.json\n'
    + '  生成命令：node p1b/scripts/calibration-report.cjs\n'
    + '  ⇒ 本次**不给任何偏差榜**（空榜会被读成「你没偏」，那是编数）。\n');
  process.exit(EXIT.ERR);
}
let j;
try { j = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) {
  process.stderr.write('✗ 披露件不可解析：' + path.basename(file) + '（' + (e && e.message) + '）\n');
  process.exit(EXIT.ERR);
}

const cells = Array.isArray(j.cells) ? j.cells : [];
// ★归并只做**一遍**（与端点同源，本件不自己数第二遍 —— 数第二遍就是第二个真相）。
//   桶数组留一份下来：榜与被剔掉的域都从它派生，桶数也因此能被外部核对
//   （「几格进的循环、剔掉几格、剩几个域」是能验的三件事，不是黑盒）。
const buckets = habitBuckets(cells);
const habits = rankHabits(cells);
const dropped = buckets
  .filter((b) => b.ok === 0)
  .map((b) => ({
    domain: b.domain, n: b.n, cells: b.cells,
    reason: '这个域没有任何一格够样本（ok=0）⇒ 按 n<30 纪律不给比例，只记方向',
  }));

const out = {
  script: 'p1b/scripts/where-i-bias.cjs',
  source_file: path.basename(file),
  generated_at: j.generated_at === undefined ? null : j.generated_at,
  cells_total: j.cells_total === undefined ? (Array.isArray(j.cells) ? j.cells.length : null) : j.cells_total,
  cells_with_conclusion: j.cells_with_conclusion === undefined ? null : j.cells_with_conclusion,
  // ★三个数合起来把「循环跑过没有」变成可核的：进循环的格数 − 剔掉的（delta 为 null 的）
  //   ＝ 剩下的桶数。少一个就说明循环提前退了或全被剔了。
  habit_buckets_total: buckets.length,
  habit_buckets_dropped: dropped.length,
  habits,
  ranking: HABIT_RANK_BASIS,
  dropped_domains: dropped,
  read_only: true,
  discipline: [
    '本件只读：只读落盘件 + 纯计算，不改账本任何一列、不重跑引擎、不调 LLM。',
    'delta 的分母是**够样本的格数（ok）**，不是题数 n。',
    '样本不足 30 的格不进本榜，也不出现在 dropped_domains 的任何比例字段里：只记方向。',
    '归并口径的真源是 p1b/src/disclosure/habitRank.mjs，本件、只读端点与网页组件共用同一份。',
    '本件只报**已结算**题目的历史统计事实，不含任何尚未到期的题，也不含任何关于未来的说法。',
  ],
};

if (AS_JSON) {
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(EXIT.OK);
}

const f = (x) => (x === null || x === undefined ? 'n/a' : (Math.round(Number(x) * 10000) / 10000).toFixed(4));
const L = [];
L.push('我在哪类事上偏（按域归并的偏差榜 · 单一真源 src/disclosure/habitRank.mjs）');
L.push('披露件：' + out.source_file + '　格数：' + out.cells_total + '　其中够样本可出结论：' + out.cells_with_conclusion);
L.push('');
if (!habits.length) {
  L.push('（榜是空的：没有任何一个域有够样本的格。）');
  L.push('★空榜**不是**「你没偏」，是「还没测够」——按 n<30 纪律只记方向、不给比例。');
} else {
  L.push('  域'.padEnd(24) + '题数 n'.padStart(8) + '够样本格 ok'.padStart(12) + '平均偏差 delta'.padStart(16));
  for (const h of habits) L.push('  ' + h.domain.padEnd(22) + String(h.n).padStart(8) + String(h.ok).padStart(12) + f(h.delta).padStart(16));
}
L.push('');
if (dropped.length) {
  L.push('── 不进榜的域（一个够样本的格都没有 ⇒ 只记方向）──');
  for (const d of dropped) L.push('  ' + d.domain.padEnd(22) + '题数 ' + String(d.n).padStart(5) + '　格数 ' + String(d.cells).padStart(4));
  L.push('');
}
L.push(out.ranking.what);
L.push(out.ranking.order);
L.push(out.ranking.denominator);
L.push(out.ranking.dropped);
L.push(out.ranking.n30);
L.push('');
L.push('★本件不给总分、不给「你准不准」的裁决句：裁决留给读的人。');
process.stdout.write(L.join('\n') + '\n');
process.exit(EXIT.OK);
