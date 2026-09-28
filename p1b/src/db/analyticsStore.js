'use strict';
/**
 * p1b/src/db/analyticsStore.js —— P0-4 最小可用埋点（p1b 私有表 analytics_*）。
 *
 * ── 为什么有这张表 ───────────────────────────────────────────────────────────
 *   评审实测：全项目无埋点、无 analytics、无 session 表、无访问日志 ⇒
 *   「有没有人第二次用过」这个问题**结构上没有答案**（不是数不好看，是压根没这个数）。
 *   本模块补的正是这条链：会话开始/结束 + 三个关键事件 + 访客身份。
 *
 * ── ★隐私硬约束（改本文件前先读这段）───────────────────────────────────────
 *   1) **只记事件与计数**。表里没有任何一列能承载题面文字、姓名、邮箱、IP、UA、Referer。
 *      这一点是**结构性的**（表里就没这些列），不是靠调用方自觉——测试里有反证：
 *      往接口里夹带题面/邮箱/IP/UA，落库后全表扫描扫不到任何一个字。
 *   2) 题目只以 `subject_id`（整数主键）出现：**可计数、不可阅读**。
 *      要看题面请走题库自己的端点，埋点不复制题面。
 *   3) 访客身份是**服务端发的一枚随机串**（v_ + 32 hex），与任何人、任何设备无映射关系。
 *      浏览器 localStorage 存着它只是为了跨会话保持"同一个人"，库里没有第二份可关联的字段。
 *   4) 作者密钥**只走环境变量**、只做内存里的一次常量时间比较，**一个字节都不入库**。
 *   5) 新增列前请自问：这一列能不能反推出「是谁/写的是什么」？能 ⇒ 不加。
 *
 * ── ★作者 vs 非作者：怎么判定（详见 docs/specs/2026-09-28-P0-4-埋点与作者判定-design.md）──
 *   这是本轮埋点的**全部价值所在**：分不开作者本人和外部访客，计数就没有意义
 *   （作者自己天天点，PMF 数字会被自己的使用量冲垮）。
 *
 *   机制：一份**只有作者知道**的共享密钥（env `P1B_AUTHOR_KEY`）。
 *     · 前端在请求里出示（body.author_key，或 header `x-p1b-author-key`）；
 *     · 服务端与 env 做 `crypto.timingSafeEqual` 常量时间比较（先比长度，长度不泄露内容）；
 *     · 相符 ⇒ 该访客行 actor 置 'author'；不符/未出示 ⇒ 'visitor'；
 *     · 落库的只有**判定结果**（actor）与**判定依据**（actor_proof 枚举），
 *       密钥原文永不写库、永不进日志、永不回响应。
 *   fail-closed：env 没配 ⇒ **谁也判不出作者**（宁可把作者记成访客，也不能把访客记成作者
 *   ——两个方向的错，后一个会直接毁掉 PMF 判断）。此时 summary 如实回报
 *   `author_key_configured:false` 并告警，绝不静默给一个看起来能用的数。
 *
 *   它**不是身份认证**，是**分隔符**：P1B-SPEC §6 本就明令局域网可信网不做鉴权，
 *   所以这里防的是「把作者本人的使用混进访客计数」，不防有意冒充
 *   （知道密钥就能冒充——但知道密钥的人本来就能直接改库）。
 *
 * ── 身份归属的两层切分 ──────────────────────────────────────────────────────
 *   visitor_id = **服务端发**的。客户端带来的陌生 id 一律不认，改为重发新 id 并回报
 *     `visitor_reissued:true`——身份只能由服务端铸造，避免前端伪造/撞库。
 *   session_id = **客户端持有**的关联键。它只是幂等去重用的，不承载身份。
 *
 * ── 存储切分（照 intakeStore/verdictsStore/predictionsStore 既有范式）────────
 *   共享库禁 DDL ⇒ p1b 私有表，启动/注册时 `CREATE TABLE IF NOT EXISTS` 的 additive 新表，
 *   不改 p1a 任何既有表、不改任何既有列语义。零新依赖（只用 node 内置 crypto）。
 */
const crypto = require('crypto');
const { db } = require('../deps');

/** 三个关键事件（枚举写死，防脏事件名静默落空——与 intakeStore.REASONS 同一纪律）。 */
const EVENTS = ['question_created', 'question_settled', 'question_revisited'];
/** 两类使用者。actor 由作者密钥判定，不由任何客户端可自填的字段决定。 */
const ACTORS = ['author', 'visitor'];
/** 会话结束原因（客户端自报，仅用于归因，取值枚举化）。 */
const END_REASONS = ['client_beacon', 'pagehide', 'idle_timeout', 'restart'];

