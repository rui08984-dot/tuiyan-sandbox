'use strict';
/**
 * p1b/test/intake.test.cjs —— 开放接题·最小闭环测试（阶段 3 出口件，2026-09-13）。
 * 覆盖：拒收门三问各一（no_anchor/leak/tautology + 落 intake_rejects）、决策树首命中取最特殊层、
 * unknown 出口（R1-F13）、L4 后置叠加（R1-F1）、分层引擎位映射、gate/checklist_hash 契约、
 * GET /api/intake/rejects 分布（含 0 计数）、输入校验 400、additive 建表幂等。
 * 铁律：不起真端口（app.inject）；DB=:memory:；零网络零 LLM；零写生产库。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const store = require('../src/db/intakeStore');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-intake-providers-' + process.pid + '-' + Date.now() + '.json');
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

/** 默认：过门 + 五层皆非全绿 + L4 未全绿 → 期望 unknown */
function ck(over) {
  return Object.assign({
    Q0_1: true, Q0_2: true, Q0_3: true,
    L5: no3(), L6: no4(), L1: no4(), L3: no4(), L2: no4(), L4: no3(),
  }, over || {});
}
async function classify(payload) {
  const r = await app.inject({ method: 'POST', url: '/api/intake/classify', payload: payload });
  return { status: r.statusCode, body: j(r) };
}

