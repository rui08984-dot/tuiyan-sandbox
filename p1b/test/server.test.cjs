'use strict';
/**
 * p1b/test/server.test.cjs —— P1b-1 后端接口测试（node:test + fastify inject，≥15 用例）。
 * 铁律：不起真端口（app.inject）；DB=:memory:；providers 指向 os.tmpdir() 临时文件；
 * LLM 全 mock（buildServer opts.llmMock=true → mockMode，零网络，绝不外呼真实 API）。
 * 覆盖 P1B-SPEC §3/§4：games 列表/新建/详情/export/state?uptoDay、三宏、extract/confirm、
 * claims/actions edit/retract（retracted 不可见）、advise 异步状态机、providers 脱敏、错误路径。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-providers-' + process.pid + '-' + Date.now() + '.json');
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

// ── 基础 ──
test('GET /api/health：mock 模式 + :memory: db', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.ok, true);
  assert.equal(b.llm_mock, true);
  assert.equal(b.db_path, ':memory:');
});

// ── games ──
let gameA = null, gameB = null, playersA = null;
test('POST /api/games：201 + 自动建席 1..N（默认名=N号）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '测试局A', type: 'werewolf', player_count: 6 } });
  assert.equal(r.statusCode, 201);
  const b = j(r);
  gameA = b.game; playersA = b.players;
  assert.equal(gameA.type, 'werewolf');
  assert.equal(gameA.current_day, 0);
  assert.equal(playersA.length, 6);
  assert.equal(playersA[0].seat, 1);
  assert.equal(playersA[0].name, '1号');
});

test('POST /api/games 第二局（空局，供 advise 预检 400 用）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '测试局B', game_type: 'botc', player_count: 5 } });
  assert.equal(r.statusCode, 201);
  gameB = j(r).game;
});

test('POST /api/games 非法枚举 game_type → 400', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'X', type: 'mahjong', player_count: 4 } });
  assert.equal(r.statusCode, 400);
  assert.match(j(r).error, /game_type/);
});

test('POST /api/games 缺 player_count → 400', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'X', type: 'botc' } });
  assert.equal(r.statusCode, 400);
});

test('GET /api/games/:id：详情含名单', async () => {
  const r = await app.inject({ method: 'GET', url: gameUrl(gameA.id) });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.game.id, gameA.id);
  assert.equal(b.players.length, 6);
});

test('GET /api/games/:id 局不存在 → 404', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/games/999999' });
  assert.equal(r.statusCode, 404);
});

test('GET /api/games/:id 非整数 id → 400', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/games/abc' });
  assert.equal(r.statusCode, 400);
});

// ── §4 三宏：直接结构化构造（不走 LLM）──
let macroCard = null, checkCard = null, goodCard = null;
test('宏 claim_role（跳身份）→ 结构化确认卡 extracted_by=macro', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/macro'), payload: { kind: 'claim_role', seat: 2, role: '预言家', day: 1 } });
  assert.equal(r.statusCode, 200);
  macroCard = j(r);
  assert.equal(macroCard.extracted_by, 'macro');
  assert.equal(macroCard.event.actor_seat, 2);
  assert.equal(macroCard.event.type, 'claim');
  assert.equal(macroCard.claims[0].seat, 2);
  assert.equal(macroCard.claims[0].subject_seat, 2);
  assert.equal(macroCard.claims[0].predicate, 'claims_role');
  assert.equal(macroCard.claims[0].object, '预言家');
  assert.deepEqual(macroCard.actions, []);
});

test('宏 check（查杀）→ is_wolf 指向对象席位', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/macro'), payload: { kind: 'check', seat: 3, target_seat: 5, day: 1 } });
  assert.equal(r.statusCode, 200);
  checkCard = j(r);
  assert.equal(checkCard.claims[0].seat, 3);
  assert.equal(checkCard.claims[0].subject_seat, 5);
  assert.equal(checkCard.claims[0].predicate, 'is_wolf');
  assert.equal(checkCard.claims[0].object, '查杀');
});

test('宏 good（金水）→ is_good 指向对象席位', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/macro'), payload: { kind: 'good', seat: 1, target_seat: 4, day: 1 } });
  assert.equal(r.statusCode, 200);
  goodCard = j(r);
  assert.equal(goodCard.claims[0].predicate, 'is_good');
  assert.equal(goodCard.claims[0].object, '好人');
});

test('宏非法 kind → 400；查杀对象是自己 → 400；对象席位不在名单 → 400', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/macro'), payload: { kind: 'kill', seat: 2, day: 1 } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/macro'), payload: { kind: 'check', seat: 3, target_seat: 3, day: 1 } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/macro'), payload: { kind: 'good', seat: 1, target_seat: 99, day: 1 } });
  assert.equal(r.statusCode, 400);
});

// ── confirm 入账（宏与自由文本同一入库路径）──
let claimC1 = null, claimGood = null;
test('POST /events/confirm：宏卡入账 201（返回 event_id/seq/claim_ids）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/confirm'), payload: macroCard });
  assert.equal(r.statusCode, 201);
  const b = j(r);
  assert.equal(b.ok, true);
  assert.equal(b.claim_ids.length, 1);
  assert.equal(b.seq, 1);
  claimC1 = b.claim_ids[0];
});

test('confirm：金水宏卡入账（供后续修订用）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/confirm'), payload: goodCard });
  assert.equal(r.statusCode, 201);
  claimGood = j(r).claim_ids[0];
  assert.ok(claimGood);
});

test('confirm 非法 phase（noon）→ 400', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/confirm'), payload: { event: { day: 1, phase: 'noon', type: 'statement', actor_seat: 1, raw_text: 'x' }, claims: [] } });
  assert.equal(r.statusCode, 400);
});

test('confirm 非 system 事件缺 actor_seat → 400', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/confirm'), payload: { event: { day: 1, phase: 'day', type: 'statement', raw_text: 'x' }, claims: [] } });
  assert.equal(r.statusCode, 400);
});

test('confirm claim 席位不在名单 → 400', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/confirm'), payload: { event: { day: 1, phase: 'day', type: 'statement', actor_seat: 1, raw_text: 'x' }, claims: [{ seat: 1, subject_seat: 99, predicate: 'said', object: 'x' }] } });
  assert.equal(r.statusCode, 400);
});

// ── extract（LLM 必须 mock，零网络）──
let extractCard = null, extractClaimIds = [];
test('POST /events/extract：meta.mode=MOCK + 确定性拆解', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/extract'), payload: { text: '3号说自己是预言家，说5号是查杀', day: 1, speaker_seat: 3 } });
  assert.equal(r.statusCode, 200);
  extractCard = j(r);
  assert.equal(extractCard.extracted_by, 'llm');
  assert.equal(extractCard.meta.mode, 'MOCK');
  assert.equal(extractCard.event.day, 1);
  assert.equal(extractCard.event.phase, 'day');
  assert.equal(extractCard.event.type, 'claim');
  assert.equal(extractCard.claims.length, 2);
  const predicates = extractCard.claims.map((c) => c.predicate).sort();
  assert.deepEqual(predicates, ['claims_role', 'is_wolf']);
  assert.equal(extractCard.actions.length, 0);
});

test('extract 空文本 → 400', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/extract'), payload: { text: '' } });
  assert.equal(r.statusCode, 400);
});

test('extract 结果 confirm 入账（自由文本与宏同一路径）', async () => {
  const payload = {
    event: Object.assign({}, extractCard.event, { actor_seat: 3 }), // 确认时人工指定发言人
    claims: extractCard.claims.map((c) => Object.assign({}, c, { seat: c.seat || 3 })),
    actions: [],
    extracted_by: 'llm',
  };
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/confirm'), payload: payload });
  assert.equal(r.statusCode, 201);
  extractClaimIds = j(r).claim_ids;
  assert.equal(extractClaimIds.length, 2);
});

// ── claims edit / retract（retracted 不可见）──
test('claims edit：改 object 生效并回显', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/claims/' + claimC1 + '/edit'), payload: { object: '女巫' } });
  assert.equal(r.statusCode, 200);
  assert.equal(j(r).claim.object, '女巫');
});

test('claims edit 三个字段都不给 → 400', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/claims/' + claimC1 + '/edit'), payload: {} });
  assert.equal(r.statusCode, 400);
});

test('claims edit 归属局不符 → 404', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameB.id, '/claims/' + claimC1 + '/edit'), payload: { object: 'x' } });
  assert.equal(r.statusCode, 404);
});

test('claims retract：retracted 行从 state 消失（不可见）', async () => {
  const retractedId = extractClaimIds[1]; // 查杀5号那条
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/claims/' + retractedId + '/retract') });
  assert.equal(r.statusCode, 200);
  assert.equal(j(r).retracted, true);
  const s = await app.inject({ method: 'GET', url: gameUrl(gameA.id, '/state') });
  const ids = j(s).claims.map((c) => c.id);
  assert.ok(!ids.includes(retractedId), '已撤回 claim 不应出现在 state');
  assert.ok(ids.includes(claimC1), '未撤回 claim 应在 state');
  assert.ok(ids.includes(extractClaimIds[0]), '自由文本 claim 应在 state');
});

test('claims retract 后 edit → 409（账本纪律）', async () => {
  const retractedId = extractClaimIds[1];
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/claims/' + retractedId + '/edit'), payload: { object: '改不动' } });
  assert.equal(r.statusCode, 409);
});

// ── actions edit / retract（与 claims 同构）──
let actionA1 = null;
test('confirm 带 action（第2天 vote）入账', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/confirm'), payload: { event: { day: 2, phase: 'dusk', type: 'vote', actor_seat: 4, raw_text: '4号投5号' }, claims: [], actions: [{ seat: 4, action: 'vote', target_seat: 5 }] } });
  assert.equal(r.statusCode, 201);
  actionA1 = j(r).action_ids[0];
  assert.ok(actionA1);
});

test('actions edit：改 target_seat 生效', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/actions/' + actionA1 + '/edit'), payload: { target_seat: 6 } });
  assert.equal(r.statusCode, 200);
  assert.equal(j(r).action.target_seat, 6);
});

test('actions edit target_seat=null → 400', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/actions/' + actionA1 + '/edit'), payload: { target_seat: null } });
  assert.equal(r.statusCode, 400);
});

test('actions retract 后 edit → 409', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/actions/' + actionA1 + '/retract') });
  assert.equal(r.statusCode, 200);
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/actions/' + actionA1 + '/edit'), payload: { result: 'x' } });
  assert.equal(r.statusCode, 409);
});

// ── state / export / 列表 ──
test('GET state?uptoDay=1：过滤 day≥2，retracted 不可见', async () => {
  const r = await app.inject({ method: 'GET', url: gameUrl(gameA.id, '/state?uptoDay=1') });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.game.id, gameA.id);
  assert.equal(b.game.current_day, 2);
  assert.ok(b.events.every((e) => e.day <= 1), 'events 全部 day<=1');
  assert.ok(b.claims.every((c) => c.day <= 1), 'claims 全部 day<=1');
  assert.ok(!b.claims.some((c) => c.id === extractClaimIds[1]), 'retracted claim 不可见');
  assert.ok(!b.actions.some((a) => a.id === actionA1), 'retracted action 不可见');
  assert.ok(b.claims.some((c) => c.id === claimGood), 'day1 金水 claim 可见');
});

test('state?uptoDay=0 → 400', async () => {
  const r = await app.inject({ method: 'GET', url: gameUrl(gameA.id, '/state?uptoDay=0') });
  assert.equal(r.statusCode, 400);
});

test('GET export：meta+counts 齐全', async () => {
  const r = await app.inject({ method: 'GET', url: gameUrl(gameA.id, '/export') });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.meta.game_id, gameA.id);
  assert.ok(b.meta.counts.events >= 4, 'events 计数 >=4');
  assert.ok(Array.isArray(b.events) && b.events.length >= 4);
});

test('export 局不存在 → 404', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/games/424242/export' });
  assert.equal(r.statusCode, 404);
});

test('GET /api/games 列表：event_count/current_day 随事件更新', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/games' });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  const row = b.games.find((g) => g.id === gameA.id);
  assert.ok(row, '列表包含 gameA');
  assert.equal(row.current_day, 2, 'current_day=最大事件天');
  assert.equal(row.event_count, 4, 'event_count=已入账事件数');
  assert.equal(row.max_day, 2, 'max_day=最新事件天');
  const rowB = b.games.find((g) => g.id === gameB.id);
  assert.equal(rowB.event_count, 0, '空局 event_count=0');
  assert.equal(rowB.max_day, 0, '空局 max_day=0');
  assert.ok(b.games.some((g) => g.id === gameB.id), '列表包含 gameB');
});

// ── PUT /seats：座位名单改名通道（P1b-4 增补）──
test('PUT /api/games/:id/seats：改名生效，详情与 state 位次可见新名', async () => {
  const r = await app.inject({ method: 'PUT', url: gameUrl(gameA.id, '/seats'), payload: { seats: [{ seat: 1, name: '张三' }, { seat: 3, name: '李四' }] } });
  assert.equal(r.statusCode, 200);
  const players = j(r).players;
  assert.equal(players.find((p) => p.seat === 1).name, '张三');
  assert.equal(players.find((p) => p.seat === 3).name, '李四');
  assert.equal(players.find((p) => p.seat === 2).name, '2号', '未提及席位保持默认名');
  const detail = j(await app.inject({ method: 'GET', url: gameUrl(gameA.id) }));
  assert.equal(detail.players.find((p) => p.seat === 1).name, '张三', '详情可见新名');
  const state = j(await app.inject({ method: 'GET', url: gameUrl(gameA.id, '/state') }));
  assert.equal(state.players.find((p) => p.seat === 3).name, '李四', 'state 位次可见新名');
});

test('PUT /seats 错误路径：空数组/空名/不在名单 → 400；局不存在 → 404', async () => {
  let r = await app.inject({ method: 'PUT', url: gameUrl(gameA.id, '/seats'), payload: { seats: [] } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: 'PUT', url: gameUrl(gameA.id, '/seats'), payload: { seats: [{ seat: 99, name: 'x' }] } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: 'PUT', url: gameUrl(gameA.id, '/seats'), payload: { seats: [{ seat: 1, name: '' }] } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: 'PUT', url: '/api/games/999999/seats', payload: { seats: [{ seat: 1, name: 'x' }] } });
  assert.equal(r.statusCode, 404);
});

// ── advise 异步任务状态机（running→done）──
let adviseTaskId = null;
test('POST /day/1/advise：202 立即返回 task_id（异步不阻塞）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/day/1/advise') });
  assert.equal(r.statusCode, 202);
  const b = j(r);
  assert.ok(b.task_id);
  assert.equal(b.status, 'running');
  assert.equal(b.poll, '/api/tasks/' + b.task_id);
  adviseTaskId = b.task_id;
});

test('GET /api/tasks/:taskId：running→done，卡片结构齐全且回存', async () => {
  const b = await waitTask(adviseTaskId);
  assert.equal(b.status, 'done');
  assert.equal(b.game_id, gameA.id);
  assert.equal(b.day, 1);
  assert.ok(Array.isArray(b.card.contradictions), 'contradictions 是数组');
  assert.ok(Array.isArray(b.card.hypotheses), 'hypotheses 是数组');
  assert.equal(b.card.saved, true, '参谋卡回存 db（RD1 校验通过）');
  assert.ok(b.finished_at);
});

test('GET /api/tasks/不存在 → 404', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/tasks/adv-nope' });
  assert.equal(r.statusCode, 404);
});

test('POST advise：空局（无事件）预检 → 400', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameB.id, '/day/1/advise') });
  assert.equal(r.statusCode, 400);
  assert.match(j(r).error, /事件记录/);
});

// ── GET /cards 存档读取（P1b-4 增补：只写无读缺口）──
test('GET /api/games/:id/cards：按天倒序列出存档卡（读已落库数据）', async () => {
  const r = await app.inject({ method: 'GET', url: gameUrl(gameA.id, '/cards') });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.game_id, gameA.id);
  assert.ok(Array.isArray(b.cards) && b.cards.length >= 1, '至少一张存档卡');
  const card = b.cards[0];
  assert.equal(card.day, 1, '倒序首卡=最新结算天（此处仅 day1）');
  assert.ok(Array.isArray(card.hypotheses) && card.hypotheses.length >= 1, '该天假设行');
  for (const h of card.hypotheses) {
    assert.equal(typeof h.content, 'string');
    assert.equal(typeof h.stance, 'object');
    assert.ok(['strong', 'mid', 'weak'].includes(h.tendency));
  }
  assert.ok(Array.isArray(card.contradictions), '矛盾列表（evidence_day 反推，可能为空）');
});

test('GET /api/games/:id/cards/:day：单卡形状正确；无存档/局不存在 → 404', async () => {
  let r = await app.inject({ method: 'GET', url: gameUrl(gameA.id, '/cards/1') });
  assert.equal(r.statusCode, 200);
  const card = j(r);
  assert.equal(card.day, 1);
  assert.ok(Array.isArray(card.hypotheses) && card.hypotheses.length >= 1);
  assert.ok(Array.isArray(card.contradictions));
  r = await app.inject({ method: 'GET', url: gameUrl(gameA.id, '/cards/99') });
  assert.equal(r.statusCode, 404);
  r = await app.inject({ method: 'GET', url: '/api/games/999999/cards' });
  assert.equal(r.statusCode, 404);
});

// ── providers（api_key 绝不回明文）──
const SECRET = 'sk-live-0123456789abcdef';
test('GET /api/providers：初始为空（临时配置文件）', async () => {
  const b = j(await app.inject({ method: 'GET', url: '/api/providers' }));
  assert.deepEqual(b.providers, []);
  assert.equal(b.active, null);
});

test('PUT /api/providers/:key：upsert + api_key 掩码（响应无明文）', async () => {
  const r = await app.inject({ method: 'PUT', url: '/api/providers/deepseek', payload: { label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', api_key: SECRET, model: 'deepseek-chat', cards_model: 'deepseek-reasoner' } });
  assert.equal(r.statusCode, 200);
  assert.ok(!r.body.includes(SECRET), '响应体绝不包含 api_key 明文');
  const p = j(r).provider;
  assert.equal(p.has_api_key, true);
  assert.equal(p.api_key_masked, '....' + SECRET.slice(-4));
  assert.equal(p.model, 'deepseek-chat');
  assert.equal(p.cards_model, 'deepseek-reasoner');
});

test('PUT 留空 api_key = 保留现有值（留空=不改语义）', async () => {
  const r = await app.inject({ method: 'PUT', url: '/api/providers/deepseek', payload: { label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' } });
  assert.equal(r.statusCode, 200);
  const p = j(r).provider;
  assert.equal(p.has_api_key, true, '未传 key 保留原值');
  assert.equal(p.api_key_masked, '....' + SECRET.slice(-4));
});

test('POST activate + GET list：active 指向正确且仍脱敏', async () => {
  const a = await app.inject({ method: 'POST', url: '/api/providers/deepseek/activate' });
  assert.equal(a.statusCode, 200);
  assert.equal(j(a).active, 'deepseek');
  const b = j(await app.inject({ method: 'GET', url: '/api/providers' }));
  assert.equal(b.active, 'deepseek');
  assert.equal(b.providers.length, 1);
  assert.ok(!JSON.stringify(b).includes(SECRET), '列表响应无明文 key');
});

test('POST test：mock 模式跳过真实连接（不外呼）', async () => {
  const b = j(await app.inject({ method: 'POST', url: '/api/providers/deepseek/test' }));
  assert.equal(b.ok, true);
  assert.match(b.message, /mock/i);
});

test('PUT 非法 provider key → 400；activate 不存在 → 404', async () => {
  let r = await app.inject({ method: 'PUT', url: '/api/providers/bad%20key', payload: { label: 'x', base_url: 'https://x.com', model: 'm' } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: 'POST', url: '/api/providers/nope/activate' });
  assert.equal(r.statusCode, 404);
});

// ── 2026-09-14：切模型不生效的真实根因（cards.model 过期覆盖）回归 ──────────────
// 用户报「改 providers.json 调了很久没生效」。根因之一：UI「参谋卡模型」留空的语义是
// 「同抽取模型」，但 upsert 此前在留空时**保留旧 cards.model**；而下游取值优先级是
// cards.model → extraction.model ⇒ 只改抽取模型时，过期 cards.model 继续生效（界面已改、实际没改）。
test('regression：只改抽取模型（cards 留空）→ 实际生效模型跟随（修 cards 过期覆盖）', async () => {
  const { createProvidersStore } = require('../src/providersStore');
  const { resolveLlmOptions } = require('../src/llmOptions');
  const p = path.join(os.tmpdir(), 'p1b-cardsfix-' + process.pid + '-' + Date.now() + '.json');
  fs.writeFileSync(p, JSON.stringify({ active: 'cf', providers: {} }));
  const store = createProvidersStore(p);
  try {
    store.upsert('cf', { label: 'cf', base_url: 'https://x.example/v1', api_key: 'cf-key-1234567890', model: 'model-OLD', cards_model: 'model-OLD' });
    assert.equal(resolveLlmOptions({ store }).model, 'model-OLD', '初始生效=model-OLD');
    // 用户只改「抽取模型」，参谋卡模型留空（UI 的留空=同上语义）
    store.upsert('cf', { label: 'cf', base_url: 'https://x.example/v1', model: 'model-NEW' });
    assert.equal(store.getProvider('cf').cards.model, 'model-NEW', '留空 cards → 跟随抽取模型（不再保留旧值）');
    assert.equal(resolveLlmOptions({ store }).model, 'model-NEW', '实际生效模型已跟随（bug 修复核心断言）');
    // 显式指定 cards_model 时仍优先（显式 > 回落）
    store.upsert('cf', { label: 'cf', base_url: 'https://x.example/v1', model: 'model-NEW2', cards_model: 'cards-EXPLICIT' });
    assert.equal(resolveLlmOptions({ store }).model, 'cards-EXPLICIT', '显式 cards_model 仍优先');
  } finally {
    fs.unlinkSync(p);
  }
});


// ── 404 ──
test('未知路由 → 404（统一 not found 形状）', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.equal(r.statusCode, 404);
  assert.ok(j(r).error);
});
// ════════════════════════════════════════════════════════════════════
// ── B2 BOTC 适配（p1b/src/botc/*）：剧本/谓词/对跳检测/私有表 ──
// 铁律：LLM 全 mock（buildServer llmMock:true 已设）；werewolf 49 用例路径零改动
let botcTB = null, botcTB2 = null, botcNoScript = null;
let botcWashIds = [], botcDemonId = null;

test('B2 建局：botc+script=tb → 201 且剧本落 p1b 私有表（详情/列表可见）', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'B2暗流涌动局', type: 'botc', player_count: 7, script: 'tb' } });
  assert.equal(r.statusCode, 201);
  const b = j(r);
  botcTB = b.game;
  assert.equal(b.game.script, 'tb');
  assert.equal(b.players.length, 7);
  r = await app.inject({ method: 'GET', url: gameUrl(botcTB.id) });
  assert.equal(j(r).game.script, 'tb', '详情可见 script');
  r = await app.inject({ method: 'GET', url: '/api/games' });
  const row = j(r).games.find((g) => g.id === botcTB.id);
  assert.equal(row.script, 'tb', '列表可见 script');
  r = await app.inject({ method: 'GET', url: '/api/games' });
  const wwRow = j(r).games.find((g) => g.id === gameA.id);
  assert.equal(wwRow.script, null, 'werewolf 局 script=null');
});

test('B2 建局：botc 缺 script → 201 兼容既有建局路径；script 非法枚举 → 400', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'B2无剧本botc局', type: 'botc', player_count: 5 } });
  assert.equal(r.statusCode, 201, '无剧本 botc 局可建（兼容基线 gameB 形态）');
  botcNoScript = j(r).game;
  assert.equal(j(r).game.script, null);
  r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'X', type: 'botc', player_count: 5, script: 'abc' } });
  assert.equal(r.statusCode, 400);
  assert.match(j(r).error, /tb\|bmr\|snv/);
});

test('B2 无剧本 botc 局：角色/阵营声称 → 400；通用谓词照走主表', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(botcNoScript.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 1, raw_text: 'x' },
    claims: [{ seat: 1, subject_seat: 1, predicate: 'claims_role', object: '洗衣妇' }], extracted_by: 'user' } });
  assert.equal(r.statusCode, 400);
  assert.match(j(r).error, /未挂剧本/);
  r = await app.inject({ method: 'POST', url: gameUrl(botcNoScript.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 1, raw_text: 'x' },
    claims: [{ seat: 1, subject_seat: 2, predicate: 'is_demon', object: '' }], extracted_by: 'user' } });
  assert.equal(r.statusCode, 400, '阵营声称同样需要剧本');
  r = await app.inject({ method: 'POST', url: gameUrl(botcNoScript.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'statement', actor_seat: 1, raw_text: 'x' },
    claims: [{ seat: 1, subject_seat: 2, predicate: 'said', object: '怀疑' }], extracted_by: 'user' } });
  assert.equal(r.statusCode, 201, '通用谓词不依赖剧本');
  assert.deepEqual(j(r).botc_claim_ids, []);
});

test('B2 建局：werewolf 局 script 字段被忽略（回归零影响）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'B2狼人局', type: 'werewolf', player_count: 6, script: 'tb' } });
  assert.equal(r.statusCode, 201);
  assert.equal(j(r).game.script, null, '非 botc 局 script 恒 null');
});

test('B2 角色声称：中文角色名 confirm → 主表 claims object 归一为角色 id', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 2, raw_text: '2号跳洗衣妇' },
    claims: [{ seat: 2, subject_seat: 2, predicate: 'claims_role', object: '洗衣妇' }],
    extracted_by: 'user',
  } });
  assert.equal(r.statusCode, 201);
  const b = j(r);
  botcWashIds.push(b.claim_ids[0]);
  assert.deepEqual(b.botc_claim_ids, [], '角色声称走主表，不进 botc_claims');
  const s = j(await app.inject({ method: 'GET', url: gameUrl(botcTB.id, '/state') }));
  const row = s.claims.find((c) => c.id === b.claim_ids[0]);
  assert.equal(row.object, 'washerwoman', '洗衣妇 → washerwoman（角色 id 入库）');
  assert.equal(row.predicate, 'claims_role');
});

test('B2 角色声称：英文名/大小写归一同 id；越剧本/未知角色 → 400', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: '3号也跳Washerwoman' },
    claims: [{ seat: 3, subject_seat: 3, predicate: 'claims_role', object: 'Washerwoman' }],
    extracted_by: 'user',
  } });
  assert.equal(r.statusCode, 201);
  botcWashIds.push(j(r).claim_ids[0]);
  const s = j(await app.inject({ method: 'GET', url: gameUrl(botcTB.id, '/state') }));
  assert.equal(s.claims.find((c) => c.id === botcWashIds[1]).object, 'washerwoman', '英文大小写归一同 id');
  // 越剧本：赌徒是 BMR 角色，TB 局不可声称（剧本数据驱动校验）
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 2, raw_text: 'x' },
    claims: [{ seat: 2, subject_seat: 2, predicate: 'claims_role', object: '赌徒' }], extracted_by: 'user' } });
  assert.equal(r.statusCode, 400);
  // 未知角色名：B7 护栏后不再 400 拒整批——降级为 said 留痕（无编造、无丢弃、警告注明）
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 2, raw_text: 'x' },
    claims: [{ seat: 2, subject_seat: 2, predicate: 'claims_role', object: '天外飞仙' }], extracted_by: 'user' } });
  assert.equal(r.statusCode, 201, 'B7：不可解析角色降级 said 入账（不拒整批）');
  assert.equal(j(r).claim_ids.length, 1, 'B7：降级行落主表 said');
  assert.ok((j(r).warnings || []).some((w) => String(w).includes('降级为 said')), 'B7：降级动作警告留痕');
});

test('B2 阵营声称：is_demon → 落 p1b 私有表 botc_claims（confirm 返回 botc_claim_ids + GET 可见）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 1, raw_text: '1号指认5号是恶魔' },
    claims: [{ seat: 1, subject_seat: 5, predicate: 'is_demon', object: '' }],
    extracted_by: 'user',
  } });
  assert.equal(r.statusCode, 201);
  botcDemonId = j(r).botc_claim_ids[0];
  assert.ok(botcDemonId, 'botc_claim_ids 非空（新谓词 API 层可见）');
  const b = j(await app.inject({ method: 'GET', url: gameUrl(botcTB.id, '/botc-claims') }));
  const row = b.claims.find((c) => c.id === botcDemonId);
  assert.ok(row, 'GET /botc-claims 可见');
  assert.equal(row.predicate, 'is_demon');
  assert.equal(row.subject_seat, 5);
  const s = j(await app.inject({ method: 'GET', url: gameUrl(botcTB.id, '/state') }));
  assert.ok(!s.claims.some((c) => c.predicate === 'is_demon'), 'botc 谓词不污染主表 claims');
});

test('B2 阵营声称：werewolf 局发 BOTC 谓词 → 400（新谓词 botc 局专属）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/confirm'), payload: {
    event: { day: 3, phase: 'day', type: 'claim', actor_seat: 1, raw_text: 'x' },
    claims: [{ seat: 1, subject_seat: 2, predicate: 'is_demon', object: '' }] } });
  assert.equal(r.statusCode, 400);
  assert.match(j(r).error, /predicate/);
});

test('B2 对跳检测：两 seat 同声称唯一角色 → advise 卡命中 [对跳] 且存档回存', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/day/1/advise') });
  assert.equal(r.statusCode, 202);
  const b = await waitTask(j(r).task_id);
  assert.equal(b.status, 'done');
  const card = b.card;
  assert.equal(card.saved, true, '参谋卡回存（存档含主表引用矛盾对）');
  assert.equal(card.save_error, null);
  assert.equal(card.meta.script, 'tb', 'meta 携带剧本');
  const jump = card.contradictions.find((c) => String(c.conflict_desc || '').includes('[对跳]'));
  assert.ok(jump, '命中唯一角色对跳');
  assert.deepEqual([jump.claim_a, jump.claim_b].sort((x, y) => x - y), botcWashIds.slice().sort((x, y) => x - y),
    '对跳对引用两条洗衣妇声称（主表 claim id）');
  assert.deepEqual(jump.botc_refs, [], '对跳为纯主表对，无 botc 引用');
  assert.ok(['high', 'mid', 'low'].includes(jump.underdetermination), '欠定度色标字段在（RD1：LLM/mock 层标注）');
  assert.ok(jump.innocent_explanations.length >= 1, 'RD1：无辜解释非空');
});

test('B2 对跳检测：非唯一旅行者（枪手）两 seat 同声称 → 不报对跳（unique_note 驱动）', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 4, raw_text: '4号跳枪手' },
    claims: [{ seat: 4, subject_seat: 4, predicate: 'claims_role', object: '枪手' }], extracted_by: 'user' } });
  assert.equal(r.statusCode, 201);
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 5, raw_text: '5号也跳Gunslinger' },
    claims: [{ seat: 5, subject_seat: 5, predicate: 'claims_role', object: 'Gunslinger' }], extracted_by: 'user' } });
  assert.equal(r.statusCode, 201);
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/day/1/advise') });
  const b = await waitTask(j(r).task_id);
  assert.equal(b.status, 'done');
  assert.ok(!b.card.contradictions.some((c) => String(c.conflict_desc || '').includes('枪手')),
    '旅行者（unique_note=非唯一）同角色多 seat 声称不对跳');
  assert.ok(b.card.contradictions.some((c) => String(c.conflict_desc || '').includes('[对跳]')),
    '同卡中唯一角色对跳仍命中');
});

test('B2 阵营互斥/多恶魔/状态矛盾 → botc-only 对挂 live 卡；存档只收主表引用对', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'B2阵营局', type: 'botc', player_count: 7, script: 'tb' } });
  botcTB2 = j(r).game;
  // ① is_demon(1→5) 与 ② is_good(2→5)：阵营互斥（跨 botc_claims × 主表）
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB2.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 1, raw_text: 'x' },
    claims: [{ seat: 1, subject_seat: 5, predicate: 'is_demon', object: '' }], extracted_by: 'user' } });
  const demonId5 = j(r).botc_claim_ids[0];
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB2.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 2, raw_text: 'x' },
    claims: [{ seat: 2, subject_seat: 5, predicate: 'is_good', object: '好人' }], extracted_by: 'user' } });
  const goodId5 = j(r).claim_ids[0];
  // ③ is_demon(3→6)：与 ① 构成多恶魔（本剧本恶魔仅 1 名）
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB2.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: 'x' },
    claims: [{ seat: 3, subject_seat: 6, predicate: 'is_demon', object: '' }], extracted_by: 'user' } });
  // ④ 同源同日双状态（4→7 醉酒+中毒）
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB2.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 4, raw_text: 'x' },
    claims: [
      { seat: 4, subject_seat: 7, predicate: 'status_drunk', object: '' },
      { seat: 4, subject_seat: 7, predicate: 'status_poisoned', object: '' },
    ], extracted_by: 'user' } });
  assert.equal(j(r).botc_claim_ids.length, 2, '状态双声称均落 botc_claims');
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB2.id, '/day/1/advise') });
  const b = await waitTask(j(r).task_id);
  assert.equal(b.status, 'done');
  assert.equal(b.card.saved, true);
  const cs = b.card.contradictions;
  const clash = cs.find((c) => String(c.conflict_desc || '').includes('[阵营互斥]'));
  assert.ok(clash, '命中阵营互斥（is_demon × is_good）');
  assert.deepEqual(clash.botc_refs, [demonId5], '阵营互斥对带回 botc 引用');
  assert.equal(clash.claim_a, goodId5, '阵营互斥对的主表引用为 is_good 声称');
  const multi = cs.find((c) => String(c.conflict_desc || '').includes('[多恶魔]'));
  assert.ok(multi, '命中多恶魔（剧本固定 1 恶魔在场）');
  assert.equal(multi.botc_only, true, '多恶魔对仅引用 botc_claims → botc_only');
  const st = cs.find((c) => String(c.conflict_desc || '').includes('[状态矛盾]'));
  assert.ok(st, '命中状态矛盾（同源同日醉+毒）');
  assert.equal(st.botc_only, true, '状态矛盾对 botc_only');
  for (const c of cs) {
    assert.ok(['high', 'mid', 'low'].includes(c.underdetermination), '每对都有欠定度色标');
    assert.ok(c.innocent_explanations.length >= 1, 'RD1：无辜解释非空');
  }
  // 存档侧：共享 contradictions 表 FK 只认主表 → 仅阵营互斥对（含主表引用）入库
  const arch = j(await app.inject({ method: 'GET', url: gameUrl(botcTB2.id, '/cards') }));
  const day1 = arch.cards.find((c) => c.day === 1);
  assert.ok(day1, 'botc 局存档卡存在');
  assert.equal(day1.contradictions.length, 1, 'botc-only 对不落共享表');
  assert.ok(String(day1.contradictions[0].conflict_desc).includes('[阵营互斥]'));
});

test('B2 通用谓词：botc 局 said/is_good 等仍走主表（botc_claim_ids 为空）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(botcTB2.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'statement', actor_seat: 6, raw_text: '6号说怀疑3号' },
    claims: [{ seat: 6, subject_seat: 3, predicate: 'said', object: '怀疑' }], extracted_by: 'user' } });
  assert.equal(r.statusCode, 201);
  const b = j(r);
  assert.equal(b.claim_ids.length, 1);
  assert.deepEqual(b.botc_claim_ids, []);
});

test('B2 botc-claims retract：软删后 GET 不可见；重复撤回幂等', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/botc-claims/' + botcDemonId + '/retract') });
  assert.equal(r.statusCode, 200);
  assert.equal(j(r).retracted, true);
  r = await app.inject({ method: 'GET', url: gameUrl(botcTB.id, '/botc-claims') });
  assert.equal(j(r).claims.length, 0, '撤回后列表不可见');
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/botc-claims/' + botcDemonId + '/retract') });
  assert.equal(r.statusCode, 200, '重复撤回幂等');
  r = await app.inject({ method: 'POST', url: gameUrl(botcTB.id, '/botc-claims/99999/retract') });
  assert.equal(r.statusCode, 404, '不存在 → 404');
});

test('B2 roles.js：剧本角色集/唯一性/中英映射/团队结构（数据驱动单测）', async () => {
  const roles = require('../src/botc/roles');
  assert.deepEqual(roles.SCRIPTS, ['tb', 'bmr', 'snv']);
  const tb = roles.getRolesByEdition('tb');
  assert.equal(tb.length, 27, 'TB=27 角色与 S1 数据一致');
  assert.deepEqual(roles.getTeamStructure('tb'), { townsfolk: 13, outsider: 4, minion: 4, demon: 1, traveler: 5 });
  const uniq = roles.getUniqueRoleIds('tb');
  assert.ok(uniq.has('washerwoman'), '常规角色唯一');
  assert.ok(!uniq.has('gunslinger'), '旅行者非唯一（unique_note 驱动）');
  const mephit = roles.resolveRole('mephit');
  assert.ok(mephit, '实验角色 mephit 在册');
  assert.ok(!roles.roleInEdition(mephit, 'tb') && !roles.roleInEdition(mephit, 'bmr') && !roles.roleInEdition(mephit, 'snv'),
    '实验角色（editions=[]）不属于任何剧本 → 任何剧本局都不可声称');
  assert.equal(roles.resolveRole('洗衣妇').id, 'washerwoman');
  assert.equal(roles.resolveRole('WASHERWOMAN').id, 'washerwoman');
  assert.equal(roles.resolveRole('不存在角色'), null);
  assert.ok(roles.abilityZh(roles.resolveRole('洗衣妇')).includes('两名'), '能力中文摘要访问器');
});

// ── B3 判词注入（p1b/src/botc/advisePrompt.js + routes/advise.js）──
// 验收口径：mock LLM 捕获 prompt 断言——「捕获」走 llm.js 明示扩展点 options.fetchImpl
// （注入假 fetch，LIVE 形态但绝不外呼，零网络）；werewolf 基线 = CARDS_SYSTEM_PROMPT 原文。
const { llm } = require('../src/deps');
const { makeAdviseRunner } = require('../src/routes/advise');
const { createProvidersStore } = require('../src/providersStore');
const advisePrompt = require('../src/botc/advisePrompt');

const tmpProvidersB3 = path.join(os.tmpdir(), 'p1b-b3-providers-' + process.pid + '-' + Date.now() + '.json');

/** B3 假 fetch：捕获请求体（JSON）+ 返回最小合法参谋卡（stance 覆盖全部座位，过 PD1 校验） */
function makeB3Captor(captured, seatCount) {
  const stance = {};
  for (let s = 1; s <= seatCount; s++) stance[String(s)] = 'neutral';
  const card = {
    contradictions: [],
    hypotheses: [{ content: 'B3测试假设', stance, support_events: [], oppose_events: [], tendency: 'weak' }],
    checkpoints: [],
  };
  return async function b3FakeFetch(url, init) {
    captured.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(card) } }] }) };
  };
}

