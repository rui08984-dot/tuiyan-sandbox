#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/u8-columns.cjs —— U8 加列读侧派生：KL 可预报性 / Murphy 三分解 / prequential 累计曲线（2026-09-16 · P0+）
 *
 * 依据：蓝图 §2.1#2/#3/#4（16①1A / 15-I4＋16①1C / 18⑥）＋详卡【13】U8「只披露不进门控」纪律。
 * 纪律：零 LLM、零网络、零写库（库 readOnly）；**只读侧派生，不进门控**；n<30 只报 n 不出列（K F13 准入线）。
 * 口径（逐条写明，防事后解释）：
 *   · KL 可预报性读数：KL(引擎 p ∥ 基率 b) 的逐题均值＝ mean_i [ p_i·ln(p_i/b) + (1−p_i)·ln((1−p_i)/(1−b)) ]，
 *     b＝该层观测频率（最朴素"只看基率"参照分布）——读数大＝引擎概率相对基率携带更多结构（披露用，不载判据；
 *     蓝图自带自我设限：与引擎 ΔBrier 的跨层 Spearman CI 含 0 ⇒ 永久降为纯披露）。
 *   · Murphy 三分解（10 桶离散版）：Brier = REL − RES + UNC（恒等式自检 |REL−RES+UNC − Brier| < 1e-9）。
 *   · prequential 累计曲线：按 resolved_at（同刻按 id）排序的累计平均 Brier，采样点＝每 10% 一档＋终点。
 *   · **双序分叉度（18⑥ 判据②，2026-09-17 加）**：同一批行按**结算序**（resolved_at）与**提交序**（created_at）
 *     各排一次 ⇒ 逐位点最大差 max_i |cum_结算(i) − cum_提交(i)| ＋按月分段；分叉大＝延迟结算在扭曲直觉
 *     （这正是 prequential 协议要防的）。两序**同 n、索引对齐**（比的是「同一观测数档位下的画面差异」）。
 *   · L1 排除：决定论层 Brier 语义＝计算错误率（stage4 明文），概率分解/相对熵不适用——**按语义整层排除**。
 * 用法：node p1b/scripts/u8-columns.cjs [--db <path>] [--out-dir <dir>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const MIN_N = 30;

const { l2Baseline, parseBaseRateNote } = require(path.join(ROOT, 'p1b/src/engines/l2_baseline'));
const { l3Aci } = require(path.join(ROOT, 'p1b/src/engines/l3_aci'));
const { l5Certified } = require(path.join(ROOT, 'p1b/src/engines/l5_certified'));
const { certifiedSourceForRow } = require(path.join(ROOT, 'p1b/src/engines/l5_sources'));
const { l6Structural } = require(path.join(ROOT, 'p1b/src/engines/l6_structural'));
const baseRateMod = require(path.join(ROOT, 'p1b/src/evidence/baseRate'));
const truthBasisMod = require(path.join(ROOT, 'p1b/src/evidence/truthBasis'));

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const clampP = (p) => Math.max(1e-6, Math.min(1 - 1e-6, Number(p)));

function murphy(ps, ys, B) {
  const N = ps.length; const obar = mean(ys); const b = [];
  for (let i = 0; i < B; i++) b.push({ n: 0, sf: 0, sy: 0 });
  for (let i = 0; i < N; i++) { const j = Math.min(B - 1, Math.max(0, Math.floor(ps[i] * B))); b[j].n++; b[j].sf += ps[i]; b[j].sy += ys[i]; }
  let rel = 0, res = 0, within = 0;
  for (const x of b) { if (!x.n) continue; const f = x.sf / x.n, o = x.sy / x.n; rel += (x.n / N) * (f - o) * (f - o); res += (x.n / N) * (o - obar) * (o - obar); within += (x.n / N) * o * (1 - o); }
  const unc = obar * (1 - obar);
  const brier = mean(ps.map((p, i) => (p - ys[i]) * (p - ys[i])));
  // 桶口径恒等式：Brier_binned = REL − RES + UNC（其中 Brier_binned = REL + Σ(n_j/N)·ō_j(1−ō_j)，全方差分解）
  const brierBinned = rel + within;
  return { rel: rel, res: res, unc: unc, brier: brier, brier_binned: brierBinned,
    identity_gap: Math.abs(rel - res + unc - brierBinned),
    identity_gap_vs_raw: Math.abs(rel - res + unc - brier) };
}
function klToBase(ps, ys) {
  const b = clampP(mean(ys));
  return mean(ps.map((p) => { const q = clampP(p); return q * Math.log(q / b) + (1 - q) * Math.log((1 - q) / (1 - b)); }));
}
function prequential(items) {   // items: [{t, id, p, y}] 已按 t,id 排序
  const pts = []; let acc = 0;
  const step = Math.max(1, Math.floor(items.length / 10));
  for (let i = 0; i < items.length; i++) { acc += (items[i].p - items[i].y) * (items[i].p - items[i].y); if ((i + 1) % step === 0 || i === items.length - 1) pts.push({ n: i + 1, cum_brier: acc / (i + 1) }); }
  return { points: pts, final: items.length ? acc / items.length : null };
}
/** Spearman 秩相关（并列取平均秩）——衡量两序的**重排程度**。 */
function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const rank = (a) => {
    const idx = a.map((v, i) => ({ v: v, i: i })).sort((p, q) => p.v - q.v);
    const r = new Array(n); let i = 0;
    while (i < n) { let j = i; while (j + 1 < n && idx[j + 1].v === idx[i].v) j++;
      let avg = 0; for (let k = i; k <= j; k++) avg += k + 1; avg /= (j - i + 1);
      for (let k = i; k <= j; k++) r[idx[k].i] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) * (rx[i] - mx); dy += (ry[i] - my) * (ry[i] - my); }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
/** 双序分叉度（18⑥ 判据②）：结算序 vs 提交序两条累计曲线的逐位点最大差 ＋ 半程差 ＋ 重排相关 ＋ 按月分段。
 *  注意：**终值两序恒等**（同集合均值与顺序无关）⇒ 分叉只体现在**路径**上，故以 max_gap／半程差／ρ 三个量描述。 */
function twoOrder(items) {
  if (!items.length) return { n: 0, note: 'n=0' };
  const bySettle = (a) => a.slice().sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : x.id - y.id));
  const bySubmit = (a) => a.slice().sort((x, y) => (x.c < y.c ? -1 : x.c > y.c ? 1 : x.id - y.id));
  const cum = (arr) => { const o = []; let s = 0; for (let i = 0; i < arr.length; i++) { s += (arr[i].p - arr[i].y) * (arr[i].p - arr[i].y); o.push(s / (i + 1)); } return o; };
  const gapOf = (sub) => {
    const S = bySettle(sub), U = bySubmit(sub);
    const cs = cum(S), cu = cum(U);
    let g = 0, at = 0;
    for (let i = 0; i < cs.length; i++) { const d = Math.abs(cs[i] - cu[i]); if (d > g) { g = d; at = i + 1; } }
    const half = Math.min(cs.length - 1, Math.max(0, Math.floor(cs.length / 2)));
    return { max_gap: g, max_gap_at_n: at, gap_at_half: Math.abs(cs[half] - cu[half]), half_n: half + 1,
      reorder_rho: spearman(S.map((x) => x.c), S.map((x) => x.t)), n: sub.length };
  };
  const all = gapOf(items);
  const months = {};
  for (const x of items) { const m = x.t ? String(x.t).slice(0, 7) : '(none)'; (months[m] = months[m] || []).push(x); }
  const monthly = Object.keys(months).sort().map((m) => { const g = gapOf(months[m]); return { month: m, ...g }; });
  return { n: all.n, max_gap: all.max_gap, max_gap_at_n: all.max_gap_at_n, gap_at_half: all.gap_at_half, half_n: all.half_n,
    reorder_rho: all.reorder_rho, monthly: monthly,
    note: '分叉只体现在**路径**（终值两序恒等＝同集合均值与顺序无关）：max_gap＝逐位点最大差｜gap_at_half＝半程差｜reorder_rho＝两序 Spearman 相关；分叉大＝延迟结算在扭曲直觉' };
}

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const REGIME = "p.g2_regime = 'R4'", NOT_TB = truthBasisMod.NOT_TRUTH_BASIS_DEFECT_SQL();
const rows = db.prepare('SELECT p.id, p.layer, p.outcome, p.resolved_at, p.created_at, '
  + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
  + "(SELECT json_extract(e.value,'$.baseRate') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRate') IS NOT NULL LIMIT 1) AS brs, "
  + "(SELECT json_extract(e.value,'$.certifiedSource') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.certifiedSource') IS NOT NULL LIMIT 1) AS cs, "
  + "(SELECT json_extract(e.value,'$.resolve.certified_source') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.certified_source') IS NOT NULL LIMIT 1) AS rcs, "
  + "(SELECT json_extract(e.value,'$.resolve') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve') IS NOT NULL LIMIT 1) AS rj "
  + 'FROM predictions p WHERE ' + REGIME + ' AND ' + NOT_TB + " AND p.outcome IS NOT NULL AND p.layer IN ('L2','L3','L5','L6') ORDER BY p.resolved_at, p.id").all();
