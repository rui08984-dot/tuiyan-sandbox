'use strict';
/**
 * p1b/test/analytics-telemetry.test.cjs —— P0-4 埋点（会话/三事件/作者判定）测试。
 *
 * 覆盖四条底线（任一不过 ⇒ 埋点等于没埋）：
 *   ① 幂等：重复 start / 重复 end / 重复事件上报都不产生第二行（重试与 React 严格模式双挂载是常态）。
 *   ② 作者判定：作者本人与非作者**分得开**；服务端未配密钥时 fail-closed（谁都不算作者）。
 *   ③ 隐私：题面 / 邮箱 / IP / UA 一律不落库（表结构里根本没有这些列，值也扫不到）。
 *   ④ 「有没有人用过第二次」可回答：returning_visitors 有数，且作者桶与非作者桶分开。
 *   ⑤ n<30 一律标注：比例类读数分母不足 30 时给 null + note，只留原始计数。
 *
 * 铁律：DB=:memory:；零网络；不起真端口（app.inject）。
 */
const test = require('node:test');
const assert = require('node:assert');
const Fastify = require('fastify');
const { db } = require('../src/deps');

const store = require('../src/db/analyticsStore');
const analyticsRoutes = require('../src/routes/analytics');

const J = (r) => r.json();
const post = (app, url, payload) => app.inject({ method: 'POST', url: url, payload: payload });
const get = (app, url) => app.inject({ method: 'GET', url: url });

let app = null;
test.before(async () => {
  db.init(':memory:');
  app = Fastify();
  // 与 src/server.js:48-52 的 setErrorHandler 同契约（{ error } 形状 + statusCode 透传）——
  // 埋点端点的 400 消息（枚举清单）就是靠这个形状送到调用方的，测试要按生产口径断言。
  app.setErrorHandler((err, req, reply) => {
    const status = err && err.statusCode ? err.statusCode : 500;
    reply.code(status).send({ error: (err && err.message) ? err.message : String(err) });
  });
  analyticsRoutes.register(app, {});
  await app.ready();
});
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

/** 造一个「干净」的作者判定环境：显式设置/清除 env，测试结束复原 */
function withAuthorKey(k, fn) {
  const old = process.env.P1B_AUTHOR_KEY;
  if (k === null || k === undefined) delete process.env.P1B_AUTHOR_KEY;
  else process.env.P1B_AUTHOR_KEY = k;
  return Promise.resolve(fn()).then(
    (v) => { if (old === undefined) delete process.env.P1B_AUTHOR_KEY; else process.env.P1B_AUTHOR_KEY = old; return v; },
    (e) => { if (old === undefined) delete process.env.P1B_AUTHOR_KEY; else process.env.P1B_AUTHOR_KEY = old; throw e; },
  );
}

// ─────────────────────────── ① 迁移：additive + 幂等 ───────────────────────────

test('ensureAnalyticsTables 幂等：连跑两次不抛错、不改既有列形状', () => {
  const conn = db.getConnection();
  store.ensureAnalyticsTables(conn);
  const before = ['analytics_visitors', 'analytics_sessions', 'analytics_events']
    .map((t) => JSON.stringify(conn.prepare('PRAGMA table_info(' + t + ')').all()));
  store.ensureAnalyticsTables(conn);
  store.ensureAnalyticsTables(conn);
  const after = ['analytics_visitors', 'analytics_sessions', 'analytics_events']
    .map((t) => JSON.stringify(conn.prepare('PRAGMA table_info(' + t + ')').all()));
  assert.deepEqual(after, before, '重复 ensure 后表结构完全不变（幂等）');
});