/** B3 直调 runner 的 ctx：激活假供应商（key 为测试假值，不外呼）+ 注入捕获 fetch */
function makeB3Runner(captured, seatCount) {
  fs.writeFileSync(tmpProvidersB3, JSON.stringify({
    active: 'b3test',
    providers: { b3test: { label: 'b3-test', api_key: 'test-key-B3-MOCK-NOT-REAL', base_url: 'http://b3.invalid/v1' } },
  }));
  return makeAdviseRunner({
    store: createProvidersStore(tmpProvidersB3),
    llmMock: false,
    fetchImpl: makeB3Captor(captured, seatCount),
  });
}

/** B3 建局 + 录一条 day1 声称事件（extracted_by=user 不走 LLM）；claim=null 只录事件 */
async function b3SetupGame(name, type, script, claim) {
  const payload = { name, type, player_count: type === 'botc' ? 5 : 6 };
  if (script) payload.script = script;
  const r = await app.inject({ method: 'POST', url: '/api/games', payload });
  assert.equal(r.statusCode, 201, 'B3 前置：建局成功');
  const g = j(r).game;
  const claims = claim ? [{ seat: 3, subject_seat: 3, predicate: 'claims_role', object: claim }] : [];
  const c = await app.inject({ method: 'POST', url: gameUrl(g.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: '3号发身份' },
    claims, extracted_by: 'user',
  } });
  assert.equal(c.statusCode, 201, 'B3 前置：事件入账成功');
  return g;
}

