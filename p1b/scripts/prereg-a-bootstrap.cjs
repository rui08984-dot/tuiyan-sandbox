#!/usr/bin/env node
'use strict';
/*
 * PREREG-命题A-3.0消融 · §3/§4 配对 bootstrap（**零 LLM／零网络**；源库 readonly）
 * 配对键＝prediction_id × prompt_variant × temperature × model（PREREG §3）
 * 判据＝ΔBrier = Brier(baseline) − Brier(treatment) 的 bootstrap 95% CI（B=1000，种子 987654321）
 *        ＋ 两臂 Murphy reliability/resolution/uncertainty（10 等宽桶，PREREG §4）。
 * 用法（dry 自检＝在现成 R-B/R-C verdicts 上验证管线，不跑实验）：
 *   node p1b/scripts/prereg-a-bootstrap.cjs --run-treatment f4f760aa50e1 --run-baseline ca1b5cdbddfc --json <out>
 * 声明：dry 自检的两个 run_id 是**存量批次**（证据呈现 1.0/2.0），其对比只验证配对/CI/Murphy 管线，
 *       **不是** 3.0 消融结果；3.0 消融需两臂新跑（本脚本不改库、不调 LLM）。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const RUN_T = arg('run-treatment', 'f4f760aa50e1');
const RUN_B = arg('run-baseline', 'ca1b5cdbddfc');
const RUN_PREFIX = arg('run-prefix', null); // additive（命题A全量计分防呆）：设了就在两臂 SQL 追加 run_id LIKE 前缀闸，防烟测批次混入
const NB = Number(arg('boot', '1000'));
const SEED = Number(arg('seed', '987654321'));
const BINS = Number(arg('bins', '10'));
const JSON_OUT = arg('json', null);
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const db = new Database(DB_PATH, { readonly: true }); // 新增纪律：源库一律 readonly

function rng(seed) { let s = seed >>> 0; return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function qtl(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]; }
function brier(p, y) { return Math.pow(p - y, 2); }
function murphy(probs, ys, nb) {
  const N = probs.length; const bs = [];
  for (let k = 0; k < nb; k++) bs.push({ n: 0, sp: 0, sy: 0 });
  for (let i = 0; i < N; i++) { let k = Math.min(nb - 1, Math.floor(probs[i] * nb)); if (probs[i] >= 1) k = nb - 1; bs[k].n++; bs[k].sp += probs[i]; bs[k].sy += ys[i]; }
  const ybar = N ? ys.reduce((s, y) => s + y, 0) / N : null;
  let rel = 0, res = 0;
  for (const b of bs) { if (!b.n) continue; const pb = b.sp / b.n, yb = b.sy / b.n; rel += (b.n / N) * Math.pow(pb - yb, 2); res += (b.n / N) * Math.pow(yb - ybar, 2); }
  return { n: N, bins: nb, reliability: N ? rel : null, resolution: N ? res : null, uncertainty: ybar === null ? null : ybar * (1 - ybar),
    brier: N ? probs.reduce((s, p, i) => s + brier(p, ys[i]), 0) / N : null,
    bins_detail: bs.map((b, k) => ({ k: k, n: b.n, p_bar: b.n ? b.sp / b.n : null, y_bar: b.n ? b.sy / b.n : null })) };
}

const SQL = 'SELECT v.prediction_id AS pid, v.prompt_variant AS variant, v.temperature AS temp, v.model AS model, '
  + 'v.implied_prob AS prob, p.outcome AS outcome, p.layer AS layer, g.source AS gsrc '
  + 'FROM verdicts v JOIN predictions p ON p.id = v.prediction_id JOIN games g ON g.id = p.game_id '
  + "WHERE v.run_id = ? AND v.implied_prob IS NOT NULL AND p.outcome IN ('true','false')"
  + (RUN_PREFIX ? " AND v.run_id LIKE ?" : '');
const aRows = RUN_PREFIX ? db.prepare(SQL).all(RUN_T, RUN_PREFIX + '%') : db.prepare(SQL).all(RUN_T);
const bRows = RUN_PREFIX ? db.prepare(SQL).all(RUN_B, RUN_PREFIX + '%') : db.prepare(SQL).all(RUN_B);
const key = (r) => r.pid + '|' + r.variant + '|' + r.temp + '|' + r.model;
const bMap = new Map(bRows.map((r) => [key(r), r]));
const pairs = [];
for (const ra of aRows) {
  const rb = bMap.get(key(ra)); if (!rb) continue;
  pairs.push({ pid: ra.pid, variant: ra.variant, layer: ra.layer, gsrc: ra.gsrc, y: ra.outcome === 'true' ? 1 : 0, pa: Number(ra.prob), pb: Number(rb.prob) });
}
function stats(sub) { // additive：抽成函数以便 L1/L6 分层复用（每次重实例化同种子=确定性）
  const m = sub.length;
  const bT2 = m ? sub.reduce((s, r) => s + brier(r.pa, r.y), 0) / m : null;
  const bB2 = m ? sub.reduce((s, r) => s + brier(r.pb, r.y), 0) / m : null;
  const dd = sub.map((r) => brier(r.pb, r.y) - brier(r.pa, r.y));
  const dm = m ? dd.reduce((s, x) => s + x, 0) / m : null;
  const sd = m > 1 ? Math.sqrt(dd.reduce((s, x) => s + (x - dm) * (x - dm), 0) / (m - 1)) : null;
  const rnd = rng(SEED); const bt = [];
  for (let i = 0; i < NB; i++) { let s = 0; for (let j = 0; j < m; j++) s += dd[Math.floor(rnd() * m)]; bt.push(m ? s / m : 0); }
  bt.sort((x, y) => x - y);
  const c2 = m ? { lb: qtl(bt, 0.025), ub: qtl(bt, 0.975), B: NB, seed: SEED, lb_gt_0: qtl(bt, 0.025) > 0 } : { lb: null, ub: null, B: NB, seed: SEED, lb_gt_0: false };
  return { n: m, brier_treatment: bT2, brier_baseline: bB2, delta_brier: dm, sd_delta: sd, ci95: c2,
    murphy_treatment: murphy(sub.map((r) => r.pa), sub.map((r) => r.y), BINS),
    murphy_baseline: murphy(sub.map((r) => r.pb), sub.map((r) => r.y), BINS) };
}
const overall = stats(pairs);
const n = overall.n;
const bT = overall.brier_treatment;
const bB = overall.brier_baseline;
const deltas = pairs.map((r) => brier(r.pb, r.y) - brier(r.pa, r.y));
const dMean = overall.delta_brier;
const ci = overall.ci95;
const layers = {}; // additive：L1/L6 分层分区报（PREREG §3「分别报、禁混算」）
for (const lyr of Array.from(new Set(pairs.map((r) => r.layer))).sort()) layers[lyr] = stats(pairs.filter((r) => r.layer === lyr));
const out = { script: 'p1b/scripts/prereg-a-bootstrap.cjs',
  prereg: { file: '.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.md', section: '§3/§4', sha256: '5d6907d1910acab842b92a172714d44b13cadf474f33d45008ea67f0a6098845' },
  pairing_key: 'prediction_id×prompt_variant×temperature×model',
  arms: { treatment: RUN_T, baseline: RUN_B }, delta_definition: 'Brier(baseline) − Brier(treatment)（正=治疗臂更优）',
  n_pairs: n, brier_treatment: bT, brier_baseline: bB, delta_brier: dMean, ci95: ci, murphy_bins: BINS,
  sd_delta: overall.sd_delta, run_prefix: RUN_PREFIX, layers: layers,
  murphy_treatment: murphy(pairs.map((r) => r.pa), pairs.map((r) => r.y), BINS),
  murphy_baseline: murphy(pairs.map((r) => r.pb), pairs.map((r) => r.y), BINS),
  note: 'dry 自检=在存量 R-B/R-C verdicts 上验证配对/CI/Murphy 管线（零 LLM）；非 3.0 消融结果。', generated_at: new Date().toISOString() };
const L = [];
L.push('[prereg-a-bootstrap] 配对键 ' + out.pairing_key + ' | treatment=' + RUN_T + ' baseline=' + RUN_B);
L.push('  n_pairs=' + n + ' | Brier_treatment=' + (bT === null ? 'n/a' : bT.toFixed(5)) + ' | Brier_baseline=' + (bB === null ? 'n/a' : bB.toFixed(5)) + ' | Δ=' + (dMean === null ? 'n/a' : dMean.toFixed(5)));
L.push('  Δ 95% CI=[' + (ci.lb === null ? 'n/a' : ci.lb.toFixed(5)) + ',' + (ci.ub === null ? 'n/a' : ci.ub.toFixed(5)) + '] B=' + NB + ' seed=' + SEED + ' | 下界>0: ' + ci.lb_gt_0);
L.push('  Murphy(treatment) reliability=' + out.murphy_treatment.reliability.toFixed(5) + ' resolution=' + out.murphy_treatment.resolution.toFixed(5) + ' uncertainty=' + out.murphy_treatment.uncertainty.toFixed(5));
L.push('  Murphy(baseline)  reliability=' + out.murphy_baseline.reliability.toFixed(5) + ' resolution=' + out.murphy_baseline.resolution.toFixed(5) + ' uncertainty=' + out.murphy_baseline.uncertainty.toFixed(5));
for (const lyr of Object.keys(layers)) { const s = layers[lyr]; const f = (x) => (x === null || x === undefined) ? 'n/a' : Number(x).toFixed(5);
  L.push('  [' + lyr + '] n=' + s.n + ' Δ=' + f(s.delta_brier) + ' sd=' + f(s.sd_delta) + ' CI=[' + f(s.ci95.lb) + ',' + f(s.ci95.ub) + '] 下界>0:' + s.ci95.lb_gt_0 + ' resT=' + f(s.murphy_treatment.resolution) + ' resB=' + f(s.murphy_baseline.resolution)); }
L.push('  ' + out.note);
const text = L.join('\n');
console.log(text);
if (JSON_OUT) { fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(out, null, 1), 'utf8'); console.log('[prereg-a-bootstrap] JSON -> ' + path.resolve(JSON_OUT)); }
db.close(); process.exit(0);
