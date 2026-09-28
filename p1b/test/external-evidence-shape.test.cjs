'use strict';
/**
 * p1b/test/external-evidence-shape.test.cjs —— 洞二：`POST /api/predictions` 对事件 id 证据的报错（2026-09-28）
 *
 * 【病象（实测）】
 *   传 `evidence: [1,2]` 得到的是
 *     「evidence 一行内不许混两种形状（事件 id 与结构化对象）——读端只认第 0 个元素的位置…」，
 *   可**混形状是服务端自己造的**：调用方只发了一种形状，是路由先把 `[{resolve}]` 拼上去
 *   才变成 `[{resolve}, 1, 2]`。⇒ 这条报错把锅扣在调用方头上，而它真正的毛病是
 *   **在完全不相干的端点上用了一个不相干的概念**。按这条提示去查，调用方会去检查
 *   "我是不是混了两种形状"，永远查不出问题。
 *
 * 【为什么选 A（显式拒绝）而不是 B（真的支持它）—— 四条实测依据】
 *   ① 端点写的是**容器局**，不是调用方那一局。`normalizeEventIds` 查的是
 *      `events WHERE id=? AND game_id=<容器局>` ⇒ 调用方真正想引用的局内事件**结构上取不到**。
 *      （实测：事件 id 1 属于真实局 2，容器局是 1，交叉查不到。）
 *   ② 容器局**装不下**有意义的局内事件：`events.phase` 是
 *      `CHECK(phase IN ('night','day','dusk'))`，而外部题（天气/汇率/开奖）没有夜/日/黄昏。
 *      （实测：给容器局插 `phase='forecast'` 的事件被 CHECK 挡掉。）
 *   ③ 容器局**没有席位**（`externalLedger.js` 文件头：与 createGameCore 唯一的差别就是"不建席"），
 *      实测 seats.length = 0 ⇒ `events.actor_seat` 天然为 NULL，事件连叙事主体都没有。
 *   ④ 就算硬收，id 元素在 `evidence_json` 里存成数字，读端
 *      `json_extract(evidence_json,'$[0].resolve.kind')`（基率/真值口径/单题详情全走这条）
 *      照样取不到锚 ⇒ 落一条"看着落了库、其实没建索引"的黑洞行，
 *      而本项目对这一条有明文铁律（predictions.js 文件头：「没有真值锚的行等于没建索引」）。
 *   ⇒ B 不是"多写点校验"，是**语义空洞**：唯一能通过校验的 id 属于一个不该存在的事件序列。
 *
 * 铁律：DB=:memory:；零网络；不起真端口（app.inject）；拒收一律零写。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const { db } = require('../src/deps');

const routes = require('../src/routes/predictions');
const store = require('../src/db/predictionsStore');
const extLedger = require('../src/db/externalLedger');
const kindGate = require('../src/evidence/resolveKind');

const J = (r) => r.json();
const post = (app, url, payload) => app.inject({ method: 'POST', url: url, payload: payload });
const conn = () => db.getConnection();

let app = null;
/** 外部题端点的真值锚 kind 取自支持表（不手抄字面量，照 predictions.js 的做法）。 */
let KIND = null;

test.before(async () => {
  db.init(':memory:');
  store.ensurePredictionsTable(db.getConnection());
  extLedger.ensureSourceColumn(db.getConnection());
  KIND = kindGate.supportedKinds()[0];
  app = Fastify();
  app.setErrorHandler((err, req, reply) => {   // 与 src/server.js:48-52 同契约
    const status = err && err.statusCode ? err.statusCode : 500;
    reply.code(status).send({ error: (err && err.message) ? err.message : String(err) });
  });
  routes.register(app);
  await app.ready();
});
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

/** 一条外部题的最小合法请求体。 */
function extBody(over) {
  return Object.assign({ statement: '外部题·最小请求', prob: 0.42, resolve_spec: { kind: KIND } }, over || {});
}

// ─────────────────── ① 报错必须说清「这个端点不收事件 id」 ───────────────────

test('★传事件 id 数组 → 400，且明说「本端点不收事件 id」、指对局端点', async () => {
  const r = await post(app, '/api/predictions', extBody({ evidence: [1, 2] }));
  assert.equal(r.statusCode, 400);
  const msg = r.json().error;
  assert.ok(/事件/.test(msg) && /id/.test(msg), '报错必须点名"事件 id"，说清收到的是什么：' + msg);
  assert.ok(/\/api\/games\/:id\/predictions/.test(msg), '报错必须指向按局落注的那个端点：' + msg);
  assert.ok(/外部题/.test(msg), '报错要说清这是外部题端点：' + msg);
});

test('★★报错不得说「不许混两种形状」——混形状是服务端自己造的，扣在调用方头上是错的方向', async () => {
  const r = await post(app, '/api/predictions', extBody({ evidence: [1, 2] }));
  const msg = r.json().error;
  assert.equal(/混两种形状|混形状/.test(msg), false,
    '报错仍在说"混两种形状"——可调用方只发了一种形状，是路由拼锚拼出来的，这条提示指错方向：' + msg);
});

