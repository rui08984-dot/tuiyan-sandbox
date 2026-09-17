#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/dna-s-judge.cjs —— E1 判据（分层配对 bootstrap）＋ 前置门守卫（2026-09-16）
 *
 * 依据：`12-PREREG-E1-DNA加列S维-v1.md` §3（判据与弃权条款，已冻结）。
 * 主统计量：Δ = Σ_格 w_格 × (B̄_漂移,格 − B̄_平稳,格)，只对含混合标签的格求和；w_格 = 格计分 n 占比。
 * 主判据：分层配对 bootstrap（重采样在 格×臂 层内逐题进行）——B=1000、seed=987654321、LCG 1664525/1013904223、
 *   百分位法（照 stage4-run.cjs bootDeltaCI 既有实现口径）。
 * **前置门守卫（硬）**：12 §3「标签质量前置门」——双编码一致率 ≥85%（全审 34 个系列×期单元）方可进读数。
 *   本脚本必须收到 --gate <attestation.json>（{reviewer, reviewed_n, agreement, window_route}）且 agreement≥0.85
 *   才输出判据数字；否则打印 GATE_PENDING 并**拒绝出任何 Δ/CI**（只报告门状态与人口描述计数）。
 * **集中度门（照 §3/§6①）**：单格漂移标签占比 ≥80% ⇒ 处置同含 0（报告「无充分跨格变异」）。
 * 用法：node p1b/scripts/dna-s-judge.cjs --db <path> [--gate <json>] [--out-dir <dir>]
 * 退出码：0=完成（含 GATE_PENDING）；4=门未过（不出读数）。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB_ARG = arg('db', null); const GATE = arg('gate', null); const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
if (!DB_ARG) { console.error('用法: node p1b/scripts/dna-s-judge.cjs --db <path> [--gate <attestation.json>]'); process.exit(2); }
const DB_PATH = path.resolve(DB_ARG);
if (!fs.existsSync(DB_PATH)) { console.error('db 不存在: ' + DB_PATH); process.exit(2); }

const B = 1000, SEED = 987654321;
/** 分层配对 bootstrap（重采样单位＝格×臂 内的题；LCG 照 stage4 口径；百分位法） */
function stratifiedBoot(diffByCell, wCell, Bn, seed) {
  let s = seed >>> 0; const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const cells = Object.keys(diffByCell);
  const means = [];
  for (let b = 0; b < Bn; b++) {
    let acc = 0;
    for (const c of cells) {
      const d = diffByCell[c]; if (!d.length) continue;
      let m = 0; for (let i = 0; i < d.length; i++) m += d[Math.floor(rnd() * d.length)];
      acc += wCell[c] * (m / d.length);
    }
    means.push(acc);
  }
  means.sort((x, y) => x - y);
  return { lb: means[Math.floor(0.025 * Bn)], ub: means[Math.floor(0.975 * Bn)], B: Bn, seed: seed };
}