test('B3 上下文构造：TB 角色清单/裁量警示/入门本提示；BMR 夜死；SNV 疯狂；非法剧本不注入', () => {
  const tb = advisePrompt.buildBotcPromptContext('tb');
  assert.ok(tb.startsWith(advisePrompt.BOTC_CONTEXT_MARK), '上下文带注入标记');
  assert.ok(tb.includes('洗衣妇（镇民）'), '角色行=中文名+团队（roles.js roleBriefZh）');
  assert.ok(tb.includes('两名玩家和一个镇民角色'), '能力中文摘要原文（roles.js abilityZh）');
  assert.ok(tb.includes('醉酒/中毒'), '说书人裁量警示在（一等不确定性来源，摸底§5）');
  assert.ok(tb.includes('裁量空间最小'), 'TB 入门本机制提示');
  assert.ok(tb.includes('3号自称洗衣妇'), '假设区要求带引用角色能力的示例论证');
  const bmr = advisePrompt.buildBotcPromptContext('bmr');
  assert.ok(bmr.includes('夜死不公布'), 'BMR 夜死机制提示');
  assert.ok(bmr.includes('多杀'), 'BMR 恶魔多杀提示');
  const snv = advisePrompt.buildBotcPromptContext('snv');
  assert.ok(snv.includes('疯狂'), 'SNV 疯狂机制提示');
  assert.equal(advisePrompt.buildBotcPromptContext('abc'), '', '非法剧本 → 空串（不注入）');
});

