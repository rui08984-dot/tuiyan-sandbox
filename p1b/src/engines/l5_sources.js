'use strict';
/**
 * p1b/src/engines/l5_sources.js —— L5 认证源「读侧」结构化（2026-09-14）。
 *
 * 为什么存在：L5 引擎（`l5_certified.js`）要求结构化 `certifiedSource` 对象；而账本里 L5 行的认证值
 *   只写在 **baseRateNote 文本**里（「前瞻·L5 认证随机：基率=组合数理论值 0.1818（…=6/33…，非历史拟合）」）
 *   ⇒ 引擎对全部 108 行如实 `unsupported:no_source`。本模块在**读侧**按 `resolve.kind` 从**博弈组合数**
 *   重建认证分布（确定性、与历史样本无关），并与文本可解析数值**交叉核对**——不一致不静默，如实带出
 *   `note_consistent=false` 供披露。**零改账本、零改写端**（写端补结构化列留待与 F4 同批迁移）。
 *
 * 契约（纯函数：零 db、零 LLM、零网络）：
 *   入参 certifiedSourceForRow({ resolve, baseRate?, baseRateNote? })
 *     · baseRate     结构化证据（批次 3 起新行随行落库；**优先**，文本退兜底）
 *     · baseRateNote 文本注记（旧行；读序见共享模块 src/evidence/baseRate.js）
 *   出参 {ok:true, source:{id,name,kind:'official',outcomes,probs,target}, meta:{kind,p,basis,note_p,note_kind,note_consistent,note_source}}
 *        {ok:false, reason:'no_resolve_kind'|'kind_unregistered', kind?}
 *
 * 纪律：
 *   ① 注册表只收**组合数可精确表达**的认证随机（彩种类）；不做任何历史拟合、不做任何"更准"宣称。
 *   ② 与 l2_baseline/g2-report 的注记解析同序同模式（组合数理论值 > 基率=），防口径分叉；
 *      2026-09-14 批次 3 起解析原语收敛到共享模块（本模块委托，零读数变化）。
 *   ③ 分布 outcomes 是**题的两种可能结局**（true/false），probs=[p,1−p]，target='true'——
 *      与题面的事件语义一一对应（p 即该事件在认证源下的概率）。
 */
const baseRateMod = require('../evidence/baseRate');

const ROUND = 9;
function r9(x) { return Number(x.toFixed(ROUND)); }

