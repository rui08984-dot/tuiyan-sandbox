'use strict';
/**
 * p1b/src/retrieval/sham.js —— 阶段 5 `sham` 臂的**对照组构造器**（纯函数；PREREG 附件）。
 *
 * 依据：立项书 v1.1 §三（sham 臂＝「同流程但喂**空/无关检索结果**；同 token 预算 ±5%，照命题 A 口径」）。
 *
 * 设计（写死，冻结后禁改）：
 *   · sham 臂**不改变抽取/聚合管线**，只把「检索结果行」替换为同形但**无关/置空**的内容；
 *   · 长度约束：sham 文本目标长度 = round(原始长度 × ratio)，ratio ∈ [0.95, 1.05]（±5%，照命题 A）。
 *   · **确定性**（禁随机）：采用「按原文字符轮转取样 + 无关占位词填充」，同输入必得同输出（可复现、可审计）。
 *     不使用 Math.random / Date —— 由 seed 派生偏移（默认 seed=0；调用方可给固定 seed）。
 *
 * 契约（纯函数）：makeShamEvidence(realRows, {ratio, seed}) → { rows, budget:{target,real,got,delta_pct} }
 *   rows 与 realRows **同形**（同字段集），但 direction/strength 为无关值。
 */
const PLACEHOLDER = ['无关联证据占位', '泛化背景陈述', '不相关领域摘要', '通用常识填充'];

function strLease(s) { return typeof s === 'string' ? s : (s === null || s === undefined ? '' : String(s)); }

/** 确定性轮转取样：取 src 的前 n 个字符，从 seed 派生起点循环取。 */
function rotateSlice(src, n, seed) {
  const s = strLease(src);
  if (!n) return '';
  if (!s.length) return PLACEHOLDER[seed % PLACEHOLDER.length].repeat(Math.ceil(n / 6)).slice(0, n);
  const out = [];
  let i = ((seed % s.length) + s.length) % s.length;
  for (let k = 0; k < n; k++) { out.push(s[(i + k) % s.length]); }
  return out.join('');
}

/**
 * @param {Array<{url?:string,published_at?:string,event_at?:string,quote?:string,direction?:string,strength?:number}>} realRows
 * @param {{ratio?:number, seed?:number}} [opts]
 * @returns {{rows:Array, budget:{target_len:number,real_len:number,got_len:number,delta_pct:number}}}
 */
function makeShamEvidence(realRows, opts) {
  const o = opts || {};
  const seed = Number.isFinite(Number(o.seed)) ? Number(o.seed) : 0;
  const ratio = (Number.isFinite(Number(o.ratio)) ? Number(o.ratio) : 1.0);
  const list = Array.isArray(realRows) ? realRows : [];
  const realText = list.map((r) => strLease(r && r.quote)).join('');
  const realLen = realText.length;
  const targetLen = Math.round(realLen * ratio);
  // 构造同形行：quote 用轮转取样（确定性），方向/强度为无关值（neutral/0）
  const rows = list.map((r, idx) => {
    const qlen = Math.max(1, Math.round(strLease(r && r.quote).length * ratio));
    return {
      url: 'sham://placeholder/' + idx,
      published_at: null,
      event_at: null,
      quote: rotateSlice(strLease(r && r.quote), qlen, seed + idx),
      direction: 'neutral',
      strength: 0,
    };
  });
  const gotLen = rows.map((x) => x.quote).join('').length;
  const deltaPct = realLen ? Number(((gotLen - realLen) / realLen * 100).toFixed(4)) : 0;
  return { rows, budget: { target_len: targetLen, real_len: realLen, got_len: gotLen, delta_pct: deltaPct } };
}

module.exports = { makeShamEvidence, PLACEHOLDER };
