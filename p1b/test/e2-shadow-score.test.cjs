'use strict';
/**
 * p1b/test/e2-shadow-score.test.cjs —— E2 影子评分 v2（六臂＋判据机）测试（2026-09-17）
 *
 * ① 纯函数：bootDeltaCI 确定性／已知回收；stratDeltaCI 点估计恒等（≡全样本均值）
 * ② R3a：薄格默认回 R0／argmin 真回收／tie-break 取 design §1.2 序／**无泄漏**（未来结局不改当刻选择）／sleeping 回退
 * ③ R3h Hedge：**两步手算权重回收**／sleeping 者不吃损失／**延迟结算＝同刻零信息流**／η 方向性（η=0 ⇒ 恒等均匀）
 * ④ R4：单 seed 确定性／只取本题可估引擎
 * ⑤ runArms：★M5⑤ 零选择权（降档题仍以 R0 口径进配对）／R1≡R0（改层 0）／R2 不回退 R0
 * ⑥ TOST 恒等（TOST p<0.05 ⇔ 90% CI ⊂ ±ε）／Holm 已知例
 * ⑦ ★开跑令闸：无 --arms ⇒ exit 3 零写盘；--arms 于**合成迷你库** ⇒ 三件产物 ＋ 迷你库零改动（端到端接线）
 * ⑧ require 零副作用
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'e2-shadow-score.cjs');
const COMBO = path.join(ROOT, 'p1b', 'scripts', 'e2-combo-precheck.cjs');
const R1SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'e2-r1-rules.cjs');
const PROD = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const SIMOUT = path.join(ROOT, 'p1b', 'sim', 'out');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-shadow-'));
test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const M = require(SCRIPT);
const combo = require(COMBO);
const r1mod = require(R1SCRIPT);

/** 合成臂输入（纯函数用）：{id, resolved_at, eng, y, domain, layer} ⇒ 补 keys。 */
const mk = (id, t, eng, y, domain, layer) => ({ id: id, resolved_at: t, eng: eng, keys: Object.keys(eng), y: y, domain: domain || 'd1', layer: layer || 'L2' });

// ── ① 纯函数 ────────────────────────────────────────────────────────────────
test('① bootDeltaCI：常数差 ⇒ 退化区间；同种子两次逐位同；换种子换流', () => {
  const c = M.bootDeltaCI(Array(50).fill(0.25), 200, 987654321);
  assert.ok(Math.abs(c.mean - 0.25) < 1e-12);
  assert.ok(Math.abs(c.lb - 0.25) < 1e-12 && Math.abs(c.ub - 0.25) < 1e-12, '常数差 ⇒ CI 退化到点');
  const a = M.bootDeltaCI([0.1, -0.2, 0.3, 0.05], 200, 7), b = M.bootDeltaCI([0.1, -0.2, 0.3, 0.05], 200, 7);
  assert.deepEqual(a, b, '同种子须逐位同（确定性）');
  const d = M.bootDeltaCI([0.1, -0.2, 0.3, 0.05], 200, 8);
  assert.notDeepEqual([a.lb, a.ub], [d.lb, d.ub], '换种子应换流（否则种子无意义）');
});

test('① stratDeltaCI：点估计 ≡ 全样本均值（恒等自检≈0）＋确定性', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ d: (i % 3 === 0 ? 0.2 : -0.1), cell: 'L2/d' + (i % 2) });
  const s = M.stratDeltaCI(rows, 200, 987654321);
  const raw = rows.reduce((a, r) => a + r.d, 0) / rows.length;
  assert.ok(Math.abs(s.delta - raw) < 1e-12, '分层点估计须恒等于总体均值');
  assert.ok(s.identity_residual < 1e-12, '恒等残差应≈0');
  assert.equal(s.cells, 2);
  assert.deepEqual(s, M.stratDeltaCI(rows, 200, 987654321), '确定性');
});