test('B3 TB 局 advise：捕获的 system prompt 含角色清单与洗衣妇能力（追加在原 system 尾部）', async () => {
  const g = await b3SetupGame('B3注入TB局', 'botc', 'tb', '洗衣妇');
  const captured = [];
  const card = await makeB3Runner(captured, 5)(g.id, 1);
  assert.equal(captured.length, 1, '响应合法 → 单次尝试');
  assert.equal(card.saved, true, '参谋卡回存成功');
  assert.equal(card.save_error, null);
  const sys = captured[0].messages[0];
  assert.equal(sys.role, 'system');
  assert.ok(sys.content.startsWith(llm.CARDS_SYSTEM_PROMPT), '注入 = 原 system prompt 前缀不变');
  assert.ok(sys.content.includes(advisePrompt.BOTC_CONTEXT_MARK), 'BOTC 注入标记在');
  assert.ok(sys.content.includes('洗衣妇（镇民）'), 'TB prompt 含角色清单（中文名+团队）');
  assert.ok(sys.content.includes('两名玩家和一个镇民角色'), 'TB prompt 含能力中文摘要');
  assert.ok(sys.content.includes('醉酒/中毒'), 'TB prompt 含说书人裁量警示');
});

test('B3 BMR 局 advise：捕获的 prompt 含夜死不公布+多杀机制提示', async () => {
  const g = await b3SetupGame('B3注入BMR局', 'botc', 'bmr', null);
  const captured = [];
  const card = await makeB3Runner(captured, 5)(g.id, 1);
  assert.equal(card.saved, true);
  const sys = captured[0].messages[0].content;
  assert.ok(sys.includes(advisePrompt.BOTC_CONTEXT_MARK), 'BMR 局注入标记在');
  assert.ok(sys.includes('【本局剧本角色清单】'), 'BMR prompt 含本剧本角色清单');
  assert.ok(sys.includes('夜死不公布'), 'BMR 夜死机制提示进 prompt');
  assert.ok(sys.includes('多杀'), 'BMR 恶魔多杀提示进 prompt');
});

