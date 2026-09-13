'use strict';
/**
 * p1b/test/intake-engines.test.cjs —— 阶段 4 起步：L2/L5 最小引擎 + gate 状态机（2026-09-13）。
 * 覆盖：Wilson 数值（与手算样例对照，含 k=0 的 Wald 退化反例）/ n<30 数据不足 / L5 认证源公布分布
 *   与 unsupported / 三条口径护栏（scored 前无概率、L5 无「更准更好」类断言、n<30 无 p）/
 *   gate 状态机纯函数 / intake 接线落库（intake_questions additive 列）。
 * 铁律：不起真端口（app.inject）、DB=:memory:、零网络零 LLM、零写生产库。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const store = require('../src/db/intakeStore');
const { l2Baseline, wilson } = require('../src/engines/l2_baseline');
const { l5Certified, scanForbiddenAssertions } = require('../src/engines/l5_certified');
const intake = require('../src/routes/intake');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-engines-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;
const j = (r) => r.json();
test.before(async () => { app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders }); });
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

const yes3 = () => [true, true, true];
const yes4 = () => [true, true, true, true];
const no3 = () => [false, false, false];
const no4 = () => [false, false, false, false];
function ck(over) {
  return Object.assign({ Q0_1: true, Q0_2: true, Q0_3: true,
    L5: no3(), L6: no4(), L1: no4(), L3: no4(), L2: no4(), L4: no3() }, over || {});
}
async function classify(payload) {
  const r = await app.inject({ method: 'POST', url: '/api/intake/classify', payload: payload });
  return { status: r.statusCode, body: j(r) };
}
/** 口径护栏①的通用不变量：任何响应里「有概率」必须「gate=scored」。 */
function assertProbOnlyWhenScored(body, tag) {
  const hasProb = body.prob !== null && body.prob !== undefined;
  if (hasProb) assert.equal(body.gate, 'scored', tag + '：有概率就必须 scored');
  if (body.gate !== 'scored') assert.equal(body.prob, null, tag + '：非 scored 必须无概率');
}

// ── 1. L2 Wilson 数值正确性（手算对照，手算过程见收据）────────────────────────
test('Wilson 手算对照①：k=30/n=100 → p=0.3，CI≈[0.2189,0.3959]', () => {
  const out = l2Baseline({ counts: { k: 30, n: 100 } });
  assert.equal(out.ok, true);
  assert.equal(out.method, 'stat_baseline+wilson');
  assert.equal(out.p, 0.3);
  assert.equal(out.n, 100);
  assert.ok(Math.abs(out.ci[0] - 0.2189) < 1e-4, 'lo=' + out.ci[0]);
  assert.ok(Math.abs(out.ci[1] - 0.3959) < 1e-4, 'hi=' + out.ci[1]);
  assert.ok(out.ci[0] < out.p && out.p < out.ci[1]);
});

test('Wilson 手算对照②：k=0/n=40 → CI=[0,0.087625]（Wald 会退化成 [0,0]，Wilson 不退化）', () => {
  const out = l2Baseline({ counts: { k: 0, n: 40 } });
  assert.equal(out.p, 0);
  assert.equal(out.ci[0], 0);
  assert.ok(Math.abs(out.ci[1] - 0.0876) < 1e-4, 'hi=' + out.ci[1]);
  assert.ok(out.ci[1] > 0.08, 'Wilson 在 k=0 时非零宽');
  const w = wilson(0, 40);
  assert.equal(w.lo, 0);
  assert.equal(w.hi, 0.087625, '与手算 0.087625 逐位一致');
});

test('Wilson 高命中端 k=39/n=40：区间恒在 [0,1]，下界≈0.8712', () => {
  const out = l2Baseline({ counts: { k: 39, n: 40 } });
  assert.equal(out.p, 0.975);
  assert.ok(out.ci[0] >= 0 && out.ci[1] <= 1, '区间恒在 [0,1]');
  assert.ok(Math.abs(out.ci[0] - 0.8712) < 1e-4, 'lo=' + out.ci[0]);
  assert.ok(Math.abs(out.ci[1] - 0.9956) < 1e-4, 'hi=' + out.ci[1]);
});

// ── 2. L2 护栏③（n<30 无 p）+ 三种基率来源 ──────────────────────────────────
test('L2 护栏③：n<30 → 数据不足，不出 p 也不出区间；n=30 恰过准入线', () => {
  const out = l2Baseline({ history: Array(29).fill(1) });
  assert.equal(out.ok, false);
  assert.equal(out.status, 'insufficient_data');
  assert.equal(out.p, null);
  assert.equal(out.ci, null);
  assert.match(out.note, /数据不足/);
  const edge = l2Baseline({ history: Array(30).fill(1) });
  assert.equal(edge.ok, true, 'n=30 是准入线（含）');
  assert.equal(edge.n, 30);
});

