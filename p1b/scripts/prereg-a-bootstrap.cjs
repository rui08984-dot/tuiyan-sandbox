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
  + "WHERE v.run_id = ? AND v.implied_prob IS NOT NULL AND p.outcome IN ('true','false')";
const aRows = db.prepare(SQL).all(RUN_T);
const bRows = db.prepare(SQL).all(RUN_B);
const key = (r) => r.pid + '|' + r.variant + '|' + r.temp + '|' + r.model;
const bMap = new Map(bRows.map((r) => [key(r), r]));
const pairs = [];
for (const ra of aRows) {
  const rb = bMap.get(key(ra)); if (!rb) continue;
  pairs.push({ pid: ra.pid, variant: ra.variant, layer: ra.layer, gsrc: ra.gsrc, y: ra.outcome === 'true' ? 1 : 0, pa: Number(ra.prob), pb: Number(rb.prob) });
}
const n = pairs.length;
const bT = n ? pairs.reduce((s, r) => s + brier(r.pa, r.y), 0) / n : null;
const bB = n ? pairs.reduce((s, r) => s + brier(r.pb, r.y), 0) / n : null;
const deltas = pairs.map((r) => brier(r.pb, r.y) - brier(r.pa, r.y));
const dMean = n ? deltas.reduce((s, x) => s + x, 0) / n : null;
const rand = rng(SEED); const boot = [];
for (let i = 0; i < NB; i++) { let s = 0; for (let j = 0; j < n; j++) s += deltas[Math.floor(rand() * n)]; boot.push(n ? s / n : 0); }
boot.sort((x, y) => x - y);
const ci = n ? { lb: qtl(boot, 0.025), ub: qtl(boot, 0.975), B: NB, seed: SEED, lb_gt_0: qtl(boot, 0.025) > 0 } : { lb: null, ub: null, B: NB, seed: SEED, lb_gt_0: false };
const out = { script: 'p1b/scripts/prereg-a-bootstrap.cjs',
  prereg: { file: '.scratch/forecast-debate/PREREG-命题A-3.0消融-v1.md', section: '§3/§4', sha256: '5d6907d1910acab842b92a172714d44b13cadf474f33d45008ea67f0a6098845' },
  pairing_key: 'prediction_id×prompt_variant×temperature×model',
  arms: { treatment: RUN_T, baseline: RUN_B }, delta_definition: 'Brier(baseline) − Brier(treatment)（正=治疗臂更优）',
  n_pairs: n, brier_treatment: bT, brier_baseline: bB, delta_brier: dMean, ci95: ci, murphy_bins: BINS,
  murphy_treatment: murphy(pairs.map((r) => r.pa), pairs.map((r) => r.y), BINS),
  murphy_baseline: murphy(pairs.map((r) => r.pb), pairs.map((r) => r.y), BINS),
  note: 'dry 自检=在存量 R-B/R-C verdicts 上验证配对/CI/Murphy 管线（零 LLM）；非 3.0 消融结果。', generated_at: new Date().toISOString() };
const L = [];
L.push('[prereg-a-bootstrap] 配对键 ' + out.pairing_key + ' | treatment=' + RUN_T + ' baseline=' + RUN_B);
L.push('  n_pairs=' + n + ' | Brier_treatment=' + (bT === null ? 'n/a' : bT.toFixed(5)) + ' | Brier_baseline=' + (bB === null ? 'n/a' : bB.toFixed(5)) + ' | Δ=' + (dMean === null ? 'n/a' : dMean.toFixed(5)));
L.push('  Δ 95% CI=[' + (ci.lb === null ? 'n/a' : ci.lb.toFixed(5)) + ',' + (ci.ub === null ? 'n/a' : ci.ub.toFixed(5)) + '] B=' + NB + ' seed=' + SEED + ' | 下界>0: ' + ci.lb_gt_0);
L.push('  Murphy(treatment) reliability=' + out.murphy_treatment.reliability.toFixed(5) + ' resolution=' + out.murphy_treatment.resolution.toFixed(5) + ' uncertainty=' + out.murphy_treatment.uncertainty.toFixed(5));
L.push('  Murphy(baseline)  reliability=' + out.murphy_baseline.reliability.toFixed(5) + ' resolution=' + out.murphy_baseline.resolution.toFixed(5) + ' uncertainty=' + out.murphy_baseline.uncertainty.toFixed(5));
L.push('  ' + out.note);
const text = L.join('\n');
console.log(text);
if (JSON_OUT) { fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(out, null, 1), 'utf8'); console.log('[prereg-a-bootstrap] JSON -> ' + path.resolve(JSON_OUT)); }
db.close(); process.exit(0);
