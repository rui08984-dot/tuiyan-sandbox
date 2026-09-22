#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/verdict-spread.cjs —— 9 路判词离散度披露件（2026-09-22 前端全方面重构 · 新增只读端点）
 *
 * 干什么（零 LLM／零网络／零写库；库 readOnly）：
 *   把「同一道题、同一时刻、3 prompt 变体 × 3 温度 = 9 路判词」的**横截面**摊开，
 *   供前端画分布直方图与离散度条。
 *
 * ★★ 口径铁律（这块数据最容易被误用，故写死在件里，前端必须原文披露）：
 *   本件是**单时刻横截面**，不是时间序列。
 *   依据（实测）：decouple9 批次的全部 verdicts 行 created_at **逐位相同**
 *   （一次性批量写入，构造上就没有时间轴）；而账本里另一类多读数题（如 pid=91 跨 20 个 run_id 的
 *   70 行）其 predictions.created_at 与 resolved_at **同秒** ⇒ 那些重复读数全部产生于
 *   **真值已知之后**，中间没有任何「信息到达」事件。
 *   ⇒ 把这类数据画成「概率随时间演化」的折线＝用绘图手法暗示一个不存在的认知过程，
 *     把 LLM 采样噪音讲成洞察。本件因此**只报分布与离散度，不报任何时间轴**。
 *   正确的学科名称是**重测信度 / 判词离散度**（同一输入重复采样的一致性），不是「信念更新」。
 *
 * 用法：node p1b/scripts/verdict-spread.cjs [--db <path>] [--out-dir <dir>] [--run-prefix decouple9-]
 *   产出：p1b/sim/out/verdict-spread-YYYYMMDD.json
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const RUN_PREFIX = arg('run-prefix', 'decouple9-');
const VARIANT_ORDER = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
};
const quantile = (sortedArr, q) => {
  if (!sortedArr.length) return null;
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sortedArr[base + 1] !== undefined
    ? sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base])
    : sortedArr[base];
};
const r4 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(4)) : null);

/** 等宽分箱（0..1 概率轴） */
function binRange(vals, binCount) {
  const bins = [];
  for (let i = 0; i < binCount; i++) bins.push({ x0: i / binCount, x1: (i + 1) / binCount, count: 0 });
  for (const v of vals) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    let idx = Math.floor(v * binCount);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  }
  return bins;
}

function main() {
  // 取数驱动照 mdl-retention.cjs:91-92 先例：node:sqlite DatabaseSync + readOnly
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });

  // 取数范式照 mdl-retention.cjs:89-97（同一四元组分组思路）
  const rows = db.prepare(
    'SELECT v.prediction_id AS pid, v.prompt_variant AS variant, v.temperature AS temp, '
    + 'v.implied_prob AS prob, v.run_id AS run, p.layer AS layer, p.outcome AS outcome '
    + 'FROM verdicts v JOIN predictions p ON p.id = v.prediction_id '
    + 'WHERE v.run_id LIKE ? AND v.implied_prob IS NOT NULL '
    + 'ORDER BY v.prediction_id, v.prompt_variant, v.temperature',
  ).all(RUN_PREFIX + '%');
  db.close();

  const DISCIPLINE = [
    '本件是单时刻横截面（同一题 3 变体 × 3 温度 = 9 路判词），不是时间序列。',
    '它度量的是判词离散度／重测信度（同一输入重复采样的一致性），不是「信念随时间更新」。',
    '禁止把本件的任何字段连成随时间演化的折线：decouple9 批次全部 created_at 逐位相同，构造上无时间轴。',
  ];

  // 按题聚合
  const byPid = new Map();
  for (const r of rows) {
    if (!byPid.has(r.pid)) byPid.set(r.pid, { pid: r.pid, layer: r.layer ?? null, outcome: r.outcome ?? null, cells: [] });
    byPid.get(r.pid).cells.push({ variant: r.variant, temp: r.temp, prob: r.prob, run: r.run });
  }

  const questions = [];
  for (const rec of byPid.values()) {
    const perVariant = {};
    for (const v of VARIANT_ORDER) {
      const ps = rec.cells.filter((c) => c.variant === v && typeof c.prob === 'number').map((c) => c.prob);
      perVariant[v] = ps.length
        ? { n: ps.length, values: ps.map(r4), mean: r4(mean(ps)), sd: r4(sd(ps)), min: r4(Math.min(...ps)), max: r4(Math.max(...ps)) }
        : { n: 0, values: [], mean: null, sd: null, min: null, max: null };
    }
    const all = rec.cells.filter((c) => typeof c.prob === 'number').map((c) => c.prob);
    if (!all.length) continue;
    const sorted = all.slice().sort((a, b) => a - b);
    questions.push({
      pid: rec.pid,
      layer: rec.layer,
      outcome: rec.outcome,
      row_count: all.length,
      variants: VARIANT_ORDER.filter((v) => perVariant[v].n > 0).length,
      per_variant: perVariant,
      spread: r4(Math.max(...all) - Math.min(...all)),
      mean: r4(mean(all)),
      sd: r4(sd(all)),
      p10: r4(quantile(sorted, 0.1)),
      p90: r4(quantile(sorted, 0.9)),
    });
  }
  questions.sort((a, b) => a.pid - b.pid);

  // 按变体汇总（离散度的核心读数：均值接近但离散度天差地别，这才是真信号）
  const byVariant = VARIANT_ORDER.map((v) => {
    const all = [];
    const spreads = [];
    const sds = [];
    for (const q of questions) {
      const pv = q.per_variant[v];
      if (pv.n > 0) { all.push(...pv.values); spreads.push(pv.max - pv.min); if (pv.sd !== null) sds.push(pv.sd); }
    }
    const ss = spreads.slice().sort((a, b) => a - b);
    return {
      variant: v,
      questions_with_reads: spreads.length,
      total_reads: all.length,
      mean: r4(mean(all)),
      pooled_sd: r4(sd(all)),
      median_spread: r4(quantile(ss, 0.5)),
      max_spread: r4(ss.length ? Math.max(...ss) : null),
      bins: binRange(all, 10),
    };
  });

  const allSpread = questions.map((q) => q.spread).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  const out = {
    title: '判词离散度披露件（9 路横截面）',
    script: 'p1b/scripts/verdict-spread.cjs',
    db: path.relative(ROOT, DB_PATH),
    run_prefix: RUN_PREFIX,
    generated_at: new Date().toISOString(),
    discipline: DISCIPLINE,
    no_time_axis: true,
    summary: {
      questions: questions.length,
      total_rows: rows.length,
      variants: VARIANT_ORDER,
      temperatures: [...new Set(rows.map((r) => r.temp))].sort((a, b) => a - b),
      runs: [...new Set(rows.map((r) => r.run).filter(Boolean))].sort(),
      complete_9_rows: questions.filter((q) => q.row_count === 9).length,
      median_spread: r4(quantile(allSpread, 0.5)),
      max_spread: r4(allSpread.length ? Math.max(...allSpread) : null),
    },
    by_variant: byVariant,
    questions,
  };

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const outFile = path.join(OUT_DIR, 'verdict-spread-' + stamp + '.json');
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
  console.log('written: ' + path.relative(ROOT, outFile)
    + ' | questions=' + questions.length + ' rows=' + rows.length
    + ' complete9=' + out.summary.complete_9_rows
    + ' median_spread=' + out.summary.median_spread);
}

if (require.main === module) main();
module.exports = { binRange };
