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

// ── 口径 B（2026-09-14 · 微步 2）：date_derivations 换算器（additive；依微步 1 契约表扩展）──
// 行为: resolve.date 存在→原样（现状不变）；缺失→按 kind 查规则换算 effective_date 入池；
//       有规则但换算失败→仍排除＋计数 failed（不静默丢）；无规则→维持 no_resolve_date。
const DD_FILE = path.join(ROOT, 'p1b', 'sim', 'out', 'g2-contract-frozen-r4.json');
const DD_VERSION = '2026-09-14';
const countsDD = { enabled: false, version: DD_VERSION, file: DD_FILE, sha256: null, previous_sha256: null, rules: 0,
  derived_rows: 0, derived_by_kind: {}, failed_rows: 0, failed_by_kind: {}, failed_ids_sample: [] };
function loadDateDerivations() {
  try {
    const buf = fs.readFileSync(DD_FILE);
    countsDD.sha256 = require('crypto').createHash('sha256').update(buf).digest('hex');
    const doc = JSON.parse(buf.toString('utf8'));
    const rules = doc.date_derivations || {};
    countsDD.enabled = Object.keys(rules).length > 0;
    countsDD.rules = Object.keys(rules).length;
    countsDD.previous_sha256 = doc.previous_sha256 || null;
    return rules;
  } catch (e) { countsDD.error = '契约表加载失败: ' + e.message; return {}; }
}
const DD_RULES = loadDateDerivations();
const ddPad2 = (n) => String(n).padStart(2, '0');
function ddAddDays(ds, n) { const t = new Date(ds + 'T00:00:00Z').getTime(); return isNaN(t) ? null : new Date(t + n * 86400000).toISOString().slice(0, 10); }
function ddMonthlyNextEnd(s) { const m = /^([0-9]{4})-([0-9]{2})$/.exec(s); if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]); if (mo < 1 || mo > 12) return null;
  let ny = y, nm = mo + 1; if (nm > 12) { nm = 1; ny++; }
  return ny + '-' + ddPad2(nm) + '-' + ddPad2(new Date(Date.UTC(ny, nm, 0)).getUTCDate()); }
function ddEpiweek(s) { const m = /^([0-9]{4})([0-9]{2})$/.exec(s); if (!m) return null;
  const y = Number(m[1]), n = Number(m[2]); if (n < 1 || n > 53) return null;
  const dow = new Date(Date.UTC(y, 0, 4)).getUTCDay(); // 1月4日星期（周日=0）；MMWR 第1周=含1/4、周日起始
  const s1 = ddAddDays(y + '-01-04', 6 - dow); return s1 ? ddAddDays(s1, (n - 1) * 7) : null; } // S1=第1周周六
function ddBomWeek(s) { const m = /^([0-9]{4})W([0-9]{2})$/.exec(s); if (!m) return null;
  const n = Number(m[2]); if (n < 1 || n > 53) return null;
  return ddAddDays(m[1] + '-01-04', (n - 1) * 7); } // BOM 周末末日=年内第 NN 个周日（2026 W1 末=01-04，微步1 网页实测）
function ddDraw(s) { // 锚期反推（仅 2026 年段有锚，跨年需新锚——微步1 收据）：7位=SSQ 日/二/四；5位=DLT 一/三/六
  const cfg = { 7: { yl: 4, year: 2026, issue: 106, date: '2026-09-13', offs: [0, 2, 4] }, 5: { yl: 2, year: 26, issue: 105, date: '2026-09-14', offs: [0, 2, 5] } }[s.length];
  if (!cfg) return null;
  const y = Number(s.slice(0, cfg.yl)); if (y !== cfg.year) return null; // 7位年=2026（4位）；5位年段=26（2位）
  const k = Number(s.slice(cfg.yl)) - cfg.issue;
  return ddAddDays(cfg.date, Math.floor(k / 3) * 7 + cfg.offs[((k % 3) + 3) % 3]); }
