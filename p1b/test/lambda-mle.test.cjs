'use strict';
/**
 * p1b/test/lambda-mle.test.cjs —— 附录 B 的 MLE（对称信息模型）· **合成回收验证**（2026-09-17）
 *
 * 纪律：**先验证估计量再报数**——用已知 (δ,λ) 生成数据、看 MLE 能否回收；再测边界与确定性。
 * 生成式（与原文 (11) 同参）：P_i ＝ √A_P·z_i ＋ √B_P·z_0，z～N(0,1) iid，
 *   A_P＝(δ−ρ)/(1−δ)、B_P＝ρ/(1−δ)、ρ＝δλ ⇒ Var(P_i)＝δ/(1−δ)、Corr(P_i,P_j)＝λ。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'lambda-overlap.cjs');
const M = require(SCRIPT);

/** 确定性标准正态（Box–Muller ＋ LCG 种子；不用 Math.random ⇒ 可复现）。 */
function gaussFactory(seed) {
  let s = seed >>> 0;
  const u = () => { s = (1664525 * s + 1013904223) >>> 0; return (s + 1) / 4294967297; };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** 生成 N=2 的 probit 向量（已知 δ,λ）。 */
function genPairs(delta, lambda, n, seed) {
  const rho = delta * lambda;
  const A = (delta - rho) / (1 - delta), B = rho / (1 - delta);
  const g = gaussFactory(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const z0 = g();
    out.push([Math.sqrt(A) * g() + Math.sqrt(B) * z0, Math.sqrt(A) * g() + Math.sqrt(B) * z0]);
  }
  return out;
}

test('① ★合成回收：已知 (δ,λ) ⇒ MLE 回收（四组，**全在模型可行域内**）', () => {
  // ★N=2 的可行域（原文约束推导）：δ(2−λ) ≤ 1 ⇒ 高 δ 必须配高 λ。
  //   首版测试曾用 (0.9,0.3) 与 (0.7,λ→0)——**域外**⇒ MLE 只能给边界解（0.84／0.39），不是 bug。
  const cases = [
    { delta: 0.5, lambda: 0.5, tol: 0.08 },    // δ(2−λ)=0.75 ≤ 1
    { delta: 0.7, lambda: 0.8, tol: 0.08 },    // 0.84
    { delta: 0.6, lambda: 0.95, tol: 0.08 },   // 0.63
    { delta: 0.4, lambda: 0.1, tol: 0.08 },    // 0.76
  ];
  for (const c of cases) {
    const fit = M.fitSymmetricMLE(genPairs(c.delta, c.lambda, 4000, 987654321), { center: true });
    assert.ok(fit, 'δ=' + c.delta + ' λ=' + c.lambda + '：应给出拟合');
    assert.equal(fit.feasible, true, '须落可行域（(A_Ω,B_Ω) 三约束）');
    assert.ok(Math.abs(fit.lambda - c.lambda) < c.tol, 'λ̂ 回收：真 ' + c.lambda + ' ⇒ 估 ' + fit.lambda.toFixed(4));
    assert.ok(Math.abs(fit.delta - c.delta) < c.tol, 'δ̂ 回收：真 ' + c.delta + ' ⇒ 估 ' + fit.delta.toFixed(4));
    assert.ok(fit.delta * (2 - fit.lambda) <= 1 + 1e-6, '★回代结果须满足模型可行域 δ(2−λ) ≤ 1');
  }
});

test('② 边界：近完全重叠 ⇒ λ̂→1；近独立（δ=0.4 可行）⇒ λ̂→0；样本不足 ⇒ null', () => {
  const same = genPairs(0.7, 0.999, 2000, 424242);              // λ→1（近同一信号）
  const f1 = M.fitSymmetricMLE(same);
  assert.ok(f1.lambda > 0.95, '近完全重叠 ⇒ λ̂ 应 >0.95（实测 ' + f1.lambda.toFixed(4) + '）');
  const indep = genPairs(0.4, 1e-6, 2000, 424242);              // λ→0（δ=0.4 ⇒ δ(2−λ)=0.8 ≤ 1 可行）
  const f0 = M.fitSymmetricMLE(indep);
  assert.ok(f0.lambda < 0.1, '近独立 ⇒ λ̂ 应 <0.1（实测 ' + f0.lambda.toFixed(4) + '）');
  assert.equal(M.fitSymmetricMLE([[0.1, 0.2], [0.3, 0.4]]), null, '<3 题 ⇒ null（不编数）');
  assert.equal(M.fitSymmetricMLE([]), null, '空输入 ⇒ null');
});

test('③ 性质：值域／确定性／居中无关（已中心化数据上 center 不改变结果）', () => {
  const P = genPairs(0.6, 0.6, 1500, 13579);
  const a = M.fitSymmetricMLE(P);
  const b = M.fitSymmetricMLE(P);
  assert.deepEqual(a, b, '同输入 ⇒ 逐位相同（确定性）');
  assert.ok(a.delta >= 0 && a.delta <= 1, 'δ ∈ [0,1]: ' + a.delta);
  assert.ok(a.lambda >= 0 && a.lambda < 1, 'λ ∈ [0,1): ' + a.lambda);
  assert.ok(a.rho >= 0 && a.rho <= a.delta + 1e-9, 'ρ＝δλ ≤ δ（可行域）');
  // 对「近似中心化」的数据，center 开关只带来小差异（样本均值非严格 0 ⇒ 是否去均值会微改样本协方差）；
  //   默认 center=true（模型假定均值 0）。此断言锁「两口径同量级」，不锁逐位相等。
  const c = M.fitSymmetricMLE(P, { center: false });
  assert.ok(Math.abs(c.lambda - a.lambda) < 1e-2, 'center 开关在近中心化数据上应同量级（实测 λ ' + a.lambda.toFixed(6) + ' vs ' + c.lambda.toFixed(6) + '）');
});

test('④ 真实数据（存量 verdicts）：MLE 可算且与代理量同量级（只读，零写）', () => {
  const fs = require('node:fs');
  const DB = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare("SELECT prediction_id, prompt_variant, implied_prob FROM verdicts WHERE implied_prob IS NOT NULL ORDER BY id").all();
  db.close();
  const by = {};
  for (const r of rows) { by[r.prediction_id] = by[r.prediction_id] || {}; by[r.prediction_id][r.prompt_variant] = Number(r.implied_prob); }
  const P = [];
  for (const pid of Object.keys(by)) {
    const g = by[pid];
    if (g.v1_evidence === undefined || g.v3_baserate === undefined) continue;
    P.push([M.probit(M.clamp(g.v1_evidence)), M.probit(M.clamp(g.v3_baserate))]);
  }
  assert.ok(P.length > 300, '样本应 >300（实测 ' + P.length + '）');
  const fit = M.fitSymmetricMLE(P);
  assert.ok(fit && fit.feasible, '真实数据上 MLE 须可算且可行');
  assert.ok(fit.lambda >= 0 && fit.lambda < 1, 'λ̂ ∈ [0,1)');
  // 只披露同量级（不作判据：MLE 未进 0.8 判据）
  assert.ok(fit.lambda < 0.8, '★与代理量同向：MLE λ̂ 亦 <0.8（实测 ' + fit.lambda.toFixed(4) + '）');
});
