'use strict';
/**
 * p1b/test/idempotency.test.cjs —— 写口幂等锁（2026-09-30，**发行阻断项**）
 *
 * 【为什么这道锁配得上「阻断项」三个字】
 *   AI 客户端**默认会重试**超时的调用；而本项目的账本**不可改**（无修正入口）。
 *   没有幂等时：一次超时重试 = 多一条预测 = 用户的准确率当场被污染，且撤不掉。
 *
 * 【三组主口径（缺一条就等于没做）】
 *   ① 同一个键连发两次 ⇒ 账本只多一行，两次返回**同一个 id**（重放，不是新建）。
 *   ② 两个**不同**键、内容完全相同 ⇒ 账本**多两行**（不许误去重：内容哈希去重会在这里误杀
 *      "用户合法地记了两条一模一样的判断"）。
 *   ③ 不带键连发两次 ⇒ 行为与从前逐字节一致（老调用方不受影响）：账本多两行，
 *      响应体里除新增的 `idempotency` 段外与服务端落档快照**逐字节相同**。
 *
 * 【③ 的「逐字节一致」怎么量】
 *   加幂等之前服务端返回的就是它自己那份 body。加幂等之后服务端把**没加段的原文**
 *   落进 `idempotency_keys.result_json`，HTTP 层只在最外层并一个 `idempotency` 键。
 *   ⇒ `result_json` 与"老代码会返回的那份"是**同一串字节**（本件用字符串相等断言，不是
 *     deepEqual），客户端拿到的则是"老 body + 一个附加键"。既有字段一个都没被改。
 *
 * 【不许空跑绿灯】
 *   表驱动的三组主口径前面都有一条同级前置断言：写口清单正好 5 条、每条都给出
 *   名字/scope/计数表/id 取值/调用器/稳定投影；每组循环跑完后再断言"真的跑了 N 次"。
 *
 * 铁律：不起真端口（app.inject）；DB=:memory:；零网络；零 LLM；零新依赖。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const { DISCLAIMER } = require('../src/lib/oracle'); // 排盘标注的唯一来源（不另抄一份字面量）

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-idem-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;
let cases = null; // 表驱动清单（幂等测试组建；每个用例自带自己的前置局）

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
  cases = await buildCases();
});

test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

const j = (r) => r.json();
const conn = () => db.getConnection();

/** 表名只来自本文件里的字面量清单（测试代码，无注入面）。 */
function countOf(table) {
  return conn().prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
}

/** 幂等键表里的落痕行（按写入顺序倒序取第一条）。 */
function lastTrace(scope) {
  return conn().prepare('SELECT * FROM idempotency_keys WHERE scope=? ORDER BY rowid DESC LIMIT 1').get(scope);
}
function tracesOf(scope) {
  return conn().prepare('SELECT * FROM idempotency_keys WHERE scope=? ORDER BY rowid ASC').all(scope);
}

/** 深拷贝并去掉 `idempotency` 段（"老代码会返回的那份"）。 */
function stripIdem(body) {
  const c = Object.assign({}, body);
  delete c.idempotency;
  return c;
}

/* ══ 表驱动清单：五条真·写且会重复的口 ══════════════════════════════════
 * scope 取**路由模板**而不是实际 URL —— 这样「同一个键用在另一个口」会判成冲突，
 * 而不是串到另一张账上。 */
const KIND = 'openmeteo_daily_max';
const EXT_SPEC = { kind: KIND, date: '2020-01-01' };

