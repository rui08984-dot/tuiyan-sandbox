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

test('⑤ 开跑令闸：无 --arms ⇒ exit 3；未知臂 ⇒ exit 4；**已登记未实现**的真臂 ⇒ exit 4（禁静默）', () => {
  const run = (args) => { try { const o = execFileSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' }); return { code: 0, out: o }; } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; } };
  const g0 = run([]);
  assert.equal(g0.code, 3, '无 --arms 须 exit 3（零写盘）');
  assert.ok(/开跑前提状态|开跑令/.test(g0.out), '应打印开跑前提状态');
  const g1 = run(['--arms', 'no_such_arm_xyz']);
  assert.equal(g1.code, 4, '未知臂 ⇒ exit 4');
  // ★本测试用 `mos`：它**已登记但实现为 null**（knn 已于 v1.2 后实现 ⇒ 不再适用于本条断言）
  const g2 = run(['--arms', 'mos']);
  assert.equal(g2.code, 4, '已登记未实现的真臂 ⇒ exit 4（禁把「未实现」静默成「跑了没差异」）');
  assert.ok(/尚未实现/.test(g2.out), '应说明未实现');
  assert.ok(/前置不足|2\.8%/.test(g2.out), 'MOS 的备注应带上「前提不足」的依据');
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
  // 跑一次（读库只读）并断言关键读数：池=630；forecast 覆盖极低；Granger 的序列 ID 覆盖低
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-feat-'));
  try {
    const jp = path.join(tmp, 'f.json');
    // ★2026-09-22 修：必须同时传 --md（否则脚本写默认路径 = 仓库产物，跑测试就覆写）
    execFileSync(process.execPath, [path.join(ROOT, 'p1b', 'scripts', 'thickcell-features.cjs'), '--json', jp, '--md', path.join(tmp, 'f.md')], { encoding: 'utf8' });
    const j = JSON.parse(fs.readFileSync(jp, 'utf8'));
    // ★ 数据标记（随账本增长更新）：PREREG v1.2 冻结时点（09-18）池=607；
    //   09-19（二十六）批结算 ⇒ L3 openmeteo 三 kind 新解 23 条（wind 8/sunshine 8/precip 7）⇒ 607 → 630
    //   （walk-forward 时间前进，非口径变更；kraken 等非厚格注册域不入池）；
    //   09-20（二十八）批结算 ⇒ L3 openmeteo 再解 23 条（同三 kind）⇒ 630 → 653（ghcn 8 条不入厚格域）
    assert.equal(j.pool_n, 653, '池应为 653（冻结时点 607 ＋ 09-19/20 批前进 23+23，见上注）: ' + j.pool_n);
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

test('⑨ kNN 臂（预注册参数）：只在四对内取参照类、零泄漏、κ 是活参数', () => {
  // 冻结常量（预注册；改动＝版本递进）
  assert.equal(M.KNN_K, 30, 'k 冻结 = 30');
  assert.equal(M.KNN_KAPPA, 2.903, '主口径 κ 冻结 = 2.903');
  assert.equal(Object.keys(M.PAIR_KINDS).length, 4, '同变量对应为 4 对');
  assert.equal(M.KNN_SENS_KAPPA.length, 4, '敏感性 κ 应 4 档');
  // 参照类限定：只有四对内的 kind 有 fam；别的 kind 一律 null（11 号件①：跨物理过程禁入）
  assert.equal(M.KIND2PAIR['openmeteo_daily_max'], 'OPEN_daily_max');
  assert.equal(M.KIND2PAIR['openmeteo_air_pm2_5_daily_mean'], undefined, '空气类不得入参照类');
  assert.equal(M.KIND2PAIR['dbnomics_series_value'], undefined, 'dbnomics 族不得入参照类');

  // 零泄漏：臂只看 ctx.history（resolved_at < t）。用合成历史验证「改未来题不影响过去题的读数」
  const mkRows = (extra) => [
    { id: 1, layer: 'L3', domain: 'openmeteo', y: 1, base: 0.5, resolved_at: '2026-09-01 00:00:00', fam: 'OPEN_daily_wind_speed_10m_max', lat: 1, lon: 2, month: 5 },
    { id: 2, layer: 'L3', domain: 'openmeteo', y: 0, base: 0.5, resolved_at: '2026-09-02 00:00:00', fam: 'OPEN_daily_wind_speed_10m_max', lat: 1, lon: 2, month: 6 },
    { id: 3, layer: 'L3', domain: 'openmeteo', y: (extra ? 1 : 0), base: 0.5, resolved_at: '2026-09-03 00:00:00', fam: 'OPEN_daily_wind_speed_10m_max', lat: 1, lon: 2, month: 7 },
    { id: 4, layer: 'L3', domain: 'openmeteo', y: 1, base: 0.5, resolved_at: '2026-09-04 00:00:00', fam: 'OPEN_daily_wind_speed_10m_max', lat: 1, lon: 2, month: 8 },
  ];
  const a = M.replayCell(mkRows(false), M.DECLARED_ARMS.knn.impl);
  const b = M.replayCell(mkRows(true), M.DECLARED_ARMS.knn.impl);
  // 题 1/2/3 的历史里不含题 3（它是自己的历史之外）——把题 3 的 y 改掉只应影响题 4
  assert.equal(a[0].p, b[0].p, '题 1 读数不受后续题影响');
  assert.equal(a[1].p, b[1].p, '题 2 读数不受后续题影响');
  assert.equal(a[2].p, b[2].p, '题 3 读数不受后续题影响');
  assert.notEqual(a[3].p, b[3].p, '题 4 应看到题 3 的结局（否则臂没在用历史）');

  // κ 是活参数：κ→∞ ⇒ w→0 ⇒ 臂退化为静态格基率
  const degenerate = M.replayCellWithKappa(mkRows(false), 1e12);
  for (let i = 1; i < degenerate.length; i++) {
    assert.ok(Math.abs(degenerate[i].p - mkRows(false)[i].base) < 1e-6, 'κ→∞ 应退化为格基率');
  }
  // 不同 κ ⇒ 读数不同（证明敏感性分析动的是同一个臂）
  const k1 = M.replayCellWithKappa(mkRows(false), 1.0);
  const k2 = M.replayCellWithKappa(mkRows(false), 6.0);
  assert.notDeepEqual(k1.map((r) => r.p), k2.map((r) => r.p), 'κ 变了读数须变');
});

test('⑩ kNN 臂：无历史时退静态格基率（不猜）；四维缺一者不入池', () => {
  const rows = [{ id: 1, layer: 'L3', domain: 'openmeteo', y: 1, base: 0.37, resolved_at: '2026-09-01 00:00:00', fam: 'OPEN_daily_max', lat: 1, lon: 2, month: 5 }];
  const out = M.replayCell(rows, M.DECLARED_ARMS.knn.impl);
  assert.equal(out[0].p, 0.37, '首题无历史 ⇒ 应原样返回格基率（不猜）');
  // 缺维（fam 为空 / lat 缺失）⇒ knnPool 不得收
  const { pool } = M.buildPool(path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
  const feat = M.attachFeatures(pool, path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
  const kp = M.knnPool(feat);
  for (const q of kp.rows) {
    assert.ok(q.fam && q.lat !== null && q.lon !== null && q.month !== null, '入池者四维须齐：' + JSON.stringify(q));
    assert.ok(M.PAIR_KINDS[q.fam], '入池者须属四对之一：' + q.fam);
  }
  // ★已知口径事实（防回归：这半边的缺席是**池过滤器**造成的，不是臂的 bug）
  //   ① 该 kind 在**账本**里确实存在（直接查库，不经 buildPool——它已被池过滤器排除）
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'), { readOnly: true });
  const n = db.prepare("SELECT COUNT(*) c FROM predictions WHERE outcome IS NOT NULL AND evidence_json LIKE ?").get('%"kind":"openmeteo_forecast_daily_max"%').c;
  db.close();
  assert.ok(n > 0, '该 kind 在账本里存在（实测 98）');
  //   ② 它有 fam 映射（属对 1），但**一条都不在可用池**（真值口径缺陷集被池过滤器排除）
  assert.equal(M.KIND2PAIR['openmeteo_forecast_daily_max'], 'OPEN_daily_max', '它名义上属对 1');
  assert.equal(feat.filter((q) => q.kind === 'openmeteo_forecast_daily_max').length, 0, '但它**全部**不在池（buildPool 要求引擎读数，缺陷集无读数）');
});

test('⑧ PREREG v1／v1.1／v1.2 三件冻结自检：各自 MATCH=true，且上游件未被改动', () => {
  const { freezeSha } = require(path.join(ROOT, 'p1b', 'scripts', 'prereg-freeze.cjs'));
  const v1 = path.join(ROOT, 'docs', 'assets', 'forecast-debate', 'PREREG-厚格基建总票-v1.md');
  const v11 = path.join(ROOT, 'docs', 'assets', 'forecast-debate', 'PREREG-厚格基建总票-v1.1-补充与勘误-20260918.md');
  const v12 = path.join(ROOT, 'docs', 'assets', 'forecast-debate', 'PREREG-厚格基建总票-v1.2-补充-kNN预注册-20260918.md');
  assert.ok(fs.existsSync(v1) && fs.existsSync(v11) && fs.existsSync(v12), '三件须都在盘');
  assert.equal(freezeSha(v1).match, true, 'v1 原件须仍 MATCH（版本递进＝原件一字不动）');
  assert.equal(freezeSha(v11).match, true, 'v1.1 须 MATCH');
  assert.equal(freezeSha(v12).match, true, 'v1.2 须 MATCH');
  const shas = new Set([freezeSha(v1).sha256, freezeSha(v11).sha256, freezeSha(v12).sha256]);
  assert.equal(shas.size, 3, '三件 sha 必互不相同');
  // ★防回归（已登记的坑）：冻结工具的 `recorded` 取的是**文件里第一个**被反引号包的 64 位 hex
  //   ⇒ 若正文先引了别的件的完整 sha，recorded 就会取错 ⇒ **引用一律截断**。
  //   精确不变量＝「第一个反引号 64 位 hex 必须就是本件自己的登记值」，且写在 `sha256：` 槽位。
  for (const [p, name] of [[v11, 'v1.1'], [v12, 'v1.2']]) {
    const t = fs.readFileSync(p, 'utf8');
    const first = (t.match(/`([0-9a-f]{64})`/) || [])[1];
    assert.equal(first, freezeSha(p).sha256, name + '：第一个反引号 64 位 hex 须＝本件登记的 sha');
    assert.ok(/sha256：`[0-9a-f]{64}`/.test(t), name + '：sha 须写在 sha256：槽位');
  }
});

test('⑧ ★回归锁：测试调用脚本必须同时传 --json 与 --md（防写仓库产物）', () => {
  // 背景（2026-09-22 实测）：thickcell-features.cjs 的 .md 用 arg('md', 默认路径)，
  //   测试只传了 --json ⇒ 每次跑测试都写 p1b/sim/out/thickcell-features-<今日>.md（仓库产物被覆写）。
  //   本锁断言：测试源码里调该脚本的 execFileSync 必须同时含 --json 与 --md。
  const src = fs.readFileSync(__filename, 'utf8');
  // ★只取「真正执行」的行（以 execFileSync( 开头）——否则会匹配到本测试自身的源码串
  const lines = src.split('\n').filter((l) => /^\s*execFileSync\(/.test(l));
  const calls = lines.filter((l) => l.indexOf('thickcell-features') >= 0);
  assert.ok(calls.length > 0, '应存在对 thickcell-features 的调用');
  for (const c of calls) {
    assert.ok(/--json/.test(c), '调用须传 --json: ' + c.slice(0, 80));
    assert.ok(/--md/.test(c), '★调用须同时传 --md（否则写默认路径 = 仓库产物）: ' + c.slice(0, 80));
  }
});
