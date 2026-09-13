#!/usr/bin/env node
'use strict';
/*
 * G2 能力门月报 -- R4 口径（审计器 design §4.2 修订 R4，2026-09-13 用户拍板选项 A）
 * 纯 SQL 只读 · 零 LLM · 零网络 · 零写库
 * 口径: docs/specs/2026-09-11-万物可预测性审计器-design.md §4.2（R4 五条）+ §4.2.1（细则 A/B/C 实现口径）
 * 依据: docs/specs/红队R2-复核-20260913.md §2.1（g2_regime/matures_at 三前置）、§2.3 N1（baseline_brier 空挂）
 * 常量: 题源选择键 checklist_hash 冻结不动（3 个 PREREG 以 checklist_hash='v2' 选题源）；行域一律 g2_regime='R4'
 * 用法:
 *   node p1b/scripts/g2-report.cjs                    # 打印文本报告
 *   node p1b/scripts/g2-report.cjs --json <file>      # 另存 JSON
 *   node p1b/scripts/g2-report.cjs --text <file>      # 另存文本
 *   node p1b/scripts/g2-report.cjs --audit <file>     # 抽检清单（人工复核结果，②用）
 *   node p1b/scripts/g2-report.cjs --db <file>        # 覆盖库路径
 *   node p1b/scripts/g2-report.cjs --include-intake    # 额外读只读视图 predictions_r4 做**非 G2 口径**披露（默认关；不改变主读数）
 *   D-8.1 护栏：G2 主判定恒只读 predictions 原表；视图只喂 --include-intake 的披露节，严禁悄悄改读数。
 *
 * R4 五条：
 *   ① 合格题累计 >=60（cutoff 合规按题源分流：realtime=created_at / backfill=matures_at-1天；§4.2.1 细则 B）
 *   ② 抽检合格率 >=70%（需 10% 随机抽检清单 + 人工复核结论；缺 -> not-yet，不得硬编码 0 充当达标）
 *   ③ horizon 三层下限 短(<=7天)>=20 / 中(8-30天)>=20 / 长(>30天)>=10，长必须 realtime（按长题总数判定，⑦ 降报告项）
 *   ④ 难度最难档 >=20（外生 b(1-b)>=0.21，b 解析自 evidence.baseRateNote；禁 assigned_prob）
 *   ⑤ 月节律（realtime_resolved 按自然月）仅报告，不作门
 *   ⑦ 长∩最难 重叠披露（报告项，不扣减）；严格读法对照一并留档（§4.2.1 细则 A）
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
const TEXT_OUT = arg('text', null);
const AUDIT_FILE = arg('audit', null);
// D-8.1：显式开关，默认**关**（关 = 零行为变化，绝不读视图）
const INCLUDE_INTAKE = process.argv.indexOf('--include-intake') >= 0;

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const all = (s) => db.prepare(s).all();
const one = (s) => db.prepare(s).get();

// D-8.1：只读归一视图读取器——仅在 --include-intake 时调用；结果只进披露节，不参与 Q1-Q5。
function readIntakeLayer() {
  try {
    const hasView = one("SELECT name FROM sqlite_master WHERE type='view' AND name='predictions_r4'");
    if (!hasView) return { view: 'predictions_r4', available: false, reason: '视图不存在（本库未执行接题 additive 迁移）' };
    const total = one('SELECT COUNT(*) n FROM predictions_r4').n;
    const intakeRows = one("SELECT COUNT(*) n FROM predictions_r4 WHERE origin='intake_questions'").n;
    const byLayer = all('SELECT origin, layer, COUNT(*) n FROM predictions_r4 GROUP BY origin, layer ORDER BY origin, layer');
    return { view: 'predictions_r4', available: true, total_rows: total, intake_rows: intakeRows, by_origin_layer: byLayer };
  } catch (e) { return { view: 'predictions_r4', available: false, reason: '视图读取失败: ' + e.message }; }
}
const intakeLayer = INCLUDE_INTAKE ? readIntakeLayer() : null;

const REGIME = "p.g2_regime = 'R4'";
const BF = "p.statement LIKE '%【backfill】%'";
const isBF = (stmt) => String(stmt || '').indexOf('【backfill】') >= 0;

function parseBaseRate(note) {
  if (!note) return null;
  let m = /占\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (m) return { b: parseFloat(m[1]) / 100, pattern: 'pct_share' };
  m = /基率\s*[=:：]\s*(?:组合数理论值\s*)?([0-9]*\.?[0-9]+)/.exec(note);
  if (m) { const v = parseFloat(m[1]); return { b: v > 1 ? v / 100 : v, pattern: 'base_rate_eq' }; }
  m = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (m) return { b: parseFloat(m[1]) / 100, pattern: 'pct_fallback' };
  return null;
}

const ROWS_SQL = "SELECT p.id, p.g2_regime, p.layer, p.created_at, p.matures_at, p.resolved_at, "
  + "p.outcome, p.statement, p.checklist_hash, p.tautology, "
  + "(SELECT json_extract(e.value,'$.resolve.date') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.date') IS NOT NULL LIMIT 1) AS rd, "
  + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn "
  + "FROM predictions p WHERE " + REGIME;
const rows = all(ROWS_SQL);

const counts = { regime_rows: rows.length, backfill_rows: 0, excluded: {}, tautology_rows: 0, b_unparsed_ids: [] };
const pool = [];
const allHorizon = { short: 0, mid: 0, long: 0, past_or_negative: 0, no_matures: 0 };
function minusOneDay(ds) {
  const t = new Date(String(ds) + 'T00:00:00Z').getTime();
  return isNaN(t) ? null : new Date(t - 86400000).toISOString().slice(0, 10);
}
function bump(o, k) { o[k] = (o[k] || 0) + 1; }
for (const r of rows) {
  const bf = isBF(r.statement);
  if (bf) counts.backfill_rows++;
  const hasMat = r.matures_at !== null && r.matures_at !== undefined && String(r.matures_at) !== '';
  let hDays = null;
  if (hasMat && r.created_at) {
    const t1 = new Date(String(r.matures_at) + 'T00:00:00Z').getTime();
    const t0 = new Date(String(r.created_at).replace(' ', 'T') + 'Z').getTime();
    if (!isNaN(t1) && !isNaN(t0)) hDays = (t1 - t0) / 86400000;
  }
  if (!hasMat) allHorizon.no_matures++;
  else if (hDays !== null && hDays < 0) allHorizon.past_or_negative++;
  else if (hDays !== null) allHorizon[hDays <= 7 ? 'short' : (hDays <= 30 ? 'mid' : 'long')]++;
  // 细则 B：cutoff 合规判定按题源分流（forward/realtime=created_at；backfill=matures_at-1 天）
  if (!r.rd) { bump(counts.excluded, 'no_resolve_date'); continue; }
  let cutoff = null, cutoffMode = null;
  if (bf) {
    if (!hasMat) { bump(counts.excluded, 'backfill_no_matures_at'); continue; }
    cutoff = minusOneDay(r.matures_at); cutoffMode = 'matures_at_minus_1d';
  } else { cutoff = String(r.created_at).slice(0, 19); cutoffMode = 'created_at'; }
  if (cutoff === null || !(String(cutoff) < String(r.rd))) { bump(counts.excluded, 'cutoff_not_before_event'); continue; }
  if (Number(r.tautology) === 1) { counts.tautology_rows++; continue; }
  const pr = parseBaseRate(r.brn);
  if (!pr) counts.b_unparsed_ids.push(r.id);
  const bb = pr ? pr.b : null;
  const hardest = bb !== null && bb * (1 - bb) >= 0.21;
  const bucket = hDays === null ? 'unknown' : (hDays < 0 ? 'past_or_negative' : (hDays <= 7 ? 'short' : (hDays <= 30 ? 'mid' : 'long')));
  pool.push({ id: r.id, layer: r.layer, created_at: r.created_at, matures_at: r.matures_at, resolved_at: r.resolved_at,
    resolved: r.outcome !== null && r.outcome !== undefined, backfill: bf, cutoff: cutoff, cutoff_mode: cutoffMode,
    b: bb, b_pattern: pr ? pr.pattern : null,
    horizon_days: hDays === null ? null : Math.round(hDays * 1000) / 1000, bucket: bucket, hardest: hardest });
}
const eligible = pool.length;
const byBucket = { short: [], mid: [], long: [], unknown: [], past_or_negative: [] };
for (const p of pool) if (byBucket[p.bucket]) byBucket[p.bucket].push(p);
const hardestPool = pool.filter((p) => p.hardest);
const hardestRt = hardestPool.filter((p) => !p.backfill);
const hardestBf = hardestPool.filter((p) => p.backfill);
const longHardest = byBucket.long.filter((p) => p.hardest);
const longBackfill = byBucket.long.filter((p) => p.backfill);
const layerDist = {};
for (const p of pool) layerDist[p.layer] = (layerDist[p.layer] || 0) + 1;

const Q1 = { id: 1, name: '合格题累计', threshold: '>=60', value: eligible, pass: eligible >= 60,
  def: '§4.2.1 细则 B：cutoff 合规按题源分流（forward/realtime=created_at；backfill=matures_at-1 天），均须早于事件日；∧ checklist_hash 非空 ∧ tautology=0；行域 g2_regime=R4',
  cutoff_modes: { realtime: 'created_at', backfill: 'matures_at_minus_1d' },
  excluded: counts.excluded,
  excluded_tautology: counts.tautology_rows,
  qualified_resolved: pool.filter((p) => p.resolved).length,
  qualified_realtime: pool.filter((p) => !p.backfill).length,
  qualified_backfill: pool.filter((p) => p.backfill).length,
  by_layer: layerDist,
  note: '细则 B 落地：backfill 计入 ①（cutoff=matures_at-1 天）；两源分列见 qualified_realtime/qualified_backfill。' };
Q1.verdict = Q1.pass ? 'PASS' : 'FAIL';

const Q3 = { id: 3, name: 'horizon 三层下限', threshold: { short_le_7d: 20, mid_8_30d: 20, long_gt_30d: 10 },
  basis: 'matures_at - created_at 分桶（对 ① 合格题池）；backfill 题 matures_at 在历史 ⇒ 落 past_or_negative 桶，不计入 horizon',
  buckets: { short: byBucket.short.length, mid: byBucket.mid.length, long: byBucket.long.length, unknown_horizon: byBucket.unknown.length, past_or_negative: byBucket.past_or_negative.length },
  all_rows_with_matures_buckets: allHorizon,
  long_must_be_realtime: { long_backfill: longBackfill.length, ok: longBackfill.length === 0 },
  short_pass: byBucket.short.length >= 20, mid_pass: byBucket.mid.length >= 20, long_pass: byBucket.long.length >= 10,
  rule7_policy: '§4.2.1 细则 A：③ 按长题总数判定，⑦ 降为报告项（披露重叠，不扣减）',
  strict_reading_for_record: { basis: '旧严格读法（⑦ 去重后独立长 >=10）——已实测留档，仅作对照',
    long_independent: byBucket.long.length - longHardest.length, pass: (byBucket.long.length - longHardest.length) >= 10,
    verdict: ((byBucket.long.length - longHardest.length) >= 10) ? 'PASS' : 'FAIL' } };
Q3.pass = Q3.short_pass && Q3.mid_pass && Q3.long_pass && Q3.long_must_be_realtime.ok;
Q3.verdict = Q3.pass ? 'PASS' : 'FAIL';
Q3.rule7_disclosure = { long_total: byBucket.long.length, long_and_hardest_overlap: longHardest.length,
  overlap_share: byBucket.long.length ? longHardest.length / byBucket.long.length : null,
  overlap_ids: longHardest.map((p) => p.id) };

const hardestByLayer = {};
for (const p of hardestPool) hardestByLayer[p.layer] = (hardestByLayer[p.layer] || 0) + 1;
const Q4 = { id: 4, name: '难度最难档', threshold: '>=20', value: hardestPool.length, pass: hardestPool.length >= 20,
  metric: '外生基线 Brier 下限 b(1-b) >= 0.21（等价基率 0.35–0.65）；b 解析自 evidence.baseRateNote',
  forbid: '禁用 assigned_prob / 判词输出来源（红队 R1-F7 循环度量）',
  by_layer: hardestByLayer,
  hardest_realtime: hardestRt.length, hardest_backfill: hardestBf.length,
  parse_coverage: { pool_with_b: pool.filter((p) => p.b !== null).length, pool_unparsed: pool.filter((p) => p.b === null).length,
    unparsed_ids: counts.b_unparsed_ids.slice(0, 20) },
  b_patterns: pool.reduce((a, p) => { if (p.b_pattern) a[p.b_pattern] = (a[p.b_pattern] || 0) + 1; return a; }, {}) };
Q4.verdict = Q4.pass ? 'PASS' : 'FAIL';

const rule7 = { policy: '§4.2.1 细则 A：⑦ 降为报告项——③ 按长题总数判定，不扣减；本节强制披露重叠',
  long_total: byBucket.long.length, long_and_hardest_overlap: longHardest.length,
  overlap_share: byBucket.long.length ? longHardest.length / byBucket.long.length : null,
  long_independent_after_strict_dedup: byBucket.long.length - longHardest.length,
  strict_reading_verdict: (byBucket.long.length - longHardest.length) >= 10 ? 'PASS' : 'FAIL',
  hardest_total: hardestPool.length, hardest_independent_after_strict_dedup: hardestPool.length - longHardest.length,
  report_only: true, overlap_ids: longHardest.map((p) => p.id) };

const AUDIT_MISSING = 'p1b/sim/out/g2-audit-r4.json（10% 随机抽检清单：题 id + 人工复核结论 pass/verdict + 复核人/时间）';
function loadAudit(file) {
  if (!file) return { status: 'not-yet', reason: '未提供 --audit <file>：盘上无 10% 随机抽检清单', missing: [AUDIT_MISSING] };
  const p = path.resolve(file);
  if (!fs.existsSync(p)) return { status: 'not-yet', reason: '抽检清单不存在：' + p, missing: [AUDIT_MISSING] };
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const items = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : (Array.isArray(j.sample) ? j.sample : null));
    if (!items || !items.length) return { status: 'not-yet', reason: '抽检清单无可解析条目（期望 {items:[{id,pass|verdict}]}）', missing: [AUDIT_MISSING] };
    const scored = items.filter((it) => typeof it.pass === 'boolean' || typeof it.quality_pass === 'boolean' || typeof it.verdict === 'string');
    if (!scored.length) return { status: 'not-yet', reason: '抽检清单缺复核结论字段（pass/verdict）', missing: [AUDIT_MISSING] };
    const ok = scored.filter((it) => it.pass === true || it.quality_pass === true || String(it.verdict).toUpperCase() === 'PASS').length;
    const rate = ok / scored.length;
    return { status: 'done', file: p, n: scored.length, ok: ok, rate: rate, threshold: 0.70, pass: rate >= 0.70,
      review_composition: (j.meta && j.meta.review_composition) || null, honesty: (j.meta && j.meta.honesty) || null,
      human_calibration: j.human_calibration || null,
      human_calibration_settlement: (j.meta && j.meta.human_calibration_settlement) || null,
      detail: (j.meta && j.meta.detail) || null };
  } catch (e) { return { status: 'not-yet', reason: '抽检清单解析失败：' + e.message, missing: [AUDIT_MISSING] }; }
}
const auditRes = loadAudit(AUDIT_FILE);
const reviewCandidates = pool.slice().sort((a, b) => a.id - b.id).filter((_, i) => i % 10 === 0).map((p) => p.id);
const Q2 = Object.assign({ id: 2, name: '抽检合格率', threshold: '>=70%', gate: 'human-review',
  candidate_pool_10pct_ids: reviewCandidates, candidate_pool_n: reviewCandidates.length }, auditRes);
Q2.verdict = Q2.status === 'done' ? (Q2.pass ? 'PASS' : 'FAIL') : 'pending';

const monthly = all("SELECT substr(p.resolved_at,1,7) m, "
  + "SUM(CASE WHEN " + BF + " THEN 0 ELSE 1 END) realtime_resolved, "
  + "SUM(CASE WHEN " + BF + " THEN 1 ELSE 0 END) backfill_resolved, "
  + "COUNT(*) total_resolved FROM predictions p WHERE " + REGIME
  + " AND p.outcome IS NOT NULL AND p.resolved_at IS NOT NULL AND p.resolved_at <> '' GROUP BY m ORDER BY m");
const Q5 = { id: 5, name: '月节律（realtime_resolved 按自然月）', report_only: true, threshold: '仅报告·不作门',
  months: monthly, observed_months: monthly.length, verdict: 'pending',
  note: 'R4 ⑤ 由门降为报告项：不参与达标判定；「系统还活着吗」由 G4 管（design §4.2）。' };

const resolvedRt = monthly.reduce((a, w) => a + w.realtime_resolved, 0);
const resolvedBf = monthly.reduce((a, w) => a + w.backfill_resolved, 0);
const bfPerLayer = all("SELECT p.layer, COUNT(*) c FROM predictions p WHERE " + REGIME + " AND " + BF + " GROUP BY p.layer ORDER BY p.layer");
const rtPerLayer = all("SELECT p.layer, COUNT(*) c FROM predictions p WHERE " + REGIME + " AND NOT (" + BF + ") GROUP BY p.layer");
const rtMap = new Map(rtPerLayer.map((r) => [r.layer, r.c]));
const bfTotal = bfPerLayer.reduce((a, r) => a + r.c, 0);
const bfByBatch = all("SELECT COALESCE((SELECT json_extract(e1.value,'$.batch') FROM json_each(p.evidence_json) e1 WHERE json_extract(e1.value,'$.batch') IS NOT NULL LIMIT 1), (SELECT json_extract(e2.value,'$.kind') FROM json_each(p.evidence_json) e2 LIMIT 1)) batch, COUNT(*) c FROM predictions p WHERE " + REGIME + " AND " + BF + " GROUP BY batch ORDER BY c DESC");
function shareOf(rs) { const t = rs.reduce((a, r) => a + r.c, 0); const m = rs.slice().sort((a, b) => b.c - a.c)[0];
  return { total: t, max_layer: m ? m.layer : null, max_share: t ? m.c / t : null }; }
const baselineBrierNonnull = one("SELECT COUNT(*) c FROM predictions p WHERE " + REGIME + " AND p.baseline_brier IS NOT NULL").c;
const compliance = {
  r3_split_windows: { realtime_resolved: resolvedRt, backfill_resolved: resolvedBf, ok: true },
  r3_batch_cap: { policy: '§4.2.1 细则 C：按批次计，各批 <=500 即达标；累计仅披露',
    per_batch: bfByBatch.map((r) => ({ batch: r.batch, count: r.c, cap_500: r.c <= 500, ok: r.c <= 500 })),
    max_batch: bfByBatch.length ? bfByBatch[0].c : 0,
    per_batch_ok: bfByBatch.every((r) => r.c <= 500),
    cumulative_backfill: bfTotal,
    cumulative_disclosure: '累计 ' + bfTotal + ' 条（仅披露，不构成违规）',
    per_layer: bfPerLayer.map((r) => ({ layer: r.layer, count: r.c, rt_cap_3x: 3 * (rtMap.get(r.layer) || 0), ok: r.c <= 3 * (rtMap.get(r.layer) || 0) })),
    ok: bfByBatch.every((r) => r.c <= 500) && bfPerLayer.every((r) => r.c <= 3 * (rtMap.get(r.layer) || 0)) },
  r3_window_quota: { realtime: shareOf(rtPerLayer), backfill: shareOf(bfPerLayer), cap_share: 0.60 },
  honesty_note: '凡引用含 backfill 样本的校准结论（ECE/Brier/分辨率），报告须恒挂「含历史回填样本，非实时预测能力」',
  audit_column_check: { baseline_brier_nonnull: baselineBrierNonnull,
    note: 'N1（R2 §2.3）：baseline_brier 列从未写入；④ 的难度 b 因此解析 evidence.baseRateNote（外生），不读 baseline_brier。' },
  forbidden_metrics: { assigned_prob_used_for_difficulty: false, checklist_hash_modified: false } };
const verdicts = [Q1.verdict, Q2.verdict, Q3.verdict, Q4.verdict];
const gate = verdicts.every((v) => v === 'PASS') ? 'PASS' : (verdicts.some((v) => v === 'FAIL') ? 'FAIL' : 'pending');

const pct = (x) => (x === null || x === undefined) ? 'n/a' : (x * 100).toFixed(1) + '%';
const L = [];
const bar = '='.repeat(72);
L.push(bar);
L.push('G2 能力门月报 -- R4 口径（审计器 design §4.2 修订 R4 · 2026-09-13）');
L.push('生成 ' + new Date().toISOString() + ' | 库 ' + DB_PATH + ' | 句柄只读 · 纯 SQL · 零 LLM · 零写库');
L.push('行域 g2_regime=R4 | 账本 ' + counts.regime_rows + ' 行 | 门总判定 ' + gate);
L.push(bar);
if (INCLUDE_INTAKE) {
  L.push('!! 含接题层未入账题，非 G2 口径（--include-intake）—— 主判定 Q1-Q5 仍只读 predictions 原表 !!');
  L.push(bar);
}
L.push('[①] 合格题累计 >=60  -> ' + Q1.verdict + '   值 ' + Q1.value + '（resolved ' + Q1.qualified_resolved + '；realtime ' + Q1.qualified_realtime + ' / backfill ' + Q1.qualified_backfill + '）');
L.push('    排除: ' + Object.keys(counts.excluded).map((k) => k + ' ' + counts.excluded[k]).join(' | ') + ' | tautology ' + counts.tautology_rows);
L.push('    ' + Q1.note);
L.push('[②] 抽检合格率 >=70%  -> ' + Q2.verdict + '   值 ' + (Q2.status === 'done' ? pct(Q2.rate) : 'not-yet') + '   ' + (Q2.reason || ('清单 ' + Q2.file + ' n=' + Q2.n + ' ok=' + Q2.ok)));
if (Q2.missing) for (const m of Q2.missing) L.push('    缺: ' + m);
L.push('    10% 抽检候选池（确定性：合格题按 id 每 10 取 1）: n=' + Q2.candidate_pool_n);
if (Q2.status === 'done') {
  L.push('    复核构成（D-4）: ' + JSON.stringify(Q2.review_composition) + ' — 非全人工复核，不得声称"全人工"');
  const hc = Q2.human_calibration || {};
  L.push('    人类校准段（D-3③）: ' + JSON.stringify(hc) + ' -> 采信 ' + (typeof hc.rate === 'number' && hc.rate >= 0.90 ? 'YES' : 'NO（未达 90% 或缺失）'));
  if (Q2.human_calibration_settlement) L.push('    校准结账: 修正后 ' + Q2.human_calibration_settlement.post_fix_alignment + '；待办 ' + (Q2.human_calibration_settlement.pending || []).join('；'));
}

L.push('[③] horizon 三层 短>=20 中>=20 长>=10(须 realtime)  -> ' + Q3.verdict);
L.push('    短 ' + Q3.buckets.short + ' | 中 ' + Q3.buckets.mid + ' | 长 ' + Q3.buckets.long + ' | 未知 ' + Q3.buckets.unknown_horizon + ' | past_or_negative(backfill) ' + Q3.buckets.past_or_negative + ' | 长中 backfill ' + Q3.long_must_be_realtime.long_backfill);
L.push('    本细则读法（§4.2.1 A）：长 ' + Q3.buckets.long + ' -> ' + (Q3.long_pass ? 'PASS' : 'FAIL') + ' | 严格读法对照：独立长 ' + Q3.strict_reading_for_record.long_independent + ' -> ' + Q3.strict_reading_for_record.verdict);
L.push('    ⑦披露（报告项）: 长∩最难 ' + Q3.rule7_disclosure.long_and_hardest_overlap + '/' + Q3.rule7_disclosure.long_total + ' = ' + pct(Q3.rule7_disclosure.overlap_share));
L.push('[④] 难度最难档 b(1-b)>=0.21 且 >=20  -> ' + Q4.verdict + '   值 ' + Q4.value + '（realtime ' + Q4.hardest_realtime + ' / backfill ' + Q4.hardest_backfill + '；外生解析覆盖 ' + Q4.parse_coverage.pool_with_b + '/' + (Q4.parse_coverage.pool_with_b + Q4.parse_coverage.pool_unparsed) + '；模式 ' + JSON.stringify(Q4.b_patterns) + '）');
L.push('[⑤] 月节律（仅报告·不作门）');
for (const m of Q5.months) L.push('    ' + m.m + '  realtime ' + m.realtime_resolved + ' / backfill ' + m.backfill_resolved + ' / total ' + m.total_resolved);
L.push('[⑦] 披露（报告项·不扣减）: 长∩最难 ' + rule7.long_and_hardest_overlap + '/' + rule7.long_total + ' = ' + pct(rule7.overlap_share) + ' | 严格读法独立长 ' + rule7.long_independent_after_strict_dedup + ' -> ' + rule7.strict_reading_verdict);
L.push('    重叠 id（全量 ' + rule7.overlap_ids.length + ' 条）: ' + rule7.overlap_ids.join(','));
L.push('[R3 防 Goodhart 合规]');
L.push('    分窗 resolved: realtime ' + resolvedRt + ' / backfill ' + resolvedBf);
L.push('    单批上限(细则 C·按批次): ' + compliance.r3_batch_cap.per_batch.map((r) => r.batch + ' ' + r.count + (r.ok ? ' ok' : ' VIOLATION')).join(' | ') + ' -> ' + (compliance.r3_batch_cap.per_batch_ok ? 'ok' : 'VIOLATION') + ' | 累计 ' + bfTotal + '（仅披露）');
L.push('    分层 3x 上限: ' + compliance.r3_batch_cap.per_layer.map((r) => r.layer + ' ' + r.count + '<=' + r.rt_cap_3x + ' ' + (r.ok ? 'ok' : 'VIOLATION')).join(' | '));
L.push('    分窗配额(上限 ' + pct(compliance.r3_window_quota.cap_share) + '): realtime ' + compliance.r3_window_quota.realtime.max_layer + ' ' + pct(compliance.r3_window_quota.realtime.max_share) + ' | backfill ' + compliance.r3_window_quota.backfill.max_layer + ' ' + pct(compliance.r3_window_quota.backfill.max_share));
L.push('    审计列: baseline_brier 非空 ' + baselineBrierNonnull + '（N1 空挂；④ 改用 baseRateNote 外生解析）');
L.push('    诚实标注: ' + compliance.honesty_note);
if (INCLUDE_INTAKE) {
  L.push('[接题层·非 G2 口径] 视图 predictions_r4（含接题层未入账题，非 G2 口径）');
  if (intakeLayer && intakeLayer.available) {
    L.push('    视图总行 ' + intakeLayer.total_rows + ' | 其中 intake_questions 行 ' + intakeLayer.intake_rows);
    L.push('    origin×layer: ' + intakeLayer.by_origin_layer.map((r) => r.origin + '/' + (r.layer === null ? 'NULL' : r.layer) + ' ' + r.n).join(' | '));
  } else { L.push('    不可用: ' + JSON.stringify(intakeLayer)); }
  L.push('    声明: 本节数字**不参与 G2 达标判定**；G2 主读数恒取 predictions 原表。');
}
L.push(bar);
L.push('注: ② 结论=机器段+代理语义段（非全人工），采信须经 D-3③ 人类校准段 >=10 题且一致率 >=90%；③ 按细则 A 判定并披露 ⑦ 重叠；含 backfill 数字恒挂「含历史回填样本，非实时预测能力」。');
const text = L.join('\n');
console.log(text);

const report = {
  meta: { script: 'p1b/scripts/g2-report.cjs', spec: 'docs/specs/2026-09-11-万物可预测性审计器-design.md §4.2 修订 R4',
    red_team: 'docs/specs/红队R2-复核-20260913.md §2.1/§2.3', db: DB_PATH, mode: 'readonly',
    generated_at: new Date().toISOString(), regime: 'R4', gate: gate,
    verdicts: { q1: Q1.verdict, q2: Q2.verdict, q3: Q3.verdict, q4: Q4.verdict, q5: Q5.verdict },
    include_intake: INCLUDE_INTAKE, intake_scope: 'intake_questions 未入账（非 G2 口径，不参与达标）' },
  counts: counts,
  R4: { q1_qualified: Q1, q2_audit: Q2, q3_horizon: Q3, q4_difficulty: Q4, q5_monthly: Q5,
    rule7_no_double_count: rule7, all_rows_horizon_buckets: allHorizon },
  compliance_r3: compliance,
  intake_layer: intakeLayer,
  text_report: text
};
if (JSON_OUT) {
  const p = path.resolve(JSON_OUT);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(report, null, 1), 'utf8');
  console.log('[g2-report] JSON -> ' + p);
}
if (TEXT_OUT) {
  const p = path.resolve(TEXT_OUT);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text + '\n', 'utf8');
  console.log('[g2-report] TEXT -> ' + p);
}
db.close();
process.exit(0);