/** 组合数 C(n,k)（整数域，值域极小无溢出之忧） */
function comb(n, k) {
  if (!Number.isFinite(n) || !Number.isFinite(k) || k < 0 || n < k) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/**
 * 组合数认证规则表（按 kind + 变体判别；**先到先匹配**）。
 *   每条规则：kind 匹配 + when(resolve) 可选 + pOf(resolve) → 该题所问事件在认证源下的**精确概率**。
 *   纪律：只收能写出精确组合数依据的组合；参数越界（如会退化为恒真）⇒ 不匹配/拒绝。
 *   新增 kind/变体时：必须补 basis（组合数来源），否则不收（宁缺毋滥）。
 */
const L5_CERTIFIED_RULES = [
  {
    kind: 'cwl_ssq_red_contains', id: 'cwl_ssq', name: '中国福利彩票·双色球（33 选 6）',
    label: (r) => '红球含 ' + (r.ball || '指定球'),
    pOf: () => 6 / 33, basis: '组合数精确值 6/33',
  },
  {
    kind: 'cwl_ssq_blue_odd', id: 'cwl_ssq', name: '中国福利彩票·双色球（16 选 1）',
    label: () => '蓝球为奇数',
    pOf: () => 8 / 16, basis: '组合数精确值 8/16',
  },
  {
    kind: 'dlt_draw_result', when: (r) => r.back_ball !== undefined && r.back_ball !== null && r.back_ball !== '',
    id: 'dlt', name: '中国体育彩票·大乐透（后区 12 选 2）',
    label: (r) => '后区含 ' + r.back_ball,
    pOf: () => 2 / 12, basis: '组合数精确值 2/12=1/6',
  },
  {
    // 前区 35 选 5：P(最大号 ≥ m) = 1 − C(m−1,5)/C(35,5)。m<6 会退化恒真（1−0=1）⇒ 拒收（Q0-3 防线）。
    kind: 'dlt_draw_result', when: (r) => Number.isFinite(Number(r.front_max_ge)) && Number(r.front_max_ge) >= 6 && Number(r.front_max_ge) <= 35,
    id: 'dlt', name: '中国体育彩票·大乐透（前区 35 选 5）',
    label: (r) => '前区最大号 ≥ ' + Number(r.front_max_ge),
    pOf: (r) => 1 - comb(Number(r.front_max_ge) - 1, 5) / comb(35, 5),
    basis: (r) => '组合数精确值 1-C(' + (Number(r.front_max_ge) - 1) + ',5)/C(35,5)',
  },
];

/** 按 resolve 匹配规则（含变体判别）。 */
function matchRule(resolve) {
  const kind = resolve && resolve.kind ? String(resolve.kind) : '';
  if (!kind) return { ok: false, reason: 'no_resolve_kind' };
  for (const rule of L5_CERTIFIED_RULES) {
    if (rule.kind !== kind) continue;
    if (rule.when && !rule.when(resolve)) continue;
    return { ok: true, rule: rule };
  }
  return { ok: false, reason: 'kind_unregistered', kind: kind };
}

/**
 * 从 baseRateNote 文本解析概率值（同序同模式：组合数理论值 > 基率= > X% 兜底）——委托共享模块。
 * 三态语义（交叉核对用）：
 *   certified_text ：「组合数理论值 X」「基率=X」——**认证值声明**，可与注册表比对；
 *   empirical_pct  ：「占/命中 X%」——**历史频率**（如回填批「cutoff 前 25 期中命中 16.0%（样本不足）」），
 *                    与认证值不同属预期（不是矛盾），不参与一致性判定；
 *   null           ：无任何可解析概率。
 * @returns {null|{p:number, kind:'certified_text'|'empirical_pct'}}
 */
function parseCertifiedFromNote(note) { return baseRateMod.parseCertifiedFromNote(note); }

/**
 * 按行重建认证源（读侧）。
 * @param {{resolve?:object, baseRateNote?:string}} input
 */
function certifiedSourceForRow(input) {
  const opt = input || {};
  const resolve = opt.resolve || null;
  const m = matchRule(resolve);
  if (!m.ok) return { ok: false, reason: m.reason, kind: m.kind };
  const rule = m.rule;
  const p = r9(rule.pOf(resolve));
  if (!isFinite(p) || p <= 0 || p >= 1) {
    return { ok: false, reason: 'p_out_of_band', kind: resolve.kind }; // 退化（恒真/恒假）⇒ 拒收，宁缺毋滥
  }
  // 交叉核对来源：结构化字段优先（批次 3 起新行随行落库），文本退兜底；语义三态一致，不静默
  const structured = baseRateMod.isStructured(opt.baseRate) ? opt.baseRate : null;
  const parsed = structured
    ? { p: structured.p, kind: structured.kind === 'certified' ? 'certified_text' : 'empirical_pct' }
    : parseCertifiedFromNote(opt.baseRateNote);
  const noteP = parsed ? parsed.p : null;
  const noteKind = parsed ? parsed.kind : 'absent';
  // 一致性只在「声明是认证值」时可比对；历史频率不参与（不同属预期，非矛盾）
  const consistent = parsed && parsed.kind === 'certified_text' ? (Math.abs(noteP - p) <= 0.001) : null;
  const basis = typeof rule.basis === 'function' ? rule.basis(resolve) : rule.basis;
  return {
    ok: true,
    source: {
      id: rule.id,
      name: rule.name + '·' + rule.label(resolve) + '（' + basis + '）',
      kind: 'official',
      outcomes: ['true', 'false'],
      probs: [p, r9(1 - p)],
      target: 'true',
    },
    meta: { kind: resolve.kind, variant: rule.label(resolve), p: p, basis: basis, note_p: noteP, note_kind: noteKind,
      note_consistent: consistent, note_source: structured ? 'structured' : (parsed ? 'text' : 'absent') },
  };
}

module.exports = { L5_CERTIFIED_RULES, matchRule, certifiedSourceForRow, parseCertifiedFromNote, comb, ROUND };
