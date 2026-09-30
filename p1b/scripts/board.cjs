#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/board.cjs —— 一页看板：门读数 / 采信链 / 五层读数 / 账本计数（任务 6 批次 2 · B1-4）
 *
 * 用法：node p1b/scripts/board.cjs [--text <out.txt>] [--json <out.json>]
 * 只读：读既有读数件（不重跑任何引擎、不写库、不动任何既有文件）；
 *   缺件时如实标 n/a 并提示生成命令（不静默、不编数）。
 */
const fs = require('fs');
const path = require('path');
// deps-fix：better-sqlite3 改多候选解析（源码树 / 上提 app\/node_modules / npm install 三种布局都认），
// 不再假定 node_modules 一定在 p1a-terminal 下面。★只改「怎么找到」，开库那一行一字未动。
const { betterSqlite3 } = require('./_betterSqlite3.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const TEXT_OUT = arg('text', null);
const JSON_OUT = arg('json', null);
const OUT = path.join(ROOT, 'p1b', 'sim', 'out');
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

// ── G2 门（最新报告件；缺 → 提示）──
// 2026-09-15：同五层件，改「自动取最新日期件」（固定名会静默陈旧）。回退历史固定名。
// ★2026-09-21 修（与 calibration-report.cjs 同批）：日期后允许可选小写字母后缀——同日重跑的
//   `…-20260921c.json` 此前被忽略 ⇒ 静默读旧件（实测 board 读 a 版、真实最新是 c 版）。
function latestByPattern(re, fallback) {
  try {
    const cands = fs.readdirSync(OUT).filter((f) => re.test(f)).sort();
    if (cands.length) return path.join(OUT, cands[cands.length - 1]);
  } catch (e) { /* 目录不可读 ⇒ 回退 */ }
  return path.join(OUT, fallback);
}
const G2_FILE = latestByPattern(/^g2-report-latest-(\d{8})([a-z]?)\.json$/, 'g2-report-latest-20260914.json');
const g2 = readJson(G2_FILE);
const G2_HINT = 'node p1b/scripts/g2-report.cjs --audit p1b/sim/out/g2-audit-r4.json --text p1b/sim/out/g2-report-latest-<YYYYMMDD>.out --json p1b/sim/out/g2-report-latest-<YYYYMMDD>.json';

// ── 采信链（audit 真源）──
const audit = readJson(path.join(OUT, 'g2-audit-r4.json'));
const hc = (audit && audit.human_calibration) || null;

// ── 五层读数（stage4 最新件）──
// 2026-09-15：由「固定日期文件名」改为「自动取最新日期件」——固定名曾在命题 A 晚间补漏后
//   静默供出陈旧 L6 读数（0.1829 vs 实测 0.1755）。改为按 stage4-run-five-layers-YYYYMMDD.json
//   的日期后缀取最大者；无匹配时回退历史固定名（零硬编码依赖）。只读、零写库。
const S4_FILE = latestByPattern(/^stage4-run-five-layers-(\d{8})([a-z]?)\.json$/, 'stage4-run-five-layers-20260914.json');
const s4 = readJson(S4_FILE);

// ── 账本计数（只读库）──
let ledger = null;
try {
  const D = betterSqlite3();
  const db = new D(path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'), { readonly: true });
  const one = (s) => db.prepare(s).get();
  ledger = {
    predictions: one('SELECT COUNT(*) c FROM predictions').c,
    resolved: one('SELECT COUNT(*) c FROM predictions WHERE outcome IS NOT NULL').c,
    verdicts: one('SELECT COUNT(*) c FROM verdicts').c,
    due_next7d: one("SELECT COUNT(*) c FROM predictions WHERE outcome IS NULL AND matures_at IS NOT NULL AND date(matures_at) <= date('now', '+7 day')").c,
    integrity: db.pragma('integrity_check')[0].integrity_check,
  };
  db.close();
} catch (e) { ledger = null; }

const L = [];
L.push('推演沙盘 · 一页看板（' + new Date().toISOString() + '）');
L.push('');
L.push('== G2 五门 ==');
if (g2) {
  const R4 = g2.R4 || {};
  const items = [['①', R4.q1_qualified], ['②', R4.q2_audit], ['③', R4.q3_horizon], ['④', R4.q4_difficulty], ['⑤', R4.q5_monthly]];
  for (const [tag, q] of items) {
    if (!q) continue;
    const val = q.value !== undefined ? q.value : (q.rate !== undefined ? (Number(q.rate) * 100).toFixed(1) + '%' : (q.pass !== undefined ? String(q.pass) : '-'));
    const vd = q.report_only ? 'report-only' : (q.pass === true ? 'PASS' : (q.pass === false ? 'FAIL' : String(q.verdict || q.status || '-')));
    L.push('  ' + tag + ' ' + String(q.name || '').padEnd(12) + ' ' + vd.padEnd(11) + ' 值 ' + JSON.stringify(val).slice(0, 46)
      + (q.n !== undefined && q.ok !== undefined ? '（n=' + q.n + ' ok=' + q.ok + '）' : ''));
  }
  L.push('  ② 采信 = ' + (hc ? (hc.acceptance_status + '（校准 n=' + hc.n + '，端用户 ' + ((audit.meta.review_composition || {}).end_user || 0) + '/10）') : 'n/a'));
  L.push('  门定性 = 过程能力门（不含预测质量读数），对外表述恒挂限定语');
  L.push('  记账语言 = 沟通层（零精度增量宣称）——门定性不变（2026-09-16 P0-U3）');
} else {
  L.push('  n/a（缺 g2-report-latest 读数件）— 生成：' + G2_HINT);
}
L.push('');
L.push('== 五层读数（最新真跑件）==');
if (s4 && s4.report) {
  for (const layer of Object.keys(s4.report).sort()) {
    const b = s4.report[layer];
    const acc = (b.accuracy !== null && b.accuracy !== undefined) ? ' ｜ 正确率 ' + b.accuracy : '';
    L.push('  ' + layer.padEnd(3) + ' 账本 ' + String(b.ledger_rows).padStart(4) + ' ｜ 出数 ' + String(b.engine_ok).padStart(4)
      + ' ｜ 可计分 ' + String(b.scored_n).padStart(4)
      + (b.brier_engine !== undefined ? ' ｜ Brier ' + Number(b.brier_engine).toFixed(4) : '') + acc);
  }
  L.push('  （分层报，禁跨层池化；读数口径见各层 note）');
} else {
  L.push('  n/a（缺 stage4-run-five-layers 读数件）— 生成：node p1b/scripts/stage4-run.cjs --text p1b/sim/out/stage4-run-five-layers-<YYYYMMDD>.out --json p1b/sim/out/stage4-run-five-layers-<YYYYMMDD>.json');
}
// ── 2026-09-16 · P0-U3：贝叶斯语义图例（与 stage4-run.cjs bayesSemanticsOf 同源；只读文本，零数字）──
L.push('');
L.push('== 贝叶斯语义图例（记账语言，零精度增量宣称）==');
L.push('  L1 deterministic_recalc（概率主干豁免）：决定论复算，Brier 语义=计算错误率');
L.push('  L2 prior（基率+Wilson）：引擎 p 即统计基率，是先验不是新读数');
L.push('  L3 prior+calibration（ACI 只调区间不调 p）：点估计恒为基率');
L.push('  L4 annotation_layer（不出数）：后置叠加标注层，按设计不出概率');
L.push('  L5 certified_prior（不可约随机）：p 即认证源公布分布，无信息优势可学');
L.push('  L6 posterior_aggregation（似然证据行→固定规则聚合）：p=判词结构聚合');
L.push('  词汇源＝10-算子攻坚-深度报告 §4（O1-O8）；术语详见 p1b/web/src/lib/terms.ts');
L.push('');
L.push('== 账本 ==');
if (ledger) {
  L.push('  题 ' + ledger.predictions + ' ｜ 已解 ' + ledger.resolved + ' ｜ 判词 ' + ledger.verdicts
    + ' ｜ 7 天内到期未结 ' + ledger.due_next7d + ' ｜ integrity ' + ledger.integrity);
} else { L.push('  n/a（库不可读）'); }
const text = L.join('\n');
console.log(text);
if (TEXT_OUT) { fs.writeFileSync(path.resolve(TEXT_OUT), text, 'utf8'); console.log('[board] text -> ' + path.resolve(TEXT_OUT)); }
if (JSON_OUT) {
  fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify({ generated_at: new Date().toISOString(), g2: g2 ? { ok: true } : { ok: false }, acceptance: hc ? hc.acceptance_status : null, layers: s4 ? s4.report : null,
    bayes_legend: { source: '10-算子攻坚-深度报告 §4（O1-O8 四元组）', note: '记账语言＝沟通层，零精度增量宣称；术语见 p1b/web/src/lib/terms.ts',
      map: { L1: 'deterministic_recalc', L2: 'prior', L3: 'prior+calibration', L4: 'annotation_layer', L5: 'certified_prior', L6: 'posterior_aggregation' } },
    ledger: ledger }, null, 1), 'utf8');
  console.log('[board] json -> ' + path.resolve(JSON_OUT));
}
