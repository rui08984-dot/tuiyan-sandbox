'use strict';
/**
 * p1b/src/routes/audit.js —— 万物审计器仪表盘聚合端点（G1 反馈 #3 · M2，/audit 页数据源）：
 *   GET /api/audit/summary → 200 {
 *     l0_gate:            predictionsStore.l0Gate()（双口径 records/records_valid +
 *                         resolved/unresolved/games/review_unlocked，原样透出）,
 *     by_layer_checklist: [{ layer, checklist_hash, n, tautology_n } ...]（layer×checklist_hash
 *                         分组计数 + 组内 tautology=1 计数；NULL 组原样返回 null，由 UI 标「未分层」）,
 *     by_gate:            [{ gate, n } ...]（gate 分组计数）,
 *     layer_calibration:  [{ layer, n, resolved, ambiguous, settled, brier, brier_n,
 *                          base_rate, base_rate_n } ...]（按 layer 聚合账本；Brier = 已 resolve
 *                          真值且 assigned_prob 非空题上的 (p−y)² 均值，brier_n=0 时=brier null
 *                          （样本不足不编造）；base_rate = settled（true/false）中 true 占比）,
 *     pending_forward:    未 resolve 的【forward】前瞻题清单（id/statement/assigned_prob/layer/
 *                          event_day/target），按事件日升序（无日粒度排后）limit 50,
 *     pending_forward_total: 前瞻题总数（截断前，供 UI 标「显示前 50 / 共 M」）,
 *     total, generated_at, note }
 *
 * 边界铁律（写死）：纯 SQL 只读 + 只读字符串解析、零 LLM、零网络——本端点只透出账本与机械
 * 算术，不含任何「预测」宣称字样；l0_gate.review_unlocked=false 时 UI 一切数字只配「参考」。
 * · Brier/基率只在已回填真值的题上做机械算术；样本不足 → null（禁编造数字）。
 * · event_day 从题面「前瞻标记之后、cutoff 之前」的目标段首个 YYYY-MM-DD 机械抽取
 *   （月频/期号类题无日粒度 → null，target 字段保留目标期文本）。
 * ensurePredictionsTable 放 register 内（predictions p10 W1 同先例）：幂等 additive，端点自足。
 */
const { db } = require('../deps');
const store = require('../db/predictionsStore');

const FORWARD_MARKER = '【forward】';
const CUTOFF_MARK = '（cutoff=';
const FORWARD_LIMIT = 50;

/** 题面 → 目标段（前瞻标记之后、cutoff 之前；无标记则整句） */
function forwardTarget(statement) {
  const s = String(statement === null || statement === undefined ? '' : statement);
  const i = s.indexOf(FORWARD_MARKER);
  const body = i === -1 ? s : s.slice(i + FORWARD_MARKER.length);
  const j = body.indexOf(CUTOFF_MARK);
  return (j === -1 ? body : body.slice(0, j)).trim();
}

/** 目标段 → 事件日（首个 YYYY-MM-DD；无 → null，禁从 cutoff 时点倒推） */
function forwardEventDay(target) {
  const m = String(target || '').match(/(20\d{2}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function register(app) {
  store.ensurePredictionsTable(db.getConnection()); // 幂等（p1b 私有表，零碰 p1a 既有表）

  app.get('/api/audit/summary', async () => {
    const conn = db.getConnection();
    const byLayer = conn.prepare(
      'SELECT layer, checklist_hash, COUNT(*) AS n,'
      + ' SUM(CASE WHEN tautology = 1 THEN 1 ELSE 0 END) AS tautology_n'
      + ' FROM predictions GROUP BY layer, checklist_hash'
      + ' ORDER BY layer IS NULL ASC, layer ASC, checklist_hash IS NULL ASC, checklist_hash ASC'
    ).all();
    const byGate = conn.prepare(
      'SELECT gate, COUNT(*) AS n FROM predictions GROUP BY gate'
      + ' ORDER BY gate IS NULL ASC, gate ASC'
    ).all();
    // 分层账本：n/resolved/ambiguity + Brier（仅真值+概率题）/基率（仅真值题）机械算术
    const calibRows = conn.prepare(
      'SELECT layer, COUNT(*) AS n,'
      + ' SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) AS resolved,'
      + " SUM(CASE WHEN outcome = 'ambiguous' THEN 1 ELSE 0 END) AS ambiguous,"
      + " SUM(CASE WHEN outcome IN ('true','false') THEN 1 ELSE 0 END) AS settled,"
      + ' SUM(CASE WHEN outcome = \'true\' THEN 1 ELSE 0 END) AS true_n,'
      + " SUM(CASE WHEN outcome IN ('true','false') AND assigned_prob IS NOT NULL THEN 1 ELSE 0 END) AS brier_n,"
      + " SUM(CASE WHEN outcome IN ('true','false') AND assigned_prob IS NOT NULL"
      + " THEN (assigned_prob - (outcome = \'true\')) * (assigned_prob - (outcome = \'true\'))"
      + ' ELSE 0 END) AS brier_sum'
      + ' FROM predictions GROUP BY layer ORDER BY layer IS NULL ASC, layer ASC'
    ).all();
    const layerCalibration = calibRows.map((r) => ({
      layer: r.layer === undefined ? null : r.layer,
      n: r.n,
      resolved: r.resolved,
      ambiguous: r.ambiguous,
      settled: r.settled,
      // 样本不足 → null（如实留空，禁编造数字）
      brier: r.brier_n > 0 ? Number((r.brier_sum / r.brier_n).toFixed(6)) : null,
      brier_n: r.brier_n,
      base_rate: r.settled > 0 ? Number((r.true_n / r.settled).toFixed(6)) : null,
      base_rate_n: r.settled,
    }));
    // 待解前瞻题：未回填真值 + 题面带前瞻标记；事件日升序（无日粒度排后），id 升序
    const fwdRaw = conn.prepare(
      "SELECT id, statement, assigned_prob, layer, gate, created_at"
      + " FROM predictions WHERE outcome IS NULL AND statement LIKE '%' || ? || '%'"
    ).all(FORWARD_MARKER);
    const fwdAll = fwdRaw.map((r) => {
      const target = forwardTarget(r.statement);
      return {
        id: r.id,
        statement: r.statement,
        assigned_prob: r.assigned_prob === undefined ? null : r.assigned_prob,
        layer: r.layer === undefined ? null : r.layer,
        gate: r.gate === undefined ? null : r.gate,
        event_day: forwardEventDay(target),
        target: target,
        created_at: r.created_at,
      };
    }).sort((a, b) => {
      if (a.event_day === b.event_day) return a.id - b.id;
      if (a.event_day === null) return 1;
      if (b.event_day === null) return -1;
      return a.event_day < b.event_day ? -1 : 1;
    });
    const l0 = store.l0Gate(); // 双口径只读统计（含 gate 文案与 review_unlocked 判定）
    return {
      l0_gate: l0,
      by_layer_checklist: byLayer,
      by_gate: byGate,
      layer_calibration: layerCalibration,
      pending_forward: fwdAll.slice(0, FORWARD_LIMIT),
      pending_forward_total: fwdAll.length,
      total: l0.records,
      generated_at: new Date().toISOString(),
      note: '万物审计仪表盘：纯账本统计（只记不评），零 LLM；校准列为已回填真值题上的机械算术'
        + '（样本不足留空不编造）；review_unlocked=false 时本页一切数字只配「参考」',
    };
  });
}

module.exports = { register };
