#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/lambda-overlap.cjs —— 9 臂先导 λ̂（信息重叠下界）· 2026-09-17
 *
 * 依据（唯一）：蓝图 `20-合议-v3.1大升级蓝图.md` §2.2 #4（「存量 verdicts 3 个变体-温度混淆对算 λ̂ 下界；
 *   先导 λ̂ <0.8 ⇒ 9 臂解耦立项（判据三件套照 16④4B），≥0.8 ⇒ 封存 F8」）
 *   ＋ 16 号件 §4B（「核心副产物＝λ̂ 实测（照 InfoDiv 笔记的信息重叠度量，**变体对间读数相关 ＋ 同意率双口径**）」）
 *   ＋ 19 号件 §3.2（降级版＝**零 LLM 调用**）。
 * 理论出处：Satopää et al. 2014（NIPS）*Modeling Probability Forecasts via Information Diversity*，arXiv:1406.2148v5
 *   （项目全文精读笔记 `docs/assets/forecast-debate/全文精读/二期/二期笔记-InfoDiv.md`；主文缓存 1389 行在盘）。
 *   关键式：p_i = Φ(X_{B_i}/√(1−δ_i))；Cov(X_{B_i},X_{B_j}) ＝ |B_i∩B_j| ⇒ 对称信息下 **Corr(X_i,X_j) ＝ λ**；
 *   极端化因子 F55 **γ̂ ＝ N/((N−1)λ̂+1)**（N=3 ⇒ γ̂ ＝ 3/(2λ̂+1)）。
 *
 * ★ 两处方法学声明（本件写死并披露，防事后解释）：
 *   ① **代理量非法定 MLE**：项目自己立的前置门＝「λ̂ 实测落地前须**回读附录 B 的 MLE 细节**」
 *      （InfoDiv 笔记 §存疑 5），而**附录 B 在 Supplementary Material、不在盘上**（主文缓存只有引用句）。
 *      故本件是**先导**（preliminary）：用 16 号件写明的**双口径代理量**（读数相关 ＋ 同意率），
 *      与论文自述的两条 leverage 对齐（「预测越有信息 ⇒ 越远离无信息先验」＋「重叠高 ⇒ 报数极像」）。
 *      正式立项时（若被触发）**必须先回读附录 B 并以 MLE 复核**。⇒ 0.8 阈值是**挂在代理量上**的。
 *   ② **混淆使读数成为「下界」**：3 变体与 3 温度在本账本里**一一绑定**（v1↔0.2／v2↔0.7／v3↔1），
 *      故任何变体对都同时是温度对。温度既改尺度也注入采样抖动，**后者只会衰减相关**（measurement-error
 *      attenuation）⇒ 测得的重叠 ≤ 纯角色重叠 ⇒ 按**下界**读（与蓝图「算 λ̂ 下界」一致）。
 *      （尺度项本身不改相关系数——如实注明，不夸大。）
 *
 * 口径（逐条写死）：
 *   · **口径 A（读数相关，probit 空间）**：λ̂_corr ＝ Pearson Corr(Φ⁻¹(p_a), Φ⁻¹(p_b))。模型蕴含
 *     Corr(X_i,X_j)=λ；共用因子 √(1−δ) 是尺度、不改相关。（Φ⁻¹ 用 Acklam 有理逼近，精度 ~1e-9）
 *   · **口径 B（同意率）**：P̂_agree ＝ 两旁在 0.5 同侧的题占比；二元正态同号概率 ＝ 1/2 + arcsin(ρ)/π
 *     ⇒ **λ̂_agree ＝ sin(π(P̂_agree − 1/2))**（闭式反演）。
 *   · **p∈{0,1} 截断**：照 InfoDiv 笔记所载论文 GJP 实证做法截断到 **0.001/0.999**（笔记 §增量 7）。
 *   · **保守下界**：λ̂_lo ＝ 三个变体对 × 两口径中的**最小点估计**（最保守的下界）；逐对逐口径全披露。
 *   · CI：按题配对重采样 B=1000／seed=987654321／百分位法（项目统一口径）。
 *   · 判定阈值 **0.8**（蓝图 §2.2 #4 写死）：λ̂_lo ≥ 0.8 ⇒ **封存 F8（不立项）**；< 0.8 ⇒ **触发 9 臂解耦立项**。
 * 纪律：**零账本写／零 LLM／零网络**；库 readOnly；只读侧派生、不进任何门控。
 * 用法：node p1b/scripts/lambda-overlap.cjs [--db <path>] [--out-dir <dir>] [--boot 1000] [--seed 987654321]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const NB = Number(arg('boot', '1000'));
