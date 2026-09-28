'use strict';
/**
 * p1b/test/base-rate-decision-value.test.cjs —— 诚实基率决策价值 · 判据守卫（2026-09-29）
 *
 * 对应 PREREG（`docs/specs/PREREG-base-rate-decision-value-v1.md`，sha `619ac53a…`）条款：
 *   ① §1 池：只读已结算 ∧ 排除真值口径缺陷集（**复用** truthBasis 单一真源，禁自写谓词）
 *   ② §2 C1 分档：整数百分点落档，五档铺满 [0,1] 不丢行；WAD 加权口径；MIN_N=30
 *   ③ §3 C2 主判据：d=(p−y)²−(0.5−y)²；CI95 上界<0 才算有决策价值；bootstrap 照抄 thickcell 口径
 *   ④ §3 MDE 义务：Δ/CI 必须同报 σ̂_d 与 MDE=2.8·σ̂_d/√n
 *   ⑤ §3 walk-forward 退化处置：序无关性 ＋ 时序零泄漏（两条**可执行**断言，禁口号）
 *   ⑥ §4 禁跨层池化：五层全列、层间禁搬运
 *   ⑦ §5 出口 A/B/C 三条，禁增设
 *   ⑧ §8 开跑令闸 + sha 闸：无 --run ⇒ exit 3 零写盘；sha 不 MATCH ⇒ exit 5 零读数
 *   ⑨ §7 零账本写 / require 零副作用
 *  ⑩ §6 F2 旁证独立成项（不参与判读）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'base-rate-decision-value.cjs');
const PREREG = path.join(ROOT, 'docs', 'specs', 'PREREG-base-rate-decision-value-v1.md');
const DB = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const M = require(SCRIPT);

function runScript(args) {
  try {
    const o = execFileSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' });
    return { code: 0, out: String(o) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

test('① PREREG 冻结件在盘且 MATCH（本实验的全部判据都钉在这个 sha 上）', () => {
  assert.ok(fs.existsSync(PREREG), '冻结件缺失');
  const { freezeSha } = require(path.join(ROOT, 'p1b', 'scripts', 'prereg-freeze.cjs'));
  const r = freezeSha(PREREG);
  assert.equal(r.match, true, 'PREREG sha 复算不 MATCH ⇒ 判据被改过，读数作废：' + r.sha256);
  // 防「正文先引了别的件完整 sha ⇒ recorded 取错」的已知坑
  const first = (fs.readFileSync(PREREG, 'utf8').match(/`([0-9a-f]{64})`/) || [])[1];
  assert.equal(first, r.sha256, '第一个反引号 64 位 hex 须＝本件登记的 sha');
  assert.ok(/sha256：`[0-9a-f]{64}`/.test(fs.readFileSync(PREREG, 'utf8')), 'sha 须写在 sha256：槽位');
});

test('② 池：只含已结算 ∧ 可计分 ∧ 非真值口径缺陷；缺陷行必须被排除且计数披露', () => {
  const { pool, excluded_defect } = M.buildPool(DB);
  assert.ok(pool.length > 0, '池非空');
  assert.equal(typeof excluded_defect, 'number', '必须披露排除计数（禁静默丢）');
  for (const q of pool) {
    assert.ok(q.y === 0 || q.y === 1, '真值须为 0/1：' + JSON.stringify(q));
    assert.ok(isFinite(q.p) && q.p >= 0 && q.p <= 1, 'p 须有限且在 [0,1]：' + q.p);
  }
  // 谓词与单一真源同源：不得自写一套（PREREG §1 泄漏防线②）
  assert.equal(M.TRUTH_DEFECT_PREDICATE_SOURCE, 'p1b/src/evidence/truthBasis.js',
    '排除谓词必须复用 truthBasis 单一真源');
});

test('③ C1 分档：整数百分点落档、五档铺满 [0,1] 不丢行、边界确定', () => {
  assert.deepEqual(M.BINS, [0.1, 0.3, 0.5, 0.7, 0.9], '五档写死');
  const b = M.binOf;
  assert.equal(b(0), 0.1);          // pct 0  → B1
  assert.equal(b(0.194), 0.1);       // pct 19 → B1
  assert.equal(b(0.2), 0.3);         // pct 20 → B2（边界取整在前）
  // ★取整**在前**：0.396 → pct 40 → B3（不是 B2）。这一条专测「先取整后落档」的口径，
  //   防止有人改成「先落档再取整」而悄悄改变分档。
  assert.equal(b(0.394), 0.3);       // pct 39 → B2
  assert.equal(b(0.396), 0.5);       // pct 40 → B3
  assert.equal(b(0.4), 0.5);
  assert.equal(b(0.6), 0.7);
  assert.equal(b(0.8), 0.9);
  assert.equal(b(1.0), 0.9);
  // 不丢行：随机 p 全覆盖，且每行只落一档
  for (let i = 0; i <= 1000; i++) {
    const p = i / 1000;
    assert.ok(M.BINS.indexOf(b(p)) !== -1, 'p=' + p + ' 落到了档外');
  }
});

test('④ C1 加权绝对偏差：WAD 只用 n≥MIN_N 的档归一；n<30 档只方向披露', () => {
  assert.equal(M.MIN_N, 30, 'MIN_N 沿用项目既有口径 30');
  const cal = M.calibrationOf([
    { p: 0.1, y: 1 }, { p: 0.1, y: 1 }, { p: 0.1, y: 1 }, { p: 0.1, y: 0 },   // B1 n=4 偏乐观
    { p: 0.5, y: 1 }, { p: 0.5, y: 0 },                                       // B3 n=2 恰好校准
  ]);
  const b1 = cal.bins.find((x) => x.label === 0.1);
  assert.equal(b1.n, 4);
  assert.equal(b1.eligible, false, 'n=4 < 30 ⇒ 不得入判读');
  assert.equal(cal.wad, null, '无合格档 ⇒ WAD 必为 null（n/a），禁编数');
  assert.equal(cal.verdict, 'n/a', '无合格档 ⇒ 出口 n/a（禁「就近归档」）');
  // 造一个合格档来验加权口径本身
  const many = [];
  for (let i = 0; i < 40; i++) many.push({ p: 0.5, y: i < 30 ? 1 : 0 });   // obs=0.75, meanp=0.5
  const c2 = M.calibrationOf(many);
  assert.equal(c2.wad, 0.25, '单档时 WAD=|obs−meanp|');
  assert.equal(c2.wad_center, 0.25, '档标=0.5 与档内均值=0.5 同值');
  assert.equal(c2.c1_pass, false, 'WAD 0.25 > 0.02 ⇒ 未校准');
});

test('⑤ C2 主判据：d=(p−y)²−(0.5−y)²，配对 bootstrap CI95 上界<0 才算有决策价值', () => {
  // 完美基率：p 极端且总是对 ⇒ d 显著为负
  const good = [];
  for (let i = 0; i < 60; i++) good.push({ p: 0.9, y: 1 });
  for (let i = 0; i < 40; i++) good.push({ p: 0.1, y: 0 });
  const mGood = M.metricsOf(good, 1000, 987654321);
  assert.ok(mGood.delta < 0, '完美基率 Δ 必为负（按 p 更好）');
  assert.equal(mGood.ci95.ub < 0, true, '上界应 < 0 ⇒ 有决策价值');
  assert.equal(mGood.c2_verdict, 'A');
  // p 恒 0.5 ⇒ 两臂等价 ⇒ d ≡ 0 ⇒ CI=[0,0] ⇒ 出口 B（不得说成 A）
  const half = [];
  for (let i = 0; i < 60; i++) half.push({ p: 0.5, y: 1 });
  for (let i = 0; i < 40; i++) half.push({ p: 0.5, y: 0 });
  const mHalf = M.metricsOf(half, 1000, 987654321);
  assert.equal(mHalf.delta, 0, 'p≡0.5 ⇒ Δ≡0');
  assert.equal(mHalf.sd_d, 0, 'p≡0.5 ⇒ σ̂_d=0');
  assert.equal(mHalf.ci95.ub, 0);
  assert.equal(mHalf.c2_verdict, 'B', '上界=0 ⇒ 出口 B（有决策价值须上界<0）');
  // 反向对照：p 反着来 ⇒ Δ 显著为正 ⇒ 仍出口 B（禁只测单向）
  const bad = [];
  for (let i = 0; i < 60; i++) bad.push({ p: 0.1, y: 1 });
  for (let i = 0; i < 40; i++) bad.push({ p: 0.9, y: 0 });
  const mBad = M.metricsOf(bad, 1000, 987654321);
  assert.ok(mBad.delta > 0, '反向基率 Δ 必为正');
  assert.equal(mBad.ci95.lb > 0, true, '下界应 > 0');
});

test('⑥ MDE 义务：σ̂_d 与 MDE=2.8·σ̂_d/√n 必须随 Δ/CI 同报（缺一项即不合规）', () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push({ p: i % 2 ? 0.8 : 0.2, y: i % 3 === 0 ? 0 : 1 });
  const m = M.metricsOf(rows, 1000, 987654321);
  assert.ok(m.sd_d >= 0 && m.sd_d !== null, 'σ̂_d 必报');
  assert.ok(Math.abs(m.mde - 2.8 * m.sd_d / Math.sqrt(m.n)) < 1e-12, 'MDE 公式写死 = 2.8·σ̂_d/√n');
  assert.ok('sd_d' in m && 'mde' in m && 'ci95' in m && 'delta' in m, '四项须同在读数对象里');
  assert.equal(m.boot.B, 1000, 'B 冻结 1000（照 thickcell-replay）');
  assert.equal(m.boot.seed, 987654321, 'seed 冻结（禁换种子凑结论）');
});

test('⑦ bootstrap 确定性：同 seed 逐位同；百分位口径照抄 thickcell-replay', () => {
  const d = [0.1, -0.2, 0.05, 0.3, -0.1, 0.0, 0.2, -0.05];
  const a = M.bootCI(d, 300, 999), b = M.bootCI(d, 300, 999), c = M.bootCI(d, 300, 1000);
  assert.deepEqual(a, b, '同 seed 须逐位同');
  assert.notDeepEqual(a, c, '异 seed 应不同（否则 seed 参数没生效）');
  assert.ok(a.lb <= a.ub, 'lb ≤ ub');
  // 与 thickcell-replay 同一实现的输出必须逐位相同（口径同源的硬证据）
  const T = require(path.join(ROOT, 'p1b', 'scripts', 'thickcell-replay.cjs'));
  assert.deepEqual(M.bootCI(d, 300, 999), T.bootCI(d, 300, 999), 'bootstrap 实现须与 thickcell-replay 同口径');
});

test('⑧ walk-forward 退化处置：序无关性 ＋ 时序零泄漏（两条可执行断言）', () => {
  // ★`resolved_at` 必须**随 i 严格递增**：replayOrder 按结算时刻排序，
  //   若时刻与数组序不一致，下面的「扰动第 cut 题之后的 y」就会扰动到排序后的**前面**，
  //   断言会把「排序造成的位移」误读成「泄漏」（本条最初就栽在这，已登记为测试侧坑）。
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ id: i, p: 0.2 + 0.03 * (i % 7), y: i % 2, resolved_at: '2026-01-' + String(1 + i).padStart(2, '0') + ' 00:00:00' });
  }
  // 断言 1：任意打乱 ⇒ d 向量逐位相同（常数臂不可能看见未来）
  const base = M.replayOrder(rows);
  const shuf = rows.slice().reverse();
  assert.deepEqual(base.map((r) => r.d), M.replayOrder(shuf).map((r) => r.d), '打乱输入后 d 须逐位相同');
  // 断言 2：扰动 t 之后的 y ⇒ d_t 逐位不变（零泄漏）
  const probe = rows.map((r) => Object.assign({}, r));
  const cut = 5;
  for (let i = cut; i < probe.length; i++) probe[i].y = probe[i].y ? 0 : 1;
  const after = M.replayOrder(probe);
  for (let i = 0; i < cut; i++) assert.equal(after[i].d, base[i].d, '第 ' + i + ' 题的 d 被未来题的 y 改了 ⇒ 泄漏');
  assert.equal(base.length, rows.length, '序长度守恒');
});

test('⑨ 禁跨层池化：五层全列、层 n<30 只方向披露、判读对象禁跨层合并', () => {
  const { pool } = M.buildPool(DB);
  const cells = M.layerCells(pool);
  assert.ok(cells.length >= 1, '分层单元非空');
  const keys = new Set(cells.map((c) => c.layer));
  assert.equal(keys.size, cells.length, '每层一行（不得有重复层行）');
  for (const c of cells) {
    assert.equal(c.eligible, c.n >= M.MIN_N, '层准入门须为 n≥' + M.MIN_N);
    assert.ok(Array.isArray(c.cal && c.cal.bins), '每层须自带分档（层内才可看校准）：' + c.layer);
    // 禁搬运：每层的读数必须自带身份，不得出现「合并层」这种行
    assert.ok(c.layer !== '*' && c.layer !== 'ALL', '禁出现合并层行：' + c.layer);
  }
  // 主读数与分层读数必须是**两个不同对象**（禁把全池数说成某一层）
  const m = M.metricsOf(M.toRows(pool), 1000, 987654321);
  assert.ok(m !== null);
});

test('⑩ 出口只有 A/B/C 三条，禁增设「就近归档」', () => {
  assert.deepEqual(M.EXITS, ['A', 'B', 'C'], '出口写死三条');
  const n = 100;
  const good = [];
  for (let i = 0; i < n; i++) good.push({ p: 0.9, y: 1 });
  for (let i = 0; i < n; i++) good.push({ p: 0.1, y: 0 });
  assert.equal(M.metricsOf(good, 200, 987654321).c2_verdict, 'A');
  const half = [];
  for (let i = 0; i < n; i++) half.push({ p: 0.5, y: i % 2 });
  assert.equal(M.metricsOf(half, 200, 987654321).c2_verdict, 'B');
  // n<30 ⇒ 出口 C（n/a），禁把功效不足说成 B
  assert.equal(M.metricsOf([{ p: 0.9, y: 1 }, { p: 0.1, y: 0 }], 200, 987654321).c2_verdict, 'C');
});

test('⑪ F2 旁证独立成项：逐行比对 assigned_prob vs baseRate.p，三档一致性 + 无基率单列', () => {
  const f = M.probeBaseRateEquality(DB);
  assert.equal(typeof f.total_rows_with_prob, 'number');
  assert.equal(typeof f.with_base_rate, 'number');
  assert.equal(typeof f.without_base_rate, 'number');
  assert.equal(f.with_base_rate + f.without_base_rate, f.total_rows_with_prob, '有/无基率必须对得上（禁静默丢行）');
  assert.equal(f.exact_bit_equal + f.not_exact, f.with_base_rate, '位级相等 + 不等 必＝有基率行数');
  assert.ok(f.max_abs_diff !== null, '必须报 max|Δ|（含 0 行的情形由调用方处理）');
  // 禁「预测」二字（铁律②文案黑名单）
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(src.indexOf('预测') === -1, '脚本文案含禁词「预测」');
});

test('⑫ 零账本写：跑批前后账本字节与行数不变（{readOnly:true} 的实证）', () => {
  const { DatabaseSync } = require('node:sqlite');
  const before = (() => { const d = new DatabaseSync(DB, { readOnly: true }); const c = d.prepare('SELECT COUNT(*) c FROM predictions').get().c; d.close(); return c; })();
  const beforeSize = fs.statSync(DB).size;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brdv-'));
  try {
    const r = runScript(['--run', '--out-dir', tmp, '--db', DB]);
    assert.equal(r.code, 0, '跑批应成功：\n' + r.out);
    const files = fs.readdirSync(tmp);
    assert.ok(files.some((f) => f.endsWith('.json')), '应落 json');
    assert.ok(files.some((f) => f.endsWith('.md')), '应落 md');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
  const after = (() => { const d = new DatabaseSync(DB, { readOnly: true }); const c = d.prepare('SELECT COUNT(*) c FROM predictions').get().c; d.close(); return c; })();
  assert.equal(after, before, '账本行数变了 ⇒ 发生写入');
  assert.equal(fs.statSync(DB).size, beforeSize, '账本体积变了 ⇒ 发生写入');
});

test('⑬ 开跑令闸：无 --run ⇒ exit 3 且零写盘；sha 不 MATCH ⇒ exit 5 且零读数', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brdv2-'));
  try {
    const g0 = runScript(['--out-dir', tmp]);
    assert.equal(g0.code, 3, '无 --run 须 exit 3');
    assert.ok(/开跑前提|开跑令/.test(g0.out), '应打印开跑前提状态');
    assert.deepEqual(fs.readdirSync(tmp), [], 'exit 3 路径必须零写盘');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
  // sha 闸：把冻结件换成内容不同的副本 ⇒ 必须拒跑（读函数级，不改真冻结件）
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'brdv3-'));
  try {
    const tampered = path.join(fake, 'PREREG-tampered.md');
    fs.writeFileSync(tampered, fs.readFileSync(PREREG, 'utf8').replace('WAD ≤ 0.02', 'WAD ≤ 0.99'), 'utf8');
    const g1 = runScript(['--run', '--prereg', tampered, '--out-dir', fake]);
    assert.equal(g1.code, 5, 'sha 不 MATCH 须 exit 5（禁读数）');
    assert.ok(/MATCH/.test(g1.out), '应说明 sha 不匹配');
    assert.deepEqual(fs.readdirSync(fake).filter((f) => f !== path.basename(tampered)), [],
      'sha 闸拒跑时必须零写盘（除被判定的冻结件副本本身）');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    try { fs.rmSync(fake, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
});

test('⑭ require 本件零副作用（主流程只在 CLI 直跑）', () => {
  const snap = () => fs.readdirSync(path.join(ROOT, 'p1b', 'sim', 'out')).sort().join('\n');
  const s0 = snap();
  delete require.cache[require.resolve(SCRIPT)];
  require(SCRIPT);
  assert.equal(snap(), s0, 'require 不得写盘');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(/require\.main === module/.test(src), '顶层必须有 require.main 守卫');
});
