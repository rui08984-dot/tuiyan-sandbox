'use strict';
/**
 * p1a-terminal · src/db.js —— A 路数据层（接口法律：docs/sandbox/p1a/schema-contract-v0.md §1）
 *
 * ── B/C/D 路调用契约（参数 → 返回值）────────────────────────────────────
 * openDb(dbPath=':memory:')  → better-sqlite3 实例（WAL、foreign_keys=ON、全部表已建好）
 * createGame(db,{name,game_type,player_count})            → 游戏行 {id,name,game_type,player_count,created_at}
 * addPlayer(db,{game_id,seat,name})                       → 玩家行 {id,game_id,seat,name}（UNIQUE(game_id,seat)）
 * addEvent(db,{game_id,day,phase,type,actor_seat,raw_text}) → 事件行
 *   · phase ∈ night|day|dusk；type ∈ statement|vote|death|claim|action_reveal|system
 *   · actor_seat 传座位号；type='system' 可为 null，其余必填（death 事件约定填死者座位号）
 *   · seq 自动 = 局内 max(seq)+1（单调递增，UNIQUE(game_id,seq)），无需传入
 * addClaims(db, event_id, [{seat,subject_seat,predicate,object,extracted_by?,confirmed_by_user?}])
 *   → 声称行数组；predicate ∈ is_wolf|is_good|is_role|claims_role|voted|did_action|said
 *   · seat/subject_seat = 座位号（谁说的/关于谁）；object 为角色名/动作命题（行动声称格式 "动词:目标" 如 check:8）
 * addAction(db,{event_id,seat,action,target_seat?,result?}) → 行动行
 *   · action ∈ vote|abstain|kill_target|poison_target|protect_target|check_target|self_explode
 * listEvents(db,game_id) → 事件行数组（按 day→phase(night<day<dusk)→seq 排序；actor_seat 已还原为座位号）
 * getClaims(db,game_id)  → 声称行数组（JOIN events 带出 day/phase，直接可喂 engine.findContradictions）
 * getActions(db,game_id) → 行动行数组（同上）
 * saveContradictions(db,game_id,[{claim_a?,claim_b?,action_a?,action_b?,conflict_desc,underdetermination,innocent_explanations,generated_by}])
 *   → 矛盾行数组；underdetermination ∈ high|mid|low；generated_by ∈ code|llm
 *   · RD1 硬校验：innocent_explanations 必须为非空数组，空则抛错拒写（无无辜解释的冲突对不得入库展示）
 * saveHypotheses(db,game_id,[{day,content,stance,support_events,oppose_events,tendency}])
 *   → 假设行数组；stance 为 per-player 立场对象（如 {"1":"wolf_suspect"}）；support/oppose_events 为事件 id 数组
 *     （存在性校验，引用不存在的事件即抛错）；tendency ∈ strong|mid|weak
 * getContradictions(db,game_id) / getHypotheses(db,game_id) → 行数组（JSON 字段已解析回对象/数组）
 * getPlayers(db,game_id) → 玩家行数组；closeDb(db) → 关闭连接
 *
 * ── 座位号语义（B/C/D 必读）───────────────────────────────────────────
 * claims.seat/subject_seat、actions.seat/target_seat、listEvents().actor_seat 一律是座位号（1 基整数）。
 * 唯一例外：events.actor_seat 落库存 players.id（契约 FK 要求），本层写入/读出自动换算，调用方全程只见座位号。
 *
 * ── v1 对象式接口（B 路 cli.js 集成面，契约升 v1；模块自管理连接）──────
 * cli.js 直接 require 本模块当 db 对象用（无句柄）。连接管理：
 *   init(dbPath)（缺省 data/p1a.db；测试传 ':memory:'）/ getConnection() / closeCurrent()
 * 方法（参数 → 返回值，与 cli.js 头注释 B→A 期望逐条对齐）：
 *   createGame(name, game_type, player_count) → 游戏行（位置参数；事务内自动建席 1..N，玩家名=座位号+"号"）
 *   getGame(id) → 行|null；getPlayers(gameId) → 行[]；seatExists(gameId, seat) → bool
 *   addEvent({game_id,day,phase,type,actor_seat,raw_text}) → {id,seq}（seq 自动；仅 type=system 允许 actor_seat=null）
 *   addClaim({event_id,seat,subject_seat,predicate,object,extracted_by?,confirmed_by_user?}) → {id,...}
 *   addAction({event_id,seat,action,target_seat?,result?}) → {id,...}
 *   getClaim(id) / getAction(id) → 行|null（含 retracted、game_id；已撤回行也可见，供 edit/retract 前置判断）
 *   updateClaimObject(id, object) → 行（confirmed_by_user 置 1；retracted 行拒绝修改）
 *   updateAction(id, {target_seat?|result?}) → 行（target_seat 做存在性校验；retracted 行拒绝修改）
 *   retractClaim(id) / retractAction(id) → bool（软删 retracted=1，不物理删；存在即 true 幂等，不存在 false）
 *   recentClaimsBySeat(gameId, seat, limit=2) → [{id,day,phase,predicate,object,subject_seat}]（新→旧，排除已撤回）
 *   loadGameState(gameId, uptoDay=Infinity) → {game,players,events,claims,actions}|null
 *     （全部排除 retracted；claims/actions JOIN 事件按 day≤uptoDay 过滤；events 排序同 listEvents）
 *   exportGame(gameId) → loadGameState(gameId, Infinity) 结果 + meta{game_id,exported_at,schema_contract,counts}|null
 *   saveAdvisorCard(gameId, day, card) → 写入行数
 *     · card={contradictions:[{claim_a?|'cN'?,claim_b?,action_a?|'aN'?,action_b?,underdetermination,innocent_explanations,pair_id?,conflict_desc?}],hypotheses:[{content,stance,support_events?,oppose_events?,tendency}],checkpoints?}
 *     · RD1 硬校验：innocent_explanations 非空数组；引用 id 存在性校验（接受 'c3'/'a2' 记号，与 cli 同规整）；
 *       conflict_desc 缺省由 pair_id 兜底；generated_by 固定 'llm'；整个事务原子（任一校验失败全回滚）；
 *       checkpoints 无表不落库（仅渲染层用）。
 * 双态兼容：createGame/addEvent/addAction/getPlayers 首参为 db 句柄 → 句柄式（engine/golden/测试用），
 *           否则 → 对象式（自动走 getConnection()）。句柄式查询 getClaims/getActions 默认过滤 retracted=0。
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'p1a.db');

const PHASES = ['night', 'day', 'dusk'];
const PHASE_ORDER = { night: 0, day: 1, dusk: 2 };
const EVENT_TYPES = ['statement', 'vote', 'death', 'claim', 'action_reveal', 'system'];
const PREDICATES = ['is_wolf', 'is_good', 'is_role', 'claims_role', 'voted', 'did_action', 'said'];
const ACTION_KINDS = ['vote', 'abstain', 'kill_target', 'poison_target', 'protect_target', 'check_target', 'self_explode'];
const UNDERDETERMINATIONS = ['high', 'mid', 'low'];
const GENERATED_BY = ['code', 'llm'];
const TENDENCIES = ['strong', 'mid', 'weak'];

const SCHEMA_A = `
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
`;
const SCHEMA_B = `
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
`;
const SCHEMA = SCHEMA_A + SCHEMA_B;

function migrateDb(db) {
  // 契约 v0→v1：claims/actions 增加软删列 retracted（账本纪律：只置 1，绝不物理删）。
  // 旧库文件打开时自动迁移（幂等）；新建库建表语句已含该列，此处为 no-op。
  for (const table of ['claims', 'actions']) {
    const cols = db.pragma('table_info(' + table + ')').map(c => c.name);
    if (!cols.includes('retracted')) {
      db.exec('ALTER TABLE ' + table + ' ADD COLUMN retracted INTEGER NOT NULL DEFAULT 0');
    }
  }
}

function openDb(dbPath = ':memory:') {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrateDb(db);
  return db;
}
function closeDb(db) { db.close(); }

function fail(msg) { throw new Error('[p1a-db] ' + msg); }
function assertEnum(name, value, list) {
  if (!list.includes(value)) fail(name + ' 非法: ' + JSON.stringify(value) + '，允许: ' + list.join('|'));
}
function requireNonEmptyString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') fail(name + ' 必须为非空字符串');
}
function assertInt(name, value, min) {
  if (!Number.isInteger(value) || value < min) fail(name + ' 必须为>=' + min + ' 的整数，收到: ' + JSON.stringify(value));
}
function requireGame(db, id) {
  const row = db.prepare('SELECT * FROM games WHERE id=?').get(id);
  if (!row) fail('game 不存在: #' + id);
  return row;
}
function seatToPlayerId(db, gameId, seat) {
  const row = db.prepare('SELECT id FROM players WHERE game_id=? AND seat=?').get(gameId, seat);
  if (!row) fail('game#' + gameId + ' 中座位 ' + seat + ' 的玩家不存在');
  return row.id;
}

function createGameCore(db, { name, game_type, player_count }) {
  requireNonEmptyString('name', name);
  requireNonEmptyString('game_type', game_type);
  assertInt('player_count', player_count, 1);
  const info = db.prepare('INSERT INTO games (name, game_type, player_count) VALUES (?,?,?)').run(name, game_type, player_count);
  return db.prepare('SELECT * FROM games WHERE id=?').get(info.lastInsertRowid);
}

function isDbHandle(x) { return x !== null && x !== undefined && typeof x.prepare === 'function'; }

// 对象式 createGame：事务内自动建席 1..N（cli「new」只调这一个方法，席位必须就位）
function createGame(dbOrName, a, b) {
  if (isDbHandle(dbOrName)) return createGameCore(dbOrName, a);
  const db = getConnection();
  const opts = { name: dbOrName, game_type: a, player_count: b };
  const tx = db.transaction(() => {
    const game = createGameCore(db, opts);
    const ins = db.prepare('INSERT INTO players (game_id, seat, name) VALUES (?,?,?)');
    for (let seat = 1; seat <= opts.player_count; seat++) ins.run(game.id, seat, seat + '号');
    return game;
  });
  return tx();
}

function addPlayer(db, { game_id, seat, name }) {
  requireGame(db, game_id);
  assertInt('seat', seat, 1);
  requireNonEmptyString('name', name);
  const info = db.prepare('INSERT INTO players (game_id, seat, name) VALUES (?,?,?)').run(game_id, seat, name);
  return db.prepare('SELECT * FROM players WHERE id=?').get(info.lastInsertRowid);
}

function addEventCore(db, { game_id, day, phase, type, actor_seat = null, raw_text }) {
  requireGame(db, game_id);
  assertInt('day', day, 1);
  assertEnum('phase', phase, PHASES);
  assertEnum('type', type, EVENT_TYPES);
  requireNonEmptyString('raw_text', raw_text);
  let actorPid = null;
  if (actor_seat !== null && actor_seat !== undefined) {
    assertInt('actor_seat', actor_seat, 1);
    actorPid = seatToPlayerId(db, game_id, actor_seat);
  } else if (type !== 'system') {
    fail('type=' + type + ' 的事件必须给 actor_seat（座位号）；仅 type=system 允许 null');
  }
  const seq = db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS s FROM events WHERE game_id=?').get(game_id).s;
  const info = db.prepare('INSERT INTO events (game_id, day, phase, seq, type, actor_seat, raw_text) VALUES (?,?,?,?,?,?,?)')
    .run(game_id, day, phase, seq, type, actorPid, raw_text);
  return { id: Number(info.lastInsertRowid), game_id, day, phase, seq, type, actor_seat: actor_seat === undefined ? null : actor_seat, raw_text };
}
function addEvent(dbOrOpts, opts) {
  if (isDbHandle(dbOrOpts)) return addEventCore(dbOrOpts, opts);
  return addEventCore(getConnection(), dbOrOpts);
}
function getEvent(db, eventId) {
  const row = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!row) fail('event 不存在: #' + eventId);
  return row;
}

function addClaims(db, event_id, claims) {
  const ev = getEvent(db, event_id);
  if (!Array.isArray(claims) || claims.length === 0) fail('addClaims: claims 必须为非空数组');
  const insert = db.prepare('INSERT INTO claims (event_id, seat, subject_seat, predicate, object, extracted_by, confirmed_by_user) VALUES (?,?,?,?,?,?,?)');
  const out = [];
  const run = db.transaction(() => {
    for (const c of claims) {
      assertInt('seat', c.seat, 1);
      assertInt('subject_seat', c.subject_seat, 1);
      seatToPlayerId(db, ev.game_id, c.seat);
      seatToPlayerId(db, ev.game_id, c.subject_seat);
      assertEnum('predicate', c.predicate, PREDICATES);
      requireNonEmptyString('object', c.object);
      if (c.extracted_by !== undefined) requireNonEmptyString('extracted_by', c.extracted_by);
      const extracted_by = c.extracted_by === undefined ? 'llm' : c.extracted_by;
      const confirmed = c.confirmed_by_user === undefined ? 0 : (c.confirmed_by_user ? 1 : 0);
      const info = insert.run(event_id, c.seat, c.subject_seat, c.predicate, c.object, extracted_by, confirmed);
      out.push(db.prepare('SELECT * FROM claims WHERE id=?').get(info.lastInsertRowid));
    }
  });
  run();
  return out;
}

function addActionCore(db, { event_id, seat, action, target_seat = null, result = null }) {
  const ev = getEvent(db, event_id);
  assertInt('seat', seat, 1);
  seatToPlayerId(db, ev.game_id, seat);
  assertEnum('action', action, ACTION_KINDS);
  if (target_seat !== null && target_seat !== undefined) {
    assertInt('target_seat', target_seat, 1);
    seatToPlayerId(db, ev.game_id, target_seat);
  }
  const info = db.prepare('INSERT INTO actions (event_id, seat, action, target_seat, result) VALUES (?,?,?,?,?)')
    .run(event_id, seat, action, target_seat === undefined ? null : target_seat, result);
  return db.prepare('SELECT * FROM actions WHERE id=?').get(info.lastInsertRowid);
}
function addAction(dbOrOpts, opts) {
  if (isDbHandle(dbOrOpts)) return addActionCore(dbOrOpts, opts);
  return addActionCore(getConnection(), dbOrOpts);
}

const ORDER_SQL = "ORDER BY e.day, CASE e.phase WHEN 'night' THEN 0 WHEN 'day' THEN 1 ELSE 2 END, e.seq";

function listEvents(db, game_id) {
  requireGame(db, game_id);
  return db.prepare('SELECT e.id, e.game_id, e.day, e.phase, e.seq, e.type, p.seat AS actor_seat, e.raw_text'
    + ' FROM events e LEFT JOIN players p ON p.id = e.actor_seat WHERE e.game_id = ? ' + ORDER_SQL).all(game_id);
}

function getClaims(db, game_id) {
  requireGame(db, game_id);
  return db.prepare('SELECT c.id, c.event_id, e.day, e.phase, c.seat, c.subject_seat, c.predicate, c.object,'
    + ' c.extracted_by, c.confirmed_by_user FROM claims c JOIN events e ON e.id = c.event_id'
    + ' WHERE e.game_id = ? AND c.retracted = 0 ' + ORDER_SQL + ', c.id').all(game_id);
}

function getActions(db, game_id) {
  requireGame(db, game_id);
  return db.prepare('SELECT a.id, a.event_id, e.day, e.phase, a.seat, a.action, a.target_seat, a.result'
    + ' FROM actions a JOIN events e ON e.id = a.event_id'
    + ' WHERE e.game_id = ? AND a.retracted = 0 ' + ORDER_SQL + ', a.id').all(game_id);
}
function rowExists(db, table, id, label) {
  const allowed = { claims: 1, actions: 1 };
  if (!allowed[table]) fail('内部错误：非法表名 ' + table);
  const row = db.prepare('SELECT id FROM ' + table + ' WHERE id=?').get(id);
  if (!row) fail(label + ' 引用的 ' + table + '#' + id + ' 不存在（契约 §3：引用 id 必须存在于库）');
}
function evExistsInGame(db, gameId, eventId) {
  const row = db.prepare('SELECT id FROM events WHERE id=? AND game_id=?').get(eventId, gameId);
  if (!row) fail('game#' + gameId + ' 中不存在事件 #' + eventId);
}

function saveContradictions(db, game_id, rows) {
  requireGame(db, game_id);
  if (!Array.isArray(rows) || rows.length === 0) fail('saveContradictions: rows 必须为非空数组');
  const insert = db.prepare('INSERT INTO contradictions (game_id, claim_a, claim_b, action_a, action_b, conflict_desc, underdetermination, innocent_explanations, generated_by) VALUES (?,?,?,?,?,?,?,?,?)');
  const out = [];
  const run = db.transaction(() => {
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
      let refCount = 0;
      for (const key of ['claim_a', 'claim_b', 'action_a', 'action_b']) {
        const v = refs[key];
        if (v !== null) {
          assertInt(key, v, 1);
          rowExists(db, key.startsWith('claim') ? 'claims' : 'actions', v, '矛盾对');
          refCount++;
        }
      }
      if (refCount === 0) fail('矛盾对必须至少引用一个 claim/action id');
      const info = insert.run(game_id, refs.claim_a, refs.claim_b, refs.action_a, refs.action_b,
        r.conflict_desc, r.underdetermination, JSON.stringify(r.innocent_explanations), r.generated_by);
      const row = db.prepare('SELECT * FROM contradictions WHERE id=?').get(info.lastInsertRowid);
      out.push(Object.assign({}, row, { innocent_explanations: JSON.parse(row.innocent_explanations) }));
    }
  });
  run();
  return out;
}

function saveHypotheses(db, game_id, rows) {
  requireGame(db, game_id);
  if (!Array.isArray(rows) || rows.length === 0) fail('saveHypotheses: rows 必须为非空数组');
  const insert = db.prepare('INSERT INTO hypotheses (game_id, day, content, stance, support_events, oppose_events, tendency) VALUES (?,?,?,?,?,?,?)');
  const out = [];
  const run = db.transaction(() => {
    for (const h of rows) {
      assertInt('day', h.day, 1);
      requireNonEmptyString('content', h.content);
      if (!h.stance || typeof h.stance !== 'object' || Array.isArray(h.stance)) {
        fail('stance 必须为 per-player 立场对象，如 {"1":"wolf_suspect","4":"good_believe"}');
      }
      for (const key of ['support_events', 'oppose_events']) {
        const arr = h[key];
        if (!Array.isArray(arr)) fail(key + ' 必须为数组（元素=事件 id）');
        for (const eid of arr) { assertInt(key + ' 元素', eid, 1); evExistsInGame(db, game_id, eid); }
      }
      assertEnum('tendency', h.tendency, TENDENCIES);
      const info = insert.run(game_id, h.day, h.content, JSON.stringify(h.stance),
        JSON.stringify(h.support_events), JSON.stringify(h.oppose_events), h.tendency);
      out.push(parseHypothesis(db.prepare('SELECT * FROM hypotheses WHERE id=?').get(info.lastInsertRowid)));
    }
  });
  run();
  return out;
}

function parseHypothesis(row) {
  return Object.assign({}, row, {
    stance: JSON.parse(row.stance),
    support_events: JSON.parse(row.support_events),
    oppose_events: JSON.parse(row.oppose_events),
  });
}

function getContradictions(db, game_id) {
  requireGame(db, game_id);
  return db.prepare('SELECT * FROM contradictions WHERE game_id=? ORDER BY id').all(game_id)
    .map(r => Object.assign({}, r, { innocent_explanations: JSON.parse(r.innocent_explanations) }));
}
function getHypotheses(db, game_id) {
  requireGame(db, game_id);
  return db.prepare('SELECT * FROM hypotheses WHERE game_id=? ORDER BY id').all(game_id).map(parseHypothesis);
}
function getPlayersCore(db, game_id) {
  requireGame(db, game_id);
  return db.prepare('SELECT * FROM players WHERE game_id=? ORDER BY seat').all(game_id);
}
function getPlayers(dbOrId, a) {
  if (isDbHandle(dbOrId)) return getPlayersCore(dbOrId, a);
  return getPlayersCore(getConnection(), dbOrId);
}

// ══ v1 对象式接口 · 连接管理 ═══════════════════════════════════════
let _db = null;
function init(dbPath) {
  if (_db !== null) { try { _db.close(); } catch (e) { /* 已关闭 */ } _db = null; }
  const p = dbPath === undefined ? DEFAULT_DB_PATH : dbPath;
  if (p !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  _db = openDb(p);
  return module.exports;
}
function getConnection() { if (_db === null) init(); return _db; }
function closeCurrent() { if (_db !== null) { try { _db.close(); } catch (e) { /* 已关闭 */ } _db = null; } }

