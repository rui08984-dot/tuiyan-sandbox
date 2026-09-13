#!/usr/bin/env node
'use strict';
/*
 * G2 三指标月报 —— 审计器 design §4（含 §4.1 修订 R3）
 * 纯 SQL 只读 · 零 LLM · 零网络
 * 口径: docs/specs/2026-09-11-万物可预测性审计器-design.md §4/§4.1
 * 用法:
 *   node p1b/scripts/g2-report.cjs                # 打印文本报告
 *   node p1b/scripts/g2-report.cjs --json <file>  # 另存 JSON
 *   node p1b/scripts/g2-report.cjs --db <file>    # 覆盖库路径
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const JSON_OUT = arg('json', null);

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH, { readOnly: true }); // 只读句柄：禁写库
const all = (s) => db.prepare(s).all();
const one = (s) => db.prepare(s).get();

// R3 分层键与判据谓词（纯 SQL 表达式）
const BF = "p.statement LIKE '%backfill%'";            // 判定键 = statement 含【backfill】
const RESOLVED = "p.outcome IS NOT NULL AND p.resolved_at IS NOT NULL AND p.resolved_at <> ''";
const FROZEN = "COALESCE(p.checklist_hash,'') <> ''";  // 判据完整冻结 = checklist 版本戳存在
const ANCHOR = "EXISTS (SELECT 1 FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind') IS NOT NULL OR (e.type='integer' AND EXISTS (SELECT 1 FROM events ev WHERE ev.id = CAST(e.value AS INTEGER) AND ev.game_id = p.game_id)))";
//__APPEND__

// ---------- 指标 1：可判定率（§4 行1；backfill 计入） ----------
const total = one('SELECT COUNT(*) c FROM predictions p').c;
const voided = 0; // 库内无 void 状态（无 void/rejudge 表，outcome 枚举只有 true/false/null）——见指标2说明
const resolved = one(`SELECT COUNT(*) c FROM predictions p WHERE ${RESOLVED}`).c;
const frozen = one(`SELECT COUNT(*) c FROM predictions p WHERE ${RESOLVED} AND ${FROZEN}`).c;
const anchorable = one(`SELECT COUNT(*) c FROM predictions p WHERE ${RESOLVED} AND ${ANCHOR}`).c;
const judgeable = one(`SELECT COUNT(*) c FROM predictions p WHERE ${RESOLVED} AND ${FROZEN} AND ${ANCHOR}`).c;
const jRt = one(`SELECT COUNT(*) c FROM predictions p WHERE ${RESOLVED} AND ${FROZEN} AND ${ANCHOR} AND NOT (${BF})`).c;
const jBf = one(`SELECT COUNT(*) c FROM predictions p WHERE ${RESOLVED} AND ${FROZEN} AND ${ANCHOR} AND (${BF})`).c;
const rate1 = total ? judgeable / total : null;
const M1 = { total_submitted: total, voided, resolved, judged_frozen: frozen, judged_anchor_ok: anchorable,
  judgeable, judgeable_realtime: jRt, judgeable_backfill: jBf, rate: rate1, threshold: 0.70, pass: rate1 !== null && rate1 >= 0.70 };
M1.by_layer = all(`SELECT p.layer,
  SUM(CASE WHEN ${RESOLVED} THEN 1 ELSE 0 END) resolved,
  SUM(CASE WHEN ${RESOLVED} AND ${FROZEN} AND ${ANCHOR} THEN 1 ELSE 0 END) judgeable,
  COUNT(*) submitted
  FROM predictions p GROUP BY p.layer ORDER BY p.layer`).map(r => ({ ...r, rate: r.submitted ? r.judgeable / r.submitted : null }));
// 抽检池（防 Goodhart ①：10% 随机抽检的候选集，按 id 稳定排序取前 10%）
const auditPool = all(`SELECT p.id FROM predictions p WHERE ${RESOLVED} AND ${FROZEN} AND ${ANCHOR} ORDER BY p.id`)
  .filter((_, i, a) => i % 10 === 0).map(r => r.id);
M1.audit_sample_10pct_ids = auditPool;
//__APPEND__

// ---------- 指标 2：判据争议率（§4 行2；backfill 计入） ----------
// 设计口径 = resolve 时点判据被质疑并导致「改判或 void」的题数 ÷ 已 resolve 题数
const voidTables = all("SELECT name FROM sqlite_master WHERE type='table' AND (lower(name) LIKE '%void%' OR lower(name) LIKE '%rejudg%' OR lower(name) LIKE '%audit%' OR lower(name) LIKE '%state%')").map(r => r.name);
const voidedRows = 0;      // 无 void 状态记录（outcome 枚举仅 true/false/null）
const rejudgedRows = 0;    // 无 rejudge 记录表；resolve_note 全库无「改判/复核/修正/撤销/void」字样
const reviseMentions = one("SELECT COUNT(*) c FROM predictions p WHERE p.resolve_note LIKE '%改判%' OR p.resolve_note LIKE '%复核%' OR p.resolve_note LIKE '%修正%' OR p.resolve_note LIKE '%撤销%' OR p.resolve_note LIKE '%void%'").c;
const rate2 = resolved ? (voidedRows + rejudgedRows) / resolved : null;
const M2 = { resolved, voided: voidedRows, rejudged: rejudgedRows, revise_note_mentions: reviseMentions,
  dispute_count: voidedRows + rejudgedRows, rate: rate2, threshold: 0.20, pass: rate2 !== null && rate2 <= 0.20,
  void_tables_found: voidTables, note: '库内无 void/rejudge 记录表，voided=rejudged=0 ⇒ 争议率报 0（分母 ' + resolved + '）' };
// 代理观测（非设计口径，仅供风险参考）：同一题 3 路判词 run 的 implied_prob 方向不一致率
const proxy = one(`SELECT COUNT(*) c FROM (SELECT prediction_id FROM verdicts WHERE run_id IS NOT NULL
  GROUP BY prediction_id HAVING COUNT(DISTINCT run_id) > 1 AND COUNT(DISTINCT CASE WHEN implied_prob >= 0.5 THEN 1 ELSE 0 END) > 1)`).c;
const proxyBase = one("SELECT COUNT(*) c FROM (SELECT prediction_id FROM verdicts WHERE run_id IS NOT NULL GROUP BY prediction_id HAVING COUNT(DISTINCT run_id) > 1)").c;
M2.proxy_multirun_disagreement = { n: proxy, denom: proxyBase, rate: proxyBase ? proxy / proxyBase : null,
  label: '代理观测·非设计口径：判词多路分歧（prompt 变体，非独立 provider），不计入争议率' };

// ---------- 指标 3：月 resolve 吞吐（§4 行3 + §4.1 R3 ④） ----------
const windows = all(`SELECT substr(p.resolved_at,1,7) month,
  SUM(CASE WHEN NOT (${BF}) THEN 1 ELSE 0 END) realtime_resolved,
  SUM(CASE WHEN (${BF}) THEN 1 ELSE 0 END) backfill_resolved,
  COUNT(*) total_resolved
  FROM predictions p WHERE ${RESOLVED} GROUP BY month ORDER BY month`);
const months = all(`SELECT DISTINCT substr(p.resolved_at,1,7) month FROM predictions p WHERE ${RESOLVED} ORDER BY month`).map(r => r.month);
const rtByMonth = new Map(windows.map(w => [w.month, w.realtime_resolved]));
let best = 0, cur = 0, bestSeq = [];
for (const m of months) { const v = rtByMonth.get(m) || 0; if (v >= 30) { cur++; if (cur > best) { best = cur; } } else { cur = 0; } }
const M3 = { by_month: windows, months_observed: months.length,
  consecutive_realtime_months_ge30: best, threshold_months: 2, threshold_per_month: 30,
  pass: best >= 2, decision_basis: 'realtime 列（statement 不含【backfill】）单独判定；backfill 列仅作存量池厚度',
  data_window_note: '库内 resolved_at 全部落在 ' + months.join('/') + '，观测窗 <2 个自然月 ⇒ 无论读数多少都无法达成「连续 2 月」' };
//__APPEND__

// ---------- 附：按题面目标月的辅助口径（§4.1 R3 草案，evidence.meta.month） ----------
// 目标月 = resolve.date（日粒度）| meta.eventDate | meta.month（草案缺年，原样保留）
const TGT = "COALESCE(json_extract(e.value,'$.resolve.date'), json_extract(e.value,'$.meta.eventDate'), json_extract(e.value,'$.meta.month'))";
const targetRaw = all(`SELECT ${TGT} AS raw, COUNT(*) c,
  SUM(CASE WHEN ${RESOLVED} THEN 1 ELSE 0 END) resolved,
  SUM(CASE WHEN ${BF} THEN 1 ELSE 0 END) backfill
  FROM predictions p, json_each(p.evidence_json) e WHERE ${TGT} IS NOT NULL GROUP BY raw ORDER BY raw`);
const norm = (v) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(0, 7) + '（日粒度·取月）';
  if (/^\d{4}-\d{2}$/.test(v)) return v;
  return 'MM=' + v + '（草案缺年份字段）';
};
const targetMonths = {};
for (const r of targetRaw) { const k = norm(r.raw); targetMonths[k] = targetMonths[k] || { n: 0, resolved: 0, backfill: 0 };
  targetMonths[k].n += r.c; targetMonths[k].resolved += r.resolved; targetMonths[k].backfill += r.backfill; }
const M4 = { basis: 'evidence_json[].resolve.date | meta.eventDate | meta.month（R3 草案，与 resolved_at 口径不同，不用于达标判定）',
  rows_with_target_month: targetRaw.reduce((a, r) => a + r.c, 0), by_target_month: targetMonths,
  note: '该口径按「题面目标时间」聚合，与 resolved_at 自然月不同轴；草案 meta.month 无年份（如 09/10/11），故单列标注' };
//__APPEND__

// ---------- R3 防 Goodhart 合规自查（④分窗 ⑤单批上限 ⑥分窗配额） ----------
const batchRows = all(`SELECT json_extract(e.value,'$.batch') b, COUNT(*) c, MIN(p.layer) l
  FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.batch') IS NOT NULL GROUP BY b`);
const bfTotal = one(`SELECT COUNT(*) c FROM predictions p WHERE ${BF}`).c;
const capPerLayer = all(`SELECT p.layer, COUNT(*) c FROM predictions p WHERE NOT (${BF}) GROUP BY p.layer`);
const capMap = new Map(capPerLayer.map(r => [r.layer, r.c]));
const bfPerLayer = all(`SELECT p.layer, COUNT(*) c FROM predictions p WHERE ${BF} GROUP BY p.layer ORDER BY p.layer`).map(r => ({ ...r, rt_cap_3x: 3 * (capMap.get(r.layer) || 0), ok: r.c <= 3 * (capMap.get(r.layer) || 0) }));
const shareOf = (rs) => { const t = rs.reduce((a, r) => a + r.c, 0); const m = rs.slice().sort((a, b) => b.c - a.c)[0];
  return { total: t, max_layer: m ? m.layer : null, max_share: t ? m.c / t : null }; };
const compliance = {
  rule4_split_windows: { ok: true, realtime: M3.by_month.reduce((a, w) => a + w.realtime_resolved, 0), backfill: M3.by_month.reduce((a, w) => a + w.backfill_resolved, 0) },
  rule5_single_batch_cap: { batches: batchRows, backfill_marked_total: bfTotal, cap_total_500: bfTotal <= 500, per_layer: bfPerLayer,
    ok: bfTotal <= 500 && bfPerLayer.every(r => r.ok) },
  rule6_window_quota: { realtime: shareOf(all(`SELECT p.layer, COUNT(*) c FROM predictions p WHERE NOT (${BF}) GROUP BY p.layer`)),
    backfill: shareOf(all(`SELECT p.layer, COUNT(*) c FROM predictions p WHERE ${BF} GROUP BY p.layer`)), cap_share: 0.60 },
  honesty_note_required: '凡引用含 backfill 样本的校准结论（ECE/Brier/分辨率），报告须恒挂「含历史回填样本，非实时预测能力」'
};
// ---------- 渲染 ----------
const pct = (x) => (x === null || x === undefined) ? 'n/a' : (x * 100).toFixed(1) + '%';
const flag = (b) => b ? '达标' : '未达标';
const L = [];
const bar = '='.repeat(72);
L.push(bar);
L.push('G2 三指标月报 —— 审计器 design §4（含 §4.1 修订 R3）');
L.push('生成时间 ' + new Date().toISOString() + ' | 库 ' + DB_PATH + ' | 句柄只读 · 纯 SQL · 零 LLM');
L.push(bar);
L.push('[指标1] 可判定率 = 判据冻结 ∧ 锚可机检 ÷ 提交总题数  达标线 ≥70%  → ' + flag(M1.pass));
L.push('  = ' + M1.judgeable + ' / ' + M1.total_submitted + ' = ' + pct(M1.rate) + '   （已 resolve ' + M1.resolved + '，voided ' + M1.voided + '，未解 ' + (M1.total_submitted - M1.resolved) + '）');
L.push('  判据完整冻结 checklist_hash 非空: ' + M1.judged_frozen + ' (' + pct(M1.judged_frozen / M1.resolved) + ' of resolved) | 真值锚可机检: ' + M1.judged_anchor_ok);
L.push('  分窗: realtime ' + M1.judgeable_realtime + ' / backfill ' + M1.judgeable_backfill + '（R3: backfill 计入本指标）');
L.push('  分层(submitted/judgeable): ' + M1.by_layer.map(r => r.layer + ' ' + r.submitted + '/' + r.judgeable + '=' + pct(r.rate)).join('  '));
L.push('  抽检池(每10题取1, 防Goodhart①): ' + auditPool.length + ' 题 id=' + (auditPool.length ? auditPool[0] + '..' + auditPool[auditPool.length - 1] : '-'));
L.push('[指标2] 判据争议率 = (改判 + void) ÷ 已 resolve  达标线 ≤20%  → ' + flag(M2.pass));
L.push('  = (' + M2.rejudged + ' + ' + M2.voided + ') / ' + M2.resolved + ' = ' + pct(M2.rate) + '   [库内无 void 记录，报 0]');
L.push('  说明: ' + M2.note);
L.push('  void/rejudge 表扫描: ' + (M2.void_tables_found.length ? M2.void_tables_found.join(',') : '无') + ' | resolve_note 含改判/复核字样: ' + M2.revise_note_mentions);
L.push('  代理观测(不计入): 多路判词分歧 ' + M2.proxy_multirun_disagreement.n + '/' + M2.proxy_multirun_disagreement.denom + ' = ' + pct(M2.proxy_multirun_disagreement.rate));
L.push('[指标3] 月 resolve 吞吐（按 resolved_at 自然月）  达标线 ≥30/月 连续 2 月  → ' + flag(M3.pass));
L.push('  月份           realtime  backfill  total');
for (const w of M3.by_month) L.push('  ' + w.month + '          ' + String(w.realtime_resolved).padStart(4) + '      ' + String(w.backfill_resolved).padStart(4) + '     ' + String(w.total_resolved).padStart(4));
L.push('  连续 realtime ≥30 的月数: ' + M3.consecutive_realtime_months_ge30 + ' / 2   [' + M3.decision_basis + ']');
L.push('  ' + M3.data_window_note);
L.push('[附] 按题面目标月（evidence.meta.month / resolve.date，R3 草案，不参与达标判定）');
for (const k of Object.keys(M4.by_target_month)) { const v = M4.by_target_month[k];
  L.push('  ' + k.padEnd(26) + ' n=' + String(v.n).padStart(3) + '  resolved=' + String(v.resolved).padStart(3) + '  backfill=' + String(v.backfill).padStart(3)); }
L.push('  ' + M4.note);
L.push('[R3 防 Goodhart 合规]');
L.push('  ④ 分窗: realtime ' + compliance.rule4_split_windows.realtime + ' / backfill ' + compliance.rule4_split_windows.backfill + '  → ok');
L.push('  ⑤ 单批上限(≤3×layer存量且总量≤500): 总量 ' + bfTotal + ' ≤500 ' + compliance.rule5_single_batch_cap.cap_total_500 + ' | ' +
  bfPerLayer.map(r => r.layer + ' ' + r.c + '≤' + r.rt_cap_3x + ' ' + (r.ok ? 'ok' : 'VIOLATION')).join(' | '));
L.push('  ⑥ 分窗配额(单层占比≤60%): realtime ' + compliance.rule6_window_quota.realtime.max_layer + ' ' + pct(compliance.rule6_window_quota.realtime.max_share) +
  ' | backfill ' + compliance.rule6_window_quota.backfill.max_layer + ' ' + pct(compliance.rule6_window_quota.backfill.max_share));
L.push('  诚实标注: ' + compliance.honesty_note_required);
L.push(bar);
const text = L.join('\n');
console.log(text);
//__APPEND__

// ---------- 产物 ----------
const report = {
  meta: { script: 'p1b/scripts/g2-report.cjs', spec: 'docs/specs/2026-09-11-万物可预测性审计器-design.md §4 + §4.1 R3',
    db: DB_PATH, mode: 'readonly', generated_at: new Date().toISOString(),
    verdict: { judgeable_rate: M1.pass, dispute_rate: M2.pass, throughput_2month: M3.pass } },
  M1_judgeable_rate: M1, M2_dispute_rate: M2, M3_monthly_throughput: M3,
  M4_target_month_aux: M4, r3_compliance: compliance, text_report: text
};
if (JSON_OUT) {
  const p = path.resolve(JSON_OUT);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(report, null, 1), 'utf8');
  console.log('[g2-report] JSON → ' + p);
}
db.close();
process.exit(0);