const fb = db.prepare('SELECT p.id, p.outcome, '
  + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
  + "(SELECT json_extract(e.value,'$.baseRate') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRate') IS NOT NULL LIMIT 1) AS brs "
  + 'FROM predictions p WHERE ' + REGIME + " AND p.layer='L3' AND p.outcome IS NOT NULL ORDER BY p.id").all();
const L3FB = []; for (const r of fb) { let st = null; try { st = r.brs ? JSON.parse(r.brs) : null; } catch (e) { st = null; }
  if (st && baseRateMod.isStructured(st) && st.n !== null && st.k !== null) { L3FB.push({ p: st.p, y: String(r.outcome) === 'true' ? 1 : 0 }); continue; }
  const q = parseBaseRateNote(String(r.brn || '')); if (q) L3FB.push({ p: q.p, y: String(r.outcome) === 'true' ? 1 : 0 }); }
const stV = db.prepare('SELECT prompt_variant, implied_prob, run_id FROM verdicts WHERE prediction_id = ? ORDER BY id');
const items = { L2: [], L3: [], L5: [], L6: [] }; let failed = {};
for (const r of rows) {
  const y = String(r.outcome) === 'true' ? 1 : 0;
  let struct = null; try { struct = r.brs ? JSON.parse(r.brs) : null; } catch (e) { struct = null; }
  let out = null;
  if (r.layer === 'L2') out = l2Baseline({ baseRate: struct, baseRateNote: r.brn });
  else if (r.layer === 'L3') out = l3Aci({ baseRate: struct, baseRateNote: r.brn, feedback: L3FB });
  else if (r.layer === 'L6') out = l6Structural({ verdicts: stV.all(r.id) });
  else {
    let cs = null; try { cs = r.cs ? JSON.parse(r.cs) : (r.rcs ? JSON.parse(r.rcs) : null); } catch (e) { cs = null; }
    if (!cs) { let rj = null; try { rj = r.rj ? JSON.parse(r.rj) : null; } catch (e) { rj = null; } const bd = certifiedSourceForRow({ resolve: rj, baseRate: struct, baseRateNote: r.brn }); if (bd.ok) cs = bd.source; }
    out = l5Certified({ certifiedSource: cs });
  }
  if (!out || !out.ok || typeof out.p !== 'number') { const k = r.layer + ':' + ((out && out.status) || 'unknown'); failed[k] = (failed[k] || 0) + 1; continue; }
  items[r.layer].push({ id: r.id, t: String(r.resolved_at || ''), c: String(r.created_at || ''), p: out.p, y: y });
}
db.close();