// ══ v1 对象式接口 · 局/席/事件子表（B→A 期望逐条实现）═══════════════
function getGame(id) {
  const row = getConnection().prepare('SELECT * FROM games WHERE id=?').get(id);
  return row === undefined ? null : row;
}
function seatExists(gameId, seat) {
  assertInt('seat', seat, 1);
  const row = getConnection().prepare('SELECT id FROM players WHERE game_id=? AND seat=?').get(gameId, seat);
  return row !== undefined;
}
function addClaim(opts) {
  if (!opts || typeof opts !== 'object') fail('addClaim: 参数必须为对象 {event_id,seat,subject_seat,predicate,object,...}');
  return addClaims(getConnection(), opts.event_id, [opts])[0];
}
function getClaim(id) {
  const row = getConnection().prepare('SELECT c.*, e.game_id FROM claims c JOIN events e ON e.id = c.event_id WHERE c.id=?').get(id);
  return row === undefined ? null : row;
}
function getAction(id) {
  const row = getConnection().prepare('SELECT a.*, e.game_id FROM actions a JOIN events e ON e.id = a.event_id WHERE a.id=?').get(id);
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
    + ' WHERE e.game_id = ? AND c.seat = ? AND c.retracted = 0 ' + ORDER_DESC_SQL + ' LIMIT ?').all(gameId, seat, n);
}

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
  return { game, players: getPlayersCore(db, gameId), events, claims, actions };
}

