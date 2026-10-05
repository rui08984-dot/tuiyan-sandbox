'use strict';
/*
 * p1b/scripts/role3-combiner.cjs —— 角色③「分支概率合成器」：机械合成纯函数（2026-09-20）
 *
 * 依据：PREREG-角色③情景分支合成器-v1-20260920.md（sha 44acb872…）§3 合成器口径 ＋ §4 判据口径。
 *   蓝图 20 号件 §2.3 第 4 条＋16 号件 §6（6A 全概率 / 6B noisy-OR / 6C 全方差）。
 *
 * ★设计题三条结论（证据件 docs/assets/p29/角色③设计题-分支形态与判读面-证据件-20260920.md）：
 *   · **D 型（互斥划分）**：Σ 子题 p ≡ 父题分布 ⇒ 合成与直接**构造性恒等**（Δ≡0 无信息量）⇒ 只披露不判读。
 *   · **N 型（合取族）**：父题＝子题合取，子题读数独立 ⇒ 合成可非平凡 ⇒ **本次判读面**（sim 域 T9/T10 族）。
 *   · **U 型（替代路径）**：noisy-OR 规则冻结；路径型子命题现为 0 条 ⇒ 留待实现期。
 *
 * 契约（纯函数：零 db / 零 LLM / 零网络；与 l6_structural.js 同规格）：
 *   combineConjunction({ pa, pb })       → { ok, p, mode:'conjunction', note }   P(A∧B)=P(A)·P(B)
 *   combinePartition({ branches })       → { ok, p, mode:'partition', note }     P(E)=Σ P(B_i)·P(E|B_i)
 *   combineNoisyOr({ branches })         → { ok, p, mode:'noisy_or', note }      P(E)=1−Π(1−P(E|B_i))
 *   varianceDecomp({ branches })         → { ok, total, within, structural, mode:'6c' }
 *   brier(p, y) / murphyRel(ps, ys)      → 判据原语（REL 分量与 e2-combo-precheck.cjs::murphyRes 同口径）
 *
 * 纪律：
 *   ① 读数一律来自现役引擎（调用方读 l6Structural），本件**不产数**、不新跑 LLM、零账本写。
 *   ② 合成规则固定可复现（防事后挑口径）；三种模式**不得混用**（PREREG §2 判读面写死 N 型）。
 *   ③ 缺读数 ⇒ `ok:false` 如实返回（禁静默补 0.5 或跳过——「我没观测到 ≠ 存在」）。
 *   ④ 金样：退化输入（P(A)=直接读数、P(B)=1）⇒ 合成恒等（证「无差异时不出假差异」）。
 */
const BINS = 10;

/**
 * 校验单个概率读数：有限数且 ∈ [0,1]；否则 null（不钳位——钳位会静默改数）。
 * ★2026-09-20 金样抓到的实现 bug：`Number(null)===0` ⇒ 缺读数（null/undefined/空串）会被**静默当 0**。
 *   先做类型守卫再数值化（照项目「我没观测到 ≠ 存在」纪律；回归锁见 role3.test.cjs ②）。
 */
function asProb(x) {
  if (x === null || x === undefined || x === '') return null;
  if (typeof x === 'boolean') return null;
  const v = Number(x);
  if (!isFinite(v) || v < 0 || v > 1) return null;
  return v;
}

/** N 型合取合成：P(A∧B) = P(A)·P(B)。子题为**独立题**，读数各自取自现役引擎。 */
function combineConjunction(input) {
  const pa = asProb(input && input.pa);
  const pb = asProb(input && input.pb);
  if (pa === null || pb === null) {
    return { ok: false, status: 'missing_reading', p: null, mode: 'conjunction', pa: pa, pb: pb,
      note: '合取合成缺读数（pa=' + JSON.stringify(input && input.pa) + '，pb=' + JSON.stringify(input && input.pb) + '）⇒ 不出数（不编）。' };
  }
  return { ok: true, status: 'ok', p: Number((pa * pb).toFixed(6)), mode: 'conjunction', pa: pa, pb: pb,
    note: 'N 型合取合成：P(A∧B)=P(A)·P(B)＝' + pa + '×' + pb + '。' };
}

/** D 型全概率合成：P(E) = Σ_i P(B_i)·P(E|B_i)。**披露用**（判读面不含 D 型，见设计题 §1.1）。 */
function combinePartition(input) {
  const br = Array.isArray(input && input.branches) ? input.branches : [];
  if (!br.length) return { ok: false, status: 'no_branches', p: null, mode: 'partition', note: '无分支 ⇒ 不出数。' };
  let sum = 0;
  for (const b of br) {
    const pb = asProb(b && b.p_b);
    const pe = asProb(b && b.p_e_given_b);
    if (pb === null || pe === null) return { ok: false, status: 'missing_reading', p: null, mode: 'partition', note: '分支读数缺失 ⇒ 不出数。' };
    sum += pb * pe;
  }
  return { ok: true, status: 'ok', p: Number(sum.toFixed(6)), mode: 'partition', k: br.length,
    note: 'D 型全概率合成：Σ P(B_i)·P(E|B_i)＝' + Number(sum.toFixed(6)) + '（k=' + br.length + '；**披露用**）。' };
}

