#!/usr/bin/env node
'use strict';
/**
 * p1b/scripts/base-rate-decision-value.cjs —— **诚实基率的决策价值**（2026-09-29）
 *
 * 依据（唯一冻结文本）：`docs/specs/PREREG-base-rate-decision-value-v1.md`
 *   （sha256 `619ac53a59769c2f3860ff9880788e1f61c439c7192e5760aa13e94362b80375`，
 *    复算 `node p1b/scripts/prereg-freeze.cjs docs/specs/PREREG-base-rate-decision-value-v1.md`）
 *   §1 池／§2 C1 校准／§3 C2 决策价值＋MDE／§4 禁跨层池化／§5 出口 A/B/C／§6 F2 旁证／§8 闸门。
 *
 * ★★ 本实验要回答的那一问（项目里从没被回答过）：
 *   **按诚实基率 `assigned_prob` 决策 vs 按 0.5 决策，结果有没有差别？**
 *   此前只测过「观测 Brier vs 随机基线 E[p(1−p)]」（不可区分），**没测过 vs 0.5**——
 *   而后者才是「该不该用基率」的直接依据。
 *
 * ★★ 判据冻结闸（机械执行「冻结的是判据，不是开跑令」，PREREG §8）：
 *   运行时**先复算**冻结件 sha256；MATCH 才准读数，不 MATCH 直接 `exit 5`、零写盘。
 *   无 `--run` ⇒ 打印开跑前提状态并 `exit 3`，零写盘。
 *
 * ★★ walk-forward 的诚实处置（PREREG §3）：两臂都是**常数函数**
 *   （`p` 是写入时冻结的账本值；0.5 是常数）⇒ walk-forward 在此**退化**。
 *   本件不假装跑了一次 walk-forward，而是把它落成两条**可执行**断言：
 *   ① 序无关性（打乱入池行 ⇒ d 向量逐位相同）；② 时序零泄漏（扰动 t 之后的 y ⇒ d_t 不变）。
 *
 * 纪律：账本**只读**（`{readOnly:true}`）｜零 LLM｜零网络｜零新依赖｜不改任何既有件。
 * 用法：
 *   node p1b/scripts/base-rate-decision-value.cjs                                   # 前提状态，exit 3
 *   node p1b/scripts/base-rate-decision-value.cjs --run                             # 读数落盘
 *   node p1b/scripts/base-rate-decision-value.cjs --run --out-dir <d> --db <p> --prereg <f>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..', '..');

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const PREREG = arg('prereg', path.join(ROOT, 'docs', 'specs', 'PREREG-base-rate-decision-value-v1.md'));
const RUN = process.argv.indexOf('--run') !== -1;

// ── PREREG 冻结常量（写死；改动＝版本递进，禁为了让结论好看而改）──
const BINS = [0.1, 0.3, 0.5, 0.7, 0.9];        // §2 五档
const C1_WAD_TOL = 0.02;                      // §2 WAD ≤ 0.02 ⇒ 已校准
const MIN_N = 30;                              // §2 沿用项目既有口径
const BOOT_B = 1000;                           // §3 照 thickcell-replay
const BOOT_SEED = 987654321;                   // §3 禁换种子凑结论
const MDE_K = 2.8;                             // §3 MDE = 2.8·σ̂_d/√n
const HALF = 0.5;                              // §3 对照臂
const EXITS = ['A', 'B', 'C'];                 // §5 三条出口，禁增设
const TRUTH_DEFECT_PREDICATE_SOURCE = 'p1b/src/evidence/truthBasis.js';  // §1 单一真源，禁自写

// ── §1 池 ──────────────────────────────────────────────────────────────────
/**
 * 池 = 已结算 ∧ 有可计分 p ∧ 非真值口径缺陷。
 * ★ 排除谓词**直接复用** truthBasis 单一真源（PREREG §1 泄漏防线②），禁自写一套。
 */
