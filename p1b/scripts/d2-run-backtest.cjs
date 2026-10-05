#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/d2-run-backtest.cjs —— D2 历史回测引擎 · **跑批 + A1–A7 验收 + K1–K4 kill_test**。
 *
 * 判据来源（唯一）：PREREG-D2 v1（sha `70cf9d17…`）＋ v1.1 补充与勘误（四处勘误）。
 *
 * 隔离纪律（照 PREREG §7「零账本写」＋ 规格 §3.2 G-D2-0）：
 *   · **只读影子题面库**（`docs/assets/backtest/predictions-public-surface.db`）——该库里 truth_vault **物理不存在**；
 *   · **不打开生产库**（p1a.db）——本脚本全文无 p1a.db 路径；
 *   · 产物全部落 `docs/assets/backtest/`，**零账本写**。
 *
 * 零 LLM（纯机械：题面 ＋ 算术）。
 * 用法：node p1b/scripts/d2-run-backtest.cjs [--questions <f>] [--out <f>]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const QFILE = arg('questions', path.join(ROOT, 'docs', 'assets', 'backtest', 'd2-questions.json'));
const OUTFILE = arg('out', path.join(ROOT, '.run-out', 'backtest', 'd2-report.json'));
const SURFACE = path.join(ROOT, 'docs', 'assets', 'backtest', 'predictions-public-surface.db');

const PREREG_SHA = '70cf9d17e87d0522d979b8da00eba9967ccdb5f4201a97935e94864e84a37ee4';
const MIN_N = 30;   // A5 / 规格 §4.3-3
const B = 1000, SEED = 987654321;

// ── 统计原语 ──
const brier = (p, y) => (p - y) * (p - y);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
function bootCI(diffs, Bn, seed) {
  const n = diffs.length; if (!n) return { lb: null, ub: null };
  let s = seed >>> 0; const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const ms = [];
  for (let b = 0; b < Bn; b++) { let acc = 0; for (let i = 0; i < n; i++) acc += diffs[Math.floor(rnd() * n)]; ms.push(acc / n); }
  ms.sort((x, y) => x - y);
  return { lb: ms[Math.floor(0.025 * Bn)], ub: ms[Math.floor(0.975 * Bn)] };
}
/** Murphy 分解（10 等宽桶；照规格 §11.4 / #15） */
function murphy(ps, ys) {
  const K = 10, bins = Array.from({ length: K }, () => ({ n: 0, sp: 0, sy: 0 }));
  for (let i = 0; i < ps.length; i++) {
    const b = Math.min(K - 1, Math.floor(ps[i] * K));
    bins[b].n++; bins[b].sp += ps[i]; bins[b].sy += ys[i];
  }
  const N = ps.length, ybar = mean(ys);
  let rel = 0, res = 0;
  for (const b of bins) { if (!b.n) continue; const mp = b.sp / b.n, my = b.sy / b.n; rel += b.n * (mp - my) ** 2; res += b.n * (my - ybar) ** 2; }
  return { reliability: rel / N, resolution: res / N, uncertainty: ybar * (1 - ybar), bins: bins.map((b) => b.n) };
}
const diffTier = (b) => { const d = b * (1 - b); return d >= 0.21 ? '最难' : (d >= 0.16 ? '中' : (d >= 0.09 ? '近' : '极')); };
const hBucket = (hd) => (hd <= 7 ? 'short' : (hd <= 30 ? 'mid' : 'long'));