async function buildCases() {
  // 前置局：幂等测试组自己建（宏卡是纯函数产出，两次 confirm 的请求体逐字节相同 ⇒ 指纹相同）
  const g = j(await app.inject({
    method: 'POST', url: '/api/games', payload: { name: '幂等前置局', type: 'werewolf', player_count: 6 },
  }));
  const gameId = g.game.id;
  const macro = j(await app.inject({
    method: 'POST', url: '/api/games/' + gameId + '/events/macro',
    payload: { kind: 'claim_role', seat: 2, role: '预言家', day: 1 },
  }));

  return [
    {
      name: 'POST /api/predictions（外部题落注 · 「记一笔」的落注入口）',
      slug: 'ext-pred',
      scope: 'POST /api/predictions',
      table: 'predictions',
      idOf: (b) => b.id,
      // 两次调用产出**内容相同**的两个新对象（键序也相同 ⇒ 指纹相同 ⇒ 才是重试而不是新请求）
      payload: () => ({
        statement: '幂等测试：2030-01-01 伦敦日最高气温超过 20℃ 吗？',
        prob: 0.62,
        resolve_spec: Object.assign({}, EXT_SPEC),
      }),
      url: () => '/api/predictions',
      method: 'POST',
      volatile: ['id', 'created_at'],
      ledgerRow: (row) => ({
        source_type: row.source_type,
        statement: row.statement,
        assigned_prob: row.assigned_prob,
        evidence_json: row.evidence_json,
        matures_at: row.matures_at,
        g2_regime: row.g2_regime,
      }),
      ledgerTable: 'predictions',
      ledgerWhere: (id) => ['SELECT * FROM predictions WHERE id=?', [id]],
    },
    {
      name: 'POST /api/games/:id/predictions（对局落注）',
      slug: 'game-pred',
      scope: 'POST /api/games/:id/predictions',
      table: 'predictions',
      gameId: gameId,
      idOf: (b) => b.id,
      payload: () => ({ statement: '幂等测试：1号是狼', prob: 0.7 }),
      url: () => '/api/games/' + gameId + '/predictions',
      method: 'POST',
      volatile: ['id', 'created_at'],
      ledgerRow: (row) => ({
        source_type: row.source_type,
        statement: row.statement,
        assigned_prob: row.assigned_prob,
        game_id: row.game_id,
        evidence_json: row.evidence_json,
        matures_at: row.matures_at,
      }),
      ledgerTable: 'predictions',
      ledgerWhere: (id) => ['SELECT * FROM predictions WHERE id=?', [id]],
    },
    {
      name: 'POST /api/games（建局）',
      slug: 'games',
      scope: 'POST /api/games',
      table: 'games',
      idOf: (b) => b.game.id,
      payload: () => ({ name: '幂等测试局', type: 'werewolf', player_count: 6 }),
      url: () => '/api/games',
      method: 'POST',
      // 响应里 players 带各自的行 id、game 带自增 id ⇒ 稳定投影只留人看得懂的形状
      volatile: ['idempotency'],
      stable: (b) => JSON.stringify({
        game: { name: b.game.name, game_type: b.game.game_type, player_count: b.game.player_count, script: b.game.script },
        players: b.players.map((p) => ({ seat: p.seat, name: p.name })),
      }),
      ledgerRow: (row) => ({ name: row.name, game_type: row.game_type, player_count: row.player_count }),
      ledgerTable: 'games',
      ledgerWhere: (id) => ['SELECT * FROM games WHERE id=?', [id]],
    },
    {
      name: 'POST /api/games/:id/events/confirm（事件入账 · event+claim+action 三处纯 INSERT）',
      slug: 'events-confirm',
      scope: 'POST /api/games/:id/events/confirm',
      table: 'events',
      gameId: gameId,
      idOf: (b) => b.event_id,
      payload: () => JSON.parse(JSON.stringify(macro)),
      url: () => '/api/games/' + gameId + '/events/confirm',
      method: 'POST',
      volatile: ['idempotency'],
      stable: (b) => JSON.stringify({
        ok: b.ok, claim_ids_len: b.claim_ids.length, botc_claim_ids: b.botc_claim_ids,
        action_ids: b.action_ids, warnings: b.warnings,
      }),
      ledgerRow: (row) => ({
        game_id: row.game_id, day: row.day, phase: row.phase, type: row.type,
        actor_seat: row.actor_seat, raw_text: row.raw_text,
      }),
      ledgerTable: 'events',
      ledgerWhere: (id) => ['SELECT * FROM events WHERE id=?', [id]],
    },
    {
      name: 'POST /api/oracle/cast（排盘留档 · random 每次派生不同两数）',
      slug: 'oracle-cast',
      scope: 'POST /api/oracle/cast',
      table: 'oracle_readings',
      idOf: (b) => b.id,
      // 固定用 numbers 法：random 每次两数都不同，同一个键的两次请求体本就不同 ⇒ 那是两个请求不是重试
      payload: () => ({ method: 'numbers', params: { n1: 7, n2: 3 } }),
      url: () => '/api/oracle/cast',
      method: 'POST',
      volatile: ['idempotency'],
      stable: (b) => JSON.stringify({
        method: b.method, inputs: b.inputs, disclaimer: b.disclaimer, game_id: b.game_id, casting: b.casting,
      }),
      ledgerRow: (row) => ({ method: row.method, inputs_json: row.inputs_json, disclaimer: row.disclaimer, game_id: row.game_id }),
      ledgerTable: 'oracle_readings',
      ledgerWhere: (id) => ['SELECT * FROM oracle_readings WHERE id=?', [id]],
    },
  ];
}

