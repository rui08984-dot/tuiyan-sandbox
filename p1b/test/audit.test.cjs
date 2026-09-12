'use strict';
/**
 * p1b/test/audit.test.cjs —— 万物审计器仪表盘聚合端点测试（G1 反馈 #3 · M2）。
 * 覆盖：200 形状（l0_gate 双口径字段/by_layer_checklist/by_gate/note）、空表不炸、
 * layer×checklist_hash 分组计数正确、tautology=1 组内计数、gate 分组计数、
 * resolve 后 resolved/unresolved 联动。
 * 铁律：不起真端口（app.inject）；DB=:memory:；零网络零 LLM。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const { resolvePrediction } = require('../src/db/predictionsStore');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-audit-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
});

test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

const j = (r) => r.json();

// ── 1. 空表不炸 + 200 形状（先于任何插入，node:test 文件内顺序执行）──
test('GET /api/audit/summary：空账本 → 200 不炸，结构齐全且计数归零', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/audit/summary' });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'] || '', /application\/json/);
  const b = j(r);
  assert.ok(b.l0_gate && typeof b.l0_gate === 'object', 'l0_gate 在');
  assert.ok(Array.isArray(b.by_layer_checklist), 'by_layer_checklist 是数组');
  assert.ok(Array.isArray(b.by_gate), 'by_gate 是数组');
  assert.equal(b.by_layer_checklist.length, 0, '空账本 → 无分组行');
  assert.equal(b.by_gate.length, 0, '空账本 → 无 gate 行');
  assert.equal(b.total, 0);
  assert.equal(b.l0_gate.records, 0);
  assert.equal(b.l0_gate.records_valid, 0);
  assert.equal(b.l0_gate.games, 0);
  assert.equal(b.l0_gate.resolved, 0);
  assert.equal(b.l0_gate.unresolved, 0);
  assert.equal(b.l0_gate.review_unlocked, false);
  assert.ok(typeof b.generated_at === 'string' && b.generated_at.length > 0, 'generated_at 在');
  assert.match(b.note, /只记不评/);
});

// ── 2. 造数：1 局 6 条（含 NULL 审计列组、tautology=1、gate=scored 各一组）──
let gameId = null;
const rows = {};

test('造数：建局 + 6 条分层账本记录', async () => {
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '审计聚合测试局', type: 'werewolf', player_count: 6 } });
  assert.equal(g.statusCode, 201);
  gameId = j(g).game.id;
  const ins = async (payload) => {
    const r = await app.inject({ method: 'POST', url: '/api/games/' + gameId + '/predictions', payload });
    assert.equal(r.statusCode, 201);
    return j(r);
  };
  // 落注走 HTTP 契约面（statement+prob 必填）；审计列不在落注面（route 不收）——
  // 分类是元数据，走 store.updateAuditFields 落注后补录（p16 M2 先例，断言补录生效）。
  rows.a1 = await ins({ statement: 'A1 L2/v2', prob: 0.5 });
  rows.a2 = await ins({ statement: 'A2 L2/v2', prob: 0.6 });
  rows.a3 = await ins({ statement: 'A3 L2/v1', prob: 0.4 });
  rows.a4 = await ins({ statement: 'A4 L6/v1', prob: 0.7 });
  rows.a5 = await ins({ statement: 'A5 无审计字段', prob: 0.5 }); // 不补录：layer/checklist_hash/gate 全 NULL
  rows.a6 = await ins({ statement: 'A6 L2/v2 重言', prob: 0.9 });
  const { updateAuditFields, updateTautology } = require('../src/db/predictionsStore');
  const r1 = updateAuditFields(rows.a1.id, { layer: 'L2', checklistHash: 'v2', gate: 'descriptive' });
  assert.equal(r1.layer, 'L2', '补录 layer 生效');
  assert.equal(r1.checklist_hash, 'v2', '补录 checklist_hash 生效');
  updateAuditFields(rows.a2.id, { layer: 'L2', checklistHash: 'v2', gate: 'descriptive' });
  updateAuditFields(rows.a3.id, { layer: 'L2', checklistHash: 'v1', gate: 'descriptive' });
  updateAuditFields(rows.a4.id, { layer: 'L6', checklistHash: 'v1', gate: 'scored' });
  updateAuditFields(rows.a6.id, { layer: 'L2', checklistHash: 'v2', gate: 'descriptive' });
  assert.equal(j((await app.inject({ method: 'GET', url: '/api/audit/summary' }))).total, 6, 'total=6');
  assert.equal(updateTautology(rows.a6.id, 1).tautology, 1, 'A6 置 tautology=1');
});

// ── 3. layer×checklist_hash 分组计数 + tautology 组内计数 ──
test('分组计数：layer×checklist_hash 三组齐全，组内 n 与 tautology_n 正确', async () => {
  const b = j(await app.inject({ method: 'GET', url: '/api/audit/summary' }));
  const find = (layer, hash) => b.by_layer_checklist.find(
    (r) => r.layer === layer && r.checklist_hash === hash
  );
  const l2v2 = find('L2', 'v2');
  assert.ok(l2v2, 'L2×v2 组在');
  assert.equal(l2v2.n, 3, 'L2×v2 n=3（a1/a2/a6）');
  assert.equal(l2v2.tautology_n, 1, 'L2×v2 组内 tautology=1 计数=1（仅 a6）');
  const l2v1 = find('L2', 'v1');
  assert.ok(l2v1, 'L2×v1 组在');
  assert.equal(l2v1.n, 1);
  assert.equal(l2v1.tautology_n, 0);
  const l6v1 = find('L6', 'v1');
  assert.ok(l6v1, 'L6×v1 组在');
  assert.equal(l6v1.n, 1);
  assert.equal(l6v1.tautology_n, 0);
  const nullGroup = b.by_layer_checklist.find((r) => r.layer === null && r.checklist_hash === null);
  assert.ok(nullGroup, 'NULL 审计列组在（未分层原样返回 null）');
  assert.equal(nullGroup.n, 1);
  assert.equal(nullGroup.tautology_n, 0);
  assert.equal(b.by_layer_checklist.length, 4, '共 4 个分组行');
});

// ── 4. gate 分组计数 ──
test('gate 分组：descriptive/scored/NULL 三组计数正确', async () => {
  const b = j(await app.inject({ method: 'GET', url: '/api/audit/summary' }));
  const gate = (g) => b.by_gate.find((r) => r.gate === g);
  assert.equal(gate('descriptive').n, 4, 'descriptive=4');
  assert.equal(gate('scored').n, 1, 'scored=1');
  assert.equal(gate(null).n, 1, 'gate NULL 组=1');
  assert.equal(b.by_gate.length, 3);
  assert.equal(b.by_gate.reduce((s, r) => s + r.n, 0), 6, '各 gate 组之和=总账');
});

// ── 5. l0_gate 双口径字段在且与 store 直调一致 ──
test('l0_gate 双口径：records/records_valid/resolved/unresolved/games/review_unlocked 字段在且数值正确', async () => {
  const b = j(await app.inject({ method: 'GET', url: '/api/audit/summary' }));
  const g = b.l0_gate;
  for (const k of ['records', 'records_valid', 'resolved', 'unresolved', 'games', 'review_unlocked', 'gate']) {
    assert.ok(k in g, '字段在: ' + k);
  }
  assert.equal(g.records, 6, '总账=6');
  assert.equal(g.records_valid, 5, '有效口径=5（tautology=1 的 a6 不计入）');
  assert.equal(g.games, 1, '覆盖局数=1');
  assert.equal(g.resolved, 0);
  assert.equal(g.unresolved, 6);
  assert.equal(g.review_unlocked, false, '1 局 6 条远未到门禁（≥30 局 ∧ 有效 ≥200 条）');
  assert.match(g.gate, /只记不评/);
  const { l0Gate } = require('../src/db/predictionsStore');
  assert.deepEqual(
    { r: g.records, rv: g.records_valid, ru: g.review_unlocked },
    { r: l0Gate().records, rv: l0Gate().records_valid, ru: l0Gate().review_unlocked },
    '端点透出值与 store.l0Gate() 直调一致'
  );
});

// ── 6. resolve 联动：真值回填后 resolved/unresolved 联动、分组计数不变 ──
test('resolve 联动：回填 1 条真值 → resolved=1/unresolved=5，layer 分组 n 不变', async () => {
  const rr = resolvePrediction(rows.a1.id, 'true', null);
  assert.ok(rr.ok, 'resolve 成功');
  const b = j(await app.inject({ method: 'GET', url: '/api/audit/summary' }));
  assert.equal(b.l0_gate.resolved, 1);
  assert.equal(b.l0_gate.unresolved, 5);
  assert.equal(b.l0_gate.records, 6, '总账不变');
  assert.equal(b.by_layer_checklist.find((r) => r.layer === 'L2' && r.checklist_hash === 'v2').n, 3, '分组计数不受 resolve 影响');
});
