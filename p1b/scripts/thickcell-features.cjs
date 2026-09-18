'use strict';
/**
 * p1b/scripts/thickcell-features.cjs —— **厚格四臂·特征可得性审计**（2026-09-18 · 第 3 期票 B 实现前置）
 *
 * 为什么存在：PREREG-厚格基建总票-v1 §4 给四臂各定了读数定义，但**没有核过「算这些读数所需的特征在账本里到底有没有」**。
 *   四臂都是**读侧**估计量 ⇒ 若账本不存源数据，臂就**实现不出来**（或必须联网重取数）。本件把这件事量化，作为
 *   「先冻结判据、再实现」之间的**实现前置核验**（发现的前提缺口写成 PREREG v1.1 勘误件，**不改 v1 原件**）。
 *
 * 池口径**复用** `thickcell-replay.cjs` 的 `buildPool()`（同一实现，不另立）。零账本写／零 LLM／零网络。
 * 用法：node p1b/scripts/thickcell-features.cjs [--db <p>] [--out-dir <d>] [--json <p>] [--md <p>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }

const FEATURES = [
  { key: 'kind', label: 'resolve.kind（题类型）', need: (e) => !!(e.resolve && e.resolve.kind) },
  { key: 'latlon', label: 'resolve.lat/lon（站点坐标＝城市气候协变量代理）', need: (e) => isFinite((e.resolve || {}).lat) && isFinite((e.resolve || {}).lon) },
  { key: 'date', label: 'resolve.date（日序→可派生月序）', need: (e) => !!(e.resolve || {}).date },
  { key: 'period', label: 'resolve.period（月/期键）', need: (e) => !!(e.resolve || {}).period },
  { key: 'threshold', label: 'resolve.threshold（题面阈值）', need: (e) => isFinite((e.resolve || {}).threshold) },
  { key: 'baseRate', label: 'baseRate 对象', need: (e) => !!(e.baseRate && typeof e.baseRate === 'object') },
  { key: 'baseRate_nk', label: 'baseRate 含 n 与 k（格基率＋样本量）', need: (e) => !!(e.baseRate && isFinite(e.baseRate.n) && isFinite(e.baseRate.k)) },
  { key: 'forecastVal', label: 'forecast 带数值（**已发布高频观测**；MOS 所需）', need: (e) => !!(e.forecast && (isFinite(e.forecast.temperature_2m_max_c) || isFinite(e.forecast.value) || isFinite(e.forecast.v))) },
  { key: 'seriesID', label: 'resolve.series（dbnomics 序列 ID）', need: (e) => !!(e.resolve && e.resolve.series) },
  { key: 'phase', label: 'meta.phase（forward/backfill）', need: (e) => !!(e.meta && e.meta.phase) },
];

// ── ★账本**根本不存在**的字段（不是「覆盖率低」，是「一条都没有」）──
// 与上面的 FEATURES 分开列：覆盖率表里给 0.0% 会被误读成「罕见」，而真相是「**该数据从未入库**」。
const ABSENT = [
  {
    key: 'series_values',
    label: '同源序列的历史值（VAR 滞后项 / kNN 滞后维所需）',
    why: '账本 evidence 只存**基率汇总**（`baseRate{p,n,k}`）与**阈值**，**不存序列本身**；'
      + 'resolve 只存取数参数（provider/dataset/series/period/threshold）。'
      + '⇒ 任何需要「序列里前 k 期数值」的读数**无法在账本内复算**，只能**联网重取数**。',
    consumers: ['granger_lag（VAR 滞后选择）', 'knn（PREREG §4 的「可用的滞后值」维）'],
  },
  {
    key: 'published_hifreq',
    label: '已发布高频观测（MOS 订正输入）',
    why: '`forecast` 字段仅 **2.8%** 覆盖（且只出现在带 cutoff 快照的题上）⇒ 不足以支撑 MOS 的订正对照。',
    consumers: ['mos'],
  },
];

// ── 四臂的实现前置（PREREG §4 原文对到特征）──
const ARM_PREREQ = [
  {
    arm: 'knn', label: 'kNN 基率（§4）',
    features: ['latlon', 'date', 'baseRate_nk', 'kind'],
    extra: '★PREREG §4 原文的「**(可用的)滞后值**」维：**账本不存序列值** ⇒ 该维**缺席**（须显式声明）',
  },
  {
    arm: 'mos', label: 'MOS 统计订正（§4，附加 4 城一致 ≥3/4）',
    features: ['forecastVal', 'latlon'],
    extra: '★所用**已发布高频观测**（`forecast` 数值）覆盖率极低 ⇒ 见下判定',
  },
  {
    arm: 'granger_lag', label: 'Granger 滞后（§4，不产因果图）',
    features: ['seriesID'],
    extra: '★★**根本缺口**：VAR 需要**同源序列的历史值**，而账本**只存基率汇总（p/n/k）与阈值，不存序列** ⇒ 零覆盖',
  },
  {
    arm: 'nowcast', label: 'nowcast（§4；P1/P2/P3）',
    features: ['phase', 'date'],
    extra: '★P2「空窗层」＝真值未发布且桥接窗口非空 ⇒ 需**先测覆盖率**（PREREG §9④ 已登记未测）',
  },
];

function main() {
  const DB = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
  const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
  const { pool } = require(path.join(__dirname, 'thickcell-replay.cjs')).buildPool(DB);

  // 逐题取 evidence[0]（域/层/可计分已由 buildPool 把关）
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB, { readOnly: true });
  const byId = new Map();
  for (const r of db.prepare('SELECT id, evidence_json, statement FROM predictions WHERE outcome IS NOT NULL').all()) {
    let ev = []; try { ev = JSON.parse(r.evidence_json || '[]'); } catch (e) { ev = []; }
    byId.set(r.id, { e0: ev[0] || {}, stmt: r.statement || '' });
  }
  db.close();

  const N = pool.length;
  const cov = {};
  for (const f of FEATURES) cov[f.key] = { label: f.label, n: 0, pct: 0 };
  const byKind = {};
  for (const q of pool) {
    const rec = byId.get(q.id) || { e0: {} };
    for (const f of FEATURES) if (f.need(rec.e0)) cov[f.key].n++;
    const k = (rec.e0.resolve || {}).kind || '(none)';
    byKind[k] = byKind[k] || { n: 0, layer: {}, domain: {} };
    byKind[k].n++; byKind[k].layer[q.layer] = (byKind[k].layer[q.layer] || 0) + 1; byKind[k].domain[q.domain] = (byKind[k].domain[q.domain] || 0) + 1;
  }
  for (const f of FEATURES) cov[f.key].pct = N ? cov[f.key].n / N : 0;

  // 臂判定（阈值＝60%：低于则「实现前提不足」，须补数据或声明降级；**此阈为本件的操作化门槛，非判据**）
  const GATE = 0.60;
  const arms = ARM_PREREQ.map((a) => {
    const worst = a.features.map((k) => cov[k]).reduce((m, c) => (m === null || c.pct < m.pct) ? c : m, null);
    const verdict = worst.pct >= GATE ? 'feasible' : (worst.pct === 0 ? 'blocked' : 'insufficient');
    return { arm: a.arm, label: a.label, binding_feature: worst.label, binding_pct: worst.pct, verdict: verdict, extra: a.extra };
  });

  const j = {
    script: 'p1b/scripts/thickcell-features.cjs',
    generated_at: new Date().toISOString(),
    zero_write_ledger: true, zero_llm: true, zero_network: true,
    basis: 'PREREG-厚格基建总票-v1.md §4（四臂读数定义）＋ §9（已知限制）',
    gate_note: '本件的 feasible/insufficient/blocked 门槛 60% 是**实现前置的操作化门槛**，**不是判据**（判据在 PREREG §3）。',
    pool_n: N,
    features: cov,
    absent: ABSENT,
    by_kind: byKind,
    arms: arms,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jp = arg('json', path.join(OUT_DIR, 'thickcell-features-20260918.json'));
  fs.writeFileSync(jp, JSON.stringify(j, null, 2), 'utf8');

  const L = [];
  L.push('# 厚格四臂 · 特征可得性审计（2026-09-18）');
  L.push('');
  L.push('> 生成器 `p1b/scripts/thickcell-features.cjs`｜池口径**复用** `thickcell-replay.buildPool()`（同一实现）｜**零账本写／零 LLM／零网络**。');
  L.push('> ★本件的 feasible／insufficient／blocked 门槛 **60%** 是**实现前置的操作化门槛，不是判据**（判据在 PREREG §3）。');
  L.push('');
  L.push('**池**（PREREG §1 规则派生）＝ **' + N + '** 题（域 ∈ {openmeteo, dbnomics} ∧ 层 ∈ {L2,L3} ∧ 已解 ∧ 可计分）。');
  L.push('');
  L.push('## §1 特征覆盖率');
  L.push('');
  L.push('| 特征 | 覆盖 | 占比 |');
  L.push('|---|---|---|');
  for (const f of FEATURES) L.push('| ' + cov[f.key].label + ' | ' + cov[f.key].n + '/' + N + ' | ' + (cov[f.key].pct * 100).toFixed(1) + '% |');
  L.push('');
  L.push('## §2 四臂实现前置判定');
  L.push('');
  L.push('| 臂 | 约束特征（最弱一环） | 覆盖 | 判定 | 备注 |');
  L.push('|---|---|---|---|---|');
  for (const a of arms) {
    const tag = a.verdict === 'feasible' ? '✅ **可做**' : (a.verdict === 'blocked' ? '⛔ **被堵（零覆盖）**' : '⚠ 前提不足');
    L.push('| ' + a.label + ' | ' + a.binding_feature + ' | ' + (a.binding_pct * 100).toFixed(1) + '% | ' + tag + ' | ' + a.extra + ' |');
  }
  L.push('');
  L.push('## §2.5 ★账本**根本不存在**的字段（**不是覆盖率低，是「一条都没有」**）');
  L.push('');
  L.push('> 这张表与 §1 分开列：覆盖率表里写 `0.0%` 会被误读成「罕见」，而真相是「**该数据从未入库**」——'); 
  L.push('> 前者可等数据长出来，**后者只能改采集/联网关**。');
  L.push('');
  L.push('| 缺失项 | 消费者 | 为什么取不到 |');
  L.push('|---|---|---|');
  for (const x of ABSENT) L.push('| **' + x.label + '** | ' + x.consumers.join('／') + ' | ' + x.why + ' |');
  L.push('');
  L.push('## §3 resolve.kind 分布（池内）');
  L.push('');
  L.push('| kind | n | 层 | 域 |');
  L.push('|---|---|---|---|');
  for (const k of Object.keys(byKind).sort((a, b) => byKind[b].n - byKind[a].n)) {
    L.push('| ' + k + ' | ' + byKind[k].n + ' | ' + JSON.stringify(byKind[k].layer) + ' | ' + JSON.stringify(byKind[k].domain) + ' |');
  }
  L.push('');
  L.push('（审计件完 · 2026-09-18 · 零账本写／零 LLM／零网络）');
  const mp = arg('md', path.join(OUT_DIR, 'thickcell-features-20260918.md'));
  fs.writeFileSync(mp, L.join('\n') + '\n', 'utf8');

  console.log('=== 厚格四臂 · 特征可得性（池 ' + N + '）===');
  for (const f of FEATURES) console.log('  ' + (cov[f.key].pct * 100).toFixed(1).padStart(5) + '%  ' + cov[f.key].label);
  console.log('');
  for (const a of arms) console.log('  ' + a.label.padEnd(30) + ' ⇒ ' + a.verdict + '（约束特征 ' + (a.binding_pct * 100).toFixed(1) + '%）');
  console.log('');
  console.log('  json -> ' + jp);
  console.log('  md   -> ' + mp);
}

if (require.main === module) main();
module.exports = { FEATURES, ARM_PREREQ };
