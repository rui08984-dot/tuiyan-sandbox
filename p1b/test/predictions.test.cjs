'use strict';
/**
 * p1b/test/predictions.test.cjs —— 预测卡 L0 账本测试（第十棒 W1）。
 * 铁律：不起真端口（app.inject）；DB=:memory:；LLM 全 mock（零网络）。
 * 覆盖：落注校验（prob 数值门/口语拒收/越界 400）、分页、resolve 真值回填
 *（ambiguous 必附 note、账本不可变 409）、unresolved 清单、L0 gate 字段、
 * 验证点自动落卡（真实 advise 链路 + converter 单元口径：support/oppose 并集去重前 3、
 * oppose-only、resolves 越界 skip、无 prob → assigned_prob NULL、UNIQUE 幂等跳过）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const { convertCheckpointsToPredictions } = require('../src/db/predictionsStore');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-pred-providers-' + process.pid + '-' + Date.now() + '.json');
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
const gameUrl = (id, suffix) => '/api/games/' + id + (suffix || '');
async function waitTask(taskId) {
  for (let i = 0; i < 100; i++) {
    const r = await app.inject({ method: 'GET', url: '/api/tasks/' + taskId });
    assert.equal(r.statusCode, 200);
    const b = j(r);
    if (b.status !== 'running') return b;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error('task ' + taskId + ' 轮询超时（状态未离开 running）');
}

// ── 落注（POST /api/games/:id/predictions）──
let gameA = null, pred1 = null, predEv = null, pred3 = null, pred4 = null, evIdA = null;

test('建局 A（落注与 resolve 主场）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '预测局A', type: 'werewolf', player_count: 6 } });
  assert.equal(r.statusCode, 201);
  gameA = j(r).game;
});

test('POST 落注：201 + 默认 source_type=预测卡 + day 默认账本最新天（无事件=0）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: 'S1：1号是狼', prob: 0.7 } });
  assert.equal(r.statusCode, 201);
  pred1 = j(r);
  assert.equal(pred1.source_type, '预测卡');
  assert.equal(pred1.day, 0);
  assert.equal(pred1.assigned_prob, 0.7);
  assert.equal(pred1.outcome, null);
  assert.deepEqual(pred1.evidence, []);
  assert.ok(pred1.created_at);
});

test('POST 落注 prob 口语/字符串 → 400 且提示澄清为数值', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: 'S?', prob: '大概率' } });
  assert.equal(r.statusCode, 400);
  assert.match(j(r).error, /澄清/);
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: 'S?', prob: '0.7' } });
  assert.equal(r.statusCode, 400);
});

test('POST 落注 prob 越界（1.5 / -0.1）→ 400', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: 'S?', prob: 1.5 } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: 'S?', prob: -0.1 } });
  assert.equal(r.statusCode, 400);
});

test('POST 落注 statement 缺失 → 400；day 非法 → 400', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { prob: 0.5 } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: 'S?', prob: 0.5, day: -1 } });
  assert.equal(r.statusCode, 400);
});

test('POST 落注 局不存在 → 404', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games/999999/predictions', payload: { statement: 'S?', prob: 0.5 } });
  assert.equal(r.statusCode, 404);
});

test('POST 落注 evidence：合法事件 id → 201 读回；悬空 id → 400', async () => {
  const m = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/macro'), payload: { kind: 'claim_role', seat: 2, role: '预言家', day: 1 } });
  assert.equal(m.statusCode, 200);
  const c = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/confirm'), payload: j(m) });
  assert.equal(c.statusCode, 201);
  evIdA = j(c).event_id;
  let r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: 'S2：明天有对跳', prob: 0.4, evidence: [evIdA] } });
  assert.equal(r.statusCode, 201);
  predEv = j(r);
  assert.deepEqual(predEv.evidence, [evIdA]);
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: 'S2b', prob: 0.4, evidence: [evIdA, 99999999] } });
  assert.equal(r.statusCode, 400);
  assert.match(j(r).error, /不存在/);
});

test('POST 落注再补两条（供分页与 resolve）', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: 'S3', prob: 0.3 } });
  assert.equal(r.statusCode, 201);
  pred3 = j(r);
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: 'S4', prob: 0.9 } });
  assert.equal(r.statusCode, 201);
  pred4 = j(r);
});

// ── 分页清单 ──
test('GET 分页：limit/offset/total + 新→旧倒序', async () => {
  let r = await app.inject({ method: 'GET', url: gameUrl(gameA.id, '/predictions?limit=2') });
  assert.equal(r.statusCode, 200);
  let b = j(r);
  assert.equal(b.game_id, gameA.id);
  assert.equal(b.total, 4);
  assert.equal(b.limit, 2);
  assert.equal(b.offset, 0);
  assert.equal(b.items[0].id, pred4.id);
  assert.equal(b.items[1].id, pred3.id);
  r = await app.inject({ method: 'GET', url: gameUrl(gameA.id, '/predictions?limit=2&offset=2') });
  b = j(r);
  assert.equal(b.items[0].id, predEv.id);
  assert.equal(b.items[1].id, pred1.id);
});

test('GET 分页 局不存在 → 404', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/games/999999/predictions' });
  assert.equal(r.statusCode, 404);
});

// ── resolve 真值回填 ──
test('POST resolve true → 200 resolved_at 落格', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/predictions/' + pred1.id + '/resolve', payload: { outcome: 'true' } });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.outcome, 'true');
  assert.ok(b.resolved_at);
});

test('POST resolve 已 resolve → 409（账本不可变）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/predictions/' + pred1.id + '/resolve', payload: { outcome: 'false' } });
  assert.equal(r.statusCode, 409);
  // ★2026-08-28 T1（M7）：断言的**意图**是「必须告知账本不可改」，
  //   不是锁死「不可变」这三个字——措辞改成了「不可改——这正是它可信的原因」，
  //   并去掉了指向死胡同的「另开修正记录」（后端无 amend 接口）。
  //   故此处匹配「不可变｜不可改」二者之一，并加一条「不得指向不存在的路」。
  assert.match(j(r).error, /不可变|不可改/);
  assert.equal(/另开修正记录/.test(j(r).error), false,
    '★409 文案不得再指向不存在的修正入口（无 amend 接口）——那是死胡同');
});

test('POST resolve ambiguous：无 note → 400；带 note → 200（歧义不硬判）', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/predictions/' + predEv.id + '/resolve', payload: { outcome: 'ambiguous' } });
  assert.equal(r.statusCode, 400);
  assert.match(j(r).error, /歧义/);
  r = await app.inject({ method: 'POST', url: '/api/predictions/' + predEv.id + '/resolve', payload: { outcome: 'ambiguous', note: '判定标准歧义：对跳定义存在两种解读' } });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.outcome, 'ambiguous');
  assert.ok(b.resolve_note);
});

test('POST resolve 非法 outcome → 400；不存在 → 404；非整数 id → 400', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/predictions/' + pred3.id + '/resolve', payload: { outcome: 'maybe' } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: 'POST', url: '/api/predictions/99999999/resolve', payload: { outcome: 'true' } });
  assert.equal(r.statusCode, 404);
  r = await app.inject({ method: 'POST', url: '/api/predictions/abc/resolve', payload: { outcome: 'true' } });
  assert.equal(r.statusCode, 400);
});

test('GET unresolved：只含未 resolve 行 + l0_gate 门禁字段', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/predictions/unresolved' });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  const ids = b.items.map((x) => x.id);
  assert.ok(ids.indexOf(pred3.id) !== -1);
  assert.ok(ids.indexOf(pred4.id) !== -1);
  assert.equal(ids.indexOf(pred1.id), -1, '已 resolve true 不在清单');
  assert.equal(ids.indexOf(predEv.id), -1, '已 resolve ambiguous 不在清单');
  assert.equal(b.total, 2);
  assert.equal(b.l0_gate.review_unlocked, false);
  assert.match(b.l0_gate.gate, /只记不评/);
});

// ── 验证点自动落卡（真实 advise 链路，MOCK）──
let gameC = null, cpCount = 0;
test('验证点自动落卡：advise 后 checkpoint → predictions（验证点行 + cp_predictions 统计）', async () => {
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '预测局C', type: 'werewolf', player_count: 6 } });
  gameC = j(g).game;
  const m = await app.inject({ method: 'POST', url: gameUrl(gameC.id, '/events/macro'), payload: { kind: 'claim_role', seat: 2, role: '预言家', day: 1 } });
  assert.equal(m.statusCode, 200);
  const c = await app.inject({ method: 'POST', url: gameUrl(gameC.id, '/events/confirm'), payload: j(m) });
  assert.equal(c.statusCode, 201);
  const a = await app.inject({ method: 'POST', url: gameUrl(gameC.id, '/day/1/advise') });
  assert.equal(a.statusCode, 202);
  const b = await waitTask(j(a).task_id);
  assert.equal(b.status, 'done');
  const card = b.card;
  assert.ok(Array.isArray(card.checkpoints) && card.checkpoints.length >= 1);
  assert.equal(card.cp_predictions.ok, true);
  assert.equal(card.cp_predictions.inserted, card.checkpoints.length);
  const r = await app.inject({ method: 'GET', url: gameUrl(gameC.id, '/predictions') });
  assert.equal(r.statusCode, 200);
  const list = j(r);
  const cps = list.items.filter((x) => x.source_type === '验证点');
  cpCount = cps.length;
  assert.equal(cpCount, card.checkpoints.length);
  const texts = card.checkpoints.map((cp) => cp.text);
  for (const row of cps) {
    assert.ok(texts.indexOf(row.statement) !== -1, 'statement=checkpoint.text');
    assert.equal(row.day, 1);
    assert.equal(row.assigned_prob, null, '引擎 checkpoint 无 prob 字段 → NULL');
    assert.ok(Array.isArray(row.evidence) && row.evidence.length <= 3, 'evidence top-3');
    for (const id of row.evidence) assert.ok(Number.isInteger(id));
  }
});

test('验证点落卡幂等：重复结算同天同 statement → UNIQUE 跳过不重复落', async () => {
  const a = await app.inject({ method: 'POST', url: gameUrl(gameC.id, '/day/1/advise') });
  assert.equal(a.statusCode, 202);
  const b = await waitTask(j(a).task_id);
  assert.equal(b.status, 'done');
  assert.equal(b.card.cp_predictions.ok, true);
  assert.equal(b.card.cp_predictions.inserted, 0);
  assert.equal(b.card.cp_predictions.skipped, b.card.checkpoints.length);
  const r = await app.inject({ method: 'GET', url: gameUrl(gameC.id, '/predictions') });
  const list = j(r);
  const cps = list.items.filter((x) => x.source_type === '验证点');
  assert.equal(cps.length, cpCount, '行数不变');
});

// ── converter 单元口径（队长核实：evidence=support/oppose 并集去重前 3）──
test('converter 单元：并集去重前3 + oppose-only + 越界skip + prob 透传 + UNIQUE 幂等', async () => {
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '预测局U', type: 'werewolf', player_count: 5 } });
  const gameU = j(g).game;
  const card = {
    hypotheses: [
      { content: 'H0', support_events: [101, 102], oppose_events: [103] },
      { content: 'H1', support_events: [], oppose_events: [201] },
    ],
    checkpoints: [
      { text: 'CP1 并集去重前3', resolves: [0] },
      { text: 'CP2 oppose-only', resolves: [1] },
      { text: 'CP3 resolves 越界应skip', resolves: [99] },
      { text: 'CP4 带prob透传', resolves: [0], prob: 0.55 },
    ],
  };
  const r1 = convertCheckpointsToPredictions({ gameId: gameU.id, day: 2, card });
  assert.equal(r1.inserted, 3);
  assert.equal(r1.skipped, 1);
  const rows = db.getConnection().prepare("SELECT statement, assigned_prob, evidence_json FROM predictions WHERE game_id = ? AND day = 2 AND source_type = '验证点'").all(gameU.id);
  const byText = {};
  for (const row of rows) byText[row.statement] = row;
  assert.equal(byText['CP1 并集去重前3'].evidence_json, JSON.stringify([101, 102, 103]));
  assert.equal(byText['CP1 并集去重前3'].assigned_prob, null);
  assert.equal(byText['CP2 oppose-only'].evidence_json, JSON.stringify([201]));
  assert.equal(byText['CP4 带prob透传'].assigned_prob, 0.55);
  assert.equal(byText['CP3 resolves 越界应skip'], undefined);
  const r2 = convertCheckpointsToPredictions({ gameId: gameU.id, day: 2, card });
  assert.equal(r2.inserted, 0);
  assert.equal(r2.skipped, 4);
});
