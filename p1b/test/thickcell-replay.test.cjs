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

test('⑦ 特征可得性审计：四臂判定与「账本根本不存在」的字段分开列（防 0% 被读成「罕见」）', () => {
  const F = require(path.join(ROOT, 'p1b', 'scripts', 'thickcell-features.cjs'));
  assert.ok(Array.isArray(F.FEATURES) && F.FEATURES.length >= 8, '特征表非空');
  assert.ok(Array.isArray(F.ARM_PREREQ) && F.ARM_PREREQ.length === 4, '四臂前置表应为 4 条');
  for (const a of F.ARM_PREREQ) {
    assert.ok(a.arm && a.features.length > 0, '每臂须列约束特征：' + JSON.stringify(a));
    for (const k of a.features) {
      assert.ok(F.FEATURES.some((f) => f.key === k), '约束特征须在特征表内：' + k);
    }
  }
  // 跑一次（读库只读）并断言关键读数：池=607；forecast 覆盖极低；Granger 的序列 ID 覆盖低
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-feat-'));
  try {
    const jp = path.join(tmp, 'f.json');
    execFileSync(process.execPath, [path.join(ROOT, 'p1b', 'scripts', 'thickcell-features.cjs'), '--json', jp], { encoding: 'utf8' });
    const j = JSON.parse(fs.readFileSync(jp, 'utf8'));
    assert.equal(j.pool_n, 607, '池应为 607（与 PREREG §1 冻结时记录一致）');
    assert.ok(j.features.forecastVal.pct < 0.10, 'MOS 的已发布高频观测覆盖应 <10%（实测 2.8%）');
    assert.ok(j.features.seriesID.pct < 0.10, 'Granger 的序列 ID 覆盖应 <10%（实测 7.6%）');
    assert.ok(j.features.baseRate_nk.pct > 0.80, 'kNN 的 baseRate n/k 覆盖应 >80%（实测 83.4%）');
    assert.ok(Array.isArray(j.absent) && j.absent.length >= 1, '须单列「账本根本不存在」的字段');
    assert.ok(j.absent.some((x) => /序列/.test(x.label)), '须含「序列的历史值」缺失项');
    // 四臂判定：knn/nowcast 可行；mos/granger 前提不足
    const byArm = {}; for (const a of j.arms) byArm[a.arm] = a.verdict;
    assert.equal(byArm.knn, 'feasible');
    assert.equal(byArm.nowcast, 'feasible');
    assert.notEqual(byArm.mos, 'feasible', 'MOS 不应判 feasible（forecast 覆盖 2.8%）');
    assert.notEqual(byArm.granger_lag, 'feasible', 'Granger 不应判 feasible（序列未入库）');
    assert.ok(/不是判据/.test(j.gate_note), '门槛须声明「非判据」');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
});

test('⑧ PREREG v1.1 勘误件：冻结自检 MATCH=true，且**v1 原件未被改动**', () => {
  const { freezeSha } = require(path.join(ROOT, 'p1b', 'scripts', 'prereg-freeze.cjs'));
  const v1 = path.join(ROOT, '.scratch', 'forecast-debate', 'PREREG-厚格基建总票-v1.md');
  const v11 = path.join(ROOT, '.scratch', 'forecast-debate', 'PREREG-厚格基建总票-v1.1-补充与勘误-20260918.md');
  assert.ok(fs.existsSync(v1) && fs.existsSync(v11), '两件须都在盘');
  assert.equal(freezeSha(v1).match, true, 'v1 原件须仍 MATCH（版本递进＝原件一字不动）');
  assert.equal(freezeSha(v11).match, true, 'v1.1 须 MATCH');
  assert.notEqual(freezeSha(v1).sha256, freezeSha(v11).sha256, 'v1.1 是新件，sha 必不同');
  // ★防回归（已登记的坑）：冻结工具的 `recorded` 取的是**文件里第一个**被反引号包的 64 位 hex
  //   ⇒ 若正文先引了别的件的完整 sha，recorded 就会取错 ⇒ **引用一律截断**。
  //   精确不变量＝「第一个反引号 64 位 hex 必须就是本件自己的登记值」。
  const t = fs.readFileSync(v11, 'utf8');
  const first = (t.match(/`([0-9a-f]{64})`/) || [])[1];
  assert.equal(first, freezeSha(v11).sha256, '第一个反引号 64 位 hex 须＝本件登记的 sha（否则是引了别件的完整 sha ⇒ recorded 取错）');
  // 且它必须处于 `sha256：` 槽位（登记块内）
  assert.ok(/sha256：`[0-9a-f]{64}`/.test(t), 'sha 须写在 sha256：槽位');
});
