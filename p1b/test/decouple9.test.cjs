'use strict';
/**
 * p1b/test/decouple9.test.cjs —— 9 臂解耦实验 · 估计量与守卫测试（2026-09-17）
 *
 * 纪律（PREREG §7.7「测试先于读数」）：**先验证估计量再报数**——用已知真值生成数据看能否回收；
 * 再测守卫（冻结 sha 篡改 ⇒ 硬失败）、派生规则（零 RNG 可复现）、require 安全（零副作用）。
 * 本件不调用 LLM、不写库、不动产物（除临时目录）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(ROOT, 'p1b', 'scripts', 'decouple9-run.cjs');
const ANALYZE = path.join(ROOT, 'p1b', 'scripts', 'decouple9-analyze.cjs');
const FREEZE = path.join(ROOT, 'p1b', 'scripts', 'prereg-freeze.cjs');
const LAMBDA = path.join(ROOT, 'p1b', 'scripts', 'lambda-overlap.cjs');
const PREREG = path.join(ROOT, 'docs', 'assets', 'forecast-debate', 'PREREG-9臂解耦-v1.md');
const ANCHOR = path.join(ROOT, 'p1b', 'sim', 'out', 'decouple9-anchor-20260917.json');

const R = require(RUNNER);
const A = require(ANALYZE);
const M = require(LAMBDA);
const F = require(FREEZE);

/** 确定性标准正态（Box–Muller ＋ LCG 种子；照 lambda-mle.test.cjs 先例，可复现）。 */
function gaussFactory(seed) {
  let s = seed >>> 0;
  const u = () => { s = (1664525 * s + 1013904223) >>> 0; return (s + 1) / 4294967297; };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
/** 生成 N 成员的 probit 向量（已知 δ,λ；与原文 (11) 同参：P_i＝√A·z_i＋√B·z_0）。 */
function genN(delta, lambda, n, seed, N) {
  const rho = delta * lambda, Aa = (delta - rho) / (1 - delta), Bb = rho / (1 - delta);
  const g = gaussFactory(seed); const out = [];
  for (let i = 0; i < n; i++) {
    const z0 = g(); const row = [];
    for (let j = 0; j < N; j++) row.push(Math.sqrt(Aa) * g() + Math.sqrt(Bb) * z0);
    out.push(row);
  }
  return out;
}

// ── ① 锚题派生：零 RNG、规则可复现、无重复 ─────────────────────────────────
test('① 锚题派生：确定性／无重复／轮转覆盖（合成池）', () => {
  const pool = [];
  for (let g = 100; g < 130; g++) for (let q = 0; q < 9; q++) pool.push({ id: g * 100 + q, game_id: g });
  const a = R.deriveAnchor(pool);
  const b = R.deriveAnchor(pool);
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id), '同池 ⇒ 逐位相同（零 RNG）');
  assert.equal(a.length, 40, '应为 30＋10＝40 题');
  assert.equal(new Set(a.map((x) => x.id)).size, 40, '无重复题');
  assert.equal(new Set(a.map((x) => x.game_id)).size, 30, '覆盖 30 局');
  // 第 1 轮＝各局首题（j mod m_j=9 ⇒ j<9 时位置 j）
  const r1 = a.filter((x) => x.round === 1);
  r1.forEach((x, j) => assert.equal(x.pos, j % x.m, '第 1 轮位置须为 j mod m_j'));
  // 第 2 轮＝前 10 局位置 (j+1)
  const r2 = a.filter((x) => x.round === 2);
  r2.forEach((x, j) => assert.equal(x.pos, (j + 1) % x.m, '第 2 轮位置须为 (j+1) mod m_j'));
  // 局数不足 ⇒ 硬失败（防静默缩池）
  assert.throws(() => R.deriveAnchor(pool.slice(0, 9 * 20)), /局数不足/, '<30 局须抛错');
});

