'use strict';
/**
 * 局鉴 · test/api.test.cjs —— HTTP 契约测试（21 个端点逐个覆盖）
 *
 * ── 这套测试替的是什么 ────────────────────────────────────────────────────
 *   推演沙盘那边有 66 个对局用例散在 p1b 的集成测试里。局鉴是独立项目，
 *   **不能靠那边的测试活着**——所以这里按同一份契约重写，覆盖每一个端点。
 *   口径：对着 src/routes/*.js 的判据写，不对着实现写；
 *   凡「文件头说了必须成立」的地方，这里必须有一条用例咬住它。
 *
 *   LLM 全 MOCK（llmMock=true ⇒ mockMode），零网络，绝不外呼。
 */
const test = require('node:test');
const assert = require('node:assert');

const server = require('../src/server');

let app;
test.before(async () => { app = await server.build({ dbPath: ':memory:', llmMock: true }); });
test.after(async () => { await app.close(); });

const post = (url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const put = (url, payload) => app.inject({ method: 'PUT', url, payload });
const get = (url) => app.inject({ method: 'GET', url });
const json = (r) => r.json();

/** 建一局并返回 id。默认狼人杀、8 人。 */
async function newGame(over = {}) {
  const r = await post('/api/games', Object.assign({ name: '测试局', type: 'werewolf', player_count: 8 }, over));
  return json(r).game.id;
}
/** 走完「宏 → 确认」两步，返回 confirm 的结果。 */
async function record(gid, macroBody) {
  const m = await post(`/api/games/${gid}/events/macro`, macroBody);
  assert.equal(m.statusCode, 200, '宏卡应当 200：' + m.body);
  const card = m.json();
  return post(`/api/games/${gid}/events/confirm`, {
    event: card.event, claims: card.claims, actions: card.actions || [], extracted_by: 'macro',
  });
}

// ══ 端点清单：登记了哪些，就不许悄悄多一个或少一个 ═══════════════════════

test('★① 端点清单与文档一致（21 个 ＋ health ＝ 22 条）', () => {
  // printRoutes 给的是缩进树（/api/games 下挂 /:id、/state…），不是平铺字符串。
  // 先按缩进还原成完整路径再比对。
  // （第一版直接拿树形文本 includes('/api/games/:id')，被自己的树形判红。）
  const flat = [];
  const stack = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = line.match(/^([│ ]*)[├└]── (\S+)/);
    if (!m) continue;
    const depth = m[1].length;                 // 缩进宽度 = 树层级
    stack.length = depth / 4;
    // ★树里的段已带前导斜杠（"api/games"），直接 join 会得到 '//api/games'
    stack.push(m[2].replace(/ \(.*\)$/, '').replace(/^\/+|\/+$/g, ''));
    flat.push('/' + stack.filter(Boolean).join('/'));
  }
  const expect = [
    '/api/health', '/api/adapters',
    '/api/games', '/api/games/:id', '/api/games/:id/state', '/api/games/:id/export',
    '/api/games/:id/seats',
    '/api/games/:id/events/macro', '/api/games/:id/events/extract', '/api/games/:id/events/confirm',
    '/api/games/:id/claims/:claimId/edit', '/api/games/:id/claims/:claimId/retract',
    '/api/games/:id/actions/:actionId/edit', '/api/games/:id/actions/:actionId/retract',
    '/api/games/:id/botc-claims', '/api/games/:id/botc-claims/:claimId/edit',
    '/api/games/:id/botc-claims/:claimId/retract',
    '/api/games/:id/day/:n/advise', '/api/tasks/:taskId',
    '/api/games/:id/cards', '/api/games/:id/cards/:day',
  ];
  for (const p of expect) assert.ok(flat.includes(p), '少注册了: ' + p);
  // ★反向锁只看 /api/*。静态托管注册的 '/' 与 '/*' 也在同一棵树里，
  //   但它们不是对外接口 —— 把它们算进「端点清单」会让这道守卫答非所问，
  //   而且一旦有人改托管方式它就红，红的却与接口增减无关。
  const apiOnly = flat.filter((p) => p.startsWith('/api/'));
  const extra = apiOnly.filter((p) => !expect.includes(p));
  assert.deepEqual(extra, [],
    '★有端点没写进清单。对外接口必须有名有据，改了清单再改这里。实际多出来的：'
    + JSON.stringify(extra));
});

