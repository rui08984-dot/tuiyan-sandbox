'use strict';
/**
 * p1b/test/stage5-rank-diagnostic.test.cjs —— 滞后集合 3 档秩检验（Watson）· 逐对件 测试（2026-09-17）
 *
 * ① 秩函数：三值相对位置＋并列中秩
 * ② Watson U²：平分布取最小值 1/(12n)｜旋转不变
 * ③ ★勘误回归锁：U² 对「整团倾斜」全盲（全秩=3 ⇒ U² 最小、p→1）而倾斜统计量 T 有分辨力
 * ④ 置换确定性：同种子两次同 p
 * ⑤ 真实件：93 题／名册内／y==(obs>thr) 全一致／逐对件 jsonl 行数
 * ⑥ 三零：源码零网络（无 fetch/http）＋零账本写（生产库 sha 不变）＋require 零副作用
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'stage5-rank-diagnostic.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const SIMOUT = path.join(ROOT, 'p1b', 'sim', 'out');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-rank-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const M = require(SCRIPT);

test('① 秩函数：三值相对位置＋并列中秩', () => {
  assert.equal(M.rankOfObs([10, 20, 5], 2), 1, '观测低于两者 ⇒ 秩 1');
  assert.equal(M.rankOfObs([10, 20, 15], 2), 2, '观测居中 ⇒ 秩 2');
  assert.equal(M.rankOfObs([10, 20, 30], 2), 3, '观测高于两者 ⇒ 秩 3');
  assert.equal(M.rankOfObs([10, 10, 10], 2), 2, '三值全等 ⇒ 中秩 2');
  assert.equal(M.rankOfObs([10, 20, 10], 2), 1.5, '与低者并列 ⇒ 中秩 1.5');
  assert.equal(M.rankOfObs([10, 20, 20], 2), 2.5, '与高者并列 ⇒ 中秩 2.5');
});

test('② Watson U²：平分布取最小值 1/(12n)｜旋转不变', () => {
  const mk = (n1, n2, n3) => {
    const a = [];
    for (let i = 0; i < n1; i++) a.push(1 / 3);
    for (let i = 0; i < n2; i++) a.push(2 / 3);
    for (let i = 0; i < n3; i++) a.push(1);
    return a;
  };
  const n = 30;
  assert.ok(Math.abs(M.watsonU2(mk(10, 10, 10)) - 1 / (12 * n)) < 1e-12, '平分布应取最小值 1/(12n)');
  assert.ok(M.watsonU2(mk(3, 9, 18)) > M.watsonU2(mk(10, 10, 10)), '倾斜应抬高 U²');
  assert.ok(M.watsonU2(mk(15, 0, 15)) > M.watsonU2(mk(3, 9, 18)), 'U 形应抬得更高');
  const base = mk(10, 10, 10);
  const rot = base.map((u) => { const v = (u + 0.2) % 1; return v === 0 ? 1 : v; });
  assert.ok(Math.abs(M.watsonU2(rot) - M.watsonU2(base)) < 1e-12, '旋转不变性');
});

test('③ ★勘误回归锁：U² 对整团倾斜全盲，倾斜统计量 T 有分辨力', () => {
  const n = 40;
  const allTop = [];                       // 全题观测高于两名成员 ⇒ 秩全 = 3（圆上一点质量）
  for (let i = 0; i < n; i++) allTop.push({ vals: [10, 12, 30], rank: 3 });
  const u = M.permP(allTop, 1000, 987654321);
  const t = M.permPTilt(allTop, 1000, 987654321);
  assert.ok(Math.abs(u.u2 - 1 / (12 * n)) < 1e-12, 'U² 落在最小值（盲区成立）: ' + u.u2);
  assert.ok(u.p > 0.5, 'U² 的置换 p 应≈1（对倾斜无分辨力）: ' + u.p);
  assert.ok(t.p < 0.01, 'T 的置换 p 应显著（有分辨力）: ' + t.p);
  assert.equal(t.t, 3 * n - 2 * n, 'T = n₃−n₁ = n');
  // 平分布对照：T 应不显著
  const flat = [];
  for (let i = 0; i < n; i++) {
    const mode = i % 3;
    flat.push(mode === 0 ? { vals: [30, 20, 10], rank: 1 } : mode === 1 ? { vals: [10, 30, 20], rank: 2 } : { vals: [20, 10, 30], rank: 3 });
  }
  assert.ok(M.permPTilt(flat, 1000, 987654321).p > 0.5, '平分布 T 不显著');
});

test('④ 置换确定性与种子敏感性：同种子逐位同 p｜异种子读数不同（LCG 输出锁死）', () => {
  // 合成 (6,9,15) 中等倾斜 n=30：p 落在内部（非 0/1 饱和）⇒ 才能验「换种子换流」
  const ps = [];
  for (let i = 0; i < 6; i++) ps.push({ vals: [30, 20, 10], rank: 1 });
  for (let i = 0; i < 9; i++) ps.push({ vals: [10, 30, 20], rank: 2 });
  for (let i = 0; i < 15; i++) ps.push({ vals: [20, 10, 30], rank: 3 });
  const a = M.permP(ps, 500, 4242), a2 = M.permP(ps, 500, 4242);
  const b = M.permP(ps, 500, 9999);
  const c = M.permPTilt(ps, 500, 4242), c2 = M.permPTilt(ps, 500, 4242);
  const d = M.permPTilt(ps, 500, 9999);
  assert.equal(a.p, a2.p, 'U² 置换须可复现（同种子）');
  assert.equal(c.p, c2.p, 'T 置换须可复现（同种子）');
  assert.equal(Number(a.p.toFixed(6)), 0.151697, 'U² p 实测锁死（种子 4242）: ' + a.p);
  assert.equal(Number(c.p.toFixed(6)), 0.051896, 'T p 实测锁死（种子 4242）: ' + c.p);
  assert.notEqual(a.p, b.p, '换种子应换流（U²）: ' + a.p + ' vs ' + b.p);
  assert.notEqual(c.p, d.p, '换种子应换流（T）: ' + c.p + ' vs ' + d.p);
  assert.equal(c.t, 15 - 6, 'T = n₃−n₁ = 9');
});

test('⑤ 真实件：93 题／y==(obs>thr) 全一致／逐对件行数', () => {
  const before = sha(PROD);
  execFileSync(process.execPath, [SCRIPT, '--out', tmpDir, '--tag', '99999999'], { encoding: 'utf8' });
  assert.equal(sha(PROD), before, '生产库被改动（应零写库）');
  const j = JSON.parse(fs.readFileSync(path.join(tmpDir, 'stage5-rank-diagnostic-99999999.json'), 'utf8'));
  assert.equal(j.n_pairs, 93, '逐对件题数应为冻结口径 93');
  assert.equal(j.pool_fingerprint_sha256, require(path.join(ROOT, 'p1b/src/evidence/stage5Pool')).POOL_FINGERPRINT_SHA256, '池指纹须命中冻结锚');
  assert.deepEqual(j.mismatch, [], 'y 与 obs 的一致性自检不应有不一致');
  assert.equal(j.discipline.network, false);
  const jsonl = fs.readFileSync(path.join(tmpDir, 'stage5-rank-pairs-99999999.jsonl'), 'utf8').trim().split('\n');
  assert.equal(jsonl.length, 93, '逐对件 jsonl 应 93 行');
  const p0 = JSON.parse(jsonl[0]);
  for (const k of ['id', 'city', 'date', 'thr', 'y', 'obs', 'f_day1', 'f_day3', 'gt_day1', 'gt_day3', 'rank']) assert.ok(k in p0, '逐对件缺列: ' + k);
  // 秩与两条逐对比较互相自洽
  for (const p of j.pairs) {
    const expect = 1 + (p.obs > p.f_day1 ? 1 : 0) + (p.obs > p.f_day3 ? 1 : 0);
    if (p.obs !== p.f_day1 && p.obs !== p.f_day3) assert.equal(p.rank, expect, 'id=' + p.id + ' 秩与逐对比较不自洽');
    assert.equal(p.gt_day1, p.obs > p.f_day1 ? 1 : 0);
    assert.equal(p.gt_day3, p.obs > p.f_day3 ? 1 : 0);
  }
});

test('⑥ 三零：源码零网络｜文件无「预测」之外的编数｜require 零副作用', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(!/\bfetch\s*\(/.test(src), '脚本不应含 fetch（零网络）');
  assert.ok(!/require\(['"](node:)?https?['"]\)/.test(src), '脚本不应 require http/https');
  const snap = () => fs.readdirSync(SIMOUT).sort().map((f) => f + ':' + fs.statSync(path.join(SIMOUT, f)).mtimeMs).join('\n');
  const before = snap();
  execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(SCRIPT) + ')'], { encoding: 'utf8' });
  assert.equal(snap(), before, 'require 本件不得写盘（主流程应只在 CLI 直跑时执行）');
});