const report = { script: 'p1b/scripts/u8-columns.cjs', status: '读侧派生·只披露不进门控', db: DB_PATH,
  kl_definition: 'KL(引擎 p ∥ 层观测频率 b) 的逐题均值（b＝最朴素只看基率参照）；蓝图自我设限：与 ΔBrier 跨层 Spearman CI 含 0 ⇒ 永久纯披露',
  murphy_definition: 'Brier = REL − RES + UNC（10 桶离散版；恒等式自检 <1e-9）',
  prequential_definition: '按 resolved_at 排序的累计平均 Brier（每 10% 采样＋终点）＋**双序分叉度**（结算序 vs 提交序逐位点最大差，按月分段；18⑥ 判据②：分叉大＝延迟结算在扭曲直觉）',
  l1_excluded: 'L1 决定论层按语义整层排除（Brier 语义＝计算错误率，概率分解/相对熵不适用）',
  engine_fail: failed, layers: {}, generated_at: new Date().toISOString() };
const md = ['# U8 加列读侧派生（KL / Murphy / prequential）', '',
  '> 依据：蓝图 §2.1#2-4；**只披露不进门控**；n<' + MIN_N + ' 只报 n。', ''];
for (const L of ['L2', 'L3', 'L5', 'L6']) {
  const arr = items[L].slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id - b.id));
  const ps = arr.map((x) => x.p), ys = arr.map((x) => x.y);
  if (arr.length < MIN_N) { report.layers[L] = { scored_n: arr.length, note: 'n<' + MIN_N + ' ⇒ 只报 n，不出列' };
    md.push('- ' + L + '：scored n=' + arr.length + '（< ' + MIN_N + ' ⇒ 只报 n）'); continue; }
  const m = murphy(ps, ys, 10); const kl = klToBase(ps, ys); const pq = prequential(arr); const t2 = twoOrder(arr);
  report.layers[L] = { scored_n: arr.length, brier: m.brier, murphy: { REL: m.rel, RES: m.res, UNC: m.unc, identity_gap: m.identity_gap }, kl_to_base: kl, prequential: pq, prequential_two_order: t2 };
  md.push('- ' + L + '（n=' + arr.length + '）：Brier=' + m.brier.toFixed(4) + '｜KL=' + kl.toFixed(4)
    + '｜Murphy REL=' + m.rel.toFixed(4) + ' RES=' + m.res.toFixed(4) + ' UNC=' + m.unc.toFixed(4) + '（恒等式残差 ' + m.identity_gap.toExponential(1) + '）'
    + '｜prequential 终值=' + pq.final.toFixed(4) + '（首点 ' + pq.points[0].cum_brier.toFixed(4) + ' → 终 ' + pq.final.toFixed(4) + '）'
    + '｜双序分叉：max=' + t2.max_gap.toFixed(4) + '（第 ' + t2.max_gap_at_n + ' 观测点）｜半程差=' + t2.gap_at_half.toFixed(4) + '（第 ' + t2.half_n + ' 点）｜重排 ρ=' + (t2.reorder_rho === null ? 'n/a' : t2.reorder_rho.toFixed(4)));
}
md.push('', '（零 LLM／零写库／只读派生 · 三列均只披露不进门控）');
fs.mkdirSync(OUT_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
fs.writeFileSync(path.join(OUT_DIR, 'u8-columns-' + today + '.json'), JSON.stringify(report, null, 1), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'u8-columns-' + today + '.md'), md.join('\n') + '\n', 'utf8');
console.log('=== U8 加列（读侧派生·只披露）===');
for (const L of ['L2', 'L3', 'L5', 'L6']) { const r = report.layers[L];
  console.log('  ' + L + '：n=' + r.scored_n + (r.brier !== undefined ? ' Brier=' + r.brier.toFixed(4) + ' KL=' + r.kl_to_base.toFixed(4) + ' RES=' + r.murphy.RES.toFixed(4) + ' prequential=' + r.prequential.final.toFixed(4) : '（只报 n）')); }
console.log('json/md -> ' + OUT_DIR);