function buildPool(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  const tb = require(path.join(ROOT, 'p1b', 'src', 'evidence', 'truthBasis.js'));
  const db = new DatabaseSync(dbPath, { readOnly: true });   // ★零账本写
  const NOT = tb.NOT_TRUTH_BASIS_DEFECT_SQL();
  const SEL = "p.resolved_at IS NOT NULL AND p.outcome IN ('true','false') "
    + "AND p.assigned_prob IS NOT NULL AND p.assigned_prob >= 0 AND p.assigned_prob <= 1";
  const rows = db.prepare('SELECT p.id, p.layer, p.outcome, p.assigned_prob, p.resolved_at, p.created_at, p.engine '
    + 'FROM predictions p WHERE ' + SEL + ' AND ' + NOT).all();
  // 排除计数必须披露（禁静默丢）：与「同池但命中缺陷谓词」的行数
  const excluded_defect = db.prepare('SELECT COUNT(*) c FROM predictions p WHERE ' + SEL + ' AND NOT ' + NOT).get().c;
  db.close();
  const pool = rows.map((r) => ({
    id: r.id,
    layer: r.layer,
    y: (String(r.outcome).toLowerCase() === 'true') ? 1 : 0,
    p: Number(r.assigned_prob),
    resolved_at: r.resolved_at || '',
    created_at: r.created_at || '',
    engine: r.engine || null,
  })).sort((a, b) => (a.resolved_at < b.resolved_at ? -1 : a.resolved_at > b.resolved_at ? 1 : a.id - b.id));
  return { pool, excluded_defect, db_path: dbPath };
}
/** 把 pool 摊成 metricsOf 吃的行型。 */
function toRows(pool) { return pool.map((q) => ({ id: q.id, layer: q.layer, p: q.p, y: q.y, resolved_at: q.resolved_at })); }

