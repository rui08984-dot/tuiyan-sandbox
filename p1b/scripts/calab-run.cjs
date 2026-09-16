#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/calab-run.cjs —— P0-U5 · 校准器离线 A/B 协议（2026-09-16）
 *
 * 依据：【13】§二 U5（协议照 `11-拒绝项救援-深度报告.md` §⑦ v1.1 逐条）。
 * 纪律：**零 LLM、零网络、零写库**（库只读 readOnly；本脚本无任何写库参数/路径）。
 *
 * 口径（报告头硬印）：
 *   「重放计分（读侧），账本 gate=descriptive 未计分；baseline_brier 列从未写入」
 *   · 对照臂＝**恒等映射**＝现役口径（l3-aci.test.cjs 锁死「ACI 只调区间不调 p」⇒ Brier 意义下现役即不映射，
 *     不冒充「ACI 校准了 p」）。
 *   · 挑战者臂＝beta calibration（**唯一**做非劣检验的主挑战者）；Platt＝参照；PAVA 等渗＝第二挑战者（只描述不检验）。
 *   · 主口径＝D2 式重放（L2/L3 已解行，引擎 p 由 l2_baseline/l3_aci 重放）；
 *     副口径＝verdicts 代理（**题级**聚合 p，全部 L1/L6 层——与主口径不同层，只作代理不载判据）。
 *   · **题级块 bootstrap**：重采样单位＝题（不是判词行）——verdicts 行级聚簇曾使有效样本虚高 3.3 倍（4766 行 vs 450 独立题），
 *     本脚本把这条教训写进实现：见 `pairedBlockBootstrap`。
 *   · 评估形态＝walk-forward 滚动起点（created_at 排序切窗、前窗拟合后窗评估），**禁随机切分**；
 *     窗内有效题 <50 合并相邻窗并披露；全池题级 n<100 整案降级探索性。
 *   · 判据＝ΔBrier(beta − identity) 的题级配对 95%CI **上界 ≤ +0.005** ∧ resolution 不降。
 *     bootstrap 口径照 stage4-run.cjs `bootDeltaCI`：B=1000、seed=987654321、LCG 1664525/1013904223、百分位法
 *     （唯重采样单位改题块——本口径下"题"即块）。
 *   · 多重比较控制：一次只赌 beta（Platt/等渗仅描述）。
 *   · 先验预期声明（防事后解释，【11】§⑦原文收编）：等渗预期输（Kull 2017 摘要明言小样本过拟合；项目内 AIA 表 E 同向）；
 *     **等渗若意外赢，先查聚类 bootstrap 实现再庆祝。**
 *
 * 用法（只读；零写库）：
 *   node p1b/scripts/calab-run.cjs [--db <path>] [--out-dir <dir>]
 * 产出：<out-dir>/calab-report-YYYYMMDD.json + .md（默认 p1b/sim/out）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }

const cal = require(path.join(ROOT, 'p1b/src/calibration'));
const { l2Baseline, parseBaseRateNote } = require(path.join(ROOT, 'p1b/src/engines/l2_baseline'));
const { l3Aci } = require(path.join(ROOT, 'p1b/src/engines/l3_aci'));
const baseRateMod = require(path.join(ROOT, 'p1b/src/evidence/baseRate'));
const truthBasisMod = require(path.join(ROOT, 'p1b/src/evidence/truthBasis'));

const MIN_N_JUDGE = 100;      // 全池题级 n<100 ⇒ 整案降级探索性
const MIN_WINDOW = 50;        // 窗内有效题 <50 ⇒ 合并相邻窗
const NON_INFERIOR_UB = 0.005;

function yOf(outcome) { const s = String(outcome).toLowerCase(); return (s === 'true' || s === '1') ? 1 : ((s === 'false' || s === '0') ? 0 : null); }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function brier(p, y) { return (p - y) * (p - y); }
function logLoss(p, y) { const q = cal.clampProb(p); return -(y * Math.log(q) + (1 - y) * Math.log(1 - q)); }
function clampProb(p) { return cal.clampProb(p); }