test('隐私底线是**结构性的**：三张表都没有题面 / IP / UA / 邮箱列', () => {
  const conn = db.getConnection();
  const banned = ['statement', 'text', 'title', 'content', 'ip', 'ip_address', 'user_agent', 'ua',
    'referer', 'email', 'name', 'author_key', 'key', 'token', 'phone'];
  for (const t of ['analytics_visitors', 'analytics_sessions', 'analytics_events']) {
    const cols = conn.prepare('PRAGMA table_info(' + t + ')').all().map((c) => String(c.name).toLowerCase());
    for (const b of banned) {
      assert.ok(!cols.includes(b), t + ' 不得有列 ' + b + '（隐私硬约束）');
    }
  }
});

// ─────────────────────────── ② 会话开始/结束 + 幂等 ───────────────────────────

test('POST /api/analytics/session/start：首次发号（visitor_id/session_id），再次沿用同一 visitor_id', async () => {
  const r1 = J(await post(app, '/api/analytics/session/start', {}));
  assert.equal(r1.ok, true);
  assert.match(r1.visitor_id, /^v_[0-9a-f]{32}$/, '服务端发稳定访客 id');
  assert.match(r1.session_id, /^s_[0-9a-f]{32}$/);
  assert.equal(r1.actor, 'visitor');

  const r2 = J(await post(app, '/api/analytics/session/start', { visitor_id: r1.visitor_id }));
  assert.equal(r2.visitor_id, r1.visitor_id, '同一访客 id 稳定');
  assert.notEqual(r2.session_id, r1.session_id, '第二次进来是新会话');
  assert.equal(J(await get(app, '/api/analytics/summary')).totals.visitors, 1, '访客数不因重连而膨胀');
});

test('重复 start 同一 session_id 幂等（重试 / 前端严格模式双挂载）', async () => {
  const sid = 's_idem_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  const a = J(await post(app, '/api/analytics/session/start', { session_id: sid }));
  const b = J(await post(app, '/api/analytics/session/start', { session_id: sid }));
  assert.equal(a.session_id, sid);
  assert.equal(b.session_id, sid);
  assert.equal(b.duplicate, true, '重复 start 如实回报 duplicate');
  const n = db.getConnection().prepare('SELECT COUNT(*) n FROM analytics_sessions WHERE session_id = ?').get(sid).n;
  assert.equal(n, 1, '同一 session_id 只落一行');
});

test('POST /api/analytics/session/end：落 ended_at；重复 end 幂等（不覆盖首次结束时间）', async () => {
  const s = J(await post(app, '/api/analytics/session/start', {}));
  const e1 = J(await post(app, '/api/analytics/session/end', { session_id: s.session_id, reason: 'client_beacon' }));
  assert.equal(e1.ok, true);
  assert.ok(e1.ended_at, 'ended_at 落库');
  await new Promise((r) => setTimeout(r, 15));
  const e2 = J(await post(app, '/api/analytics/session/end', { session_id: s.session_id, reason: 'idle_timeout' }));
  assert.equal(e2.duplicate, true);
  const row = db.getConnection().prepare('SELECT started_at, ended_at, end_reason FROM analytics_sessions WHERE session_id = ?').get(s.session_id);
  assert.equal(row.end_reason, 'client_beacon', '首次结束原因不被覆盖');
  assert.equal(row.ended_at, e1.ended_at, 'ended_at 不被二次上报改写');
});

test('end 一个不存在的会话 → 404（如实报错，不静默造行）', async () => {
  const r = await post(app, '/api/analytics/session/end', { session_id: 's_never_existed' });
  assert.equal(r.statusCode, 404);
});

// ─────────────────────────── ③ 三事件 + 幂等 ───────────────────────────

test('三事件（首次建题 / 落定 / 回访）各记一条；同事件重复上报幂等', async () => {
  const s = J(await post(app, '/api/analytics/session/start', {}));
  for (const ev of ['question_created', 'question_settled', 'question_revisited']) {
    const r = await post(app, '/api/analytics/event', { event: ev, visitor_id: s.visitor_id, session_id: s.session_id, subject_id: 7 });
    assert.equal(r.statusCode, 200, ev + ' 受理');
  }
  const dup = await post(app, '/api/analytics/event', { event: 'question_created', visitor_id: s.visitor_id, session_id: s.session_id, subject_id: 7 });
  assert.equal(J(dup).duplicate, true, '同一会话内同一题同一事件只计一次');
  const rows = db.getConnection().prepare('SELECT event, COUNT(*) n FROM analytics_events GROUP BY event').all();
  const by = Object.fromEntries(rows.map((r) => [r.event, r.n]));
  assert.equal(by.question_created, 1);
  assert.equal(by.question_settled, 1);
  assert.equal(by.question_revisited, 1);
});