test('B3 werewolf 局 advise：捕获 prompt 与基线逐字节一致（零改动回归）', async () => {
  const g = await b3SetupGame('B3基线werewolf局', 'werewolf', null, null);
  const captured = [];
  const card = await makeB3Runner(captured, 6)(g.id, 1);
  assert.equal(card.saved, true);
  assert.equal(captured.length, 1);
  const sys = captured[0].messages[0];
  assert.equal(sys.role, 'system');
  assert.equal(sys.content, llm.CARDS_SYSTEM_PROMPT, 'werewolf system prompt 与基线逐字节一致');
  assert.ok(!JSON.stringify(captured[0]).includes(advisePrompt.BOTC_CONTEXT_MARK), '请求体无 BOTC 注入痕迹');
});

test('B3 回归：BMR 局经 HTTP advise（llmMock）正常出卡——注入改动不破坏 MOCK 路径', async () => {
  const g = await b3SetupGame('B3回归BMR局', 'botc', 'bmr', null);
  const r = await app.inject({ method: 'POST', url: gameUrl(g.id, '/day/1/advise') });
  assert.equal(r.statusCode, 202);
  const b = await waitTask(j(r).task_id);
  assert.equal(b.status, 'done');
  assert.equal(b.card.meta.script, 'bmr', 'MOCK 路径 meta 仍携带剧本');
  try { fs.unlinkSync(tmpProvidersB3); } catch (e) { /* 已清理 */ }
});