function tryDerive(r) {
  let kind = null, resolve = null;
  try { if (r.rj) { const o = JSON.parse(r.rj); resolve = o.resolve || null; kind = resolve ? resolve.kind : null; } }
  catch (e) { return { ok: false, kind: null, reason: 'resolve_json_parse' }; }
  if (!kind) return { ok: false, kind: null, reason: 'no_kind' };
  const rule = DD_RULES[kind];
  if (!rule) return { ok: false, kind: kind, reason: 'no_rule' };
  const sv = resolve[rule.source_key];
  if (sv === undefined || sv === null) return { ok: false, kind: kind, reason: 'source_key_missing:' + rule.source_key };
  const s = String(sv); let out = null;
  if (rule.granularity === 'daily') out = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) ? s : null;
  else if (rule.granularity === 'monthly') out = ddMonthlyNextEnd(s);
  else if (rule.granularity === 'yearly') out = /^[0-9]{4}$/.test(s) ? (Number(s) + 1) + '-12-31' : null;
  else if (rule.granularity === 'weekly') { // 按源值格式分流：YYYYWW=MMWR周六；YYYYWNN=BOM 周日末日；日期=窗口末日(+6)
    if (/^[0-9]{6}$/.test(s)) out = ddEpiweek(s);
    else if (/^[0-9]{4}W[0-9]{2}$/.test(s)) out = ddBomWeek(s);
    else if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) out = ddAddDays(s, 6);
  } else if (rule.granularity === 'draw') out = ddDraw(s);
  if (!out) return { ok: false, kind: kind, reason: 'derive_failed:' + rule.granularity + ':' + s };
  return { ok: true, kind: kind, date: out };
}


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
// #1（批次1，专家会统一清单 #1）：D2 回测题不进 G2 门域。
// 依据 D2 §8.2 修订 R1（2026-09-13）：回测题必写 metric_version（口径世代）/backtest_batch（批次 id），
// 两列非空即判为回测题 → 排除出 ① 池，并计入「门域外行数」告警。两列当前全 NULL ⇒ 排除为 no-op，读数不变。
const HAS_BACKTEST_COLS = new Set(all('PRAGMA table_info(predictions)').map((c) => c.name)).has('metric_version')
  && new Set(all('PRAGMA table_info(predictions)').map((c) => c.name)).has('backtest_batch');
const NOT_BACKTEST = HAS_BACKTEST_COLS ? "(p.metric_version IS NULL AND p.backtest_batch IS NULL)" : "(1=1)";
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
  + "p.outcome, p.assigned_prob, p.statement, p.checklist_hash, p.tautology, "
  + "(SELECT json_extract(e.value,'$.resolve.date') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.date') IS NOT NULL LIMIT 1) AS rd, "
  + "(SELECT e.value FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind') IS NOT NULL LIMIT 1) AS rj, "
  + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn "
  + "FROM predictions p WHERE " + REGIME + " AND " + NOT_BACKTEST;
const rows = all(ROWS_SQL);

