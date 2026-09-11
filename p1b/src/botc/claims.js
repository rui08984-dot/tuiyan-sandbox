'use strict';
/**
 * p1b/src/botc/claims.js —— BOTC 局声称校验/归一化 + p1b 私有存储（B2 棒）。
 *
 * ── 存储切分（BRIEFS 已定工程约束，S2 拍板）────────────────────────────
 * p1a db.js:97 的 claims 表 CHECK 约束 predicate ∈ 7 枚举，且共享库禁 DDL →
 *   1) 角色类声称（claims_role/is_role）：object 收角色名中/英文 → roles.js 归一化为
 *      角色 id 后走【主表 claims】通用路径（7 枚举内的谓词，零 schema 侵入）；
 *   2) 阵营/状态类新谓词（is_demon/is_minion/status_drunk/status_poisoned）：
 *      落【p1b 私有表 botc_claims】；建局剧本落【p1b 私有表 botc_games】。
 *   两表均为 p1b 启动时 CREATE TABLE IF NOT EXISTS 的 additive 新表（FK 只引用既有
 *   games/events 行，不改任何 p1a 既有表结构）；werewolf 局路径零改动。
 *   is_wolf 保留 werewolf 专用语义；botc 局虽不产生该谓词（抽取层不出），但通用
 *   7 枚举谓词在 botc 局仍走主表，不拦不改。
 *
 * ── 谓词语义（血染钟楼）──────────────────────────────────────────────
 *   is_demon/is_minion：指认某 subject 是恶魔/爪牙（阵营类；BOTC 无统一狼阵营，
 *   不复用 is_wolf）。status_drunk/status_poisoned：声称某 subject 处于醉酒/中毒
 *   状态（状态类；醉酒/中毒=合法信息为假，摸底 §5 的一等不确定性来源）。
 */
const { db } = require('../deps');
const { httpError } = require('../util');
const roles = require('./roles');

const BOTC_GAME_TYPE = 'botc';
/** BOTC 专属谓词（botc 局专属，落 botc_claims） */
const BOTC_CLAIM_PREDICATES = ['is_demon', 'is_minion', 'status_drunk', 'status_poisoned'];
/** 角色类声称谓词（通用 7 枚举内，落主表 claims） */
const ROLE_ASSERT_PREDICATES = ['claims_role', 'is_role'];
/** 阵营/状态词 → BOTC 专属谓词（B7 护栏：精确全词匹配，防「带着爪牙走」这类长句误伤） */
const BOTC_WORD_MAP = {
  '恶魔': 'is_demon', '爪牙': 'is_minion', '醉酒': 'status_drunk', '中毒': 'status_poisoned',
};

const SCHEMA_BOTC = `
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
`;

/** p1b 启动时调用一次：建 p1b 私有表（幂等；绝不触碰 p1a 既有表） */
function ensureBotcTables(conn) {
  if (!conn) throw new Error('ensureBotcTables: 需要 better-sqlite3 连接');
  conn.exec(SCHEMA_BOTC);
}

/** 挂剧本（建局时调用；同局重复挂=改剧本，upsert 幂等） */
function setGameScript(gameId, script) {
  if (!roles.SCRIPTS.includes(script)) {
    throw httpError(400, 'script 必须是 ' + roles.SCRIPTS.join('|') + '，收到: ' + JSON.stringify(script));
  }
  db.getConnection()
    .prepare('INSERT INTO botc_games (game_id, script) VALUES (?, ?)'
      + ' ON CONFLICT(game_id) DO UPDATE SET script = excluded.script')
    .run(gameId, script);
  return script;
}

/** 读剧本；非 botc 局或未挂 → null */
function getGameScript(gameId) {
  const row = db.getConnection()
    .prepare('SELECT script FROM botc_games WHERE game_id = ?').get(gameId);
  return row ? row.script : null;
}

