'use strict';
/**
 * p1b/test/question-views.test.cjs —— P0-5「我的题 / 语料库」两视图测试。
 *
 * 病象（实测 2026-09-28 真实库）：predictions 1994 条、已揭晓 1700 条、
 *   **未揭晓 294 条**（= `outcome IS NULL`），source_type 全部是人工落注那一类，
 *   且 `statement LIKE '%护栏：G2 行域样例%'` 命中 2 条（测试夹具）。
 *   ⇒ 外部用户第一屏看到的是 294 条他不认识的机器题，其中混着测试夹具。
 *
 * 本测试盯住三条底线，任一不过就等于「静默藏数据」：
 *   ① 默认视图（我的题）**不含**语料库题；
 *   ② 语料库视图**能看见**它们（不删、不隐藏其存在）；
 *   ③ 两视图**互斥且完备**：并集 == 账本总数（前端可自校验，不是口头承诺）。
 * 外加：已自动揭晓的数在两视图下不互相矛盾；归属不可抢；端点零写。
 *
 * 铁律：DB=:memory:；零网络；不起真端口（app.inject）。
 */
const test = require('node:test');
const assert = require('node:assert');
const Fastify = require('fastify');
const { db } = require('../src/deps');

const analyticsRoutes = require('../src/routes/analytics');
const predictionsStore = require('../src/db/predictionsStore');

const J = (r) => r.json();
const post = (app, url, payload) => app.inject({ method: 'POST', url: url, payload: payload });
const get = (app, url) => app.inject({ method: 'GET', url: url });
const conn = () => db.getConnection();

let app = null;
/** 测试题目的 id 池（每条都由本文件亲手插入，便于逐条断言） */
const IDS = { mine: [], corpus: [], revealed: [] };
/** predictions.game_id 外键 ⇒ 必须先有一局（p1a 开 foreign_keys=ON，见 p1a-terminal/src/db.js:144） */
let GAME_ID = 1;

/** 插一条测试题（照 audit-kpi.test.cjs 的做法直写 conn；不依赖任何生产写路径） */
function mkQuestion(statement, opts) {
  const o = opts || {};
  const info = conn().prepare(
    'INSERT INTO predictions (game_id, source_type, statement, layer, matures_at, resolved_at, outcome, assigned_prob)'
    + " VALUES (?, '预测卡', ?, ?, ?, ?, ?, ?)"
  ).run(o.game_id === undefined ? GAME_ID : o.game_id, statement, o.layer || 'L2',
    o.matures_at === undefined ? '2026-12-01' : o.matures_at,
    o.resolved_at === undefined ? null : o.resolved_at,
    o.outcome === undefined ? null : o.outcome,
    o.assigned_prob === undefined ? 0.5 : o.assigned_prob);
  return Number(info.lastInsertRowid);
}

test.before(async () => {
  db.init(':memory:');
  predictionsStore.ensurePredictionsTable(db.getConnection()); // predictions 是 p1b 私有表，须先建
  GAME_ID = Number(conn().prepare(
    "INSERT INTO games (name, game_type, player_count) VALUES ('两视图测试局', 'werewolf', 6)"
  ).run().lastInsertRowid);

  app = Fastify();
  app.setErrorHandler((err, req, reply) => {   // 与 src/server.js:48-52 同契约
    const status = err && err.statusCode ? err.statusCode : 500;
    reply.code(status).send({ error: (err && err.message) ? err.message : String(err) });
  });
  analyticsRoutes.register(app, {});
  await app.ready();

  // 一个外部访客（无作者密钥 ⇒ visitor 桶）
  const s = J(await post(app, '/api/analytics/session/start', {}));
  const mineId = s.visitor_id;

  // 三条「他的题」：一条未揭晓、一条已揭晓
  const a = mkQuestion('我的题·还没到揭晓时刻', {});
  const b = mkQuestion('我的题·已经揭晓了', { resolved_at: '2026-09-01 00:00:00', outcome: 'true' });
  IDS.mine = [a, b];
  IDS.revealed.push(b);
  // 归属：建题即归属（与 P0-4 的 question_created 事件同一条路径）
  await post(app, '/api/analytics/claim', { prediction_id: a, visitor_id: mineId, how: 'created' });
  await post(app, '/api/analytics/claim', { prediction_id: b, visitor_id: mineId, how: 'created' });

  // 四条语料库题：批量灌入的机器题，其中一条是测试夹具
  const c1 = mkQuestion('票房榜：本周冠军', {});
  const c2 = mkQuestion('芝加哥地铁客流', {});
  const c3 = mkQuestion('英超比分', { resolved_at: '2026-09-02 00:00:00', outcome: 'false' });
  const c4 = mkQuestion('护栏：G2 行域样例', {});
  IDS.corpus = [c1, c2, c3, c4];
  IDS.revealed.push(c3);

  app.__mine = mineId;
});
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