function exportGame(gameId) {
  const state = loadGameState(gameId, Infinity);
  if (!state) return null;
  state.meta = {
    game_id: gameId,
    exported_at: new Date().toISOString(),
    schema_contract: 'v1',
    counts: { events: state.events.length, claims: state.claims.length, actions: state.actions.length },
  };
  return state;
}

function saveAdvisorCard(gameId, day, card) {
  const db = getConnection();
  requireGame(db, gameId);
  assertInt('day', day, 1);
  if (!card || !Array.isArray(card.contradictions) || !Array.isArray(card.hypotheses)) {
    fail('saveAdvisorCard: card 须含 contradictions/hypotheses 数组（契约 §3）');
  }
  const refId = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/^[ca]/i, ''));
    if (!Number.isInteger(n) || n < 1) fail('参谋卡引用 id 非法: ' + JSON.stringify(v));
    return n;
  };
  let written = 0;
  const tx = db.transaction(() => {
    const insC = db.prepare('INSERT INTO contradictions (game_id, claim_a, claim_b, action_a, action_b, conflict_desc, underdetermination, innocent_explanations, generated_by) VALUES (?,?,?,?,?,?,?,?,?)');
    card.contradictions.forEach((c, i) => {
      if (!Array.isArray(c.innocent_explanations) || c.innocent_explanations.length < 1) {
        fail('RD1 校验失败：第 ' + (i + 1) + ' 条矛盾 innocent_explanations 为空（无无辜解释不得入库/展示）');
      }
      assertEnum('underdetermination', c.underdetermination, UNDERDETERMINATIONS);
      const refs = { claim_a: refId(c.claim_a), claim_b: refId(c.claim_b), action_a: refId(c.action_a), action_b: refId(c.action_b) };
      let refCount = 0;
      for (const key of ['claim_a', 'claim_b', 'action_a', 'action_b']) {
        if (refs[key] !== null) { rowExists(db, key.startsWith('claim') ? 'claims' : 'actions', refs[key], '参谋卡矛盾对'); refCount++; }
      }
      if (refCount === 0) fail('参谋卡第 ' + (i + 1) + ' 条矛盾必须至少引用一个 claim/action id（直接字段或 pair_id 记号）');
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
  });
  tx();
  return written;
}

module.exports = {
  openDb, closeDb, migrateDb, DEFAULT_DB_PATH, PHASE_ORDER,
  init, getConnection, closeCurrent,
  createGame, addPlayer, addEvent, addClaims, addClaim, addAction,
  listEvents, getClaims, getActions, getPlayers, getGame, seatExists,
  getClaim, getAction, updateClaimObject, updateAction,
  retractClaim, retractAction, recentClaimsBySeat, loadGameState, exportGame, saveAdvisorCard,
  saveContradictions, saveHypotheses, getContradictions, getHypotheses,
};