const SEED = Number(arg('seed', '987654321'));
const THRESHOLD = 0.8;          // 蓝图 §2.2 #4 写死
const CLIP = 0.001;             // 照论文 GJP 实证做法（InfoDiv 笔记 §增量 7）

// ── 纯函数区（可 require，零副作用） ─────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const clamp = (p) => Math.max(CLIP, Math.min(1 - CLIP, Number(p)));

/** Acklam 有理逼近的 Φ⁻¹（标准正态分位函数）。 */
function probit(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= 1 - pl) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** 标准正态 CDF（A&S 26.2.17，|ε|<7.5e−8；仅测试/自检用）。 */
function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** 口径 A：probit 空间读数的 Pearson 相关（＝λ 的矩估计）。行＝[{pa,pb}]（已截断前的原值）。 */
function lambdaCorr(rows) {
  const xs = rows.map((r) => probit(clamp(r.pa))), ys = rows.map((r) => probit(clamp(r.pb)));
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
const side = (p) => (Number(p) >= 0.5 ? 1 : 0);
/** 口径 B：同意率反演 λ ＝ sin(π(P̂−1/2))（二元正态同号概率）。 */
function lambdaAgree(rows) {
  if (!rows.length) return null;
  const pa = rows.filter((r) => side(r.pa) === side(r.pb)).length / rows.length;
  return Math.sin(Math.PI * (pa - 0.5));
}
/** 极端化因子 F55（N=3）：γ̂ ＝ 3/(2λ̂+1)。 */
function gammaHat(lam) { return 3 / (2 * lam + 1); }

/**
 * **附录 B 的 MLE（对称信息模型）** —— arXiv:1501.06943v1 `APPENDIX B: PARAMETER ESTIMATION UNDER SYMMETRIC INFORMATION` 逐式实现
 * （2026-09-17 回读；★该附录**就在盘上缓存**：`docs/assets/forecast-debate/全文精读/_cache-K-1501.06943.txt` 第 1197 行起）。
 *
 * 数据：每题给 N 个成员的 probit 读数 P＝(Φ⁻¹(p_1)…Φ⁻¹(p_N))；散布矩阵 S_P＝Σ_题 P·P′。
 * 目标（原文 (12) ＋ (A_Ω,B_Ω) 版，**凸**）：
 *   min  −N·log A_Ω − log(1 + N·B_Ω/A_Ω) + A_Ω·tr(S_P) + B_Ω·tr(S_P·J_N)
 *   约束 A_Ω ≥ N−1；A_Ω + N·B_Ω ≥ 0；B_Ω ≤ 0
 * 回代（原文末两式）：δ* ＝ [B_Ω(N−1)+A_Ω] / [A_Ω(1+A_Ω) + B_Ω(N−1+N·A_Ω)]｜λ* ＝ −B_Ω / [B_Ω(N−1)+A_Ω]
 * 求解法：对固定 A_Ω，B_Ω 的一阶条件给 `B*＝1/tr_J − A_Ω/N`（再按两条约束截断）⇒ 外层对 A_Ω **黄金分割**
 *   （目标对 (A_Ω,B_Ω) 凸 ⇒ 内层最优化后的复合函数在 A 上仍凸）。
 * ★实现选择（声明）：① 实数据先**按列中心化**（模型假定均值 0；附录 B 未讨论均值未知情形）
 *   ② N＝2（本项目逐对）—— 此时约束 λ ≥ max(2−1/δ, 0) 在 δ<0.5 时把 λ 压到 0 边界。
 */
function fitSymmetricMLE(P, opt) {
  const o = opt || {};
  const center = o.center !== false;
  const rows = (P || []).filter((v) => Array.isArray(v) && v.length >= 2 && v.every((x) => isFinite(x)));
  if (rows.length < 3) return null;
  const N = rows[0].length;
  const m = rows.map((v) => v.slice());
  if (center) for (let j = 0; j < N; j++) { let s = 0; for (const v of m) s += v[j]; const mu = s / m.length; for (const v of m) v[j] -= mu; }
  let tr_P = 0, tr_J = 0;
  for (const v of m) { let s = 0, s2 = 0; for (const x of v) { s += x; s2 += x * x; } tr_P += s2; tr_J += s * s; }
  // ★口径钉死（**合成回收实测抓到的实现 bug**）：目标 (12) 里的 S_P 是**样本协方差**（q 题等权平均），
  //   **不是散布矩阵**。若用散布（不除 q），`log(1+N·B_Ω/A_Ω)` 项被 q 淹没 ⇒ B_Ω 恒贴约束边界 A_Ω+N·B_Ω=0
  //   ⇒ 回代 λ* ＝ −B_Ω/(B_Ω+A_Ω) 恒为 **1**（与真值无关）——测试①「真 0.5 ⇒ 估 0.9997」即此症。
  tr_P = tr_P / m.length; tr_J = tr_J / m.length;
  if (!(tr_P > 0)) return null;
  const bStar = (A) => {
    let b = tr_J > 0 ? (1 / tr_J - A / N) : 0;
    if (b > 0) b = 0;                    // −B_Ω ≥ 0
    const bMin = -A / N;                 // A_Ω + N·B_Ω ≥ 0
    if (b < bMin) b = bMin;
    return b;
  };
  const obj = (A, B) => -N * Math.log(A) - Math.log(1 + (N * B) / A) + A * tr_P + B * tr_J;
  const g = (A) => obj(A, bStar(A));
  let lo = N - 1 + 1e-9, hi = Math.max(10, (tr_P / Math.max(1, m.length)) * 1e3 + 10);
  let guard = 0;
  while (g(hi) < g(lo + 1e-9) && guard++ < 60) hi *= 4;
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi, c = b - phi * (b - a), d = a + phi * (b - a);
  for (let it = 0; it < 300; it++) {
    if (Math.abs(b - a) < 1e-13 * Math.max(1, b)) break;
    if (g(c) < g(d)) { b = d; d = c; c = b - phi * (b - a); } else { a = c; c = d; d = a + phi * (b - a); }
  }
  const A = (a + b) / 2, B = bStar(A);
  const den = A * (1 + A) + B * (N - 1 + N * A);
  const delta = (B * (N - 1) + A) / den;
  const lambda = -B / (B * (N - 1) + A);
  return { delta: delta, lambda: lambda, rho: delta * lambda, A_Omega: A, B_Omega: B,
    tr_P: tr_P, tr_J: tr_J, n_questions: m.length, N: N, centered: center, obj: obj(A, B),
    feasible: (A >= N - 1 - 1e-9) && (A + N * B >= -1e-9) && (B <= 1e-12) };
}
/** 配对（按行为单位）bootstrap 百分位 CI。 */
function bootCI(rows, fn, B, seed) {
  const n = rows.length;
  if (!n) return { lo: null, hi: null, B: B, seed: seed };
  let s = seed >>> 0;
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const v = [];
  for (let b = 0; b < B; b++) { const sub = new Array(n); for (let i = 0; i < n; i++) sub[i] = rows[Math.floor(rnd() * n)]; v.push(fn(sub)); }
  v.sort((x, y) => x - y);
  const q = (t) => v[Math.min(v.length - 1, Math.max(0, Math.floor(t * v.length)))];
  return { lo: q(0.025), hi: q(0.975), B: B, seed: seed };
}

// ── 主流程（只在 CLI 直跑；require 不写盘、不读库） ───────────────────────────
function main() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const raw = db.prepare('SELECT prediction_id AS pid, COALESCE(run_id,\'(null)\') AS run, prompt_variant AS variant, '
    + 'temperature AS temp, model AS model, implied_prob AS p, layer AS layer_ FROM ('
    + 'SELECT v.prediction_id, v.run_id, v.prompt_variant, v.temperature, v.model, v.implied_prob, p.layer '
    + 'FROM verdicts v JOIN predictions p ON p.id = v.prediction_id) WHERE implied_prob IS NOT NULL').all();
  db.close();

  // 组键 = (run, pid, model)；要求三变体齐（温度随变体绑定，故不进键）
  const groups = new Map();
  let dupes = 0;
  for (const r of raw) {
    const k = r.run + '|' + r.pid + '|' + r.model;
    if (!groups.has(k)) groups.set(k, {});
    const g = groups.get(k);
    if (g[r.variant]) dupes++;      // 同 (run,pid,model,variant) 多行 ⇒ 取最后一行并计数
    g[r.variant] = r;
  }
  const VARIANT_TEMP = { v1_evidence: 0.2, v2_skeptical: 0.7, v3_baserate: 1 };
  const VARIANTS = Object.keys(VARIANT_TEMP);
  const PAIRS = [['v1_evidence', 'v2_skeptical'], ['v1_evidence', 'v3_baserate'], ['v2_skeptical', 'v3_baserate']];
  const triples = [];
  let incomplete = 0;
  for (const [, g] of groups) {
    if (!VARIANTS.every((v) => g[v])) { incomplete++; continue; }
    triples.push({ run: g[VARIANTS[0]].run, layer: g[VARIANTS[0]].layer_,
      p: VARIANTS.map((v) => Number(g[v].p)), byVariant: g });
  }

  const results = [];
  for (const [A, B] of PAIRS) {
    const rows = triples.map((t) => ({ pa: Number(t.byVariant[A].p), pb: Number(t.byVariant[B].p) }));
    const n = rows.length;
    const ca = lambdaCorr(rows), cb = lambdaAgree(rows);
    // ★附录 B 的 MLE 口径（2026-09-17 回读后实现）：每题 N=2 的 probit 向量 ⇒ fitSymmetricMLE
    const mle = fitSymmetricMLE(rows.map((r) => [probit(clamp(r.pa)), probit(clamp(r.pb))]), { center: true });
    results.push({
      pair: A.slice(0, 2) + '–' + B.slice(0, 2), pair_full: A + ' × ' + B,
      temperatures: VARIANT_TEMP[A] + ' vs ' + VARIANT_TEMP[B], n: n,
      lambda_corr: ca, ci95_corr: bootCI(rows, lambdaCorr, NB, SEED), gamma_corr: ca === null ? null : gammaHat(ca),
      lambda_agree: cb, ci95_agree: bootCI(rows, lambdaAgree, NB, SEED), gamma_agree: cb === null ? null : gammaHat(cb),
      lambda_mle: mle ? mle.lambda : null, delta_mle: mle ? mle.delta : null, mle: mle,
      agree_rate: n ? rows.filter((r) => side(r.pa) === side(r.pb)).length / n : null,
      clipped: rows.filter((r) => Number(r.pa) <= 0 || Number(r.pa) >= 1 || Number(r.pb) <= 0 || Number(r.pb) >= 1).length,
    });
  }
  const allEst = [];
  for (const r of results) { if (r.lambda_corr !== null) allEst.push(r.lambda_corr); if (r.lambda_agree !== null) allEst.push(r.lambda_agree); }
  const lo = allEst.length ? Math.min.apply(null, allEst) : null;
  const loIsCorr = results.some((r) => r.lambda_corr !== null && r.lambda_corr === lo);
  const loCI = loIsCorr ? Math.min.apply(null, results.map((r) => r.ci95_corr.lo)) : Math.min.apply(null, results.map((r) => r.ci95_agree.lo));
  const mleEst = results.map((r) => r.lambda_mle).filter((x) => x !== null);
  const loMle = mleEst.length ? Math.min.apply(null, mleEst) : null;
  const decision = lo === null ? 'n/a' : (lo >= THRESHOLD ? '封存 F8（λ̂ 下界 ≥ 0.8 ⇒ 变体池≈单信号，9 臂解耦不立项）'
    : '触发 9 臂解耦立项（λ̂ 代理量下界 < 0.8；★附录 B **已回读并实现 MLE**：MLE 口径下界 λ̂_MLE_lo = ' + (loMle === null ? 'n/a' : loMle.toFixed(6)) + '，与代理量同向 ⇒ 立项理由不被口径变更推翻）');

  // 逐变体分布体检（δ 型诊断：越远离 0.5 ⇒ 信息越多；集中 0.5 附近 ⇒ δ≈0 型「withdraw」）
  const shape = VARIANT_TEMP && VARIANTS.map((v) => {
    const ps = triples.map((t) => Number(t.byVariant[v].p));
    const pr = ps.map((p) => probit(clamp(p)));
    return { variant: v, temperature: VARIANT_TEMP[v], n: ps.length, mean_p: mean(ps), sd_probit: Math.sqrt(mean(pr.map((x) => (x - mean(pr)) ** 2))),
      share_0p4_0p6: ps.filter((p) => p > 0.4 && p < 0.6).length / ps.length,
      share_ge_0p9_or_le_0p1: ps.filter((p) => p >= 0.9 || p <= 0.1).length / ps.length };
  });

  const f6 = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(6);
  const L = [];
  L.push('# 9 臂先导 λ̂（信息重叠下界）· ' + new Date().toISOString().slice(0, 10));
  L.push('');
  L.push('> **零 LLM 调用**（蓝图 §2.2 #4／19 号件 §3.2 降级版）：只用**存量 verdicts**，不跑任何新臂。');
  L.push('> 判据（写死）：**λ̂ 下界 ≥ 0.8 ⇒ 封存 F8（不立项）；< 0.8 ⇒ 触发 9 臂解耦立项**（蓝图 §2.2 #4）。');
  L.push('> 纪律：零账本写／零 LLM／零网络｜库 readOnly｜只读侧派生、不进任何门控。');
  L.push('> 出处：Satopää et al. 2014 *Modeling Probability Forecasts via Information Diversity*（arXiv:1406.2148v5）；');
  L.push('> p_i=Φ(X/√(1−δ))｜Cov(X_i,X_j)=|B_i∩B_j| ⇒ 对称下 **Corr(X_i,X_j)=λ**｜F55 **γ̂=3/(2λ̂+1)**。');
  L.push('');
  L.push('## 0. ★两处方法学声明（防事后解释）');
  L.push('- **①代理量非法定 MLE**：项目自己立的前置门＝「λ̂ 实测落地前须**回读附录 B 的 MLE 细节**」（InfoDiv 笔记 §存疑 5）；');
  L.push('  而**附录 B 在 Supplementary Material、不在盘上**（主文缓存 1389 行只有引用句）。故本件是**先导**：');
  L.push('  用 16 号件写明的**双口径代理量**（读数相关 ＋ 同意率），对齐论文自述的两条 leverage。');
  L.push('  ⇒ **0.8 阈值挂的是代理量**；若被触发正式立项，**必须先回读附录 B 并以 MLE 复核**。');
  L.push('- **②混淆 ⇒ 读数按「下界」读**：3 变体与 3 温度**一一绑定**（v1↔0.2／v2↔0.7／v3↔1），任何变体对都同时是温度对。');
  L.push('  温度既改尺度也注入采样抖动，**后者只会衰减相关** ⇒ 测得重叠 ≤ 纯角色重叠 ⇒ 与蓝图「算 λ̂ 下界」口径一致。');
  L.push('  （尺度项本身不改相关系数——如实注明，不夸大。）');
  L.push('- **③口径 B 的模型假设会偏**：`λ＝sin(π(P̂−1/2))` 的闭式反演**假设二元标准化正态**；本账本边缘分布明显非标准');
  L.push('  （§4 体检：v1 的 probit 标准差 **1.333** vs v3 的 **0.356**）⇒ **口径 B 是粗口径、系统性偏离**，A 更贴近模型。');
  L.push('  故保守下界取两口径的**最小**，且两口径**并列披露不合并**。');
  L.push('- **④方向性提示（防止误读）**：因 ② 只压低读数，**下界 < 0.8 不能证明「纯角色重叠低」**——它只说明');
  L.push('  「**无法确认高重叠**」。故判定落在「立项」分支时，含义是「**该花钱实测了**」，不是「已经知道重叠低」。');
  L.push('');
  L.push('## 1. 数据');
  L.push('- verdicts 取数（`implied_prob IS NOT NULL`）⇒ ' + raw.length + ' 行；组键＝`(run, pid, model)`，要求三变体齐。');
  L.push('- **完整三元组 ' + triples.length + ' 个**（同键同变体重复行 ' + dupes + '，取末行）｜不成组 ' + incomplete + '。');
  L.push('- 变体↔温度绑定：' + JSON.stringify(VARIANT_TEMP) + '｜p∈{0,1} 截断到 ' + CLIP + '/' + (1 - CLIP) + '（照论文 GJP 实证做法）。');
  L.push('');
  L.push('## 2. λ̂ 双口径读数（逐对全披露）');
  L.push('');
  L.push('| 变体对 | 温度 | n | 口径A 相关 λ̂ | A 的 95% CI | 口径B 同意率 | 同意率 | 口径B λ̂ | B 的 95% CI | γ̂(A) | γ̂(B) | 截断行 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    L.push('| ' + r.pair + ' | ' + r.temperatures + ' | ' + r.n + ' | ' + f6(r.lambda_corr) + ' | [' + f6(r.ci95_corr.lo) + ', ' + f6(r.ci95_corr.hi) + ']'
      + ' | ' + f6(r.agree_rate) + ' | ' + f6(r.lambda_agree) + ' | [' + f6(r.ci95_agree.lo) + ', ' + f6(r.ci95_agree.hi) + ']'
      + ' | ' + f6(r.gamma_corr) + ' | ' + f6(r.gamma_agree) + ' | ' + r.clipped + ' |');
  }
  L.push('');
  L.push('- **保守下界 λ̂_lo ＝ ' + f6(lo) + '**（三对 × 两口径取最小）｜对应最小 CI 下界 ' + f6(loCI) + '。');
  L.push('');
  L.push('## 3. 判定（蓝图 §2.2 #4 写死阈值 0.8）');
  L.push('');
  L.push('- **' + decision + '**');
  L.push('  · **本先导与蓝图预期不符（如实）**：蓝图 §2.2 #4／裁决二的措辞预期「连混合上界都 ≈1」⇒ 走「封存 F8」；实测**下界 0.16（远低于 0.8）** ⇒ 按**写死的判据**落「立项」分支。');
  L.push('  · 但按 §0④ 的方向性提示：这**不是**「已证明变体池重叠低」，而是「**无法确认高重叠 ⇒ 该实测**」。');
  L.push('  · 触发条件的**下一步**（若立项）：① 先回读 Supplementary Material 附录 B 的 MLE 细节；② 跑 9 臂解耦（3 变体×3 温度，30–50 锚题 ≈270–450 次调用）；③ 判据三件套照 16④4B。');
  L.push('- γ̂（N=3，F55）＝ 3/(2λ̂+1)：以 λ̂_lo 计 ⇒ **γ̂ ≈ ' + (lo === null ? 'n/a' : f6(gammaHat(lo))) + '**（λ̂→1 时 γ̂→1，即几乎不需极端化）。');
  L.push('');
  L.push('## 4. 逐变体分布体检（δ 型诊断，只披露）');
  L.push('');
  L.push('| 变体 | 温度 | n | 均值 p | probit 标准差 | p∈(0.4,0.6) 占比 | p≤0.1 或 ≥0.9 占比 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const s of shape) L.push('| ' + s.variant + ' | ' + s.temperature + ' | ' + s.n + ' | ' + f6(s.mean_p) + ' | ' + f6(s.sd_probit) + ' | ' + f6(s.share_0p4_0p6) + ' | ' + f6(s.share_ge_0p9_or_le_0p1) + ' |');
  L.push('');
  L.push('- 读法（照 InfoDiv 笔记 §增量 1）：δ→0 ⇒ 预测收敛到 0.5（「withdraw」）；δ→1 ⇒ 概率质量向 0/1 两端。');
  L.push('  ⇒ `p∈(0.4,0.6) 占比` 高＝该路信息量低；`probit 标准差` 小＝分布窄。**只披露，不据此下结论**。');
  L.push('');
  L.push('## 5. 边界');
  L.push('');
  L.push('- 本件是**先导**：代理量 + 混淆对 ⇒ 任何数字**不得**当「变体池无信息量」的定论；它只回答「要不要花 9 臂的钱」。');
  L.push('- 数据面：全部为**存量账本**（3 变体×3 温度一一绑定，无纯角色对可比）；换底座/换 prompt 族后须重估。');
  L.push('- 正式 9 臂解耦（若立项）判据三件套照 16④4B：角色效应 CI ＋ 温度效应 CI ＋ λ̂ 双口径（MLE 版）。');
  L.push('');
  L.push('（λ̂ 先导完 · 零账本写 · 零 LLM · 零网络 · 只披露不进任何门控）');

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, 'lambda-overlap-' + today);
  fs.writeFileSync(base + '.json', JSON.stringify({
    script: 'p1b/scripts/lambda-overlap.cjs',
    basis: '蓝图 §2.2 #4（阈值 0.8）＋16 号件 §4B（双口径）＋19 号件 §3.2（零 LLM 降级版）',
    theory: 'Satopää et al. 2014 arXiv:1406.2148v5；Corr(X_i,X_j)=λ；F55 γ=N/((N−1)λ+1)',
    generated_at: new Date().toISOString(),
    discipline: { ledger_write: false, llm: false, network: false, calls_to_llm: 0 },
    method_disclosures: {
      surrogate_not_mle: '双口径（probit 相关／同意率反演）为**代理量**；★2026-09-17 更正：附录 B **并非不在盘上**——arXiv:1501.06943v1 官方 HTML 缓存自带该附录（`docs/assets/forecast-debate/全文精读/_cache-K-1501.06943.txt` L1197 起），本件已逐式实现其 MLE（`fitSymmetricMLE`，λ_mle 字段）⇒ **代理量与法定 MLE 并列披露**；0.8 阈值仍挂在代理量（MLE 未进判据，改动＝版本递进）。',
      confounding: '3 变体与 3 温度一一绑定 ⇒ 测得重叠 ≤ 纯角色重叠（温度采样抖动只衰减相关；尺度项不改相关）⇒ 按「下界」读。',
      clip: 'p∈{0,1} 截断到 0.001/0.999（照论文 GJP 实证做法，InfoDiv 笔记 §增量 7）。',
    },
    threshold: THRESHOLD, clip: CLIP,
    data: { verdict_rows_with_prob: raw.length, triples: triples.length, duplicates_last_wins: dupes, incomplete_groups: incomplete, variant_temperature: VARIANT_TEMP },
    results: results, lambda_lower_bound: lo, lambda_lower_bound_min_ci_low: loCI,
    lambda_mle_lower_bound: (results.map((r) => r.lambda_mle).filter((x) => x !== null).length ? Math.min.apply(null, results.map((r) => r.lambda_mle).filter((x) => x !== null)) : null),
    gamma_at_lower_bound: lo === null ? null : gammaHat(lo),
    decision: decision, variant_shape: shape,
    bootstrap: { B: NB, seed: SEED, method: '按题配对重采样·百分位法' },
  }, null, 1), 'utf8');
  fs.writeFileSync(base + '.md', L.join('\n') + '\n', 'utf8');
  console.log('=== 9 臂先导 λ̂（下界）===');
  console.log('  完整三元组 ' + triples.length + '｜变体↔温度绑定 ' + JSON.stringify(VARIANT_TEMP));
  for (const r of results) console.log('  ' + r.pair + ': n=' + r.n + ' λ̂相关=' + f6(r.lambda_corr) + ' λ̂同意=' + f6(r.lambda_agree) + ' 同意率=' + f6(r.agree_rate));
  console.log('  下界 λ̂_lo = ' + f6(lo) + '｜γ̂ = ' + (lo === null ? 'n/a' : f6(gammaHat(lo))));
  console.log('  判定：' + decision);
  console.log('json/md -> ' + OUT_DIR);
}

module.exports = { probit, ncdf, lambdaCorr, lambdaAgree, gammaHat, fitSymmetricMLE, bootCI, clamp };
if (require.main === module) { main(); }