// ── 1. 拒收门三问各一（任一「否」→ rejected + intake_rejects 留痕）────────────────
test('拒收门 Q0-1：无真值锚 → rejected reason=no_anchor，落 intake_rejects', async () => {
  const r = await classify({ statement: '本轮冠军是谁（无第三方可复核真值）', checklist: ck({ Q0_1: false }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, '拒收不是失败：ok 仍 true');
  assert.equal(r.body.rejected, true);
  assert.equal(r.body.reason, 'no_anchor');
  assert.ok(r.body.reject_id > 0, '留痕 id 在');
  assert.equal(r.body.gate, 'descriptive');
  const row = store.getReject(r.body.reject_id);
  assert.equal(row.reason, 'no_anchor');
  assert.equal(row.statement, '本轮冠军是谁（无第三方可复核真值）');
  assert.equal(row.detail.question, 'Q0_1');
  assert.equal(row.detail.checklist_hash, 'v3');
  assert.ok(row.created_at, 'created_at 在');
});

test('拒收门 Q0-2：cutoff 不早于决定性时点 → rejected reason=leak，落 intake_rejects', async () => {
  const r = await classify({ statement: '以落库日当 cutoff 去问历史事件（事后诸葛）', checklist: ck({ Q0_2: false }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.rejected, true);
  assert.equal(r.body.reason, 'leak');
  assert.equal(store.getReject(r.body.reject_id).detail.question, 'Q0_2');
});

test('拒收门 Q0-3：结果恒定（重言式）→ rejected reason=tautology，落 intake_rejects', async () => {
  const r = await classify({ statement: '一夜狼本局首夜平安（无人死亡）', checklist: ck({ Q0_3: false }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.rejected, true);
  assert.equal(r.body.reason, 'tautology');
  assert.equal(store.getReject(r.body.reject_id).detail.question, 'Q0_3');
});

// ── 2. GET rejects 分布（防 Goodhart：含 0 计数）────────────────────────────────
test('GET /api/intake/rejects：三类拒收各 ≥1，枚举原因含 0 计数（分布可见）', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/intake/rejects' });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.ok, true);
  assert.ok(b.total >= 3, '至少 3 条（三条拒收）');
  const find = (k) => b.by_reason.filter((x) => x.reason === k)[0];
  assert.ok(find('no_anchor').n >= 1, 'no_anchor 计数 ≥1');
  assert.ok(find('leak').n >= 1, 'leak 计数 ≥1');
  assert.ok(find('tautology').n >= 1, 'tautology 计数 ≥1');
  assert.equal(find('other').n, 0, 'other 未用但仍出现（0 计数，禁只报非零自掩）');
  assert.equal(b.by_reason.length, 4, '枚举四原因全部列出');
  assert.equal(b.by_reason.reduce((s, x) => s + x.n, 0), b.total, '分布之和=总数');
  assert.ok(Array.isArray(b.items) && b.items.length >= 3, '明细数组在');
  assert.ok(!/预测/.test(b.note), 'UI 文案禁「预测」字样');
});

// ── 3. unknown 出口（R1-F13）────────────────────────────────────────────────────
test('unknown 出口（R1-F13）：五层皆非全绿且无层可归 → layer=unknown（非拒收）', async () => {
  const r = await classify({ statement: '一次性、无反馈、非对抗的人类选择（各层部分命中但无全绿）', checklist: ck() });
  assert.equal(r.status, 200);
  assert.equal(r.body.rejected, false);
  assert.equal(r.body.layer, 'unknown');
  assert.equal(r.body.computed_layer, 'unknown');
  assert.equal(r.body.secondary, null);
  assert.equal(r.body.engine, 'none');
  assert.equal(r.body.engine_plan.built, false);
  assert.equal(r.body.gate, 'descriptive');
  assert.equal(r.body.checklist_hash, 'v3');
});

test('unknown 出口：L3 第 2 问答「未知」→ 该层非全绿，不得归 L3（降级落 unknown）', async () => {
  const r = await classify({ statement: 'L3 第2问无数据', checklist: ck({ L3: [true, 'unknown', true, true] }) });
  assert.equal(r.body.rejected, false);
  assert.equal(r.body.layer, 'unknown', 'L3 含 unknown → 非全绿');
});

// ── 4. 决策树顺序 & 引擎位映射 ──────────────────────────────────────────────────
test('决策树首命中取最特殊层：L5 与 L6 皆全绿 → 归 L5', async () => {
  const r = await classify({ statement: 'L5/L6 同时全绿', checklist: ck({ L5: yes3(), L6: yes4() }) });
  assert.equal(r.body.layer, 'L5');
  assert.equal(r.body.engine, 'certified_dist');
});

test('分层引擎位映射：L1/L2/L3/L5/L6/unknown 各自 engine + calibrator 正确', async () => {
  const cases = [
    { over: { L1: yes4() }, layer: 'L1', engine: 'proc_calc', cal: null, built: false },
    { over: { L2: yes4() }, layer: 'L2', engine: 'stat_baseline', cal: 'wilson', built: true },
    { over: { L3: yes4() }, layer: 'L3', engine: 'stat_baseline', cal: 'aci', built: false },
    { over: { L5: yes3() }, layer: 'L5', engine: 'certified_dist', cal: null, built: true },
    { over: { L6: yes4() }, layer: 'L6', engine: 'structural', cal: null, built: false },
    { over: {}, layer: 'unknown', engine: 'none', cal: null, built: false },
  ];
  for (const c of cases) {
    const r = await classify({ statement: 'engine 映射用例 ' + c.layer, checklist: ck(c.over) });
    assert.equal(r.body.layer, c.layer, c.layer + ' 层判定');
    assert.equal(r.body.engine, c.engine, c.layer + ' engine');
    assert.equal(r.body.engine_plan.calibrator, c.cal, c.layer + ' calibrator');
    assert.equal(r.body.engine_plan.built, c.built, c.layer + ' built（阶段 4 修订：仅 L2/L5 已建引擎）');
    assert.equal(r.body.engine_plan.predicts, false, '未供基率/认证源 ⇒ gate=descriptive 只记账不出数');
  }
});

// ── 5. L4 后置叠加（R1-F1）──────────────────────────────────────────────────────
test('L4 后置叠加（R1-F1）：L2 全绿 + L4 全绿 → primary=L2, secondary=L4（L4 不作 primary）', async () => {
  const r = await classify({ statement: '公开发布的市场点位（人类决策 + 反馈回路）', checklist: ck({ L2: yes4(), L4: yes3() }) });
  assert.equal(r.body.layer, 'L2', 'primary 恒为底层');
  assert.equal(r.body.secondary, 'L4', 'L4 后置标注');
  assert.equal(r.body.engine, 'stat_baseline');
});

test('L4 后置叠加：五层皆非全绿但 L4 全绿 → layer=unknown, secondary=L4（人决策弱自反题有归处）', async () => {
  const r = await classify({ statement: '一次性人类决策、无反馈回路', checklist: ck({ L4: yes3() }) });
  assert.equal(r.body.layer, 'unknown');
  assert.equal(r.body.secondary, 'L4');
});

test('L4 不可作 primary：decided_layer=L4 → 400（R1-F1 语义护栏）', async () => {
  const r = await classify({ statement: 'x', checklist: ck(), decided_layer: 'L4' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /L4 是叠加层不作 primary/);
});

// ── 6. 人工定层 + 输入校验 ─────────────────────────────────────────────────────
test('decided_layer 人工定层：与机判并存，返回 computed_layer 供对账', async () => {
  const r = await classify({ statement: '人工定层用例', checklist: ck({ L2: yes4() }), decided_layer: 'L1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.layer, 'L1', '采用人工定层');
  assert.equal(r.body.computed_layer, 'L2', '机判层仍透出对账');
  assert.equal(r.body.decided_by, 'human');
  assert.equal(r.body.engine, 'proc_calc', '引擎位跟最终层');
});

test('输入校验 400：缺 statement / 缺 checklist / 缺树层 / 长度错 / 非法三态 / 非法 secondary', async () => {
  const bad = [
    { statement: '', checklist: ck() },
    { statement: 'x' },
    { statement: 'x', checklist: (() => { const c = ck(); delete c.L3; return c; })() },
    { statement: 'x', checklist: ck({ L6: [true, true] }) },
    { statement: 'x', checklist: ck({ Q0_1: 'maybe' }) },
    { statement: 'x', checklist: ck({ L2: yes4() }), secondary: 'L9' },
  ];
  for (const p of bad) {
    const r = await classify(p);
    assert.equal(r.status, 400, '应 400: ' + JSON.stringify(p).slice(0, 60));
  }
});

test('字符串三态可用：yes/no/unknown 归一（过门 + 全绿判定）', async () => {
  const r = await classify({ statement: '字符串形态填表', checklist: ck({ Q0_1: 'yes', Q0_2: 'yes', Q0_3: 'yes', L2: ['yes', 'yes', 'yes', 'yes'] }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.layer, 'L2');
});

// ── 7. store 层：additive 建表 + 非法 reason ──────────────────────────────────
test('intakeStore：ensure 幂等建表；insertReject 非法 reason 抛错；不存在 id → null', () => {
  const conn = db.getConnection();
  store.ensureIntakeTable(conn);
  store.ensureIntakeTable(conn); // 幂等
  const cols = conn.prepare('PRAGMA table_info(intake_rejects)').all().map((c) => c.name);
  assert.deepEqual(cols, ['id', 'statement', 'reason', 'detail', 'created_at']);
  assert.throws(() => store.insertReject({ statement: 'x', reason: 'yolo' }), /reason 必须是/);
  assert.throws(() => store.insertReject({ statement: '', reason: 'leak' }), /statement/);
  assert.equal(store.getReject(999999), null);
});

test('intakeStore additive 迁移：旧库无 intake_rejects → ensure 建表，旧数据不动', () => {
  const conn = db.getConnection();
  const before = store.rejectStats().total;
  conn.exec('DROP TABLE intake_rejects');
  store.ensureIntakeTable(conn);
  assert.equal(store.rejectStats().total, 0, '新表从 0 起');
  assert.ok(before >= 3, 'drop 前确有留痕数据（说明前序用例真的写了库）');
  const rec = store.insertReject({ statement: '迁移后新行', reason: 'other', detail: { note: 'x' } });
  assert.ok(rec.id > 0);
  assert.equal(store.getReject(rec.id).detail.note, 'x');
});

// ── 8. D-8.2 / D-8.1（design §8）：接题通过落 intake_questions + 只读归一视图 ─────────
test('D-8.2：classify 通过 → 落 intake_questions（题面/resolve_spec/layer/engine/gate/checklist_hash）', async () => {
  const r = await classify({
    statement: 'D-8.2 落行用例：2026-09-12 北京最高气温 > 30°C',
    resolve_spec: { kind: 'official_stat', field: 'daily_high_temp', threshold: 30, cmp: 'gt', date: '2026-09-12' },
    checklist: ck({ L3: yes4() }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.intake_ledger, 'intake_questions', '响应标注落哪张表');
  assert.ok(r.body.intake_question_id > 0, '返回接题行 id');
  const q = store.getIntakeQuestion(r.body.intake_question_id);
  assert.equal(q.layer, 'L3');
  assert.equal(q.engine, 'stat_baseline');
  assert.equal(q.gate, 'descriptive');
  assert.equal(q.checklist_hash, 'v3');
  assert.equal(q.resolve_spec.kind, 'official_stat');
  assert.equal(q.resolve_spec.threshold, 30, 'resolve_spec JSON 往返');
  assert.equal(q.secondary_layer, null);
  assert.equal(q.outcome, null, '未 resolve');
  assert.equal(q.intake_reject_id, null);
});

test('D-8.1：unknown 落 intake_questions，但**不**进 predictions（layer CHECK 未放开）', async () => {
  const stmt = 'D-8.1 unknown 用例：一次性人类决策、五层皆非全绿';
  const r = await classify({ statement: stmt, checklist: ck({ L4: yes3() }) });
  assert.equal(r.body.layer, 'unknown');
  assert.equal(r.body.secondary, 'L4');
  assert.ok(r.body.intake_question_id > 0);
  const q = store.getIntakeQuestion(r.body.intake_question_id);
  assert.equal(q.layer, 'unknown', 'intake_questions 允许 unknown');
  assert.equal(q.secondary_layer, 'L4');
  const conn = db.getConnection();
  assert.equal(conn.prepare('SELECT COUNT(*) n FROM predictions WHERE statement = ?').get(stmt).n, 0, 'unknown 未写入 predictions');
  assert.equal(conn.prepare('SELECT COUNT(*) n FROM intake_questions WHERE statement = ?').get(stmt).n, 1, 'unknown 写入 intake_questions');
});

test('D-8.1：predictions_r4 视图形状 = predictions ∪ intake_questions（origin 区分，只读）', async () => {
  const conn = db.getConnection();
  const names = conn.prepare('PRAGMA table_info(predictions_r4)').all().map((c) => c.name);
  assert.deepEqual(names, ['origin', 'id', 'game_id', 'statement', 'resolve_spec', 'layer', 'secondary_layer',
    'gate', 'checklist_hash', 'engine', 'source_type', 'assigned_prob', 'evidence_json', 'g2_regime',
    'matures_at', 'tautology', 'created_at', 'resolved_at', 'outcome', 'resolve_note', 'intake_reject_id'], '统一列形状');
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'D-8.1 视图局', type: 'werewolf', player_count: 6 } });
  const gid = j(g).game.id;
  await app.inject({ method: 'POST', url: '/api/games/' + gid + '/predictions', payload: { statement: '视图 predictions 侧用例', prob: 0.5 } });
  const byOrigin = conn.prepare('SELECT origin, COUNT(*) n FROM predictions_r4 GROUP BY origin').all();
  const map = {}; for (const x of byOrigin) map[x.origin] = x.n;
  assert.ok(map.predictions >= 1, 'predictions 侧在视图里');
  assert.ok(map.intake_questions >= 2, 'intake_questions 侧在视图里');
  const qrow = conn.prepare("SELECT origin, layer, g2_regime, tautology, resolve_spec FROM predictions_r4 WHERE origin='intake_questions' AND layer='unknown' LIMIT 1").get();
  assert.ok(qrow, '视图里能找到 unknown 接题行');
  assert.equal(qrow.g2_regime, null, '接题行 g2_regime 归一为 NULL（不进 G2 行域）');
  assert.equal(qrow.tautology, 0, '接题行 tautology 归一为 0');
  const rs = conn.prepare("SELECT resolve_spec FROM predictions_r4 WHERE origin='intake_questions' AND statement = ? LIMIT 1").get('D-8.2 落行用例：2026-09-12 北京最高气温 > 30°C');
  assert.ok(rs && rs.resolve_spec, '接题行带 resolve_spec（D-8.2 用例行）');
  const pRow = conn.prepare("SELECT origin, resolve_spec, intake_reject_id FROM predictions_r4 WHERE origin='predictions' LIMIT 1").get();
  assert.ok(pRow, 'predictions 侧在视图里');
  assert.equal(pRow.resolve_spec, null, 'predictions 行无 resolve_spec（归一 NULL）');
});

// ── 9. 只读接题库列表（UI 接题页数据源；只读零写）──────────────────────────────
test('GET /api/intake/questions：只读列表（最新 N 条、含 prob 字段、id 降序），零写', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/intake/questions?limit=5' });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.ok, true);
  assert.ok(b.total >= 3, '至少含前序 classify 通过行');
  assert.ok(Array.isArray(b.items) && b.items.length <= 5, 'limit 生效');
  const lim = j(await app.inject({ method: 'GET', url: '/api/intake/questions?limit=1' }));
  assert.equal(lim.items.length, 1);
  for (const k of ['id', 'statement', 'layer', 'gate', 'prob', 'created_at']) assert.ok(k in lim.items[0], '字段在: ' + k);
  const all = j(await app.inject({ method: 'GET', url: '/api/intake/questions?limit=100' }));
  for (let i = 1; i < all.items.length; i++) assert.ok(all.items[i - 1].id > all.items[i].id, 'id 降序（最新在前）');
  const conn = db.getConnection();
  const before = conn.prepare('SELECT COUNT(*) n FROM intake_questions').get().n;
  await app.inject({ method: 'GET', url: '/api/intake/questions' });
  assert.equal(conn.prepare('SELECT COUNT(*) n FROM intake_questions').get().n, before, '只读不写');
  assert.ok(!/预测/.test(b.note), 'UI 文案禁「预测」字样');
});