test('② 锚题工件与 PREREG 附录一致（若在盘；缺件跳过不伪造）', () => {
  if (!fs.existsSync(ANCHOR)) return;
  const art = JSON.parse(fs.readFileSync(ANCHOR, 'utf8'));
  assert.equal(art.n_questions, 40, '锚题数 40');
  assert.equal(new Set(art.questions.map((q) => q.id)).size, 40, '无重复');
  const md = fs.readFileSync(PREREG, 'utf8');
  const merged = md.match(/合并 id 序列（40）\**[：:]\s*`([0-9,]+)`/);
  assert.ok(merged, 'PREREG 附录须含合并 id 序列');
  assert.equal(merged[1], art.questions.map((q) => q.id).join(','), 'PREREG 附录序列须与工件逐位一致');
});

// ── ③ Holm 与配对统计 ──────────────────────────────────────────────────────
test('③ Holm 步降：已知例 ＋ 单调性 ＋ 值域', () => {
  const adj = A.holm([0.01, 0.02, 0.03]);
  assert.deepEqual(adj.map((x) => Number(x.toFixed(6))), [0.03, 0.04, 0.04], 'Holm(0.01,0.02,0.03)＝(0.03,0.04,0.04)');
  const adj2 = A.holm([0.5, 0.5]);
  assert.deepEqual(adj2, [1, 1], '两两 Holm：2×0.5 截断为 1');
  assert.deepEqual(A.holm([]), [], '空族 ⇒ 空');
  const many = A.holm([0.001, 0.2, 0.9]);
  assert.ok(many.every((x) => x >= 0 && x <= 1), '校正后 p ∈ [0,1]');
});

test('④ pairedStat：常数差 ⇒ CI 退化到该常数；零差 ⇒ CI 含 0 且 p 大', () => {
  const constRows = new Array(40).fill(0).map(() => ({ pa: 0.6, pb: 0.5 }));
  const s1 = A.pairedStat(constRows, 400, 987654321);
  assert.equal(s1.n, 40);
  assert.ok(Math.abs(s1.mean - 0.1) < 1e-12, 'd̄=0.1');
  assert.ok(Math.abs(s1.ci.lo - 0.1) < 1e-9 && Math.abs(s1.ci.hi - 0.1) < 1e-9, '常数差 ⇒ CI 退化');
  assert.equal(s1.ci_excludes_0, true);
  const zeroRows = new Array(40).fill(0).map(() => ({ pa: 0.5, pb: 0.5 }));
  const s0 = A.pairedStat(zeroRows, 400, 987654321);
  assert.equal(s0.mean, 0);
  assert.ok(s0.ci.lo <= 0 && s0.ci.hi >= 0, '零差 ⇒ CI 含 0');
  assert.equal(s0.ci_excludes_0, false);
  assert.equal(s0.sd, 0, '零差 ⇒ σ=0');
  // 确定性（同输入同 seed ⇒ 逐位相同）
  assert.deepEqual(A.pairedStat(constRows, 400, 987654321), s1);
});

// ── ⑤ λ̂ 估计量：合成回收（代理双口径 ＋ N=3 MLE） ─────────────────────────
test('⑤ 代理口径回收：已知 λ ⇒ **喂概率**（生产口径）下双口径均回收', () => {
  // ★口径要点（首版用例写错的教训）：`lambdaCorr/lambdaAgree` 的入参是**概率**（内部自行 clamp＋probit），
  //   不是 probit 值——把 probit 值当概率喂进去会被 clamp 到 [0.001,0.999] 再 probit ⇒ 估出垃圾（0.80）。
  for (const lam of [0.9, 0.5, 0.15]) {
    const P = genN(0.5, lam, 3000, 20260917, 2).map((r) => r.map((x) => M.ncdf(x)));   // 模型 ⇒ 概率
    const a = M.lambdaCorr(P.map((r) => ({ pa: r[0], pb: r[1] })));
    const b = M.lambdaAgree(P.map((r) => ({ pa: r[0], pb: r[1] })));
    assert.ok(Math.abs(a - lam) < 0.06, 'λ=' + lam + ' ⇒ 口径 A 估 ' + a.toFixed(4));
    // 口径 B（同意率反演）在低 λ 处有**已知上偏**（§11 已声明「有系统偏差、两口径并列不合并」）⇒ 容差放宽
    assert.ok(Math.abs(b - lam) < 0.09, 'λ=' + lam + ' ⇒ 口径 B 估 ' + b.toFixed(4));
  }
});