(async () => {
  const t0 = Date.now();
  const art = JSON.parse(fs.readFileSync(QFILE, 'utf8'));
  const Q = art.questions;
  const out = [];
  const T = [];
  const P = (s) => { T.push(s); console.log(s); };

  P('== D2 历史回测引擎 · 跑批 + 验收 ==');
  P('  题源 = ' + art.source);
  P('  PREREG = ' + art.prereg + ' (sha ' + String(art.prereg_sha256).slice(0, 8) + '…)');
  P('  题数 = ' + Q.length + ' | 题面指纹 = ' + String(art.question_fingerprint_sha256).slice(0, 16) + '…');
  P('');

  // ── K1：泄漏探针（只连影子库；尝试读真值 ⇒ 必须失败）──
  P('[K1 泄漏探针] 只连影子题面库，尝试读真值');
  const k1 = { surface: SURFACE, assertions: [] };
  try {
    const db = new DatabaseSync(SURFACE, { readOnly: true });
    for (const [id, sql, expectFail] of [
      ['A1', 'SELECT outcome FROM predictions', true],
      ['A2', 'SELECT * FROM truth_vault LIMIT 1', true],
      ['A3', 'SELECT truth_preview FROM predictions_public LIMIT 1', true],
    ]) {
      let got = null, ok = false;
      try { db.prepare(sql).all(); got = 'SUCCESS'; } catch (e) { got = 'FAIL: ' + e.message; }
      ok = expectFail ? got.startsWith('FAIL') : got === 'SUCCESS';
      k1.assertions.push({ id, sql, got, pass: ok });
    }
    // 写入拒绝
    try { db.exec('CREATE TABLE _probe(x)'); k1.assertions.push({ id: 'A4-write', sql: 'CREATE TABLE', got: 'SUCCESS', pass: false }); }
    catch (e) { k1.assertions.push({ id: 'A4-write', sql: 'CREATE TABLE', got: 'FAIL: ' + e.message, pass: true }); }
    db.close();
  } catch (e) { k1.error = e.message; }
  k1.pass = k1.assertions.length > 0 && k1.assertions.every((a) => a.pass);
  k1.assertions.forEach((a) => P('  ' + a.id + ' ' + a.sql + ' → ' + a.got + '  ' + (a.pass ? '✓' : '✗')));
  P('  K1 判定 = ' + (k1.pass ? 'PASS（隔离有效）' : '**FAIL ⇒ 停跑**'));
  P('');
  if (!k1.pass) { P('!! K1 失败 ⇒ 按 PREREG §6 立即停跑，不产出读数'); process.exit(3); }

  // ── 跑批：base 臂（＝统计基率）；model 臂（v1：同 base）──
  const rows = [];
  for (const q of Q) {
    const pBase = q.base_rate;
    const y = q.outcome;
    rows.push({
      city: q.city, var_name: q.var_name, month: q.month, horizon_days: q.horizon_days,
      tier: diffTier(pBase), hb: hBucket(q.horizon_days),
      p_base: pBase, p_model: pBase, y,
      brier_base: brier(pBase, y), brier_model: brier(pBase, y),
      cutoff_at: q.cutoff_at, question_date: q.question_date, event_date: q.event_date,
    });
  }

  // ── A4 平凡基线门（全批）──
  const ps = rows.map((r) => r.p_model), ys = rows.map((r) => r.y);
  const bModel = mean(rows.map((r) => r.brier_model));
  const bConstHalf = mean(ys.map((y) => brier(0.5, y)));
  const bBaseRate = mean(rows.map((r) => r.brier_base));
  const diffs = rows.map((r) => r.brier_model - brier(0.5, r.y));
  const ci = bootCI(diffs, B, SEED);
  const mur = murphy(ps, ys);
  P('[全批读数]（**恒挂「历史回测·非实时能力」**）');
  P('  n = ' + rows.length + ' | 观测率 = ' + mean(ys).toFixed(4) + ' | 模型平均 p = ' + mean(ps).toFixed(4));
  P('  Brier(model) = ' + bModel.toFixed(4) + ' | Brier(常数 0.5) = ' + bConstHalf.toFixed(4));
  const b1mbAll = mean(rows.map((r) => r.p_base * (1 - r.p_base)));
  P('  Δ(model − 0.5) = ' + (bModel - bConstHalf).toFixed(4) + ' | CI95 = [' + ci.lb.toFixed(4) + ', ' + ci.ub.toFixed(4) + ']');
  P('  Δ(model − b(1−b)) = ' + (bModel - b1mbAll).toFixed(4) + '（规格 §4.2 外生基线口径）');
  P('  Murphy: reliability = ' + mur.reliability.toFixed(4) + ' | resolution = ' + mur.resolution.toFixed(4) + ' | uncertainty = ' + mur.uncertainty.toFixed(4));
  P('  ⇒ 说明：v1 的 model 臂**恒等于 base 臂**（PREREG §4：v1 验管道、不验增量）');
  P('  ⇒ 平凡基线门（A4）：每单元须给 b(1−b)；Δ<0 才算有 resolution，否则**如实报「无增量」**');
  P('');

  // ── A3 分层：horizon × layer × 难度（D2 题 layer 恒为 L3=短窗混沌域；报三档难度）──
  const cells = {};
  for (const r of rows) {
    const k = r.hb + '|' + r.tier;
    if (!cells[k]) cells[k] = [];
    cells[k].push(r);
  }
  P('[A3 分层：horizon × layer × 难度]（layer 恒 L3；**禁跨单元池化**）');
  const cellRows = [];
  for (const k of Object.keys(cells).sort()) {
    const c = cells[k];
    const n = c.length;
    const cb = mean(c.map((r) => r.brier_model));
    const bbar = mean(c.map((r) => r.p_base));
    // b / b(1−b) 是**外生基线**（题面属性，非读数结果）⇒ **所有单元都给**（规格 §4.2 必报列）
    const unit = { cell: k, n, mean_p: mean(c.map((r) => r.p_model)), b: bbar, b_1mb: bbar * (1 - bbar) };
    if (n >= MIN_N) {
      // ★ A3 单元必报列（规格 §4.2）：b / b(1−b) / Brier / Δ=Brier−b(1−b) / resolution / CI
      unit.brier = cb;
      unit.b_const_baserate = mean(c.map((r) => brier(r.p_base, r.y)));
      unit.delta_vs_b1mb = cb - unit.b_1mb;
      unit.murphy = murphy(c.map((r) => r.p_model), c.map((r) => r.y));
      const d = c.map((r) => r.brier_model - brier(0.5, r.y));
      unit.delta_vs_half = mean(d); unit.ci95 = bootCI(d, B, SEED);
      unit.conclusion_allowed = true;
    } else {
      // A5：n<30 ⇒ **只记方向**，不得给 Brier/Δ（防被误当读数引用；照分域读数同款纪律）
      unit.conclusion_allowed = false;
      unit.note = 'n=' + n + ' < ' + MIN_N + ' ⇒ 样本不足·仅记方向（A5）；**不出 Brier/Δ**';
    }
    cellRows.push(unit);
    P('  ' + k.padEnd(14) + ' n=' + String(n).padStart(4) + (unit.conclusion_allowed
      ? ('  b=' + bbar.toFixed(4) + '  b(1−b)=' + unit.b_1mb.toFixed(4) + '  Brier=' + cb.toFixed(4)
        + '  Δ(vs b(1−b))=' + unit.delta_vs_b1mb.toFixed(4) + '  Δ(vs 0.5)=' + unit.delta_vs_half.toFixed(4)
        + '  CI=[' + unit.ci95.lb.toFixed(4) + ',' + unit.ci95.ub.toFixed(4) + ']')
      : '  （样本不足·仅记方向）'));
  }
  P('');

  // ── K2：平凡基线对照（常数预测器 Brier 应 ≈ b(1−b)）──
  const sdY = sd(ys);
  const k2tol = Math.max(0.01, 1.96 * (sdY === null ? 0 : sdY) / Math.sqrt(rows.length));
  const k2diff = Math.abs(bBaseRate - mean(rows.map((r) => r.p_base * (1 - r.p_base))));
  P('[K2 平凡基线对照] 常数预测器 Brier 应 ≈ b(1−b)');
  P('  实测 Brier(常数基率) = ' + bBaseRate.toFixed(4) + ' | mean b(1−b) = ' + mean(rows.map((r) => r.p_base * (1 - r.p_base))).toFixed(4) + ' | 差 = ' + k2diff.toFixed(6));
  P('  容差 = max(0.01, 1.96·sd/√n) = ' + k2tol.toFixed(4) + ' ⇒ K2 ' + (k2diff <= k2tol ? 'PASS' : '**FAIL（管道有 bug）**'));
  P('');

  // ── K3：真值置换（分数应显著变化 ⇒ 键控正常）──
  let s3 = SEED >>> 0; const rnd3 = () => { s3 = (1664525 * s3 + 1013904223) >>> 0; return s3 / 4294967296; };
  const permY = ys.slice();
  for (let i = permY.length - 1; i > 0; i--) { const j = Math.floor(rnd3() * (i + 1)); const t = permY[i]; permY[i] = permY[j]; permY[j] = t; }
  const bPerm = mean(ps.map((p, i) => brier(p, permY[i])));
  const k3delta = Math.abs(bPerm - bModel);
  P('[K3 真值置换] 打乱 y 后 Brier 应显著变化（否则分数不依赖真值＝管道故障）');
  P('  原 Brier = ' + bModel.toFixed(4) + ' | 置换后 = ' + bPerm.toFixed(4) + ' | 差 = ' + k3delta.toFixed(4));
  P('  K3 ' + (k3delta > 1e-6 ? 'PASS（键控正常）' : '**FAIL（分数不依赖真值）**'));
  P('');

  // ── A1 量 ──
  const byCity = {}, byMonth = {}, byVar = {}, byH = {}, byTier = {};
  for (const r of rows) { byCity[r.city] = (byCity[r.city] || 0) + 1; byMonth[r.month] = (byMonth[r.month] || 0) + 1; byVar[r.var_name] = (byVar[r.var_name] || 0) + 1; byH[r.hb] = (byH[r.hb] || 0) + 1; byTier[r.tier] = (byTier[r.tier] || 0) + 1; }
  const a1 = {
    n: rows.length, ge_200: rows.length >= 200, le_500: rows.length <= 500,
    cities: Object.keys(byCity).length, ge_3_cities: Object.keys(byCity).length >= 3,
    months: Object.keys(byMonth).length, ge_12_months: Object.keys(byMonth).length >= 12,
    horizons: Object.keys(byH), ge_2_horizons: Object.keys(byH).length >= 2,
  };
  P('[A1 量] n=' + rows.length + '（≥200 ' + (a1.ge_200 ? '✓' : '✗') + '／≤500 ' + (a1.le_500 ? '✓' : '✗') + '）'
    + ' | 城 ' + a1.cities + '（≥3 ' + (a1.ge_3_cities ? '✓' : '✗') + '）'
    + ' | 月 ' + a1.months + '（≥12 ' + (a1.ge_12_months ? '✓' : '✗') + '）'
    + ' | horizon 档 ' + a1.horizons.join('/') + '（≥2 ' + (a1.ge_2_horizons ? '✓' : '✗') + '）');
  P('  按城 = ' + JSON.stringify(byCity));
  P('  按 horizon = ' + JSON.stringify(byH));
  P('  按难度 = ' + JSON.stringify(byTier) + '  ⚠「极」档恒 0（与基率域数学互斥，勘误 D2-D）');
  P('');

  // ── A2 泄漏自检（六项）──
  const leak = {
    k1_pass: k1.pass,
    src_scan: null, cutoff_check: null, schema_check: null, sample_recheck: null,
  };
  // ② 源码扫描（本脚本自身不得出现真值表名）
  const selfSrc = fs.readFileSync(__filename, 'utf8');
  const truthHits = (selfSrc.match(/truth_vault/g) || []).length;
  leak.src_scan = { truth_vault_mentions: truthHits, note: '本脚本仅在 K1 断言中按名字探测（预期失败），非读取真值；生产库路径 p1a.db 出现 ' + ((selfSrc.match(/p1a\.db/g) || []).length) + ' 次' };
  // ③ 时点扫描：所有 cutoff 必须早于事件日
  const badCut = rows.filter((r) => !(r.question_date < r.event_date));
  leak.cutoff_check = { violations: badCut.length, pass: badCut.length === 0 };
  // ④ 题面库 schema 断言
  try {
    const db2 = new DatabaseSync(SURFACE, { readOnly: true });
    const cols = db2.prepare('PRAGMA table_info(predictions_public)').all().map((c) => c.name);
    db2.close();
    const bad = cols.filter((c) => ['outcome', 'truth_preview', 'resolve_note'].indexOf(c) >= 0);
    leak.schema_check = { columns: cols.length, leaked: bad, pass: bad.length === 0 };
  } catch (e) { leak.schema_check = { error: e.message, pass: false }; }
  // ⑤ 抽样 10% 复算 cutoff
  let s5 = SEED >>> 0; const rnd5 = () => { s5 = (1664525 * s5 + 1013904223) >>> 0; return s5 / 4294967296; };
  const sample = rows.slice().sort(() => rnd5() - 0.5).slice(0, Math.ceil(rows.length * 0.1));
  const sampleBad = sample.filter((r) => !(r.cutoff_at < r.event_date + 'T00:00'));
  leak.sample_recheck = { sampled: sample.length, violations: sampleBad.length, pass: sampleBad.length === 0 };
  const leakRate = (badCut.length + sampleBad.length) / rows.length;
  P('[A2 泄漏自检] 泄漏率 = ' + leakRate + '（要求 0）');
  P('  ① K1 三层断言 = ' + (k1.pass ? 'PASS' : 'FAIL'));
  P('  ② 源码扫描 = ' + JSON.stringify(leak.src_scan));
  P('  ③ cutoff 时点扫描 = ' + JSON.stringify(leak.cutoff_check));
  P('  ④ 题面库 schema = ' + JSON.stringify(leak.schema_check));
  P('  ⑤ 10% 抽样复算 = ' + JSON.stringify(leak.sample_recheck));
  P('  ⇒ A2 ' + (k1.pass && badCut.length === 0 && leak.schema_check.pass && sampleBad.length === 0 ? 'PASS' : '**FAIL ⇒ 整批作废**'));
  P('');

  // ── A5/A6/A7 ──
  const thinCells = cellRows.filter((c) => !c.conclusion_allowed).length;
  P('[A5 样本门] 单元总数 ' + cellRows.length + '，其中 n<' + MIN_N + ' 的 ' + thinCells + ' 个只标方向 ⇒ ' + (thinCells > 0 ? '遵守（禁外推）' : '全单元可出结论'));
  P('[A6 标注] 本报告恒挂「**历史回测·非实时能力**」；前缀【回测】⇒ 机检项见下');
  P('[A7 复现] 跑批命令 = node p1b/scripts/d2-run-backtest.cjs；题面指纹 = ' + String(art.question_fingerprint_sha256).slice(0, 16) + '…');
  P('');
  P('[K4 无增量即止] v1 的 model ≡ base ⇒ Δ 结构性 = 0 ⇒ **如实报「本域无增量（resolution≈0）」**，不扩量、不换口径重试（规格 §7 K4：这是**允许的负结果**）');
  P('');
  P('注: **本报告为历史回测，不构成实时预测能力证据**；不得计入 G2 月 resolve 吞吐；不得引用为 PREREG 判据达成证据。');
  P('注: 本批**未做 HB 部分池化**（规格 §11.5 要求先预注册；HB 另立 `PREREG-D2-HB-v1`）；n<' + MIN_N + ' 单元仅记方向。');
  P('注: 难度覆盖 3/4 档——「极」档与基率域 (0.15,0.85) **数学互斥**（勘误 D2-D）。');
  P('注: 本脚本**未打开生产库**（零账本写）；只读影子题面库 `' + path.basename(SURFACE) + '`。');
  P('');
  P('[未覆盖与不可外推]（规格 §5 必含节）');
  P('  · **horizon：三档齐备**（short ≤7／mid 8–30／**long >30**）——v1.2 勘误 D2-E 后 HORIZONS={1,3,7,14,30,45,60}；');
  P('    **构造性限制**：长档题只覆盖 2024-02-14 之后的月份（1 月无长档，因出题日会被挤出基率窗）——不得外推到「全年长档」。');
  P('  · **难度：未覆盖「极」档**——与基率域 (0.15,0.85) 数学互斥（勘误 D2-D，已证明）。');
  P('  · **域：仅天气（openmeteo archive 6 变量）**——非全域；不得外推到其他域。');
  P('  · **层：仅 L3**（短窗混沌）——本引擎 v1 不覆盖 L1/L2/L5/L6。');
  P('  · **无增量**：model ≡ base（PREREG §4）⇒ 本批**不构成**任何「模型优于基率」的证据。');

  const report = {
    script: 'p1b/scripts/d2-run-backtest.cjs',
    prereg: art.prereg, prereg_sha256: PREREG_SHA,
    prereg_v11: art.prereg_v11 || null,
    question_fingerprint_sha256: art.question_fingerprint_sha256,
    generated_at: new Date().toISOString(),
    honesty: '【回测】本报告为历史回测，非实时能力证据；不得计入 G2 月 resolve 吞吐；不得引用为任何 PREREG 判据达成证据',
    n: rows.length,
    overall: { mean_p: mean(ps), obs_rate: mean(ys), brier_model: bModel, brier_const_half: bConstHalf, brier_const_baserate: bBaseRate, b_1mb_mean: b1mbAll, delta_vs_half: bModel - bConstHalf, delta_vs_b1mb: bModel - b1mbAll, ci95: ci, murphy: mur },
    by_cell: cellRows,
    a1: a1, by_city: byCity, by_horizon: byH, by_tier: byTier, by_var: byVar, by_month: byMonth,
    kill_tests: { K1: k1, K2: { diff: k2diff, tol: k2tol, pass: k2diff <= k2tol }, K3: { delta: k3delta, pass: k3delta > 1e-6 }, K4: '无增量＝允许的负结果（v1 model ≡ base）' },
    leak_selfcheck: Object.assign({}, leak, { leak_rate: leakRate }),
    hb_note: '本批未做 HB 部分池化（规格 §11.5 要求先预注册）；HB 另立 PREREG-D2-HB-v1',
    difficulty_note: '难度覆盖 3/4 档；「极」档与基率域 (0.15,0.85) 数学互斥（勘误 D2-D）',
    isolation_note: '只读影子题面库；未打开生产库；零账本写',
    rows: rows,
  };
  fs.writeFileSync(OUTFILE, JSON.stringify(report, null, 1), 'utf8');
  fs.writeFileSync(OUTFILE.replace(/\.json$/, '.txt'), T.join('\n') + '\n', 'utf8');
  P('');
  P('产物 = ' + OUTFILE);
  P('用时 = ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
