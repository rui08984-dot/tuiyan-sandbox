'use strict';
/**
 * p1b/test/external-domain-views.test.cjs —— **洞一：external 域的读侧消费者**（2026-09-28）
 *
 * 【病象（实测，不是推演）】
 *   `NOT_REAL_GAME_PREDICTION_SQL()` 全仓 grep 的调用点只有 labBoundary 自己的定义/导出
 *   ＋ 两个测试文件；`classifyGame(...).scope` 的生产消费方只有 `intake.js:278` 一处，
 *   且只判 `=== 'real'`。
 *   ⇒ external 题**不会**被误当成真实局剔掉（安全方向没问题），
 *     但「按域分组、说清其中 N 条是人手写的」这件事**生产代码里没有任何地方在做**：
 *     external 题混在未落定清单、校准读数里，和批量灌入的语料题**同栏分不开**。
 *   ★`labBoundary.js:32` 当时自称该谓词的消费方是「auditKpi 的排除计数」——**那句话是假的**。
 *
 * 【本测试盯住的东西】
 *   ① **读侧存在**：有一个只读端点给出按域分组（`GET /api/predictions/domains`）。
 *   ② **口径唯一**：端点报的域 ≡ 逐行 `lab.classifyGame(games 行).scope`（不许另写一套判定）。
 *   ③ **两视图互斥且完备**：「人手写的」∪「其余」并集 == 账本总数（形态沿用 question-views.test.cjs）。
 *   ④ **绝不隐藏语料题**：筛掉的条数照报，且一条都没少。
 *   ⑤ **零写**：读端点连调多次，账本与 games 都不变。
 *
 * 铁律：DB=:memory:；零网络；不起真端口（app.inject）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const { db } = require('../src/deps');

const predictionsRoutes = require('../src/routes/predictions');
const predictionsStore = require('../src/db/predictionsStore');
const extLedger = require('../src/db/externalLedger');
const lab = require('../src/evidence/labBoundary');

const J = (r) => r.json();
const get = (app, url) => app.inject({ method: 'GET', url: url });
const conn = () => db.getConnection();

/** 「还没到期」那条外部题的到期日：**从生产的今天推算**，不写死日期。
 *
 *  ★2026-09-30 这道闸就是这么红的，不是产品回归，是夹具自己过期了：
 *   夹具原先写死 `matures_at: '2026-09-30'` 并注释「晚于今天」，
 *   而到期闸的判据是 `matures_at <= todayShanghai()`（src/db/predictionsStore.js:396，
 *   当日即到期）。到了 09-30 当天这条题就**到期**了 ⇒ 「未到期被排除」不再排除它
 *   ⇒ 它回到待落定页里 ⇒ 红的是一条已经讲不出原意的断言：
 *   它叫「两个口径真的会分叉」，可那天起它压根没在分叉（两口径都是 1）。
 *   写死日期的夹具必然在某一天腐坏，且腐坏时伪装成产品缺陷 —— 这正是本次的代价。
 *
 *  为什么 +1 年而不是 +1 天：生产的「今天」是**上海日历日**，这里从它出发，
 *  即使跑测的机器时区与它差一整天，到期日也远远落在今天之后 ⇒ 恒不腐坏。
 *  为什么不自己另写一套日期算法：predictionsStore.js:352-355 明确记着
 *  「两边各写一套日期算法正是本项目已经吃过一次亏的地方」——
 *  故直接用生产导出的 todayShanghai()，而不是复制它。 */