// ── B2 微补丁三：botc 声称修订（POST /botc-claims/:id/edit；B4 前端实测缺口）──
let botcEdit = null, editE1 = null, editE2 = null;
test('B2.3 setup：botc 局 + 两条阵营声称（is_demon/is_minion 各一）', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'B2.3修订局', type: 'botc', player_count: 7, script: 'tb' } });
  assert.equal(r.statusCode, 201);
  botcEdit = j(r).game;
  r = await app.inject({ method: 'POST', url: gameUrl(botcEdit.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 1, raw_text: 'x' },
    claims: [{ seat: 1, subject_seat: 5, predicate: 'is_demon', object: '' }], extracted_by: 'user' } });
  editE1 = j(r).botc_claim_ids[0];
  r = await app.inject({ method: 'POST', url: gameUrl(botcEdit.id, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 2, raw_text: 'x' },
    claims: [{ seat: 2, subject_seat: 6, predicate: 'is_minion', object: '' }], extracted_by: 'user' } });
  editE2 = j(r).botc_claim_ids[0];
  assert.ok(editE1 && editE2, '两条 botc 声称入库');
});

test('B2.3 botc 声称 edit：BOTC 谓词原地改（is_demon→is_minion + 主语改）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(botcEdit.id, '/botc-claims/' + editE1 + '/edit'), payload: { predicate: 'is_minion', subject_seat: 6 } });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.moved_to, 'botc_claims');
  assert.equal(b.claim.predicate, 'is_minion');
  assert.equal(b.claim.subject_seat, 6);
  const list = j(await app.inject({ method: 'GET', url: gameUrl(botcEdit.id, '/botc-claims') }));
  const row = list.claims.find((c) => c.id === editE1);
  assert.equal(row.predicate, 'is_minion', '列表可见修订结果');
});

