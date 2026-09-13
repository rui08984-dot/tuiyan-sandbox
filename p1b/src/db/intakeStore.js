'use strict';
/**
 * p1b/src/db/intakeStore.js —— 开放接题·拒收日志（第十一步·阶段 3 出口件，p1b 私有表 intake_rejects）。
 *
 * 依据：docs/specs/2026-09-11-万物可预测性审计器-design.md §1.1 拒收门 / §4 防 Goodhart ②「拒收题必须
 * 记 reason，拒收原因分布进月报」；docs/specs/万物分类清单-v2.md 第 0 步（Q0-1/Q0-2/Q0-3 三问）。
 *
 * 语义：候选题过不了拒收门（任一问「否」）时不入 predictions 账本，改在本表留痕——
 *   reason=no_anchor（Q0-1 无真值锚）/ leak（Q0-2 cutoff 不早于决定性时点）/ tautology（Q0-3 结果恒定）
 *   / other（预留，design §4 防 Goodhart ②原文枚举含 other）。
 *   detail=失败问编号 + 清单版本 + resolve_spec 摘要（JSON 文本，便于月报归因）。
 *
 * 存储切分照 predictionsStore.js（p10 W1）与 botc/claims.js（B2）先例：共享库禁 DDL →
 * p1b 私有表启动时 CREATE TABLE IF NOT EXISTS 的 additive 新表，不改任何 p1a 既有表结构、
 * 不改 predictions 任何既有列语义。
 */
const { db } = require('../deps');

const REASONS = ['no_anchor', 'leak', 'tautology', 'other'];

const SCHEMA_INTAKE_REJECTS = [
  'CREATE TABLE IF NOT EXISTS intake_rejects (',
  '  id INTEGER PRIMARY KEY,',
  '  statement TEXT NOT NULL,',
  "  reason TEXT NOT NULL CHECK(reason IN ('no_anchor','leak','tautology','other')),",
  '  detail TEXT,',
  "  created_at TEXT DEFAULT (datetime('now'))",
  ');',
  'CREATE INDEX IF NOT EXISTS idx_intake_rejects_reason ON intake_rejects(reason, id DESC);',
].join('\n');

/** p1b 启动/路由注册时调用一次：建 p1b 私有拒收日志表（幂等；零碰 p1a 既有表）。 */
function ensureIntakeTable(conn) {
  if (!conn) throw new Error('ensureIntakeTable: 需要 better-sqlite3 连接');
  conn.exec(SCHEMA_INTAKE_REJECTS);
}

function rowToReject(row) {
  if (!row) return null;
  let detail = null;
  if (row.detail) { try { detail = JSON.parse(row.detail); } catch (e) { detail = row.detail; } }
  return {
    id: row.id,
    statement: row.statement,
    reason: row.reason,
    detail: detail,
    created_at: row.created_at,
  };
}

/**
 * 落一条拒收留痕。@param {{statement:string, reason:string, detail?:object|string}} p
 * @returns 读模型行（含 id/created_at）；reason 非枚举 → 抛错（防命名漂移静默落空）。
 */
function insertReject(p) {
  if (!p || typeof p.statement !== 'string' || !p.statement.trim()) {
    throw new Error('statement 必须是非空字符串');
  }
  if (REASONS.indexOf(p.reason) === -1) {
    throw new Error('reason 必须是 ' + REASONS.join('|') + '，收到: ' + JSON.stringify(p.reason));
  }
  const detail = p.detail === undefined || p.detail === null
    ? null
    : (typeof p.detail === 'string' ? p.detail : JSON.stringify(p.detail));
  const conn = db.getConnection();
  const info = conn.prepare('INSERT INTO intake_rejects (statement, reason, detail) VALUES (?, ?, ?)')
    .run(p.statement.trim(), p.reason, detail);
  return getReject(Number(info.lastInsertRowid));
}

function getReject(id) {
  return rowToReject(db.getConnection().prepare('SELECT * FROM intake_rejects WHERE id = ?').get(id));
}

/** 分页清单（新→旧 id DESC）。limit 上限由调用方（路由）钳制。 */
function listRejects(opts) {
  const o = opts || {};
  const limit = o.limit === undefined ? 20 : o.limit;
  const offset = o.offset === undefined ? 0 : o.offset;
  const conn = db.getConnection();
  const total = conn.prepare('SELECT COUNT(*) AS n FROM intake_rejects').get().n;
  const rows = conn.prepare('SELECT * FROM intake_rejects ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  return { items: rows.map(rowToReject), total: total, limit: limit, offset: offset };
}

/** 拒收原因分布（防 Goodhart：分布须可见，含 0 计数的枚举原因，禁只报非零自掩）。 */
function rejectStats() {
  const conn = db.getConnection();
  const rows = conn.prepare('SELECT reason, COUNT(*) AS n FROM intake_rejects GROUP BY reason').all();
  const byReason = REASONS.map((r) => {
    const hit = rows.filter((x) => x.reason === r)[0];
    return { reason: r, n: hit ? hit.n : 0 };
  });
  const total = byReason.reduce((s, x) => s + x.n, 0);
  return { total: total, by_reason: byReason };
}

module.exports = { ensureIntakeTable, insertReject, getReject, listRejects, rejectStats, REASONS };