/** n<30 纪律（与 auditKpi.brierCi、披露件同一口径）：分母不足 30 一律不出比例。 */
const MIN_N = 30;

// ── DDL（additive；全部 IF NOT EXISTS ⇒ 幂等）─────────────────────────────────
const SCHEMA_VISITORS = [
  'CREATE TABLE IF NOT EXISTS analytics_visitors (',
  '  visitor_id TEXT PRIMARY KEY,',                    // 服务端发的随机串；★无任何可关联到人的字段
  "  actor TEXT NOT NULL CHECK(actor IN ('author','visitor'))",
  "    DEFAULT 'visitor',",                            // 判定不出 ⇒ 默认访客（fail-closed 的落库形态）
  "  actor_proof TEXT NOT NULL DEFAULT 'no_server_key'", // 判定依据枚举；★永不是密钥本身
  "    CHECK(actor_proof IN ('key_match','key_mismatch','no_key_presented','no_server_key'))",
  "    CHECK(actor <> 'author' OR actor_proof = 'key_match'),", // 结构上锁死：作者行必须且只能由密钥命中产生
  "  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),",
  "  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),",
  '  session_count INTEGER NOT NULL DEFAULT 0',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_analytics_visitors_actor ON analytics_visitors(actor);',
].join('\n');

const SCHEMA_SESSIONS = [
  'CREATE TABLE IF NOT EXISTS analytics_sessions (',
  '  session_id TEXT PRIMARY KEY,',                    // 客户端关联键（幂等去重用）
  '  visitor_id TEXT NOT NULL REFERENCES analytics_visitors(visitor_id),',
  "  actor TEXT NOT NULL CHECK(actor IN ('author','visitor')),",
  "  started_at TEXT NOT NULL DEFAULT (datetime('now')),",
  '  ended_at TEXT,',                                  // 会话结束时刻；NULL = 进行中
  '  end_reason TEXT',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_analytics_sessions_visitor ON analytics_sessions(visitor_id, started_at);',
].join('\n');

