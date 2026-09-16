'use strict';
/**
 * p1b/src/calibration/platt.js —— Platt 一维 logistic 校准（参照臂），纯函数，零 npm 依赖。
 *
 * 形态：g(s) = σ(a·logit(s) + b)（【13】U4 原文；Platt 1999 的 sigmoid 拟合）。
 *   ——注意：它**不含恒等映射**（a=1,b=0 才退化到恒等，但 σ(logit(s))=s 在 a=1,b=0 成立 ⇒ 其实恒等在
 *   延拓族内；Kull 2017 摘要说的"logistic curve family does not include identity"指 Platt 原始的正则化形态）。
 *   本实现按【13】定义的 (a,b) 二维族拟合，不引入 Platt 先验目标 π（那是"数据集平衡修正"的另一件事，此处不冒充）。
 * 用法：const m = require('.../platt').fit(scores, ys); m.predict(x)
 */
const { nelderMead, clampProb } = require('./betaCalibration');
function logit(p) { const q = clampProb(p); return Math.log(q / (1 - q)); }
function plattMap(s, a, b) { return 1 / (1 + Math.exp(-(a * logit(s) + b))); }

function fit(scores, ys, opts) {
  const Z = scores.map(logit); const Y = ys.map((y) => (Number(y) > 0.5 ? 1 : 0));
  const nll = (p) => {
    let s = 0;
    for (let i = 0; i < Z.length; i++) {
      const g = 1 / (1 + Math.exp(-(p[0] * Z[i] + p[1])));
      s += -(Y[i] * Math.log(Math.max(1e-12, g)) + (1 - Y[i]) * Math.log(Math.max(1e-12, 1 - g)));
    }
    return s / Z.length;
  };
  const best = nelderMead(nll, (opts && opts.x0) || [1, 0], opts);
  const a = best.x[0], b = best.x[1];
  return { a: a, b: b, nll: best.f, iters: best.iters, family: 'platt',
    predict: (x) => plattMap(x, a, b), predictClamped: (x) => clampProb(plattMap(x, a, b)) };
}

module.exports = { plattMap: plattMap, fit: fit };