/** 取某视图的整页（测试里页开到很大，避免分页干扰断言） */
async function viewOf(v, visitorId) {
  const url = '/api/analytics/questions?view=' + v + '&limit=500'
    + (visitorId ? '&visitor_id=' + encodeURIComponent(visitorId) : '');
  const r = await get(app, url);
  return { status: r.statusCode, body: J(r) };
}

// ─────────────────────────── ① 默认视图不含语料库题 ───────────────────────────

test('★默认视图 = 我的题：只含归属当前访客的题，一条语料库题都不混进来', async () => {
  const { body } = await viewOf('mine', app.__mine);
  assert.equal(body.view, 'mine');
  const ids = body.rows.map((r) => r.id);
  for (const c of IDS.corpus) assert.ok(!ids.includes(c), '语料库题 ' + c + ' 不得出现在我的题里');
  for (const m of IDS.mine) assert.ok(ids.includes(m), '我的题 ' + m + ' 必须在');
  assert.equal(ids.length, body.counts.mine, '行数 ≡ 计数（不能只报数不给行，反之亦然）');
});

test('缺 visitor_id 的「我的题」→ 400（**绝不用全库冒充「我的」**）', async () => {
  const r = await get(app, '/api/analytics/questions?view=mine');
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /visitor_id/);
});

// ─────────────────────────── ② 语料库视图能看见它们 ───────────────────────────

test('★语料库视图能看见全部批量灌入题（含测试夹具「护栏：G2 行域样例」），一条不删', async () => {
  const { body } = await viewOf('corpus');
  const ids = body.rows.map((r) => r.id);
  for (const c of IDS.corpus) assert.ok(ids.includes(c), '语料库题 ' + c + ' 必须在语料库视图里可见');
  assert.ok(ids.includes(IDS.corpus[3]), '测试夹具题照样可见（不静默清理）');
  for (const m of IDS.mine) assert.ok(!ids.includes(m), '我的题不该混进语料库');
});

test('★绝不隐藏其存在：即使在「我的题」视图里，语料库条数也照给', async () => {
  const { body } = await viewOf('mine', app.__mine);
  assert.equal(body.counts.corpus, IDS.corpus.length, '我的题视图也必须报出语料库有多少条');
  assert.ok(body.counts.corpus > 0);
  assert.ok(body.discipline.some((d) => /语料库/.test(d)), '须有一句说明语料库是什么、没被删');
});

// ─────────────────────────── ③ 两视图互斥且完备 =──────────────────────────

test('★两视图并集 == 账本总数（互斥且完备，可自校验）', async () => {
  const mine = (await viewOf('mine', app.__mine)).body;
  const corpus = (await viewOf('corpus')).body;
  const a = mine.rows.map((r) => r.id);
  const b = corpus.rows.map((r) => r.id);
  assert.equal(a.filter((x) => b.includes(x)).length, 0, '两个视图不许重叠');
  const union = new Set(a.concat(b));
  assert.equal(union.size, a.length + b.length, '并集大小 == 两边之和（无重复）');
  const total = conn().prepare('SELECT COUNT(*) n FROM predictions').get().n;
  assert.equal(union.size, total, '并集 == 账本总数（一条都没被藏）');
  assert.equal(mine.counts.total, total);
  assert.equal(corpus.counts.total, total, '两视图报的总数必须一致（否则两个视图互相矛盾）');
});

test('★三桶守恒：我的题 + 语料库 + 别人的题 == 总数（第三桶只报数、不列行）', async () => {
  const mine = (await viewOf('mine', app.__mine)).body;
  const total = conn().prepare('SELECT COUNT(*) n FROM predictions').get().n;
  assert.equal(mine.counts.mine + mine.counts.corpus + mine.counts.others, total,
    '三桶互斥且完备：任何一条题都落在且只落在一个桶里');
  assert.equal(mine.counts.corpus, IDS.corpus.length, '语料库桶 == 无归属的题（批量灌入那些）');
  // 本测试跑在"归属不可抢"之前 ⇒ 此时还没有别人的题
  assert.equal(mine.counts.others, 0, '此刻别人桶为空 ⇒ 两视图并集 == 总数');
});