const SCHEMA_EVENTS = [
  'CREATE TABLE IF NOT EXISTS analytics_events (',
  '  id INTEGER PRIMARY KEY,',
  "  event TEXT NOT NULL CHECK(event IN ('question_created','question_settled','question_revisited')),",
  '  visitor_id TEXT NOT NULL REFERENCES analytics_visitors(visitor_id),',
  '  session_id TEXT REFERENCES analytics_sessions(session_id),',
  "  actor TEXT NOT NULL CHECK(actor IN ('author','visitor')),",
  '  subject_id INTEGER CHECK(subject_id IS NULL OR subject_id >= 0),', // ★只存题目的整数 id
  "  created_at TEXT NOT NULL DEFAULT (datetime('now'))",
  ');',
  'CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON analytics_events(event, created_at);',
  // 幂等去重：同一访客、同一会话、同一题、同一事件只计一次。
  // 表达式索引（照 verdictsStore 的 COALESCE 先例）保证 NULL 也参与唯一性。
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_analytics_events_once ON analytics_events('
    + "visitor_id, event, IFNULL(subject_id, -1), IFNULL(session_id, ''));",
].join('\n');

const SCHEMA_ALL = [SCHEMA_VISITORS, SCHEMA_SESSIONS, SCHEMA_EVENTS].join('\n');

/** 启动/路由注册时调用一次：建三张 additive 私有表（幂等；零碰 p1a 既有表）。 */
function ensureAnalyticsTables(conn) {
  if (!conn) throw new Error('ensureAnalyticsTables: 需要 better-sqlite3 连接');
  conn.exec(SCHEMA_ALL);
}

// ── 作者判定 ─────────────────────────────────────────────────────────────────
/** 服务端持有的作者密钥。恒从 env 读，**不落盘、不入库、不回响应**。 */
function serverAuthorKey() {
  const k = process.env.P1B_AUTHOR_KEY;
  return typeof k === 'string' ? k : '';
}

/**
 * 判定本次请求是谁：作者本人 or 非作者。
 * 纯函数、不写库；结果只有 {actor, actor_proof} 两个枚举值，**不含密钥的任何片段**。
 * - 无服务端密钥 ⇒ 谁都判不出作者（fail-closed，见文件头注释）。
 * - 比对走 crypto.timingSafeEqual；长度不同直接判不符（长度本身不是秘密）。
 */
function classifyActor(presentedKey) {
  const want = serverAuthorKey();
  if (!want) return { actor: 'visitor', actor_proof: 'no_server_key' };
  if (typeof presentedKey !== 'string' || !presentedKey) return { actor: 'visitor', actor_proof: 'no_key_presented' };
  const a = Buffer.from(presentedKey, 'utf8');
  const b = Buffer.from(want, 'utf8');
  if (a.length !== b.length) return { actor: 'visitor', actor_proof: 'key_mismatch' };
  return crypto.timingSafeEqual(a, b)
    ? { actor: 'author', actor_proof: 'key_match' }
    : { actor: 'visitor', actor_proof: 'key_mismatch' };
}

// ── 身份 ─────────────────────────────────────────────────────────────────────
/** 服务端铸造访客 id：v_ + 32 hex（crypto.randomBytes ⇒ 不可由客户端推算）。 */
function newVisitorId() { return 'v_' + crypto.randomBytes(16).toString('hex'); }
/** 客户端关联键的合法形状：只允许字母数字与 _ - . : （挡掉注入/超长/乱码）。 */
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
function isValidId(s) { return typeof s === 'string' && ID_RE.test(s); }
function newSessionId() { return 's_' + crypto.randomBytes(16).toString('hex'); }

function getVisitorRow(visitorId) {
  if (!isValidId(visitorId)) return null;
  return db.getConnection().prepare('SELECT * FROM analytics_visitors WHERE visitor_id = ?').get(visitorId) || null;
}

/**
 * 认领（或铸造）一个访客身份。
 * - 客户端带来的 id **必须在库里存在**才认；陌生 id 不认，改铸新 id 并回报 reissued。
 *   理由：身份只由服务端铸造，客户端无法凭空造一个"老访客"来污染计数。
 * - 判定为作者时把该行升级为 author（只升不降：偶发的一次误判不该把作者永久打成访客）。
 * @returns {{row:object, reissued:boolean, actor:string, actor_proof:string}}
 */
function resolveVisitor(opts) {
  const o = opts || {};
  const conn = db.getConnection();
  const judged = classifyActor(o.authorKey);
  let row = getVisitorRow(o.visitorId);
  let reissued = false;
  if (!row) {
    reissued = true;
    const id = newVisitorId();
    conn.prepare('INSERT INTO analytics_visitors (visitor_id, actor, actor_proof) VALUES (?,?,?)')
      .run(id, judged.actor, judged.actor_proof);
    row = getVisitorRow(id);
  } else if (judged.actor === 'author' && row.actor !== 'author') {
    conn.prepare("UPDATE analytics_visitors SET actor='author', actor_proof='key_match' WHERE visitor_id=?")
      .run(row.visitor_id);
    row = getVisitorRow(row.visitor_id);
  }
  conn.prepare("UPDATE analytics_visitors SET last_seen_at = datetime('now') WHERE visitor_id = ?").run(row.visitor_id);
  return { row: row, reissued: reissued, actor: row.actor, actor_proof: row.actor_proof };
}

// ── 会话 ─────────────────────────────────────────────────────────────────────
/**
 * 会话开始。幂等：已存在的 session_id 直接回报原行（duplicate:true），不产生第二行。
 * @param {{visitorId?:string, sessionId?:string, authorKey?:string}} o
 */
function startSession(o) {
  const opts = o || {};
  const conn = db.getConnection();
  if (opts.sessionId && isValidId(opts.sessionId)) {
    const exists = conn.prepare('SELECT * FROM analytics_sessions WHERE session_id = ?').get(opts.sessionId);
    if (exists) {
      touchSession(exists.session_id);
      return { session: readSession(exists.session_id), duplicate: true, reissued: false, actor: exists.actor };
    }
  }
  const who = resolveVisitor({ visitorId: opts.visitorId, authorKey: opts.authorKey });
  const sessionId = (opts.sessionId && isValidId(opts.sessionId)) ? opts.sessionId : newSessionId();
  conn.prepare('INSERT INTO analytics_sessions (session_id, visitor_id, actor) VALUES (?,?,?)')
    .run(sessionId, who.row.visitor_id, who.row.actor);
  conn.prepare('UPDATE analytics_visitors SET session_count = session_count + 1 WHERE visitor_id = ?').run(who.row.visitor_id);
  return {
    session: readSession(sessionId), duplicate: false,
    reissued: who.reissued, actor: who.row.actor, actor_proof: who.row.actor_proof,
    visitor_id: who.row.visitor_id, session_id: sessionId,
  };
}

function readSession(sessionId) {
  return db.getConnection().prepare('SELECT * FROM analytics_sessions WHERE session_id = ?').get(sessionId) || null;
}
function touchSession(sessionId) {
  db.getConnection().prepare("UPDATE analytics_sessions SET started_at = started_at WHERE session_id = ?").run(sessionId);
}

/** 会话结束。幂等：已结束的行不覆盖 ended_at / end_reason（首次结束时间才是事实）。 */
function endSession(sessionId, reason) {
  if (!isValidId(sessionId)) return null;
  const conn = db.getConnection();
  const row = readSession(sessionId);
  if (!row) return null;
  if (row.ended_at) return { session: row, duplicate: true };
  const r = (END_REASONS.indexOf(reason) === -1) ? null : reason;
  conn.prepare("UPDATE analytics_sessions SET ended_at = datetime('now'), end_reason = ? WHERE session_id = ?")
    .run(r, sessionId);
  return { session: readSession(sessionId), duplicate: false };
}

// ── 事件 ─────────────────────────────────────────────────────────────────────
/**
 * 记一个事件。★调用方**只能**传 event/visitor_id/session_id/subject_id——
 *   路由层按白名单取字段、绝不 spread 请求体，所以题面/邮箱/IP 想落库也落不进来。
 * 幂等：同 (visitor, session, subject, event) 只计一次（前端重试不虚增）。
 */
function recordEvent(o) {
  const opts = o || {};
  const conn = db.getConnection();
  const event = opts.event;
  if (EVENTS.indexOf(event) === -1) throw new Error('event 必须是 ' + EVENTS.join('|'));

  // 事件的身份：优先取会话上的 actor（会话是进站时的身份快照，最准），
  // 其次取访客行；都没有 ⇒ 该次调用自身判一次（作者密钥仍然生效）。
  let session = (opts.sessionId && isValidId(opts.sessionId)) ? readSession(opts.sessionId) : null;
  let visitorId = null;
  let actor = null;
  let actorProof = null;
  if (session) {
    visitorId = session.visitor_id;
    actor = session.actor;
  } else if (opts.visitorId && isValidId(opts.visitorId)) {
    const vr = getVisitorRow(opts.visitorId);
    if (vr) { visitorId = vr.visitor_id; actor = vr.actor; }
  }
  if (!visitorId) {
    const who = resolveVisitor({ visitorId: opts.visitorId, authorKey: opts.authorKey });
    visitorId = who.row.visitor_id; actor = who.row.actor; actorProof = who.row.actor_proof;
  } else if (session && session.actor === 'author' && actorProof === null) {
    actorProof = 'key_match';
  }

  const subjectId = (opts.subjectId === undefined || opts.subjectId === null) ? null : Number(opts.subjectId);
  const info = conn.prepare(
    'INSERT OR IGNORE INTO analytics_events (event, visitor_id, session_id, actor, subject_id) VALUES (?,?,?,?,?)'
  ).run(event, visitorId, session ? session.session_id : null, actor, subjectId);
  const duplicate = info.changes === 0;
  const row = conn.prepare('SELECT * FROM analytics_events WHERE visitor_id=? AND event=? AND IFNULL(subject_id,-1)=? AND IFNULL(session_id,\'\')=?')
    .get(visitorId, event, subjectId === null ? -1 : subjectId, session ? session.session_id : '');
  return { event_row: row || null, duplicate: duplicate, actor: actor, actor_proof: actorProof, visitor_id: visitorId };
}

// ── 计数导出（只读）──────────────────────────────────────────────────────────
/** n<30 口径块：分母不足 30 一律不出比例，只给原始计数 + 一句人话。 */
function rateBlock(numerator, denominator) {
  const n = Number(numerator) || 0;
  const d = Number(denominator) || 0;
  const enough = d >= MIN_N;
  return {
    numerator: n, denominator: d, enough: enough,
    returning_rate: enough ? (d > 0 ? n / d : null) : null,
    note: enough
      ? ('分母 ' + d + ' ≥ ' + MIN_N + ' ⇒ 给比例')
      : ('只有 ' + d + ' 个' + (d === 1 ? '样本' : '计数单位') + '（不足 ' + MIN_N + '）⇒ 不给比例，只记原始计数'),
  };
}

function bucketByActor(actor) {
  const conn = db.getConnection();
  const visitors = conn.prepare('SELECT COUNT(*) n FROM analytics_visitors WHERE actor = ?').get(actor).n;
  // 「用过第二次」＝ 同一访客名下的会话数 ≥ 2（这正是评审里结构上没有答案的那个数）
  const returning = conn.prepare(
    'SELECT COUNT(*) n FROM (SELECT visitor_id FROM analytics_sessions WHERE actor = ? GROUP BY visitor_id HAVING COUNT(*) >= 2)'
  ).get(actor).n;
  const sessions = conn.prepare('SELECT COUNT(*) n FROM analytics_sessions WHERE actor = ?').get(actor).n;
  const open = conn.prepare('SELECT COUNT(*) n FROM analytics_sessions WHERE actor = ? AND ended_at IS NULL').get(actor).n;
  const events = {};
  for (const e of EVENTS) {
    events[e] = conn.prepare('SELECT COUNT(*) n FROM analytics_events WHERE actor = ? AND event = ?').get(actor, e).n;
  }
  return {
    visitors: visitors, sessions: sessions, open_sessions: open,
    returning_visitors: returning,
    returning_rate_block: rateBlock(returning, visitors),
    events: events,
  };
}

/**
 * 计数总览（纯 SQL 只读；零 LLM、零写）。
 * ★两条读数纪律：①作者桶与非作者桶**必须分开给**（混在一起的 PMF 数没有意义）；
 *   ②任何比例的分母 < 30 一律 null + note（原始计数照给——它是事实，不是推断）。
 */
function summary() {
  const conn = db.getConnection();
  const byActor = { author: bucketByActor('author'), visitor: bucketByActor('visitor') };
  const totals = {
    visitors: byActor.author.visitors + byActor.visitor.visitors,
    sessions: byActor.author.sessions + byActor.visitor.sessions,
    returning_visitors: byActor.author.returning_visitors + byActor.visitor.returning_visitors,
  };
  totals.returning_rate_block = rateBlock(totals.returning_visitors, totals.visitors);

  const events = {};
  for (const e of EVENTS) {
    events[e] = {
      total: conn.prepare('SELECT COUNT(*) n FROM analytics_events WHERE event = ?').get(e).n,
      author: byActor.author.events[e],
      visitor: byActor.visitor.events[e],
    };
  }

  const keyConfigured = !!serverAuthorKey();
  const warnings = [];
  if (!keyConfigured) {
    warnings.push('服务端未配 P1B_AUTHOR_KEY ⇒ **谁也判不出作者**，本表把所有人的使用都记成访客；'
      + '配好这个环境变量后，作者本人的使用才能与非作者分开。');
  }
  if (totals.visitors < MIN_N) {
    warnings.push('总样本 ' + totals.visitors + ' < ' + MIN_N + ' ⇒ 所有比例均不给数（只记原始计数）。');
  }
  const openSessions = byActor.author.open_sessions + byActor.visitor.open_sessions;
  if (openSessions > 0) {
    warnings.push('有 ' + openSessions + ' 个会话没收到结束上报（关页面时 beacon 丢失属常态）⇒ 会话数会略微高估。');
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    author_key_configured: keyConfigured,
    min_n: MIN_N,
    totals: totals,
    by_actor: byActor,
    events: events,
    privacy: [
      '只记事件与计数：库里没有题面、姓名、邮箱、IP、UA、Referer 任何一列（结构上就没有，不是靠自觉）。',
      '题目只以 subject_id（整数主键）出现——可计数、不可阅读。',
      '访客 id 是服务端发的随机串，与任何真实身份无映射；它只是让"同一个人"在多次会话间可被认出。',
      '作者密钥只在内存里做一次常量时间比较，一个字节都不入库、不进日志、不回响应。',
    ],
    warnings: warnings,
    note: '本端点纯只读（零 LLM、零写）。两桶互斥且完备：totals.visitors ≡ by_actor.author.visitors + by_actor.visitor.visitors，可自校验。',
  };
}

module.exports = {
  ensureAnalyticsTables, SCHEMA_ALL, SCHEMA_VISITORS, SCHEMA_SESSIONS, SCHEMA_EVENTS,
  EVENTS, ACTORS, END_REASONS, MIN_N,
  classifyActor, serverAuthorKey, newVisitorId, newSessionId, isValidId,
  resolveVisitor, startSession, endSession, recordEvent, getVisitorRow, readSession,
  bucketByActor, rateBlock, summary,
};
