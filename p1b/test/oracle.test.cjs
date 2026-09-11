'use strict';
/**
 * p1b/test/oracle.test.cjs —— 玄学化判词 W1 测试（node:test + fastify inject，不起真端口）。
 * 覆盖：确定性锚点（FNV-1a 公开向量 + 两个冻结局锚点）/ API 200 形状 /
 * MOCK 断语含卦名+娱乐参考 / 同局两次 GET 逐字节一致 / 404/400 /
 * LIVE 缝（fetchImpl 注入 + LLM_API_KEY env，零真实网络）与 LIVE 失败兜底缝。
 * 铁律：DB=:memory:；providers 指向 os.tmpdir() 临时文件；绝不外呼真实 API。
 * 锚点冻结值来自 p8-anchor-probe.cjs 实测（docs/sandbox/p1b/itest/），口径见 lib/oracle.js 注释。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const { deriveCasting, mockVerdict, fnv1a, DISCLAIMER } = require('../src/lib/oracle');
const { ORACLE_SYSTEM_PROMPT, capVerdict } = require('../src/routes/oracle');

const tmpProviders = path.join(os.tmpdir(), 'p1b-oracle-test-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
});

test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

// ── 确定性锚点（纯单元，无网络无 DB）──
test('fnv1a 公开测试向量：""=2166136261、"a"=3826002220（哈希口径冻结）', () => {
  assert.equal(fnv1a(''), 2166136261);
  assert.equal(fnv1a('a'), 3826002220);
});

test('锚点G1 局#1 werewolf 6人：A=387,B=166 → 火水未济·动爻1·体离火/用坎水·用克体·变火泽睽', () => {
  const c = deriveCasting({ id: 1, game_type: 'werewolf', created_at: '2026-09-10 12:00:00', player_count: 6 });
  assert.deepEqual(c.numbers, { a: 387, b: 166 });
  assert.equal(c.benGua.fullName, '火水未济');
  assert.equal(c.huGua.fullName, '水火既济');
  assert.equal(c.bianGua.fullName, '火泽睽');
  assert.equal(c.dongYao, 1);
  assert.equal(c.ti.trigram, '离');
  assert.equal(c.ti.wuXing, '火');
  assert.equal(c.yong.trigram, '坎');
  assert.equal(c.yong.wuXing, '水');
  assert.equal(c.tiYongRelation, '用克体');
});

test('锚点G2 局#2 botc 9人：A=161,B=56 → 天地否·动爻1·用生体·变天雷无妄', () => {
  const c = deriveCasting({ id: 2, game_type: 'botc', created_at: '2026-09-11 21:30:00', player_count: 9 });
  assert.deepEqual(c.numbers, { a: 161, b: 56 });
  assert.equal(c.benGua.fullName, '天地否');
  assert.equal(c.bianGua.fullName, '天雷无妄');
  assert.equal(c.dongYao, 1);
  assert.equal(c.tiYongRelation, '用生体');
});

test('确定性：同输入两次完全一致；换 id 换卦；type/game_type 别名等价', () => {
  const g = { id: 1, game_type: 'werewolf', created_at: '2026-09-10 12:00:00', player_count: 6 };
  assert.deepEqual(deriveCasting(g), deriveCasting(g)); // 同局恒同卦
  const g3 = Object.assign({}, g, { id: 3 });
  assert.notDeepEqual(deriveCasting(g3).numbers, { a: 387, b: 166 }); // 换 id 换数（锚点实测无碰撞）
  const alias = deriveCasting(Object.assign({}, g, { game_type: undefined, type: 'werewolf' }));
  assert.deepEqual(alias.numbers, { a: 387, b: 166 }); // game.row 既可能给 game_type 也可能给 type
});

test('非法输入拒绝：缺 id / 缺 created_at / player_count=0 / 空 type', () => {
  assert.throws(() => deriveCasting({ game_type: 'werewolf', created_at: 'x', player_count: 6 }), /game\.id/);
  assert.throws(() => deriveCasting({ id: 1, game_type: 'werewolf', player_count: 6 }), /created_at/);
  assert.throws(() => deriveCasting({ id: 1, game_type: 'werewolf', created_at: 'x', player_count: 0 }), /player_count/);
  assert.throws(() => deriveCasting({ id: 1, game_type: '', created_at: 'x', player_count: 6 }), /type/);
});

test('MOCK 断语模板：含卦名+娱乐参考、含体用关系；capVerdict 硬截 200', () => {
  const c = deriveCasting({ id: 1, game_type: 'werewolf', created_at: '2026-09-10 12:00:00', player_count: 6 });
  const v = mockVerdict(c);
  assert.ok(v.includes(c.benGua.fullName), '断语缺本卦名');
  assert.ok(v.includes('娱乐参考'), '断语缺娱乐参考字样');
  assert.ok(v.includes(c.tiYongRelation), '断语缺体用关系');
  assert.equal(DISCLAIMER, '娱乐参考');
  assert.ok(ORACLE_SYSTEM_PROMPT.startsWith('娱乐参考，非游戏研判。'), 'system 首行必须强制娱乐边界');
  assert.equal(capVerdict('x'.repeat(201)), 'x'.repeat(200) + '……');
  assert.equal(capVerdict('短断语'), '短断语');
});

// ── API（MOCK 模式）──
let gameId = null;
test('POST /api/games 建判词测试局', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '判词测试局', type: 'werewolf', player_count: 8 } });
  assert.equal(r.statusCode, 201);
  gameId = r.json().game.id;
});

test('GET /api/games/:id/oracle → 200：casting 全套 + verdict 含卦名与娱乐参考 + disclaimer 精确', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/games/' + gameId + '/oracle' });
  assert.equal(r.statusCode, 200);
  const b = r.json();
  assert.equal(b.game_id, gameId);
  assert.equal(b.disclaimer, '娱乐参考'); // 恒挂标注，精确相等
  assert.equal(b.mode, 'mock'); // llmMock:true → 零网络固定模板
  assert.ok(b.casting.benGua && b.casting.benGua.fullName, '缺本卦');
  assert.ok(b.casting.huGua && b.casting.huGua.fullName, '缺互卦');
  assert.ok(b.casting.bianGua && b.casting.bianGua.fullName, '缺变卦');
  assert.ok(b.casting.dongYao >= 1 && b.casting.dongYao <= 6, '动爻越界');
  assert.ok(b.casting.ti && b.casting.ti.wuXing && b.casting.yong && b.casting.yong.wuXing, '缺体用五行');
  assert.equal(typeof b.casting.tiYongRelation, 'string');
  assert.ok(b.verdict.includes(b.casting.benGua.fullName), '断语不含卦名');
  assert.ok(b.verdict.includes('娱乐参考'), '断语不含娱乐参考字样');
  assert.equal(b.verdict, mockVerdict(b.casting)); // MOCK 断语=确定性模板逐字一致
});

test('同局两次 GET 响应体逐字节一致（同局同卦同断语）', async () => {
  const r1 = await app.inject({ method: 'GET', url: '/api/games/' + gameId + '/oracle' });
  const r2 = await app.inject({ method: 'GET', url: '/api/games/' + gameId + '/oracle' });
  assert.equal(r1.statusCode, 200);
  assert.equal(r2.statusCode, 200);
  assert.equal(r1.body, r2.body);
});

test('API casting 与本地 deriveCasting(建局返回 game) 一致', async () => {
  const detail = await app.inject({ method: 'GET', url: '/api/games/' + gameId });
  const game = detail.json().game; // {id,type,game_type,player_count,created_at,...}
  const local = deriveCasting(game);
  const r = await app.inject({ method: 'GET', url: '/api/games/' + gameId + '/oracle' });
  const b = r.json();
  assert.deepEqual(b.casting.numbers, local.numbers);
  assert.equal(b.casting.benGua.fullName, local.benGua.fullName);
  assert.equal(b.casting.bianGua.fullName, local.bianGua.fullName);
});

test('404（局不存在）/ 400（非整数 id）', async () => {
  const r404 = await app.inject({ method: 'GET', url: '/api/games/999999/oracle' });
  assert.equal(r404.statusCode, 404);
  const r400 = await app.inject({ method: 'GET', url: '/api/games/abc/oracle' });
  assert.equal(r400.statusCode, 400);
});

// ── LIVE 缝（fetchImpl 注入，零真实网络）──
function withKey(fn) {
  return async (t) => {
    const prev = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = 'test-key-not-real';
    try { await fn(t); } finally {
      if (prev === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = prev;
    }
  };
}

test('LIVE 缝：fetchImpl 注入 → mode=live、verdict=注入文本(trim)、线检 system 首行/无 response_format', withKey(async () => {
  const seen = { url: null, headers: null, body: null };
  const liveApp = await buildServer({
    dbPath: ':memory:',
    llmMock: false,
    providersPath: tmpProviders + '.live.json',
    fetchImpl: async (url, opts) => {
      seen.url = url;
      seen.headers = opts.headers;
      seen.body = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '  测试断语：山风渐，静中暗动。  ' } }] }) };
    },
  });
  try {
    const c = await liveApp.inject({ method: 'POST', url: '/api/games', payload: { name: 'LIVE缝', type: 'botc', player_count: 5 } });
    assert.equal(c.statusCode, 201);
    const id2 = c.json().game.id;
    const r = await liveApp.inject({ method: 'GET', url: '/api/games/' + id2 + '/oracle' });
    assert.equal(r.statusCode, 200);
    const b = r.json();
    assert.equal(b.mode, 'live');
    assert.equal(b.verdict, '测试断语：山风渐，静中暗动。');
    assert.equal(b.disclaimer, '娱乐参考');
    assert.ok(seen.url.endsWith('/chat/completions'), 'chat 通道 URL 不对: ' + seen.url);
    assert.equal(seen.headers.Authorization, 'Bearer test-key-not-real');
    assert.equal(seen.body.messages[0].role, 'system');
    assert.ok(seen.body.messages[0].content.startsWith('娱乐参考，非游戏研判。'), 'system 首行必须强制娱乐边界');
    assert.ok(!('response_format' in seen.body), '断语通道不该强制 JSON 契约');
    assert.ok(seen.body.messages[1].content.includes('体用'), 'user prompt 应含体用信息');
  } finally {
    await liveApp.close();
  }
}));

test('LIVE 失败缝：fetchImpl 抛错 → 200 + mode=mock_fallback + llm_error（不谎报为 LLM 断语）', withKey(async () => {
  const liveApp2 = await buildServer({
    dbPath: ':memory:',
    llmMock: false,
    providersPath: tmpProviders + '.live2.json',
    fetchImpl: async () => { throw new Error('模拟网络故障'); },
  });
  try {
    const c = await liveApp2.inject({ method: 'POST', url: '/api/games', payload: { name: 'fallback缝', type: 'werewolf', player_count: 6 } });
    assert.equal(c.statusCode, 201);
    const id3 = c.json().game.id;
    const r = await liveApp2.inject({ method: 'GET', url: '/api/games/' + id3 + '/oracle' });
    assert.equal(r.statusCode, 200);
    const b = r.json();
    assert.equal(b.mode, 'mock_fallback');
    assert.ok(b.llm_error.includes('模拟网络故障'));
    assert.ok(b.verdict.includes('娱乐参考'));
    assert.equal(b.disclaimer, '娱乐参考');
  } finally {
    await liveApp2.close();
  }
}));