// ── ② R3a ──────────────────────────────────────────────────────────────────
test('② R3a：薄格（n<10）⇒ 全默认回 R0；argmin 真回收；tie-break 取 design 序', () => {
  // 薄格：5 题同域，历史永远 <10 ⇒ 无一 argmin
  const thin = [1, 2, 3, 4, 5].map((i) => mk(i, '2026-01-0' + i, { LA: 1, LB: 0 }, 1));
  const t = M.r3aRun(thin, { minCell: 10 });
  assert.equal(t.counts.argmin, 0, '薄格不得 argmin');
  assert.equal(t.counts.default_r0_thin, 5);
  assert.ok(thin.every((q) => t.choices[q.id].pick === null), '薄格 ⇒ pick=null（默认回 R0）');
  // argmin 回收：minCell=2；前两题揭示 LA 好、LB 差 ⇒ 第三题应选 LA（引擎集须显式传入＝本件可配置项）
  const seq = [
    mk(1, '2026-01-01', { LA: 1, LB: 0 }, 1),
    mk(2, '2026-01-02', { LA: 1, LB: 0 }, 1),
    mk(3, '2026-01-03', { LA: 1, LB: 0 }, 1),
  ];
  const r = M.r3aRun(seq, { minCell: 2, engines: ['LA', 'LB'] });
  assert.equal(r.choices[3].pick, 'LA', 'LA 历史 Brier 更低 ⇒ 应选中 LA');
  assert.equal(r.counts.argmin, 1, '仅第 3 题达到格历史阈值');
  // tie-break：历史均值并列 ⇒ 取 design §1.2 序（L3 先于 L2）；需 ≥3 题（前 2 题构成格历史 n=2）
  const tie = [mk(1, '2026-01-01', { L2: 0.5, L3: 0.5 }, 1), mk(2, '2026-01-02', { L2: 0.5, L3: 0.5 }, 1), mk(3, '2026-01-03', { L2: 0.5, L3: 0.5 }, 1)];
  const rt = M.r3aRun(tie, { minCell: 2 });
  assert.equal(rt.choices[3].pick, 'L3', '并列时按 L5>L6>L1>L3>L2 取 L3');
});

test('②★ R3a 无泄漏：未来题的结局不改当刻选择（walk-forward）', () => {
  const A = [mk(1, '2026-01-01', { LA: 1, LB: 0 }, 1), mk(2, '2026-01-02', { LA: 1, LB: 0 }, 1), mk(3, '2026-01-03', { LA: 1, LB: 0 }, 1)];
  const B = [mk(1, '2026-01-01', { LA: 1, LB: 0 }, 1), mk(2, '2026-01-02', { LA: 1, LB: 0 }, 1), mk(3, '2026-01-03', { LA: 0, LB: 1 }, 0)];
  const opt = { minCell: 2, engines: ['LA', 'LB'] };
  const ra = M.r3aRun(A, opt), rb = M.r3aRun(B, opt);
  for (const id of [1, 2, 3]) assert.deepEqual(ra.choices[id], rb.choices[id], 'id=' + id + '：第 3 题结局不得影响任何当刻选择');
  // 选中引擎在本题不可用 ⇒ 回 R0（sleeping 回退计数）
  const C = [mk(1, '2026-01-01', { LA: 1, LB: 0 }, 1), mk(2, '2026-01-02', { LA: 1, LB: 0 }, 1), mk(3, '2026-01-03', { LB: 0 }, 0)];
  const rc = M.r3aRun(C, opt);
  assert.equal(rc.choices[3].pick, null, 'LA 不可用 ⇒ 回 R0');
  assert.equal(rc.counts.sleeping_fallback, 1);
});

// ── ③ R3h Hedge ────────────────────────────────────────────────────────────
test('③ R3h：两步手算权重回收（sleeping experts＋延迟结算）', () => {
  const seq = [
    mk(1, '2026-01-01', { A: 0.9, B: 0.2 }, 1),
    mk(2, '2026-01-02', { A: 0.9, B: 0.2 }, 1),
  ];
  const h = M.hedgeRun(seq, { eta: 1, engines: ['A', 'B'] });
  assert.ok(Math.abs(h.preds[1] - 0.55) < 1e-12, '首题＝均匀混合 0.55');
  // 结算后：w ∝ exp(−0.01) 与 exp(−0.64)，归一化
  const wa = Math.exp(-0.01) / (Math.exp(-0.01) + Math.exp(-0.64));
  const wb = Math.exp(-0.64) / (Math.exp(-0.01) + Math.exp(-0.64));
  assert.ok(Math.abs(h.weights_final.A - wa) < 1e-12, '手算 wA=' + wa);
  assert.ok(Math.abs(h.weights_final.B - wb) < 1e-12, '手算 wB=' + wb);
  assert.ok(Math.abs(h.preds[2] - (wa * 0.9 + wb * 0.2)) < 1e-12, '第二题用更新后权重');
  assert.equal(h.traj.length, 2, '权重轨迹逐题一条');
  assert.deepEqual(h.traj[0].awake, ['A', 'B']);
});

