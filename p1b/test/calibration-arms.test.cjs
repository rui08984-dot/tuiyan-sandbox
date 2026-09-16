'use strict';
/**
 * p1b/test/calibration-arms.test.cjs —— P0-U4 合成金样 4 组（2026-09-16）
 *
 * ①PAVA 输出非降（随机 100 组）；②beta 恒等回收（已校准数据上 |g(s)−s| 容差）；
 * ③Platt 在 logit 线性合成数据上回收斜率/截距；④极端 p∈{0,1} 无 Inf/NaN。
 * 全确定性（LCG seed 固定），零网络、零 DB。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const cal = require(path.join(ROOT, 'p1b', 'src', 'calibration', 'index.js'));

function lcg(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }
function logit(p) { const q = cal.clampProb(p); return Math.log(q / (1 - q)); }

test('① PAVA：随机 100 组数据 → 预测折线非降', () => {
  const rnd = lcg(20260916);
  for (let g = 0; g < 100; g++) {
    const n = 25;
    const xs = [], ys = [];
    for (let i = 0; i < n; i++) { xs.push(rnd()); ys.push(rnd() < 0.5 ? 1 : 0); }
    const m = cal.isotonic.fit(xs, ys);
    let prev = -Infinity;
    for (let t = 0; t <= 100; t++) {
      const v = m.predict(t / 100);
      assert.ok(v >= prev - 1e-12, '格点 ' + (t / 100) + ' 破坏非降（组 ' + g + '）');
      assert.ok(v >= 0 && v <= 1, '预测越界');
      prev = v;
    }
  }
});

test('② beta 恒等回收：已校准数据上没有系统性偏离（族内含 a=b=1,c=0）', () => {
  const rnd = lcg(987654321);
  const N = 20000; const xs = [], ys = [];
  for (let i = 0; i < N; i++) { const s = rnd(); xs.push(s); ys.push(rnd() < s ? 1 : 0); }
  const m = cal.betaCalibration.fit(xs, ys);
  let maxAbs = 0, sumAbs = 0, cnt = 0;
  for (let t = 5; t <= 95; t += 5) {
    const s = t / 100; const d = Math.abs(m.predict(s) - s);
    maxAbs = Math.max(maxAbs, d); sumAbs += d; cnt++;
  }
  const meanAbs = sumAbs / cnt;
  assert.ok(meanAbs <= 0.01, '平均偏离 >0.01（实测 ' + meanAbs.toFixed(4) + '；a=' + m.a.toFixed(3) + ' b=' + m.b.toFixed(3) + ' c=' + m.c.toFixed(3) + '）');
  assert.ok(maxAbs <= 0.03, '最大偏离 >0.03（实测 ' + maxAbs.toFixed(4) + '）');
  assert.ok(Math.abs(m.a - 1) < 0.15 && Math.abs(m.b - 1) < 0.15 && Math.abs(m.c) < 0.15,
    '参数未回收近恒等：a=' + m.a.toFixed(3) + ' b=' + m.b.toFixed(3) + ' c=' + m.c.toFixed(3));
});

test('③ Platt：logit 线性合成数据上回收斜率/截距（a=1.5, b=−0.4）', () => {
  const rnd = lcg(1664525);
  const N = 20000; const xs = [], ys = [];
  for (let i = 0; i < N; i++) {
    const s = 0.02 + 0.96 * rnd();
    const z = 1.5 * logit(s) - 0.4;
    const p = 1 / (1 + Math.exp(-z));
    xs.push(s); ys.push(rnd() < p ? 1 : 0);
  }
  const m = cal.platt.fit(xs, ys);
  assert.ok(Math.abs(m.a - 1.5) < 0.15, '斜率回收失败：' + m.a.toFixed(3));
  assert.ok(Math.abs(m.b + 0.4) < 0.15, '截距回收失败：' + m.b.toFixed(3));
});

test('④ 极端输入 p∈{0,1} 无 Inf/NaN；四臂可加载且输出在 [0,1]', () => {
  const ext = [0, 1, -1, 2, NaN];
  for (const p of ext) {
    for (const fn of [cal.betaCalibration.betaMap]) {
      const v = fn(p, 1, 1, 0);
      assert.ok(isFinite(v) && v >= 0 && v <= 1, 'betaMap(' + p + ') 越界: ' + v);
    }
    const vp = cal.platt.plattMap(p, 1, 0);
    assert.ok(isFinite(vp) && vp >= 0 && vp <= 1, 'plattMap(' + p + ') 越界: ' + vp);
  }
  assert.equal(cal.clampProb(-5), 1e-6);
  assert.equal(cal.clampProb(5), 1 - 1e-6);
  assert.ok(typeof cal.isotonic.fit === 'function' && typeof cal.betaCalibration.fit === 'function' && typeof cal.platt.fit === 'function');
});