test('L2 三种基率来源：history 序列 / counts / evidence.baseRateNote（与 g2-report 同口径）', () => {
  const h = l2Baseline({ history: [1,1,1,1,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0] });
  assert.equal(h.n, 30); assert.equal(h.k, 12); assert.equal(h.p, 0.4);
  const c = l2Baseline({ counts: { k: 149, n: 331 } });
  assert.equal(c.n, 331); assert.equal(c.k, 149);
  const frac = l2Baseline({ baseRateNote: '历史占比：月值 <1.15 共 149/331（pre-cutoff 已发布口径）' });
  assert.equal(frac.source, 'baseRateNote:fraction');
  assert.equal(frac.n, 331); assert.equal(frac.k, 149);
  assert.equal(frac.p, c.p, '同一 k/n 两种来源 p 一致');
  const pct = l2Baseline({ baseRateNote: '历史回填·上海 9月：2015-2023 共 300 个历史日值，max>35°C 占 3.0%' });
  assert.equal(pct.n, 300); assert.equal(pct.k, 9); assert.equal(pct.p, 0.03);
});

test('L2 无源 / 无样本量：一律数据不足（宁可缺，不可编）', () => {
  assert.equal(l2Baseline({}).status, 'insufficient_data');
  const eq = l2Baseline({ baseRateNote: '基率=0.5' });
  assert.equal(eq.ok, false);
  assert.equal(eq.p, null);
  assert.match(eq.note, /样本量/);
  const bad = l2Baseline({ baseRateNote: '无可解析数字的说明' });
  assert.equal(bad.ok, false);
  assert.equal(bad.source, 'baseRateNote:unparsed');
});

// ── 3. L5 认证源公布分布（护栏②：无「更准/更好」类断言）─────────────────────
test('L5 均匀分布：n=6 认证源逐结果 1/6；目标结果 p=1/6', () => {
  const out = l5Certified({ certifiedSource: { id: 'dice-official', kind: 'uniform', n: 6, target: 'outcome_3' } });
  assert.equal(out.ok, true);
  assert.equal(out.method, 'certified_dist');
  assert.equal(out.distribution.outcomes.length, 6);
  assert.equal(out.p, 0.166666667);
  assert.ok(out.distribution.probs.every((x) => x === out.distribution.probs[0]));
  assert.equal(out.assertion_guard.hits.length, 0);
});

test('L5 官方公布分布：outcomes/probs 照原样透出；非法分布退回 unsupported', () => {
  const ok = l5Certified({ certifiedSource: { id: 'cwl_ssq_blue', kind: 'official', outcomes: ['odd', 'even'], probs: [0.5, 0.5], target: 'odd' } });
  assert.equal(ok.ok, true); assert.equal(ok.p, 0.5);
  assert.deepEqual(ok.distribution, { outcomes: ['odd', 'even'], probs: [0.5, 0.5] });
  const bad = l5Certified({ certifiedSource: { id: 'x', kind: 'official', outcomes: ['a', 'b'], probs: [0.4, 0.4] } });
  assert.equal(bad.ok, false); assert.equal(bad.status, 'unsupported');
  assert.equal(bad.reason, 'official_prob_sum_not_one');
});

test('L5 护栏①：无认证源声明 → unsupported，不出任何分布或概率', () => {
  const out = l5Certified({});
  assert.equal(out.ok, false);
  assert.equal(out.status, 'unsupported');
  assert.equal(out.reason, 'no_source');
  assert.equal(out.p, null);
  assert.equal(out.distribution, null);
  assert.equal(out.ci, null);
});

test('L5 护栏②：输出不含「更准/更好」类断言（全量输出黑名单扫描 + 反向自检）', () => {
  const outs = [
    l5Certified({ certifiedSource: { id: 'rng-1', kind: 'uniform', n: 10 } }),
    l5Certified({ certifiedSource: { id: 'lottery', kind: 'official', outcomes: ['a', 'b'], probs: [0.5, 0.5] } }),
    l5Certified({}),
  ];
  for (const o of outs) {
    assert.deepEqual(o.assertion_guard.hits, [], '自产文案命中黑名单即护栏失效');
    assert.equal(scanForbiddenAssertions(JSON.stringify(o)).length, 0, '全量输出无断言：' + JSON.stringify(o.source));
  }
  assert.ok(scanForbiddenAssertions('本模型更准').length >= 1, '黑名单本身可检出（反向自检）');
});

