#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/assumption-recalc.cjs —— A1 假设重算器 v0（2026-09-17 · 第 3 期首选票，蓝图 §2.3-1）
 *
 * 用途：「如果某类题不算，读数会变成什么」——在**既有读数件的现成列**上做**排除集重算**（零引擎重跑、零写库）。
 * 判据（蓝图原文）：**金样零 diff**（无排除 ⇒ 读数与基线逐位一致）＋**零账本写**＋**探索性标注**。
 * ④ 补充条款兑现（19 号裁剪执行记录 §2.2）：**对内件也强制挂探索性标注**——本件输出头恒挂，防「对内件漂移成对外品」。
 * 口径（显式）：
 *   · 输入＝stage4 五层读数件（`by_domain` 逐格 scored_n/brier_engine/delta_vs_half/obs_rate/mean_p）。
 *   · 排除重算＝**加权均值扣除**：B_excl = (Σ n·b − Σ_excl n·b) / (Σ n − Σ_excl n)（Brier 是均值 ⇒ 可精确扣除）；
 *     同理扣 obs_rate；const_half 的 Brier 由 brier_engine − delta_vs_half 反推。
 *   · **不重算 CI**（bootstrap 需逐题数据；本件如实标 n/a，不编数）。
 *   · 排除集用尽（n_excl ≥ n_all）⇒ 该层标 n/a，不给数。
 * 用法：
 *   node p1b/scripts/assumption-recalc.cjs [--stage4 <path>] [--out-dir <dir>] \
 *        [--exclude domain:<d>] [--exclude cell:<layer>/<domain>] ...   # 可重复
 * require 安全：主流程只在 CLI 直跑（require.main === module）时执行——测试 require 本件（取其纯函数）不得写盘。
 *   （教训：顶层写盘 + require ⇒ 测试跑起来就往 sim/out 写同名件，覆盖 tracked 产物。）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
function latestByPattern(dir, re, fallback) { try { const c = fs.readdirSync(dir).filter((f) => re.test(f)).sort(); if (c.length) return path.join(dir, c[c.length - 1]); } catch (e) { /* ignore */ } return path.join(dir, fallback); }

/** 单层扣除重算（纯函数，供测试）：只聚合**可出结论格**（brier_engine 为有限数者）；薄格不计入聚合但计入披露 */
function recalcLayer(list, excludedKeys, dropDomains) {
  const dd = dropDomains || [];
  const inN = (c) => Number(c.scored_n) || 0;
  const finite = (c) => isFinite(Number(c.brier_engine)) && c.brier_engine !== null && c.brier_engine !== undefined;
  const isEx = (c) => excludedKeys.indexOf(c.layer + '/' + c.domain) !== -1 || dd.indexOf(String(c.domain)) !== -1;
  const evalAll = list.filter(finite);
  const keep = evalAll.filter((c) => !isEx(c));
  const drop = evalAll.filter((c) => isEx(c));
  const nEvalAll = evalAll.reduce((s, c) => s + inN(c), 0);
  const nAll = list.reduce((s, c) => s + inN(c), 0);
  const halfOf = (c) => Number(c.brier_engine) - Number(c.delta_vs_half || 0);
  const sumN = keep.reduce((s, c) => s + inN(c), 0);
  const dropN = drop.reduce((s, c) => s + inN(c), 0);
  const agg = (arr, f) => { const n = arr.reduce((s, c) => s + inN(c), 0); return n > 0 ? arr.reduce((s, c) => s + inN(c) * f(c), 0) / n : null; };
  return {
    n: sumN, n_dropped: dropN, n_eval_all: nEvalAll, n_layer_all: nAll, thin_gap: nAll - nEvalAll,
    brier: agg(keep, (c) => Number(c.brier_engine)), const_half: agg(keep, halfOf), obs_rate: agg(keep, (c) => Number(c.obs_rate)),
    delta: (agg(keep, (c) => Number(c.brier_engine)) !== null && agg(keep, halfOf) !== null) ? agg(keep, (c) => Number(c.brier_engine)) - agg(keep, halfOf) : null,
    note: keep.length ? null : '排除后评估格为空 ⇒ n/a（薄格不计入聚合，见 n_layer_all/thin_gap）',
  };
}