test('view=all（复核用）给全量，且与两视图并集逐条相等', async () => {
  const all = (await viewOf('all', app.__mine)).body;
  const mine = (await viewOf('mine', app.__mine)).body;
  const corpus = (await viewOf('corpus')).body;
  const union = new Set(mine.rows.map((r) => r.id).concat(corpus.rows.map((r) => r.id)));
  assert.equal(all.rows.length, union.size);
  for (const r of all.rows) assert.ok(union.has(r.id), 'all 视图每行都在两视图并集里');
});

test('非法 view → 400（防脏视图名静默落成全库）', async () => {
  const r = await get(app, '/api/analytics/questions?view=everything');
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /mine/);
});

// ─────────────────────────── ④ 已自动揭晓的数：两视图不许互相矛盾 ───────────────────────────

test('★已自动揭晓：两个视图（同一个访客）报的数必须逐字段相同，且各桶之和 ≡ 全量', async () => {
  // ★不变量是「**对同一个人**而言两个视图不许互相矛盾」——所以两边必须用同一个 visitor_id 去查。
  //   语料库视图同样接受 visitor_id：它列的是语料库题，但计数拆解要按这个人来拆。
  const mine = (await viewOf('mine', app.__mine)).body;
  const corpus = (await viewOf('corpus', app.__mine)).body;
  const truth = conn().prepare(
    'SELECT COUNT(*) n FROM predictions WHERE resolved_at IS NOT NULL AND outcome IS NOT NULL'
  ).get().n;
  assert.equal(mine.auto_revealed.total, truth, '总数 == 账本里真·已揭晓的条数');
  assert.deepEqual(corpus.auto_revealed, mine.auto_revealed,
    '★两个视图必须报同一份拆解（语料库里的题同样在自动结算，不许只数我的题）');
  assert.equal(mine.auto_revealed.mine + mine.auto_revealed.corpus + mine.auto_revealed.others,
    mine.auto_revealed.total, '各桶之和 ≡ 总数');
  assert.ok(mine.auto_revealed.corpus >= 1, '语料库里已揭晓的题照样算在自动揭晓里');
  assert.ok(mine.auto_revealed.mine >= 1, '我的题里已揭晓的也照算');
  // 语料库视图列出来的行必须含那条已揭晓的语料库题（数与行同一份）
  assert.ok(corpus.rows.some((r) => r.id === IDS.corpus[2] && r.resolved_at), '语料库视图里那条已揭晓的题仍在列');
});

test('★归属不改变结算口径：语料库里的题照旧被自动揭晓（不是被搁置）', async () => {
  // 语料库题 c3 已落定；它的落定**不因为进了语料库视图而失效**
  const corpus = (await viewOf('corpus')).body;
  const row = corpus.rows.find((r) => r.id === IDS.corpus[2]);
  assert.ok(row, '语料库题照样列得出来');
  assert.equal(row.outcome, 'false');
  assert.ok(row.resolved_at);
  assert.equal(row.view_bucket, 'corpus', '行自带它属于哪个桶（前端不必自己猜）');
  assert.equal(corpus.rows.find((r) => r.id === IDS.corpus[0]).view_bucket, 'corpus');
});

// ─────────────────────────── ⑤ 归属规则 ───────────────────────────

test('认领幂等：同一人重复认领同一条 → duplicate，不产生第二行', async () => {
  const id = mkQuestion('认领幂等题', {});
  const r1 = J(await post(app, '/api/analytics/claim', { prediction_id: id, visitor_id: app.__mine }));
  const r2 = J(await post(app, '/api/analytics/claim', { prediction_id: id, visitor_id: app.__mine }));
  assert.equal(r1.ok, true);
  assert.equal(r2.duplicate, true);
  assert.equal(conn().prepare('SELECT COUNT(*) n FROM question_owners WHERE prediction_id = ?').get(id).n, 1);
});

test('归属不可抢：别人的题认领 → 409（不静默改归属）', async () => {
  const id = mkQuestion('别人的题', {});
  const other = J(await post(app, '/api/analytics/session/start', {})).visitor_id;
  await post(app, '/api/analytics/claim', { prediction_id: id, visitor_id: other });
  const r = await post(app, '/api/analytics/claim', { prediction_id: id, visitor_id: app.__mine });
  assert.equal(r.statusCode, 409);
  const row = conn().prepare('SELECT visitor_id FROM question_owners WHERE prediction_id = ?').get(id);
  assert.equal(row.visitor_id, other, '归属没被抢走');
});

