'use strict';
/**
 * 局鉴 · src/db/store.js —— 持久化层（唯一真源）
 *
 * ══ 为什么是重写而不是复制 ═══════════════════════════════════════════════
 *   推演沙盘的 `p1a-terminal/src/db.js`（580 行）是那边的「禁改面 · 契约 v1」，
 *   里面混着预测账本的全部表与语义。把它整个搬过来会让局鉴背上不属于它的包袱，
 *   并且制造「两份 schema 真源」——那是比重复代码更贵的一种债。
 *   ⇒ **重写**：只保留对局域的 9 张表，语义逐条对齐契约 v1，判据一条不放松。
 *
 * ══ 技术选型：node:sqlite，不是 better-sqlite3 ═══════════════════════════
 *   Node ≥22.5 内置。本项目因此**零原生依赖**——
 *   不必再处理原生模块的路径登记、沙箱解压后的 dll 定位、跨平台二进制分发。
 *   沙盘那边 57 处待登记的绝对/拼接路径，本项目从一开始就不欠这笔账。
 *
 * ══ 一条不许放松的诚实约束（RD1，从契约 v1 原样继承）════════════════════
 *   `innocent_explanations` 必须非空：**没有无辜解释的矛盾对，不得入库、不得展示。**
 *   这条不是校验噪音，它是本项目全部产品价值的根——
 *   「这两句话互相矛盾」若说不出「也可能不是矛盾」，那就不该被记成矛盾。
 *   它同时也是「复盘器而非破案器」这一定位在存储层的强制点。
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const PHASES = ['night', 'day', 'dusk'];
const EVENT_TYPES = ['statement', 'vote', 'death', 'claim', 'action_reveal', 'system'];
const PREDICATES = ['is_wolf', 'is_good', 'is_role', 'claims_role', 'voted', 'did_action', 'said'];
const ACTION_KINDS = ['vote', 'abstain', 'kill_target', 'poison_target', 'protect_target', 'check_target', 'self_explode'];
const UNDERDETERMINATIONS = ['high', 'mid', 'low'];
const GENERATED_BY = ['code', 'llm'];
const TENDENCIES = ['strong', 'mid', 'weak'];
const BOTC_PREDICATES = ['is_demon', 'is_minion', 'status_drunk', 'status_poisoned'];
const BOTC_SCRIPTS = ['tb', 'bmr', 'snv'];
const PHASE_ORDER = { night: 0, day: 1, dusk: 2 };

/** 默认库位：优先环境变量，其次项目内 data/，再次用户目录（跨平台各给各的合理默认）。 */
const DEFAULT_DB_PATH = process.env.JUJIAN_DB
  || path.join(__dirname, '..', '..', 'data', 'jujian.db');

const SCHEMA_VERSION = '1';

