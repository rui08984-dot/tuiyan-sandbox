'use strict';
/**
 * p1b/src/db/oracleStore.js —— 独立玄学排盘历史档案（p9 W1，p1b 私有表 oracle_readings）。
 *
 * 存储切分（照 botc/claims.js B2 先例）：共享库禁 DDL → p1b 私有表启动时
 * CREATE TABLE IF NOT EXISTS 的 additive 新表；不改任何 p1a 既有表结构。
 * game_id NULLABLE REFERENCES games(id)：独立玄学页自由排盘不挂局（NULL）；
 * 从对局上下文来的排盘可带 game_id 留档关联。
 * verdict 列排盘时恒写 NULL：断语（LLM）属推断层，与排盘（纯数学）解耦
 * （docs/specs/2026-09-07-推演沙盘-design.md §2.3）——历史档案先留结构位，
 * 绝不因断语缺失影响排盘落档；后续如需可回填。
 */
const { db } = require('../deps');

const SCHEMA_ORACLE_READINGS = `
CREATE TABLE IF NOT EXISTS oracle_readings (
  id INTEGER PRIMARY KEY,
  method TEXT NOT NULL CHECK(method IN ('numbers','time','random')),
  inputs_json TEXT NOT NULL,
  hexagram_json TEXT NOT NULL,
  verdict TEXT,
  disclaimer TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  game_id INTEGER REFERENCES games(id)
);
CREATE INDEX IF NOT EXISTS idx_oracle_readings_game ON oracle_readings(game_id, id DESC);
`;

/** p1b 启动时调用一次：建 p1b 私有表（幂等；绝不触碰 p1a 既有表） */
function ensureOracleReadingsTable(conn) {
  if (!conn) throw new Error('ensureOracleReadingsTable: 需要 better-sqlite3 连接');
  conn.exec(SCHEMA_ORACLE_READINGS);
}

/** 行 → 读模型（JSON 字段解析回对象；字段名与 API 契约对齐：hexagram 列 → casting 字段） */
function rowToReading(row) {
  if (!row) return null;
  return {
    id: row.id,
    method: row.method,
    inputs: JSON.parse(row.inputs_json),
    casting: JSON.parse(row.hexagram_json),
    verdict: row.verdict,
    disclaimer: row.disclaimer,
    created_at: row.created_at,
    game_id: row.game_id,
  };
}

/**
 * 落档一行排盘。hexagram = 排盘全套（本/互/变/动爻/体用/五行 + numbers + derived_from）。
 * @param {{method:string, inputs:object, hexagram:object, verdict?:string|null,
 *          disclaimer:string, gameId?:number|null}} reading
 * @returns 读模型行（含 id/created_at）
 */
function saveOracleReading(reading) {
  const conn = db.getConnection();
  const info = conn
    .prepare('INSERT INTO oracle_readings (method, inputs_json, hexagram_json, verdict, disclaimer, game_id)'
      + ' VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      reading.method,
      JSON.stringify(reading.inputs === undefined || reading.inputs === null ? {} : reading.inputs),
      JSON.stringify(reading.hexagram),
      reading.verdict === undefined ? null : reading.verdict,
      reading.disclaimer,
      reading.gameId === undefined ? null : reading.gameId
    );
  return getOracleReading(Number(info.lastInsertRowid));
}

/**
 * 断语写回（G1 反馈 #1，P9 预留结构位启用）：UPDATE 同一行 verdict 列，幂等不新增行。
 * @param {number} id oracle_readings 主键
 * @param {string|null} verdict 断语文本（mock/live 同一落位；重解读即覆盖）
 * @returns {object|null} 更新后的读模型行；行不存在返回 null
 */
function updateOracleReadingVerdict(id, verdict) {
  const conn = db.getConnection();
  const info = conn.prepare('UPDATE oracle_readings SET verdict = ? WHERE id = ?')
    .run(verdict === undefined ? null : verdict, id);
  if (!info.changes) return null;
  return getOracleReading(id);
}

function getOracleReading(id) {
  const row = db.getConnection()
    .prepare('SELECT * FROM oracle_readings WHERE id = ?').get(id);
  return rowToReading(row);
}

/**
 * 分页历史（新→旧 id DESC）。limit 上限 100 由调用方（路由）钳制。
 * @param {{limit?:number, offset?:number, gameId?:number|null}} opts
 * @returns {{items:Array, total:number, limit:number, offset:number}}
 */
function listOracleReadings(opts) {
  const o = opts || {};
  const limit = o.limit === undefined ? 20 : o.limit;
  const offset = o.offset === undefined ? 0 : o.offset;
  const conn = db.getConnection();
  let rows, total;
  if (o.gameId === undefined || o.gameId === null) {
    total = conn.prepare('SELECT COUNT(*) AS n FROM oracle_readings').get().n;
    rows = conn.prepare('SELECT * FROM oracle_readings ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  } else {
    total = conn.prepare('SELECT COUNT(*) AS n FROM oracle_readings WHERE game_id = ?').get(o.gameId).n;
    rows = conn.prepare('SELECT * FROM oracle_readings WHERE game_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(o.gameId, limit, offset);
  }
  return { items: rows.map(rowToReading), total: total, limit: limit, offset: offset };
}

module.exports = { ensureOracleReadingsTable, saveOracleReading, getOracleReading, updateOracleReadingVerdict, listOracleReadings };
