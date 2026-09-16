'use strict';
/**
 * p1b/src/calibration/isotonic.js —— 等渗校准（PAVA），纯函数，零 npm 依赖。
 *
 * 依据：【13】U4（第二挑战者臂，**只描述不检验**——【11】§⑦ 先验预期"等渗小样本过拟合会输"；
 *   Kull 2017 摘要同向，项目内 AIA 表 E 同向）。
 * 口径：输入 (scores[], ys[], weights[]?)；PAVA 池化后的**块代表点**（块内 x 均值, 块 y 均值）连成非降折线；
 *   predict(x) 线性插值，两端外推取端点值（不在端点外延伸斜率）。
 * 只说事实：本实现不保证小样本表现——被测对象，不是结论。
 */
const EPS = 1e-6;
function clamp01(p) { return Math.max(EPS, Math.min(1 - EPS, Number(p))); }

/** PAVA：相邻违例池化。返回 { k, reps: [{x,y,n}], predict(x) } */
function fit(scores, ys, weights) {
  const n = scores.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const blocks = [];
  for (const i of idx) {
    blocks.push({ n: weights ? Number(weights[i]) : 1, sumy: ys[i] * (weights ? Number(weights[i]) : 1), sumx: scores[i] * (weights ? Number(weights[i]) : 1), w: weights ? Number(weights[i]) : 1 });
    while (blocks.length > 1) {
      const b2 = blocks[blocks.length - 1]; const b1 = blocks[blocks.length - 2];
      if (b1.sumy / b1.n <= b2.sumy / b2.n) break;   // 已非降 ⇒ 停
      blocks.pop(); blocks.pop();
      blocks.push({ n: b1.n + b2.n, sumy: b1.sumy + b2.sumy, sumx: b1.sumx + b2.sumx, w: b1.w + b2.w });
    }
  }
  const reps = blocks.map((b) => ({ x: b.sumx / b.w, y: b.sumy / b.n, n: b.n }));
  function predict(x) {
    if (!reps.length) return 0.5;
    if (x <= reps[0].x) return reps[0].y;
    const last = reps[reps.length - 1];
    if (x >= last.x) return last.y;
    for (let i = 1; i < reps.length; i++) {
      if (x <= reps[i].x) {
        const a = reps[i - 1]; const b = reps[i];
        const t = (x - a.x) / ((b.x - a.x) || 1);
        return a.y + t * (b.y - a.y);
      }
    }
    return last.y;
  }
  return { k: reps.length, reps: reps, predict: predict, predictClamped: (x) => clamp01(predict(clamp01(x))) };
}

module.exports = { fit: fit };