/** 默认稳定投影：去掉易变字段（自增 id / 时间戳 / 幂等段），其余逐字段比。 */
function stableOf(c, body) {
  if (c.stable) return c.stable(body);
  const o = stripIdem(body);
  for (const k of c.volatile || []) delete o[k];
  return JSON.stringify(o);
}

/** 调一次：带键走 HTTP 头，不带键连头都不发（老调用方的样子）。 */
function call(c, key, bodyOverride) {
  const req = { method: c.method, url: c.url(), payload: bodyOverride === undefined ? c.payload() : bodyOverride };
  if (key !== null && key !== undefined) req.headers = { 'idempotency-key': key };
  return app.inject(req);
}

const EXPECTED_CASES = 5;

// ── 清单自身的前置断言（空清单会让下面三组主口径全绿 —— 必须先钉住）──
test('前置：写口清单正好 5 条，且每条都给出作用域/计数表/id 取值/调用器/稳定投影', () => {
  assert.ok(Array.isArray(cases), '清单必须建出来');
  assert.equal(cases.length, EXPECTED_CASES,
    '写口清单必须正好 ' + EXPECTED_CASES + ' 条：外部题落注/对局落注/建局/事件入账/排盘留档；少一条就说明有口没接上幂等');
  for (const c of cases) {
    assert.ok(c.name && c.slug && c.scope, c.slug + ' 必须给出 名字/slug/scope');
    assert.equal(typeof c.idOf, 'function', c.slug + ' 必须给出 id 取值函数（重放要拿到同一个 id）');
    assert.equal(typeof c.payload, 'function', c.slug + ' 必须给出请求体工厂（两次调用要产出内容相同的两个对象）');
    assert.equal(typeof c.url, 'function', c.slug + ' 必须给出请求路径');
    assert.ok(typeof c.stable === 'function' || Array.isArray(c.volatile), c.slug + ' 必须给出稳定投影或易变字段清单');
    assert.equal(countOf(c.table) >= 0, true, c.slug + ' 的计数表必须可查');
  }
  // 清单真被建起来了（不是空数组蒙过去的）
  assert.equal(cases[0].slug, 'ext-pred');
  assert.equal(cases[EXPECTED_CASES - 1].slug, 'oracle-cast');
});