test('③★ R3h 延迟结算：同刻题零信息流；sleeping 者不吃损失', () => {
  const same = [
    mk(1, '2026-01-01', { A: 0.9, B: 0.2 }, 1),
    mk(2, '2026-01-01', { A: 0.9, B: 0.2 }, 1),   // 同刻 ⇒ 不得看到题 1 的结局
  ];
  const hSame = M.hedgeRun(same, { eta: 1, engines: ['A', 'B'] });
  assert.ok(Math.abs(hSame.preds[2] - 0.55) < 1e-12, '同刻 ⇒ 仍用均匀权重（零信息流）');
  const later = [
    mk(1, '2026-01-01', { A: 0.9, B: 0.2 }, 1),
    mk(2, '2026-01-02', { A: 0.9, B: 0.2 }, 1),   // 次刻 ⇒ 应看到题 1 的结局
  ];
  const hLater = M.hedgeRun(later, { eta: 1, engines: ['A', 'B'] });
  assert.ok(hLater.preds[2] > 0.55 && hLater.preds[2] < 0.9, '次刻 ⇒ 权重已更新（向 A 的 0.9 靠近）：实测 ' + hLater.preds[2].toFixed(10));
  assert.notEqual(hSame.preds[2], hLater.preds[2], '结算时点必须产生差别（否则队列无效）');
  // sleeping：A 单独出题吃损失 ⇒ 事后 A 权重被压（B 未参与不吃损失）
  const sl = [mk(1, '2026-01-01', { A: 0.9 }, 1), mk(2, '2026-01-02', { A: 0.9, B: 0.1 }, 0)];
  const hs = M.hedgeRun(sl, { eta: 1, engines: ['A', 'B'] });
  const wa2 = Math.exp(-0.01) / (Math.exp(-0.01) + 1);
  assert.ok(Math.abs(hs.weights_final.A - wa2) < 1e-12, 'sleeping 者不更新 ⇒ wA=' + wa2);
  assert.ok(Math.abs(hs.preds[2] - (wa2 * 0.9 + (1 - wa2) * 0.1)) < 1e-12, '混合用双方权重');
});

test('③ R3h：η=0 ⇒ 恒等均匀（不学习）；η 越大越向优者集中（方向性）', () => {
  const seq = [1, 2, 3, 4, 5].map((i) => mk(i, '2026-01-0' + i, { A: 1, B: 0 }, 1));
  const h0 = M.hedgeRun(seq, { eta: 0, engines: ['A', 'B'] });
  assert.ok(Math.abs(h0.weights_final.A - 0.5) < 1e-12, 'η=0 ⇒ 权重恒等');
  const lo = M.hedgeRun(seq, { eta: 0.1, engines: ['A', 'B'] });
  const hi = M.hedgeRun(seq, { eta: 2, engines: ['A', 'B'] });
  assert.ok(hi.weights_final.A > lo.weights_final.A, 'η 越大 ⇒ 越偏向表现好的 A');
  assert.ok(hi.weights_final.A > 0.5 && lo.weights_final.A > 0.5, 'A 表现好 ⇒ 权重升');
});

