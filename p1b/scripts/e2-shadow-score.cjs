#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/e2-shadow-score.cjs —— E2 影子评分与组合预检（**未冻结 · 探索性**）（2026-09-16）
 *
 * 依据：`10 §5`（五臂）＋`11 §8`（判据 v1.1）＋蓝图 §2.2#3（组合预检先跑后立）＋`PREREG-E2-路由分配-v1.md`（草案）。
 * 纪律：全读侧重放；**零 LLM、零账本写**；不碰生产路由；臂全披露；读数恒挂「未冻结·探索性」。
 * 本件覆盖：①逐题引擎概率重建（L1/L2/L3/L5/L6，照 stage4 口径）②**引擎可用性矩阵**（R3 双臂是否有可估人口，
 *   先跑后立的实证依据）③R0/R2/R4 三臂 Brier 与 Δ vs R0（配对块 bootstrap，B=1000/seed=987654321）＋**MDE 义务**（M4）
 *   ④组合预检：引擎两两误差相关 ρ̂（配对 bootstrap CI；ρ̂ 下界 ≥0.95 ⇒ 该域组合臂判死）。
 * 未实现（如实）：R1 语义重判（需接 intake 决策树读侧重判规则并先 sha 冻结）；R3a/R3h 完整形态（依赖跨引擎可估人口，
 *   若矩阵显示重叠 <30 则本件只产出「不可估」结论——这本身即前置闸证据）。
 * 用法：node p1b/scripts/e2-shadow-score.cjs [--db <path>] [--out-dir <dir>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const B = 1000, SEED = 987654321;

const { l2Baseline, parseBaseRateNote } = require(path.join(ROOT, 'p1b/src/engines/l2_baseline'));
const { l3Aci } = require(path.join(ROOT, 'p1b/src/engines/l3_aci'));
const { l5Certified } = require(path.join(ROOT, 'p1b/src/engines/l5_certified'));
const { certifiedSourceForRow } = require(path.join(ROOT, 'p1b/src/engines/l5_sources'));
const { procCalc } = require(path.join(ROOT, 'p1b/src/engines/l1_proc'));
const { l6Structural } = require(path.join(ROOT, 'p1b/src/engines/l6_structural'));
const baseRateMod = require(path.join(ROOT, 'p1b/src/evidence/baseRate'));
const truthBasisMod = require(path.join(ROOT, 'p1b/src/evidence/truthBasis'));

function bootCI(diffs, Bn, seed) { let s = seed >>> 0; const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const n = diffs.length; if (!n) return { lb: null, ub: null, mean: null }; const means = [];
  for (let b = 0; b < Bn; b++) { let a = 0; for (let i = 0; i < n; i++) a += diffs[Math.floor(rnd() * n)]; means.push(a / n); }
  means.sort((x, y) => x - y); return { lb: means[Math.floor(0.025 * Bn)], ub: means[Math.floor(0.975 * Bn)], mean: diffs.reduce((a, b) => a + b, 0) / n }; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function pearson(xs, ys) { const n = xs.length; if (!n) return null; const mx = mean(xs), my = mean(ys); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; } return (sx && sy) ? sxy / Math.sqrt(sx * sy) : null; }

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const REGIME = "p.g2_regime = 'R4'", NOT_TB = truthBasisMod.NOT_TRUTH_BASIS_DEFECT_SQL();
const rows = db.prepare('SELECT p.id, p.layer, p.outcome, p.created_at, '
  + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
  + "(SELECT json_extract(e.value,'$.baseRate') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRate') IS NOT NULL LIMIT 1) AS brs, "
  + "(SELECT json_extract(e.value,'$.certifiedSource') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.certifiedSource') IS NOT NULL LIMIT 1) AS cs, "
  + "(SELECT json_extract(e.value,'$.resolve.certified_source') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.certified_source') IS NOT NULL LIMIT 1) AS rcs, "
  + "(SELECT json_extract(e.value,'$.resolve') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve') IS NOT NULL LIMIT 1) AS rj "
  + 'FROM predictions p WHERE ' + REGIME + ' AND ' + NOT_TB + " AND p.outcome IS NOT NULL").all();
// 辅助数据
const evs = db.prepare('SELECT seq, day, phase, type, actor_seat, raw_text FROM events WHERE game_id = ? ORDER BY seq, id');
const cls = db.prepare('SELECT e.day AS day, c.predicate AS predicate FROM claims c JOIN events e ON e.id = c.event_id WHERE e.game_id = ?');
const pcs = db.prepare('SELECT player_count FROM games WHERE id = ?');
const gidOf = db.prepare('SELECT game_id FROM predictions WHERE id = ?');
const vs = db.prepare('SELECT id, prompt_variant, implied_prob FROM verdicts WHERE prediction_id = ? ORDER BY id');
const gameId = {}; for (const r of rows) gameId[r.id] = gidOf.get(r.id).game_id;
const evc = {}, clc = {}, pcc = {}, vc = {};
const eventsOf = (g) => evc[g] || (evc[g] = evs.all(g));
const claimsOf = (g) => clc[g] || (clc[g] = cls.all(g));
const pcOf = (g) => (pcc[g] !== undefined) ? pcc[g] : (pcc[g] = (pcs.get(g) || {}).player_count);
const verdictsOf = (id) => vc[id] || (vc[id] = vs.all(id));
const L3FB = (() => { const rs = db.prepare('SELECT p.id, p.outcome, '
  + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
  + "(SELECT json_extract(e.value,'$.baseRate') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRate') IS NOT NULL LIMIT 1) AS brs "
  + 'FROM predictions p WHERE ' + REGIME + " AND p.layer='L3' AND p.outcome IS NOT NULL ORDER BY p.id").all();
  const fb = []; for (const r of rs) { let st = null; try { st = r.brs ? JSON.parse(r.brs) : null; } catch (e) { st = null; }
    if (st && baseRateMod.isStructured(st) && st.n !== null && st.k !== null) { fb.push({ p: st.p, y: String(r.outcome) === 'true' ? 1 : 0 }); continue; }
    const q = parseBaseRateNote(String(r.brn || '')); if (q) fb.push({ p: q.p, y: String(r.outcome) === 'true' ? 1 : 0 }); } return fb; })();

const out = {}; const avail = {}; let rowsN = 0;
for (const r of rows) {
  rowsN++; const g = gameId[r.id]; const y = String(r.outcome) === 'true' ? 1 : 0;
  let struct = null; try { struct = r.brs ? JSON.parse(r.brs) : null; } catch (e) { struct = null; }
  const engines = {};
  if (r.layer === 'L1') { const o = procCalc({ statement: '', events: eventsOf(g), claims: claimsOf(g), playerCount: pcOf(g) }); if (o.ok) engines.L1 = o.p; }
  if (r.layer === 'L2') { const o = l2Baseline({ baseRate: struct, baseRateNote: r.brn }); if (o.ok) engines.L2 = o.p; }
  if (r.layer === 'L3') { const o = l3Aci({ baseRate: struct, baseRateNote: r.brn, feedback: L3FB }); if (o.ok) engines.L3 = o.p; }
  if (r.layer === 'L5') { let cs = null; try { cs = r.cs ? JSON.parse(r.cs) : (r.rcs ? JSON.parse(r.rcs) : null); } catch (e) { cs = null; }
    if (!cs) { let rj = null; try { rj = r.rj ? JSON.parse(r.rj) : null; } catch (e) { rj = null; } const b = certifiedSourceForRow({ resolve: rj, baseRate: struct, baseRateNote: r.brn }); if (b.ok) cs = b.source; }
    const o = l5Certified({ certifiedSource: cs }); if (o.ok) engines.L5 = o.p; }
  if (r.layer === 'L6') { const o = l6Structural({ verdicts: verdictsOf(r.id) }); if (o.ok) engines.L6 = o.p; }
  const keys = Object.keys(engines);
  for (const k of keys) avail[k] = (avail[k] || 0) + 1;
  // R0/R2 定义
  const r0 = engines[r.layer] !== undefined ? engines[r.layer] : null;
  let r2 = null; if (struct && baseRateMod.isStructured(struct)) r2 = struct.p; else { const q = parseBaseRateNote(String(r.brn || '')); if (q) r2 = q.p; }
  if (r2 === null) r2 = r0;
  out[r.id] = { y: y, layer: r.layer, engines: engines, r0: r0, r2: r2, multi_n: keys.length, t: String(r.created_at) };
}
db.close();
// R4（单 seed 冻结，随机选一个可得引擎）
let s4 = 20260916; const rnd4 = () => { s4 = (1664525 * s4 + 1013904223) >>> 0; return s4 / 4294967296; };
const scored = Object.keys(out).map((k) => out[k]).filter((o) => o.r0 !== null);
const arms = { R0: [], R2: [], R4: [] }; const ys = [];
for (const o of scored) { const ks = Object.keys(o.engines); arms.R0.push(o.r0); arms.R2.push(o.r2); arms.R4.push(ks.length ? o.engines[ks[Math.floor(rnd4() * ks.length)]] : o.r0); ys.push(o.y); }
const brier = (ps) => mean(ps.map((p, i) => (p - ys[i]) * (p - ys[i])));
const armBrier = { R0: brier(arms.R0), R2: brier(arms.R2), R4: brier(arms.R4) };
const dR2 = arms.R2.map((p, i) => (p - ys[i]) * (p - ys[i]) - (arms.R0[i] - ys[i]) * (arms.R0[i] - ys[i]));
const dR4 = arms.R4.map((p, i) => (p - ys[i]) * (p - ys[i]) - (arms.R0[i] - ys[i]) * (arms.R0[i] - ys[i]));
const ciR2 = bootCI(dR2, B, SEED), ciR4 = bootCI(dR4, B, SEED);
const sd = Math.sqrt(mean(dR2.map((x) => x * x)) - (mean(dR2) || 0) * (mean(dR2) || 0));
const mde = 2.802 * (sd || 0) / Math.sqrt(dR2.length || 1);   // α=.05 双侧、80% 功效（M4 义务）
// ρ̂ 预检（成员=引擎误差向量；仅题上同时可得的引擎对）
const multi = Object.keys(out).map((k) => out[k]).filter((o) => o.multi_n >= 2);
const pairs = {}; const ekeys = ['L1', 'L2', 'L3', 'L5', 'L6'];
for (let i = 0; i < ekeys.length; i++) for (let j = i + 1; j < ekeys.length; j++) {
  const xs = [], zs = []; for (const o of multi) { if (o.engines[ekeys[i]] !== undefined && o.engines[ekeys[j]] !== undefined) { xs.push((o.engines[ekeys[i]] - o.y) * (o.engines[ekeys[i]] - o.y)); zs.push((o.engines[ekeys[j]] - o.y) * (o.engines[ekeys[j]] - o.y)); } }
  if (xs.length >= 10) { const rho = pearson(xs, zs); const ci = bootCI(xs.map((x, i) => x - zs[i]), B, SEED); pairs[ekeys[i] + '/' + ekeys[j]] = { n: xs.length, rho: rho }; }
}

const report = {
  script: 'p1b/scripts/e2-shadow-score.cjs', status: '未冻结·探索性（PREREG-E2 尚未冻结；本件不载判据）',
  db: DB_PATH, cohort_rows: rowsN, scored_rows: scored.length,
  engine_availability: avail,
  r3_population: { items_with_multi_engines: multi.length, note: multi.length < 30 ? '跨引擎重叠人口 <30 ⇒ R3a/R3h 不可估（前置闸证据：先跑后立）' : '可估' },
  arms: { R0: armBrier.R0, R2: armBrier.R2, R4: armBrier.R4 },
  delta_R2_vs_R0: { mean: ciR2.mean, ci95: { lb: ciR2.lb, ub: ciR2.ub }, mde: mde, mde_note: 'M4 义务：非劣判定须并列 MDE；CI 宽于 ±0.01 时非劣成立但信息量极低' },
  delta_R4_vs_R0: { mean: ciR4.mean, ci95: { lb: ciR4.lb, ub: ciR4.ub } },
  combo_precheck_rho: pairs,
  r1_pending: 'R1 语义重判未实现（需 intake 决策树读侧重判规则并先 sha 冻结——M5①）',
  bootstrap: { B: B, seed: SEED },
  generated_at: new Date().toISOString(),
};
fs.mkdirSync(OUT_DIR, { recursive: true });
const jf = path.join(OUT_DIR, 'e2-shadow-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json');
fs.writeFileSync(jf, JSON.stringify(report, null, 1), 'utf8');
console.log('=== E2 影子评分（未冻结·探索性）===');
console.log('已解人口 ' + scored.length + ' ｜ 引擎可用性 ' + JSON.stringify(avail) + ' ｜ 跨引擎重叠 ' + multi.length + (multi.length < 30 ? '（R3 不可估）' : ''));
console.log('Brier：R0=' + armBrier.R0.toFixed(4) + ' R2=' + armBrier.R2.toFixed(4) + ' R4=' + armBrier.R4.toFixed(4)
  + ' ｜ Δ(R2−R0)=' + ciR2.mean.toFixed(4) + ' CI[' + ciR2.lb.toFixed(4) + ',' + ciR2.ub.toFixed(4) + '] MDE=' + mde.toFixed(4));
console.log('ρ̂ 预检对：' + (Object.keys(pairs).length ? JSON.stringify(pairs) : '（无 ≥10 题的引擎对）'));
console.log('json -> ' + jf);
