'use strict';
/**
 * p1b/test/calab-run.test.cjs —— P0-U5 测试（2026-09-16）
 * ①合成夹具（200 题已知漂移注入）→ 挑战者臂方向可复现、恒等臂回收；
 * ②同输入两次运行 CI 逐位相等（seed 确定性）；③切窗边界（n<50 合并逻辑）；
 * ④零写库断言：子进程跑真实库前后 sha256 不变（输出落临时目录）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'calab-run.cjs');
const MOD = require(SCRIPT);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-calab-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

function lcg(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }
function logit(p) { return Math.log(p / (1 - p)); }
function sigm(z) { return 1 / (1 + Math.exp(-z)); }
function sha256(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); }

test('① 合成漂移夹具（n=200，收缩因子 0.4）→ beta 方向修正、恒等臂即观测基线', () => {
  const rnd = lcg(20260916);
  const items = [];
  for (let i = 0; i < 200; i++) {
    const p = 0.05 + 0.9 * rnd();
    const q = sigm(0.4 * logit(p));          // 已知漂移：预测过度自信（应向 0.5 收缩）
    const y = rnd() < q ? 1 : 0;
    items.push({ id: i + 1, t: '2026-01-' + String((i % 28) + 1).padStart(2, '0'), p: p, y: y });
  }
  const r = MOD.evaluateArms(items);
  // 恒等臂回收：Brier 等于逐题直接算（在评估窗上）
  assert.ok(r.arms.identity.brier > 0.05 && r.arms.identity.brier < 0.5, '恒等臂 Brier 合理: ' + r.arms.identity.brier);
  // 方向：注入过度自信 ⇒ beta（可学到收缩）应优于恒等
  assert.ok(r.delta_beta_vs_identity.mean < 0, 'beta 方向未复现: Δ=' + r.delta_beta_vs_identity.mean);
  assert.ok(r.arms.beta.brier < r.arms.identity.brier, 'beta Brier 未低于恒等');
  assert.equal(r.delta_beta_vs_identity.B, 1000, 'B=1000');
  assert.equal(r.delta_beta_vs_identity.seed, 987654321, 'seed=987654321');
});

test('② 确定性：同输入两次运行 CI 逐位相等', () => {
  const rnd = lcg(7); const items = [];
  for (let i = 0; i < 300; i++) { const p = 0.02 + 0.96 * rnd(); items.push({ id: i + 1, t: 'T' + (i % 40), p: p, y: rnd() < p ? 1 : 0 }); }
  const a = MOD.evaluateArms(items); const b = MOD.evaluateArms(items);
  assert.deepEqual(a.delta_beta_vs_identity, b.delta_beta_vs_identity, 'CI 逐位一致');
  assert.deepEqual(a.arms, b.arms, '四臂读数一致');
});

test('③ 切窗边界：n<50 的窗向后合并；评估题数=合并后第 2 窗起之和', () => {
  const items = [];
  for (let i = 0; i < 120; i++) items.push({ id: i + 1, t: 'D' + String(i).padStart(3, '0'), p: 0.3, y: i % 2 });
  const r = MOD.evaluateArms(items);
  const sum = r.folds.reduce((x, y) => x + y, 0);
  assert.equal(sum, 120, '窗划分守恒');
  for (let i = 0; i < r.folds.length - 1; i++) assert.ok(r.folds[i] >= 50, '非末窗必须 ≥50（合并生效）');
  const evaluated = r.folds.slice(1).reduce((x, y) => x + y, 0);
  assert.equal(r.arms.identity.n, evaluated, '评估题数=第 2 窗起之和');
  assert.equal(r.arms.identity.n, 48, '本例合并为 [72,48] ⇒ 评估 48');
});

test('④ 零写库：子进程跑真实库前后 sha256 不变（输出落临时目录）', () => {
  const db = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
  assert.ok(fs.existsSync(db), '生产库存在');
  const before = sha256(db);
  execFileSync(process.execPath, [SCRIPT, '--db', db, '--out-dir', tmpDir], { stdio: 'ignore' });
  const after = sha256(db);
  assert.equal(after, before, '生产库 sha256 前后一致（零写库）');
  const files = fs.readdirSync(tmpDir).filter((f) => /^calab-report-\d{8}\.(json|md)$/.test(f));
  assert.ok(files.some((f) => f.endsWith('.json')) && files.some((f) => f.endsWith('.md')), '报告 json/md 落盘: ' + files.join(','));
});
