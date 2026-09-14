'use strict';
/**
 * p1b/src/engines/l6_structural.js —— L6 对抗层最小引擎：判词**结构聚合**（structural）（2026-09-14）
 *
 * 依据：路线图阶段 4「L6 对抗用判词修复 2.0 成果＋机械矛盾特征」＋ design §1.8（对抗层；引擎姿态=结构推断）。
 *   本层是**狼人杀/对抗域正式接入分层计分**的口子：把已有的、窗口受控的判词按**固定规则**聚合出 p。
 *
 * 契约（纯函数：零 db / 零 LLM / 零网络）：
 *   入参 l6Structural({ verdicts })   verdicts=[{ id?, prompt_variant, implied_prob }]
 *   聚合规则（固定、可复现）：**每个变体取 id 最大（最新）的非空 implied_prob 一条 ⇒ p = 各可用变体均值**；
 *     变体缺按可用集求均值并披露；全缺 ⇒ unsupported。
 *   出参 {ok:true, method:'structural', p, n_variants, variants:{...}, spread:{min,max}, verdict_rows, note}
 *
 * 纪律：①这是**判词聚合**，不是新模型——不产任何"优于判词"宣称；②聚合规则固定可复现（防事后挑口径）；
 *   ③多跑/缺变体/异常行一律如实披露（run_id 混杂、旧行 provenance 属**披露项**）。
 */
const VARIANTS = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];

function l6Structural(input) {
  const vs = Array.isArray(input && input.verdicts) ? input.verdicts : [];
  const latest = {};
  let rows = 0;
  for (const v of vs) {
    if (!v) continue;
    const k = String(v.prompt_variant);
    if (VARIANTS.indexOf(k) === -1) continue;
    const p = Number(v.implied_prob);
    if (!isFinite(p)) continue;
    rows++;
    const id = Number(v.id || 0);
    if (!latest[k] || id >= latest[k].id) latest[k] = { id: id, p: p };
  }
  const avail = VARIANTS.filter((k) => latest[k]);
  const variants = {};
  for (const k of VARIANTS) variants[k] = latest[k] ? latest[k].p : null;
  if (!avail.length) {
    return { ok: false, status: 'no_verdicts', method: 'structural', p: null, n_variants: 0,
      variants: variants, spread: null, verdict_rows: rows,
      note: '该题无任何可用判词（implied_prob 全空/无行）⇒ 本层不出数（不编）。' };
  }
  const ps = avail.map((k) => latest[k].p);
  const p = Number((ps.reduce((s, x) => s + x, 0) / ps.length).toFixed(6));
  return {
    ok: true, status: 'ok', method: 'structural', p: p, n_variants: avail.length, variants: variants,
    spread: { min: Math.min.apply(null, ps), max: Math.max.apply(null, ps) }, verdict_rows: rows,
    note: 'L6 对抗层：p＝**判词结构聚合**（每变体取最新非空 implied_prob，再对可用变体求均值；'
      + 'n_variants=' + avail.length + '/3，spread=[' + Math.min.apply(null, ps) + ',' + Math.max.apply(null, ps) + ']，判词行 ' + rows + '）。'
      + '这是对已有判词的**固定规则聚合**，不是新模型；判词多跑/旧行 provenance 属披露项。',
  };
}

module.exports = { l6Structural, VARIANTS };