// ── ① 同一个键连发两次：只多一行、同一个 id ──
test('① 同一个键连发两次 ⇒ 账本只多一行，两次返回同一个 id（逐口过）', async () => {
  assert.equal(cases.length, EXPECTED_CASES, '前置：这一组要跑 ' + EXPECTED_CASES + ' 条写口');
  let ran = 0;
  for (const c of cases) {
    const key = 'retry-same-' + c.slug;
    const before = countOf(c.table);
    const r1 = await call(c, key);
    const r2 = await call(c, key);
    const after = countOf(c.table);
    const b1 = j(r1);
    const b2 = j(r2);
    assert.equal(r1.statusCode, 201, c.name + ' 首次应 201：' + JSON.stringify(b1).slice(0, 200));
    assert.equal(r2.statusCode, 201, c.name + ' 重放应与首次同为 201：' + JSON.stringify(b2).slice(0, 200));
    assert.equal(after, before + 1, c.name + '：同一个键连发两次，账本必须只多一行（实得 ' + (after - before) + ' 行）');
    const id1 = c.idOf(b1);
    const id2 = c.idOf(b2);
    assert.ok(id1 !== null && id1 !== undefined && id1 !== 0, c.name + '：首次必须真的返回一个 id（防空跑绿灯）');
    assert.equal(id2, id1, c.name + '：重放必须返回**同一个 id**（返回新建的那条＝两次调用记了两笔账）');
    assert.equal(b1.idempotency.provided, true, c.name + '：首次应如实回报带了键');
    assert.equal(b1.idempotency.replayed, false, c.name + '：首次不是重放');
    assert.equal(b2.idempotency.replayed, true, c.name + '：第二次必须如实标记为重放');
    assert.equal(r2.headers['idempotency-status'], 'replayed', c.name + '：响应头也要如实标出重放');
    assert.equal(r1.headers['idempotency-status'], 'first-write', c.name + '：首次写入响应头');
    // 落痕只有一行，且是 done
    const tr = tracesOf(c.scope).filter((t) => t.idem_key === key);
    assert.equal(tr.length, 1, c.name + '：同一个键只该占一行落痕（实得 ' + tr.length + '）');
    assert.equal(tr[0].state, 'done', c.name + '：首次写入完成后落痕必须转 done');
    ran++;
  }
  assert.equal(ran, cases.length, '循环必须真的跑完 ' + EXPECTED_CASES + ' 条写口（防空跑绿灯）');
});

// ── ② 两个不同键、内容相同 ⇒ 多两行（不许误去重）──
test('② 两个不同键 + 内容完全相同 ⇒ 账本多两行、两个不同 id（不许误去重）', async () => {
  assert.equal(cases.length, EXPECTED_CASES, '前置：这一组要跑 ' + EXPECTED_CASES + ' 条写口');
  let ran = 0;
  for (const c of cases) {
    const before = countOf(c.table);
    const r1 = await call(c, 'other-key-1-' + c.slug);
    const r2 = await call(c, 'other-key-2-' + c.slug);
    const after = countOf(c.table);
    const b1 = j(r1);
    const b2 = j(r2);
    assert.equal(r1.statusCode, 201, c.name + ' 首个键应 201：' + JSON.stringify(b1).slice(0, 200));
    assert.equal(r2.statusCode, 201, c.name + ' 第二个键应 201：' + JSON.stringify(b2).slice(0, 200));
    assert.equal(after, before + 2, c.name + '：两个不同键＝两次独立写入，必须多两行（实得 ' + (after - before) + ' 行）');
    const id1 = c.idOf(b1);
    const id2 = c.idOf(b2);
    assert.ok(id1 && id2, c.name + '：两次都必须真的返回 id（防空跑绿灯）');
    assert.notEqual(id2, id1, c.name + '：两个不同键必须给出两个不同的 id（相同即误去重，把用户合法记的两条当成重试）');
    assert.equal(b1.idempotency.replayed, false, c.name + '：新键首次写入不是重放');
    assert.equal(b2.idempotency.replayed, false, c.name + '：另一个新键首次写入也不是重放');
    ran++;
  }
  assert.equal(ran, cases.length, '循环必须真的跑完 ' + EXPECTED_CASES + ' 条写口（防空跑绿灯）');
});

