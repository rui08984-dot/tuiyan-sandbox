'use strict';
/**
 * p1b/src/retrieval/aggregate.js —— 阶段 5 `retrieval` 臂的**固定聚合规则**（纯函数；PREREG 附件）。
 *
 * 依据：立项书 v1.1 §四（判据预注册面）＋ §三（retrieval 臂＝「检索证据 → LLM 固定提示词抽取 → 固定规则聚合」）。
 * 铁律④裁决落点（2026-09-15 用户拍板选 (b)）：**LLM 只出结构化证据行，不出概率**；概率**只**由本文件算出
 *   ⇒ 「措辞与实现都在四角色内（信息聚合用法）」的实现级证据。
 *
 * 契约（纯函数：零 db / 零 LLM / 零网络 / 零 Date / 零随机）：
 *   入参 rows = [{ direction:'for'|'against'|'neutral', strength:0..1, ...其余字段忽略 }]
 *   出参 { p, n_rows, n_for, n_against, n_neutral, strength_for, strength_against, rule, fallback }
 *
 * 规则（**写死，冻结后禁改**；改动＝PREREG 版本递进）：
 *   · 方向权重只取 strength（0..1，越界钳到 [0,1]，非数值/缺失 ⇒ 0）
 *   · p = S_for / (S_for + S_against)；分母 = 0（无 for/against 行）⇒ **兜底 0.5**（fallback=true）
 *   · neutral 不计入分子分母（只计数披露）
 *   · p 取 6 位小数（与项目既有读数口径一致）
 * 纪律：①不引入任何 cutoff 后信息（调用方保证 rows 已过泄漏三层）；②不静默——行数/方向分布/兜底全披露。
 */
const ROUND = 6;
const DIRECTIONS = ['for', 'against', 'neutral'];

function clamp01(x) {
  const v = Number(x);
  if (!isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * @param {Array<{direction:string, strength:number}>} rows 结构化证据行（LLM 抽取产物）
 * @returns {{p:number,n_rows:number,n_for:number,n_against:number,n_neutral:number,strength_for:number,strength_against:number,rule:string,fallback:boolean}}
 */
function aggregateEvidence(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let nFor = 0, nAgainst = 0, nNeutral = 0;
  let sFor = 0, sAgainst = 0;
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const d = String(r.direction || '');
    if (DIRECTIONS.indexOf(d) === -1) continue;   // 非法方向 ⇒ 丢弃（并计为未见，不静默当 neutral）
    const s = clamp01(r.strength);
    if (d === 'for') { nFor++; sFor += s; }
    else if (d === 'against') { nAgainst++; sAgainst += s; }
    else { nNeutral++; }
  }
  const denom = sFor + sAgainst;
  const fallback = denom <= 0;
  const p = fallback ? 0.5 : Number((sFor / denom).toFixed(ROUND));
  return {
    p, n_rows: nFor + nAgainst + nNeutral,
    n_for: nFor, n_against: nAgainst, n_neutral: nNeutral,
    strength_for: Number(sFor.toFixed(ROUND)), strength_against: Number(sAgainst.toFixed(ROUND)),
    rule: 'strength_weighted_for_vs_against@v1', fallback,
  };
}

module.exports = { aggregateEvidence, clamp01, ROUND, DIRECTIONS };