/**
 * BOTC 局声称归一化 + 切分（confirm 事务前调用；入参已过 validateClaim 通用校验）。
 * - BOTC 专属谓词 → {target:'botc_claims'}（object 允许为空备注）；
 * - 角色类声称 → object 归一化为角色 id（中/英/大小写都收）；
 *   B7 护栏：阵营/状态词硬塞（is_role(恶魔) 等）→ 修复归入专属谓词；不可解析角色 → 降级
 *   said 留痕；两者均记 warnings、不再 400 拒整批。仅「可解析但越剧本」保持 400（真实录入
 *   错误须人工确认）；is_wolf 硬塞阵营词同理修复归入（BOTC 局无狼阵营）。
 * - 其余通用谓词 → 主表 claims 原样透传。
 * @returns {{main: Array, botc: Array, warnings: string[]}} main=主表 claims 行参，botc=botc_claims 行参，warnings=护栏动作留痕
 */
function splitBotcClaims(script, claims) {
  const out = { main: [], botc: [], warnings: [] };
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];
    if (BOTC_CLAIM_PREDICATES.includes(c.predicate)) {
      out.botc.push({
        seat: c.seat, subject_seat: c.subject_seat, predicate: c.predicate,
        object: c.object === undefined || c.object === null ? '' : String(c.object).trim(),
      });
      continue;
    }
    if (ROLE_ASSERT_PREDICATES.includes(c.predicate)) {
      const rawObj = String(c.object === undefined || c.object === null ? '' : c.object).trim();
      // B7 护栏①：阵营/状态词硬塞 is_role/claims_role（如 is_role(14,'恶魔')）不再 400——
      // 按 BOTC 语义修复归入专属谓词落 botc_claims（词精确匹配；原词保留为 object 备注）
      if (BOTC_WORD_MAP[rawObj]) {
        out.botc.push({ seat: c.seat, subject_seat: c.subject_seat,
          predicate: BOTC_WORD_MAP[rawObj], object: rawObj });
        out.warnings.push('claims[' + i + ']: ' + c.predicate + '「' + rawObj
          + '」是阵营/状态词不是角色名——按 BOTC 语义归入 ' + BOTC_WORD_MAP[rawObj]
          + '（B7 护栏，不拒整批）');
        continue;
      }
      const role = roles.resolveRole(rawObj);
      // B7 护栏②：不可解析角色（自然语言/口误，如「孙子」）降级 said 留痕，不破坏账本：
      // 无编造、无丢弃、警告注明；整批不再因单条拒入。越剧本（可解析但不属本剧本）仍 400——
      // 那是真实录入错误，须人工确认。
      if (!role) {
        out.main.push(Object.assign({}, c, { predicate: 'said', object: rawObj }));
        out.warnings.push('claims[' + i + ']: ' + c.predicate + '「' + rawObj
          + '」不是剧本内有效角色名——降级为 said 留痕（B7 护栏，不拒整批）');
        continue;
      }
      if (!roles.roleInEdition(role, script)) {
        throw httpError(400, 'claims[' + i + '].object「' + c.object + '」不属于剧本 '
          + script + '（「' + roles.roleNameZh(role) + '」属 '
          + (role.editions || []).join('/') + '）——越剧本声称须人工确认');
      }
      out.main.push(Object.assign({}, c, { object: role.id }));
      continue;
    }
    // B7 护栏③：is_wolf 硬塞阵营词（botc 局无狼阵营）→ 修复归入专属谓词；其余 is_wolf 原样透传
    if (c.predicate === 'is_wolf' && BOTC_WORD_MAP[String(c.object === undefined || c.object === null ? '' : c.object).trim()]) {
      const w = String(c.object).trim();
      out.botc.push({ seat: c.seat, subject_seat: c.subject_seat,
        predicate: BOTC_WORD_MAP[w], object: w });
      out.warnings.push('claims[' + i + ']: is_wolf「' + w + '」按 BOTC 语义归入 '
        + BOTC_WORD_MAP[w] + '（BOTC 局无狼阵营，B7 护栏）');
      continue;
    }
    out.main.push(c);
  }
  return out;
}