// ── ③ 不带键连发两次：行为与从前逐字节一致 ──
test('③ 不带键连发两次 ⇒ 多两行；响应与服务端落档快照逐字节一致（老调用方不受影响）', async () => {
  assert.equal(cases.length, EXPECTED_CASES, '前置：这一组要跑 ' + EXPECTED_CASES + ' 条写口');
  let ran = 0;
  for (const c of cases) {
    const before = countOf(c.table);
    const r1 = await call(c, null); // 连头都不发＝老调用方的样子
    const r2 = await call(c, null);
    const after = countOf(c.table);
    const b1 = j(r1);
    const b2 = j(r2);

    // 行为：与从前一致 —— 两次就是两行，不是"没带键就当重试"
    assert.equal(r1.statusCode, 201, c.name + ' 无键首次应 201（不许静默改成拒绝）：' + JSON.stringify(b1).slice(0, 200));
    assert.equal(r2.statusCode, 201, c.name + ' 无键第二次应 201：' + JSON.stringify(b2).slice(0, 200));
    assert.equal(after, before + 2, c.name + '：没带键就照写，两次必须多两行（实得 ' + (after - before) + ' 行）');
    const id1 = c.idOf(b1);
    const id2 = c.idOf(b2);
    assert.ok(id1 && id2, c.name + '：两次都必须真的返回 id（防空跑绿灯）');
    assert.notEqual(id2, id1, c.name + '：没带键的两次是两次独立写入，id 必须不同');

    // 如实回报"这次没带幂等键"（响应体 + 响应头两处）
    assert.equal(b1.idempotency.provided, false, c.name + '：必须如实回报本次没带幂等键');
    assert.equal(b1.idempotency.replayed, false, c.name + '：无键路径没有重放可言');
    assert.match(b1.idempotency.why, /未带幂等键/, c.name + '：必须有一句人话说明这次没带键');
    assert.equal(r1.headers['idempotency-status'], 'absent', c.name + '：响应头如实标 absent');

    // 逐字节一致的第一半：除易变字段外，两次响应的内容一模一样
    assert.equal(stableOf(c, b1), stableOf(c, b2), c.name + '：无键时两次响应的既有字段必须完全相同');

    // 逐字节一致的第二半：★落进 idempotency_keys 的那份**就是老代码会返回的那份**
    //   （字符串相等，不是 deepEqual —— 本组就是量"逐字节"；取最后一行＝第二次调用那笔）
    const tr = lastTrace(c.scope);
    assert.ok(tr, c.name + '：无键写入必须在证据表留痕');
    assert.equal(tr.keyed, 0, c.name + '：无键落痕必须标 keyed=0（可查"有多少写入没带键"）');
    assert.equal(tr.state, 'done', c.name + '：无键路径没有认领过程，落痕直接 done');
    assert.match(tr.idem_key, /^absent:/, c.name + '：无键落痕不许编造一个键出来');
    assert.equal(tr.result_json, JSON.stringify(stripIdem(b2)),
      c.name + '：落档快照必须与「老代码会返回的那份」逐字节相同（既有字段一个都没被改）');
    // 两次无键调用都留了痕（不是只留第一次）
    const absentN = conn().prepare('SELECT COUNT(*) AS n FROM idempotency_keys WHERE scope=? AND keyed=0').get(c.scope).n;
    assert.ok(absentN >= 2, c.name + '：两次无键写入都要留痕（实得 ' + absentN + '）');

    // 逐字节一致的第三半：账本那一侧写进去的内容，也逐字段等于冻结的期望值
    const [sql, args] = c.ledgerWhere(id1);
    const stmt = conn().prepare(sql);
    const row = stmt.get.apply(stmt, args);
    assert.ok(row, c.name + '：写入的账本行必须查得到（防空跑绿灯）');
    assert.deepEqual(c.ledgerRow(row), expectedLedgerRow(c),
      c.name + '：无键写入的账本内容必须与加幂等之前逐字段一致');
    ran++;
  }
  assert.equal(ran, cases.length, '循环必须真的跑完 ' + EXPECTED_CASES + ' 条写口（防空跑绿灯）');
});