test('B2.3 botc 声称 edit：谓词改回 7 通用枚举 → 跨表迁移主表（软删本行+主表新建）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(botcEdit.id, '/botc-claims/' + editE1 + '/edit'), payload: { predicate: 'is_good', object: '好人' } });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.moved_to, 'claims', '迁移主表');
  assert.ok(b.claim_id, '返回主表新 claim id');
  assert.equal(b.claim.predicate, 'is_good');
  assert.equal(b.claim.subject_seat, 6, '沿用上一步修订的主语');
  assert.equal(b.botc_claim.retracted, 1, '原 botc 行软删（账本纪律）');
  const list = j(await app.inject({ method: 'GET', url: gameUrl(botcEdit.id, '/botc-claims') }));
  assert.ok(!list.claims.some((c) => c.id === editE1), 'botc 列表不可见已迁移行');
  const s = j(await app.inject({ method: 'GET', url: gameUrl(botcEdit.id, '/state') }));
  const mainRow = s.claims.find((c) => c.id === b.claim_id);
  assert.ok(mainRow, '主表可见迁移新行');
  assert.equal(mainRow.predicate, 'is_good');
});

test('B2.3 botc 声称 edit 错误路径 + 主表 edit 路由边界钉死', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(botcEdit.id, '/botc-claims/' + editE2 + '/edit'), payload: {} });
  assert.equal(r.statusCode, 400, '无字段 → 400');
  r = await app.inject({ method: 'POST', url: gameUrl(botcEdit.id, '/botc-claims/' + editE2 + '/edit'), payload: { predicate: 'is_wolf_zzz' } });
  assert.equal(r.statusCode, 400, '非法谓词 → 400');
  r = await app.inject({ method: 'POST', url: gameUrl(botcEdit.id, '/botc-claims/' + editE2 + '/edit'), payload: { predicate: 'is_good' } });
  assert.equal(r.statusCode, 400, '迁移主表缺 object → 400（主表 object 非空契约）');
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/botc-claims/' + editE2 + '/edit'), payload: { object: 'x' } });
  assert.equal(r.statusCode, 404, '归属局不符 → 404');
  r = await app.inject({ method: 'POST', url: gameUrl(botcEdit.id, '/botc-claims/' + editE2 + '/retract') });
  assert.equal(r.statusCode, 200);
  r = await app.inject({ method: 'POST', url: gameUrl(botcEdit.id, '/botc-claims/' + editE2 + '/edit'), payload: { object: 'x' } });
  assert.equal(r.statusCode, 409, '已撤回行 edit → 409（账本纪律）');
  // 边界：主表 claims edit 路由仍只认 7 枚举，BOTC 谓词 400（主表行改向 BOTC 谓词走撤回重录）
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/claims/' + claimC1 + '/edit'), payload: { predicate: 'is_demon' } });
  assert.equal(r.statusCode, 400, '主表路由 BOTC 谓词 → 400（边界不变）');
});

// ── B7 抽取侧注入 + 入账护栏（extractPrompt.js + claims.js + events.js + server.js 缝）──
// 验收口径：mock LLM 捕获断言注入段（botc 局含 4 专属谓词+席位行；werewolf 局零痕迹）；
// 降级/修复护栏用例（不再 400 拒整批）；全部走 fetchImpl 假 fetch，绝不外呼真实 API。
const extractPrompt = require('../src/botc/extractPrompt');
const tmpProvidersB7 = path.join(os.tmpdir(), 'p1b-b7-providers-' + process.pid + '-' + Date.now() + '.json');
let appB7 = null; // 第二个 server 实例：LIVE 形态 + 假 fetch（llmMock:false 才走 fetch 通道）

/** B7 假 fetch：捕获请求体 + 返回指定 content 的抽取响应（合法 7 谓词形态） */
function makeB7Captor(captured, contentClaims) {
  const content = JSON.stringify({
    event: { day: 1, phase: 'day', type: 'claim', raw_text: '（测试原话）' },
    claims: contentClaims, action: null,
  });
  return async function b7FakeFetch(url, init) {
    captured.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
  };
}

async function getB7App(captured, contentClaims) {
  // 激活假供应商（key 为测试假值，不外呼）：无 key 会落 MOCK → 不走 fetch 捕获（B3 同坑）
  if (!fs.existsSync(tmpProvidersB7)) fs.writeFileSync(tmpProvidersB7, JSON.stringify({
    active: 'b7test',
    providers: { b7test: { label: 'b7-test', api_key: 'test-key-B7-FAKE-NOT-REAL', base_url: 'http://b7.invalid/v1' } },
  }));
  appB7 = await buildServer({
    dbPath: ':memory:', llmMock: false,
    providersPath: tmpProvidersB7,
    fetchImpl: makeB7Captor(captured, contentClaims),
  });
  return appB7;
}

test('B7 抽取上下文构造：角色清单/4 专属谓词/反例/禁 is_wolf；非法剧本不注入', () => {
  const tb = extractPrompt.buildBotcExtractContext('tb');
  assert.ok(tb.startsWith(extractPrompt.BOTC_EXTRACT_MARK), '带注入标记');
  assert.ok(tb.includes('镇民（13）'), 'TB 角色清单按团队分组（roles.js 数据驱动）');
  assert.ok(tb.includes('小恶魔'), 'TB 清单含恶魔小恶魔');
  for (const p of ['is_demon', 'is_minion', 'status_drunk', 'status_poisoned']) {
    assert.ok(tb.includes(p), '明示专属谓词 ' + p);
  }
  assert.ok(tb.includes('不要输出 is_wolf'), '禁用 is_wolf（BOTC 无狼阵营）');
  assert.ok(tb.includes('阵营词不是角色名'), '反例①阵营词禁入 is_role');
  assert.ok(tb.includes('保留说话者归属'), '反例②转述指控归属进 object');
  assert.equal(extractPrompt.buildBotcExtractContext('abc'), '', '非法剧本 → 空串（不注入）');
});

test('B7 wrapper：system 尾部追加上下文 + user 插【发言席位】行；双重包装幂等', async () => {
  const captured = [];
  const inner = async (url, init) => { captured.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }; };
  const once = extractPrompt.withBotcExtractContext({ fetchImpl: inner }, 'tb', 2);
  const body = JSON.stringify({ messages: [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: '【用户原话（待抽取）】我自己都醉了' },
  ] });
  await once.fetchImpl('http://t.invalid/v1/chat/completions', { method: 'POST', body });
  assert.equal(captured.length, 1);
  assert.ok(captured[0].messages[0].content.startsWith('SYS'), 'system 原前缀不变');
  assert.ok(captured[0].messages[0].content.includes(extractPrompt.BOTC_EXTRACT_MARK), 'system 尾部有注入标记');
  const user = captured[0].messages[1].content;
  assert.ok(user.includes(extractPrompt.BOTC_SEAT_MARK), 'user 含席位行');
  assert.ok(user.includes('2 号'), '席位=2');
  assert.ok(user.indexOf(extractPrompt.BOTC_SEAT_MARK) < user.indexOf('【用户原话'), '席位行插在【用户原话】之前');
  // 双重包装幂等：外层看到的 body 已带标记 → 不重复追加
  const twice = extractPrompt.withBotcExtractContext(
    extractPrompt.withBotcExtractContext({ fetchImpl: inner }, 'tb', 2), 'tb', 2);
  await twice.fetchImpl('http://t.invalid/v1/chat/completions', { method: 'POST', body });
  const sys2 = captured[1].messages[0].content;
  assert.equal(sys2.split(extractPrompt.BOTC_EXTRACT_MARK).length - 1, 1, '标记只出现一次（幂等）');
});