test('② health 自报定位与运行态；未知路径 404 且形状统一', async () => {
  const h = json(await get('/api/health'));
  assert.equal(h.ok, true);
  assert.equal(h.project, 'jujian');
  assert.equal(h.llm_mock, true);
  assert.match(h.positioning, /复盘器/);
  const nf = await get('/api/nope');
  assert.equal(nf.statusCode, 404);
  assert.equal(json(nf).status, 404);
});

// ══ 建局 ════════════════════════════════════════════════════════════════

test('③ 建局 201 ＋ 自动建席 1..N ＋ 列表可见', async () => {
  const r = await post('/api/games', { name: '饭桌局', type: 'werewolf', player_count: 9 });
  assert.equal(r.statusCode, 201);
  const j = json(r);
  assert.equal(j.game.player_count, 9);
  assert.deepEqual(j.players.map((p) => p.name), ['1号', '2号', '3号', '4号', '5号', '6号', '7号', '8号', '9号']);
  const list = json(await get('/api/games'));
  assert.ok(list.games.some((g) => g.id === j.game.id), '建完局列表里必须看得见');
});

test('④ 建局判据：类型枚举 400／人数缺失 400／人数 >24 400', async () => {
  const cases = [
    [{ name: 'x', type: '麻将', player_count: 4 }, /game_type 必须是/],
    [{ name: 'x', type: 'werewolf' }, /player_count/],
    [{ name: 'x', type: 'werewolf', player_count: 25 }, /上限 24/],
  ];
  for (const [body, re] of cases) {
    const r = await post('/api/games', body);
    assert.equal(r.statusCode, 400, '应 400: ' + JSON.stringify(body));
    assert.match(json(r).error, re);
  }
});

test('⑤ 适配器登记：内置三型 ＋ 阿瓦隆适配器，五方法契约齐才算 ready', async () => {
  const list = json(await get('/api/adapters'));
  const ids = list.map((a) => a.id);
  for (const id of ['werewolf', 'botc', 'script', 'avalon']) assert.ok(ids.includes(id), '少了 ' + id);
  const av = list.find((a) => a.id === 'avalon');
  assert.equal(av.ready, true);
  assert.equal(av.contract, '5/5');
});

// ══ 宏与确认 ════════════════════════════════════════════════════════════

test('⑥ 宏三型：跳身份／查杀／金水，各产同构待确认卡', async () => {
  const gid = await newGame({ player_count: 8 });
  const a = json(await post(`/api/games/${gid}/events/macro`, { kind: 'claim_role', seat: 2, role: '预言家', day: 1 }));
  assert.equal(a.claims[0].predicate, 'claims_role');
  assert.match(a.event.raw_text, /跳预言家/);
  const b = json(await post(`/api/games/${gid}/events/macro`, { kind: 'check', seat: 2, target_seat: 3, day: 1 }));
  assert.equal(b.claims[0].predicate, 'is_wolf');
  assert.equal(b.claims[0].subject_seat, 3);
  const c = json(await post(`/api/games/${gid}/events/macro`, { kind: 'good', seat: 5, target_seat: 4, day: 1 }));
  assert.equal(c.claims[0].predicate, 'is_good');
  assert.equal(a.extracted_by, 'macro', '宏卡必须自报来源，不许冒充 LLM 抽取');
});

test('⑦ 宏的判据：未知 kind／缺席位／对象是自己 ⇒ 400', async () => {
  const gid = await newGame();
  const cases = [
    [{ kind: 'fate', seat: 1, day: 1 }, /kind 必须是/],
    [{ kind: 'claim_role', seat: 1, day: 1 }, /role 必须/],
    [{ kind: 'check', seat: 1, day: 1 }, /target_seat/],
    [{ kind: 'check', seat: 2, target_seat: 2, day: 1 }, /不能是自己/],
    [{ kind: 'claim_role', seat: 99, role: '预言家', day: 1 }, /不在局/],
  ];
  for (const [body, re] of cases) {
    const r = await post(`/api/games/${gid}/events/macro`, body);
    assert.equal(r.statusCode, 400, JSON.stringify(body) + ' 应 400');
    assert.match(json(r).error, re);
  }
});