/** Murphy resolution（10 桶离散 plugin 版）：RES = Σ (n_j/N)(ō_j − ō)² */
function murphyResolution(ps, ys, bins) {
  const NB = bins || 10; const N = ps.length;
  if (!N) return null;
  const obar = mean(ys);
  const b = []; for (let i = 0; i < NB; i++) b.push({ n: 0, s: 0 });
  for (let i = 0; i < N; i++) { const j = Math.min(NB - 1, Math.max(0, Math.floor(ps[i] * NB))); b[j].n++; b[j].s += ys[i]; }
  let res = 0;
  for (const x of b) { if (!x.n) continue; const o = x.s / x.n; res += (x.n / N) * (o - obar) * (o - obar); }
  return res;
}
/** reliability 10 桶表（披露用） */
function reliability(ps, ys) {
  const NB = 10; const out = [];
  const b = []; for (let i = 0; i < NB; i++) b.push({ n: 0, sp: 0, sy: 0 });
  for (let i = 0; i < ps.length; i++) { const j = Math.min(NB - 1, Math.max(0, Math.floor(ps[i] * NB))); b[j].n++; b[j].sp += ps[i]; b[j].sy += ys[i]; }
  for (let i = 0; i < NB; i++) out.push({ lo: i / NB, hi: (i + 1) / NB, n: b[i].n, mean_p: b[i].n ? b[i].sp / b[i].n : null, obs_rate: b[i].n ? b[i].sy / b[i].n : null });
  return out;
}

/** 题级配对块 bootstrap（单位＝题；LCG 口径照 stage4 bootDeltaCI：B=1000/seed=987654321） */
function pairedBlockBootstrap(diffs, B, seed) {
  const n = diffs.length; if (!n) return { lb: null, ub: null, B: B, seed: seed, mean: null };
  let s = seed >>> 0; const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const means = [];
  for (let b = 0; b < B; b++) { let acc = 0; for (let i = 0; i < n; i++) acc += diffs[Math.floor(rnd() * n)]; means.push(acc / n); }
  means.sort((x, y) => x - y);
  return { lb: means[Math.floor(0.025 * B)], ub: means[Math.floor(0.975 * B)], B: B, seed: seed, mean: mean(diffs) };
}

/**
 * 评估器（纯函数；U5 测试直接调用）。
 * @param items [{id, t, p, y}]   t=created_at（排序键）, p=原始概率, y∈{0,1}
 * @returns {n, folds, windows, arms, delta_beta_vs_identity, judgement, exploratory}
 */