test('★字符串形态的事件 id 同样被拒（旧调用方可能传字符串数字）', async () => {
  const r = await post(app, '/api/predictions', extBody({ evidence: ['1', '2'] }));
  assert.equal(r.statusCode, 400);
  assert.ok(/\/api\/games\/:id\/predictions/.test(r.json().error), r.json().error);
});

test('★调用方自带锚又混了 id（[{resolve},1]）→ 也说「本端点不收事件 id」而不是"你混了形状"', async () => {
  // 这条看着像"调用方混了两种形状"，但 `1` 在本端点的语义里就是事件 id，
  // 而本端点一个事件 id 都不收 ⇒ 指"混形状"是**次**诊断，指"这里不收事件 id"才是真诊断。
  const r = await post(app, '/api/predictions', extBody({ evidence: [{ resolve: { kind: KIND } }, 1] }));
  assert.equal(r.statusCode, 400);
  const msg = r.json().error;
  assert.equal(/混两种形状|混形状/.test(msg), false, msg);
  assert.ok(/事件/.test(msg) && /id/.test(msg), msg);
});

test('★null / 空数组不算事件 id（它们不是 id，是"没给"）', async () => {
  const r0 = await post(app, '/api/predictions', extBody({ evidence: [] }));
  assert.equal(r0.statusCode, 201, JSON.stringify(r0.json()));
  const r1 = await post(app, '/api/predictions', extBody({ evidence: null }));
  assert.equal(r1.statusCode, 201, JSON.stringify(r1.json()));
});

// ─────────────────── ② 零行为没动 ───────────────────

test('★零行为与结构化对象证据照旧 201（拒收只针对事件 id，别把正常的也拒了）', async () => {
  // 不给 / 给空数组 ⇒ 201，且锚被强制在 $[0]
  for (const ev of [undefined, []]) {
    const body = extBody(ev === undefined ? {} : { evidence: ev });
    const r = await post(app, '/api/predictions', body);
    assert.equal(r.statusCode, 201, JSON.stringify(r.json()));
    const e = J(r).evidence;
    assert.equal(e.length, 1);
    assert.ok(e[0] && e[0].resolve && e[0].resolve.kind === KIND,
      '锚必须在第 0 个元素上，否则这行查不到历史频率、判不了真值口径');
  }
  // 调用方自带完整结构化元素（每个都带 resolve）照旧原样落库
  const r2 = await post(app, '/api/predictions', extBody({ evidence: [{ resolve: { kind: KIND }, baseRateNote: '手动注记' }] }));
  assert.equal(r2.statusCode, 201, JSON.stringify(r2.json()));
  assert.equal(J(r2).evidence[0].baseRateNote, '手动注记', '调用自费的那条证据一个键都不许被改写');
});

test('★拒收一律零写：被拒的请求在账本里一行都不留', async () => {
  const before = conn().prepare('SELECT COUNT(*) n FROM predictions').get().n;
  for (const ev of [[1, 2], ['1'], [{ resolve: { kind: KIND } }, 7]]) {
    const r = await post(app, '/api/predictions', extBody({ evidence: ev }));
    assert.equal(r.statusCode, 400, JSON.stringify(ev));
  }
  assert.equal(conn().prepare('SELECT COUNT(*) n FROM predictions').get().n, before, '拒收却落了行');
});

// ─────────────────── ③ 按局端点不受影响（A 不能顺手把 B 的正主也拒了） ───────────────────

test('★按局端点 POST /api/games/:id/predictions 仍照旧收事件 id（事件是对局线的概念，那边有）', async () => {
  const gid = Number(conn().prepare(
    "INSERT INTO games (name, game_type, player_count) VALUES ('洞二·真实局', 'werewolf', 6)"
  ).run().lastInsertRowid);
  const evId = Number(conn().prepare(
    "INSERT INTO events (game_id, day, phase, seq, type, raw_text) VALUES (?, 0, 'day', 1, 'statement', '开局')"
  ).run(gid).lastInsertRowid);
  const r = await post(app, '/api/games/' + gid + '/predictions', { statement: '局内题', prob: 0.5, evidence: [evId] });
  assert.equal(r.statusCode, 201, '按局端点被这次改动误伤了：' + r.json().error);
  assert.deepEqual(J(r).evidence, [evId], '按局端点的 id 证据原样落库（行为未变）');
});

// ─────────────────── ④ 契约注释必须写明这段语义（ask 明写）───────────────────

test('★端点头的契约注释写明「外部题端点不收事件 id」及为什么', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'predictions.js'), 'utf8');
  const at = src.indexOf("app.post('/api/predictions'");
  assert.ok(at > 0, '找不到外部题落注端点');
  // 往上找该端点的块注释（本文件的端点契约都写在注册语句之前的 /** */ 里）
  const head = src.slice(Math.max(0, at - 3000), at);
  const blockAt = head.lastIndexOf('/**');
  const block = head.slice(blockAt);
  assert.ok(block.length > 200, '端点上方必须有块注释');
  assert.ok(/事件\s*id|事件id/.test(block), '端点契约注释必须点名事件 id：' + block.slice(0, 200));
  assert.ok(/不收|不接受|不支持|没有意义|不适用/.test(block), '端点契约注释必须写明本端点不收它');
  assert.ok(/\/api\/games\/:id\/predictions/.test(block), '端点契约注释必须指对局端点：' + block.slice(0, 200));
});
