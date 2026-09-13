'use strict';
/**
 * p1b/src/routes/auditKpi.js —— 审计页 KPI 只读端点（UI 重构 §3 KPI 行数据源）。
 *
 * GET /api/audit/g2-kpi → 200 {
 *   kpi: { qualified_pool, hardest, out_of_domain, out_of_regime, unlayered, regime_rows, tautology_rows },
 *   layer_brier_ci: [{ layer, n, brier, ci_lo, ci_hi }],
 *   generated_at, note, spec_ref }
 *
 * 口径铁律（与 p1b/scripts/g2-report.cjs §4.2 修订 R4 + §4.2.1 细则 A/B 同源）：
 *   合格池 = R4 ① 合格题累计（cutoff 合规按题源分流：realtime=created_at / backfill=matures_at-1 天；
 *            须有 resolve 参数、非重言）；最难档 = R4 ④ 外生基线 b(1−b) ≥ 0.21（b 解析自 evidence.baseRateNote）。
 *   门域外 = g2_regime 非 'R4'（含 NULL）行数；未分层 = layer IS NULL 行数。
 *   Brier 置信区间 = 均方误差均值的正态近似（n≥30 才给；否则 null=如实留空，禁编造）。
 * **纯 SQL 只读 · 零 LLM · 零写**；不改变既有 /api/audit/summary 契约（本文件为新增只读端点）。
 * ⚠ 口径若变更，必须同时更新 g2-report.cjs 与本文件（两处同源，勿单改一处）。
 */
const { db } = require('../deps');
const FORWARD_MARKER = '【forward】';
const BACKFILL_MARK = '【backfill】';

function parseBaseRate(note) {
  if (!note) return null;
  let m = /占\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (m) return parseFloat(m[1]) / 100;
  m = /基率\s*[=:：]\s*(?:组合数理论值\s*)?([0-9]*\.?[0-9]+)/.exec(note);
  if (m) { const v = parseFloat(m[1]); return v > 1 ? v / 100 : v; }
  m = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (m) return parseFloat(m[1]) / 100;
  return null;
}
function minusOneDay(ds) {
  const t = new Date(String(ds) + 'T00:00:00Z').getTime();
  return isNaN(t) ? null : new Date(t - 86400000).toISOString().slice(0, 10);
}
/** R4 ①（合格池）/ ④（最难档）+ 门域外计数（纯 SQL 只读） */
function computeKpi() {
  const conn = db.getConnection();
  const rows = conn.prepare(
    "SELECT id, created_at, matures_at, outcome, statement, tautology,"
    + " (SELECT json_extract(e.value,'$.resolve.date') FROM json_each(evidence_json) e WHERE json_extract(e.value,'$.resolve.date') IS NOT NULL LIMIT 1) AS rd,"
    + " (SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn"
    + " FROM predictions WHERE g2_regime = 'R4'"
  ).all();
  let qualified = 0; let hardest = 0; let tautology = 0;
  for (const r of rows) {
    if (!r.rd) continue;
    const bf = String(r.statement || '').indexOf(BACKFILL_MARK) >= 0;
    const hasMat = r.matures_at !== null && r.matures_at !== undefined && String(r.matures_at) !== '';
    let cutoff = null;
    if (bf) { if (!hasMat) continue; cutoff = minusOneDay(r.matures_at); }
    else cutoff = String(r.created_at).slice(0, 19);
    if (cutoff === null || !(String(cutoff) < String(r.rd))) continue;
    if (Number(r.tautology) === 1) { tautology++; continue; }
    qualified++;
    const b = parseBaseRate(r.brn);
    if (b !== null && b * (1 - b) >= 0.21) hardest++;
  }
  const outOfRegime = conn.prepare("SELECT COUNT(*) AS n FROM predictions WHERE g2_regime IS NULL OR g2_regime <> 'R4'").get().n;
  const unlayered = conn.prepare('SELECT COUNT(*) AS n FROM predictions WHERE layer IS NULL').get().n;
  return { qualified_pool: qualified, hardest: hardest, out_of_domain: outOfRegime, out_of_regime: outOfRegime,
    unlayered: unlayered, regime_rows: rows.length, tautology_rows: tautology };
}

/** 分层校准参考 + 正态近似置信区间（n<30 留空） */
function brierCi() {
  const conn = db.getConnection();
  const e2 = "(assigned_prob-(outcome='true'))*(assigned_prob-(outcome='true'))";
  const rows = conn.prepare(
    'SELECT layer,'
    + " SUM(CASE WHEN outcome IN ('true','false') AND assigned_prob IS NOT NULL THEN 1 ELSE 0 END) AS n,"
    + " SUM(CASE WHEN outcome IN ('true','false') AND assigned_prob IS NOT NULL THEN " + e2 + " ELSE 0 END) AS s2,"
    + " SUM(CASE WHEN outcome IN ('true','false') AND assigned_prob IS NOT NULL THEN " + e2 + "*" + e2 + " ELSE 0 END) AS s4"
    + ' FROM predictions GROUP BY layer ORDER BY layer IS NULL ASC, layer ASC'
  ).all();
  return rows.map((r) => {
    const layer = r.layer === undefined ? null : r.layer;
    if (!r.n) return { layer: layer, n: 0, brier: null, ci_lo: null, ci_hi: null };
    const brier = r.s2 / r.n;
    let lo = null; let hi = null;
    if (r.n >= 30) {
      const var1 = Math.max(0, (r.s4 - r.n * brier * brier) / (r.n - 1));
      const se = Math.sqrt(var1 / r.n);
      lo = Math.max(0, brier - 1.96 * se);
      hi = Math.min(1, brier + 1.96 * se);
    }
    return { layer: layer, n: r.n, brier: Number(brier.toFixed(6)),
      ci_lo: lo === null ? null : Number(lo.toFixed(6)), ci_hi: hi === null ? null : Number(hi.toFixed(6)) };
  });
}

/** 分层 × gate 计数（矩阵表 gate 列） */
function layerGate() {
  return db.getConnection().prepare(
    'SELECT layer, gate, COUNT(*) AS n FROM predictions GROUP BY layer, gate ORDER BY layer IS NULL ASC, layer ASC, gate IS NULL ASC, gate ASC'
  ).all().map((r) => ({ layer: r.layer === undefined ? null : r.layer, gate: r.gate === undefined ? null : r.gate, n: r.n }));
}

function register(app) {
  app.get('/api/audit/g2-kpi', async () => ({
    ok: true,
    kpi: computeKpi(),
    layer_brier_ci: brierCi(),
    layer_gate: layerGate(),
    generated_at: new Date().toISOString(),
    spec_ref: 'design §4.2 修订 R4 / §4.2.1 细则 A/B（与 g2-report.cjs 同源）',
    note: '审计页 KPI 只读端点：合格池 / 最难档 / G2 域外计数 + 分层校准参考置信区间（n<30 留空）。纯 SQL 只读、零 LLM、零写；既有 /api/audit/summary 契约不变。',
  }));
}

module.exports = { register, computeKpi, brierCi, layerGate, parseBaseRate };