test('★⑧ 确认入账是原子的：事件 ＋ 声称 + 行动一次落完，并回报 id', async () => {
  const gid = await newGame();
  const r = await record(gid, { kind: 'claim_role', seat: 2, role: '预言家', day: 1 });
  assert.equal(r.statusCode, 201);
  const j = json(r);
  assert.ok(j.event_id > 0);
  assert.equal(j.claim_ids.length, 1);
  assert.deepEqual(j.warnings, []);
  const st = json(await get(`/api/games/${gid}/state`));
  assert.equal(st.events.length, 1);
  assert.equal(st.claims.length, 1);
});

test('★⑨ 确认失败 ⇒ 零行写入（不能留下查无此事的查杀）', async () => {
  const gid = await newGame();
  const r = await post(`/api/games/${gid}/events/confirm`, {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 2, raw_text: '我查杀4号' },
    claims: [
      { seat: 2, subject_seat: 4, predicate: 'is_wolf', object: '查杀' },
      { seat: 2, subject_seat: 3, predicate: 'is_神', object: 'x' },   // 非法谓词
    ],
    actions: [], extracted_by: 'macro',
  });
  assert.equal(r.statusCode, 400);
  const st = json(await get(`/api/games/${gid}/state`));
  assert.equal(st.events.length, 0, '★事件也必须没落');
  assert.equal(st.claims.length, 0, '★声称也必须没落');
});

test('⑩ 局详情／状态／导出 三个读口形状', async () => {
  const gid = await newGame();
  await record(gid, { kind: 'claim_role', seat: 2, role: '预言家', day: 1 });
  const d = json(await get(`/api/games/${gid}`));
  assert.equal(d.game.id, gid);
  assert.equal(d.players.length, 8);
  const st = json(await get(`/api/games/${gid}/state`));
  assert.equal(st.game.current_day, 1);
  assert.ok(Array.isArray(st.events) && Array.isArray(st.claims) && Array.isArray(st.actions));
  const ex = json(await get(`/api/games/${gid}/export`));
  assert.equal(ex.meta.schema_contract, 'jujian-v1');
  assert.equal(ex.meta.counts.events, 1);
  for (const [url, re] of [
    ['/api/games/999999', /局不存在/],
    ['/api/games/abc', /必须是 ≥1 的整数/],
  ]) {
    const r = await get(url);
    assert.match(r.statusCode === 404 ? json(r).error : json(r).error, re);
  }
});

test('⑪ uptoDay 是真闸：回放第 1 天时看不到第 2 天', async () => {
  const gid = await newGame();
  await record(gid, { kind: 'claim_role', seat: 2, role: '预言家', day: 1 });
  await record(gid, { kind: 'claim_role', seat: 5, role: '女巫', day: 2 });
  assert.equal(json(await get(`/api/games/${gid}/state`)).events.length, 2);
  assert.equal(json(await get(`/api/games/${gid}/state?uptoDay=1`)).events.length, 1);
  assert.equal(json(await get(`/api/games/${gid}/state?uptoDay=0`)).status, 400);
});

test('⑫ 席位改名：生效且非法路径 400', async () => {
  const gid = await newGame();
  const ok1 = await put(`/api/games/${gid}/seats`, { seats: [{ seat: 1, name: '阿泽' }] });
  assert.equal(ok1.statusCode, 200);
  assert.equal(json(await get(`/api/games/${gid}`)).players[0].name, '阿泽');
  for (const [body, re] of [
    [{ seats: [] }, /非空数组/],
    [{ seats: [{ seat: 1, name: '' }] }, /必须是非空字符串/],
    [{ seats: [{ seat: 99, name: 'x' }] }, /不在局/],
  ]) {
    const r = await put(`/api/games/${gid}/seats`, body);
    assert.equal(r.statusCode, 400);
    assert.match(json(r).error, re);
  }
});

// ══ 声称与行动的改撤（账本纪律）══════════════════════════════════════════