const NOT_YET_DUE = (() => {
  const d = new Date(predictionsStore.todayShanghai() + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
})();

let app = null;
/** 各域的局：语料局（CLI 批量灌入那些题挂这里）、外部题容器局、真实局。 */
let G = null;
/** 本测试亲手插的题，按域归堆，断言时逐条点名。 */
const IDS = { external: [], lab: [], real: [] };

function mkGame(name, gameType, source) {
  const info = conn().prepare(
    'INSERT INTO games (name, game_type, player_count, source) VALUES (?,?,?,?)'
  ).run(name, gameType, 1, source);
  return Number(info.lastInsertRowid);
}

function mkQuestion(gameId, statement, opts) {
  const o = opts || {};
  const info = conn().prepare(
    'INSERT INTO predictions (game_id, source_type, statement, layer, matures_at, resolved_at, outcome, assigned_prob)'
    + " VALUES (?, '预测卡', ?, 'L2', ?, ?, ?, ?)"
  ).run(gameId, statement,
    o.matures_at === undefined ? null : o.matures_at,
    o.resolved_at === undefined ? null : o.resolved_at,
    o.outcome === undefined ? null : o.outcome,
    o.assigned_prob === undefined ? null : o.assigned_prob);
  return Number(info.lastInsertRowid);
}

test.before(async () => {
  db.init(':memory:');
  predictionsStore.ensurePredictionsTable(db.getConnection());
  extLedger.ensureSourceColumn(db.getConnection()); // additive，照 sim-loop.cjs:77 先例
  app = Fastify();
  app.setErrorHandler((err, req, reply) => {   // 与 src/server.js:48-52 同契约
    const status = err && err.statusCode ? err.statusCode : 500;
    reply.code(status).send({ error: (err && err.message) ? err.message : String(err) });
  });
  predictionsRoutes.register(app);
  await app.ready();

  // 容器局走生产写路径（ensureExternalContainer），不自造一行 —— 它就是生产里那一个
  const container = extLedger.ensureExternalContainer();
  G = {
    external: container.id,
    lab: mkGame('语料局（CLI 批量灌入）', 'corpus:dlt', 'corpus'),
    real: mkGame('真实对局', 'werewolf', 'real'),
  };

  // 外部题：2 条人手写的（一条在途、**且尚未到期**，一条已落定）——这正是「记一笔」写进账本的那类。
  // 到期日走 NOT_YET_DUE（从生产今天 +1 年推算），**不得再写死日期**：见该常量上的说明。
  IDS.external.push(mkQuestion(G.external, '人手写的·伦敦日降水量', { matures_at: NOT_YET_DUE, assigned_prob: 0.4 }));
  IDS.external.push(mkQuestion(G.external, '人手写的·欧元兑美元', { resolved_at: '2026-09-01 00:00:00', outcome: 'true', assigned_prob: 0.6 }));
  // 语料/实验场题：4 条批量灌入的（一条是测试夹具，照 question-views 的做法保留可见）
  IDS.lab.push(mkQuestion(G.lab, '票房榜：本周冠军', {}));
  IDS.lab.push(mkQuestion(G.lab, '芝加哥地铁客流', {}));
  IDS.lab.push(mkQuestion(G.lab, '英超比分', { resolved_at: '2026-09-02 00:00:00', outcome: 'false', assigned_prob: 0.3 }));
  IDS.lab.push(mkQuestion(G.lab, '护栏：G2 行域样例', {}));
  // 真实局题：1 条（历史遗留，域门上线前落的）
  IDS.real.push(mkQuestion(G.real, '真实局里挂着的历史题', {}));
});

test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

/** 端点的域分组（404 之类直接炸——本测试要的就是"读侧不存在"先红）。 */
async function domains() {
  const r = await get(app, '/api/predictions/domains');
  assert.equal(r.statusCode, 200, 'GET /api/predictions/domains 必须 200（读侧披露端点）');
  return J(r);
}

// ─────────────────── ① 读侧存在：按域分组的那一屏 ───────────────────

test('★读侧有一个按域分组的只读端点（洞一的正主）', async () => {
  const b = await domains();
  assert.equal(b.ok, true);
  assert.equal(b.by_scope.external, IDS.external.length, '外部题（人手写的）必须能被单独数出来');
  assert.equal(b.by_scope.lab, IDS.lab.length);
  assert.equal(b.by_scope.real, IDS.real.length);
});

test('★「其中 N 条是人手写的」这句话必须是人话，且 N 与 by_scope.external 一致', async () => {
  const b = await domains();
  assert.equal(b.hand_written.n, b.by_scope.external);
  assert.equal(b.hand_written.scope, 'external');
  assert.ok(b.hand_written.label && b.hand_written.label.length > 0, '要有一句人能看懂的标签');
  assert.ok(b.disclosure.some((d) => /人手写/.test(d)), '披露句里必须出现"人手写"，否则用户看不见这件事');
  assert.ok(b.disclosure.some((d) => new RegExp(String(b.by_scope.external)).test(d)),
    '披露句里要带上真实条数（N=' + b.by_scope.external + '），不是一句空话');
});

// ─────────────────── ② 口径唯一：逐行对 classifyGame ───────────────────

test('★端点口径 ≡ 逐行 classifyGame(games 行).scope（不许另写一套判定）', async () => {
  const b = await domains();
  const truth = { real: 0, lab: 0, external: 0, unknown: 0 };
  const rows = conn().prepare(
    'SELECT p.id AS id, g.game_type AS game_type, g.source AS source FROM predictions p'
    + ' LEFT JOIN games g ON g.id = p.game_id ORDER BY p.id'
  ).all();
  assert.ok(rows.length > 0);
  for (const r of rows) {
    const g = r.game_type === null ? null : { game_type: r.game_type, source: r.source };
    truth[lab.classifyGame(g).scope] += 1;
  }
  for (const k of ['real', 'lab', 'external', 'unknown']) {
    assert.equal(b.by_scope[k], truth[k], '域 ' + k + ' 的计数与 classifyGame 不一致（口径分叉＝读数不可信）');
  }
});

test('★域分组在 SQL 侧与 classifyGame 同源（逐 games 行比对，含边角行）', async () => {
  const rows = conn().prepare('SELECT id, game_type, source FROM games').all();
  const got = conn().prepare('SELECT id, ' + lab.PREDICTION_SCOPE_SQL('g') + ' AS scope FROM games g').all();
  const m = new Map(got.map((r) => [r.id, r.scope]));
  for (const r of rows) {
    assert.equal(m.get(r.id), lab.classifyGame(r).scope, 'game_id=' + r.id + ' 的域判定分叉');
  }
  // 边角：无 source 列的旧行 / source 取值未知 / game_type 前后带空白 —— 全都要判得出且不抛
  for (const edge of [
    { game_type: 'external' }, { game_type: 'corpus:dlt', source: 'replay' },
    { game_type: 'werewolf', source: 'replay' }, { game_type: '' }, { game_type: null },
    { game_type: ' corpus:dlt ' }, { source: 'sim', game_type: 'werewolf' },
  ]) {
    assert.ok(lab.PREDICTION_SCOPE_SQL('g').length > 0);
    assert.ok(['real', 'lab', 'external', 'unknown'].indexOf(lab.classifyGame(edge).scope) !== -1,
      '边角行判不出域: ' + JSON.stringify(edge));
  }
});

// ─────────────────── ③ 两视图：互斥 + 并集 == 总数 ───────────────────

test('★两视图并集 == 账本总数（互斥且完备，可自校验——形态沿用 question-views.test.cjs）', async () => {
  const b = await domains();
  const hand = b.hand_written.n;                 // 视图一：人手写的（external）
  const rest = b.other.n;                        // 视图二：其余全部
  const total = conn().prepare('SELECT COUNT(*) n FROM predictions').get().n;
  assert.equal(b.total, total, '端点报的总数必须等于账本真实总数');
  assert.equal(hand + rest, total, '两视图之和 == 总数（一条都没被藏）');
  assert.equal(rest, b.by_scope.real + b.by_scope.lab + b.by_scope.unknown, '第二视图 == 三个非 external 域之和');
  assert.equal(b.sum_check.sum, total, '各域之和 == 总数');
  assert.equal(b.sum_check.ok, true);
  // 互斥：external 域不在第二视图的成分里（否则就是重叠）
  assert.equal(b.other.excluded_by_domain.external === undefined, true, '第二视图里不许再含 external 域');
});

test('★分页/筛选也不许把人手写的题筛没：不带任何参数时 total 恒等于账本总数', async () => {
  const all = await domains();
  for (const q of ['', '?limit=1', '?offset=3', '?view=hand_written']) {
    const r = await get(app, '/api/predictions/domains' + q);
    assert.equal(r.statusCode, 200, q + ' 不得 4xx');
    assert.equal(J(r).total, all.total, q + ' 改变了总数（总数必须与翻页无关）');
  }
});

// ─────────────────── ④ 绝不隐藏语料题 ───────────────────

test('★绝不隐藏语料题：语料题一条不少、条数照报、连测试夹具都在', async () => {
  const b = await domains();
  assert.equal(b.by_scope.lab, IDS.lab.length, '语料/实验场题一条都不能少');
  // 逐条点名：每一道亲手插的题都必须落在某个域里（互斥且不漏）
  const placed = new Set();
  for (const r of conn().prepare(
    'SELECT p.id AS id, ' + lab.PREDICTION_SCOPE_SQL('g') + ' AS scope FROM predictions p'
    + ' LEFT JOIN games g ON g.id = p.game_id'
  ).all()) placed.add(r.id + ':' + r.scope);
  for (const id of IDS.external) assert.ok(placed.has(id + ':external'), '外部题 ' + id + ' 落成了别的域');
  for (const id of IDS.lab) assert.ok(placed.has(id + ':lab'), '语料题 ' + id + ' 落成了别的域');
  for (const id of IDS.real) assert.ok(placed.has(id + ':real'), '真实局题 ' + id + ' 落成了别的域');
  assert.equal(placed.size, b.total, '每条题都恰好落在一个域里');
  // 筛掉多少必须照说：「人手写的」这一栏之外还剩多少
  assert.equal(b.hand_written.excluded_from_this_view, b.total - b.by_scope.external,
    '「人手写的」视图之外还有多少条，必须如实报出（筛掉了 N 条不能被读成数据没了 N 条）');
  assert.ok(b.other.note && /一条都没删|一条都没少|没删/.test(b.other.note),
    '第二视图要有一句"只是没算进这一栏、没有删"的说明');
});

test('★未落定清单：每行自带域，且两个域拆分都 ≡ 逐行 classifyGame', async () => {
  const u = J(await get(app, '/api/predictions/unresolved?limit=500'));
  assert.ok(Array.isArray(u.items), '未落定清单必须照旧返回 items（加域不许改既有键名）');
  assert.ok(u.total > 0, '在途题不得为空');

  // ① page_by_scope ≡ 逐行 scope（这一页里各域多少条）
  const pageTruth = { real: 0, lab: 0, external: 0, unknown: 0 };
  for (const it of u.items) {
    assert.ok(lab.SCOPES.indexOf(it.scope) !== -1, '未落定清单每行都要带 scope，收到: ' + it.scope);
    assert.ok(it.scope_label && it.scope_label.length > 0, '每行还要带一句人能看懂的域标签');
    pageTruth[it.scope] += 1;
  }
  for (const k of lab.SCOPES) {
    assert.equal(u.page_by_scope[k], pageTruth[k], '这一页的域 ' + k + ' 计数与行不符');
  }
  assert.equal(lab.SCOPES.reduce((a, k) => a + u.page_by_scope[k], 0), u.items.length,
    '这一页的域计数之和 == 行数（一条都不能漏）');

  // ② by_scope ≡ 全部未落定（outcome IS NULL）的域拆分。两个口径不同，必须各自说清。
  const allTruth = { real: 0, lab: 0, external: 0, unknown: 0 };
  for (const r of conn().prepare(
    'SELECT ' + lab.PREDICTION_SCOPE_SQL('g') + ' AS scope FROM predictions p'
    + ' LEFT JOIN games g ON g.id = p.game_id WHERE outcome IS NULL'
  ).all()) allTruth[r.scope] += 1;
  for (const k of lab.SCOPES) {
    assert.equal(u.by_scope[k], allTruth[k], '全部未落定的域 ' + k + ' 计数与账本不符');
  }
  assert.equal(lab.SCOPES.reduce((a, k) => a + u.by_scope[k], 0),
    conn().prepare('SELECT COUNT(*) n FROM predictions WHERE outcome IS NULL').get().n,
    '全部未落定的域计数之和 == 账本里 outcome IS NULL 的行数');
  assert.ok(u.by_scope.external > 0, '在途题里有人手写的那些（这正是要分开看的那批）');
  assert.ok(/by_scope/.test(u.scope_note) && /page_by_scope/.test(u.scope_note),
    '两个口径必须都写出来，否则读者会把 page 的数当成全部');
  assert.equal(u.l0_gate.unresolved, conn().prepare('SELECT COUNT(*) n FROM predictions WHERE outcome IS NULL').get().n,
    '既有 l0_gate 键必须原样在（加域不许动既有键的语义）');
});

test('★两个口径真的会分叉（到期闸筛掉的外部题在 page 里看不见，在 by_scope 里还在）', async () => {
  // IDS.external[0] 的到期日是 NOT_YET_DUE（生产今天 +1 年）⇒ 恒晚于今天
  //   ⇒ 恒过到期闸而不进页。★不再写死日期，否则到了那一天本条会伪装成产品缺陷。
  const u = J(await get(app, '/api/predictions/unresolved?limit=500'));
  const notYetDue = IDS.external[0];
  assert.ok(u.due_filter.today < NOT_YET_DUE, '前置：夹具必须真的是未到期（到期日 ' + NOT_YET_DUE + ' > 生产今天 ' + u.due_filter.today + '）');
  assert.ok(!u.items.some((r) => r.id === notYetDue), '没到期的题本来就不在待落定页里（既有到期闸语义，本轮不动）');
  assert.equal(u.by_scope.external, 1, '但它仍在「全部未落定」的 external 桶里 —— 不许因为不上页就当它没了');
  assert.equal(u.page_by_scope.external, 0, '这一页里的 external 确实是 0（到期闸筛掉的）');
  assert.ok(u.due_filter && typeof u.due_filter.excluded_not_yet_due === 'number',
    '到期闸的排除计数照旧要报（筛掉了多少必须说清）');
  assert.ok(u.due_filter.excluded_not_yet_due >= 1, '那条没到期的外部题必须被计进"未到期被排除"');
});

test('★校准读数也带域拆分（外部题不许悄悄混进同一个 ECE）', async () => {
  const c = J(await get(app, '/api/predictions/calibration'));
  assert.equal(c.ok === undefined ? true : c.ok, true);
  assert.ok(c.by_scope && typeof c.by_scope === 'object', '校准读数必须带 by_scope');
  for (const k of lab.SCOPES) assert.equal(typeof c.by_scope[k], 'number', '校准的域 ' + k + ' 必须是数（含 0）');
  const truth = { real: 0, lab: 0, external: 0, unknown: 0 };
  for (const r of conn().prepare(
    'SELECT ' + lab.PREDICTION_SCOPE_SQL('g') + " AS scope FROM predictions p"
    + " LEFT JOIN games g ON g.id = p.game_id"
    + " WHERE outcome IN ('true','false') AND assigned_prob IS NOT NULL"
  ).all()) truth[r.scope] += 1;
  for (const k of lab.SCOPES) assert.equal(c.by_scope[k], truth[k], '校准的域 ' + k + ' 计数与账本不符');
});

// ─────────────────── ⑤ 零写 ───────────────────

test('★域披露端点纯只读：连调四次，账本与 games 都不变', async () => {
  const snap = () => conn().prepare(
    'SELECT (SELECT COUNT(*) FROM predictions) AS p, (SELECT COUNT(*) FROM games) AS g'
  ).get();
  const before = JSON.stringify(snap());
  for (const q of ['', '?view=hand_written', '?view=other', '?limit=2']) {
    const r = await get(app, '/api/predictions/domains' + q);
    assert.equal(r.statusCode, 200, q);
  }
  assert.equal(JSON.stringify(snap()), before, '读端点零写');
});

// ─────────────────── ⑥ 那句假话必须被改正 ───────────────────

test('★labBoundary 的「消费方」清单不再给零调用的谓词编一个报表消费方（那句话当时是假的）', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'evidence', 'labBoundary.js'), 'utf8');
  const head = src.slice(0, src.indexOf('const LAB_GAME_TYPE_PREFIXES'));
  // ★只查**消费方那几行**（原话「② 读侧排除谓词 NOT_REAL_GAME_PREDICTION_SQL()（报表侧披露排除计数）」
  //   就写在那一段里），不去查整个文件头：更正说明里原样引用了那句假话，
  //   拿整个文件头去 grep 会让"如实记录改了什么"也被判成"还在说假话"。
  const lines = head.split('\n');
  const start = lines.findIndex((l) => /消费方：/.test(l));
  assert.ok(start !== -1, '消费方那一段要保留（删成"不写消费方"等于换一个谎）');
  const bullet = lines.slice(start, start + 6).join('\n');
  assert.equal(/NOT_REAL_GAME_PREDICTION_SQL/.test(bullet), false,
    '消费方清单里还挂着那个谓词——实测全仓 grep，它的调用点只有定义/导出 ＋ 两个测试文件，报表侧一个都没有');
  assert.equal(/auditKpi/.test(head), false);
  assert.ok(/\/api\/predictions\/domains/.test(bullet), '消费方清单要指名本轮真接上的读侧端点');
  // 反向自证：消费方清单里写的端点，生产代码里真的存在（防止又写一句假的）
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'predictions.js'), 'utf8');
  assert.ok(routes.indexOf("'/api/predictions/domains'") !== -1, '消费方清单指名的端点在生产代码里不存在 ⇒ 那又是一句假话');
  assert.ok(routes.indexOf("'/api/predictions/unresolved'") !== -1 && routes.indexOf("'/api/predictions/calibration'") !== -1);
  // 谓词本身没被删（它仍是导出的 API），只是不再有人拿它冒充"报表在用"
  assert.ok(/NOT_REAL_GAME_PREDICTION_SQL/.test(src), '谓词本身必须还在（不许用删代码来让断言变绿）');
  assert.ok(/NOT_REAL_GAME_PREDICTION_SQL,/.test(src), '它仍须从模块导出');
});