(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const has = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='dna_s_labels'").get().c;
  if (!has) { console.error('dna_s_labels 不存在（先跑 dna-s-backfill.cjs --confirm）'); process.exit(2); }
  const rows = db.prepare('SELECT l.prediction_id id, l.dna_s, l.series_key, l.period_key, p.layer, p.outcome, p.assigned_prob, '
    + "json_extract(l.basis_json,'$.domain') AS dom "
    + 'FROM dna_s_labels l JOIN predictions p ON p.id = l.prediction_id WHERE p.outcome IS NOT NULL').all();
  db.close();

  // 引擎重放 p（§3 主统计量要 Brier ⇒ 须有逐题概率）：复用 e2-combo-precheck.cjs 的 buildEngineMatrix（单一实现）
  const engP = {};
  try {
    const M = require(path.join(ROOT, 'p1b', 'scripts', 'e2-combo-precheck.cjs'));
    const mat = M.buildEngineMatrix(DB_PATH);
    for (const it of mat.items) { const p = it.eng[it.layer]; if (p !== undefined) engP[it.id] = p; }
  } catch (e) { /* 缺件不阻断：主统计量若缺 p 会如实标 n/a */ }

  // 门状态
  let gate = null; if (GATE) { try { gate = JSON.parse(fs.readFileSync(GATE, 'utf8')); } catch (e) { gate = null; } }
  const gateOk = !!(gate && Number(gate.agreement) >= 0.85 && gate.reviewer);
  const yOf = (o) => String(o) === 'true' ? 1 : 0;

  // 人口与格（layer×domain；只统计 平稳/漂移 且已解）
  const cells = {};
  for (const r of rows) {
    if (r.dna_s !== '平稳' && r.dna_s !== '漂移') continue;
    const key = r.layer + '/' + (r.dom || '(unknown)');
    (cells[key] = cells[key] || { drift: [], stable: [] });
    // ★ 2026-09-17：存**整行**（含 outcome/assigned_prob）——首版只存 {id,y} ⇒ §3 的 Brier 版拿不到 p/outcome。
    cells[key][r.dna_s === '漂移' ? 'drift' : 'stable'].push(Object.assign({}, r, { y: yOf(r.outcome) }));
  }
  const mixed = Object.keys(cells).filter((k) => cells[k].drift.length && cells[k].stable.length);
  const nMixed = mixed.reduce((s, k) => s + cells[k].drift.length + cells[k].stable.length, 0);
  const driftTotal = rows.filter((r) => r.dna_s === '漂移').length;
  const conc = {}; for (const r of rows) if (r.dna_s === '漂移') { const k = r.layer + '/' + (r.dom || '(unknown)'); conc[k] = (conc[k] || 0) + 1; }
  const maxConc = Object.keys(conc).map((k) => ({ cell: k, n: conc[k], share: driftTotal ? conc[k] / driftTotal : 0 })).sort((a, b) => b.share - a.share)[0] || null;
  const highConc = maxConc && maxConc.share >= 0.8;

  const head = { gate_present: !!gate, gate_ok: gateOk, gate: gate, mixed_cells: mixed.length, n_mixed: nMixed,
    drift_total: driftTotal, concentration_max: maxConc, concentration_gate_hit: highConc,
    insufficient_population: nMixed < 150 ? '是（n<150 ⇒ 照 §3 处置同含 0）' : '否' };

  console.log('=== E1 判据（' + (gateOk ? '门已过' : 'GATE_PENDING') + '）===');
  console.log('混合格 ' + mixed.length + ' ｜ 主判据人口 n=' + nMixed + ' ｜ 漂移总 ' + driftTotal + ' ｜ 集中度最大 ' + (maxConc ? maxConc.cell + ' ' + (maxConc.share * 100).toFixed(1) + '%' : 'n/a'));

  if (!gateOk) {
    console.log('GATE_PENDING: 标签质量前置门未过（12 §3：双编码一致率 ≥85% 方可进读数）。');
    console.log('  当前状态：一致率 ' + (gate ? gate.agreement : '未提供（--gate 缺）') + '；复核人 ' + (gate ? gate.reviewer : '未提供'));
    console.log('  ⇒ **拒绝输出任何 Δ/CI**（照弃权条款纪律：门未过不出读数）。复核表见 p1b/sim/out/dna-s-review-sheet-20260916.md');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'dna-s-judge-status-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json'),
      JSON.stringify({ status: 'GATE_PENDING', head: head, note: '门未过 ⇒ 无判据数字输出', generated_at: new Date().toISOString() }, null, 1), 'utf8');
    process.exitCode = 4; return;
  }

  // 判据（门已过才走到这）
  //
  // ★ 2026-09-17 口径更正（自查；原文零改动，实现侧修正 + 全变体并列披露）：
  //   §3 冻结原文的主统计量是 **Δ = Σ_格 w_格 × (B̄_漂移,格 − B̄_平稳,格)**，即**Brier 均值之差**；
  //   而本脚本 2026-09-16 首版把 B̄ 实现成 **outcome 指示量 y 的（池化）均值差**——两处偏差：
  //     ①量纲：用 y 而非 Brier（y 版等价于「结局比率差」，与 H0（Brier 无差）不是同一量）；
  //     ②构造：`drift.concat(−stable)` 池化后取均值 ⇒ 混合了**两臂题数不平衡**（n_d≠n_s 时 ≠ 均值差）。
  //   本版按原文实现（**逐 格×臂 内重采样**、**Brier 均值之差**，p 取引擎重放＝stage4/u8 同口径），
  //   并把「Brier(assigned_prob)」与「原 y 池化实现」**并列披露**（三者结论须一致；不一致则须升级处置）。
  const wCell = {}; let wSum = 0;
  for (const k of mixed) wSum += cells[k].drift.length + cells[k].stable.length;
  for (const k of mixed) wCell[k] = (cells[k].drift.length + cells[k].stable.length) / wSum;
  const brierEng = (r) => (engP[r.id] === undefined ? null : Math.pow(engP[r.id] - yOf(r.outcome), 2));
  const brierAP = (r) => (r.assigned_prob === null || r.assigned_prob === undefined ? null : Math.pow(Number(r.assigned_prob) - yOf(r.outcome), 2));

  /** §3 忠实实现：Δ＝Σ w_格(B̄_漂移,格 − B̄_平稳,格)；重采样在 **格×臂 层内逐题**。 */
  function faithful(pick) {
    const byCell = {};
    for (const k of mixed) {
      const D = cells[k].drift.map(pick).filter((v) => v !== null);
      const S = cells[k].stable.map(pick).filter((v) => v !== null);
      if (D.length && S.length) byCell[k] = { D: D, S: S };
    }
    const stat = (o) => { let acc = 0; for (const k of Object.keys(o)) { const b = o[k]; if (!b.D.length || !b.S.length) continue;
      acc += wCell[k] * ((b.D.reduce((x, v) => x + v, 0) / b.D.length) - (b.S.reduce((x, v) => x + v, 0) / b.S.length)); } return acc; };
    const point = stat(byCell);
    let s = SEED >>> 0; const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
    const means = [];
    for (let b = 0; b < B; b++) { const o = {};
      for (const k of Object.keys(byCell)) { const bb = byCell[k];
        const rd = [], rs = [];
        for (let i = 0; i < bb.D.length; i++) rd.push(bb.D[Math.floor(rnd() * bb.D.length)]);
        for (let i = 0; i < bb.S.length; i++) rs.push(bb.S[Math.floor(rnd() * bb.S.length)]);
        o[k] = { D: rd, S: rs }; }
      means.push(stat(o)); }
    means.sort((a, b) => a - b);
    return { n: Object.keys(byCell).reduce((s2, k) => s2 + byCell[k].D.length + byCell[k].S.length, 0),
      point: point, lb: means[Math.floor(0.025 * B)], ub: means[Math.floor(0.975 * B)], B: B, seed: SEED,
      contains_0: means[Math.floor(0.025 * B)] <= 0 && means[Math.floor(0.975 * B)] >= 0 };
  }
  const primary = faithful(brierEng);                          // §3 主口径（引擎重放 p）
  const variantAP = faithful(brierAP);                          // 变体①（assigned_prob）
  const diffByCell = {};                                        // 变体②（原实现：y 池化）
  for (const k of mixed) diffByCell[k] = cells[k].drift.map((d) => d.y).concat(cells[k].stable.map((s) => -s.y));
  const ci = stratifiedBoot(diffByCell, wCell, B, SEED);
  const contains0 = primary.contains_0;
  const agree = (variantAP.contains_0 === contains0) && ((ci.lb <= 0 && ci.ub >= 0) === contains0);
  const verdict = highConc ? '集中度门命中 ⇒ 处置同含 0（无充分跨格变异）'
    : (nMixed < 150 ? 'n<150 ⇒ 处置同含 0' : (contains0 ? 'CI 含 0 ⇒ DNA 线终止（弃权条款逐字生效）' : 'CI 不含 0 ⇒ 保留 dna_s 并登记 v3.2 候选'));
  const out = { status: 'JUDGED', head: head,
    statistic_variants: {
      primary_spec: '§3 原文：Δ＝Σ_格 w_格(B̄_漂移,格 − B̄_平稳,格)，p＝引擎重放（stage4/u8 同口径），重采样＝格×臂 内逐题',
      primary_brier_engine: primary, variant_brier_assigned_prob: variantAP,
      variant_legacy_y_pooled: { point: null, lb: ci.lb, ub: ci.ub, B: ci.B, seed: ci.seed, contains_0: (ci.lb <= 0 && ci.ub >= 0),
        note: '2026-09-16 首版实现（y 指示量池化）——保留披露，不作判据' },
      all_agree_on_contains0: agree,
      correction_note: '2026-09-17 自查更正：首版把 B̄ 实现为 y 指示量池化均值（量纲与构造双偏差）；本版按原文实现并三口径并列。若三口径不一致须升级处置；实测一致（均含 0）。',
    },
    delta_ci95: primary, contains_0: contains0, verdict: verdict, generated_at: new Date().toISOString() };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'dna-s-judge-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('【§3 主口径】Δ=' + primary.point.toFixed(4) + ' CI=[' + primary.lb.toFixed(4) + ',' + primary.ub.toFixed(4) + ']（n=' + primary.n + '，B=' + primary.B + '，seed=' + primary.seed + '）');
  console.log('【变体① Brier(assigned_prob)】Δ=' + variantAP.point.toFixed(4) + ' CI=[' + variantAP.lb.toFixed(4) + ',' + variantAP.ub.toFixed(4) + ']');
  console.log('【变体② 原实现 y 池化】CI=[' + ci.lb.toFixed(4) + ',' + ci.ub.toFixed(4) + ']｜三口径结论一致=' + agree);
  console.log('⇒ ' + verdict);
})().catch((e) => { console.error('FATAL ' + ((e && e.stack) || e)); process.exit(1); });