test('★⑬ 声称：改 → 标已确认；撤 → 视图消失但行仍在；撤回后改 ⇒ 409', async () => {
  const gid = await newGame();
  const cid = json(await record(gid, { kind: 'claim_role', seat: 2, role: '预言家', day: 1 })).claim_ids[0];
  const ed = await post(`/api/games/${gid}/claims/${cid}/edit`, { object: '预言家（我改口了）' });
  assert.equal(ed.statusCode, 200);
  assert.equal(json(ed).claim.confirmed_by_user, 1, '人工改过的声称必须标已确认');

  assert.equal(json(await post(`/api/games/${gid}/claims/${cid}/retract`, {})).retracted, true);
  assert.equal(json(await get(`/api/games/${gid}/state`)).claims.length, 0, '撤回后视图里看不见');

  const again = await post(`/api/games/${gid}/claims/${cid}/edit`, { object: 'x' });
  assert.equal(again.statusCode, 409, '★撤回后改写必须 409');
  assert.match(json(again).error, /已撤回/);
});

test('⑭ 行动：改撤同理，归属错局 ⇒ 404', async () => {
  const gid = await newGame();
  const g2 = await newGame();
  const r = await post(`/api/games/${gid}/events/confirm`, {
    event: { day: 1, phase: 'day', type: 'vote', actor_seat: 3, raw_text: '我投4号' },
    claims: [], actions: [{ seat: 3, action: 'vote', target_seat: 4, result: '放逐4号' }],
    extracted_by: 'macro',
  });
  assert.equal(r.statusCode, 201);
  const aid = json(r).action_ids[0];
  assert.equal(json(await post(`/api/games/${gid}/actions/${aid}/edit`, { result: '改判' })).action.result, '改判');
  assert.equal(json(await post(`/api/games/${g2}/actions/${aid}/retract`, {})).status, 404, '跨局撤回必须 404');
  assert.equal(json(await post(`/api/games/${gid}/actions/${aid}/retract`, {})).ok, true);
});

// ══ BOTC ════════════════════════════════════════════════════════════════

test('⑮ BOTC 建局挂剧本；通用谓词照走主表，BOTC 谓词走私有表', async () => {
  const gid = await newGame({ type: 'botc', player_count: 10, script: 'tb' });
  assert.equal(json(await get(`/api/games/${gid}`)).game.script, 'tb');
  const r = await record(gid, { kind: 'claim_role', seat: 2, role: '小恶魔', day: 1 });
  assert.equal(json(r).claim_ids.length, 1, '角色类声称归一后走主表');
  const st = json(await get(`/api/games/${gid}/state`));
  assert.equal(st.claims[0].object, 'imp', '★角色名必须归一为 id');
});

test('★⑯ 三条护栏：能修的不拒，要人确认的才拒', async () => {
  const gid = await newGame({ type: 'botc', player_count: 10, script: 'tb' });
  // 护栏①：阵营词被当成角色名 → 修复归入 botc_claims，留痕不拒
  const r1 = json(await record(gid, { kind: 'claim_role', seat: 4, role: '恶魔', day: 1 }));
  assert.equal(r1.botc_claim_ids.length, 1, '★阵营词必须落私有表');
  assert.equal(r1.claim_ids.length, 0, '不得混进通用声称');
  assert.equal(r1.warnings.length, 1);
  assert.match(r1.warnings[0], /阵营\/状态词/);

  // 护栏②：角色名解析不出 → 降级 said 留痕，不拒不丢
  const r2 = json(await record(gid, { kind: 'claim_role', seat: 6, role: '孙子', day: 1 }));
  assert.equal(r2.warnings.length, 1);
  const st2 = json(await get(`/api/games/${gid}/state`));
  const last = st2.claims[st2.claims.length - 1];
  assert.equal(last.predicate, 'said');
  assert.equal(last.object, '孙子', '★原词必须留着，不许丢');

  // 护栏③：能解析但越剧本 → 400
  const r3 = await record(gid, { kind: 'claim_role', seat: 7, role: '教授', day: 1 });   // 教授属 bmr
  assert.equal(r3.statusCode, 400, '★越剧本必须拒');
  assert.match(json(r3).error, /不属于剧本/);
});

