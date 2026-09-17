#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/calibration-report.cjs —— P0-U8 · 分域格校准报告（2026-09-16）
 *
 * 依据：【13】§二 U8。原则：**零引擎重跑、零新评分路径**——只呈现 stage4 读数件里的现成列，
 *   加上 U2 的贝叶斯语义标注、限定语块、防泄漏声明与口径边界明文。
 * 纪律：只读（读 sim/out 的 JSON 件；缺件标 n/a 不编数）；零写库；文案过禁词黑名单（铁律②）。
 * 用法：node p1b/scripts/calibration-report.cjs [--stage4 <path>] [--g2 <path>] [--out-dir <dir>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }

const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
// latestByPattern（board.cjs L21-27 同款；照【13】U8 原文"不新建公共模块以免动 board"）
function latestByPattern(dir, re, fallback) {
  try { const c = fs.readdirSync(dir).filter((f) => re.test(f)).sort(); if (c.length) return path.join(dir, c[c.length - 1]); } catch (e) { /* ignore */ }
  return path.join(dir, fallback);
}
const S4 = arg('stage4', latestByPattern(OUT_DIR, /^stage4-run-five-layers-\d{8}\.json$/, 'stage4-run-five-layers-20260914.json'));
const G2 = arg('g2', latestByPattern(OUT_DIR, /^g2-report-latest-\d{8}\.json$/, 'g2-report-latest-20260914.json'));

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
const s4 = readJson(S4);
const g2 = readJson(G2);

const L = []; const json = {
  script: 'p1b/scripts/calibration-report.cjs', title: '分域格校准报告',
  stage4_file: S4, g2_file: G2, stage4_present: !!s4, g2_present: !!g2,
  qualification_block: [
    '重放计分（读侧）：本报告数字来自引擎重放，账本 gate=descriptive 未计分；baseline_brier 列从未写入。',
    '过程能力门（G2）不含质量读数（门定性恒挂限定语）；对外表述一律挂限定语。',
    'n<30 的格只记方向、不出结论；格间禁池化。',
  ],
  leakage_statement: null, bayes_semantics: null, cells: [], generated_at: new Date().toISOString(),
};
L.push('# 分域格校准报告（' + new Date().toISOString().slice(0, 10) + '）');
L.push('');
L.push('> 只呈现既有读数件的现成列（零新算）；缺件标 n/a 不编数。');
L.push('');

// ③ 限定语块
L.push('## 限定语块');
for (const q of json.qualification_block) L.push('- ' + q);
L.push('');

// ④ 防泄漏声明（引 stage4 的真值口径排除计数）
if (s4) {
  const ex = s4.truth_basis_defect_excluded_rows;
  const fp = s4.truth_basis_defect_fingerprint ? String(s4.truth_basis_defect_fingerprint).slice(0, 16) + '…' : 'n/a';
  json.leakage_statement = { excluded_rows: ex !== undefined ? ex : null, fingerprint: fp,
    text: '每题 cutoff 合规由管线与真值口径排除保证：已排除真值口径缺陷行 ' + (ex !== undefined ? ex : 'n/a') + '（resolved_at<事件日 ∧ resolve 含 forecast；指纹 ' + fp + '）。' };
  L.push('## 防泄漏声明');
  L.push('- ' + json.leakage_statement.text);
  L.push('');
} else {
  json.leakage_statement = { excluded_rows: null, fingerprint: null, text: 'n/a（缺 stage4 读数件）' };
  L.push('## 防泄漏声明');
  L.push('- n/a（缺 stage4 读数件：' + S4 + '）');
  L.push('');
}

// ② 五层贝叶斯语义标注（读 U2 的 bayes_semantics；缺件 n/a）
if (s4 && s4.report) {
  json.bayes_semantics = {};
  L.push('## 五层贝叶斯语义（记账语言）');
  for (const layer of Object.keys(s4.report).sort()) {
    const bs = s4.report[layer].bayes_semantics;
    json.bayes_semantics[layer] = bs || null;
    L.push('- ' + layer + '：' + (bs ? bs.role + '（' + bs.note + '）' : 'n/a（读数件无此键——旧件）'));
  }
  if (s4.bayes_legend) L.push('- 词汇源：' + s4.bayes_legend.source);
  L.push('');
} else {
  L.push('## 五层贝叶斯语义（记账语言）');
  L.push('- n/a（缺 stage4 读数件）');
  L.push('');
}