// #1（批次1）：门域外计数（账本总行 / 回测排除行 / 非 R4 行域行）——「不能让下一批再静默出域」
const ledgerRows = one('SELECT COUNT(*) n FROM predictions').n;
const backtestRows = one('SELECT COUNT(*) n FROM predictions p WHERE ' + REGIME + ' AND NOT ' + NOT_BACKTEST).n;
const outOfRegimeRows = ledgerRows - rows.length - backtestRows;
const counts = { ledger_rows: ledgerRows, regime_rows: rows.length, regime_rows_raw: rows.length + backtestRows,
  backtest_excluded_rows: backtestRows, out_of_regime_rows: outOfRegimeRows,
  backtest_columns_present: HAS_BACKTEST_COLS,
  backfill_rows: 0, excluded: {}, tautology_rows: 0, b_unparsed_ids: [] };
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
  let rdEff = r.rd, ddInfo = null;
  if (!rdEff) {
    const dd = tryDerive(r);
    if (dd.ok) { rdEff = dd.date; ddInfo = dd; countsDD.derived_rows++; bump(countsDD.derived_by_kind, dd.kind); }
    else if (dd.reason === 'no_rule' || dd.reason === 'no_kind' || dd.reason === 'resolve_json_parse') { bump(counts.excluded, 'no_resolve_date'); continue; }
    else {
      bump(counts.excluded, 'no_resolve_date');
      countsDD.failed_rows++; bump(countsDD.failed_by_kind, dd.kind || 'unknown');
      if (countsDD.failed_ids_sample.length < 10) countsDD.failed_ids_sample.push(r.id);
      continue;
    }
  }
  let cutoff = null, cutoffMode = null;
  if (bf) {
    if (!hasMat) { bump(counts.excluded, 'backfill_no_forwardLooking'); continue; }
    cutoff = minusOneDay(r.matures_at); cutoffMode = 'matures_at_minus_1d';
  } else { cutoff = String(r.created_at).slice(0, 19); cutoffMode = 'created_at'; }
  if (cutoff === null || !(String(cutoff) < String(rdEff))) { bump(counts.excluded, 'cutoff_not_before_event'); continue; }
  if (ddInfo && r.created_at) { // 口径 B：derived 行 horizon 按发布日口径（effective_date - created_at）
    const t1 = new Date(rdEff + 'T00:00:00Z').getTime();
    const t0 = new Date(String(r.created_at).replace(' ', 'T') + 'Z').getTime();
    if (!isNaN(t1) && !isNaN(t0)) hDays = (t1 - t0) / 86400000;
  }
  if (Number(r.tautology) === 1) { counts.tautology_rows++; continue; }
  const pr = parseBaseRate(r.brn);
  if (!pr) counts.b_unparsed_ids.push(r.id);
  const bb = pr ? pr.b : null;
  const hardest = bb !== null && bb * (1 - bb) >= 0.21;
  const bucket = hDays === null ? 'unknown' : (hDays < 0 ? 'past_or_negative' : (hDays <= 7 ? 'short' : (hDays <= 30 ? 'mid' : 'long')));
  // #12 域维度（A7）：kind 取自题面 evidence 的 resolve.kind，缺则退 dates 派生 kind，再退占位
  const evKind = (() => { if (r.rj) { try { const o = JSON.parse(r.rj); return (o.resolve && o.resolve.kind) || null; } catch (e) { return null; } } return null; })();
  pool.push({ id: r.id, layer: r.layer, created_at: r.created_at, matures_at: r.matures_at, resolved_at: r.resolved_at,
    resolved: r.outcome !== null && r.outcome !== undefined, outcome: r.outcome, assigned_prob: r.assigned_prob,
    backfill: bf, cutoff: cutoff, cutoff_mode: cutoffMode, effective_date: rdEff, rd_derived: ddInfo ? ddInfo.kind : null,
    kind: evKind || (ddInfo ? ddInfo.kind : null),
    b: bb, b_pattern: pr ? pr.pattern : null, brn: r.brn || null,
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
Q1.date_derivation = { version: DD_VERSION, enabled: countsDD.enabled, contract_sha256: countsDD.sha256, rules: countsDD.rules,
  derived_rows: countsDD.derived_rows, derived_by_kind: countsDD.derived_by_kind,
  failed_rows: countsDD.failed_rows, failed_by_kind: countsDD.failed_by_kind, failed_ids_sample: countsDD.failed_ids_sample,
  note: '口径 B（2026-09-14）：无 resolve.date 但 date_derivations[kind] 可换算的题以 effective_date（发布日口径）入池；cutoff 判定不变（细则 B）；derived 行 horizon 按发布日口径；换算失败行计入 failed_*（不静默丢）' };

// ── #12 域分布披露（专家会统一清单 #12 / 红队 A7；report_only，不改门判定）──
// 问题（A7）：① 池无多样性下限、② 分层无域维度 ⇒ 单 kind 族可上百，坏题在样本中被稀释。
// 处置：披露单 kind 族占比；单族 >50% 时 ② 样本对该族等量降权（本件只**披露**降权系数，
//   实际重抽样由 audit 清单生成侧按 design §4.2.5 A 轴执行）。
const DOMAIN_FLOOR = 0.5;
const domainCount = pool.reduce((a, p) => {
  const k = (p.kind || (p.backfill ? 'backfill_unknown' : 'forward_unknown'));
  a[k] = (a[k] || 0) + 1; return a;
}, {});
const domainRows = Object.keys(domainCount).map((k) => ({ kind: k, n: domainCount[k], share: eligible ? domainCount[k] / eligible : 0 }))
  .sort((x, y) => y.n - x.n);
const domainMax = domainRows.length ? domainRows[0] : null;
const Q12 = {
  report_only: true,
  metric: '① 池域分布（kind 族占比）+ 单族 >50% 时 ② 样本等量降权（design §4.2.5 A 轴）',
  domain_floor: DOMAIN_FLOOR,
  pool_n: eligible,
  by_layer_domain_note: '② 分层维度扩为 layer × horizon × 域（design §4.2.5 A 轴第 1 条）',
  top_domains: domainRows.slice(0, 10),
  max_domain: domainMax ? { kind: domainMax.kind, n: domainMax.n, share: domainMax.share,
    triggers_downweight: domainMax.share > DOMAIN_FLOOR,
    downweight_factor: domainMax.share > DOMAIN_FLOOR ? Number((1 / domainMax.share).toFixed(4)) : 1 } : null,
};


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
  metric: '外生基线 Brier 下限 b(1-b) >= 0.21（等价于基率 [0.30, 0.70]；原文档误写 0.35–0.65，见 design §4.2.2 B1）；b 解析自 evidence.baseRateNote',
  forbid: '禁用 assigned_prob / 判词输出来源（红队 R1-F7 循环度量）',
  by_layer: hardestByLayer,
  hardest_realtime: hardestRt.length, hardest_backfill: hardestBf.length,
  parse_coverage: { pool_with_b: pool.filter((p) => p.b !== null).length, pool_unparsed: pool.filter((p) => p.b === null).length,
    unparsed_ids: counts.b_unparsed_ids.slice(0, 20) },
  b_patterns: pool.reduce((a, p) => { if (p.b_pattern) a[p.b_pattern] = (a[p.b_pattern] || 0) + 1; return a; }, {}) };Q4.verdict = Q4.pass ? 'PASS' : 'FAIL';

// ── #13 基率窗口质量（专家会统一清单 #13 / A12+B-L3；report_only，不参与门判定）──
// 问题（B-L3）：④「外生基率」的 b 现算自 text（baseRateNote），但 note 里的**历史窗口样本量**未被
//   结构化，薄窗（如 n=15 的彩票「近 15 期」）与 n=300 的天气题在 ④ 下同权；b̂ 的抽样误差未量化
//   （n=19 时 SE≈0.105，成员资格带噪声）。
// 处置：① 从 note 抽取样本量 n（保守：取**最小**的 n——拒绝「2015-2024 共 300 个日值」这类窗口总长
//          误当样本量）；② 给 Wilson 95% 区间；③ 披露薄窗清单；④ 报「b̂ 取 Wilson 上界仍 ≥0.30 的
//          最难档数」＝**b̂ 偏低估时仍守住难度资格**的保守口径（真值=完整口径，本项只作稳健性披露）。
// 生效方式：**纯披露**，Q4 主判据一字不改（若改判即须走 R5 版本递进，见 design §4.2.2 B3）。
function parseNoteN(note) {
  if (!note) return null;
  const ns = [];
  // 三种句式（保守取最小 n，防「2015-2024 共 300 个日值」类窗口总长被放大）：
  //   a) 共/近/前/上 + N + 个/天/月/期/条
  //   b) N + 个/天/月/期 + 的/中/值      （「96 天 … 中」「已发布 331 个月值中」——中间可夹修饰语）
  //   c) 已发布/已开奖 N 个/期           （dbnomics 等「pre-cutoff 已发布 331 个月值中」）
  const res = [
    /(?:共|近|前|上)\s*([0-9]+)\s*(?:个|天|月|期|条)/g,
    /([0-9]+)\s*(?:个|天|月|期)[^0-9%]{0,12}?(?:的|中|值)/g,
    /(?:已发布|已开奖|已结算)\s*([0-9]+)\s*(?:个|天|月|期|条)/g,
  ];
  for (const re of res) {
    let m; while ((m = re.exec(note)) !== null) { const v = Number(m[1]); if (isFinite(v) && v > 0 && v < 100000) ns.push(v); }
  }
  return ns.length ? Math.min.apply(null, ns) : null;
}
function wilsonLower(k, n, z) {
  if (!n) return null;
  const z2 = z * z, ph = k / n;
  return (ph + z2 / (2 * n) - z * Math.sqrt((ph * (1 - ph) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}
function wilsonUpper(k, n, z) { return k === 0 ? z * z / (n + z * z) : (1 - wilsonLower(n - k, n, z)); }
for (const p of pool) {
  p.note_n = parseNoteN(p.brn);
  p.b_ci_hi = (p.b !== null && p.note_n !== null && p.note_n >= 2) ? wilsonUpper(p.b * p.note_n, p.note_n, 1.96) : null;
}
const hardestWithN = hardestPool.filter((p) => p.note_n !== null);
const T13_THIN = 30;
const thinWindow = hardestWithN.filter((p) => p.note_n < T13_THIN);
const hardestRobust = hardestWithN.filter((p) => p.b_ci_hi !== null && p.b_ci_hi >= 0.30);
const Q13 = {
  report_only: true,
  metric: '基率窗口样本量结构化 + Wilson 95% 区间（A12/B-L3）',
  pool_b_with_n: pool.filter((p) => p.note_n !== null).length,
  pool_b_total: pool.filter((p) => p.b !== null).length,
  n_parse_coverage: 'note_n 抽取覆盖（保守取最小 n，防窗口总长误当样本量）',
  hardest_total: hardestPool.length,
  hardest_with_n: hardestWithN.length,
  thin_window_n_lt_30: thinWindow.length,
  thin_window_ids_sample: thinWindow.slice(0, 20).map((p) => p.id),
  conservative_robust_value: hardestRobust.length,
  conservative_note: '最难档中 b̂ 的 Wilson 上界仍 >=0.30（即即使 b 被低估仍守住难度资格）的条数；**保守口径，仅披露**',
  n_distribution: hardestWithN.reduce((a, p) => { const k = p.note_n < 30 ? 'lt30' : (p.note_n < 100 ? '30_99' : (p.note_n < 300 ? '100_299' : 'ge300')); a[k] = (a[k] || 0) + 1; return a; }, {}),
};


// ── #7 描述性质量读数（report_only；**不参与门判定**；专家会 B-H1）──
// 口径：① 合格题池中已解且 assigned_prob 非空者；trivial 基线=常数 b / 常数 0.5；Murphy 10 等宽桶
const QUAL_BINS = 10;
const fmt = (x) => (x === null || x === undefined || isNaN(x)) ? 'n/a' : Number(x).toFixed(4);
const qualityRows = pool.filter((p) => p.resolved && p.assigned_prob !== null && p.assigned_prob !== undefined && isFinite(Number(p.assigned_prob)));
const qp = qualityRows.map((p) => Number(p.assigned_prob));
const qy = qualityRows.map((p) => (p.outcome === 'true' || p.outcome === 1 || p.outcome === true) ? 1 : 0);
const qb = qualityRows.map((p) => (p.b !== null ? p.b : 0.5));
const QN = qp.length;
const qmean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const qbrier = (ps, ys) => QN ? ps.reduce((acc, p, i) => acc + Math.pow(p - ys[i], 2), 0) / QN : null;
const bModel = qbrier(qp, qy);
const bBase = qbrier(qb, qy);
const bHalf = qbrier(qp.map(() => 0.5), qy);
const ybar = QN ? qy.reduce((a, b) => a + b, 0) / QN : null;
const qbins = [];
for (let k = 0; k < QUAL_BINS; k++) qbins.push({ k: k, lo: k / 10, hi: (k + 1) / 10, n: 0, sumP: 0, sumY: 0 });
for (let i = 0; i < QN; i++) { let k = Math.min(QUAL_BINS - 1, Math.floor(qp[i] * QUAL_BINS)); if (qp[i] >= 1) k = QUAL_BINS - 1; qbins[k].n++; qbins[k].sumP += qp[i]; qbins[k].sumY += qy[i]; }
let qRel = 0, qRes = 0, qEce = 0;
for (const b of qbins) { if (!b.n) continue; const pb = b.sumP / b.n, yb = b.sumY / b.n; qRel += (b.n / QN) * Math.pow(pb - yb, 2); qRes += (b.n / QN) * Math.pow(yb - ybar, 2); qEce += (b.n / QN) * Math.abs(pb - yb); }
const qUnc = ybar === null ? null : ybar * (1 - ybar);
const quality = {
  report_only: true,
  basis: '① 合格题池 ∧ 已解 ∧ assigned_prob 非空',
  n: QN,
  brier_model: bModel, brier_const_base: bBase, brier_const_half: bHalf,
  delta_brier_vs_base: (bModel !== null && bBase !== null) ? bModel - bBase : null,
  delta_brier_vs_half: (bModel !== null && bHalf !== null) ? bModel - bHalf : null,
  murphy_bins: QUAL_BINS,
  murphy: { reliability: QN ? qRel : null, resolution: QN ? qRes : null, uncertainty: qUnc,
    check_reliability_minus_resolution_plus_uncertainty: (QN && qUnc !== null) ? (qRel - qRes + qUnc) : null },
  ece_binned: QN ? qEce : null,
  ece_annotations: ['binned ECE = 下界估计（桶内平均抹平桶内方差）', '小样本正偏（bin 数固定而 N 小时每桶样本少）'],
  bins: qbins.map((b) => ({ k: b.k, lo: b.lo, hi: b.hi, n: b.n, p_bar: b.n ? b.sumP / b.n : null, y_bar: b.n ? b.sumY / b.n : null })),
  qualifier: 'report_only：不参与 G2 达标判定；G2＝过程能力门，不含预测质量读数（design §4.2.2 B4）'
};

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
      holdout: j.holdout ? { n: j.holdout.n, machine_vs_agent_agreement: j.holdout.machine_vs_agent_agreement } : null,
      contract: (j.meta && j.meta.contract) || null,
      acceptance_status: (j.human_calibration && j.human_calibration.acceptance_status) || null,
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
L.push('行域 g2_regime=R4 且非回测 | 门域 ' + counts.regime_rows + ' 行 / 账本 ' + counts.ledger_rows + ' 行 | 门总判定 ' + gate + '  [G2＝过程能力门，不含预测质量读数]');
L.push((counts.backtest_excluded_rows > 0 || counts.out_of_regime_rows > 0 ? '[!] 门域外告警' : '门域外行数')
  + ': 回测排除 ' + counts.backtest_excluded_rows + ' 行 | 不在 R4 行域 ' + counts.out_of_regime_rows + ' 行 | 合计域外 '
  + (counts.backtest_excluded_rows + counts.out_of_regime_rows) + ' 行'
  + (counts.backtest_columns_present ? '' : '（回测排除子句未生效：库缺 metric_version/backtest_batch 列，请先跑 additive 迁移）'));
L.push(bar);
if (INCLUDE_INTAKE) {
  L.push('!! 含接题层未入账题，非 G2 口径（--include-intake）—— 主判定 Q1-Q5 仍只读 predictions 原表 !!');
  L.push(bar);
}
L.push('[①] 合格题累计 >=60  -> ' + Q1.verdict + '   值 ' + Q1.value + '（resolved ' + Q1.qualified_resolved + '；realtime ' + Q1.qualified_realtime + ' / backfill ' + Q1.qualified_backfill + '）');
L.push('    排除: ' + Object.keys(counts.excluded).map((k) => k + ' ' + counts.excluded[k]).join(' | ') + ' | tautology ' + counts.tautology_rows);
L.push('    ' + Q1.note);
if (countsDD.enabled) {
  L.push('    [口径B·date_derivation v' + DD_VERSION + '] 契约表 sha256=' + String(countsDD.sha256 || '').slice(0, 12) + ' | 规则 ' + countsDD.rules + ' kind');
  L.push('    换算入池 ' + countsDD.derived_rows + ' 行 | 按 kind: ' + Object.keys(countsDD.derived_by_kind).map((k) => k + ' ' + countsDD.derived_by_kind[k]).join(' / '));
  L.push('    换算失败 ' + countsDD.failed_rows + ' 行' + (countsDD.failed_rows ? '（' + Object.keys(countsDD.failed_by_kind).map((k) => k + ' ' + countsDD.failed_by_kind[k]).join(' / ') + '）样本id: ' + countsDD.failed_ids_sample.join(',') : ''));
}
L.push('[②] 抽检合格率 >=70%  -> ' + Q2.verdict + '   值 ' + (Q2.status === 'done' ? pct(Q2.rate) : 'not-yet') + '   ' + (Q2.reason || ('清单 ' + Q2.file + ' n=' + Q2.n + ' ok=' + Q2.ok)));
if (Q2.missing) for (const m of Q2.missing) L.push('    缺: ' + m);
L.push('    抽样（#6e 双轨统一）: 候选池＝分层随机抽样程序产出（不再单列 every-10th）；seed/分层配额/命中率见 audit meta.sampling');
if (Q2.status === 'done') {
  L.push('    复核构成（D-4）: ' + JSON.stringify(Q2.review_composition) + ' — 非全人工复核，不得声称"全人工"');
  const hc = Q2.human_calibration || {};
  const acc = hc.acceptance_status || null;
  L.push('    人类校准段（D-3③ / §4.2.3 R4.2）: ' + JSON.stringify(hc));
  L.push('    采信状态: ' + (acc || 'n/a') + ' | 端用户抽验 ' + (hc.user_spot_check === undefined ? 'n/a' : hc.user_spot_check) + '/' + (hc.user_spot_check_required || 10)
    + '（核验者=' + (hc.user_spot_check_by || 'n/a') + '，有效 ' + (hc.user_spot_check_effective === undefined ? '?' : hc.user_spot_check_effective) + '）'
    + (acc === 'pending_user' ? ' —— 待端用户抽验 >=10 题（代理不能代替端用户）' : '')
    + (acc === 'pending_user_agent_surrogate' ? ' —— 现存为**代理预核**，不满足端用户独立核验必要条件（effective=0）' : ''));
  if (Q2.holdout) L.push('    留出集重验（与抽检样本不重叠）: n=' + Q2.holdout.n + ' 机器段 vs 代理语义段 ' + JSON.stringify(Q2.holdout.machine_vs_agent_agreement));
  if (Q2.contract) L.push('    契约表: ' + Q2.contract.file + ' sha256=' + String(Q2.contract.sha256 || '').slice(0, 12) + '（contracts ' + Q2.contract.contracts + ' / aliases ' + Q2.contract.aliases + '；按 resolver 源码冻结，禁观测交集）');
  if (Q2.human_calibration_settlement) L.push('    校准结账: 修正后 ' + Q2.human_calibration_settlement.post_fix_alignment + '；待办 ' + (Q2.human_calibration_settlement.pending || []).join('；'));
}

L.push('[③] horizon 三层 短>=20 中>=20 长>=10(须 realtime)  -> ' + Q3.verdict);
L.push('    短 ' + Q3.buckets.short + ' | 中 ' + Q3.buckets.mid + ' | 长 ' + Q3.buckets.long + ' | 未知 ' + Q3.buckets.unknown_horizon + ' | past_or_negative(backfill) ' + Q3.buckets.past_or_negative + ' | 长中 backfill ' + Q3.long_must_be_realtime.long_backfill);
L.push('    本细则读法（§4.2.1 A）：长 ' + Q3.buckets.long + ' -> ' + (Q3.long_pass ? 'PASS' : 'FAIL') + ' | 严格读法对照：独立长 ' + Q3.strict_reading_for_record.long_independent + ' -> ' + Q3.strict_reading_for_record.verdict);
L.push('    ⑦披露（报告项）: 长∩最难 ' + Q3.rule7_disclosure.long_and_hardest_overlap + '/' + Q3.rule7_disclosure.long_total + ' = ' + pct(Q3.rule7_disclosure.overlap_share));
L.push('[④] 难度最难档 b(1-b)>=0.21（等价于基率 [0.30, 0.70]）且 >=20  -> ' + Q4.verdict + '   值 ' + Q4.value + '（realtime ' + Q4.hardest_realtime + ' / backfill ' + Q4.hardest_backfill + '；外生解析覆盖 ' + Q4.parse_coverage.pool_with_b + '/' + (Q4.parse_coverage.pool_with_b + Q4.parse_coverage.pool_unparsed) + '；模式 ' + JSON.stringify(Q4.b_patterns) + '）');
L.push('[质量读数·report_only·不参与门判定]（G2＝过程能力门，不含预测质量读数）');
L.push('[#13 基率窗口质量·report_only·不参与门判定]（A12/B-L3：b 的抽样误差未量化过）');
L.push('    note_n 覆盖: ' + Q13.pool_b_with_n + '/' + Q13.pool_b_total + '（b 可解析行中能抽出样本量的比例）');
L.push('    最难档 ' + Q13.hardest_total + ' 条中可抽 n 者 ' + Q13.hardest_with_n + '；n 分布 ' + JSON.stringify(Q13.n_distribution));
L.push('    薄窗(n<30) 最难档 ' + Q13.thin_window_n_lt_30 + ' 条' + (Q13.thin_window_ids_sample.length ? ('（抽样 id: ' + Q13.thin_window_ids_sample.join(',') + '）') : '') + '  [b̂ 的 SE 在 n<30 时显著，成员资格有噪声]');
L.push('    保守稳健读数: b̂ 的 Wilson 上界仍 >=0.30 的最难档 ' + Q13.conservative_robust_value + ' / ' + Q13.hardest_with_n + '（即使 b 低估仍守资格）——**仅披露，不改 ④ 判据**');
L.push('[#12 池域分布·report_only·不参与门判定]（A7：防单 kind 族灌水稀释）');
L.push('    top 域: ' + Q12.top_domains.slice(0, 6).map((d) => d.kind + ' ' + d.n + ' (' + pct(d.share) + ')').join(' | '));
if (Q12.max_domain) L.push('    单族最大: ' + Q12.max_domain.kind + ' ' + Q12.max_domain.n + ' = ' + pct(Q12.max_domain.share) + (Q12.max_domain.triggers_downweight ? ('  >50% ⇒ ② 样本对该族等量降权 ×' + Q12.max_domain.downweight_factor) : '  <=50%（未触发降权）'));

L.push('    n=' + quality.n + ' | Brier_model=' + fmt(quality.brier_model) + ' | 常数基率基线=' + fmt(quality.brier_const_base) + ' | 常数 0.5 基线=' + fmt(quality.brier_const_half));
L.push('    ΔBrier(vs 常数基率)=' + fmt(quality.delta_brier_vs_base) + ' | ΔBrier(vs 0.5)=' + fmt(quality.delta_brier_vs_half) + '（<0 才有 resolution 迹象）');
L.push('    Murphy(10 等宽桶): reliability=' + fmt(quality.murphy.reliability) + ' resolution=' + fmt(quality.murphy.resolution) + ' uncertainty=' + fmt(quality.murphy.uncertainty));
L.push('    ECE(binned)=' + fmt(quality.ece_binned) + '  [binned ECE=下界估计 + 小样本正偏]');
L.push('[⑤] 月节律（仅报告·不作门）');
for (const m of Q5.months) L.push('    ' + m.m + '  realtime ' + m.realtime_resolved + ' / backfill ' + m.backfill_resolved + ' / total ' + m.total_resolved);
L.push('[⑦] 披露（报告项·不扣减）: 长∩最难 ' + rule7.long_and_hardest_overlap + '/' + rule7.long_total + ' = ' + pct(rule7.overlap_share) + ' | 严格读法独立长 ' + rule7.long_independent_after_strict_dedup + ' -> ' + rule7.strict_reading_verdict);
L.push('    重叠 id（全量 ' + rule7.overlap_ids.length + ' 条）: ' + rule7.overlap_ids.join(','));
L.push('[R3 防 Goodhart 合规]');
L.push('    分窗 resolved: realtime ' + resolvedRt + ' / backfill ' + resolvedBf);
L.push('    单批上限(细则 C·按批次): ' + compliance.r3_batch_cap.per_batch.map((r) => r.batch + ' ' + r.count + (r.ok ? ' ok' : ' VIOLATION')).join(' | ') + ' -> ' + (compliance.r3_batch_cap.per_batch_ok ? 'ok' : 'VIOLATION') + ' | 累计 ' + bfTotal + '（仅披露）');
L.push('    分层 3x 上限: ' + compliance.r3_batch_cap.per_layer.map((r) => r.layer + ' ' + r.count + '<=' + r.rt_cap_3x + ' ' + (r.ok ? 'ok' : 'VIOLATION')).join(' | '));
L.push('    分窗配额(上限 ' + pct(compliance.r3_window_quota.cap_share) + '): realtime ' + compliance.r3_window_quota.realtime.max_layer + ' ' + pct(compliance.r3_window_quota.realtime.max_share) + ' | backfill ' + compliance.r3_window_quota.backfill.max_layer + ' ' + pct(compliance.r3_window_quota.backfill.max_share));
L.push('    审计列: baseline_brier 非空 ' + baselineBrierNonnull + '（**已废弃**：专家会盲区⑦裁决=废弃而非补齐；④ 走 baseRateNote 现算旁路，见 design §4.2.2）');
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
L.push('注: ② 结论=机器段+代理语义段（非全人工）；采信按 design §4.2.3 修订 R4.2（全过 n>=35 或 Wilson 95% 下界 >=0.90）且端用户抽验 >=10 题为必要条件；G2＝过程能力门，不含预测质量读数；③ 按细则 A 判定并披露 ⑦ 重叠；含 backfill 数字恒挂「含历史回填样本，非实时预测能力」。');
const text = L.join('\n');
console.log(text);

const report = {
  meta: { script: 'p1b/scripts/g2-report.cjs', spec: 'docs/specs/2026-09-11-万物可预测性审计器-design.md §4.2 修订 R4',
    red_team: 'docs/specs/红队R2-复核-20260913.md §2.1/§2.3', db: DB_PATH, mode: 'readonly',
    generated_at: new Date().toISOString(), regime: 'R4', gate: gate,
    verdicts: { q1: Q1.verdict, q2: Q2.verdict, q3: Q3.verdict, q4: Q4.verdict, q5: Q5.verdict },
    date_derivation_version: DD_VERSION, contract_sha256: countsDD.sha256,
    include_intake: INCLUDE_INTAKE, intake_scope: 'intake_questions 未入账（非 G2 口径，不参与达标）' },
  counts: counts,
  R4: { q1_qualified: Q1, q2_audit: Q2, q3_horizon: Q3, q4_difficulty: Q4, q5_monthly: Q5,
    rule7_no_double_count: rule7, all_rows_horizon_buckets: allHorizon },
  quality_report_only: quality,
  baserate_window_quality_report_only: Q13,
  pool_domain_distribution_report_only: Q12,
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