test('⑰ BOTC 专属声称可读可撤；未挂剧本局录阵营声称 ⇒ 400', async () => {
  const gid = await newGame({ type: 'botc', player_count: 10, script: 'tb' });
  await record(gid, { kind: 'claim_role', seat: 2, role: '恶魔', day: 1 });
  // 读口形状是 {game_id, claims:[…]}，不是裸数组（第一版按数组写，被形状判红）。
  const list = json(await get(`/api/games/${gid}/botc-claims`));
  assert.equal(list.game_id, gid);
  assert.equal(list.claims.length, 1);
  assert.equal(list.claims[0].predicate, 'is_demon');
  const bid = list.claims[0].id;
  assert.equal(json(await post(`/api/games/${gid}/botc-claims/${bid}/retract`, {})).ok, true);
  assert.equal(json(await get(`/api/games/${gid}/botc-claims`)).claims.length, 0);
  assert.equal(json(await post(`/api/games/${gid}/botc-claims/${bid}/edit`, { object: 'x' })).status, 409);

  const noScript = await newGame({ type: 'botc', player_count: 10 });
  const r = await post(`/api/games/${noScript}/events/confirm`, {
    event: { day: 1, phase: 'day', type: 'claim', actor_seat: 2, raw_text: '我是恶魔' },
    claims: [{ seat: 2, subject_seat: 2, predicate: 'is_demon', object: '' }], actions: [],
  });
  assert.equal(r.statusCode, 400);
  assert.match(json(r).error, /未挂剧本/);
});

// ══ 天结算参谋卡 ════════════════════════════════════════════════════════

test('★⑱ 天结算：异步 202 → 轮询到卡；矛盾必须带描述 ＋ 无辜解释', async () => {
  const gid = await newGame();
  await record(gid, { kind: 'claim_role', seat: 2, role: '预言家', day: 1 });
  await record(gid, { kind: 'claim_role', seat: 6, role: '预言家', day: 2 });   // 对跳

  const enq = await post(`/api/games/${gid}/day/2/advise`, {});
  assert.equal(enq.statusCode, 202, '★录入不得被阻塞，必须异步');
  const { task_id } = json(enq);

  let done = null;
  for (let i = 0; i < 60 && !done; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const t = json(await get('/api/tasks/' + task_id));
    if (t.status !== 'running') done = t;
  }
  assert.ok(done, '参谋卡必须在限定轮次内出结果');
  assert.equal(done.status, 'done', done.error || '');
  const card = done.card;
  assert.ok(card.contradictions.length >= 1, '两个都跳预言家，应当抓到对跳');
  for (const c of card.contradictions) {
    assert.ok(c.conflict_desc, '★每条矛盾必须有描述（这是本批修掉的缺陷）');
    assert.ok(c.innocent_explanations.length >= 1, '★RD1：没有无辜解释的矛盾不得展示');
  }
  assert.ok(Array.isArray(card.checklist), '验证点应作为「明天盯什么」的清单');
});

test('⑲ 当天无事件 ⇒ 400（不产出空卡）；任务不存在 ⇒ 404', async () => {
  const gid = await newGame();
  assert.equal((await post(`/api/games/${gid}/day/1/advise`, {})).statusCode, 400);
  assert.equal((await get('/api/tasks/adv-nonexistent')).statusCode, 404);
});

test('⑳ 参谋卡按天回读（读已落库数据，不重算）；单天 404', async () => {
  const gid = await newGame();
  await record(gid, { kind: 'claim_role', seat: 2, role: '预言家', day: 1 });
  await record(gid, { kind: 'claim_role', seat: 6, role: '预言家', day: 2 });
  await post(`/api/games/${gid}/day/2/advise`, {});
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const cards = json(await get(`/api/games/${gid}/cards`));
    if (cards.cards.length) break;
  }
  const cards = json(await get(`/api/games/${gid}/cards`));
  assert.equal(cards.cards.length, 1);
  assert.equal(cards.cards[0].day, 2);
  assert.ok(Array.isArray(cards.cards[0].hypotheses));
  assert.equal((await get(`/api/games/${gid}/cards/1`)).statusCode, 404);
  assert.equal((await get(`/api/games/${gid}/cards/2`)).statusCode, 200);
});