test('⑥ MLE N=3 合成回收：可行域内四组全部回收（tol 0.08）', () => {
  // ★N=3 可行域（本批实测探明，与 N=2 的 δ(2−λ) ≤ 1 同族）：**δ(N−(N−1)λ) ≤ 1**
  const cases = [
    { delta: 0.5, lambda: 0.5 },    // 0.5×2＝1.0（边界，可回收）
    { delta: 0.7, lambda: 0.8 },    // 0.98
    { delta: 0.8, lambda: 0.9 },    // 0.96
    { delta: 0.3, lambda: 0.3 },    // 0.72
  ];
  for (const c of cases) {
    const fit = M.fitSymmetricMLE(genN(c.delta, c.lambda, 4000, 987654321, 3));
    assert.ok(fit, 'δ=' + c.delta + ' λ=' + c.lambda + '：应给出拟合');
    assert.equal(fit.feasible, true, '须落可行域');
    assert.ok(Math.abs(fit.lambda - c.lambda) < 0.08, 'λ̂ 回收：真 ' + c.lambda + ' ⇒ 估 ' + fit.lambda.toFixed(4));
    assert.ok(Math.abs(fit.delta - c.delta) < 0.08, 'δ̂ 回收：真 ' + c.delta + ' ⇒ 估 ' + fit.delta.toFixed(4));
    assert.ok(fit.delta * (3 - 2 * fit.lambda) <= 1 + 1e-6, '★回代须满足 N=3 可行域 δ(3−2λ) ≤ 1');
  }
  assert.equal(M.fitSymmetricMLE([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]), null, '<3 题 ⇒ null（不编数）');
});

test('⑦ 可行域性质（锁进测试）：N=3 域外组合 ⇒ 边界解而非崩溃（如实披露用途）', () => {
  const outside = M.fitSymmetricMLE(genN(0.5, 0.2, 3000, 987654321, 3));   // 0.5×2.6＝1.3 > 1
  assert.ok(outside && outside.feasible, '仍须给出可行解（贴边界）');
  assert.ok(outside.delta * (3 - 2 * outside.lambda) > 1 - 1e-3, '域外真值 ⇒ 解应贴边界 δ(3−2λ)≈1（该量即边界披露指标）');
  assert.ok(outside.lambda > 0.2 + 0.05, '低 λ 域外 ⇒ λ̂ 被系统性抬高（故只作下界读）');
});

