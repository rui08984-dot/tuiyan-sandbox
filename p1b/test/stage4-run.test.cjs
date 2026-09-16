'use strict';
/**
 * p1b/test/stage4-run.test.cjs —— 阶段 4「分层预测真跑」脚本回归（2026-09-14 新增）
 *
 * 背景：L2/L5 引擎已建并接线到接题层，但从未对**已有账本**真跑（路线图阶段 4 的「真跑」）。
 * 本测试锁死 stage4-run.cjs 的口径契约：
 *   · 只跑引擎已建的 L2/L5（其余层不出现）
 *   · 分层报、禁跨层池化（每层各自独立读数）
 *   · L5 认证源：**读侧结构化后出数=账本行**（按 resolve.kind 的组合数重建）；来源分类必须覆盖全部行、**不编数**
 *   · Δ 带配对 bootstrap CI；CI 含 0 时**不得**给出「优于」结论（防过度声称）
 *   · 确定性：两次跑 JSON 一致（seed 固定）
 * 铁律：只读库（临时文件库）；零网络；子进程运行。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'p1b', 'scripts', 'stage4-run.cjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-stage4-'));

test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

test('stage4-run：产出分层读数（仅 L2/L5）、L5 读侧重建出数、Δ 带 CI 且 CI 含 0 时不声称优', () => {
  const out = path.join(tmpDir, 's4.json');
  execFileSync(process.execPath, [SCRIPT, '--json', out], { stdio: 'ignore' });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(r.report, '有 report');
  assert.deepEqual(Object.keys(r.report).sort(), ['L1', 'L2', 'L3', 'L5', 'L6'], '引擎已建的五层（禁跨层池化 ⇒ 分层独立）');
  const l2 = r.report.L2;
  assert.ok(l2.ledger_rows > 0, 'L2 有账本行');
  assert.ok(l2.engine_ok > 0, 'L2 引擎有出数');
  if (l2.scored_n >= 30) {
    assert.ok(l2.delta_ci95 && typeof l2.delta_ci95.lb === 'number', 'Δ 带 bootstrap CI');
    assert.equal(l2.delta_ci95.B, 1000, '口径 B=1000');
    assert.equal(l2.delta_ci95.seed, 987654321, '口径 seed 固定');
    // 防过度声称：CI 含 0（ub>=0）⇒ 不得给「优于」信号
    if (l2.delta_ci95.ub >= 0) assert.notEqual(l2.signal, 'engine_beats_half_CI_excludes_0', 'CI 含 0 不得声称优于');
  }
  // L6（2026-09-14 接线）：判词结构聚合＝狼人杀线接入。不变量：判词齐备⇒全出数/全可计分；p∈(0,1)；账本先验对照存在。
  const l6 = r.report.L6;
  assert.ok(l6.ledger_rows > 0, 'L6 有账本行');
  assert.equal(l6.engine_ok, l6.ledger_rows, 'L6 全部出数（判词齐备）');
  assert.equal(l6.scored_n, l6.ledger_rows, 'L6 全部可计分（270/270 已解）');
  assert.ok(l6.brier_engine !== undefined && l6.brier_engine !== null, 'L6 有 Brier 读数');
  assert.ok(l6.mean_p > 0 && l6.mean_p < 1, 'L6 平均 p 在 (0,1)');
  assert.ok(l6.brier_ledger_prior !== null && typeof l6.delta_vs_ledger_prior === 'number', 'L6 含账本先验对照（assigned_prob，非引擎输出）');
  // L1（2026-09-14 接线）：程序复算。核心不变量——**复算结论必须与账本真值一致**（正确率=1）。
  const l1 = r.report.L1;
  assert.ok(l1.ledger_rows > 0, 'L1 有账本行');
  assert.equal(l1.engine_ok + 0, l1.ledger_rows, 'L1 全部出数（规则族覆盖当前模板）');
  assert.equal(l1.scored_n, l1.ledger_rows, 'L1 全部可计分（180/180 已解）');
  assert.equal(l1.accuracy, 1, 'L1 复算正确率=1（对账：复算结论 == 账本真值）');
  assert.equal(l1.signal, 'proc_calc_deterministic', 'L1 信号＝复算确定性（非概率对照）');
  // L3（2026-09-14 接线）：p=基率 + ACI 覆盖率披露；出数与可计分如实（不编数）
  const l3 = r.report.L3;
  assert.ok(l3.ledger_rows > 0, 'L3 有账本行');
  assert.ok(l3.engine_ok > 0, 'L3 引擎有出数');
  assert.ok(l3.scored_n > 0, 'L3 已可计分（已解行）');
  assert.ok(l3.scored_n <= l3.ledger_rows, 'L3 可计分 ≤ 账本行');
  assert.ok(r.l3_aci && r.l3_aci.alpha_final !== undefined, 'L3 ACI 回放节存在');
  assert.ok(r.l3_aci.coverage === null || r.l3_aci.coverage.n >= 0, 'ACI 覆盖率如实（含 null）');
  const l5 = r.report.L5;  // 2026-09-14 读侧结构化后：L5 认证源按 resolve.kind 从组合数注册表重建 ⇒ 出数=账本行（不再恒 0）；
  // 可计分数由「开奖真值到达情况」决定（当前 30 行已 resolve），但**必须 ≤ 账本行**（不编数）。
  assert.ok(l5.ledger_rows > 0, 'L5 有账本行');
  const src = r.l5_source_resolution;
  assert.ok(src, '含 L5 认证源来源分类节');
  assert.equal(l5.engine_ok + src.none, l5.ledger_rows, '出数 + 两路皆无 = 账本行（不编数）');
  assert.ok(src.read_side > 0, '读侧注册表重建生效');
  assert.equal(src.structured + src.read_side + src.none, l5.ledger_rows, '来源分类覆盖全部行');
  assert.equal(src.note_mismatch, 0, '认证值声明与注册表零矛盾（若报警：人工复核该行文本）');
  assert.ok(l5.scored_n > 0, 'L5 已可计分（开奖真值已达的行）');
  assert.ok(l5.scored_n <= l5.ledger_rows, '可计分 ≤ 账本行');
});

test('stage4-run：L5 认证源缺口如实披露（写端未结构化；读侧已重建）', () => {
  const out = path.join(tmpDir, 's4b.json');
  execFileSync(process.execPath, [SCRIPT, '--json', out], { stdio: 'ignore' });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(r.l5_evidence_gap, 'L5 缺口披露节存在');
  const g = r.l5_evidence_gap;
  assert.ok(g.l5_rows >= 0, 'L5 行数');
  assert.ok(typeof g.note_text_with_certified_value === 'number', '有多少行文本含认证值');
  assert.ok(g.gap && /certifiedSource/.test(g.gap), '缺口说明点名契约字段');
  assert.ok(/读侧/.test(g.gap), '缺口说明含读侧修记录（2026-09-14）');
});

test('stage4-run：确定性（两次跑读数逐位一致，seed 固定）', () => {
  const a = path.join(tmpDir, 'a.json'); const b = path.join(tmpDir, 'b.json');
  execFileSync(process.execPath, [SCRIPT, '--json', a], { stdio: 'ignore' });
  execFileSync(process.execPath, [SCRIPT, '--json', b], { stdio: 'ignore' });
  const A = JSON.parse(fs.readFileSync(a, 'utf8')); const B = JSON.parse(fs.readFileSync(b, 'utf8'));
  delete A.generated_at; delete B.generated_at;
  assert.deepEqual(A.report, B.report, '两次跑分层读数一致');
});

// ── 2026-09-16 · P0-U2：贝叶斯语义标注 additive（金样零 diff ＋ 六档文本逐字）──
const GOLDEN = path.join(ROOT, 'p1b', 'test', 'fixtures', 'stage4-golden-20260916.json');
function stripped(obj) {
  const o = JSON.parse(JSON.stringify(obj));
  delete o.generated_at; delete o.bayes_legend;
  for (const L of Object.keys(o.report || {})) delete o.report[L].bayes_semantics;
  return o;
}

test('U2：stage4 金样零 diff（除新增 bayes_semantics/bayes_legend 键外逐字段 deep-equal）', () => {
  assert.ok(fs.existsSync(GOLDEN), '金样夹具存在（改前存档）');
  const out = path.join(tmpDir, 'u2.json');
  execFileSync(process.execPath, [SCRIPT, '--json', out], { stdio: 'ignore' });
  const now = JSON.parse(fs.readFileSync(out, 'utf8'));
  const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(stripped(now), stripped(gold), '读数零 diff（仅豁免新增键）');
});

test('U2：六档贝叶斯语义 role/note 与设计表逐字一致 ＋ JSON 含 bayes_legend', () => {
  const out = path.join(tmpDir, 'u2b.json');
  execFileSync(process.execPath, [SCRIPT, '--json', out], { stdio: 'ignore' });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  const WANT = {
    L1: { role: 'deterministic_recalc', note: '概率主干豁免' },
    L2: { role: 'prior', note: '基率+Wilson' },
    L3: { role: 'prior+calibration', note: 'ACI 只调区间不调 p' },
    L4: { role: 'annotation_layer', note: '不出数' },
    L5: { role: 'certified_prior', note: '不可约随机' },
    L6: { role: 'posterior_aggregation', note: '似然证据行→固定规则聚合' },
  };
  for (const L of Object.keys(r.report)) {
    const bs = r.report[L].bayes_semantics;
    assert.ok(bs && bs.role, L + ' 缺 bayes_semantics.role');
    assert.deepEqual(bs, WANT[L], L + ' 语义与设计表不一致');
  }
  assert.ok(r.bayes_legend && r.bayes_legend.map && r.bayes_legend.map.L4, '含 bayes_legend 六档图例（含 L4）');
  assert.match(r.bayes_legend.source, /10/, '图例注明词汇源=10 号件 §4');
});


test('stage4-run：L2 对照臂可得性检查——assigned_prob≡基率 且无判词 ⇒ 如实报无独立臂', () => {
  const out = path.join(tmpDir, 'rival.json');
  execFileSync(process.execPath, [SCRIPT, '--json', out], { stdio: 'ignore' });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(r.l2_rival_arm_check, '对照臂检查节存在');
  const c = r.l2_rival_arm_check;
  assert.ok(c.assigned_prob_vs_baserate, '含 assigned_prob vs baseRate 比对');
  const cmp = c.assigned_prob_vs_baserate;
  // 核心事实：assigned_prob 与基率逐行相同（同一统计基率的复写）
  if (cmp.compared > 0) {
    assert.equal(cmp.differing, 0, 'assigned_prob 与基率无不一致（＝同一复写，不是第二路模型）');
    assert.ok(cmp.max_abs_diff < 0.001, '最大偏差 <1e-3（仅四舍五入）');
  }
  // 无判词 ⇒ 无独立臂
  assert.equal(c.l2_rows_with_verdicts, 0, 'L2 无 LLM 判词');
  assert.equal(c.rival_arm_available, false, '如实报：无独立对照臂');
  assert.ok(/不可回答/.test(c.conclusion) || /无.*对照臂/.test(c.conclusion), '结论如实');
});