function evaluateArms(items, opts) {
  const o = Object.assign({ k: 5, minWindow: MIN_WINDOW, B: 1000, seed: 987654321 }, opts || {});
  const sorted = items.slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : (a.id - b.id)));
  const n = sorted.length;
  // 初始等分切窗（按 created_at 序）；窗内有效题 <minWindow ⇒ 向后合并（并披露）
  const k = Math.max(2, Math.min(o.k, n));
  let folds = [];
  for (let i = 0; i < k; i++) folds.push(sorted.slice(Math.floor(i * n / k), Math.floor((i + 1) * n / k)));
  const merged = []; let cur = [];
  for (const f of folds) { cur = cur.concat(f); if (cur.length >= o.minWindow) { merged.push(cur); cur = []; } }
  if (cur.length) merged.push(cur);   // 末窗保留为独立评估窗（小窗如实披露，不并入训练窗——并入会吃掉一个评估窗）
  // walk-forward：前窗拟合、后窗评估（expanding）
  const preds = { identity: [], beta: [], platt: [], isotonic: [] };
  const ysEval = [];
  const windowLog = [];
  for (let wi = 1; wi < merged.length; wi++) {
    const train = []; for (let j = 0; j < wi; j++) train.push.apply(train, merged[j]);
    const test = merged[wi];
    const xs = train.map((r) => r.p); const yy = train.map((r) => r.y);
    const mBeta = cal.betaCalibration.fit(xs, yy);
    const mPlatt = cal.platt.fit(xs, yy);
    const mIso = cal.isotonic.fit(xs, yy);
    for (const r of test) {
      preds.identity.push(clampProb(r.p));
      preds.beta.push(clampProb(mBeta.predict(r.p)));
      preds.platt.push(clampProb(mPlatt.predict(r.p)));
      preds.isotonic.push(clampProb(mIso.predict(r.p)));
      ysEval.push(r.y);
    }
    windowLog.push({ window: wi, train_n: train.length, test_n: test.length,
      beta: { a: mBeta.a, b: mBeta.b, c: mBeta.c }, platt: { a: mPlatt.a, b: mPlatt.b }, isotonic_k: mIso.k });
  }
  const arms = {};
  for (const name of Object.keys(preds)) {
    const ps = preds[name];
    arms[name] = { n: ps.length, brier: mean(ps.map((p, i) => brier(p, ysEval[i]))),
      logloss: mean(ps.map((p, i) => logLoss(p, ysEval[i]))), resolution: murphyResolution(ps, ysEval),
      reliability: reliability(ps, ysEval) };
  }
  const diffs = preds.beta.map((p, i) => brier(p, ysEval[i]) - brier(preds.identity[i], ysEval[i]));
  const ci = pairedBlockBootstrap(diffs, o.B, o.seed);
  const judgement = {
    metric: 'ΔBrier(beta − identity)，题级配对块 bootstrap 95%CI（百分位法）',
    delta_brier: ci.mean, ci95: { lb: ci.lb, ub: ci.ub }, B: ci.B, seed: ci.seed,
    non_inferior_ub: NON_INFERIOR_UB,
    non_inferior: ci.ub !== null && ci.ub <= NON_INFERIOR_UB,
    resolution_not_lower: arms.beta.resolution >= arms.identity.resolution - 1e-12,
    verdict: null,
  };
  judgement.verdict = (judgement.non_inferior && judgement.resolution_not_lower)
    ? 'beta 非劣（版本递进替换候选；替换动作属 P1，P0 只出报告）'
    : (judgement.non_inferior ? 'beta 非劣但 resolution 下降 ⇒ 不替换' : '未达非劣界 ⇒ 维持恒等（现役不动）');
  return { n: n, folds: merged.map((f) => f.length), windows: windowLog, arms: arms,
    delta_beta_vs_identity: ci, judgement: judgement, exploratory: n < MIN_N_JUDGE };
}