// ── 4. gate 状态机（纯函数）────────────────────────────────────────────────
test('gate 状态机：L2/L5 + G2 PASS + 引擎 ok → scored；其余恒 descriptive', () => {
  const okRes = { ok: true, status: 'ok' };
  assert.equal(intake.resolveGate('L2', okRes).gate, 'scored');
  assert.equal(intake.resolveGate('L5', okRes).gate, 'scored');
  assert.equal(intake.G2.passed, true, '阶段 3 已转正');
  for (const L of ['L1', 'L3', 'L4', 'L6', 'unknown']) {
    assert.equal(intake.resolveGate(L, okRes).gate, 'descriptive', L + ' 恒 descriptive');
  }
  assert.equal(intake.resolveGate('L2', okRes, { g2Passed: false }).gate, 'descriptive', 'G2 未过 → descriptive');
  assert.equal(intake.resolveGate('L2', okRes, { built: false }).gate, 'descriptive', '未接线 → descriptive');
  assert.equal(intake.resolveGate('L2', { ok: false, status: 'insufficient_data' }).gate, 'descriptive');
  assert.equal(intake.resolveGate('L2', null).gate, 'descriptive');
  assert.deepEqual(intake.SCORABLE_LAYERS, ['L2', 'L5']);
});

// ── 5. intake 接线（端到端，:memory: 库）────────────────────────────────────
test('端到端：L2 + base_rate{k:30,n:100} → gate=scored，prob/CI 落库（built&predicts=true）', async () => {
  const r = await classify({ statement: '端到端 L2：某地 9 月降水日数（历史基率 30/100）', checklist: ck({ L2: yes4() }), base_rate: { k: 30, n: 100 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.layer, 'L2');
  assert.equal(r.body.gate, 'scored');
  assert.equal(r.body.gate_reason, 'g2_r4_passed+engine_ok');
  assert.equal(r.body.prob, 0.3);
  assert.deepEqual(r.body.prob_ci, [0.218948, 0.39585]);
  assert.equal(r.body.engine_plan.built, true);
  assert.equal(r.body.engine_plan.predicts, true);
  assert.equal(r.body.engine_result.method, 'stat_baseline+wilson');
  assert.match(r.body.engine_note, /stat_baseline\+wilson/);
  assertProbOnlyWhenScored(r.body, 'L2 scored');
  const q = store.getIntakeQuestion(r.body.intake_question_id);
  assert.equal(q.gate, 'scored');
  assert.equal(q.prob, 0.3);
  assert.deepEqual(q.prob_ci, [0.218948, 0.39585]);
  assert.match(q.engine_note, /gate=scored/);
});

test('端到端：L2 + evidence.baseRateNote → scored 且证据随行落库；n<30 → descriptive 无 p', async () => {
  const note = await classify({ statement: '端到端 L2 文本基率', checklist: ck({ L2: yes4() }),
    evidence: { baseRateNote: '历史占比：共 149/331（pre-cutoff 已发布口径）' } });
  assert.equal(note.body.gate, 'scored');
  assert.equal(note.body.prob, 0.450151);
  const ev = store.getIntakeQuestion(note.body.intake_question_id);
  assert.equal(ev.evidence[0].baseRateNote, '历史占比：共 149/331（pre-cutoff 已发布口径）', '证据随行落库');
  const short = await classify({ statement: '端到端 L2 样本不足', checklist: ck({ L2: yes4() }), history: Array(29).fill(1) });
  assert.equal(short.body.gate, 'descriptive');
  assert.equal(short.body.prob, null);
  assert.equal(short.body.prob_ci, null);
  assert.equal(short.body.engine_plan.built, true, '引擎已建');
  assert.equal(short.body.engine_plan.predicts, false, '但本题未达标');
  assert.equal(short.body.engine_result.status, 'insufficient_data');
  assertProbOnlyWhenScored(short.body, 'L2 insufficient');
});

test('端到端：L5 认证源 → scored（分布落 note）；无声明 → unsupported 且 descriptive', async () => {
  const r = await classify({ statement: '端到端 L5：认证摇号第 3 号', checklist: ck({ L5: yes3() }),
    evidence: { certifiedSource: { id: 'official-rng', kind: 'uniform', n: 6, target: 'outcome_3' } } });
  assert.equal(r.body.layer, 'L5');
  assert.equal(r.body.gate, 'scored');
  assert.equal(r.body.prob, 0.166666667);
  assert.equal(r.body.engine_plan.predicts, true);
  assert.equal(scanForbiddenAssertions(JSON.stringify(r.body.engine_result)).length, 0, 'L5 输出无断言');
  const q = store.getIntakeQuestion(r.body.intake_question_id);
  assert.match(q.engine_note, /"outcomes"/, '公布分布随 note 落库');
  assertProbOnlyWhenScored(r.body, 'L5 scored');
  const noSrc = await classify({ statement: '端到端 L5 无源', checklist: ck({ L5: yes3() }) });
  assert.equal(noSrc.body.gate, 'descriptive');
  assert.equal(noSrc.body.prob, null);
  assert.equal(noSrc.body.engine_result.status, 'unsupported');
  assertProbOnlyWhenScored(noSrc.body, 'L5 no source');
});

test('口径护栏①（端到端批量）：未接线/未达标层不得出现概率', async () => {
  const cases = [
    { over: { L2: yes4() }, tag: 'L2 无基率' },
    { over: { L3: yes4() }, tag: 'L3 未解禁', extra: { base_rate: { k: 30, n: 100 } } },
    { over: { L1: yes4() }, tag: 'L1' },
    { over: { L6: yes4() }, tag: 'L6' },
    { over: {}, tag: 'unknown' },
  ];
  for (const c of cases) {
    const payload = Object.assign({ statement: '护栏① ' + c.tag, checklist: ck(c.over) }, c.extra || {});
    const r = await classify(payload);
    assertProbOnlyWhenScored(r.body, c.tag);
    assert.equal(r.body.gate, 'descriptive', c.tag + ' 必须 descriptive');
  }
});

// ── 6. intake_questions additive 列与迁移 ───────────────────────────────────
test('additive 列：新库 PRAGMA 见 prob/prob_ci/engine_note；prob 越界入参被拒', () => {
  const conn = db.getConnection();
  const cols = conn.prepare('PRAGMA table_info(intake_questions)').all().map((c) => c.name);
  for (const c of ['prob', 'prob_ci', 'engine_note']) assert.ok(cols.indexOf(c) !== -1, '缺列 ' + c);
  const i = cols.indexOf('engine');
  assert.deepEqual(cols.slice(i + 1, i + 4), ['prob', 'prob_ci', 'engine_note'], '新列紧随 engine 声明');
  const legacy = ['id', 'statement', 'resolve_spec', 'layer', 'secondary_layer', 'gate', 'checklist_hash', 'engine',
    'created_at', 'resolved_at', 'outcome', 'evidence', 'intake_reject_id'];
  assert.deepEqual(cols.filter((c) => legacy.indexOf(c) !== -1), legacy, '既有 13 列位序逐位不变（additive）');
  assert.throws(() => store.insertIntakeQuestion({ statement: '越界 prob', prob: 1.5 }), /prob 必须是/);
  assert.throws(() => store.insertIntakeQuestion({ statement: '越界 prob2', prob: -0.1 }), /prob 必须是/);
});

test('additive 迁移：旧库无三列 → ensureIntakeTables 自动 ALTER 补齐（幂等、不动既有数据）', () => {
  const conn = db.getConnection();
  const before = store.listIntakeQuestions({ limit: 1 }).total;
  assert.ok(before > 0, '前序用例确有落行数据');
  conn.exec('DROP TABLE intake_questions');
  conn.exec('CREATE TABLE intake_questions (id INTEGER PRIMARY KEY, statement TEXT NOT NULL, resolve_spec TEXT, '
    + 'layer TEXT, secondary_layer TEXT, gate TEXT, checklist_hash TEXT, engine TEXT, '
    + "created_at TEXT DEFAULT (datetime('now')), resolved_at TEXT, outcome TEXT, evidence TEXT, intake_reject_id INTEGER)");
  const pre = conn.prepare('PRAGMA table_info(intake_questions)').all().map((c) => c.name);
  assert.equal(pre.indexOf('prob'), -1, '模拟旧库：确无新列');
  store.ensureIntakeTables(conn);
  store.ensureIntakeTables(conn); // 幂等
  const post = conn.prepare('PRAGMA table_info(intake_questions)').all().map((c) => c.name);
  for (const c of ['prob', 'prob_ci', 'engine_note']) assert.ok(post.indexOf(c) !== -1, '迁移后仍缺 ' + c);
  assert.deepEqual(post.slice(-3), ['prob', 'prob_ci', 'engine_note'], 'ALTER 路径新列追加在尾部');
  const rec = store.insertIntakeQuestion({ statement: '迁移后新行', layer: 'L2', gate: 'scored', prob: 0.3, probCi: [0.21, 0.39], engineNote: 'note-x' });
  assert.equal(store.getIntakeQuestion(rec.id).prob, 0.3);
  assert.deepEqual(store.getIntakeQuestion(rec.id).prob_ci, [0.21, 0.39]);
  assert.equal(store.getIntakeQuestion(rec.id).engine_note, 'note-x');
});