// ── ③b 权重塌缩自检 ─────────────────────────────────────────────────────────
test('③b★ weightCollapse：单边碾压 ⇒ 有效专家数→1（当刻塌缩题数≈全量）；势均力敌 ⇒ 有效专家数≈2', () => {
  // ★ 时刻须**严格递增**（同刻 ⇒ 延迟结算不触发 ⇒ 权重永不更新——本纪律自身即测试对象）
  const ts = (i) => '2026-01-' + String(i).padStart(2, '0');
  const items = [], seq = [];
  for (let i = 1; i <= 20; i++) {
    const eng = { A: 1, B: 0 };
    items.push({ id: i, y: 1, eng: eng, keys: ['A', 'B'] });
    seq.push(mk(i, ts(i), eng, 1));
  }
  const hA = M.hedgeRun(seq, { eta: 1, engines: ['A', 'B'] });
  const cA = M.weightCollapse(hA.traj, items, hA.weights_final);
  assert.equal(cA.top_engine, 'A', 'A 恒对 ⇒ 权重压向 A');
  assert.ok(cA.top_weight >= 0.99, '塌缩：终局最大权重 ' + cA.top_weight);
  assert.equal(cA.display_flag, true, '应触发显示标记（≥0.99）');
  assert.equal(cA.mixed_questions, 20, '20 道皆为真混合题（≥2 awake）');
  assert.ok(cA.single_engine_questions >= 15, '★当刻已塌缩（最大权重≥0.99）的题数应≈全量（前几题塌缩尚未生效），实测 ' + cA.single_engine_questions);
  assert.ok(cA.effective_experts_mean < 1.2, '★有效专家数应趋 1（混合名存实亡），实测 ' + cA.effective_experts_mean);
  // 势均力敌：两引擎轮流命中 ⇒ 权重不塌缩，有效专家数≈2
  const items2 = [], seq2 = [];
  for (let i = 1; i <= 20; i++) {
    const eng = (i % 2) ? { A: 0.9, B: 0.1 } : { A: 0.1, B: 0.9 };
    items2.push({ id: i, y: 1, eng: eng, keys: ['A', 'B'] });
    seq2.push(mk(i, ts(i), eng, 1));
  }
  const hB = M.hedgeRun(seq2, { eta: 1, engines: ['A', 'B'] });
  const cB = M.weightCollapse(hB.traj, items2, hB.weights_final);
  assert.ok(cB.top_weight < 0.99, '对称输入不该塌缩（实测 ' + cB.top_weight + '）');
  //   注：均值非恰 2——权重沿路径**振荡**（好题给 A 加权、坏题扣回），1/Σŵ² 在非等权时 <2 ⇒ 均值 <2 是路径性质，非缺陷
  assert.ok(cB.effective_experts_mean > 1.5, '★未塌缩 ⇒ 有效专家数应明显 >1（实测 ' + cB.effective_experts_mean + '）');
  assert.ok(cB.effective_experts_mean > cA.effective_experts_mean + 0.5, '对称路径的有效专家数应远高于塌缩路径');
  assert.equal(cB.single_engine_questions, 0, '对称输入 ⇒ 无当刻塌缩题');
});

// ── ④ R4 ───────────────────────────────────────────────────────────────────
test('④ R4：单 seed 确定性／只取本题可估引擎／两引擎均被覆盖', () => {
  const seq = [];
  for (let i = 1; i <= 40; i++) seq.push(mk(i, '2026-01-01', { A: 0.4, B: 0.6 }, i % 2));
  const r1 = M.r4Run(seq, { seed: 987654321 }), r2 = M.r4Run(seq, { seed: 987654321 });
  assert.deepEqual(r1.picks, r2.picks, '同 seed 逐位同');
  assert.notDeepEqual(r1.picks, M.r4Run(seq, { seed: 12345 }).picks, '换 seed 换流');
  const picked = new Set(Object.values(r1.picks));
  assert.ok(picked.has('A') && picked.has('B'), '两引擎均被取到');
  const one = M.r4Run([mk(9, '2026-01-01', { A: 0.4 }, 1)], { seed: 987654321 });
  assert.equal(one.picks[9], 'A', '只可估引擎 A ⇒ 必取 A');
  assert.equal(M.r4Run([mk(9, '2026-01-01', {}, 1)], { seed: 987654321 }).picks[9], null, '无引擎 ⇒ null');
});