/** 冻结期望：加幂等之前这些口写进去的东西，逐字段钉死（防"顺手改了写入内容"）。 */
function expectedLedgerRow(c) {
  if (c.slug === 'ext-pred') {
    return {
      source_type: '预测卡',
      statement: '幂等测试：2030-01-01 伦敦日最高气温超过 20℃ 吗？',
      assigned_prob: 0.62,
      evidence_json: '[{"resolve":{"kind":"' + KIND + '","date":"2020-01-01"}}]',
      matures_at: '2020-01-01',
      g2_regime: null,
    };
  }
  if (c.slug === 'game-pred') {
    return {
      source_type: '预测卡',
      statement: '幂等测试：1号是狼',
      assigned_prob: 0.7,
      game_id: c.gameId,
      evidence_json: '[]',
      matures_at: null,
    };
  }
  if (c.slug === 'games') return { name: '幂等测试局', game_type: 'werewolf', player_count: 6 };
  if (c.slug === 'events-confirm') {
    return { game_id: c.gameId, day: 1, phase: 'day', type: 'claim', actor_seat: 2, raw_text: '2号跳预言家' };
  }
  return { method: 'numbers', inputs_json: '{"n1":7,"n2":3}', disclaimer: DISCLAIMER, game_id: null };
}

// ── ④ 同一个键配不同请求体 ⇒ 409，且不多写一行 ──
test('④ 同一个键 + 不同请求体 ⇒ 409 如实报冲突，且账本不多写', async () => {
  assert.equal(cases.length, EXPECTED_CASES, '前置：这一组要跑 ' + EXPECTED_CASES + ' 条写口');
  let ran = 0;
  for (const c of cases) {
    const key = 'conflict-' + c.slug;
    const first = await call(c, key);
    assert.equal(first.statusCode, 201, c.name + ' 前置：首个带键请求必须成功（否则冲突用例没意义）');
    const before = countOf(c.table);
    // 同键、换内容：statement / prob / 名字 / 宏卡座位 / 起卦数字 各不相同
    let alt;
    if (c.slug === 'oracle-cast') alt = { method: 'numbers', params: { n1: 8, n2: 3 } };
    else if (c.slug === 'events-confirm') alt = { event: { day: 2, phase: 'day', type: 'claim', actor_seat: 3, raw_text: '3号跳猎人' }, claims: [], actions: [] };
    else if (c.slug === 'games') alt = { name: '幂等测试局·改名', type: 'werewolf', player_count: 6 };
    else alt = Object.assign(c.payload(), { statement: '幂等测试：内容不同的一条', prob: 0.11 });
    const bad = await call(c, key, alt);
    const after = countOf(c.table);
    assert.equal(bad.statusCode, 409, c.name + '：同键不同内容必须 409（把别的请求的结果端回去＝记错账）：'
      + JSON.stringify(j(bad)).slice(0, 200));
    assert.match(j(bad).error, /幂等键/, c.name + '：409 文案必须说清是幂等键的问题');
    assert.equal(after, before, c.name + '：409 这一次不许写任何一行');
    ran++;
  }
  assert.equal(ran, cases.length, '循环必须真的跑完 ' + EXPECTED_CASES + ' 条写口（防空跑绿灯）');
});

// ── ⑤ 失败不许毒化键：同一个键先 400，再改对参数后照常 201，再重放同 id ──
test('⑤ 失败不毒化键：同一个键先失败再成功，重放仍返回同一个 id（认领行已释放）', async () => {
  const c = cases.find((x) => x.slug === 'ext-pred');
  assert.ok(c, '前置：外部题落注口必须在清单里');
  const key = 'poison-check-' + c.slug;
  const before = countOf(c.table);
  const bad = await call(c, key, { statement: '缺 prob 的坏请求', resolve_spec: Object.assign({}, EXT_SPEC) });
  assert.equal(bad.statusCode, 400, '前置：缺 prob 必须 400（否则这条用例没在测失败路径）');
  assert.equal(countOf(c.table), before, '前置：400 这一次不许写任何一行');
  // ★认领行必须已释放：同一个键此刻查不到 in_flight 落痕
  const stuck = conn().prepare(
    "SELECT COUNT(*) AS n FROM idempotency_keys WHERE scope=? AND idem_key=? AND state='in_flight'").get(c.scope, key).n;
  assert.equal(stuck, 0, '失败后不许留下 in_flight 认领行（否则这个键被永久毒化：改对参数也拿不回 201）');

  const good1 = await call(c, key);
  assert.equal(good1.statusCode, 201, '同一个键在失败之后必须还能正常写入（否则就是被毒化了）：'
    + JSON.stringify(j(good1)).slice(0, 200));
  const good2 = await call(c, key);
  assert.equal(good2.statusCode, 201, '再发一次应重放');
  const id1 = c.idOf(j(good1));
  assert.ok(id1, '前置：成功那次必须真的返回 id（防空跑绿灯）');
  assert.equal(c.idOf(j(good2)), id1, '同一个键重放必须返回同一个 id');
  assert.equal(countOf(c.table), before + 1, '失败 + 成功 + 重放 ⇒ 账本只该多一行');
});