test('非法事件名 → 400（防脏枚举静默落空）', async () => {
  const r = await post(app, '/api/analytics/event', { event: 'page_view_x' });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /question_created/);
});

// ─────────────────────────── ④ 作者判定（★埋点的全部价值所在） ───────────────────────────

test('★作者判定：出示正确密钥 → author；错误/不出示 → visitor（两桶不混）', async () => {
  await withAuthorKey('correct-horse', async () => {
    const a = J(await post(app, '/api/analytics/session/start', { author_key: 'correct-horse' }));
    assert.equal(a.actor, 'author', '密钥相符 ⇒ 判作者');
    assert.equal(a.actor_proof, 'key_match');

    const b = J(await post(app, '/api/analytics/session/start', { author_key: 'wrong-key' }));
    assert.equal(b.actor, 'visitor', '密钥不符 ⇒ 判访客');
    assert.equal(b.actor_proof, 'key_mismatch');

    const c = J(await post(app, '/api/analytics/session/start', {}));
    assert.equal(c.actor, 'visitor', '不出示 ⇒ 判访客');

    const sum = J(await get(app, '/api/analytics/summary'));
    assert.equal(sum.author_key_configured, true);
    assert.ok(sum.by_actor.author.sessions >= 1, '作者桶有会话');
    assert.ok(sum.by_actor.visitor.sessions >= 1, '非作者桶有会话');
  });
});

test('★fail-closed：服务端未配 P1B_AUTHOR_KEY 时，谁都判不出作者（不静默把作者算成访客）', async () => {
  await withAuthorKey(null, async () => {
    const a = J(await post(app, '/api/analytics/session/start', { author_key: 'correct-horse' }));
    assert.equal(a.actor, 'visitor', '没配服务端密钥 ⇒ 即使前端出示也不算作者');
    assert.equal(a.actor_proof, 'no_server_key');
    const sum = J(await get(app, '/api/analytics/summary'));
    assert.equal(sum.author_key_configured, false, '端点如实回报「没配密钥」，读数的人不会被误导');
    assert.ok(sum.warnings.some((w) => /P1B_AUTHOR_KEY/.test(w)), '缺配置必须显式告警');
  });
});

test('★密钥绝不入库：库里扫不到密钥原文', async () => {
  await withAuthorKey('super-secret-author-key', async () => {
    await post(app, '/api/analytics/session/start', { author_key: 'super-secret-author-key' });
    const conn = db.getConnection();
    for (const t of ['analytics_visitors', 'analytics_sessions', 'analytics_events']) {
      const row = conn.prepare('SELECT * FROM ' + t).all();
      assert.ok(!JSON.stringify(row).includes('super-secret-author-key'), t + ' 不得含密钥原文');
    }
  });
});

test('★作者桶与非作者桶在「有没有人用过第二次」上分开数', async () => {
  // 造一个只做过一次的外部访客，和一个做过两次的外部访客
  const v1 = J(await post(app, '/api/analytics/session/start', { visitor_id: 'v_once_' + Math.random() }));
  const v2a = J(await post(app, '/api/analytics/session/start', { visitor_id: 'v_twice_' + Math.random() }));
  await post(app, '/api/analytics/session/start', { visitor_id: v2a.visitor_id });
  const sum = J(await get(app, '/api/analytics/summary'));
  assert.equal(sum.totals.visitors, sum.by_actor.author.visitors + sum.by_actor.visitor.visitors, '两桶互斥且完备（前端可自校验）');
  assert.ok(sum.totals.returning_visitors >= 1, '至少有一个访客用过第二次');
  assert.ok(sum.by_actor.visitor.returning_visitors >= 1, '用过第二次的人在非作者桶里');
  assert.ok(v1.visitor_id && v2a.visitor_id);
});

