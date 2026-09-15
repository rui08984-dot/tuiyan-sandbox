'use strict';
/**
 * d2-backtest.test.cjs —— D2 历史回测引擎 **口径与隔离锁定测试**（2026-09-15）。
 *
 * 判据来源：`.scratch/forecast-debate/PREREG-D2-历史回测引擎-v1.md`（sha 70cf9d17…）
 *   ＋ `…-v1.1-补充与勘误.md`（四处勘误：D2-A horizon 解耦／D2-B 批配额／D2-C HB 范围／D2-D 极档不可达）。
 *
 * 铁律：零网络、零 LLM、零写库（只读产物与影子库；**不打开生产库**）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const QF = path.join(ROOT, '.scratch/backtest/d2-questions.json');
const RF = path.join(ROOT, '.scratch/backtest/d2-report.json');
const SURFACE = path.join(ROOT, '.scratch/backtest/predictions-public-surface.db');

test('D2 题面：C1/C3 —— cutoff = 出题日 23:59 且严格早于事件日（勘误 D2-A）', () => {
  assert.ok(fs.existsSync(QF), '前提：题面产物存在');
  const a = JSON.parse(fs.readFileSync(QF, 'utf8'));
  assert.ok(a.questions.length > 0, '须有题');
  for (const q of a.questions) {
    assert.equal(q.cutoff_at, q.question_date + 'T23:59:00+08:00', 'C3：cutoff 须为出题日 23:59');
    assert.ok(q.question_date < q.event_date, 'C1：出题日须严格早于事件日');
    assert.ok(q.cutoff_at < q.event_date + 'T00:00', 'C1：cutoff 须严格早于事件日');
    // 勘误 D2-A：horizon = 出题日距事件日（解耦后的口径）
    const d = Math.round((new Date(q.event_date + 'T00:00:00Z') - new Date(q.question_date + 'T00:00:00Z')) / 86400000);
    assert.equal(q.horizon_days, d, 'horizon_days 须 == 出题日与事件日的差');
  }
});

test('D2 题面：A1 量 —— ≥200 题、≥3 城、≥12 月、≥2 horizon 档、≤500（勘误 D2-B）', () => {
  const a = JSON.parse(fs.readFileSync(QF, 'utf8'));
  const qs = a.questions;
  assert.ok(qs.length >= 200, 'A1：≥200 题（实际 ' + qs.length + '）');
  assert.ok(qs.length <= 500, 'A1：单批 ≤500（实际 ' + qs.length + '）');
  const cities = new Set(qs.map((q) => q.city));
  const months = new Set(qs.map((q) => q.month));
  const hs = new Set(qs.map((q) => (q.horizon_days <= 7 ? 'short' : 'mid')));
  assert.ok(cities.size >= 3, 'A1：≥3 城（实际 ' + cities.size + '）');
  assert.equal(months.size, 12, 'A1：12 个月全覆盖（实际 ' + months.size + '）');
  assert.ok(hs.size >= 2, 'A1：≥2 horizon 档（实际 ' + hs.size + '）');
});

test('D2 题面：Q0-3 基率域 (0.15,0.85) —— 且「极」档数学不可达（勘误 D2-D）', () => {
  const a = JSON.parse(fs.readFileSync(QF, 'utf8'));
  for (const q of a.questions) {
    assert.ok(q.base_rate > 0.15 && q.base_rate < 0.85, 'Q0-3：基率须落 (0.15,0.85)，实测 ' + q.base_rate);
  }
  // 证明「极」档（b(1−b)<0.09）与基率域无交集
  const lo = 0.15 * (1 - 0.15), hi = 0.85 * (1 - 0.85);
  assert.ok(lo > 0.09 && hi > 0.09, '基率域两端 b(1−b) 均 >0.09 ⇒ 极档不可达（勘误 D2-D）');
});

test('D2 跑批：A2 泄漏率 = 0，K1 三层断言全 PASS', () => {
  const r = JSON.parse(fs.readFileSync(RF, 'utf8'));
  assert.equal(r.leak_selfcheck.leak_rate, 0, 'A2：泄漏率必须为 0');
  assert.equal(r.kill_tests.K1.pass, true, 'K1：隔离断言须全 PASS');
  assert.equal(r.leak_selfcheck.cutoff_check.violations, 0, 'cutoff 时点扫描 0 违规');
  assert.equal(r.leak_selfcheck.schema_check.pass, true, '题面库 schema 无泄漏列');
  assert.equal(r.leak_selfcheck.sample_recheck.violations, 0, '10% 抽样复算 0 违规');
});

test('D2 跑批：A3 单元必报列齐（b / b(1−b) / Brier / Δ）＋ A5 n<30 不出结论', () => {
  const r = JSON.parse(fs.readFileSync(RF, 'utf8'));
  assert.ok(r.by_cell.length > 0, '须有单元');
  for (const c of r.by_cell) {
    assert.ok(typeof c.b_1mb === 'number', 'A3：单元须报 b(1−b)');
    if (c.conclusion_allowed) {
      assert.ok(c.n >= 30, 'A5：出结论的单元须 n≥30');
      assert.ok(typeof c.delta_vs_b1mb === 'number', 'A3：单元须报 Δ(vs b(1−b))');
      assert.ok(typeof c.brier === 'number', 'A3：单元须报 Brier');
    } else {
      assert.ok(c.n < 30, 'A5：标样本不足的单元须真的 n<30');
      assert.equal(c.delta_vs_b1mb, undefined, 'A5：样本不足的单元**不得**给 Δ');
    }
  }
});

test('D2 隔离：跑批脚本不打开生产库；影子库无真值列', () => {
  const src = fs.readFileSync(path.join(ROOT, 'p1b/scripts/d2-run-backtest.cjs'), 'utf8');
  // 生产库路径不得出现在「打开」语境（允许在注释/说明里提及，但不得有 DatabaseSync(生产库)）
  const opens = src.match(/new DatabaseSync\(([^)]*)\)/g) || [];
  for (const o of opens) {
    assert.ok(o.indexOf('p1a.db') < 0, '不得打开生产库：' + o);
  }
  // 影子库 schema：无 outcome / truth_preview / resolve_note
  const db = new DatabaseSync(SURFACE, { readOnly: true });
  const cols = db.prepare('PRAGMA table_info(predictions_public)').all().map((c) => c.name);
  db.close();
  for (const bad of ['outcome', 'truth_preview', 'resolve_note']) {
    assert.equal(cols.indexOf(bad), -1, '影子库不得含真值列：' + bad);
  }
});

test('D2 诚实标注：报告恒挂「历史回测·非实时能力」＋ 未覆盖节', () => {
  const r = JSON.parse(fs.readFileSync(RF, 'utf8'));
  assert.match(r.honesty, /历史回测/, '须挂历史回测标注');
  assert.match(r.honesty, /非实时/, '须声明非实时能力');
  assert.ok(r.hb_note && /HB/.test(r.hb_note), '须声明未做 HB（勘误 D2-C）');
  assert.ok(r.difficulty_note && /极/.test(r.difficulty_note), '须披露极档不可达（勘误 D2-D）');
  assert.ok(r.isolation_note && /零账本写/.test(r.isolation_note), '须声明零账本写');
  // 未覆盖节须落文本产物
  const txt = fs.readFileSync(RF.replace(/\.json$/, '.txt'), 'utf8');
  assert.match(txt, /未覆盖与不可外推/, '须含未覆盖节');
  assert.match(txt, /不得.*外推/, '须含不可外推声明');
});

test('D2 无增量如实报（K4）：model ≡ base ⇒ Δ 结构性为 0', () => {
  const r = JSON.parse(fs.readFileSync(RF, 'utf8'));
  // v1 的 model 臂恒等于 base 臂 ⇒ 两者 Brier 应逐题相同
  for (const row of r.rows) {
    assert.equal(row.p_model, row.p_base, 'v1：model 须恒等于 base（PREREG §4）');
    assert.equal(row.brier_model, row.brier_base, 'v1：两臂 Brier 须相同');
  }
});
