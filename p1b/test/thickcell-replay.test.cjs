'use strict';
/**
 * p1b/test/thickcell-replay.test.cjs —— 厚格基建共享骨架守卫（2026-09-18 · 第 3 期票 B 实现件）
 *
 * 不变量（对应 PREREG v1 条款）：
 *   ① 池**按规则派生**（§1）：域 ∈ {openmeteo, dbnomics} ∧ 层 ∈ {L2,L3} ∧ 已解 ∧ 可计分；单元＝格；准入门 n≥30
 *   ② walk-forward **零泄漏**（§2）：题 t 的 history 恰＝`resolved_at < t` 的题数；**同刻批量零信息流**
 *   ③ 判据机（§3/§6）：identity 金样 ⇒ Δ≡0 & σ̂_d=0 & CI=[0,0]；const_half 对照组 ⇒ Δ≠0（**防金样恒真**）
 *   ④ bootstrap **确定性**（同 seed ⇒ 逐位同）
 *   ⑤ **开跑令闸**（§10）：无 `--arms` ⇒ exit 3；未知臂 ⇒ exit 4；**已登记但未实现**的真臂 ⇒ exit 4（禁静默）
 *   ⑥ require 零副作用
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'thickcell-replay.cjs');
const M = require(SCRIPT);

test('① 池按规则派生：只含许可域/层、已解、可计分；单元＝格且准入门 n≥30', () => {
  const { pool, cells } = M.buildPool(path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
  assert.ok(pool.length > 0, '池非空');
  for (const q of pool) {
    assert.ok(M.LAYERS.indexOf(q.layer) !== -1, '层须在 ' + JSON.stringify(M.LAYERS) + '：' + q.layer);
    assert.ok(M.DOMAINS.indexOf(q.domain) !== -1, '域须在 ' + JSON.stringify(M.DOMAINS) + '：' + q.domain);
    assert.ok(q.y === 0 || q.y === 1, '已解真值须为 0/1：' + q.y);
    assert.ok(isFinite(q.base) && q.base >= 0 && q.base <= 1, '基线读数须有限且在 [0,1]：' + q.base);
  }
  for (const c of cells) assert.equal(c.eligible, c.n >= M.MIN_N, '准入门须为 n≥' + M.MIN_N);
  // 格集合＝池的 (layer,domain) 划分（不重不漏）
  assert.equal(cells.reduce((a, c) => a + c.n, 0), pool.length, '格计数之和＝池大小');
});

test('② walk-forward 零泄漏＋同刻零信息流＋确定性', () => {
  // 合成池：**含同刻题**（resolved_at 相同）以专测「同刻互不可见」
  const rows = [
    { id: 1, layer: 'L3', domain: 'openmeteo', y: 1, base: 0.5, resolved_at: '2026-01-01 00:00:00' },
    { id: 2, layer: 'L3', domain: 'openmeteo', y: 0, base: 0.5, resolved_at: '2026-01-01 00:00:00' },   // 同刻
    { id: 3, layer: 'L3', domain: 'openmeteo', y: 1, base: 0.5, resolved_at: '2026-01-02 00:00:00' },
    { id: 4, layer: 'L3', domain: 'openmeteo', y: 0, base: 0.5, resolved_at: '2026-01-03 00:00:00' },
  ];
  let seen = null;
  const spy = (ctx) => { if (seen === null) seen = ctx.history.map((h) => h.id); return 0.5; };
  const out = M.replayCell(rows, spy);
  assert.deepEqual(seen, [], '首题 history 必为空');
  // 逐题 history 长度须恰＝严格早于其 resolved_at 的题数
  for (const r of out) {
    const q = rows.find((x) => x.id === r.id);
    const want = rows.filter((x) => x.resolved_at < q.resolved_at).length;
    assert.equal(r.hist_n, want, 'id=' + r.id + ' history 应为 ' + want + '（同刻不入）');
  }
  // 同刻题（id=2）不得看到 id=1
  const seenAt = {};
  const spy2 = (ctx, q) => { seenAt[q.id] = ctx.history.map((h) => h.id); return 0.5; };
  M.replayCell(rows, spy2);
  assert.deepEqual(seenAt[1], [], 'id=1 首题无历史');
  assert.deepEqual(seenAt[2], [], 'id=2 与 id=1 **同刻** ⇒ 不得看见 id=1');
  assert.deepEqual(seenAt[3], [1, 2], 'id=3 应看见 id=1,2');
});

test('③ 判据机：identity 金样 Δ≡0／σ̂_d=0／CI=[0,0]；const_half 对照组**非零**（防恒真）', () => {
  const rows = [
    { id: 1, layer: 'L3', domain: 'openmeteo', y: 1, base: 0.8, resolved_at: '2026-01-01 00:00:00' },
    { id: 2, layer: 'L3', domain: 'openmeteo', y: 0, base: 0.6, resolved_at: '2026-01-02 00:00:00' },
    { id: 3, layer: 'L3', domain: 'openmeteo', y: 1, base: 0.7, resolved_at: '2026-01-03 00:00:00' },
    { id: 4, layer: 'L3', domain: 'openmeteo', y: 1, base: 0.9, resolved_at: '2026-01-04 00:00:00' },
  ];
  const idm = M.metricsOf(M.replayCell(rows, M.SELFTEST_ARMS.identity.impl), 200, 12345);
  assert.equal(idm.delta, 0, '金样 Δ 必为 0');
  assert.equal(idm.sd_d, 0, '金样 σ̂_d 必为 0');
  assert.equal(idm.ci95.lb, 0);
  assert.equal(idm.ci95.ub, 0);
  const cm = M.metricsOf(M.replayCell(rows, M.SELFTEST_ARMS.const_half.impl), 200, 12345);
  assert.ok(Math.abs(cm.delta) > 1e-9, '对照组 Δ 必非零（否则机器对差异盲）');
  assert.ok(cm.sd_d > 0, '对照组 σ̂_d 必 > 0');
});

test('④ bootstrap 确定性：同 seed ⇒ 逐位同；不同 seed 允许不同', () => {
  const d = [0.1, -0.2, 0.05, 0.3, -0.1, 0.0, 0.2, -0.05];
  const a = M.bootCI(d, 300, 999), b = M.bootCI(d, 300, 999), c = M.bootCI(d, 300, 1000);
  assert.deepEqual(a, b, '同 seed 须逐位同');
  assert.notDeepEqual(a, c, '异 seed 应不同（否则参数没生效）');
  assert.ok(a.lb <= a.ub, 'CI 下界 ≤ 上界');
});

test('⑤ 开跑令闸：无 --arms ⇒ exit 3；未知臂 ⇒ exit 4；已登记未实现的真臂 ⇒ exit 4（禁静默）', () => {
  const run = (args) => { try { const o = execFileSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' }); return { code: 0, out: o }; } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; } };
  const g0 = run([]);
  assert.equal(g0.code, 3, '无 --arms 须 exit 3（零写盘）');
  assert.ok(/开跑前提状态|开跑令/.test(g0.out), '应打印开跑前提状态');
  assert.ok(/未实现/.test(g0.out), '应如实报真臂未实现');
  const g1 = run(['--arms', 'no_such_arm_xyz']);
  assert.equal(g1.code, 4, '未知臂 ⇒ exit 4');
  const g2 = run(['--arms', 'knn']);            // 已在 PREREG §4 登记但未实现
  assert.equal(g2.code, 4, '已登记未实现的真臂 ⇒ exit 4（禁把「未实现」静默成「跑了没差异」）');
  assert.ok(/尚未实现/.test(g2.out), '应说明未实现');
});

test('⑥ require 本件零副作用（主流程只在 CLI 直跑）', () => {
  const snap = () => fs.readdirSync(path.join(ROOT, 'p1b', 'sim', 'out')).sort().join('\n');
  const s0 = snap();
  delete require.cache[require.resolve(SCRIPT)];
  require(SCRIPT);
  assert.equal(snap(), s0, 'require 不得写盘');
});