// ── ⑤ runArms ──────────────────────────────────────────────────────────────
test('⑤★ runArms：M5⑤ 零选择权（降档/改层题仍以 R0 口径进配对）＋R1≡R0＋R2 取基率', () => {
  const items = [
    { id: 1, layer: 'L2', domain: 'd1', y: 1, eng: { L2: 0.6 }, keys: ['L2'], resolved_at: '2026-01-01' },
    { id: 2, layer: 'L3', domain: 'd1', y: 0, eng: { L3: 0.4 }, keys: ['L3'], resolved_at: '2026-01-02' },
    { id: 3, layer: 'L2', domain: 'd2', y: 1, eng: { L3: 0.9 }, keys: ['L3'], resolved_at: '2026-01-03' },  // 本层不可估 ⇒ R1-A 改层到 L3（design 序）
  ];
  const plan = r1mod.r1Plan(items, { combo: combo, minN: 1000 });   // minN=1000 ⇒ 全格降档（构造「全降档」）
  assert.equal(plan.counts.reassign, 1, '第三题 L2 不可估 ⇒ 按优先级改层（L3）');
  assert.equal(plan.counts.downgrade, 0, '本构造无 A(q)=∅ 题 ⇒ 无降档');
  assert.ok(plan.cells.every((c) => !c.kept), '构造：所有格保留=false（n<1000）');
  const seq = M.buildSeq(items);
  const R = M.runArms(items, plan, { seq: seq, hedge: M.hedgeRun(seq, { engines: M.ENGINE_KEYS }), r3a: M.r3aRun(seq, { minCell: 10 }), r4: M.r4Run(seq, { seed: 1 }) });
  assert.equal(R.vals.R0[3], null, '题 3 本层引擎不可估 ⇒ R0 无值');
  assert.equal(R.vals.R1[1], R.vals.R0[1], 'R1 未保留 ⇒ 回退 R0 口径（题 1）');
  assert.equal(R.vals.R1[2], R.vals.R0[2], 'R1 未保留 ⇒ 回退 R0 口径（题 2）');
  const paired = M.pairedRows(items, R.vals, 'R1', 'R0');
  assert.deepEqual(paired.map((r) => r.id), [1, 2], '未保留题**不消失**：仍以 R0 口径进配对（M5⑤）；R0 无值题才出局');
  assert.ok(paired.every((r) => Math.abs(r.d) < 1e-15), 'R1≡R0 ⇒ 逐题 Δ 恒 0（改层 0 的结构性事实）');
  assert.equal(R.vals.R2[1], 0.6, 'R2＝L2 引擎输出（题 1 有基率 ⇒ 0.6）');
});

test('⑤ runArms：R2 无基率 ⇒ null（不回退 R0）；R3h 有 awake 则用混合值', () => {
  const items = [
    { id: 1, layer: 'L3', domain: 'd1', y: 1, eng: { L3: 0.4 }, keys: ['L3'], resolved_at: '2026-01-01' },   // 无 L2 ⇒ R2 null
    { id: 2, layer: 'L2', domain: 'd1', y: 0, eng: { L2: 0.2 }, keys: ['L2'], resolved_at: '2026-01-02' },
  ];
  const plan = r1mod.r1Plan(items, { combo: combo, minN: 1000 });
  const seq = M.buildSeq(items);
  const R = M.runArms(items, plan, { seq: seq });
  assert.equal(R.vals.R2[1], null, '题 1 无基率可算 ⇒ R2 不出数（**不回退 R0**）');
  assert.equal(R.vals.R2[2], 0.2, '题 2 有 L2 ⇒ R2 = 基率引擎输出');
  assert.ok(Math.abs(R.vals.R3h[1] - 0.4) < 1e-12, 'R3h 有 awake（L3）⇒ 用混合值（单引擎＝该引擎值）');
});