/** U 型 noisy-OR 合成：P(E) = 1 − Π_i (1 − P(E|B_i))。**规则冻结、判读留待实现期**（路径型子命题现为 0）。 */
function combineNoisyOr(input) {
  const br = Array.isArray(input && input.branches) ? input.branches : [];
  if (!br.length) return { ok: false, status: 'no_branches', p: null, mode: 'noisy_or', note: '无分支 ⇒ 不出数。' };
  let prod = 1;
  for (const b of br) {
    const pe = asProb(b && b.p_e_given_b);
    if (pe === null) return { ok: false, status: 'missing_reading', p: null, mode: 'noisy_or', note: '路径读数缺失 ⇒ 不出数。' };
    prod *= (1 - pe);
  }
  return { ok: true, status: 'ok', p: Number((1 - prod).toFixed(6)), mode: 'noisy_or', k: br.length,
    note: 'U 型 noisy-OR：1−Π(1−P(E|B_i))＝' + Number((1 - prod).toFixed(6)) + '（k=' + br.length + '；规则冻结待用）。' };
}

/**
 * 6C 全方差分解：Var(E) = E[Var(E|B)] + Var[E(E|B)]。
 * 入参 branches=[{ p_b（分支概率）, p_e_given_b（条件读数） }]；两分量按**加权**口径（照全方差定律）。
 * 输出 structure 分量＝分支间条件读数均值的方差（**认知不确定性机械形态**，喂 O6）。
 */
function varianceDecomp(input) {
  const br = Array.isArray(input && input.branches) ? input.branches : [];
  const clean = [];
  for (const b of br) {
    const pb = asProb(b && b.p_b);
    const pe = asProb(b && b.p_e_given_b);
    if (pb === null || pe === null) return { ok: false, status: 'missing_reading', mode: '6c', note: '分支读数缺失 ⇒ 不出数。' };
    clean.push({ pb: pb, pe: pe });
  }
  if (!clean.length) return { ok: false, status: 'no_branches', mode: '6c', note: '无分支 ⇒ 不出数。' };
  const wsum = clean.reduce((s, x) => s + x.pb, 0);
  if (!(wsum > 0)) return { ok: false, status: 'zero_weight', mode: '6c', note: '分支权重和为 0 ⇒ 不出数。' };
  const mean = clean.reduce((s, x) => s + x.pb * x.pe, 0) / wsum;            // E[E|B]
  const structural = clean.reduce((s, x) => s + x.pb * (x.pe - mean) ** 2, 0) / wsum; // Var[E|B]
  // within 分量：分支内方差在现数据面不可观测（单读数/题）⇒ 如实记 null 并披露（不编）。
  const total = structural;                                                   // 可观测部分
  return { ok: true, status: 'ok', mode: '6c', total: Number(total.toFixed(6)), within: null,
    structural: Number(structural.toFixed(6)), mean: Number(mean.toFixed(6)), k: clean.length,
    note: '6C 全方差：结构分量 Var[E(E|B)]＝' + Number(structural.toFixed(6)) + '（k=' + clean.length + '）；'
      + 'within 分量＝分支内方差，现数据面（单读数/题）**不可观测** ⇒ 记 null 披露，不以 0 冒充。' };
}

/**
 * ★2026-09-20 收口修正（实现复用纪律）：判据原语**一律复用现役共享实现**，禁写第二份——
 *   · Brier／Murphy 三分解（含 REL）＝`e2-combo-precheck.cjs`（u8-columns 同口径）
 *   · 配对 bootstrap CI ＝`e2-combo-precheck.cjs::bootCI`（rows+fn 签名；与 thickcell-replay 同规格）
 *   · σ̂_d／MDE ＝`e2-shadow-score.cjs::mdeFromSE`（SE＝σ̂_d/√n 同式）
 * 本件只保留**合成函数**（conjunction/partition/noisy_or/全方差）——那是角色③独有的机械规则。
 */
const M = require('./e2-combo-precheck.cjs');
const brier = M.brier;
function murphyRel(ps, ys) { const r = M.murphyRes(ps, ys); return r && r.rel !== undefined ? r.rel : null; }
/** 配对 bootstrap CI（复用共享实现；入参 diffs 为逐题配对差数组）。 */
function bootCI(diffs, B, seed) {
  const rows = diffs.map((d) => ({ d: d }));
  const r = M.bootCI(rows, (sub) => sub.reduce((s, x) => s + x.d, 0) / sub.length, B, seed);
  return { lb: r.lo, ub: r.hi, mean: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null, n: diffs.length };
}
/**
 * 原始配对 bootstrap（rows＋统计量 fn）——供 REL 差等**非线性**统计量使用（ΔBrier 用上面的 bootCI）。
 * 直接透传共享实现 `e2-combo-precheck.cjs::bootCI`（同 B/seed 语义；对**题**重采样保留配对）。
 */
function bootCIRaw(rows, fn, B, seed) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return M.bootCI(rows, fn, B, seed);
}
/** 配对差统计量：Δ 均值、σ̂_d、MDE（照厚格 §6 义务：三者必须同报）。 */
function diffStats(diffs) {
  const n = diffs.length;
  if (!n) return { n: 0, mean: null, sd: null, mde: null };
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1)) : 0;
  return { n: n, mean: mean, sd: sd, mde: 2.8 * sd / Math.sqrt(n) };
}

module.exports = {
  combineConjunction, combinePartition, combineNoisyOr, varianceDecomp,
  brier, murphyRel, bootCI, bootCIRaw, diffStats, asProb, BINS,
};