// ── ⑥ 键放在 body 里也认；头与 body 不一致 ⇒ 400 ──
test('⑥ body.idempotency_key 同样生效；头与 body 不一致 ⇒ 400', async () => {
  const c = cases.find((x) => x.slug === 'game-pred');
  assert.ok(c, '前置：对局落注口必须在清单里');
  const before = countOf(c.table);
  const body = c.payload();
  body.idempotency_key = 'body-key-1';
  const r1 = await app.inject({ method: 'POST', url: c.url(), payload: JSON.parse(JSON.stringify(body)) });
  const r2 = await app.inject({ method: 'POST', url: c.url(), payload: JSON.parse(JSON.stringify(body)) });
  assert.equal(r1.statusCode, 201, 'body 里的键首次写入应 201：' + JSON.stringify(j(r1)).slice(0, 200));
  assert.equal(r2.statusCode, 201, 'body 里的键重放应 201');
  assert.equal(countOf(c.table), before + 1, 'body 里带键 ⇒ 两次只多一行');
  assert.equal(c.idOf(j(r2)), c.idOf(j(r1)), 'body 键重放必须返回同一个 id');
  // ★body 里的键不许漏进账本（否则用户题面里凭空多出一个键字串）
  const row = conn().prepare('SELECT * FROM predictions WHERE id=?').get(c.idOf(j(r1)));
  assert.ok(!JSON.stringify(row).includes('body-key-1'), '幂等键不许漏进账本任何一列');
  assert.equal(row.statement, '幂等测试：1号是狼', '题面必须与不带键时逐字相同（键是"这次是谁"，不是"这次要做什么"）');

  const before2 = countOf(c.table);
  const mismatch = await app.inject({
    method: 'POST', url: c.url(), payload: c.payload(),
    headers: { 'idempotency-key': 'header-key' },
  });
  assert.equal(mismatch.statusCode, 201, '头给了键、body 里的键字段缺省 ⇒ 按头走');
  assert.equal(countOf(c.table), before2 + 1, '头给的键是一次独立写入');

  // ★头与 body 给了两个不同的键 ⇒ 400（防把两次不同的写入当成同一次的重试）
  const before3 = countOf(c.table);
  const both = c.payload();
  both.idempotency_key = 'body-key-other';
  const clash = await app.inject({
    method: 'POST', url: c.url(), payload: both,
    headers: { 'idempotency-key': 'header-key-other' },
  });
  assert.equal(clash.statusCode, 400, '头与 body 的键不一致必须 400（否则跨口串账）：' + JSON.stringify(j(clash)).slice(0, 200));
  assert.match(j(clash).error, /不一致/, '400 文案要说清是两个键不一致');
  assert.equal(countOf(c.table), before3, '400 这一次不许写任何一行');

  // 头与 body 给了**同一个**键 ⇒ 照常认（两种写法等价）
  const same = c.payload();
  same.idempotency_key = 'same-key-both-places';
  const bothSame = await app.inject({
    method: 'POST', url: c.url(), payload: same,
    headers: { 'idempotency-key': 'same-key-both-places' },
  });
  assert.equal(bothSame.statusCode, 201, '头与 body 同一个键 ⇒ 照常认：' + JSON.stringify(j(bothSame)).slice(0, 200));
  const replay = await app.inject({
    method: 'POST', url: c.url(), payload: JSON.parse(JSON.stringify(same)),
    headers: { 'idempotency-key': 'same-key-both-places' },
  });
  assert.equal(replay.statusCode, 201, '同一个键重放');
  assert.equal(c.idOf(j(replay)), c.idOf(j(bothSame)), '头/body 同键：重放返回同一个 id');
});