// ── §2 C1 分档与校准 ────────────────────────────────────────────────────────
/** 整数百分点落档（PREREG §2）：**先取整、后落档** ⇒ 边界唯一、五档铺满 [0,1]、不丢行。 */
function binOf(p) {
  const pct = Math.round(Number(p) * 100);          // 整数百分点
  if (pct < 20) return 0.1;
  if (pct < 40) return 0.3;
  if (pct < 60) return 0.5;
  if (pct < 80) return 0.7;
  return 0.9;
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

/**
 * 校准读数（PREREG §2）。
 *  · `obs`   = 实际发生率 mean(y)
 *  · `meanp` = **该档 p**＝档内 assigned_prob 均值（★C1 生死只由这版决定）
 *  · `wad`   = Σ_{合格档} (n_b/N_合格)·|obs_b − meanp_b|，n<30 的档**不入判读、不参与归一**
 *  · `wad_center` = 旁挂敏感性（用档标常数）——**只披露，不据以判生死**（事前登记，防事后挑版本）
 */
function calibrationOf(rows) {
  const byBin = new Map();
  for (const b of BINS) byBin.set(b, { label: b, n: 0, k: 0, sum_p: 0 });
  for (const r of rows) {
    const b = binOf(r.p);
    const slot = byBin.get(b);
    slot.n += 1; slot.k += r.y; slot.sum_p += r.p;
  }
  const bins = BINS.map((b) => {
    const s = byBin.get(b);
    const n = s.n;
    return {
      label: b, n: n,
      obs_rate: n ? s.k / n : null,
      mean_p: n ? s.sum_p / n : null,
      mean_y: n ? s.k / n : null,
      eligible: n >= MIN_N,
      note: n === 0 ? '空档' : (n >= MIN_N ? '可判读' : 'n<' + MIN_N + ' 只方向披露·禁入判读'),
    };
  });
  const ok = bins.filter((b) => b.eligible);
  const Nok = ok.reduce((a, b) => a + b.n, 0);
  let wad = null, wad_center = null;
  if (Nok > 0) {
    wad = ok.reduce((a, b) => a + (b.n / Nok) * Math.abs(b.obs_rate - b.mean_p), 0);
    wad_center = ok.reduce((a, b) => a + (b.n / Nok) * Math.abs(b.obs_rate - b.label), 0);
  }
  return {
    n: rows.length, bins: bins, n_eligible: Nok,
    wad: wad,                       // ★C1 主口径（档内均值）
    wad_center: wad_center,         // 敏感性（只披露）
    tol: C1_WAD_TOL,
    c1_pass: wad === null ? null : (wad <= C1_WAD_TOL),
    verdict: wad === null ? 'n/a' : (wad <= C1_WAD_TOL ? '已校准' : '未校准'),
    n_eligible_bins: ok.length,
  };
}

// ── §3 C2 决策价值（★主判据）＋ MDE ───────────────────────────────────────
/**
 * 逐题配对差：d = (p−y)² − (0.5−y)²。负 ＝ 按 p 更好（PREREG §3 写死）。
 * 配对保留：同一题内两臂共享同一个 y。
 */
function dOf(r) { return (r.p - r.y) * (r.p - r.y) - (HALF - r.y) * (HALF - r.y); }

/**
 * 配对 bootstrap：**逐题重采样**（配对保留），返回均值的百分位 CI。
 * ★ 口径**照抄** `thickcell-replay.cjs` 的 `bootCI`（同 LCG、同 B、同 seed、同分位数公式）——
 *   本仓现成范式，不另立一套（测试断言二者输出逐位相同）。
 */
function bootCI(diffs, B, seed) {
  if (!diffs || !diffs.length) return null;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const means = [];
  for (let b = 0; b < B; b++) {
    let acc = 0;
    for (let i = 0; i < diffs.length; i++) acc += diffs[Math.floor(rnd() * diffs.length)];
    means.push(acc / diffs.length);
  }
  means.sort((a, b) => a - b);
  const q = (p) => means[Math.min(means.length - 1, Math.max(0, Math.floor(p * means.length)))];
  return { lb: q(0.025), ub: q(0.975), B: B, seed: seed, mean: mean(diffs) };
}

/** C2 读数：Δ／CI95／σ̂_d／MDE **四件同报**（PREREG §3 强制）。 */
function metricsOf(rows, B, seed) {
  const B2 = B || BOOT_B, S2 = (seed === undefined || seed === null) ? BOOT_SEED : seed;
  const diffs = rows.map(dOf);
  const n = diffs.length;
  if (!n) return { n: 0, delta: null, ci95: null, sd_d: null, mde: null, brier_p: null, brier_half: null, boot: { B: B2, seed: S2 }, c2_verdict: 'C' };
  const delta = mean(diffs);
  const ci = bootCI(diffs, B2, S2);
  const sd_d = sd(diffs);
  const brier_p = mean(rows.map((r) => (r.p - r.y) * (r.p - r.y)));
  const brier_half = mean(rows.map((r) => (HALF - r.y) * (HALF - r.y)));
  // ★ 出口只有 A/B/C 三条（PREREG §5，禁增设「就近归档」）：
  //   n<MIN_N ⇒ C（n/a，功效不足**不得**说成 B）；否则 CI95 上界<0 ⇒ A，否则 ⇒ B。
  const verdict = n < MIN_N ? 'C' : (ci.ub < 0 ? 'A' : 'B');
  return {
    n: n, delta: delta, ci95: ci,
    sd_d: sd_d, mde: (sd_d === null || !n) ? null : MDE_K * sd_d / Math.sqrt(n),
    brier_p: brier_p, brier_half: brier_half,
    boot: { B: B2, seed: S2 },
    c2_verdict: verdict,
  };
}

/**
 * §3 walk-forward 退化处置：按 `resolved_at` 升序推进，逐题算 d。
 * ★ 两臂都是常数函数 ⇒ 此处**没有**信息流可言（诚实声明）；本函数只负责把「序」固定下来，
 *   好让测试能对「打乱输入」与「扰动未来 y」两条断言做**可执行**的零泄漏核验。
 */
function replayOrder(rows) {
  const sorted = rows.slice().sort((a, b) => {
    const ra = a.resolved_at || '', rb = b.resolved_at || '';
    if (ra !== rb) return ra < rb ? -1 : 1;
    return (a.id === undefined ? 0 : a.id) - (b.id === undefined ? 0 : b.id);
  });
  return sorted.map((r, i) => ({ i: i, id: r.id, at: r.resolved_at || '', d: dOf(r) }));
}

// ── §4 禁跨层池化：分层披露单元（禁把全池结论说成某层，也禁层间搬运）──
function layerCells(pool) {
  const by = new Map();
  for (const q of pool) {
    const k = q.layer || 'UNKNOWN';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(q);
  }
  const cells = [...by.entries()].map(([layer, rows]) => {
    const rr = rows.map((q) => ({ id: q.id, p: q.p, y: q.y, resolved_at: q.resolved_at }));
    const m = metricsOf(rr, BOOT_B, BOOT_SEED);
    return {
      layer: layer, n: rr.length, eligible: rr.length >= MIN_N,
      c2: m, cal: calibrationOf(rr),
      note: rr.length >= MIN_N ? '可判读（**仅限本层**；禁与其它层池化）' : 'n<' + MIN_N + '·只方向披露',
    };
  }).sort((a, b) => a.layer - b.layer);
  return cells;
}

// ── §6 F2 旁证：`assigned_prob` vs `evidence.baseRate.p` 逐行一致性 ──────────
/** ★ 独立事实核验，**不参与** C1／C2 任何判定；核出什么写什么。 */
function probeBaseRateEquality(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare('SELECT p.id, p.layer, p.assigned_prob, p.evidence_json, p.resolved_at, p.outcome '
    + 'FROM predictions p WHERE p.assigned_prob IS NOT NULL').all();
  db.close();
  let withBR = 0, withoutBR = 0, bitExact = 0, tol1e3 = 0, tol1e2 = 0, settledWithBR = 0, settledBitExact = 0;
  let maxAbs = null;
  const notExact = [];
  const layers = {};
  for (const r of rows) {
    const settled = (r.resolved_at !== null && r.resolved_at !== undefined)
      && (String(r.outcome) === 'true' || String(r.outcome) === 'false');
    let brp = null;
    try {
      const ev = JSON.parse(r.evidence_json || '[]');
      if (Array.isArray(ev)) {
        for (const e of ev) {
          if (e && e.baseRate && typeof e.baseRate.p === 'number' && isFinite(e.baseRate.p)) { brp = e.baseRate.p; break; }
        }
      }
    } catch (e) { brp = null; }
    if (brp === null) { withoutBR += 1; continue; }
    withBR += 1;
    const d = Math.abs(brp - Number(r.assigned_prob));
    if (maxAbs === null || d > maxAbs) maxAbs = d;
    if (d < 1e-12) { bitExact += 1; if (settled) settledBitExact += 1; } else { if (notExact.length < 20) notExact.push({ id: r.id, layer: r.layer, assigned_prob: r.assigned_prob, base_rate_p: brp, abs_diff: d }); }
    if (d <= 0.001) tol1e3 += 1;
    if (d <= 0.01) tol1e2 += 1;
    if (settled) settledWithBR += 1;
    layers[r.layer || 'UNKNOWN'] = layers[r.layer || 'UNKNOWN'] || { n: 0, with_br: 0, bit_exact: 0 };
    layers[r.layer || 'UNKNOWN'].n += 1;
    layers[r.layer || 'UNKNOWN'].with_br += 1;
    if (d < 1e-12) layers[r.layer || 'UNKNOWN'].bit_exact += 1;
  }
  return {
    total_rows_with_prob: rows.length,
    with_base_rate: withBR,
    without_base_rate: withoutBR,
    exact_bit_equal: bitExact,
    not_exact: withBR - bitExact,
    equal_within_1e3: tol1e3,
    equal_within_1e2: tol1e2,
    max_abs_diff: maxAbs,
    settled: { with_base_rate: settledWithBR, exact_bit_equal: settledBitExact },
    by_layer: layers,
    not_exact_sample: notExact,
  };
}

// ── §8 判据冻结闸 ───────────────────────────────────────────────────────────
/** 复算冻结件 sha256（口径复用 `prereg-freeze.cjs` 的 `freezeSha`，禁各写一套）。 */
function preregGate(preregPath) {
  const { freezeSha } = require(path.join(ROOT, 'p1b', 'scripts', 'prereg-freeze.cjs'));
  try {
    const r = freezeSha(preregPath);
    return { ok: r.match === true, sha256: r.sha256, recorded: r.recorded, file: r.file };
  } catch (e) {
    return { ok: false, sha256: null, recorded: null, file: preregPath, error: String(e && e.message ? e.message : e) };
  }
}

// ── 读数落盘 ────────────────────────────────────────────────────────────────
function fmt(v, d) { return (v === null || v === undefined || !isFinite(v)) ? 'n/a' : Number(v).toFixed(d === undefined ? 6 : d); }

function buildReport(dbPath, preregPath, gate) {
  const { pool, excluded_defect } = buildPool(dbPath);
  const rows = toRows(pool);
  const m = metricsOf(rows, BOOT_B, BOOT_SEED);
  const cal = calibrationOf(rows);
  const layers = layerCells(pool);
  const f2 = probeBaseRateEquality(dbPath);
  // §3 零泄漏两条断言：结果**随读数一起报**（不只是测试里跑一次）
  const ordered = replayOrder(rows);
  const shuffled = replayOrder(rows.slice().reverse());
  const order_invariant = ordered.every((r, i) => r.d === shuffled[i].d);
  return {
    script: 'p1b/scripts/base-rate-decision-value.cjs',
    generated_at: new Date().toISOString(),
    question: '按诚实基率 assigned_prob 决策 vs 按 0.5 决策，结果有没有差别？',
    discipline: { zero_write_ledger: true, read_only: true, zero_llm: true, zero_network: true, zero_new_deps: true },
    prereg: { file: gate.file, sha256: gate.sha256, match: gate.ok, constants: { BINS, C1_WAD_TOL, MIN_N, BOOT_B, BOOT_SEED, MDE_K, HALF } },
    pool: { n: rows.length, excluded_truth_basis_defect: excluded_defect, min_n: MIN_N },
    c1_calibration: cal,
    c2_decision_value: m,
    verdict: {
      c2_exit: m.c2_verdict,
      c2_wording: m.c2_verdict === 'A' ? '基率有决策价值（CI95 上界<0）'
        : m.c2_verdict === 'B' ? '基率未被证明有决策价值（★负结果，也是一等交付）'
          : 'n/a·不出结论（n<' + MIN_N + '，功效不足）',
      c1: cal.verdict,
      exit_b_mandatory: m.c2_verdict === 'B' ? [
        'σ̂_d=' + fmt(m.sd_d) + '；MDE=' + fmt(m.mde) + '（本次检验能分辨的最小效应）',
        '真实效应若小于 MDE，本实验**看不见**——出口 B 是「未被证明」，不等于「已证否」',
        '分层同口径读数五层全列（见 layers），用于分辨「整体看不见是否被某一层拖平」',
      ] : null,
    },
    layers: layers,
    f2_side_check: Object.assign({}, f2, {
      is_criterion: false,
      note: '★独立事实核验，**不参与** C1／C2 判定；核出什么写什么。',
    }),
    walkforward_note: {
      degenerate: true,
      why: '两臂都是常数函数（p 为写入时冻结的账本值；0.5 为常数）⇒ 无历史信息流，walk-forward 在此退化。',
      executed_assertions: {
        order_invariance: order_invariant,
        what: '打乱入池行后重算，d 向量逐位相同（常数臂不可能看见未来）；同刻题互不影响亦由该断言覆盖。',
        zero_leak_test: '见 p1b/test/base-rate-decision-value.test.cjs ⑧：扰动 t 之后的 y，d_t 逐位不变。',
      },
      forbidden_claim: '★禁把本件对外表述成「跑了一次 walk-forward」——那是退化处的退化。',
    },
  };
}

function renderMd(r) {
  const L = [];
  L.push('# 诚实基率的决策价值（' + String(r.generated_at).slice(0, 10) + '）');
  L.push('');
  L.push('> 判据冻结件：`' + r.prereg.file + '`（sha `' + r.prereg.sha256 + '`，MATCH=' + r.prereg.match + '）');
  L.push('> 纪律：零账本写（readOnly）·零 LLM·零网络·零新依赖。');
  L.push('');
  L.push('## 那一问');
  L.push('');
  L.push('> **' + r.question + '**');
  L.push('');
  L.push('- 池 n=' + r.pool.n + '（已结算 ∧ 可计分 ∧ 非真值口径缺陷；排除缺陷行 ' + r.pool.excluded_truth_basis_defect + '）');
  L.push('');
  L.push('## C1 · 校准性（判据：加权绝对偏差 ≤ ' + fmt(r.c1_calibration.tol, 2) + '）');
  L.push('');
  L.push('| 档 | n | 实际发生率 | 档内 p 均值 | 偏差 | 判定 |');
  L.push('|---|---|---|---|---|---|');
  for (const b of r.c1_calibration.bins) {
    L.push('| ' + fmt(b.label, 1) + ' | ' + b.n + ' | ' + fmt(b.obs_rate, 4) + ' | ' + fmt(b.mean_p, 4)
      + ' | ' + (b.obs_rate === null ? 'n/a' : fmt(b.obs_rate - b.mean_p, 4)) + ' | ' + (b.n === 0 ? '空档' : (b.eligible ? '可判读' : 'n<' + r.pool.min_n + ' 只方向披露')) + ' |');
  }
  L.push('');
  L.push('- **WAD（主口径，档内均值）= ' + fmt(r.c1_calibration.wad) + '** ⇒ **' + r.c1_calibration.verdict + '**'
    + (r.c1_calibration.c1_pass === null ? '' : '（判据 ≤ ' + fmt(r.c1_calibration.tol, 2) + '）'));
  L.push('- 旁挂敏感性 WAD（档标常数）= ' + fmt(r.c1_calibration.wad_center) + '（**只披露，不据以判生死**）');
  L.push('');
  L.push('## C2 · 决策价值（★主判据：CI95 上界 < 0）');
  L.push('');
  const m = r.c2_decision_value;
  L.push('| 项 | 值 |');
  L.push('|---|---|');
  L.push('| n | ' + m.n + ' |');
  L.push('| Brier(按 p) | ' + fmt(m.brier_p) + ' |');
  L.push('| Brier(按 0.5) | ' + fmt(m.brier_half) + ' |');
  L.push('| Δ＝Brier(p)−Brier(0.5) | ' + fmt(m.delta) + ' |');
  L.push('| 配对 bootstrap CI95 | [' + fmt(m.ci95 && m.ci95.lb) + ', ' + fmt(m.ci95 && m.ci95.ub) + '] |');
  L.push('| σ̂_d | ' + fmt(m.sd_d) + ' |');
  L.push('| **MDE ≈ 2.8·σ̂_d/√n** | **' + fmt(m.mde) + '** |');
  L.push('| bootstrap | B=' + m.boot.B + ' seed=' + m.boot.seed + ' |');
  L.push('| **出口** | **' + r.verdict.c2_exit + '** |');
  L.push('');
  L.push('> **' + r.verdict.c2_wording + '**');
  if (r.verdict.exit_b_mandatory) {
    L.push('');
    for (const s of r.verdict.exit_b_mandatory) L.push('> - ' + s);
  }
  L.push('');
  L.push('## 分层（五层全列·禁池化）');
  L.push('');
  L.push('| 层 | n | Δ | CI95 | σ̂_d | MDE | 出口 | WAD | 判定 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const c of r.layers) {
    L.push('| ' + c.layer + ' | ' + c.n + ' | ' + fmt(c.c2.delta) + ' | [' + fmt(c.c2.ci95 && c.c2.ci95.lb) + ', ' + fmt(c.c2.ci95 && c.c2.ci95.ub) + '] | '
      + fmt(c.c2.sd_d) + ' | ' + fmt(c.c2.mde) + ' | ' + c.c2.c2_verdict + ' | ' + fmt(c.cal.wad) + ' | ' + c.note.split('·')[0] + ' |');
  }
  L.push('');
  L.push('- 禁搬运：全池的结论**不得**说成某一层的性质（反向亦然）；层间**禁**加总／平均／只报有利的一层。');
  L.push('');
  L.push('## F2 · 旁证（`assigned_prob` vs `evidence.baseRate.p`，**非判据**）');
  L.push('');
  const f = r.f2_side_check;
  L.push('| 项 | 值 |');
  L.push('|---|---|');
  L.push('| 全表有 `assigned_prob` 行 | ' + f.total_rows_with_prob + ' |');
  L.push('| 其中有 `baseRate.p` | ' + f.with_base_rate + ' |');
  L.push('| **无 `baseRate.p`（单列，禁当相等）** | **' + f.without_base_rate + '** |');
  L.push('| 位级相等（\\|Δ\\|<1e-12） | ' + f.exact_bit_equal + ' |');
  L.push('| **位级不相等** | **' + f.not_exact + '** |');
  L.push('| ≤1e-3 相等 | ' + f.equal_within_1e3 + ' |');
  L.push('| ≤1e-2 相等 | ' + f.equal_within_1e2 + ' |');
  L.push('| max\\|Δ\\| | ' + fmt(f.max_abs_diff) + ' |');
  L.push('');
  L.push('- ' + f.note);
  L.push('');
  L.push('## walk-forward 处置（诚实声明）');
  L.push('');
  L.push('- ' + r.walkforward_note.why);
  L.push('- 序无关性断言（随读数实跑）：**' + r.walkforward_note.executed_assertions.order_invariance + '** —— ' + r.walkforward_note.executed_assertions.what);
  L.push('- ' + r.walkforward_note.executed_assertions.zero_leak_test);
  L.push('- ' + r.walkforward_note.forbidden_claim);
  L.push('');
  L.push('（零写库 · 只读披露件）');
  return L.join('\n') + '\n';
}

function main() {
  const gate = preregGate(PREREG);
  const { pool, excluded_defect } = (gate.ok && RUN) ? buildPool(DB_PATH) : { pool: [], excluded_defect: null };

  // ★★ 判据冻结闸：不 MATCH 直接拒跑（exit 5，零写盘、零读数）
  if (!gate.ok) {
    console.error('★★ 判据冻结件 sha 复算**不 MATCH** ⇒ 拒跑（PREREG §8；禁读数、禁写盘）');
    console.error('   file     = ' + gate.file);
    console.error('   复算 sha = ' + (gate.sha256 || '(复算失败: ' + (gate.error || '未知') + ')'));
    console.error('   登记 sha = ' + (gate.recorded || '(无)'));
    console.error('   ⇒ 判据被改过。改判据＝版本递进（v1.1）＋全量重跑，不是改个阈值。');
    process.exit(5);
  }

  // ★★ 开跑令闸：无 --run ⇒ 报前提状态、exit 3、零写盘
  if (!RUN) {
    console.log('=== 诚实基率决策价值 · 开跑前提状态（无 --run ⇒ 拒跑，零写盘）===');
    console.log('  PREREG 冻结件：' + gate.file);
    console.log('  sha256 复算   ：' + gate.sha256 + '（MATCH=' + gate.ok + '）');
    console.log('  判据常量      ：五档 ' + JSON.stringify(BINS) + '｜WAD≤' + C1_WAD_TOL + '｜MIN_N=' + MIN_N
      + '｜B=' + BOOT_B + ' seed=' + BOOT_SEED + '｜MDE k=' + MDE_K);
    console.log('  ⇒ 开跑＝一次显式动作：加 --run。');
    process.exit(3);
  }

  const r = buildReport(DB_PATH, PREREG, gate);
  const DATE_STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jp = path.join(OUT_DIR, 'base-rate-decision-value-' + DATE_STAMP + '.json');
  const mp = path.join(OUT_DIR, 'base-rate-decision-value-' + DATE_STAMP + '.md');
  fs.writeFileSync(jp, JSON.stringify(r, null, 2), 'utf8');
  fs.writeFileSync(mp, renderMd(r), 'utf8');

  console.log('=== 诚实基率决策价值（PREREG sha ' + gate.sha256.slice(0, 16) + '… MATCH）===');
  console.log('  池 n=' + r.pool.n + '（排除真值口径缺陷 ' + r.pool.excluded_truth_basis_defect + ' 行）');
  console.log('  C1 WAD=' + fmt(r.c1_calibration.wad) + ' ⇒ ' + r.c1_calibration.verdict + '（≤' + C1_WAD_TOL + '）');
  console.log('  C2 Δ=' + fmt(r.c2_decision_value.delta) + ' CI95=[' + fmt(r.c2_decision_value.ci95 && r.c2_decision_value.ci95.lb) + ','
    + fmt(r.c2_decision_value.ci95 && r.c2_decision_value.ci95.ub) + '] σ̂_d=' + fmt(r.c2_decision_value.sd_d) + ' MDE=' + fmt(r.c2_decision_value.mde));
  console.log('  ★出口 ' + r.verdict.c2_exit + '：' + r.verdict.c2_wording);
  console.log('  F2 旁证：有 baseRate ' + r.f2_side_check.with_base_rate + '／无 ' + r.f2_side_check.without_base_rate
    + '；位级相等 ' + r.f2_side_check.exact_bit_equal + '／不等 ' + r.f2_side_check.not_exact + '；max|Δ|=' + fmt(r.f2_side_check.max_abs_diff));
  console.log('  json -> ' + jp);
  console.log('  md   -> ' + mp);
}

if (require.main === module) main();

module.exports = {
  buildPool, toRows, binOf, calibrationOf, metricsOf, bootCI, dOf, replayOrder,
  layerCells, probeBaseRateEquality, preregGate, renderMd, buildReport,
  BINS, C1_WAD_TOL, MIN_N, BOOT_B, BOOT_SEED, MDE_K, HALF, EXITS, TRUTH_DEFECT_PREDICATE_SOURCE,
};