test('★别人的题只报数、不列行（不泄露别人的题面），且三桶仍守恒', async () => {
  const other = J(await post(app, '/api/analytics/session/start', {})).visitor_id;
  const secret = '这是别人的题面·不该出现在我的视图里';
  const id = mkQuestion(secret, {});
  await post(app, '/api/analytics/claim', { prediction_id: id, visitor_id: other });

  const mine = (await viewOf('mine', app.__mine)).body;
  const corpus = (await viewOf('corpus')).body;
  assert.ok(!mine.rows.map((r) => r.id).includes(id), '别人的题不在我的题里');
  assert.ok(!corpus.rows.map((r) => r.id).includes(id), '★也不在语料库里——语料库只装「无归属的批量题」');
  assert.ok(mine.counts.others >= 1, '但它的存在照报（不隐藏）');
  assert.equal(mine.counts.mine + mine.counts.corpus + mine.counts.others, mine.counts.total, '三桶仍守恒');
  assert.ok(!JSON.stringify(mine).includes(secret), '响应里不该出现别人的题面');
  assert.ok(!JSON.stringify(corpus).includes(secret), '响应里不该出现别人的题面');
});

test('认领一条不存在的题 → 404（如实报错，不凭空造归属行）', async () => {
  const r = await post(app, '/api/analytics/claim', { prediction_id: 999999, visitor_id: app.__mine });
  assert.equal(r.statusCode, 404);
});

test('作者本人也可归属：出示作者密钥 ⇒ actor=author，题进作者桶不进访客桶', async () => {
  const old = process.env.P1B_AUTHOR_KEY;
  process.env.P1B_AUTHOR_KEY = 'k-p0-5';
  try {
    const s = J(await post(app, '/api/analytics/session/start', { author_key: 'k-p0-5' }));
    const id = mkQuestion('作者本人的题', {});
    const c = J(await post(app, '/api/analytics/claim', { prediction_id: id, visitor_id: s.visitor_id, author_key: 'k-p0-5' }));
    assert.equal(c.actor, 'author');
    const mine = (await viewOf('mine', s.visitor_id)).body;
    assert.ok(mine.rows.map((r) => r.id).includes(id), '作者的题在作者自己的「我的题」里');
    // 另一个访客看不到它，但仍知道它存在（三桶守恒）
    const other = (await viewOf('mine', app.__mine)).body;
    assert.equal(other.counts.mine + other.counts.corpus + other.counts.others, other.counts.total,
      '别人的题只是不在「我的题」里，没消失');
    assert.ok(other.counts.others >= 1, '而且它的存在照报（不隐藏）');
  } finally {
    if (old === undefined) delete process.env.P1B_AUTHOR_KEY; else process.env.P1B_AUTHOR_KEY = old;
  }
});

test('建题即归属：P0-4 的 question_created 事件自动把题落到访客名下', async () => {
  const s = J(await post(app, '/api/analytics/session/start', {}));
  const id = mkQuestion('建题即归属题', {});
  await post(app, '/api/analytics/event', {
    event: 'question_created', visitor_id: s.visitor_id, session_id: s.session_id, subject_id: id,
  });
  const mine = (await viewOf('mine', s.visitor_id)).body;
  assert.ok(mine.rows.map((r) => r.id).includes(id), '报了一次建题 ⇒ 这道题归我');
  const c = J(await post(app, '/api/analytics/claim', { prediction_id: id, visitor_id: s.visitor_id }));
  assert.equal(c.duplicate, true, '建题已归属过 ⇒ 补一次认领是幂等的，不报错');
});

// ─────────────────────────── ⑥ 只读 + n<30 标注 ───────────────────────────

test('GET 两视图端点纯只读：连调四次，两视图行数与归属表都不变', async () => {
  const snap = () => {
    const c = conn();
    return [
      c.prepare('SELECT COUNT(*) n FROM question_owners').get().n,
      c.prepare('SELECT COUNT(*) n FROM predictions').get().n,
    ].join('/');
  };
  const before = snap();
  for (const v of ['mine', 'corpus', 'all', 'all']) await viewOf(v, app.__mine);
  assert.equal(snap(), before, '读端点零写');
});

test('n<30 一律标注：比例类读数分母不足 30 ⇒ null + note', async () => {
  const mine = (await viewOf('mine', app.__mine)).body;
  const bl = mine.shares.mine;
  assert.equal(mine.min_n, 30);
  assert.equal(bl.enough, false);
  assert.equal(bl.share, null, '不给比例（禁「样本太少但还是算了个数」）');
  assert.ok(bl.note && bl.note.length > 0, '必须给一句人话说明');
  assert.equal(typeof bl.numerator, 'number', '原始计数照给（它是事实）');
});
