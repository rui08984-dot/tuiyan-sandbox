'use strict';
/**
 * p1b/src/routes/audit.js —— 万物审计器仪表盘聚合端点（G1 反馈 #3 · M2，/audit 页数据源）：
 *   GET /api/audit/summary → 200 {
 *     l0_gate:            predictionsStore.l0Gate()（双口径 records/records_valid +
 *                         resolved/unresolved/games/review_unlocked，原样透出）,
 *     by_layer_checklist: [{ layer, checklist_hash, n, tautology_n } ...]（layer×checklist_hash
 *                         分组计数 + 组内 tautology=1 计数；NULL 组原样返回 null，由 UI 标「未分层」）,
 *     by_gate:            [{ gate, n } ...]（gate 分组计数）,
 *     total, generated_at, note }
 *
 * 边界铁律（写死）：纯 SQL 只读、零 LLM、零网络——本端点只做账本统计透出，不计算不返回
 * 任何准确率/校准评分（评分要等 L0 门禁解锁，见 predictionsStore.l0Gate 语义）。返回文案
 * 禁「预测」宣称字样；l0_gate.review_unlocked=false 时 UI 一切数字只配「参考」。
 * ensurePredictionsTable 放 register 内（predictions p10 W1 同先例）：幂等 additive，端点自足。
 */
const { db } = require('../deps');
const store = require('../db/predictionsStore');

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
    const l0 = store.l0Gate(); // 双口径只读统计（含 gate 文案与 review_unlocked 判定）
    return {
      l0_gate: l0,
      by_layer_checklist: byLayer,
      by_gate: byGate,
      total: l0.records,
      generated_at: new Date().toISOString(),
      note: '万物审计仪表盘：纯账本统计（只记不评），零 LLM；review_unlocked=false 时本页一切数字只配「参考」',
    };
  });
}

module.exports = { register };