// ── 主流程（只有直接执行才跑；测试 require 时不被触发）──
function main() {
  const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
  const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });     // 只读：零写库的第一个保证
  const all = (s) => db.prepare(s).all();
  const REGIME = "p.g2_regime = 'R4'";
  const NOT_TB = truthBasisMod.NOT_TRUTH_BASIS_DEFECT_SQL();

  // L3 ACI 反馈序列（照 stage4：已解 L3 按 id 时序全局回放；只影响 α，不改 p）
  const fbRows = all('SELECT p.id, p.outcome, '
    + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
    + "(SELECT json_extract(e.value,'$.baseRate') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRate') IS NOT NULL LIMIT 1) AS brs "
    + 'FROM predictions p WHERE ' + REGIME + " AND p.layer='L3' AND p.outcome IS NOT NULL ORDER BY p.id");
  const feedback = [];
  for (const r of fbRows) {
    let struct = null; try { struct = r.brs ? JSON.parse(r.brs) : null; } catch (e) { struct = null; }
    if (struct && baseRateMod.isStructured(struct) && struct.n !== null && struct.k !== null) { feedback.push({ p: struct.p, y: yOf(r.outcome) }); continue; }
    const parsed = parseBaseRateNote(String(r.brn || ''));
    if (parsed) feedback.push({ p: parsed.p, y: yOf(r.outcome) });
  }

  // 主口径：D2 式重放（L2/L3 已解行；引擎 p 重放）
  const rows = all('SELECT p.id, p.layer, p.outcome, p.created_at, '
    + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
    + "(SELECT json_extract(e.value,'$.baseRate') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRate') IS NOT NULL LIMIT 1) AS brs "
    + 'FROM predictions p WHERE ' + REGIME + ' AND ' + NOT_TB + " AND p.layer IN ('L2','L3') AND p.outcome IS NOT NULL ORDER BY p.created_at, p.id");
  const mainItems = []; const engineFail = {};
  for (const r of rows) {
    let struct = null; try { struct = r.brs ? JSON.parse(r.brs) : null; } catch (e) { struct = null; }
    const out = (r.layer === 'L2') ? l2Baseline({ baseRate: struct, baseRateNote: r.brn })
      : l3Aci({ baseRate: struct, baseRateNote: r.brn, feedback: feedback });
    if (!out.ok || typeof out.p !== 'number') { engineFail[out.status || 'unknown'] = (engineFail[out.status || 'unknown'] || 0) + 1; continue; }
    const y = yOf(r.outcome); if (y === null) continue;
    mainItems.push({ id: r.id, t: String(r.created_at), p: out.p, y: y, layer: r.layer });
  }

  // 副口径：verdicts 代理（题级聚合：prediction_id 上均值 implied_prob；层=判词覆盖层）
  const vRows = all('SELECT v.prediction_id AS id, AVG(v.implied_prob) AS p, COUNT(*) AS k, MIN(p.created_at) AS t, p.outcome AS outcome, p.layer AS layer '
    + 'FROM verdicts v JOIN predictions p ON p.id = v.prediction_id '
    + 'WHERE v.implied_prob IS NOT NULL GROUP BY v.prediction_id ORDER BY t, id');
  const proxyItems = []; const proxyLayer = {};
  for (const r of vRows) {
    const y = yOf(r.outcome); if (y === null) continue;
    const p = clampProb(r.p);
    proxyItems.push({ id: r.id, t: String(r.t), p: p, y: y });
    proxyLayer[r.layer] = (proxyLayer[r.layer] || 0) + 1;
  }
  db.close();

  const MAIN = evaluateArms(mainItems);
  const PROXY = evaluateArms(proxyItems);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const report = {
    script: 'p1b/scripts/calab-run.cjs', protocol: '11 §⑦ v1.1', db: DB_PATH,
    header: '重放计分（读侧），账本 gate=descriptive 未计分；baseline_brier 列从未写入',
    warning_cluster: 'verdicts 行级聚簇曾使有效样本虚高 3.3 倍（4766 行 vs 450 独立题）⇒ 本脚本重采样单位＝题（题级块）',
    prior_expectation: '等渗预期输（Kull 2017 小样本过拟合；AIA 表 E 同向）；等渗若意外赢，先查聚类 bootstrap 实现再庆祝',
    multiple_comparison: '一次只赌 beta（Platt/等渗仅描述）',
    main_cohort: { kind: 'D2 式重放（L2/L3 已解行，引擎 p 重放）', rows_in_domain: rows.length, engine_ok: mainItems.length,
      engine_fail: engineFail, layer_counts: mainItems.reduce((a, x) => (a[x.layer] = (a[x.layer] || 0) + 1, a), {}) },
    proxy_cohort: { kind: 'verdicts 代理（题级均值 implied_prob）', items_with_verdicts: vRows.length, scored: proxyItems.length, layer_counts: proxyLayer,
      note: '层语义与主口径不同（代理层=判词覆盖层），只作代理不载判据' },
    evaluation: { form: 'walk-forward 滚动起点（禁随机切分）', min_window: MIN_WINDOW, min_n_judge: MIN_N_JUDGE },
    main: MAIN, proxy: PROXY,
    generated_at: new Date().toISOString(),
  };

  const md = [];
  md.push('# 校准器离线 A/B 报告（P0-U5 · ' + today + '）');
  md.push('');
  md.push('> **' + report.header + '**');
  md.push('> 协议：' + report.protocol + '；' + report.evaluation.form + '（窗内有效题<' + MIN_WINDOW + ' 合并披露）。');
  md.push('> 聚类警告：' + report.warning_cluster);
  md.push('> 先验预期：' + report.prior_expectation + '；多重比较：' + report.multiple_comparison + '。');
  md.push('');
  md.push('## 主口径（' + report.main_cohort.kind + '）');
  md.push('- 行域 ' + report.main_cohort.rows_in_domain + ' → 引擎出数 ' + report.main_cohort.engine_ok + '（fail ' + JSON.stringify(engineFail) + '）；层分布 ' + JSON.stringify(report.main_cohort.layer_counts));
  md.push('- 题级 n=' + MAIN.n + '；切窗 ' + JSON.stringify(MAIN.folds) + (MAIN.exploratory ? '；**探索性（n<100）**' : ''));
  md.push('');
  md.push('| 臂 | Brier | log loss | resolution |');
  md.push('|---|---|---|---|');
  for (const name of ['identity', 'beta', 'platt', 'isotonic']) {
    const a = MAIN.arms[name];
    md.push('| ' + name + ' | ' + (a.brier === null ? 'n/a' : a.brier.toFixed(4)) + ' | ' + (a.logloss === null ? 'n/a' : a.logloss.toFixed(4)) + ' | ' + (a.resolution === null ? 'n/a' : a.resolution.toFixed(4)) + ' |');
  }
  md.push('');
  const J = MAIN.judgement;
  md.push('**判据（beta vs identity）**：ΔBrier=' + (J.delta_brier === null ? 'n/a' : J.delta_brier.toFixed(4))
    + '，CI=[' + (J.ci95.lb === null ? 'n/a' : J.ci95.lb.toFixed(4)) + ',' + (J.ci95.ub === null ? 'n/a' : J.ci95.ub.toFixed(4)) + ']'
    + '（B=' + J.B + '，seed=' + J.seed + '，题级配对块）⇒ 非劣界 +' + NON_INFERIOR_UB + '：' + (J.non_inferior ? '达' : '未达')
    + '；resolution 不降：' + (J.resolution_not_lower ? '是' : '否') + ' ⇒ **' + J.verdict + '**');
  md.push('');
  md.push('## 副口径（' + report.proxy_cohort.kind + '）');
  md.push('- 带判词题 ' + report.proxy_cohort.items_with_verdicts + ' → 可计分 ' + report.proxy_cohort.scored + '（层分布 ' + JSON.stringify(report.proxy_cohort.layer_counts) + '；' + report.proxy_cohort.note + '）');
  md.push('- 题级 n=' + PROXY.n + '；切窗 ' + JSON.stringify(PROXY.folds) + '；ΔBrier(beta−identity)=' + (PROXY.delta_beta_vs_identity.mean === null ? 'n/a' : PROXY.delta_beta_vs_identity.mean.toFixed(4))
    + ' CI=[' + (PROXY.delta_beta_vs_identity.lb === null ? 'n/a' : PROXY.delta_beta_vs_identity.lb.toFixed(4)) + ',' + (PROXY.delta_beta_vs_identity.ub === null ? 'n/a' : PROXY.delta_beta_vs_identity.ub.toFixed(4)) + ']（**描述性，不载判据**）');
  md.push('');
  md.push('## 逐窗拟合（主口径）');
  for (const w of MAIN.windows) md.push('- 窗 ' + w.window + '：train ' + w.train_n + ' / test ' + w.test_n + '；beta(a=' + w.beta.a.toFixed(3) + ',b=' + w.beta.b.toFixed(3) + ',c=' + w.beta.c.toFixed(3) + ')；platt(a=' + w.platt.a.toFixed(3) + ',b=' + w.platt.b.toFixed(3) + ')；等渗块 k=' + w.isotonic_k);
  md.push('');
  md.push('（零 LLM／零网络／零写库；库只读。P0 只出报告——替换动作属 P1。）');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jf = path.join(OUT_DIR, 'calab-report-' + today + '.json');
  const mf = path.join(OUT_DIR, 'calab-report-' + today + '.md');
  fs.writeFileSync(jf, JSON.stringify(report, null, 1), 'utf8');
  fs.writeFileSync(mf, md.join('\n') + '\n', 'utf8');
  console.log('=== calab-run（P0-U5）===');
  console.log(report.header);
  console.log('主口径 n=' + MAIN.n + '（' + JSON.stringify(MAIN.folds) + '）｜ 副口径 n=' + PROXY.n + (PROXY.exploratory ? '（探索性）' : ''));
  console.log('ΔBrier(beta−identity)=' + (J.delta_brier === null ? 'n/a' : J.delta_brier.toFixed(4)) + ' CI=[' + (J.ci95.lb === null ? 'n/a' : J.ci95.lb.toFixed(4)) + ',' + (J.ci95.ub === null ? 'n/a' : J.ci95.ub.toFixed(4)) + '] ⇒ ' + J.verdict);
  console.log('json -> ' + jf);
  console.log('md   -> ' + mf);
  return 0;
}

module.exports = { evaluateArms: evaluateArms, pairedBlockBootstrap: pairedBlockBootstrap, murphyResolution: murphyResolution, reliability: reliability };
if (require.main === module) { process.exitCode = main(); }