function main() {
  const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
  const IN_DIR = arg('in-dir', path.join(ROOT, 'p1b', 'sim', 'out'));   // 输入件恒在默认 sim/out 解析（与 --out-dir 解耦；教训=E1 快照同类）
  const S4 = arg('stage4', latestByPattern(IN_DIR, /^stage4-run-five-layers-\d{8}\.json$/, 'stage4-run-five-layers-20260914.json'));
  const EXCLUDES = []; for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--exclude' && process.argv[i + 1]) EXCLUDES.push(process.argv[i + 1]);

  const s4 = JSON.parse(fs.readFileSync(S4, 'utf8'));
  const cells = Array.isArray(s4.by_domain) ? s4.by_domain : [];
  if (!cells.length) { console.error('stage4 件缺 by_domain（本件需要分域列）：' + S4); process.exit(2); }

  const SPEC_D = EXCLUDES.filter((x) => x.startsWith('domain:')).map((x) => x.slice(7));
  const SPEC_C = EXCLUDES.filter((x) => x.startsWith('cell:')).map((x) => x.slice(5));

  const layers = Array.from(new Set(cells.map((c) => c.layer))).sort();
  const rows = []; const out = { script: 'p1b/scripts/assumption-recalc.cjs', status: '探索性·不载判据',
    exploratory_notice: '本件为假设重算（探索性）——不进任何门控/判据；数字只用于「看一眼会怎样」，引用须照原读数件复核。',
    stage4_file: S4, excludes: { domain: SPEC_D, cell: SPEC_C }, layers: {}, generated_at: new Date().toISOString() };
  for (const L of layers) {
    const list = cells.filter((c) => c.layer === L);
    const excl = recalcLayer(list, SPEC_C, SPEC_D);
    const base = { n: excl.n + excl.n_dropped, brier: null };
    const fin = list.filter((c) => isFinite(Number(c.brier_engine)) && c.brier_engine !== null);
    const nF = fin.reduce((s, c) => s + (Number(c.scored_n) || 0), 0);
    base.brier = nF ? fin.reduce((s, c) => s + (Number(c.scored_n) || 0) * Number(c.brier_engine), 0) / nF : null;
    out.layers[L] = { stage4_layer_brier: (s4.report && s4.report[L]) ? s4.report[L].brier_engine : null,
      agg_basis: '仅可出结论格（n≥30）加权聚合；薄格不计入（n 与差见 n_layer_all/thin_gap）',
      base: base, excluded: excl };
    rows.push({ L: L, baseN: base.n, baseB: base.brier, exN: excl.n, exDrop: excl.n_dropped, exB: excl.brier,
      stage4B: (s4.report && s4.report[L]) ? s4.report[L].brier_engine : null, thinGap: excl.thin_gap });
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const md = [];
  md.push('# A1 假设重算器 v0（排除集重算 · 探索性） ' + today);
  md.push('');
  md.push('> **' + out.exploratory_notice + '**');
  md.push('> 输入：`' + path.basename(S4) + '`｜排除：' + (EXCLUDES.length ? EXCLUDES.join('、') : '（无——金样回归态）'));
  md.push('> 口径：加权均值精确扣除（Brier 是均值）；**CI 不重算**（如实 n/a）；零账本写。');
  md.push('');
  md.push('| 层 | 基线 n（评估格） | 基线 Brier | stage4 层读数（参照） | 排除后 n | 扣除 n | 排除后 Brier | 与基线差 | 薄格 n |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  const f4 = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(4);
  for (const r of rows) md.push('| ' + r.L + ' | ' + r.baseN + ' | ' + f4(r.baseB) + ' | ' + f4(r.stage4B) + ' | ' + r.exN + ' | ' + r.exDrop + ' | ' + f4(r.exB)
    + ' | ' + f4(r.exB === null || r.baseB === null ? null : r.exB - r.baseB) + ' | ' + r.thinGap + ' |');
  md.push('');
  md.push('（A1 v0 · 零 LLM／零写库 · 输出页恒挂探索性标注——19 号裁剪执行记录 §2.2 兑现）');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jf = path.join(OUT_DIR, 'assumption-recalc-' + today + '.json');
  const mf = path.join(OUT_DIR, 'assumption-recalc-' + today + '.md');
  fs.writeFileSync(jf, JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(mf, md.join('\n') + '\n', 'utf8');
  console.log('=== A1 假设重算器 v0（探索性）===');
  console.log('排除：' + (EXCLUDES.length ? EXCLUDES.join('、') : '（无）'));
  for (const r of rows) console.log('  ' + r.L + '：基线 n=' + r.baseN + ' B=' + f4(r.baseB) + ' → 排除后 n=' + r.exN + ' B=' + f4(r.exB) + '（扣除 ' + r.exDrop + '）');
  console.log('json/md -> ' + OUT_DIR);
}

module.exports = { recalcLayer: recalcLayer, main: main };
if (require.main === module) { main(); }