// ① 分域格校准表（直接呈现 by_domain 现成列）
if (s4 && Array.isArray(s4.by_domain)) {
  json.cells = s4.by_domain.map((d) => ({
    layer: d.layer, domain: d.domain, scored_n: d.scored_n, conclusion_allowed: !!d.conclusion_allowed,
    mean_p: d.mean_p !== undefined ? d.mean_p : null, obs_rate: d.obs_rate !== undefined ? d.obs_rate : null,
    brier_engine: d.brier_engine !== undefined ? d.brier_engine : null,
    delta_vs_half: d.delta_vs_half !== undefined ? d.delta_vs_half : null,
    delta_ci95: d.delta_ci95 || null,
  }));
  json.cells_total = json.cells.length;
  json.cells_with_conclusion = json.cells.filter((c) => c.conclusion_allowed).length;
  L.push('## 分域格校准表（' + json.cells_total + ' 格；可出结论 ' + json.cells_with_conclusion + '）');
  L.push('');
  L.push('| 层 | 域 | n | 平均 p | 观测率 | Brier | Δ(vs 0.5) | 95% CI | 结论 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const c of json.cells) {
    const f = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(4);
    const ci = c.delta_ci95 && c.delta_ci95.lb !== null && c.delta_ci95.lb !== undefined ? '[' + f(c.delta_ci95.lb) + ',' + f(c.delta_ci95.ub) + ']' : 'n/a';
    L.push('| ' + c.layer + ' | ' + c.domain + ' | ' + c.scored_n + ' | ' + f(c.mean_p) + ' | ' + f(c.obs_rate) + ' | ' + f(c.brier_engine) + ' | ' + f(c.delta_vs_half) + ' | ' + ci + ' | ' + (c.conclusion_allowed ? '可出结论' : 'n<30 仅方向') + ' |');
  }
  L.push('');
} else {
  json.cells_total = null; json.cells_with_conclusion = null;
  L.push('## 分域格校准表');
  L.push('- n/a（缺 stage4 读数件或缺 by_domain 键）');
  L.push('');
}