// ── botc_claims CRUD（与 p1a claims 同纪律：软删 retracted，绝不物理删）──

/** 查询列表排序与 p1a loadGameState 同构：day → phase(night<day<dusk) → seq → id */
const BOTC_ORDER_SQL = ' ORDER BY e.day, CASE e.phase'
  + " WHEN 'night' THEN 0 WHEN 'day' THEN 1 ELSE 2 END, e.seq, bc.id";

/** 入账一条 BOTC 专属谓词声称（confirm 事务内调用） */
function addBotcClaim(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('addBotcClaim: 参数必须为对象 {game_id,event_id,seat,subject_seat,predicate,...}');
  }
  const conn = db.getConnection();
  return conn.prepare(
    'INSERT INTO botc_claims (game_id, event_id, seat, subject_seat, predicate, object,'
    + ' extracted_by, confirmed_by_user) VALUES (?,?,?,?,?,?,?,?)'
  ).run(opts.game_id, opts.event_id, opts.seat, opts.subject_seat, opts.predicate,
    opts.object === undefined || opts.object === null ? '' : String(opts.object),
    opts.extracted_by || 'llm', opts.confirmed_by_user === undefined ? 0 : opts.confirmed_by_user);
}

/** 单条（含 game_id JOIN，供路由归属校验；已撤回行也可见） */
function getBotcClaim(id) {
  return db.getConnection().prepare(
    'SELECT bc.*, e.game_id, e.day, e.phase FROM botc_claims bc'
    + ' JOIN events e ON e.id = bc.event_id WHERE bc.id = ?'
  ).get(id) || null;
}

/** 局内列表（排除已撤回；uptoDay 可选，供 advise/展示按天截断） */
function listBotcClaims(gameId, opts) {
  opts = opts || {};
  const conn = db.getConnection();
  let sql = 'SELECT bc.id, bc.game_id, bc.event_id, e.day, e.phase, bc.seat, bc.subject_seat,'
    + ' bc.predicate, bc.object, bc.extracted_by, bc.confirmed_by_user'
    + ' FROM botc_claims bc JOIN events e ON e.id = bc.event_id'
    + ' WHERE bc.game_id = ? AND bc.retracted = 0';
  const params = [gameId];
  if (opts.uptoDay !== undefined && opts.uptoDay !== null) {
    sql += ' AND e.day <= ?';
    params.push(opts.uptoDay);
  }
  return conn.prepare(sql + BOTC_ORDER_SQL).all(...params);
}

/** 软删幂等（账本纪律；存在即 true） */
function retractBotcClaim(id) {
  const conn = db.getConnection();
  if (!conn.prepare('SELECT id FROM botc_claims WHERE id = ?').get(id)) return false;
  conn.prepare('UPDATE botc_claims SET retracted = 1 WHERE id = ?').run(id);
  return true;
}

/** 修订 botc 声称（谓词/主语/备注；调用方负责归属与撤回校验，枚举合法性由表 CHECK+路由双重把关） */
function updateBotcClaim(id, patch) {
  const conn = db.getConnection();
  const sets = [], vals = [];
  if (patch.predicate !== undefined) { sets.push('predicate = ?'); vals.push(patch.predicate); }
  if (patch.subject_seat !== undefined) { sets.push('subject_seat = ?'); vals.push(patch.subject_seat); }
  if (patch.object !== undefined) { sets.push('object = ?'); vals.push(patch.object); }
  if (sets.length === 0) throw new Error('updateBotcClaim: patch 至少含 predicate/subject_seat/object 之一');
  vals.push(id);
  conn.prepare('UPDATE botc_claims SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  return getBotcClaim(id);
}

module.exports = {
  BOTC_GAME_TYPE, BOTC_CLAIM_PREDICATES, ROLE_ASSERT_PREDICATES, BOTC_WORD_MAP,
  ensureBotcTables, setGameScript, getGameScript, splitBotcClaims,
  addBotcClaim, getBotcClaim, listBotcClaims, retractBotcClaim, updateBotcClaim,
};