test('B7 botc 局 extract 端到端：注入段进 prompt + 载体/阵营词双重还原出卡', async () => {
  const captured = [];
  const app = await getB7App(captured, [
    { subject_seat: 14, predicate: 'is_demon', object: '14号是恶魔' },
    { subject_seat: 14, predicate: 'is_role', object: '恶魔' },
  ]);
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'B7注入局', type: 'botc', player_count: 15, script: 'tb' } });
  assert.equal(g.statusCode, 201, 'B7 前置：botc 局建局');
  const gid = j(g).game.id;
  const r = await app.inject({ method: 'POST', url: gameUrl(gid, '/events/extract'), payload: { text: '14号就是恶魔', speaker_seat: 2 } });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(captured.length, 1, '单次尝试');
  const sys = captured[0].messages[0].content;
  assert.ok(sys.includes(extractPrompt.BOTC_EXTRACT_MARK), '捕获 system 含注入标记');
  for (const p of ['is_demon', 'is_minion', 'status_drunk', 'status_poisoned']) assert.ok(sys.includes(p), 'prompt 明示 ' + p);
  assert.ok(captured[0].messages[1].content.includes(extractPrompt.BOTC_SEAT_MARK), '捕获 user 含席位行（speaker_seat=2 进 prompt）');
  assert.equal(b.claims.length, 2, '两条 claims 都出卡');
  assert.equal(b.claims[0].predicate, 'is_demon', '载体还原：is_demon 出卡');
  assert.equal(b.claims[0].object, '14号是恶魔', '原 object 无损保留');
  assert.equal(b.claims[1].predicate, 'is_demon', '词还原：is_role(恶魔) → is_demon 出卡');
  assert.ok(b.warnings.some((w) => String(w).includes('按 BOTC 语义归入')), '词还原警告留痕');
  assert.equal(b.meta.script, 'tb', 'meta 携带剧本');
});

test('B7 werewolf 局 extract：prompt 零注入（无标记/无席位行），行为与基线一致', async () => {
  const captured = [];
  await getB7App(captured, [{ subject_seat: 2, predicate: 'said', object: '普通发言' }]);
  const g = await appB7.inject({ method: 'POST', url: '/api/games', payload: { name: 'B7基线局', type: 'werewolf', player_count: 6 } });
  const gid = j(g).game.id;
  const r = await appB7.inject({ method: 'POST', url: gameUrl(gid, '/events/extract'), payload: { text: '普通一句发言', speaker_seat: 2 } });
  assert.equal(r.statusCode, 200);
  assert.equal(captured.length, 1);
  assert.ok(!JSON.stringify(captured[0]).includes(extractPrompt.BOTC_EXTRACT_MARK), '请求体无 BOTC 注入痕迹');
  assert.ok(!captured[0].messages[1].content.includes(extractPrompt.BOTC_SEAT_MARK), 'user 无席位行（即使传了 speaker_seat）');
  assert.equal(j(r).claims[0].predicate, 'said', 'werewolf 抽取行为不变');
});

test('B7 零声称机械复查：原话含阵营/状态关键词但 0 claims → 警告留痕', async () => {
  const captured = [];
  const app = await getB7App(captured, []);
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'B7零声称局', type: 'botc', player_count: 6, script: 'tb' } });
  const gid = j(g).game.id;
  const r = await app.inject({ method: 'POST', url: gameUrl(gid, '/events/extract'), payload: { text: '我感觉我中毒了', speaker_seat: 3 } });
  assert.equal(r.statusCode, 200);
  assert.equal(j(r).claims.length, 0);
  assert.ok(j(r).warnings.some((w) => String(w).includes('机械复查')), '零声称+关键词 → 机械复查警告');
  try { fs.unlinkSync(tmpProvidersB7); } catch (e) { /* 已清理 */ }
  try { if (appB7) { await appB7.close(); appB7 = null; } } catch (e) { /* 已清理 */ }
});

test('B7 splitBotcClaims 护栏单元：词修复/降级 said/is_wolf 修复/越剧本仍 400', () => {
  const claimsMod = require('../src/botc/claims');
  const out = claimsMod.splitBotcClaims('tb', [
    { seat: 14, subject_seat: 14, predicate: 'is_role', object: '恶魔' },
    { seat: 2, subject_seat: 2, predicate: 'claims_role', object: '天外飞仙' },
    { seat: 5, subject_seat: 5, predicate: 'is_wolf', object: '爪牙' },
    { seat: 1, subject_seat: 1, predicate: 'claims_role', object: '洗衣妇' },
  ]);
  assert.equal(out.botc.length, 2, '恶魔/爪牙词修复 → botc_claims 两条');
  assert.equal(out.botc[0].predicate, 'is_demon');
  assert.equal(out.botc[1].predicate, 'is_minion');
  const said = out.main.find((c) => c.predicate === 'said');
  assert.ok(said && said.object === '天外飞仙', '不可解析角色降级 said 留痕');
  assert.ok(out.main.some((c) => c.predicate === 'claims_role' && c.object === 'washerwoman'), '正常角色归一不受影响');
  assert.equal(out.warnings.length, 3, '三个护栏动作各留一条警告');
  assert.throws(() => claimsMod.splitBotcClaims('tb', [
    { seat: 2, subject_seat: 2, predicate: 'claims_role', object: '赌徒' },
  ]), /越剧本/, '越剧本（可解析但不属本剧本）仍 400——真实录入错误须人工确认');
});

test('B7 confirm 护栏端到端：is_role(恶魔) 201 入 botc_claims（原 400 拒整批）', async () => {
  const captured = [];
  const app = await getB7App(captured, []);
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'B7护栏局', type: 'botc', player_count: 15, script: 'bmr' } });
  const gid = j(g).game.id;
  const r = await app.inject({ method: 'POST', url: gameUrl(gid, '/events/confirm'), payload: {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: '3号指认14号是恶魔' },
    claims: [
      { seat: 3, subject_seat: 14, predicate: 'is_role', object: '恶魔' },
      { seat: 3, subject_seat: 3, predicate: 'claims_role', object: '教授' },
    ], extracted_by: 'llm' } });
  assert.equal(r.statusCode, 201, 'B7：词修复入账，不拒整批（同批正确声称陪葬问题消除）');
  const b = j(r);
  assert.equal(b.botc_claim_ids.length, 1, '恶魔 → botc_claims 一条');
  assert.equal(b.claim_ids.length, 1, '教授（bmr 在册）→ 主表一条');
  assert.ok(b.warnings.some((w) => String(w).includes('阵营/状态词')), '护栏警告透传到响应');
  const list = j(await app.inject({ method: 'GET', url: gameUrl(gid, '/botc-claims') }));
  assert.equal(list.claims[0].predicate, 'is_demon', 'GET 可见修复后的专属谓词行');
});

test('B7 wrapper 响应侧：原生 Response（ok/status 为原型 getter）仍被正确消费——B7 复测实抓回归', async () => {
  const content = JSON.stringify({ event: { day: 1, phase: 'day', type: 'claim', raw_text: 'x' },
    claims: [{ subject_seat: 5, predicate: 'is_demon', object: '5号是恶魔' }], action: null });
  const inner = async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  const wrapped = extractPrompt.withBotcExtractContext({ fetchImpl: inner }, 'tb', null);
  const res = await wrapped.fetchImpl('http://t.invalid/v1/chat/completions', { method: 'POST', body: '{}' });
  assert.equal(typeof res.ok, 'boolean', 'ok 为自有 boolean（llm.js 契约）');
  assert.equal(res.ok, true);
  const data = await res.json();
  const claim = data.choices[0].message.content;
  assert.ok(claim.includes('__BOTC[is_demon]'), '原生 Response 路径下载体翻译仍生效');
});