// ── 9 张表 ────────────────────────────────────────────────────────────────
// 顺序即建表顺序；FK 依赖 games → players → events → claims/actions。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, game_type TEXT NOT NULL,
  player_count INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
  seat INTEGER NOT NULL, name TEXT NOT NULL, UNIQUE(game_id, seat)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
  day INTEGER NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('night','day','dusk')),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('statement','vote','death','claim','action_reveal','system')),
  actor_seat INTEGER REFERENCES players(id),
  raw_text TEXT NOT NULL,
  UNIQUE(game_id, seq)
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
  seat INTEGER NOT NULL, subject_seat INTEGER NOT NULL,
  predicate TEXT NOT NULL CHECK(predicate IN
    ('is_wolf','is_good','is_role','claims_role','voted','did_action','said')),
  object TEXT NOT NULL,
  extracted_by TEXT NOT NULL DEFAULT 'llm', confirmed_by_user INTEGER NOT NULL DEFAULT 0,
  retracted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
  seat INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN
    ('vote','abstain','kill_target','poison_target','protect_target','check_target','self_explode')),
  target_seat INTEGER, result TEXT,
  retracted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contradictions (
  id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
  claim_a INTEGER REFERENCES claims(id), claim_b INTEGER REFERENCES claims(id),
  action_a INTEGER REFERENCES actions(id), action_b INTEGER REFERENCES actions(id),
  conflict_desc TEXT NOT NULL,
  underdetermination TEXT NOT NULL CHECK(underdetermination IN ('high','mid','low')),
  innocent_explanations TEXT NOT NULL,
  generated_by TEXT NOT NULL CHECK(generated_by IN ('code','llm'))
);
CREATE TABLE IF NOT EXISTS hypotheses (
  id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
  day INTEGER NOT NULL, content TEXT NOT NULL, stance TEXT NOT NULL,
  support_events TEXT NOT NULL, oppose_events TEXT NOT NULL,
  tendency TEXT NOT NULL CHECK(tendency IN ('strong','mid','weak'))
);
CREATE TABLE IF NOT EXISTS botc_games (
  game_id INTEGER PRIMARY KEY REFERENCES games(id),
  script TEXT NOT NULL CHECK(script IN ('tb','bmr','snv')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS botc_claims (
  id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  seat INTEGER NOT NULL, subject_seat INTEGER NOT NULL,
  predicate TEXT NOT NULL CHECK(predicate IN
    ('is_demon','is_minion','status_drunk','status_poisoned')),
  object TEXT NOT NULL DEFAULT '',
  extracted_by TEXT NOT NULL DEFAULT 'llm', confirmed_by_user INTEGER NOT NULL DEFAULT 0,
  retracted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_game    ON events(game_id, day, seq);
CREATE INDEX IF NOT EXISTS idx_claims_event   ON claims(event_id);
CREATE INDEX IF NOT EXISTS idx_actions_event  ON actions(event_id);
CREATE INDEX IF NOT EXISTS idx_contra_game    ON contradictions(game_id);
CREATE INDEX IF NOT EXISTS idx_hypo_game      ON hypotheses(game_id, day);
CREATE INDEX IF NOT EXISTS idx_botcclaim_game ON botc_claims(game_id);
`;

// ── 连接 ──────────────────────────────────────────────────────────────────

function openDb(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  const cur = db.prepare('SELECT value FROM meta WHERE key=?').get('schema_version');
  if (cur === undefined) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);
  } else if (cur.value !== SCHEMA_VERSION) {
    // ★本项目不做静默迁移。schema 版本不符即拒开库，让启动期就发现。
    //   （沙盘那边靠 migrateDb 加列；局鉴第一天就把这条债留在零处。）
    throw new Error(
      `[jujian-db] 库 schema 版本是 ${cur.value}，本程序需要 ${SCHEMA_VERSION}。`
      + '局鉴不做自动迁移 —— 请用导出的 JSON 重新导入，或另起新库。');
  }
  return db;
}

/**
 * 事务包装。node:sqlite 没有 better-sqlite3 的 db.transaction()，手写 BEGIN/COMMIT。
 * ★刻意不支持嵌套：BEGIN 撞车会静默吞掉内层提交，所以内层调本函数 = 立即抛错，
 *   宁可吵一架也不要写出一个「以为原子其实不原子」的函数。
 */
function tx(db, fn) {
  if (db.__inTx) throw new Error('[jujian-db] 事务嵌套被拒：本函数不支持嵌套事务');
  db.__inTx = true;
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* 回滚失败时保留原错误，它更有信息量 */ }
    throw e;
  } finally {
    db.__inTx = false;
  }
}

// ── 判据（一条不放松）──────────────────────────────────────────────────────

function fail(msg) { throw new Error('[jujian-db] ' + msg); }
function assertEnum(name, value, list) {
  if (!list.includes(value)) fail(name + ' 非法: ' + JSON.stringify(value) + '，允许: ' + list.join('|'));
}
function requireNonEmptyString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') fail(name + ' 必须为非空字符串');
}
function assertInt(name, value, min) {
  if (!Number.isInteger(value) || value < min) {
    fail(name + ' 必须为>=' + min + ' 的整数，收到: ' + JSON.stringify(value));
  }
}

function requireGame(db, id) {
  const row = db.prepare('SELECT * FROM games WHERE id=?').get(id);
  if (!row) fail('局不存在: #' + id);
  return row;
}
function seatToPlayerId(db, gameId, seat) {
  const row = db.prepare('SELECT id FROM players WHERE game_id=? AND seat=?').get(gameId, seat);
  if (!row) fail('局#' + gameId + ' 中座位 ' + seat + ' 不存在');
  return row.id;
}
function rowExists(db, table, id, label) {
  if (table !== 'claims' && table !== 'actions') fail('内部错误：非法表名 ' + table);
  const row = db.prepare('SELECT id FROM ' + table + ' WHERE id=?').get(id);
  if (!row) fail(label + ' 引用的 ' + table + '#' + id + ' 不存在（引用 id 必须真实存在）');
}
function evExistsInGame(db, gameId, eventId) {
  const row = db.prepare('SELECT id FROM events WHERE id=? AND game_id=?').get(eventId, gameId);
  if (!row) fail('局#' + gameId + ' 中不存在事件 #' + eventId);
}
function getEventRow(db, eventId) {
  const row = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!row) fail('事件不存在: #' + eventId);
  return row;
}

// ── 连接管理 ──────────────────────────────────────────────────────────────

let _db = null;
function init(dbPath) {
  if (_db !== null) { try { _db.close(); } catch (_) { /* 已关闭 */ } _db = null; }
  const p = dbPath === undefined ? DEFAULT_DB_PATH : dbPath;
  if (p !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  _db = openDb(p);
  return _db;
}
function getConnection() { if (_db === null) init(); return _db; }
function closeCurrent() { if (_db !== null) { try { _db.close(); } catch (_) { /* 已关闭 */ } _db = null; } }

// ── 局 / 席 / 事件 ────────────────────────────────────────────────────────

function createGameCore(db, { name, game_type, player_count }) {
  requireNonEmptyString('name', name);
  requireNonEmptyString('game_type', game_type);
  assertInt('player_count', player_count, 1);
  const info = db.prepare('INSERT INTO games (name, game_type, player_count) VALUES (?,?,?)')
    .run(name, game_type, player_count);
  return db.prepare('SELECT * FROM games WHERE id=?').get(Number(info.lastInsertRowid));
}

/** 建局并自动建席 1..N（默认名「N号」）；整局一个事务，半局不存在。 */
function createGame(opts) {
  const db = getConnection();
  return tx(db, () => {
    const game = createGameCore(db, opts);
    const ins = db.prepare('INSERT INTO players (game_id, seat, name) VALUES (?,?,?)');
    for (let seat = 1; seat <= opts.player_count; seat++) ins.run(game.id, seat, seat + '号');
    return game;
  });
}

function addPlayer(opts) {
  const db = getConnection();
  requireGame(db, opts.game_id);
  assertInt('seat', opts.seat, 1);
  requireNonEmptyString('name', opts.name);
  const info = db.prepare('INSERT INTO players (game_id, seat, name) VALUES (?,?,?)')
    .run(opts.game_id, opts.seat, opts.name);
  return db.prepare('SELECT * FROM players WHERE id=?').get(Number(info.lastInsertRowid));
}

/**
 * 写操作分两层：**Core 不带事务**（假定调用方已在事务里），公开函数用 tx() 包一层。
 * 这个分层不是为了好看，是为了 recordEvent 能把「事件＋它的声称＋它的行动」
 * 放进同一个事务——若公开函数各自开事务，嵌套守卫会当场拦下（那正是它该做的事）。
 */
function addEventCore(opts) {
  const db = getConnection();
  requireGame(db, opts.game_id);
  assertInt('day', opts.day, 1);
  assertEnum('phase', opts.phase, PHASES);
  assertEnum('type', opts.type, EVENT_TYPES);
  requireNonEmptyString('raw_text', opts.raw_text);
  const actorSeat = opts.actor_seat === undefined ? null : opts.actor_seat;
  let actorPid = null;
  if (actorSeat !== null) {
    assertInt('actor_seat', actorSeat, 1);
    actorPid = seatToPlayerId(db, opts.game_id, actorSeat);
  } else if (opts.type !== 'system') {
    fail('type=' + opts.type + ' 的事件必须给 actor_seat（座位号）；仅 type=system 允许 null');
  }
  const seq = db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS s FROM events WHERE game_id=?')
    .get(opts.game_id).s;
  const info = db.prepare(
    'INSERT INTO events (game_id, day, phase, seq, type, actor_seat, raw_text) VALUES (?,?,?,?,?,?,?)')
    .run(opts.game_id, opts.day, opts.phase, seq, opts.type, actorPid, opts.raw_text);
  return {
    id: Number(info.lastInsertRowid), game_id: opts.game_id, day: opts.day,
    phase: opts.phase, seq, type: opts.type, actor_seat: actorSeat, raw_text: opts.raw_text,
  };
}
function addEvent(opts) { return tx(getConnection(), () => addEventCore(opts)); }

/** 批量落声称：整批一个事务，任一条不合法则整批不落。 */
function addClaimsCore(eventId, claims) {
  const db = getConnection();
  const ev = getEventRow(db, eventId);
  if (!Array.isArray(claims) || claims.length === 0) fail('addClaims: claims 必须为非空数组');
  const ins = db.prepare('INSERT INTO claims (event_id, seat, subject_seat, predicate, object, extracted_by, confirmed_by_user) VALUES (?,?,?,?,?,?,?)');
  const out = [];
  for (const c of claims) {
    assertInt('seat', c.seat, 1);
    assertInt('subject_seat', c.subject_seat, 1);
    seatToPlayerId(db, ev.game_id, c.seat);
    seatToPlayerId(db, ev.game_id, c.subject_seat);
    assertEnum('predicate', c.predicate, PREDICATES);
    requireNonEmptyString('object', c.object);
    if (c.extracted_by !== undefined) requireNonEmptyString('extracted_by', c.extracted_by);
    const info = ins.run(eventId, c.seat, c.subject_seat, c.predicate, c.object,
      c.extracted_by === undefined ? 'llm' : c.extracted_by,
      c.confirmed_by_user === undefined ? 0 : (c.confirmed_by_user ? 1 : 0));
    out.push(db.prepare('SELECT * FROM claims WHERE id=?').get(Number(info.lastInsertRowid)));
  }
  return out;
}
function addClaims(eventId, claims) { return tx(getConnection(), () => addClaimsCore(eventId, claims)); }
function addClaim(opts) {
  if (!opts || typeof opts !== 'object') fail('addClaim: 参数必须为对象 {event_id,seat,subject_seat,predicate,object,...}');
  return tx(getConnection(), () => addClaimsCore(opts.event_id, [opts])[0]);
}

function addActionCore(opts) {
  const db = getConnection();
  const ev = getEventRow(db, opts.event_id);
  assertInt('seat', opts.seat, 1);
  seatToPlayerId(db, ev.game_id, opts.seat);
  assertEnum('action', opts.action, ACTION_KINDS);
  const target = opts.target_seat === undefined ? null : opts.target_seat;
  if (target !== null) { assertInt('target_seat', target, 1); seatToPlayerId(db, ev.game_id, target); }
  const info = db.prepare('INSERT INTO actions (event_id, seat, action, target_seat, result) VALUES (?,?,?,?,?)')
    .run(opts.event_id, opts.seat, opts.action, target, opts.result === undefined ? null : opts.result);
  return db.prepare('SELECT * FROM actions WHERE id=?').get(Number(info.lastInsertRowid));
}
function addAction(opts) { return tx(getConnection(), () => addActionCore(opts)); }

const ORDER_SQL = "ORDER BY e.day, CASE e.phase WHEN 'night' THEN 0 WHEN 'day' THEN 1 ELSE 2 END, e.seq";

function listEvents(gameId) {
  const db = getConnection();
  requireGame(db, gameId);
  return db.prepare('SELECT e.id, e.game_id, e.day, e.phase, e.seq, e.type, p.seat AS actor_seat, e.raw_text'
    + ' FROM events e LEFT JOIN players p ON p.id = e.actor_seat WHERE e.game_id = ? ' + ORDER_SQL).all(gameId);
}
function getClaims(gameId) {
  const db = getConnection();
  requireGame(db, gameId);
  return db.prepare('SELECT c.id, c.event_id, e.day, e.phase, c.seat, c.subject_seat, c.predicate, c.object,'
    + ' c.extracted_by, c.confirmed_by_user FROM claims c JOIN events e ON e.id = c.event_id'
    + ' WHERE e.game_id = ? AND c.retracted = 0 ' + ORDER_SQL + ', c.id').all(gameId);
}
function getActions(gameId) {
  const db = getConnection();
  requireGame(db, gameId);
  return db.prepare('SELECT a.id, a.event_id, e.day, e.phase, a.seat, a.action, a.target_seat, a.result'
    + ' FROM actions a JOIN events e ON e.id = a.event_id'
    + ' WHERE e.game_id = ? AND a.retracted = 0 ' + ORDER_SQL + ', a.id').all(gameId);
}
function getPlayers(gameId) {
  const db = getConnection();
  requireGame(db, gameId);
  return db.prepare('SELECT * FROM players WHERE game_id=? ORDER BY seat').all(gameId);
}
function getGame(id) {
  const row = getConnection().prepare('SELECT * FROM games WHERE id=?').get(id);
  return row === undefined ? null : row;
}
function seatExists(gameId, seat) {
  assertInt('seat', seat, 1);
  return getConnection().prepare('SELECT id FROM players WHERE game_id=? AND seat=?').get(gameId, seat) !== undefined;
}
function listGames() {
  return getConnection().prepare(
    'SELECT g.*, (SELECT COUNT(*) FROM events e WHERE e.game_id = g.id) AS event_count,'
    + ' (SELECT MAX(day) FROM events e WHERE e.game_id = g.id) AS max_day,'
    + ' bg.script AS script FROM games g LEFT JOIN botc_games bg ON bg.game_id = g.id ORDER BY g.id DESC').all();
}

// ── 声称 / 行动：改与撤（账本纪律：只软删，撤回后不可再改）────────────────

function getClaim(id) {
  const row = getConnection().prepare(
    'SELECT c.*, e.game_id FROM claims c JOIN events e ON e.id = c.event_id WHERE c.id=?').get(id);
  return row === undefined ? null : row;
}
function getAction(id) {
  const row = getConnection().prepare(
    'SELECT a.*, e.game_id FROM actions a JOIN events e ON e.id = a.event_id WHERE a.id=?').get(id);
  return row === undefined ? null : row;
}
function updateClaimObject(id, object) {
  requireNonEmptyString('object', object);
  const row = getClaim(id);
  if (!row) fail('claim #' + id + ' 不存在');
  if (row.retracted) fail('claim #' + id + ' 已撤回，不能修改（账本纪律）');
  getConnection().prepare('UPDATE claims SET object=?, confirmed_by_user=1 WHERE id=?').run(object, id);
  return getClaim(id);
}
function updateAction(id, patch) {
  if (!patch || typeof patch !== 'object') fail('updateAction: patch 必须为 {target_seat?} 或 {result?}');
  const db = getConnection();
  const row = getAction(id);
  if (!row) fail('action #' + id + ' 不存在');
  if (row.retracted) fail('action #' + id + ' 已撤回，不能修改（账本纪律）');
  const sets = []; const vals = [];
  if (patch.target_seat !== undefined) {
    assertInt('target_seat', patch.target_seat, 1);
    seatToPlayerId(db, row.game_id, patch.target_seat);
    sets.push('target_seat=?'); vals.push(patch.target_seat);
  }
  if (patch.result !== undefined) {
    requireNonEmptyString('result', patch.result);
    sets.push('result=?'); vals.push(patch.result);
  }
  if (sets.length === 0) fail('updateAction: patch 至少含 target_seat 或 result 之一');
  vals.push(id);
  db.prepare('UPDATE actions SET ' + sets.join(', ') + ' WHERE id=?').run(...vals);
  return getAction(id);
}
function retractClaim(id) {
  const db = getConnection();
  if (!db.prepare('SELECT id FROM claims WHERE id=?').get(id)) return false;
  db.prepare('UPDATE claims SET retracted=1 WHERE id=?').run(id);
  return true;
}
function retractAction(id) {
  const db = getConnection();
  if (!db.prepare('SELECT id FROM actions WHERE id=?').get(id)) return false;
  db.prepare('UPDATE actions SET retracted=1 WHERE id=?').run(id);
  return true;
}

const ORDER_DESC_SQL = "ORDER BY e.day DESC, CASE e.phase WHEN 'night' THEN 0 WHEN 'day' THEN 1 ELSE 2 END DESC, e.seq DESC, c.id DESC";
function recentClaimsBySeat(gameId, seat, limit) {
  const n = limit === undefined ? 2 : limit;
  assertInt('limit', n, 1);
  return getConnection().prepare('SELECT c.id, e.day, e.phase, c.predicate, c.object, c.subject_seat'
    + ' FROM claims c JOIN events e ON e.id = c.event_id'
    + ' WHERE e.game_id = ? AND c.seat = ? AND c.retracted = 0 ' + ORDER_DESC_SQL + ' LIMIT ?')
    .all(gameId, seat, n);
}

// ── 读取整局状态 ──────────────────────────────────────────────────────────

/**
 * uptoDay：给定则只回放到那一天（复盘「当时看到了什么」的入口）。
 * 传 null/undefined = 全部。传 0 由调用方判非法——本函数不做 0 的特殊处理。
 */
function loadGameState(gameId, uptoDay) {
  const db = getConnection();
  const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
  if (!game) return null;
  const finite = uptoDay !== undefined && uptoDay !== null && Number.isFinite(uptoDay);
  const dayCond = finite ? ' AND e.day <= ? ' : ' ';
  const params = finite ? [gameId, uptoDay] : [gameId];
  const events = db.prepare('SELECT e.id, e.game_id, e.day, e.phase, e.seq, e.type, p.seat AS actor_seat, e.raw_text'
    + ' FROM events e LEFT JOIN players p ON p.id = e.actor_seat'
    + ' WHERE e.game_id = ?' + dayCond + ORDER_SQL).all(...params);
  const claims = db.prepare('SELECT c.id, c.event_id, e.day, e.phase, c.seat, c.subject_seat, c.predicate, c.object,'
    + ' c.extracted_by, c.confirmed_by_user FROM claims c JOIN events e ON e.id = c.event_id'
    + ' WHERE e.game_id = ? AND c.retracted = 0' + dayCond + ORDER_SQL + ', c.id').all(...params);
  const actions = db.prepare('SELECT a.id, a.event_id, e.day, e.phase, a.seat, a.action, a.target_seat, a.result'
    + ' FROM actions a JOIN events e ON e.id = a.event_id'
    + ' WHERE e.game_id = ? AND a.retracted = 0' + dayCond + ORDER_SQL + ', a.id').all(...params);
  return { game, players: getPlayers(gameId), events, claims, actions };
}

function exportGame(gameId) {
  const state = loadGameState(gameId, Infinity);
  if (!state) return null;
  state.meta = {
    game_id: gameId,
    exported_at: new Date().toISOString(),
    schema_contract: 'jujian-v1',
    counts: { events: state.events.length, claims: state.claims.length, actions: state.actions.length },
  };
  return state;
}

/**
 * ★一次录入的原子单元：事件 ＋ 它的声称 ＋ 它的行动 ＋ BOTC 专属声称，**全成或全不成**。
 *
 * 为什么必须是存储层的一个函数，而不是路由里连着调四个函数：
 *   「3号说我验了1号」这句话被拆成 event ＋ claim ＋ claim 三行。
 *   如果它们分开写，中间失败就会留下一句**查无此事的查杀**——
 *   而矛盾检测正是靠这些行互相咬合才能工作，缺一半的账本会得出错误结论。
 *   半个事件比没有事件更危险：它看起来是完整的。
 *
 * ★沙盘的 db 层没提供这个单元（原实现靠 db.transaction 包住四个各自不带事务的函数）。
 *   那是 better-sqlite3 的接口形状，不是好设计；局鉴把它收进存储层，顺带让
 *   「哪些写操作构成一个原子单元」这个问题**只有一处答案**。
 *
 * @param head  {game_id, day, phase, type, actor_seat, raw_text}
 * @param parts {claims?, actions?, botc_claims?} 三组行参，均为 store 的行参形状
 * @returns {event, claim_ids, action_ids, botc_claim_ids}
 */
function recordEvent(head, parts = {}) {
  const db = getConnection();
  return tx(db, () => {
    const ev = addEventCore(head);
    const claimIds = [];
    const actionIds = [];
    const botcClaimIds = [];
    for (const c of (parts.claims || [])) {
      claimIds.push(addClaimsCore(ev.id, [c])[0].id);
    }
    for (const a of (parts.actions || [])) {
      actionIds.push(addActionCore(Object.assign({ event_id: ev.id }, a)).id);
    }
    for (const b of (parts.botc_claims || [])) {
      for (const row of addBotcClaimsCore(ev.id, [b])) botcClaimIds.push(row.id);
    }
    return { event: ev, claim_ids: claimIds, action_ids: actionIds, botc_claim_ids: botcClaimIds };
  });
}

// ── 矛盾 / 假设 ───────────────────────────────────────────────────────────

function saveContradictions(gameId, rows) {
  const db = getConnection();
  requireGame(db, gameId);
  if (!Array.isArray(rows) || rows.length === 0) fail('saveContradictions: rows 必须为非空数组');
  return tx(db, () => {
    const ins = db.prepare('INSERT INTO contradictions (game_id, claim_a, claim_b, action_a, action_b, conflict_desc, underdetermination, innocent_explanations, generated_by) VALUES (?,?,?,?,?,?,?,?,?)');
    const out = [];
    for (const r of rows) {
      if (typeof r.conflict_desc !== 'string' || r.conflict_desc.trim() === '') fail('conflict_desc 必须为非空字符串');
      assertEnum('underdetermination', r.underdetermination, UNDERDETERMINATIONS);
      assertEnum('generated_by', r.generated_by, GENERATED_BY);
      if (!Array.isArray(r.innocent_explanations) || r.innocent_explanations.length < 1) {
        fail('RD1 校验失败：innocent_explanations 必须为非空数组（无无辜解释的冲突对不得入库/展示）');
      }
      const refs = {
        claim_a: r.claim_a === undefined ? null : r.claim_a,
        claim_b: r.claim_b === undefined ? null : r.claim_b,
        action_a: r.action_a === undefined ? null : r.action_a,
        action_b: r.action_b === undefined ? null : r.action_b,
      };
      let n = 0;
      for (const key of ['claim_a', 'claim_b', 'action_a', 'action_b']) {
        const v = refs[key];
        if (v !== null) { assertInt(key, v, 1); rowExists(db, key.startsWith('claim') ? 'claims' : 'actions', v, '矛盾对'); n++; }
      }
      if (n === 0) fail('矛盾对必须至少引用一个 claim/action id');
      const info = ins.run(gameId, refs.claim_a, refs.claim_b, refs.action_a, refs.action_b,
        r.conflict_desc, r.underdetermination, JSON.stringify(r.innocent_explanations), r.generated_by);
      const row = db.prepare('SELECT * FROM contradictions WHERE id=?').get(Number(info.lastInsertRowid));
      out.push(Object.assign({}, row, { innocent_explanations: JSON.parse(row.innocent_explanations) }));
    }
    return out;
  });
}

function saveHypotheses(gameId, rows) {
  const db = getConnection();
  requireGame(db, gameId);
  if (!Array.isArray(rows) || rows.length === 0) fail('saveHypotheses: rows 必须为非空数组');
  return tx(db, () => {
    const ins = db.prepare('INSERT INTO hypotheses (game_id, day, content, stance, support_events, oppose_events, tendency) VALUES (?,?,?,?,?,?,?)');
    const out = [];
    for (const h of rows) {
      assertInt('day', h.day, 1);
      requireNonEmptyString('content', h.content);
      if (!h.stance || typeof h.stance !== 'object' || Array.isArray(h.stance)) {
        fail('stance 必须为 per-player 立场对象，如 {"1":"wolf_suspect","4":"good_believe"}');
      }
      for (const key of ['support_events', 'oppose_events']) {
        const arr = h[key];
        if (!Array.isArray(arr)) fail(key + ' 必须为数组（元素=事件 id）');
        for (const eid of arr) { assertInt(key + ' 元素', eid, 1); evExistsInGame(db, gameId, eid); }
      }
      assertEnum('tendency', h.tendency, TENDENCIES);
      const info = ins.run(gameId, h.day, h.content, JSON.stringify(h.stance),
        JSON.stringify(h.support_events), JSON.stringify(h.oppose_events), h.tendency);
      out.push(parseHypothesis(db.prepare('SELECT * FROM hypotheses WHERE id=?').get(Number(info.lastInsertRowid))));
    }
    return out;
  });
}
function parseHypothesis(row) {
  return Object.assign({}, row, {
    stance: JSON.parse(row.stance),
    support_events: JSON.parse(row.support_events),
    oppose_events: JSON.parse(row.oppose_events),
  });
}
function getContradictions(gameId) {
  const db = getConnection();
  requireGame(db, gameId);
  return db.prepare('SELECT * FROM contradictions WHERE game_id=? ORDER BY id').all(gameId)
    .map((r) => Object.assign({}, r, { innocent_explanations: JSON.parse(r.innocent_explanations) }));
}
function getHypotheses(gameId) {
  const db = getConnection();
  requireGame(db, gameId);
  return db.prepare('SELECT * FROM hypotheses WHERE game_id=? ORDER BY id').all(gameId).map(parseHypothesis);
}

/**
 * ★同日重结算 = **原子地**「删旧 ＋ 写新」。
 *
 * ── 这条是被一个真事故逼出来的 ────────────────────────────────────────────
 *   原实现是两步：先 replaceSameDayCard() 删掉当天旧卡，再 saveAdvisorCard() 写新卡。
 *   看起来等价于覆盖，其实不是：
 *     ① 两步之间没有事务 ⇒ 删成功、写失败 ⇒ **当天存档变空**；
 *     ② 而写失败被「回存失败不影响展示」的 catch 吞掉，只在响应里留一句 save_error，
 *        界面上仍然正常显示新卡 —— 用户以为存下来了，其实存档没了。
 *   实测复现：第二次天结算后 `/cards/:day` 返回 404，假设与矛盾双双消失。
 *
 *   这与 recordEvent 那条原则是同一条：「半件事比没有事更危险，因为它看起来是完整的」。
 *   ⇒ 现在删除与写入在**同一个事务**里。写失败就整体回滚，旧卡原样还在 ——
 *     「还是上一版」比「凭空消失」好得多，且用户看得见。
 *
 * @returns {{deleted_hypotheses:number, deleted_contradictions:number, written:number}}
 */
function replaceAdvisorCard(gameId, day, card) {
  const db = getConnection();
  requireGame(db, gameId);
  assertInt('day', day, 1);
  return tx(db, () => {
    // 1) 当日假设：按 (game_id, day) 精确删
    const delH = db.prepare('DELETE FROM hypotheses WHERE game_id=? AND day=?').run(gameId, day).changes;
    // 2) 当日矛盾：contradictions 表无 day 列（表设计如此）⇒ 其归属由
    //    「所引用 claim/action 所在事件的最大 day」反推，只删 ≤ 本次 day 的，
    //    且只删 generated_by='llm' 的（人类手写的永不被结算覆盖）。
    const rows = db.prepare(EVIDENCE_DAY_SQL).all(gameId);
    const ids = rows
      .filter((r) => r.evidence_day !== null && r.evidence_day !== undefined && r.evidence_day <= day)
      .map((r) => r.row_id);
    let delC = 0;
    if (ids.length) {
      const del = db.prepare("DELETE FROM contradictions WHERE game_id=? AND id=? AND generated_by='llm'");
      for (const id of ids) delC += del.run(gameId, id).changes;
    }
    // 3) 同事务内写新卡；失败则整体回滚，旧卡完好
    const written = saveAdvisorCardCore(gameId, day, card);
    return { deleted_hypotheses: delH, deleted_contradictions: delC, written: written };
  });
}

/** 矛盾对的归属日反推 SQL。暴露出来给 replaceAdvisorCard 用，也供路由层回读证据_day。 */
const EVIDENCE_DAY_SQL = 'SELECT c.id AS row_id,'
  + ' (SELECT MAX(ev.day) FROM events ev WHERE ev.id IN ('
  + 'SELECT event_id FROM claims WHERE id IN (c.claim_a, c.claim_b)'
  + ' UNION SELECT event_id FROM actions WHERE id IN (c.action_a, c.action_b))) AS evidence_day'
  + ' FROM contradictions c WHERE c.game_id=?';

/**
 * 天结算参谋卡落库 = 矛盾 + 假设两组行（卡不是独立表，是这两张表的视图）。
 * ★refId 允许 'c12'/'a3' 这类带前缀记号：矛盾检测器给出的 pair_id 就是这个形状，
 *   直接塞进引用列会违反 FK，所以先剥前缀。剥不动就拒，不猜。
 */
function saveAdvisorCardCore(gameId, day, card) {
  const db = getConnection();
  requireGame(db, gameId);
  assertInt('day', day, 1);
  if (!card || !Array.isArray(card.contradictions) || !Array.isArray(card.hypotheses)) {
    fail('saveAdvisorCard: card 须含 contradictions/hypotheses 数组');
  }
  const refId = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/^[ca]/i, ''));
    if (!Number.isInteger(n) || n < 1) fail('参谋卡引用 id 非法: ' + JSON.stringify(v));
    return n;
  };
  return (function write() {
    let written = 0;
    const insC = db.prepare('INSERT INTO contradictions (game_id, claim_a, claim_b, action_a, action_b, conflict_desc, underdetermination, innocent_explanations, generated_by) VALUES (?,?,?,?,?,?,?,?,?)');
    card.contradictions.forEach((c, i) => {
      if (!Array.isArray(c.innocent_explanations) || c.innocent_explanations.length < 1) {
        fail('RD1 校验失败：第 ' + (i + 1) + ' 条矛盾 innocent_explanations 为空（无无辜解释不得入库/展示）');
      }
      assertEnum('underdetermination', c.underdetermination, UNDERDETERMINATIONS);
      const refs = { claim_a: refId(c.claim_a), claim_b: refId(c.claim_b), action_a: refId(c.action_a), action_b: refId(c.action_b) };
      let n = 0;
      for (const key of ['claim_a', 'claim_b', 'action_a', 'action_b']) {
        if (refs[key] !== null) { rowExists(db, key.startsWith('claim') ? 'claims' : 'actions', refs[key], '参谋卡矛盾对'); n++; }
      }
      if (n === 0) fail('参谋卡第 ' + (i + 1) + ' 条矛盾必须至少引用一个 claim/action id');
      const desc = (typeof c.conflict_desc === 'string' && c.conflict_desc.trim() !== '')
        ? c.conflict_desc : ('[LLM] ' + (c.pair_id !== undefined && c.pair_id !== null ? c.pair_id : 'pair#' + (i + 1)));
      insC.run(gameId, refs.claim_a, refs.claim_b, refs.action_a, refs.action_b, desc, c.underdetermination,
        JSON.stringify(c.innocent_explanations), 'llm');
      written++;
    });
    const insH = db.prepare('INSERT INTO hypotheses (game_id, day, content, stance, support_events, oppose_events, tendency) VALUES (?,?,?,?,?,?,?)');
    card.hypotheses.forEach((h, i) => {
      requireNonEmptyString('假设 H' + (i + 1) + ' content', h.content);
      if (!h.stance || typeof h.stance !== 'object' || Array.isArray(h.stance)) {
        fail('假设 H' + (i + 1) + ' stance 必须为 per-player 立场对象');
      }
      for (const key of ['support_events', 'oppose_events']) {
        const arr = h[key] === undefined ? [] : h[key];
        if (!Array.isArray(arr)) fail('H' + (i + 1) + ' ' + key + ' 必须为数组（元素=事件 id）');
        for (const eid of arr) { assertInt(key + ' 元素', eid, 1); evExistsInGame(db, gameId, eid); }
      }
      assertEnum('tendency', h.tendency, TENDENCIES);
      insH.run(gameId, day, h.content, JSON.stringify(h.stance),
        JSON.stringify(h.support_events === undefined ? [] : h.support_events),
        JSON.stringify(h.oppose_events === undefined ? [] : h.oppose_events), h.tendency);
      written++;
    });
    return written;
  }());
}

/** 落库参谋卡（自带事务）。同日重结算请用 replaceAdvisorCard，它把删与写放进同一事务。 */
function saveAdvisorCard(gameId, day, card) {
  return tx(getConnection(), () => saveAdvisorCardCore(gameId, day, card));
}

// ── BOTC 剧本与专属声称 ───────────────────────────────────────────────────

/** 建 BOTC 私有表（幂等；建表语句已含全部列，此处为 no-op 保险）。 */
function ensureBotcTables() { getConnection().exec(SCHEMA); }

function setGameScript(gameId, script) {
  assertEnum('script', script, BOTC_SCRIPTS);
  getConnection().prepare('INSERT INTO botc_games (game_id, script) VALUES (?, ?)'
    + ' ON CONFLICT(game_id) DO UPDATE SET script = excluded.script').run(gameId, script);
  return script;
}
function getGameScript(gameId) {
  const row = getConnection().prepare('SELECT script FROM botc_games WHERE game_id=?').get(gameId);
  return row === undefined ? null : row.script;
}
function addBotcClaimsCore(eventId, claims) {
  const db = getConnection();
  const ev = getEventRow(db, eventId);
  if (!Array.isArray(claims) || claims.length === 0) fail('addBotcClaims: claims 必须为非空数组');
  const ins = db.prepare('INSERT INTO botc_claims (game_id, event_id, seat, subject_seat, predicate, object, extracted_by, confirmed_by_user) VALUES (?,?,?,?,?,?,?,?)');
  const out = [];
  for (const c of claims) {
    assertInt('seat', c.seat, 1);
    assertInt('subject_seat', c.subject_seat, 1);
    seatToPlayerId(db, ev.game_id, c.seat);
    seatToPlayerId(db, ev.game_id, c.subject_seat);
    assertEnum('predicate', c.predicate, BOTC_PREDICATES);
    const info = ins.run(ev.game_id, eventId, c.seat, c.subject_seat, c.predicate,
      c.object === undefined ? '' : c.object,
      c.extracted_by === undefined ? 'llm' : c.extracted_by,
      c.confirmed_by_user ? 1 : 0);
    out.push(db.prepare('SELECT * FROM botc_claims WHERE id=?').get(Number(info.lastInsertRowid)));
  }
  return out;
}
function addBotcClaims(eventId, claims) { return tx(getConnection(), () => addBotcClaimsCore(eventId, claims)); }
function listBotcClaims(gameId, opts) {
  const db = getConnection();
  requireGame(db, gameId);
  const upto = opts && opts.uptoDay !== undefined && opts.uptoDay !== null && Number.isFinite(opts.uptoDay);
  const sql = 'SELECT b.id, b.game_id, b.event_id, e.day, e.phase, b.seat, b.subject_seat, b.predicate, b.object,'
    + ' b.extracted_by, b.confirmed_by_user FROM botc_claims b JOIN events e ON e.id = b.event_id'
    + ' WHERE b.game_id = ? AND b.retracted = 0' + (upto ? ' AND e.day <= ? ' : ' ') + ORDER_SQL + ', b.id';
  return upto ? db.prepare(sql).all(gameId, opts.uptoDay) : db.prepare(sql).all(gameId);
}
function getBotcClaim(id) {
  const row = getConnection().prepare(
    'SELECT b.*, e.game_id FROM botc_claims b JOIN events e ON e.id = b.event_id WHERE b.id=?').get(id);
  return row === undefined ? null : row;
}
function updateBotcClaimObject(id, object) {
  const row = getBotcClaim(id);
  if (!row) fail('botc_claim #' + id + ' 不存在');
  if (row.retracted) fail('botc_claim #' + id + ' 已撤回，不能修改（账本纪律）');
  getConnection().prepare('UPDATE botc_claims SET object=?, confirmed_by_user=1 WHERE id=?')
    .run(object === undefined ? '' : String(object), id);
  return getBotcClaim(id);
}
function retractBotcClaim(id) {
  const db = getConnection();
  if (!db.prepare('SELECT id FROM botc_claims WHERE id=?').get(id)) return false;
  db.prepare('UPDATE botc_claims SET retracted=1 WHERE id=?').run(id);
  return true;
}

// ── 统计（体检与界面用）───────────────────────────────────────────────────

function stats(gameId) {
  const db = getConnection();
  requireGame(db, gameId);
  const one = (sql) => Number(db.prepare(sql).get(gameId).n);
  return {
    events: one('SELECT COUNT(*) n FROM events WHERE game_id=?'),
    claims: one('SELECT COUNT(*) n FROM claims c JOIN events e ON e.id=c.event_id WHERE e.game_id=? AND c.retracted=0'),
    claims_retracted: one('SELECT COUNT(*) n FROM claims c JOIN events e ON e.id=c.event_id WHERE e.game_id=? AND c.retracted=1'),
    actions: one('SELECT COUNT(*) n FROM actions a JOIN events e ON e.id=a.event_id WHERE e.game_id=? AND a.retracted=0'),
    contradictions: one('SELECT COUNT(*) n FROM contradictions WHERE game_id=?'),
    hypotheses: one('SELECT COUNT(*) n FROM hypotheses WHERE game_id=?'),
    botc_claims: one('SELECT COUNT(*) n FROM botc_claims WHERE game_id=? AND retracted=0'),
  };
}

module.exports = {
  // 常量
  PHASES, EVENT_TYPES, PREDICATES, ACTION_KINDS, UNDERDETERMINATIONS, GENERATED_BY, TENDENCIES,
  BOTC_PREDICATES, BOTC_SCRIPTS, PHASE_ORDER, SCHEMA_VERSION, DEFAULT_DB_PATH, SCHEMA,
  // 连接
  openDb, init, getConnection, closeCurrent, tx,
  // 局
  createGame, addPlayer, getGame, listGames, getPlayers, seatExists,
  // 事件与声称
  addEvent, addClaim, addClaims, addAction, listEvents, getClaims, getActions,
  getClaim, getAction, updateClaimObject, updateAction, retractClaim, retractAction,
  recentClaimsBySeat, loadGameState, exportGame, recordEvent,
  // 参谋卡
  saveContradictions, saveHypotheses, getContradictions, getHypotheses,
  saveAdvisorCard, replaceAdvisorCard, EVIDENCE_DAY_SQL,
  // BOTC
  ensureBotcTables, setGameScript, getGameScript,
  addBotcClaims, listBotcClaims, getBotcClaim, updateBotcClaimObject, retractBotcClaim,
  // 杂项
  stats,
};
