'use strict';
/**
 * p1b/test/verdicts.test.cjs —— W2 多路判词+校准 API 测试（node:test + fastify inject）。
 * 铁律：不起真端口；DB=:memory:；LLM 全 mock（零网络）。
 * 覆盖：POST verdicts 3 路全量落库（variant×温度配对 + implied_prob 机械抽取）、
 * 幂等（OR IGNORE 保首条）、pid 跨局/不存在 404、extractImpliedProb 契约单元、
 * calibration（n<30 数据不足；ambiguous 与 NULL prob 剔除；ECE 数值强校验+10 桶+分层）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const { extractImpliedProb, ROUTES } = require('../src/routes/verdicts');
const predictions = require('../src/db/predictionsStore');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-verdicts-providers-' + process.pid + '-' + Date.now() + '.json');
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

let gameId = null, game2Id = null, pidA = null, pidB = null;

test('建局与落注 fixtures（pidA 主角；pidB 挂第二局供跨局 404）', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '判词局A', type: 'werewolf', player_count: 6 } });
  assert.equal(r.statusCode, 201);
  gameId = j(r).game.id;
  r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '判词局B', type: 'werewolf', player_count: 5 } });
  assert.equal(r.statusCode, 201);
  game2Id = j(r).game.id;
  r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions'), payload: { statement: 'A：明天有对跳', prob: 0.6 } });
  assert.equal(r.statusCode, 201);
  pidA = j(r).id;
  r = await app.inject({ method: 'POST', url: gameUrl(game2Id, '/predictions'), payload: { statement: 'B：3号是狼', prob: 0.4 } });
  assert.equal(r.statusCode, 201);
  pidB = j(r).id;
});

test('POST verdicts（MOCK）：3 路全量落库，variant×温度配对 + implied_prob 机械抽取', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/' + pidA + '/verdicts') });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.mode, 'mock');
  assert.equal(b.saved.length, 3);
  assert.equal(b.errors.length, 0);
  const byVariant = {};
  for (const s of b.saved) byVariant[s.prompt_variant] = s;
  for (const route of ROUTES) {
    assert.ok(byVariant[route.variant], '每路一行: ' + route.variant);
    assert.equal(byVariant[route.variant].temperature, route.temperature);
    assert.equal(byVariant[route.variant].extracted, true, 'mock 末行 P= 可机械抽取');
  }
  assert.equal(byVariant['v1_evidence'].implied_prob, 0.25);
  assert.equal(byVariant['v2_skeptical'].implied_prob, 0.5);
  assert.equal(byVariant['v3_baserate'].implied_prob, 0.75);
});

test('verdict_text 全量落库（不只存聚合值，C 方案 3 原文）+ 末行 P= 格式', async () => {
  const rows = db.getConnection().prepare('SELECT * FROM verdicts WHERE prediction_id = ? ORDER BY id').all(pidA);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok(typeof row.verdict_text === 'string' && row.verdict_text.length > 10);
    assert.match(row.verdict_text, /P=0\.\d\d\s*$/);
    assert.ok(row.created_at);
  }
});

test('POST verdicts 幂等：重复调用保首条（OR IGNORE），行 id 不变', async () => {
  const before = db.getConnection().prepare('SELECT id FROM verdicts WHERE prediction_id = ? ORDER BY id').all(pidA).map((x) => x.id);
  assert.equal(before.length, 3);
  const r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/' + pidA + '/verdicts') });
  assert.equal(r.statusCode, 200);
  assert.equal(j(r).saved.length, 3);
  const after = db.getConnection().prepare('SELECT id FROM verdicts WHERE prediction_id = ? ORDER BY id').all(pidA).map((x) => x.id);
  assert.deepEqual(after, before);
});

test('POST verdicts pid 跨局/不存在/局不存在 → 404', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/' + pidB + '/verdicts') });
  assert.equal(r.statusCode, 404, 'pidB 属 game2，跨局拒');
  r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/99999999/verdicts') });
  assert.equal(r.statusCode, 404);
  r = await app.inject({ method: 'POST', url: '/api/games/999999/predictions/' + pidA + '/verdicts' });
  assert.equal(r.statusCode, 404);
});

test('extractImpliedProb 契约单元：认末行 P=0.xx 小数；拒 %、越界、缺失', () => {
  assert.equal(extractImpliedProb('分析……\nP=0.65'), 0.65);
  assert.equal(extractImpliedProb('分析……\nP=1.0'), 1);
  assert.equal(extractImpliedProb('分析\nP=0'), 0);
  assert.equal(extractImpliedProb('分析\np = 0.42'), 0.42, '小写+空格容忍');
  assert.equal(extractImpliedProb('分析\nP=65%'), null, '百分比不认（契约外格式，宁 NULL 不误抓）');
  assert.equal(extractImpliedProb('分析\nP=1.5'), null, '越界拒');
  assert.equal(extractImpliedProb('没有任何数字'), null);
  assert.equal(extractImpliedProb(''), null);
  assert.equal(extractImpliedProb('P=0.3 不算\n尾行无P'), null, '行尾必须紧跟数值');
});

test('calibration n<30 → 「数据不足」（ambiguous 与 NULL prob 不计数）', async () => {
  for (let i = 0; i < 29; i++) {
    const p = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: 'C' + i, prob: 0.8, evidence: [] });
    predictions.resolvePrediction(p.id, i % 4 === 0 ? 'false' : 'true', '测试真值');
  }
  const amb = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: 'AMB', prob: 0.9, evidence: [] });
  predictions.resolvePrediction(amb.id, 'ambiguous', '歧义留痕不硬判');
  const cp = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '验证点', statement: 'CP-NULL', prob: null, evidence: [] });
  predictions.resolvePrediction(cp.id, 'true', '真值');
  const r = await app.inject({ method: 'GET', url: '/api/predictions/calibration' });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.status, '数据不足');
  assert.equal(b.n, 29, 'ambiguous 与验证点 NULL prob 剔除');
  assert.match(b.note, /只记不评/);
});

test('calibration n≥30 → ok：ECE 强校验（全 0.8）+ 10 桶 + source_type 分层', async () => {
  for (let i = 0; i < 2; i++) {
    const p = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: 'D' + i, prob: 0.8, evidence: [] });
    predictions.resolvePrediction(p.id, 'true', '真值');
  }
  const r = await app.inject({ method: 'GET', url: '/api/predictions/calibration' });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.status, 'ok');
  assert.equal(b.n, 31);
  assert.equal(b.buckets.length, 10);
  const bucket = b.buckets[8]; // prob=0.8 → floor(8)=8 桶 [0.8,0.9)
  assert.equal(bucket.n, 31);
  assert.ok(Math.abs(bucket.mean_prob - 0.8) < 1e-9);
  assert.ok(Math.abs(bucket.true_rate - 23 / 31) < 1e-9, '29 条中 8 false（i%4==0）+2 true = 23/31');
  assert.ok(Math.abs(b.ece - Math.abs(23 / 31 - 0.8)) < 1e-9);
  assert.equal(b.layers['预测卡'].status, 'ok');
  assert.equal(b.layers['预测卡'].n, 31);
  assert.equal(b.layers['验证点'].status, '数据不足', '验证点层 NULL prob 无样本 → 数据不足（宁缺毋滥）');
  assert.match(b.note, /参考/);
  assert.ok(b.l0_gate, 'l0_gate 恒挂');
});
