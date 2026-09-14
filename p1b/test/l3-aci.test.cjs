'use strict';
/**
 * p1b/test/l3-aci.test.cjs —— L3 引擎（stat_baseline + ACI 外环×滚动窗内环）回归（2026-09-14 新增）
 *
 * 锁五点：
 *   ① 点估计 p 恒为基率（与 L2 同源：同一 note 解析、同一 Wilson 口径），**本层不改 p**；
 *   ② 无反馈 ⇒ α_final=α_star、coverage=null（"未适应"如实，不装已校准）；
 *   ③ γ=0 ⇒ α 恒为 α_star（ACI 关闭时零行为）；
 *   ④ 误差反馈方向正确：连续"预测集不含真值"（err=1）⇒ α 下调并被 α_min 夹住；连续"含"（err=0）⇒ α 上调；
 *   ⑤ 准入线同 L2（n<30 ⇒ ok:false），但 ACI 统计仍如实返回（不吞）。
 * 零网络、零 db、纯函数。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { l3Aci, aciReplay, predictionSet, DEFAULTS } = require(path.join(__dirname, '..', 'src', 'engines', 'l3_aci'));

const NOTE_OK = '历史基率：cutoff 前 120 天中命中 45 占 37.5%（pre-cutoff 窗）';

test('① 点估计 p 恒为基率（与 L2 同源）；ACI 不调 p', () => {
  const a = l3Aci({ counts: { k: 45, n: 120 } });
  const b = l3Aci({ counts: { k: 45, n: 120 }, feedback: [{ p: 0.99, y: 0 }, { p: 0.01, y: 1 }] });
  assert.equal(a.ok, true);
  assert.equal(a.p, b.p, '有无反馈不影响 p（ACI 只调预测集/披露）');
  assert.equal(a.p, 0.375);
  assert.equal(a.method, 'stat_baseline+aci');
  assert.ok(a.ci[0] < a.p && a.p < a.ci[1], 'Wilson CI 同 L2 口径');
  const fromNote = l3Aci({ baseRateNote: NOTE_OK });
  assert.equal(fromNote.p, 0.375, '同源解析：note 解析与 counts 一致');
});

test('② 无反馈 ⇒ α_final=α_star、coverage=null（未适应如实）', () => {
  const r = l3Aci({ counts: { k: 45, n: 120 } });
  assert.equal(r.aci.alpha_final, DEFAULTS.alphaStar);
  assert.equal(r.aci.coverage, null);
  assert.equal(r.aci.ewma_coverage, null);
  assert.ok(/未适应/.test(r.note), 'note 明说未适应');
});

test('③ γ=0 ⇒ α 恒为 α_star（关闭 ACI 时零行为）；γ=0.005 有反馈则 α 变化', () => {
  const fb = [{ p: 0.99, y: 0 }, { p: 0.99, y: 0 }, { p: 0.99, y: 0 }];
  const off = aciReplay(fb, { gamma: 0 });
  assert.equal(off.alpha_final, DEFAULTS.alphaStar, 'γ=0 ⇒ 不变');
  const on = aciReplay(fb, { gamma: 0.005 });
  assert.ok(on.alpha_final < DEFAULTS.alphaStar, '连续 err=1 ⇒ α 下调（放宽）');
  assert.ok(on.coverage && on.coverage.rate === 0, '覆盖率如实 0');
});

test('④ 反馈方向：err=1 ⇒ α 单调降并被 α_min 夹住；err=0 ⇒ α 升并被 α_max 夹住', () => {
  const many = (n, p, y) => Array.from({ length: n }, () => ({ p: p, y: y }));
  const down = aciReplay(many(500, 0.99, 0), { gamma: 0.005 });
  assert.ok(down.alpha_final >= DEFAULTS.alphaMin - 1e-9 && down.alpha_final < 0.05, '夹在 [α_min, α*）内：' + down.alpha_final);
  const up = aciReplay(many(500, 0.5, 1), { gamma: 0.005 });
  assert.ok(up.alpha_final <= DEFAULTS.alphaMax + 1e-9 && up.alpha_final > 0.05, '夹在 (α*, α_max] 内：' + up.alpha_final);
  // 预测集语义：p=0.5、α=0.05 ⇒ 集合含两类（不装自信）
  assert.deepEqual(predictionSet(0.5, 0.05), [0, 1]);
  assert.deepEqual(predictionSet(0.99, 0.05), [1]);
  assert.deepEqual(predictionSet(0.01, 0.05), [0]);
});

test('⑤ 准入线同 L2：n<30 ⇒ ok:false，但 ACI 统计仍如实返回', () => {
  const r = l3Aci({ counts: { k: 5, n: 20 }, feedback: [{ p: 0.99, y: 0 }] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'insufficient_data');
  assert.equal(r.p, null);
  assert.equal(r.n, 20);
  assert.ok(r.aci && r.aci.coverage && r.aci.coverage.n === 1, 'ACI 披露不吞（仍回放并如实给覆盖）');
  // 非法反馈项被跳过
  const skip = aciReplay([{ p: 'x', y: 1 }, { p: 0.5, y: 'no' }, { p: 0.5, y: 1 }]);
  assert.equal(skip.coverage.n, 1);
});
