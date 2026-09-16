'use strict';
/**
 * p1b/src/calibration/betaCalibration.js —— beta calibration 三参数族（主挑战者），纯函数，零 npm 依赖。
 *
 * 公式（转录核对记录 · 2026-09-16）：g(s; a, b, c) = 1 / (1 + exp( −a·ln s + b·ln(1−s) − c ))
 *   等价 logit(g) = a·ln s − b·ln(1−s) + c。
 *   核对源＝Silva Filho et al.《Classifier calibration: a survey on how to assess and improve predicted
 *   class probabilities》arXiv:2112.10327 式(10)（"Beta calibration is a bivariate logistic regression"）；
 *   原始出处＝Kull, Silva Filho & Flach 2017（AISTATS / 期刊版 **DOI 10.1214/17-ejs1338si**）。
 *   恒等映射在族内：a=b=1, c=0 ⇒ g(s)=s —— 这正是它作「主挑战者」的资格（【11】§⑦）。
 * 约束（Kull 2017）：a,b ≥ 0（保单调增、值域含在 [0,1]），c ∈ R。
 *   本实现参数化 a=e^α、b=e^β（无约束）＋ c=γ，用 Nelder-Mead 最小化 log loss（NLL）。
 * 用法：const m = require('.../betaCalibration').fit(scores, ys); m.predict(x) / m.a/m.b/m.c
 */
const EPS = 1e-6;
function clampProb(p) { const x = Number(p); return Math.max(EPS, Math.min(1 - EPS, isFinite(x) ? x : 0.5)); }

/** 校准映射本体（严格按上式；s 先夹断到 [EPS, 1−EPS]） */
function betaMap(s, a, b, c) {
  const sc = clampProb(s);
  return 1 / (1 + Math.exp(-a * Math.log(sc) + b * Math.log(1 - sc) - c));
}

/** 通用 Nelder-Mead（供 beta/platt 共用；维度 ≤4 的平滑无约束极小化足够） */
function nelderMead(f, x0, opts) {
  const o = opts || {};
  const maxIter = o.maxIter || 500; const tol = o.tol || 1e-10;
  const n = x0.length;
  const alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;
  const step = o.step || 0.25;
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += (p[i] !== 0 ? step * p[i] : step); pts.push(p); }
  const val = pts.map(f);
  let iters = 0;
  for (; iters < maxIter; iters++) {
    const order = val.map((v, i) => i).sort((a, b) => val[a] - val[b]);
    pts = order.map((i) => pts[i]); const vals = order.map((i) => val[i]);
    for (let i = 0; i < n + 1; i++) val[i] = vals[i];
    if (Math.abs(val[n] - val[0]) <= tol * (Math.abs(val[0]) + Math.abs(val[n]) + 1e-12)) break;
    const cent = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cent[j] += pts[i][j] / n;
    const refl = cent.map((c, j) => c + alpha * (c - pts[n][j]));
    const fr = f(refl);
    if (fr < val[0]) {
      const exp_ = cent.map((c, j) => c + gamma * (refl[j] - c));
      const fe = f(exp_);
      if (fe < fr) { pts[n] = exp_; val[n] = fe; } else { pts[n] = refl; val[n] = fr; }
    } else if (fr < val[n - 1]) { pts[n] = refl; val[n] = fr; }
    else {
      const contr = cent.map((c, j) => c + rho * (pts[n][j] - c));
      const fc = f(contr);
      if (fc < val[n]) { pts[n] = contr; val[n] = fc; }
      else {
        for (let i = 1; i < n + 1; i++) { pts[i] = pts[i].map((x, j) => pts[0][j] + sigma * (x - pts[0][j])); val[i] = f(pts[i]); }
      }
    }
  }
  const order = val.map((v, i) => i).sort((a, b) => val[a] - val[b]);
  return { x: pts[order[0]].slice(), f: val[order[0]], iters: iters };
}

/** 拟合：最小化 NLL（对 s 夹断；y∈{0,1}） */
function fit(scores, ys, opts) {
  const S = scores.map(clampProb); const Y = ys.map((y) => (Number(y) > 0.5 ? 1 : 0));
  const nll = (p) => {
    const a = Math.exp(p[0]), b = Math.exp(p[1]), c = p[2];
    let s = 0;
    for (let i = 0; i < S.length; i++) {
      const g = betaMap(S[i], a, b, c);
      s += -(Y[i] * Math.log(g) + (1 - Y[i]) * Math.log(1 - g));
    }
    return s / S.length;
  };
  const best = nelderMead(nll, (opts && opts.x0) || [0, 0, 0], opts);
  const a = Math.exp(best.x[0]), b = Math.exp(best.x[1]), c = best.x[2];
  return { a: a, b: b, c: c, nll: best.f, iters: best.iters, family: 'beta',
    predict: (x) => betaMap(x, a, b, c), predictClamped: (x) => clampProb(betaMap(x, a, b, c)) };
}

module.exports = { betaMap: betaMap, fit: fit, nelderMead: nelderMead, clampProb: clampProb };