test('★读侧消费方在生产代码里真的接上了（不只是端点存在）', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'predictions.js'), 'utf8');
  assert.ok(/PREDICTION_SCOPE_SQL/.test(src), 'predictions.js 必须用 labBoundary 的域口径，不是自己写一套');
  assert.equal(/scope\s*===\s*'external'|scope\s*===\s*"external"/.test(src), false,
    '不许拿 scope===external 当域门（那只该留在拒收门里剔真实局）');
});

// ─────────────────── ⑦ 库上没有 games.source 列的形态（回归闸）───────────────────

test('★库上没有 games.source 列时读侧照常工作（COALESCE 救不了缺列，SQLite 在 prepare 期就炸）', async () => {
  // 【这条是被既有测试打红的】`predictions.test.cjs` 的 `:memory:` 库走 `buildServer`，
  //   p1a 的 games DDL 里**没有** source 列 ⇒ 硬写 `COALESCE(g.source,'')` 直接
  //   `SqliteError: no such column: g.source`（实测报在 prepare，不是运行期取数）。
  //   那不是边角形态：新库/测试库都长这样（它是 sim-loop / externalLedger 的 additive ALTER 才补上的），
  //   所以域披露端点必须在两种库上都 200，且域判定自动退回 game_type 那条路。
  const cols = conn().pragma('table_info(games)').map((c) => c.name);
  assert.equal(cols.indexOf('source') !== -1, true, '本文件的 before 补过这一列；下面要的是**没补**的形态');

  await app.close();
  db.closeCurrent();
  db.init(':memory:');
  predictionsStore.ensurePredictionsTable(db.getConnection()); // ★故意不调 ensureSourceColumn
  assert.equal(db.getConnection().pragma('table_info(games)').map((c) => c.name).indexOf('source'), -1,
    '这个库确实没有 source 列（否则本测试测不到东西）');
  const app2 = Fastify();
  app2.setErrorHandler((err, req, reply) => {
    const status = err && err.statusCode ? err.statusCode : 500;
    reply.code(status).send({ error: (err && err.message) ? err.message : String(err) });
  });
  predictionsRoutes.register(app2);
  await app2.ready();
  const c2 = db.getConnection();
  const labGame = Number(c2.prepare(
    "INSERT INTO games (name, game_type, player_count) VALUES ('无 source 列·语料局', 'corpus:dlt', 1)"
  ).run().lastInsertRowid);
  const extGame = Number(c2.prepare(
    "INSERT INTO games (name, game_type, player_count) VALUES ('无 source 列·外部题容器', 'external', 1)"
  ).run().lastInsertRowid);
  c2.prepare("INSERT INTO predictions (game_id, source_type, statement, layer) VALUES (?,'预测卡','a','L2')").run(extGame);
  c2.prepare("INSERT INTO predictions (game_id, source_type, statement, layer) VALUES (?,'预测卡','b','L2')").run(labGame);
  try {
    for (const u of ['/api/predictions/domains', '/api/predictions/unresolved?limit=100', '/api/predictions/calibration']) {
      const r = await app2.inject({ method: 'GET', url: u });
      assert.equal(r.statusCode, 200, u + ' 在无 source 列的库上 500 了（' + r.json().error + '）');
    }
    const d = J(await app2.inject({ method: 'GET', url: '/api/predictions/domains' }));
    // 没有 source 列 ⇒ 判定退回 game_type：'external' 仍精确命中，'corpus:*' 仍走白名单前缀
    assert.equal(d.by_scope.external, 1, '无 source 列时仍要认得出外部题容器');
    assert.equal(d.by_scope.lab, 1, '无 source 列时仍要认得出语料局');
    assert.equal(d.sum_check.ok, true, '守恒量在无 source 列的库上同样成立');
  } finally {
    await app2.close();
    db.closeCurrent();
  }
});
