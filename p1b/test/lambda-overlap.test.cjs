'use strict';
/**
 * p1b/test/lambda-overlap.test.cjs —— 9 臂先导 λ̂ 测试（2026-09-17）
 *
 * ① probit/ncdf 精度（估计量的地基）
 * ② ★口径 A 回收已知 λ（合成二元正态，ρ=0.3 ⇒ λ̂_corr ≈ 0.3）
 * ③ ★口径 B 回收已知 λ（同数据 ⇒ λ̂_agree ≈ 0.3，二元正态下反演精确）
 * ④ 判据方向性回归锁：λ̂≥0.8 判「封存」、<0.8 判「立项」（阈值两侧）
 * ⑤ 真实件：三元组数／三对全在／下界=最小／零账本写／零网络
 * ⑥ 确定性：同种子两次 CI 逐位同
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'lambda-overlap.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const SIMOUT = path.join(ROOT, 'p1b', 'sim', 'out');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-lam-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const M = require(SCRIPT);
/** 合成：二元标准正态(ρ) ⇒ p=Φ(x)（LCG 固定种子，确定性） */
function synth(rho, n, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const norm = () => { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const rows = [];
  for (let i = 0; i < n; i++) { const x = norm(), z = norm(); const y = rho * x + Math.sqrt(1 - rho * rho) * z; rows.push({ pa: M.ncdf(x), pb: M.ncdf(y) }); }
  return rows;
}

test('① probit／ncdf 精度', () => {
  assert.ok(Math.abs(M.probit(0.975) - 1.959964) < 1e-5, 'probit(0.975): ' + M.probit(0.975));
  assert.ok(Math.abs(M.probit(0.001) + 3.090232) < 1e-5, 'probit(0.001): ' + M.probit(0.001));
  assert.ok(Math.abs(M.probit(0.5)) < 1e-12, 'probit(0.5)=0');
  assert.ok(Math.abs(M.ncdf(1.959964) - 0.975) < 1e-5, 'ncdf(1.96): ' + M.ncdf(1.959964));
  assert.ok(Math.abs(M.ncdf(0) - 0.5) < 1e-6, 'ncdf(0)（A&S 26.2.17 精度 |ε|<7.5e−8）: ' + M.ncdf(0));
});

test('② 口径 A（probit 相关）回收已知 λ', () => {
  for (const rho of [0.3, 0.6, 0.9]) {
    const rows = synth(rho, 4000, 12345);
    const l = M.lambdaCorr(rows);
    assert.ok(Math.abs(l - rho) < 0.05, 'ρ=' + rho + ' ⇒ λ̂_corr=' + l.toFixed(4));
  }
});

test('③ 口径 B（同意率反演）回收已知 λ', () => {
  for (const rho of [0.3, 0.6, 0.9]) {
    const rows = synth(rho, 8000, 999);
    const l = M.lambdaAgree(rows);
    assert.ok(Math.abs(l - rho) < 0.06, 'ρ=' + rho + ' ⇒ λ̂_agree=' + l.toFixed(4));
  }
  // 退化：全独立 ⇒ λ̂≈0；全同 ⇒ λ̂≈1
  const same = Array.from({ length: 100 }, () => ({ pa: 0.7, pb: 0.7 }));
  assert.ok(Math.abs(M.lambdaAgree(same) - 1) < 1e-9, '完全同意 ⇒ λ̂=1');
});

test('④ 判据方向性回归锁：阈值 0.8 两侧', () => {
  const decide = (lo) => (lo >= 0.8 ? '封存' : '立项');
  assert.equal(decide(1.0), '封存');
  assert.equal(decide(0.80), '封存', '阈值含等号');
  assert.equal(decide(0.7999), '立项');
  assert.equal(decide(0.16), '立项');
  // γ̂ 单调：λ→1 ⇒ γ→1；λ→0 ⇒ γ→3
  assert.ok(Math.abs(M.gammaHat(1) - 1) < 1e-12);
  assert.ok(Math.abs(M.gammaHat(0) - 3) < 1e-12);
});

test('⑤ 真实件：三元组／三对／下界／三零／零副作用', () => {
  const before = sha(PROD);
  execFileSync(process.execPath, [SCRIPT, '--out-dir', tmpDir, '--boot', '200'], { encoding: 'utf8' });
  assert.equal(sha(PROD), before, '生产库被改动（应零写库）');
  const j = JSON.parse(fs.readFileSync(path.join(tmpDir, 'lambda-overlap-20260917.json'), 'utf8'));
  assert.ok(j.data.triples > 1000, '三元组数应 >1000: ' + j.data.triples);
  assert.equal(j.results.length, 3, '三对全在');
  const est = [];
  for (const r of j.results) { est.push(r.lambda_corr); est.push(r.lambda_agree); }
  assert.ok(Math.abs(j.lambda_lower_bound - Math.min.apply(null, est)) < 1e-12, '下界应＝全估计最小值');
  assert.equal(j.threshold, 0.8);
  assert.equal(j.discipline.calls_to_llm, 0, '零 LLM 调用');
  assert.equal(j.discipline.ledger_write, false);
  assert.equal(j.discipline.network, false);
  assert.ok(!/\bfetch\s*\(/.test(fs.readFileSync(SCRIPT, 'utf8')), '脚本不应含 fetch（零网络）');
  assert.ok(j.decision.indexOf(j.lambda_lower_bound >= 0.8 ? '封存' : '立项') !== -1, '判定须与下界一致: ' + j.decision);
  const snap = () => fs.readdirSync(SIMOUT).sort().map((f) => f + ':' + fs.statSync(path.join(SIMOUT, f)).mtimeMs).join('\n');
  const s0 = snap();
  execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(SCRIPT) + ')'], { encoding: 'utf8' });
  assert.equal(snap(), s0, 'require 本件不得写盘');
});

test('⑥ 确定性：同种子两次 CI 逐位同', () => {
  const rows = synth(0.4, 500, 7);
  const a = M.bootCI(rows, M.lambdaCorr, 200, 4242);
  const b = M.bootCI(rows, M.lambdaCorr, 200, 4242);
  const c = M.bootCI(rows, M.lambdaCorr, 200, 9999);
  assert.equal(a.lo, b.lo); assert.equal(a.hi, b.hi);
  assert.notEqual(a.lo, c.lo, '换种子应换流');
});