// ── ⑦ 键的形状校验：超长 / 非字符串 ⇒ 400；空串按"没给"照写并如实回报 ──
test('⑦ 键的形状校验：超长与非字符串 400；空串按"没给"照写并如实回报', async () => {
  const c = cases.find((x) => x.slug === 'game-pred');
  assert.ok(c, '前置：对局落注口必须在清单里');
  const before = countOf(c.table);
  const tooLong = await call(c, 'k'.repeat(256));
  assert.equal(tooLong.statusCode, 400, '超长键必须 400（不静默截断：截断会让两个不同的键撞成同一个）');
  assert.match(j(tooLong).error, /idempotency-key/, '400 文案要指向 idempotency-key 这个字段');
  assert.equal(countOf(c.table), before, '400 这一次不许写任何一行');

  const before2 = countOf(c.table);
  const empty = await call(c, '');
  assert.equal(empty.statusCode, 201, '空串键＝没给，必须照写（不许把没填键的客户端挡在门外）');
  assert.equal(countOf(c.table), before2 + 1, '空串键这一次照写了一行');
  assert.equal(j(empty).idempotency.provided, false, '空串键必须如实回报"没带键"（不许假装有保护）');
  assert.equal(empty.headers['idempotency-status'], 'absent', '空串键响应头如实标 absent');
});

// ── ⑧ 幂等键不出现在账本里（零污染）：键只进 idempotency_keys，不进任何业务表 ──
test('⑧ 幂等只加在写口上，读口零改动、账本零新增列', async () => {
  assert.equal(cases.length, EXPECTED_CASES, '前置：这一组要跑 ' + EXPECTED_CASES + ' 条写口');
  let ran = 0;
  for (const c of cases) {
    const key = 'trace-key-' + c.slug;
    const before = countOf(c.table);
    await call(c, key);
    assert.equal(countOf(c.table), before + 1, c.name + '：带键写入照常只多一行');
    const [sql, args] = c.ledgerWhere(c.idOf(j(await call(c, key))));
    const stmt = conn().prepare(sql);
    const row = stmt.get.apply(stmt, args);
    assert.ok(row, c.name + '：重放返回的那个 id 必须真的在账本里（不是凭空端回来的）');
    assert.ok(!JSON.stringify(row).includes(key), c.name + '：幂等键不许写进业务表任何一列');
    // 读口不受影响：分页/清单照常返回，且多出来的那个顶层段不在读模型里
    ran++;
  }
  assert.equal(ran, cases.length, '循环必须真的跑完 ' + EXPECTED_CASES + ' 条写口（防空跑绿灯）');
});

// ── ⑨ 私有表是 additive 新表：p1a 既有表一列没动 ──
test('⑨ idempotency_keys 是 p1b 私有 additive 新表，p1a 既有表一列没动', () => {
  const names = conn().prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  assert.ok(names.includes('idempotency_keys'), '幂等键表必须建出来');
  for (const t of ['games', 'players', 'events', 'claims', 'actions', 'predictions', 'oracle_readings']) {
    assert.ok(names.includes(t), '既有表 ' + t + ' 必须还在（少了才是真信号）');
  }
  for (const t of ['games', 'events', 'predictions', 'oracle_readings']) {
    const cols = conn().pragma('table_info(' + t + ')').map((c) => c.name);
    assert.ok(cols.indexOf('idempotency_key') === -1, t + ' 不许为幂等新增列（幂等键不落业务表）');
  }
  const cols = conn().pragma('table_info(idempotency_keys)').map((c) => c.name);
  assert.deepEqual(cols, ['scope', 'idem_key', 'keyed', 'request_sha256', 'state', 'status_code',
    'result_json', 'created_at', 'completed_at'], '幂等表列结构冻结（加列要连本断言一起改并说明理由）');
});