// ── ⑥ TOST / Holm ──────────────────────────────────────────────────────────
test('⑥ TOST：TOST p<0.05 ⇔ 90% CI ⊂ ±ε（同一件事两种写法）', () => {
  const tight = [];
  for (let i = 0; i < 60; i++) tight.push(i % 2 ? 0.0005 : -0.0005);       // 均值≈0、极窄
  const t1 = M.tostFromDelta(tight, 0.005, 400, 987654321);
  assert.ok(t1.tost_p < 0.05, '窄分布 ⇒ 等效成立');
  assert.equal(t1.equivalent_at_05, t1.ci90_within_eps, '两种写法必须一致');
  assert.ok(t1.ci90[0] > -0.005 && t1.ci90[1] < 0.005, '90% CI 应落在 ±ε 内');
  const wide = tight.map((x) => x + 0.02);                                 // 均值 0.02 > ε ⇒ 不等效
  const t2 = M.tostFromDelta(wide, 0.005, 400, 987654321);
  assert.ok(t2.tost_p >= 0.05 && !t2.ci90_within_eps, '均值超 ε ⇒ 不得判等效');
  assert.equal(M.tostFromDelta(tight, 0.00005, 400, 987654321).ci90_within_eps, false, 'ε 收紧到 CI 半宽以下 ⇒ 同一分布判不等效（ε 敏感）');
});

test('⑥ Holm：已知例逐步校正（保序）', () => {
  const adj = M.holm([0.01, 0.04, 0.03, 0.5]);
  assert.deepEqual(adj.map((x) => Number(x.toFixed(6))), [0.04, 0.09, 0.09, 0.5], '原序输出：p×4, p×3 连带 max, p×1');
  assert.deepEqual(M.holm([0.001, 0.002]), [0.002, 0.002], '单调保序（后者不小于前者）');
  assert.deepEqual(M.holm([]), [], '空族');
});

// ── ⑦ 端到端（合成迷你库）＋ 开跑令闸 ────────────────────────────────────────
/** 合成迷你库：8 题覆盖 L1（真题面）/L2/L3/L5/L6/无引擎题；零真实账本内容。 */
function buildMiniDb() {
  const p = path.join(tmpDir, 'mini-p1a.db');
  const db = new DatabaseSync(p);
  db.exec('CREATE TABLE games (id INTEGER PRIMARY KEY, player_count INTEGER, game_type TEXT)');
  db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, game_id INTEGER, seq INTEGER, day INTEGER, phase TEXT, type TEXT, actor_seat INTEGER, raw_text TEXT)');
  db.exec('CREATE TABLE claims (id INTEGER PRIMARY KEY, event_id INTEGER, predicate TEXT)');
  db.exec('CREATE TABLE verdicts (id INTEGER PRIMARY KEY, prediction_id INTEGER, prompt_variant TEXT, implied_prob REAL, run_id TEXT)');
  db.exec('CREATE TABLE predictions (id INTEGER PRIMARY KEY, game_id INTEGER, day INTEGER, source_type TEXT, statement TEXT,'
    + ' assigned_prob REAL, evidence_json TEXT, created_at TEXT, resolved_at TEXT, outcome TEXT, resolve_note TEXT,'
    + ' layer TEXT, secondary_layer TEXT, engine TEXT, baseline_brier REAL, public_exposure INTEGER, checklist_hash TEXT,'
    + ' gate TEXT, tautology INTEGER, g2_regime TEXT, matures_at TEXT, metric_version TEXT, backtest_batch TEXT)');
  db.exec("INSERT INTO games VALUES (1, 11, 'werewolf_sim_11p_tuicheng'), (2, 11, 'werewolf_sim_11p_tuicheng'), (3, 6, 'werewolf_sim_6p_onenight')");
  db.exec("INSERT INTO events VALUES (1, 1, 1, 1, 'day', 'speech', 1, '开场'), (2, 2, 1, 1, 'day', 'death', 3, '夜里死了 3 号'), (3, 3, 1, 1, 'day', 'speech', 1, '开场')");
  db.exec("INSERT INTO claims VALUES (1, 1, 'is_good')");
  db.exec("INSERT INTO verdicts VALUES (1, 5, 'v1_evidence', 0.7, NULL), (2, 5, 'v2_skeptical', 0.5, NULL), (3, 5, 'v3_baserate', 0.6, NULL),"
    + " (4, 8, 'v1_evidence', 0.4, NULL), (5, 8, 'v2_skeptical', 0.4, NULL), (6, 8, 'v3_baserate', 0.4, NULL)");
  const ins = db.prepare('INSERT INTO predictions (id, game_id, day, source_type, statement, evidence_json, created_at, resolved_at, outcome, resolve_note, layer, g2_regime, matures_at)'
    + ' VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  // ★ evidence 须含 `resolve.kind`：真值口径过滤 SQL 的三条件 OR 链在 json_extract 为 NULL 时整式为 NULL ⇒ 行被静默排除
  //   （实测：缺 kind 的合成行 cohortRows=0）。这是该 SQL 的既有语义（防 forecast 早解泄漏），测试数据须照实构造。
  const RK_WOLF = JSON.stringify([{ kind: 'b4_forward', resolve: { kind: 'werewolf_sim' } }]);
  const RK_B4 = JSON.stringify([{ kind: 'b4_forward', resolve: { kind: 'b4_mini' } }]);
  const BR = JSON.stringify([{ baseRate: { p: 0.6, n: 40, k: 24 }, kind: 'b4_forward', resolve: { kind: 'b4_mini' } }]);
  // ★ 认证源须带 `target` 才出 p（l5_certified 口径：只给认证目标的概率，否则 p=null）——测试数据照实构造
  const CS = JSON.stringify([{ certifiedSource: { id: 'cs1', kind: 'uniform', n: 2, target: 'outcome_1' }, kind: 'b4_forward', resolve: { kind: 'b4_mini' } }]);
  const rows = [
    [1, 1, '首夜平安', RK_WOLF, 'true', 'L1'], [2, 2, '首夜平安', RK_WOLF, 'false', 'L1'],
    [3, 1, '基率题A', BR, 'true', 'L2'], [4, 1, '基率题B', BR, 'false', 'L3'],
    [5, 2, '判词题A', RK_WOLF, 'true', 'L6'], [6, 1, '认证题A', CS, 'false', 'L5'],
    [7, 3, '无引擎题', RK_B4, 'true', 'L2'], [8, 2, '判词题B', RK_WOLF, 'false', 'L6'],
  ];
  for (const r of rows) ins.run(r[0], r[1], '预测卡', r[2], r[3], '2026-01-0' + r[0] + ' 00:00:00', '2026-02-0' + ((r[0] % 8) + 1) + ' 00:00:00', r[4], '机检:mini', r[5], 'R4', '2027-01-01 00:00:00');
  db.close();
  return p;
}

