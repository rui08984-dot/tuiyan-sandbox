'use strict';
/**
 * p1b/src/evidence/truthBasis.js —— **真值口径排除谓词**（2026-09-15 · 用户裁定「丙：排除出池」）。
 *
 * 背景（勘察件 `docs/specs/阶段5-检索可行性勘察-20260915.md` §六）：
 *   `openmeteo_forecast_daily_max` 98 行（全部 realtime）的 `resolved_at` **早于事件日**，
 *   `resolve_note` 形如 `Open-Meteo forecast <事件日> max=…` ⇒ 账本取的「真值」是**当时的预报值**，
 *   不是实际观测 ⇒ **Q0-2 意义上的真值锚缺陷**（结算时事件尚未发生）。
 *
 * 裁定（用户 2026-09-15）：**(丙) 排除出池** ——
 *   · **零账本写**（不动 predictions/truth_vault 任何行）；
 *   · 在**读取侧**加排除谓词，并**披露排除计数**（禁止静默丢）；
 *   · 照项目既有 `NOT_BACKTEST` 范式（g2-report.cjs L126-131）。
 *
 * 判定口径（写死；改动＝版本递进）：
 *   `TRUTH_BASIS_DEFECT = (resolved_at < matures_at) ∧ (resolve.kind ~ /forecast/i ∨ resolve_note ~ /forecast|预报/i)`
 *   双条件，防误伤：
 *     · 单靠 `resolved_at < matures_at` 会把「正常结算但时间戳口径异常」的行卷进来；
 *     · 单靠 kind/note 会把**未结算**的 forecast 行（69 行，outcome=null）卷进来——它们结算时事件已发生，不是缺陷。
 *   实测：命中 **98** 行（openmeteo_forecast_daily_max，全 L3/R4），指纹见 `.tmp/truth-basis-excluded-ids.json`。
 *
 * 纪律：纯函数式判定 + 提供 SQL 片段；**不在此文件做任何 db 读取**。
 */

/** 排除集指纹（勘察件 §六实测；作为「谓词结果可复核」的锚）。 */
const DEFECT_FINGERPRINT_SHA256 = '78b8cedb9d37307a3f2e888bcbec0bac1b1d3bc5dcf691970ba246fb5469d6fb';
const DEFECT_N_AT_FREEZE = 98;

/**
 * SQL 片段：**非缺陷行**（＝应入池）。用于 `WHERE`。
 * 依赖列：p.resolved_at, p.matures_at, p.evidence_json。
 * 语义：`resolved_at >= matures_at`（结算不早于事件日）**或** 无 forecast 特征 ⇒ 非缺陷。
 * 注意：`resolved_at < matures_at` 在任一侧为 NULL 时为 NULL ⇒ 用 `NULLIF` 与 `IS NOT` 显式处理，
 *   避免把 NULL 行静默排除（NULL 行**保留**，由下游既有规则处理）。
 * @returns {string}
 */
function NOT_TRUTH_BASIS_DEFECT_SQL() {
  return '('
    + 'NOT (p.resolved_at IS NOT NULL AND p.matures_at IS NOT NULL AND p.resolved_at < p.matures_at '
    + "AND (json_extract(p.evidence_json,'$[0].resolve.kind') LIKE '%forecast%' "
    + "OR p.resolve_note LIKE '%预报%' OR p.resolve_note LIKE '%forecast%'))"
    + ')';
}

/** 行式判定（JS 侧；与 SQL 片段同口径——测试须断言二者一致）。 */
function isTruthBasisDefect(row) {
  if (!row) return false;
  const ra = row.resolved_at, ma = row.matures_at;
  if (!ra || !ma || String(ra) >= String(ma)) return false;
  let kind = '';
  try {
    const ev = typeof row.evidence_json === 'string' ? JSON.parse(row.evidence_json) : row.evidence_json;
    kind = String(((ev && ev[0] && ev[0].resolve) || {}).kind || '');
  } catch (e) { kind = ''; }
  const kindHit = /forecast/i.test(kind) || /forecast/i.test(String(row.resolve_kind || ''));
  const noteHit = /forecast|预报/i.test(String(row.resolve_note || ''));
  return kindHit || noteHit;
}

module.exports = { NOT_TRUTH_BASIS_DEFECT_SQL, isTruthBasisDefect, DEFECT_FINGERPRINT_SHA256, DEFECT_N_AT_FREEZE };
