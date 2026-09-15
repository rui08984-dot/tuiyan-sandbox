'use strict';
/**
 * d2-hb.test.cjs —— D2-HB 层级贝叶斯部分池化 **口径与收敛锁定测试**（2026-09-15）。
 *
 * 判据来源：`.scratch/forecast-debate/PREREG-D2-HB-v1.md`（sha `e510a58d…`，已冻结）
 *   ＋ `…-v1.1-补充与勘误.md`（收缩量口径更正，版本递进）。
 * 上游：规格 D2 §11.5（部分池化条款）＋ E-算法工具箱 §8。
 *
 * 铁律：零网络、零 LLM、零写库（只读产物）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const HB = path.join(ROOT, '.scratch/backtest/d2-hb-report.json');
const D2 = path.join(ROOT, '.scratch/backtest/d2-report.json');

test('D2-HB：收敛判据四项全 PASS（照 PREREG §5；任一不达即整体作废）', () => {
  assert.ok(fs.existsSync(HB), '前提：HB 产物存在');
  const j = JSON.parse(fs.readFileSync(HB, 'utf8'));
  const c = j.convergence;
  assert.equal(c.pass, true, '收敛判定须 PASS');
  assert.ok(c.r_hat_max < 1.01, 'R̂ 须 <1.01（实测 ' + c.r_hat_max + '）');
  assert.ok(c.ess_min >= 400, 'ESS 须 ≥400（实测 ' + c.ess_min + '）');
  assert.equal(c.divergences, 0, 'divergences 须 =0（实测 ' + c.divergences + '）');
  assert.ok(c.bfmi_min >= 0.3, 'BFMI 须 ≥0.3（实测 ' + c.bfmi_min + '）');
});

test('D2-HB：冻结物与 PREREG 逐字一致（先验/超参/收敛阈值/层级结构）', () => {
  const j = JSON.parse(fs.readFileSync(HB, 'utf8'));
  const f = j.frozen;
  // 先验族（PREREG §3.2）
  assert.equal(f.prior.mu, 'Normal(0, 1.5)');
  assert.equal(f.prior.tau, 'HalfNormal(1.0)');
  assert.equal(f.prior.eta, 'Normal(0,1)');
  assert.equal(f.prior.param, 'non-centered', '须非中心化参数化（防漏斗）');
  // 层级结构（PREREG §3.1）
  assert.equal(f.structure.random_effect, 'city x month');
  assert.equal(f.structure.unit, 'horizon_bucket x tier');
  // 适用层（PREREG §3.3：仅 L3）
  assert.deepEqual(f.layers, ['L3'], '本批只做 L3（照规格 §11.5 ④）');
  // 采样超参（PREREG §3.4）
  assert.equal(f.sampling.chains, 4);
  assert.equal(f.sampling.tune, 1000);
  assert.equal(f.sampling.draws, 2000);
  assert.equal(f.sampling.target_accept, 0.95);
  assert.equal(f.sampling.seed, 987654321);
  // 收敛阈值（PREREG §5）
  assert.equal(f.convergence.r_hat_max, 1.01);
  assert.equal(f.convergence.ess_min, 400);
  assert.equal(f.convergence.divergences_max, 0);
  assert.equal(f.convergence.bfmi_min, 0.3);
});

test('D2-HB：输出契约 —— 每单元给 收缩后估计 + 收缩量 + 95% 等尾区间（PREREG §4）', () => {
  const j = JSON.parse(fs.readFileSync(HB, 'utf8'));
  assert.ok(j.by_cell.length > 0, '须有单元');
  for (const c of j.by_cell) {
    assert.ok(typeof c.theta_post_mean === 'number', c.cell + '：须给收缩后估计');
    assert.ok(typeof c.shrinkage === 'number', c.cell + '：须给收缩量');
    assert.ok(Array.isArray(c.hdi95) && c.hdi95.length === 2, c.cell + '：须给 95% 等尾区间');
    assert.ok(c.hdi95[0] <= c.theta_post_mean && c.theta_post_mean <= c.hdi95[1], c.cell + '：后验均值须落在区间内');
    assert.ok(c.hdi95[0] >= 0 && c.hdi95[1] <= 1, c.cell + '：区间须在 [0,1]');
    // 披露项
    assert.ok(typeof c.n === 'number' && typeof c.ybar_unit === 'number' && typeof c.ybar_global === 'number', c.cell + '：须披露 n/ybar');
  }
});

test('D2-HB：n<30 单元只给池化估计、不给裸读数（PREREG §4 禁项）', () => {
  const j = JSON.parse(fs.readFileSync(HB, 'utf8'));
  const thin = j.by_cell.filter((c) => c.n < 30);
  assert.ok(thin.length > 0, '前提：存在 n<30 单元（实测 3 个「近」档）');
  for (const c of thin) {
    assert.equal(c.needs_pooling, true, c.cell + '：n<30 须标 needs_pooling');
    assert.equal(c.conclusion_allowed, false, c.cell + '：n<30 不得出结论');
    assert.equal(c.brier, undefined, c.cell + '：n<30 **不得**给裸 Brier（那正是规格要取代的）');
  }
  // 对照：n>=30 的单元
  const fat = j.by_cell.filter((c) => c.n >= 30);
  for (const c of fat) assert.equal(c.conclusion_allowed, true, c.cell + '：n>=30 可出结论');
});

test('D2-HB：收缩量口径（v1.1）—— 值域 [0,1] ＋ 组级单调性', () => {
  const j = JSON.parse(fs.readFileSync(HB, 'utf8'));
  // ① 值域：所有单元/组的收缩量须落 [0,1]（v1.1 插值系数口径）
  for (const c of j.by_cell) {
    assert.ok(c.shrinkage >= -1e-9 && c.shrinkage <= 1 + 1e-9,
      c.cell + '：收缩量须落 [0,1]（实测 ' + c.shrinkage + '）');
  }
  for (const g of j.by_group) {
    assert.ok(g.shrinkage >= -1e-9 && g.shrinkage <= 1 + 1e-9, '组 ' + g.group + '：收缩量须落 [0,1]');
  }
  // ② 单调性判据**提在组级**（v1.1 层级更正；单元级无依据——随机效应在 city×month）
  assert.ok(j.group_monotonicity, '须给组级单调性');
  const bk = j.group_monotonicity.by_n_bucket;
  const keys = ['n<=5', '6-10', '>10'].filter((k) => k in bk);
  for (let i = 0; i + 1 < keys.length; i++) {
    assert.ok(bk[keys[i]] >= bk[keys[i + 1]],
      '组级单调性：' + keys[i] + '(' + bk[keys[i]].toFixed(3) + ') 须 >= ' + keys[i + 1] + '(' + bk[keys[i + 1]].toFixed(3) + ')');
  }
});

test('D2-HB：诚实标注 —— 池化非实测；零账本写；不混入 D2 裸分层读数', () => {
  const j = JSON.parse(fs.readFileSync(HB, 'utf8'));
  assert.match(j.honesty, /回测/, '须挂历史回测标注');
  assert.match(j.honesty, /非实测/, '须声明池化非实测读数');
  assert.match(j.isolation_note, /零账本写/, '须声明零账本写');
  // 与 D2 首批（裸分层）分开：HB 产物有 by_cell，但不得含 D2 的 brier 字段（口径不同，禁混）
  for (const c of j.by_cell) assert.equal(c.brier, undefined, 'HB 产物不得混入裸分层 Brier');
});

test('D2-HB：与 D2 题面同源（题数一致；组数 = city×month 去重数）', () => {
  const hb = JSON.parse(fs.readFileSync(HB, 'utf8'));
  const d2 = JSON.parse(fs.readFileSync(D2, 'utf8'));
  assert.equal(hb.n_questions, d2.n, 'HB 题数须与 D2 一致');
  const keys = new Set(d2.rows.map((r) => r.city + '|' + r.month));
  assert.equal(hb.n_groups, keys.size, '组数须 = city×month 去重数');
});