test('⑦ open-gate：无 --arms ⇒ exit 3 且**零写盘**（开跑令闸）', () => {
  const out = path.join(tmpDir, 'gate-out');
  fs.mkdirSync(out, { recursive: true });
  let code = 0, err = '';
  try { execFileSync(process.execPath, [SCRIPT, '--out-dir', out], { encoding: 'utf8' }); }
  catch (e) { code = e.status; err = String(e.stderr || ''); }
  assert.equal(code, 3, '无 --arms 必须 exit 3（实测 ' + code + '）');
  assert.ok(/开跑令闸/.test(err) && /--arms/.test(err), '应说明开跑令闸与 --arms: ' + err.slice(0, 200));
  assert.equal(fs.readdirSync(out).length, 0, '被拒时不得写任何读数件');
});

test('⑦★ 合成迷你库：矩阵接线（全引擎、真题面）＋端到端三件产物＋零账本写', () => {
  const mini = buildMiniDb();
  const before = sha(mini);
  // a) 矩阵接线：L1 靠**真题面**出数（旧件传 '' ⇒ L1 恒缺）；引擎不看 layer（题 3 有 L3）
  const mat = combo.buildEngineMatrix(mini);
  const byId = {}; for (const it of mat.items) byId[it.id] = it;
  assert.equal(mat.cohortRows, 8, '迷你库队列 8');
  assert.ok(byId[1].keys.indexOf('L1') !== -1, '★ 题 1（L1）须出数（真题面命中 first_night_peace）');
  assert.ok(byId[3].keys.indexOf('L3') !== -1 && byId[3].keys.indexOf('L2') !== -1, '★ 题 3 须同时有 L2/L3（不按 layer 门控）');
  assert.deepEqual(byId[7].keys, [], '题 7 无任何引擎（A(q)=∅）');
  assert.ok(byId[1].resolved_at && byId[1].created_at, '★ 时序字段已挂（R3 walk-forward 用）');
  // b) 端到端跑批（--arms，迷你库，tmp 输出）
  const out = path.join(tmpDir, 'e2e-out');
  fs.mkdirSync(out, { recursive: true });
  execFileSync(process.execPath, [SCRIPT, '--arms', '--db', mini, '--out-dir', out, '--boot', '200'], { encoding: 'utf8' });
  const files = fs.readdirSync(out).sort();
  const jf = files.filter((f) => /^e2-shadow-score-.*\.json$/.test(f))[0];
  const mf = files.filter((f) => /^e2-shadow-score-.*\.md$/.test(f))[0];
  const wf = files.filter((f) => /^e2-shadow-weights-.*\.jsonl$/.test(f))[0];
  assert.ok(jf && mf && wf, '三件产物应齐（实测 ' + JSON.stringify(files) + '）');
  const j = JSON.parse(fs.readFileSync(path.join(out, jf), 'utf8'));
  assert.equal(j.rules_match, true, 'R1 冻结件须 MATCH（M5① 机器闸）');
  assert.equal(j.cohort, 8);
  assert.equal(j.discipline.arms_reading_run, true);
  assert.equal(j.c2_primary.n, 7, 'C2 配对集＝R0 人口（题 7 无引擎 ⇒ 不入）');
  assert.ok(/无信息量/.test(j.c2_primary.verdict), '★恒等情形须标注「判定无信息量」（不得读作非劣证据）: ' + j.c2_primary.verdict);
  assert.equal(j.c4_secondary.comparisons.R3a_vs_R0.identical_per_question, true, '★逐题同值标记（迷你库全 fallback）');
  assert.equal(j.c3_posture.R1.published, 0, '★ 全格 n<30 ⇒ R1 姿态出数 0');
  assert.equal(j.c3_posture.R1.scored_common_set, 7, '★ 但降档题仍以 R0 口径进配对（M5⑤ 零选择权）');
  assert.equal(j.c4_secondary.comparisons.R3a_vs_R2.n, 2, 'C4b 配对集＝R2 人口（题 3/4）');
  const traj = fs.readFileSync(path.join(out, wf), 'utf8').trim().split('\n').map((x) => JSON.parse(x));
  assert.equal(traj.length, 8, '权重轨迹逐题一条（含 no_awake 题）');
  for (const x of traj) {
    assert.ok(x.w && typeof x.w === 'object', '每条轨迹须含权重快照（id=' + x.id + '）');
    assert.ok(x.p === null || typeof x.p === 'number', 'p 须为数或 null（id=' + x.id + '）');
    assert.ok(Array.isArray(x.awake), 'awake 须为数组');
  }
  // ★回归锁（2026-09-17 实测缺陷）：塌缩自检曾因字段重命名而**只在 main 的显示路径**打印 undefined
  //   （纯函数测试覆盖不到 ⇒ 本断言锁 MD 全文）。同族纪律：改了字段名，**顺带 grep 全部引用点**。
  const md = fs.readFileSync(path.join(out, mf), 'utf8');
  assert.ok(!/undefined/.test(md), '★MD 不得含 undefined（显示路径回归锁）');
  assert.ok(/权重塌缩自检/.test(md) && /有效专家数均值/.test(md), 'MD 须含塌缩自检段（新口径）');
  assert.equal(sha(mini), before, '★ 迷你库不得被改动（零账本写）');
});

// ── ⑧ 卫生 ─────────────────────────────────────────────────────────────────
test('⑧ require 零副作用（主流程只在 CLI 直跑）＋生产库零接触', () => {
  const snap = () => fs.readdirSync(SIMOUT).sort().map((f) => f + ':' + fs.statSync(path.join(SIMOUT, f)).mtimeMs).join('\n');
  const s0 = snap(); const p0 = sha(PROD);
  execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(SCRIPT) + ')'], { encoding: 'utf8' });
  assert.equal(snap(), s0, 'require 本件不得写盘');
  assert.equal(sha(PROD), p0, 'require 不得触碰生产库');
  assert.ok(!/\bfetch\s*\(/.test(fs.readFileSync(SCRIPT, 'utf8')), '不应含 fetch（零网络）');
});
