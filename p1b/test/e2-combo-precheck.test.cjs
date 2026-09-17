'use strict';
/**
 * p1b/test/e2-combo-precheck.test.cjs —— E2 组合增益预检套件 测试（2026-09-17）
 *
 * ① 纯函数：pearson（零方差 ⇒ null 不编数）／spearman／brier／variance
 * ② Marcus RES 口径：无信号 ⇒ RES≈0；完全分辨 ⇒ RES＝UNC（b̂(1−b̂)）
 * ③ 歧义分解恒等式（Krogh–Vedelsby）：|Ē_members − A − Ē_ensemble| ≈ 0（合成数据）
 * ④ 真实件：全引擎矩阵（多引擎题 ≥30）｜L1×L6 与 L2×L3 两对都在｜ρ̂ 判决自洽｜RES 门四引擎｜三零／零副作用
 * ⑤ 确定性：同种子两次 CI 逐位同
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'e2-combo-precheck.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const SIMOUT = path.join(ROOT, 'p1b', 'sim', 'out');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-combo-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const M = require(SCRIPT);

test('① 纯函数：pearson（零方差 ⇒ null）／spearman／brier／variance', () => {
  assert.ok(Math.abs(M.pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-12, '完全正相关');
  assert.ok(Math.abs(M.pearson([1, 2, 3], [6, 4, 2]) + 1) < 1e-12, '完全负相关');
  assert.equal(M.pearson([5, 5, 5], [1, 2, 3]), null, '零方差 ⇒ null（不编数）');
  assert.equal(M.pearson([1, 2], [1, 2]), null, 'n<3 ⇒ null');
  assert.ok(Math.abs(M.spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-12);
  assert.ok(Math.abs(M.brier(0.3, 1) - 0.49) < 1e-12, 'brier(0.3,1)=0.49');
  assert.ok(Math.abs(M.variance([1, 2, 3]) - 2 / 3) < 1e-12);
});

test('② Murphy RES 口径：无信号 ⇒ RES≈0；完全分辨 ⇒ RES＝UNC', () => {
  const flatP = Array(100).fill(0.5), halfY = Array.from({ length: 100 }, (_, i) => (i % 2));
  const f = M.murphyRes(flatP, halfY);
  assert.ok(Math.abs(f.res) < 1e-12, '常数预测 ⇒ RES=0: ' + f.res);
  assert.ok(Math.abs(f.unc - 0.25) < 1e-12, 'UNC=b(1−b)=0.25');
  const perfP = halfY.slice(), perf = M.murphyRes(perfP, halfY);
  assert.ok(Math.abs(perf.res - perf.unc) < 1e-12, '完全分辨 ⇒ RES=UNC: ' + perf.res + ' vs ' + perf.unc);
  assert.ok(Math.abs(perf.brier) < 1e-12, '完全分辨 ⇒ Brier=0');
});

test('③ 歧义分解恒等式（合成）：|Ē_members − A − Ē_ensemble| ≈ 0', () => {
  // 合成 4 题两成员；逐题验证恒等式（Krogh–Vedelsby，平方损失）
  const cases = [
    { pa: 0.2, pb: 0.8, y: 1 }, { pa: 0.9, pb: 0.3, y: 0 },
    { pa: 0.5, pb: 0.5, y: 1 }, { pa: 0.6, pb: 0.7, y: 0 },
  ];
  let worst = 0;
  for (const c of cases) {
    const bs = [M.brier(c.pa, c.y), M.brier(c.pb, c.y)];
    const eMem = (bs[0] + bs[1]) / 2;
    const A = M.variance([c.pa, c.pb]);
    const eEns = M.brier((c.pa + c.pb) / 2, c.y);
    worst = Math.max(worst, Math.abs(eMem - A - eEns));
  }
  assert.ok(worst < 1e-15, '逐题恒等式残差应 ≈0: ' + worst);
  // 输出逐位相同 ⇒ A=0 且组合＝单成员
  const e = M.variance([0.4, 0.4]);
  assert.equal(e, 0, '同输出 ⇒ A=0');
});

test('④ 真实件：矩阵／两对／判决自洽／RES 门／三零／零副作用', () => {
  const before = sha(PROD);
  execFileSync(process.execPath, [SCRIPT, '--out-dir', tmpDir, '--boot', '200'], { encoding: 'utf8' });
  assert.equal(sha(PROD), before, '生产库被改动（应零写库）');
  const j = JSON.parse(fs.readFileSync(path.join(tmpDir, 'e2-combo-precheck-20260917.json'), 'utf8'));
  // ★ 数据标记（随账本增长更新）：2026-09-17 到期题结算 183 条 ⇒ 队列 1202 → 1385；
  //   同日（二十）批再结 4 条（L3 USGS）⇒ 1385 → 1389（读数前进，非口径变更）
  assert.equal(j.cohort_rows, 1389, '队列应与 PREREG §1 池口径一致: ' + j.cohort_rows);
  assert.ok(j.multi_engine_items >= 30, '多引擎题应 ≥30（R3 可估前提）: ' + j.multi_engine_items);
  const pairs = Object.keys(j.pair_population);
  assert.ok(pairs.some((k) => k.indexOf('L1') !== -1 && k.indexOf('L6') !== -1), 'L1×L6 对应在: ' + JSON.stringify(pairs));
  assert.ok(pairs.some((k) => k === 'L2×L3'), 'L2×L3 对应在');
  const p13 = j.rho_precheck.find((r) => r.pair === 'L2×L3');
  assert.equal(p13.identical_outputs, true, 'L2×L3 应为逐位同输出（ACI 只调区间不调点估计）');
  assert.equal(p13.rho_hat, 1, 'ρ̂ 应 ≡1');
  assert.ok(p13.decision.indexOf('判死') !== -1, '同输出 ⇒ 判死');
  const p16 = j.rho_precheck.find((r) => r.pair === 'L1×L6');
  assert.ok(p16.n >= 30, 'L1×L6 n 应 ≥30: ' + p16.n);
  assert.ok(p16.rho_hat !== null && Math.abs(p16.rho_hat) < 0.5, 'L1×L6 ρ̂ 应低: ' + p16.rho_hat);
  assert.ok(p16.decision.indexOf('不停用') !== -1, 'ρ̂ 低 ⇒ 不停用');
  assert.equal(j.res_gate.length, 5, '五个引擎全披露');
  for (const r of j.res_gate) { if (r.note) continue; assert.ok(r.RES >= 0, r.engine + ' RES 应 ≥0'); }
  // 歧义分解恒等式（真实件）
  for (const r of j.ambiguity_decomposition) assert.ok(r.identity_residual < 1e-9, r.pair + ' 恒等式残差过大: ' + r.identity_residual);
  assert.equal(j.discipline.ledger_write, false);
  assert.equal(j.discipline.network, false);
  assert.ok(!/\bfetch\s*\(/.test(fs.readFileSync(SCRIPT, 'utf8')), '不应含 fetch（零网络）');
  const snap = () => fs.readdirSync(SIMOUT).sort().map((f) => f + ':' + fs.statSync(path.join(SIMOUT, f)).mtimeMs).join('\n');
  const s0 = snap();
  execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(SCRIPT) + ')'], { encoding: 'utf8' });
  assert.equal(snap(), s0, 'require 本件不得写盘');
});

test('⑤ 确定性：同种子两次 CI 逐位同；换种子换流', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ ea: (i % 7) / 10, eb: ((i * 3) % 7) / 10 }));
  const f = (s) => M.pearson(s.map((r) => r.ea), s.map((r) => r.eb));
  const a = M.bootCI(rows, f, 200, 4242), b = M.bootCI(rows, f, 200, 4242), c = M.bootCI(rows, f, 200, 9999);
  assert.equal(a.lo, b.lo); assert.equal(a.hi, b.hi);
  assert.notEqual(a.lo, c.lo, '换种子应换流');
});