// ─────────────────────────── ⑤ n<30 标注 ───────────────────────────

test('n<30 一律标注：分母不足 30 ⇒ 比例给 null + note，原始计数照给', async () => {
  const sum = J(await get(app, '/api/analytics/summary'));
  assert.equal(sum.min_n, 30);
  const bl = sum.totals.returning_rate_block;
  assert.equal(bl.enough, false, '样本远不足 30 ⇒ enough=false');
  assert.equal(bl.returning_rate, null, '比例不给数（禁「样本太少但还是算了个数」）');
  assert.ok(bl.note && bl.note.length > 0, '必须给一句人话说明');
  assert.ok(typeof sum.totals.returning_visitors === 'number', '原始计数照给（它是事实不是推断）');
});

// ─────────────────────────── ⑥ 隐私：不落任何题面/个人信息 ───────────────────────────

test('★隐私底线：夹带题面/邮箱/IP/UA 的请求，一个字都不落库', async () => {
  const secret = 'S3CRET-题面-火星探测器明年发射概率';
  const s = J(await post(app, '/api/analytics/session/start', {}));
  const r = await post(app, '/api/analytics/event', {
    event: 'question_created', visitor_id: s.visitor_id, session_id: s.session_id, subject_id: 42,
    statement: secret, title: secret, email: 'me@example.com', ip: '203.0.113.7',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0)', referer: 'https://example.com/x',
  });
  assert.equal(r.statusCode, 200, '不因多余字段报错（前端不该因此断埋点）');
  const conn = db.getConnection();
  for (const t of ['analytics_visitors', 'analytics_sessions', 'analytics_events']) {
    const dump = JSON.stringify(conn.prepare('SELECT * FROM ' + t).all());
    for (const needle of [secret, 'me@example.com', '203.0.113.7', 'Mozilla/5.0', 'example.com']) {
      assert.ok(!dump.includes(needle), t + ' 不得含 ' + needle);
    }
  }
  const row = conn.prepare('SELECT * FROM analytics_events WHERE subject_id = 42').get();
  assert.equal(row.subject_id, 42, '只留题目的数字 id（可计数、不可阅读）');
});

// ─────────────────────────── ⑦ 只读端点：零写 ───────────────────────────

test('GET /api/analytics/summary 纯只读：连调三次行数不变', async () => {
  const conn = db.getConnection();
  const count = () => ['analytics_visitors', 'analytics_sessions', 'analytics_events']
    .map((t) => conn.prepare('SELECT COUNT(*) n FROM ' + t).get().n).join('/');
  const before = count();
  await get(app, '/api/analytics/summary');
  await get(app, '/api/analytics/summary');
  await get(app, '/api/analytics/summary');
  assert.equal(count(), before, '导出端点零写');
});

test('summary 形状与隐私声明齐全（供用户直接查）', async () => {
  const sum = J(await get(app, '/api/analytics/summary'));
  for (const k of ['ok', 'generated_at', 'author_key_configured', 'totals', 'by_actor', 'events', 'min_n', 'privacy', 'warnings']) {
    assert.ok(k in sum, 'summary.' + k + ' 在');
  }
  for (const ev of ['question_created', 'question_settled', 'question_revisited']) {
    assert.ok(ev in sum.events, 'events.' + ev + ' 在');
  }
  assert.ok(sum.privacy.some((p) => /题面/.test(p)), '隐私声明须写明不记题面');
  assert.ok(sum.privacy.some((p) => /个人信息|IP/.test(p)), '隐私声明须写明不记个人信息');
  assert.ok(!/预测/.test(JSON.stringify(sum.privacy)), '界面文案禁「预测」字样');
});