test('㉑ 重复天结算不灌水：同日重跑覆盖而非累加', async () => {
  const gid = await newGame();
  await record(gid, { kind: 'claim_role', seat: 2, role: '预言家', day: 1 });
  await record(gid, { kind: 'claim_role', seat: 6, role: '预言家', day: 1 });
  const run = async () => {
    const e = json(await post(`/api/games/${gid}/day/1/advise`, {}));
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const t = json(await get('/api/tasks/' + e.task_id));
      if (t.status !== 'running') return t;
    }
    return null;
  };
  const first = await run();
  const c1 = json(await get(`/api/games/${gid}/cards/1`));
  const second = await run();
  const c2 = json(await get(`/api/games/${gid}/cards/1`));

  assert.equal(second.card.saved, true, '★第二次必须真的写进去了');
  assert.equal(second.card.save_error, null, '★不许有回存错误');
  assert.equal(c2.hypotheses.length, c1.hypotheses.length, '★假设条数不得翻倍');
  assert.equal(c2.contradictions.length, c1.contradictions.length, '★矛盾条数不得翻倍');
  // replaced 现在是「替换掉了多少」的明细，不是布尔。
  // （第一版断言 replaced===true，是照着修复前的坏形状写的 —— 修好后它才带明细。）
  assert.equal(first.card.replaced, null, '第一次没有旧卡可替换');
  assert.equal(typeof second.card.replaced, 'object', '第二次应自报它替换掉了什么');
  assert.ok(second.card.replaced.deleted_hypotheses > 0, '应确实删了旧假设');
  assert.ok(second.card.replaced.written > 0, '应确实写了新卡');
});

// ══ 幂等 ════════════════════════════════════════════════════════════════

test('★㉒ 幂等：同键重发建局 ⇒ 同一局；不带键照写但如实回报', async () => {
  const body = { name: '幂等局', type: 'werewolf', player_count: 6 };
  const h = { 'idempotency-key': 'k-api-001' };
  const a = await post('/api/games', body, h);
  const b = await post('/api/games', body, h);
  assert.equal(json(a).game.id, json(b).game.id, '★AI 默认重试不该多建一局');

  const noKey = await post('/api/games', { name: '无键局', type: 'werewolf', player_count: 6 });
  assert.equal(noKey.statusCode, 201, '不带键不拒绝，但必须照写');
  assert.equal(json(noKey).idempotency.provided, false);
  assert.ok(json(noKey).idempotency.why, '必须说清为什么不带键也有后果');
});

// ══ 令牌门 ══════════════════════════════════════════════════════════════

test('★㉓ 对外监听却不带令牌 ⇒ 拒绝启动（抛错，不是警告）', () => {
  assert.throws(() => server.resolveListenConfig({ JUJIAN_HOST: '0.0.0.0' }), /拒绝启动/);
  const cfg = server.resolveListenConfig({ JUJIAN_HOST: '0.0.0.0', JUJIAN_SHARED_TOKEN: 'abc' });
  assert.equal(cfg.requiresToken, true);
  assert.equal(server.resolveListenConfig({}).requiresToken, false);
  assert.equal(server.resolveListenConfig({}).host, '127.0.0.1', '默认必须只听本机');
});

test('㉔ 令牌比较定长：不等长不比较，不抛错', () => {
  assert.equal(server.tokenEquals('abc', 'abc'), true);
  assert.equal(server.tokenEquals('abc', 'abcd'), false);
  assert.equal(server.tokenEquals('', 'abc'), false);
  assert.equal(server.tokenEquals(null, undefined), false);
});

// ══ 自由文本抽取（MOCK，零网络）══════════════════════════════════════════

test('㉕ 抽取端点在 MOCK 模式下返回待确认卡，不写库', async () => {
  const gid = await newGame();
  const r = await post(`/api/games/${gid}/events/extract`, { text: '我是3号预言家，昨晚验的4号是狼' });
  assert.equal(r.statusCode, 200);
  const j = json(r);
  assert.ok(Array.isArray(j.claims));
  assert.equal(j.meta.mode, 'MOCK', '★必须自报 MOCK，不许冒充真实模型');
  assert.equal(json(await get(`/api/games/${gid}/state`)).events.length, 0, '抽取不落库，落库要过确认闸');
  assert.equal((await post(`/api/games/${gid}/events/extract`, {})).statusCode, 400);
});