// ③b · U8 加列（读侧派生；2026-09-16 P0+）：KL 可预报性 / Murphy 三分解 / prequential
const U8 = latestByPattern(OUT_DIR, /^u8-columns-\d{8}\.json$/, 'u8-columns-20260916.json');
const u8 = readJson(U8);
json.u8_columns_file = U8; json.u8_columns_present = !!u8;
L.push('## U8 加列（读侧派生；只披露不进门控）');
if (u8 && u8.layers) {
  L.push('');
  L.push('| 层 | n | Brier | KL(对基率) | REL | RES | UNC | prequential 终值 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const Lk of ['L2', 'L3', 'L5', 'L6']) {
    const r = u8.layers[Lk]; if (!r) continue;
    const f = (x) => (x === undefined || x === null || !isFinite(x)) ? 'n/a' : Number(x).toFixed(4);
    L.push('| ' + Lk + ' | ' + r.scored_n + ' | ' + (r.brier !== undefined ? f(r.brier) : 'n/a') + ' | ' + (r.kl_to_base !== undefined ? f(r.kl_to_base) : 'n/a')
      + ' | ' + (r.murphy ? f(r.murphy.REL) : 'n/a') + ' | ' + (r.murphy ? f(r.murphy.RES) : 'n/a') + ' | ' + (r.murphy ? f(r.murphy.UNC) : 'n/a')
      + ' | ' + (r.prequential ? f(r.prequential.final) : 'n/a') + ' |');
  }
  L.push('');
  L.push('- 口径：' + u8.kl_definition + '；' + u8.murphy_definition + '；' + u8.prequential_definition + '。');
  L.push('- ' + u8.l1_excluded + '；n<30 的层只报 n（见 `u8-columns-*.json`）。');
} else {
  L.push('- n/a（缺 u8-columns 件：node p1b/scripts/u8-columns.cjs）');
}
L.push('');
// ③c · 滞后集合 3 档秩检验（Watson）——2026-09-17 解锁：逐对件落盘后由「如实 n/a」改为**实读**
//     （源件：`node p1b/scripts/stage5-rank-diagnostic.cjs`；本件仍零引擎重跑、只呈现）
const RANK = latestByPattern(OUT_DIR, /^stage5-rank-diagnostic-\d{8}\.json$/, 'stage5-rank-diagnostic-20260917.json');
const rank = readJson(RANK);
json.lag_rank_test = {
  available: !!(rank && rank.strata), file: RANK,
  reason_unavailable: '逐对件缺失 ⇒ 不编数（复算入口：node p1b/scripts/stage5-rank-diagnostic.cjs）',
  not_a_gate: '体检服不是引擎：不设生死判据、不进任何门控；m=2 ⇒ 3 档秩，功效极低，不得当能力宣称。',
  erratum: rank ? rank.erratum_20260917 : null,
};
L.push('## 滞后集合 3 档秩检验（Watson）');
if (json.lag_rank_test.available) {
  const f4 = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(4);
  json.lag_rank_test.strata = rank.strata;
  json.lag_rank_test.leading_signal = rank.leading_signal;
  L.push('');
  L.push('> ' + json.lag_rank_test.not_a_gate);
  L.push('');
  L.push('| 层 | n | 秩1 | 秩2 | 秩3 | Watson U² | p(U²) | 倾斜 T=n₃−n₁ | p(T) | p(T)<0.10 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const d of rank.strata) {
    L.push('| ' + d.label + ' | ' + d.n + ' | ' + d.hist.r1 + ' | ' + d.hist.r2 + ' | ' + d.hist.r3 + ' | ' + f4(d.watson_u2)
      + ' | ' + f4(d.perm_p_watson) + ' | ' + d.tilt_stat + ' | ' + f4(d.perm_p_tilt) + ' | ' + (d.tilt_sig ? '是' : '否') + ' |');
  }
  L.push('');
  L.push('- 两统计量各答一问：U²＝秩分布是否不平；T＝是否**向同一端**倾斜（先导判据问的那一问）。');
  L.push('- ' + json.lag_rank_test.erratum);
  L.push('- 先导判据（' + rank.leading_signal.rule + '）：**' + (rank.leading_signal.holds ? '成立' : '不成立') + '** ⇒ ' + rank.leading_signal.action + '。');
  L.push('- 逐对件与复算入口：`' + path.basename(RANK) + '`／`stage5-rank-pairs-*.jsonl`／`node p1b/scripts/stage5-rank-diagnostic.cjs`（三零：零账本写／零 LLM／零网络）。');
} else {
  L.push('- n/a：' + json.lag_rank_test.reason_unavailable + '。');
}
L.push('');
// ③d · O7 最大熵注记（先验透明度声明）
json.o7_maxent = { prior: 'Beta(1,1)', statement: '无信息进入时的起点＝均匀分布 Beta(1,1)（最大熵）——引擎在无证据行时的先验不是"拍脑袋的数"，而是熵最大的那个选择；证据行到达后由固定规则聚合改变它。' };
L.push('## O7 最大熵注记（先验透明度声明）');
L.push('- ' + json.o7_maxent.statement);
L.push('');
// ③e · 负结果账本指针（I2 v0）
const NEG = latestByPattern(OUT_DIR, /^negative-results-ledger-\d{8}\.json$/, 'negative-results-ledger-20260916.json');
json.negative_results_ledger = fs.existsSync(NEG) ? NEG : null;
L.push('## 负结果账本（I2 v0 · 对内）');
L.push('- ' + (json.negative_results_ledger ? '最新件：`' + json.negative_results_ledger + '`（每条死假设挂四要素：假设／判据＋sha16／结局／复算入口）' : 'n/a（缺件：node p1b/scripts/negative-results.cjs）'));
L.push('');

// ⑤ 口径边界明文（两个口径不混）
L.push('## 口径边界（两个口径，两不相动）');
L.push('- A｜账本口径：`p1b/src/routes/audit.js` `/api/audit/summary` → `layer_calibration`（读 predictions.assigned_prob）。');
L.push('- B｜引擎重放口径：本报告（读 stage4 读数件；引擎逐题重放出数）。');
L.push('- 两口径数字不可互相搬运；本报告只用 B。g2-report 本体零改动。');
L.push('');
L.push('（零写库 · 只读披露件 · P0 只呈现不新算）');

const md = L.join('\n') + '\n';
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
fs.mkdirSync(OUT_DIR, { recursive: true });
const jf = path.join(OUT_DIR, 'calibration-report-' + today + '.json');
const mf = path.join(OUT_DIR, 'calibration-report-' + today + '.md');
fs.writeFileSync(jf, JSON.stringify(json, null, 1), 'utf8');
fs.writeFileSync(mf, md, 'utf8');
console.log('=== 分域格校准报告（P0-U8）===');
console.log('stage4=' + (json.stage4_present ? 'ok' : 'n/a') + ' 格数=' + json.cells_total + ' 可出结论=' + json.cells_with_conclusion);
console.log('json -> ' + jf);
console.log('md   -> ' + mf);