// ── ⑧ 冻结守卫 ─────────────────────────────────────────────────────────────
test('⑧ 冻结守卫：PREREG 冻结件复算 MATCH=true；被篡改 ⇒ 复算不符（不写任何产物）', () => {
  const r = F.freezeSha(PREREG);
  assert.equal(r.match, true, '现行 PREREG 须 MATCH=true（若失败：正文被改或未冻结）');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd9-'));
  const copy = path.join(tmp, 'prereg.md');
  const tampered = fs.readFileSync(PREREG, 'utf8').replace('阈值 0.8', '阈值 0.5');
  fs.writeFileSync(copy, tampered, 'utf8');
  const r2 = F.freezeSha(copy);
  assert.equal(r2.match, false, '篡改正文 ⇒ 复算 sha 与记录值不符');
  assert.notEqual(r2.sha256, r.sha256, '篡改后 sha 须变化');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('⑨ prereg-freeze 重构零行为变化：既有冻结件复算全部 MATCH（回归锁）', () => {
  const files = [
    ['PREREG-E2-路由分配-v1.md', '5c354501'],
    ['PREREG-E2-路由分配-v1.1-补充与勘误-20260917.md', 'e41aa45a'],
    ['PREREG-9臂解耦-v1.md', '072e8486'],
    // 厚格四件（v1.3＝2026-09-20 裁决补充：对 1=C／Granger 封存／P2 已测）
    ['PREREG-厚格基建总票-v1.md', 'e12c9db6'],
    ['PREREG-厚格基建总票-v1.1-补充与勘误-20260918.md', '8db2fff5'],
    ['PREREG-厚格基建总票-v1.2-补充-kNN预注册-20260918.md', '7d2015d2'],
    ['PREREG-厚格基建总票-v1.3-裁决补充-20260920.md', '49a381db'],
  ];
  for (const [name, prefix] of files) {
    const p = path.join(ROOT, 'docs', 'assets', 'forecast-debate', name);
    if (!fs.existsSync(p)) continue;
    const r = F.freezeSha(p);
    assert.equal(r.match, true, name + ' 须 MATCH');
    assert.equal(r.sha256.slice(0, 8), prefix, name + ' sha 前缀须保持 ' + prefix + '（重构前后逐字节相同）');
  }
  const a7 = path.join(ROOT, 'docs', 'specs', 'A7-经济副线-nowcast立项-brief-v1-20260916.md');
  if (fs.existsSync(a7)) assert.ok(F.freezeSha(a7).sha256.startsWith('96f28768'), 'A7 brief sha 前缀不变');
});

// ── ⑩ require 安全（零副作用） ──────────────────────────────────────────────
test('⑩ require 零副作用：三个新/改脚本 require 后不写盘、不退出', () => {
  const before = fs.readdirSync(path.join(ROOT, 'p1b', 'sim', 'out')).length;
  assert.equal(typeof R.deriveAnchor, 'function', 'runner 导出派生函数');
  assert.equal(typeof A.pairedStat, 'function', 'analyze 导出配对统计');
  assert.equal(typeof F.freezeSha, 'function', 'freeze 导出冻结复算');
  assert.ok(R.ARMS.length === 10, '臂表 10 条（9 臂＋重复臂）');
  assert.equal(R.ARMS.filter((x) => x.role === 'repeat').length, 1, '重复臂恰 1 条');
  assert.equal(R.ARMS.filter((x) => x.role !== 'repeat').length, 9, '本体 9 臂');
  const trip = {};
  for (const x of R.ARMS.filter((z) => z.role !== 'repeat')) trip[x.variant + '@' + x.temperature] = true;
  assert.equal(Object.keys(trip).length, 9, '★9 臂＝3 变体 × 3 温度 全交叉（无重复格、无缺格）');
  for (const v of ['v1_evidence', 'v2_skeptical', 'v3_baserate']) {
    for (const T of [0.2, 0.7, 1.0]) assert.ok(trip[v + '@' + T], '缺格: ' + v + '@' + T);
  }
  assert.equal(fs.readdirSync(path.join(ROOT, 'p1b', 'sim', 'out')).length, before, 'sim/out 文件数不变（require 不写盘）');
});

test('⑪ 零写库结构证据：runner/analyze 源码不含任何 SQL 写语句', () => {
  for (const p of [RUNNER, ANALYZE]) {
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(!/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|VIEW)|CREATE\s+(TABLE|VIEW))\b/i.test(src),
      path.basename(p) + ' 不得含 SQL 写语句（零账本写）');
  }
  assert.ok(/readOnly:\s*true/.test(fs.readFileSync(ANALYZE, 'utf8')) || /readOnly:\s*true/.test(fs.readFileSync(RUNNER, 'utf8')),
    '至少一处只读打开（readOnly）');
});
