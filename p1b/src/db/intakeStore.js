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
 *
 * ── D-8.1 / D-8.2 落地（design §8，2026-09-13 用户拍板选项 A）──────────────────
 *   intake_questions（D-8.2）：外部题挂载表。classify 通过（非拒收）时落一行，保存
 *     题面/resolve_spec/分层/secondary/gate/checklist_hash/引擎位。与 predictions 以「可选外键位」
 *     关联（intake_reject_id 与未来的域容器规则）——本轮**不自动落 predictions**。
 *   predictions_r4（D-8.1）：只读归一视图，把 predictions 与 intake_questions 按统一列形状
 *     UNION ALL（origin 列区分来源）；供报表/UI 只读呈现，**不改账本、不写 predictions**。
 *   F13 现状 = **半闭环**：接题层（unknown 出口）已闭环；入账层（放开 predictions.layer CHECK
 *     的表重建）待与 F4 真值分库三步合并为同一次计划内账本迁移（design §8 D-8.1）。
 *     **不得宣称 F13 已全闭**；G2 判定仍只读 predictions 原表。
 */
const { db } = require('../deps');

const REASONS = ['no_anchor', 'leak', 'tautology', 'other'];

// intake_questions 的 layer 允许 unknown（D-8.1：unknown 留在接题层；predictions 的 CHECK 仍限 L1-L6）
const INTAKE_LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'unknown'];
const OUTCOMES = ['true', 'false', 'ambiguous'];
const GATES = ['descriptive', 'scored', 'blocked'];

// D-8.2：外部题挂载表（additive；无 game_id 依赖，故外部题不需要「局」）
const SCHEMA_INTAKE_QUESTIONS = [
  'CREATE TABLE IF NOT EXISTS intake_questions (',
  '  id INTEGER PRIMARY KEY,',
  '  statement TEXT NOT NULL,',
  '  resolve_spec TEXT,',
  "  layer TEXT CHECK(layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6','unknown')),",
  "  secondary_layer TEXT CHECK(secondary_layer IS NULL OR secondary_layer IN ('L1','L2','L3','L4','L5','L6')),",
  "  gate TEXT CHECK(gate IS NULL OR gate IN ('descriptive','scored','blocked')),",
  '  checklist_hash TEXT,',
  '  engine TEXT,',
  "  created_at TEXT DEFAULT (datetime('now')),",
  '  resolved_at TEXT,',
  "  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('true','false','ambiguous')),",
  '  evidence TEXT,',
  '  intake_reject_id INTEGER',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_intake_questions_layer ON intake_questions(layer, id DESC);',
].join('\n');

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

// D-8.1：只读归一视图（predictions ∪ intake_questions，origin 列区分来源；不改账本、不写 predictions）
const SCHEMA_PREDICTIONS_R4 = [
  'CREATE VIEW IF NOT EXISTS predictions_r4 AS',
  "SELECT 'predictions' AS origin, p.id AS id, p.game_id AS game_id, p.statement AS statement,",
  '  NULL AS resolve_spec, p.layer AS layer, p.secondary_layer AS secondary_layer,',
  '  p.gate AS gate, p.checklist_hash AS checklist_hash, p.engine AS engine,',
  '  p.source_type AS source_type, p.assigned_prob AS assigned_prob,',
  '  p.evidence_json AS evidence_json, p.g2_regime AS g2_regime, p.matures_at AS matures_at,',
  '  p.tautology AS tautology, p.created_at AS created_at, p.resolved_at AS resolved_at,',
  '  p.outcome AS outcome, p.resolve_note AS resolve_note, NULL AS intake_reject_id',
  'FROM predictions p',
  'UNION ALL',
  "SELECT 'intake_questions' AS origin, q.id AS id, NULL AS game_id, q.statement AS statement,",
  '  q.resolve_spec AS resolve_spec, q.layer AS layer, q.secondary_layer AS secondary_layer,',
  '  q.gate AS gate, q.checklist_hash AS checklist_hash, q.engine AS engine,',
  '  NULL AS source_type, NULL AS assigned_prob,',
  '  q.evidence AS evidence_json, NULL AS g2_regime, NULL AS matures_at,',
  '  0 AS tautology, q.created_at AS created_at, q.resolved_at AS resolved_at,',
  '  q.outcome AS outcome, NULL AS resolve_note, q.intake_reject_id AS intake_reject_id',
  'FROM intake_questions q;',
].join('\n');

/** p1b 启动/路由注册时调用一次：建接题层两张 additive 表 + 只读归一视图（幂等；零碰 p1a 既有表）。 */
function ensureIntakeTables(conn) {
  if (!conn) throw new Error('ensureIntakeTables: 需要 better-sqlite3 连接');
  conn.exec(SCHEMA_INTAKE_REJECTS);
  conn.exec(SCHEMA_INTAKE_QUESTIONS);
  require('./predictionsStore').ensurePredictionsTable(conn); // 视图引用 predictions，先确保存在（幂等 additive）
  conn.exec(SCHEMA_PREDICTIONS_R4);
}

/** 兼容上棒调用名：语义等同 ensureIntakeTables（旧调用方无需改动）。 */
function ensureIntakeTable(conn) {
  ensureIntakeTables(conn);
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

function rowToIntakeQuestion(row) {
  if (!row) return null;
  let resolveSpec = null;
  if (row.resolve_spec) { try { resolveSpec = JSON.parse(row.resolve_spec); } catch (e) { resolveSpec = row.resolve_spec; } }
  let evidence = [];
  if (row.evidence) { try { evidence = JSON.parse(row.evidence); } catch (e) { evidence = row.evidence; } }
  return {
    id: row.id,
    statement: row.statement,
    resolve_spec: resolveSpec,
    layer: row.layer === undefined ? null : row.layer,
    secondary_layer: row.secondary_layer === undefined ? null : row.secondary_layer,
    gate: row.gate === undefined ? null : row.gate,
    checklist_hash: row.checklist_hash === undefined ? null : row.checklist_hash,
    engine: row.engine === undefined ? null : row.engine,
    created_at: row.created_at,
    resolved_at: row.resolved_at === undefined ? null : row.resolved_at,
    outcome: row.outcome === undefined ? null : row.outcome,
    evidence: evidence,
    intake_reject_id: row.intake_reject_id === undefined ? null : row.intake_reject_id,
  };
}

function toJsonText(v) {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function assertIntakeQuestion(p) {
  if (!p || typeof p.statement !== 'string' || !p.statement.trim()) throw new Error('statement 必须是非空字符串');
  if (p.layer !== undefined && p.layer !== null && INTAKE_LAYERS.indexOf(p.layer) === -1) {
    throw new Error('layer 必须是 ' + INTAKE_LAYERS.join('|') + ' 或 null，收到: ' + JSON.stringify(p.layer));
  }
  if (p.secondaryLayer !== undefined && p.secondaryLayer !== null && INTAKE_LAYERS.indexOf(p.secondaryLayer) === -1) {
    throw new Error('secondaryLayer 枚举错: ' + JSON.stringify(p.secondaryLayer));
  }
  if (p.gate !== undefined && p.gate !== null && GATES.indexOf(p.gate) === -1) {
    throw new Error('gate 必须是 ' + GATES.join('|') + ' 或 null');
  }
}

/** classify 通过落行（D-8.2 外部题挂载）。返回读模型行（含 id/created_at）。 */
function insertIntakeQuestion(p) {
  assertIntakeQuestion(p);
  const conn = db.getConnection();
  const info = conn.prepare('INSERT INTO intake_questions (statement, resolve_spec, layer, secondary_layer, gate, checklist_hash, engine, evidence, intake_reject_id)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(p.statement.trim(), toJsonText(p.resolveSpec), p.layer === undefined ? null : p.layer,
      p.secondaryLayer === undefined ? null : p.secondaryLayer, p.gate === undefined ? null : p.gate,
      p.checklistHash === undefined ? null : p.checklistHash, p.engine === undefined ? null : p.engine,
      toJsonText(p.evidence === undefined ? null : p.evidence), p.intakeRejectId === undefined ? null : p.intakeRejectId);
  return getIntakeQuestion(Number(info.lastInsertRowid));
}

function getIntakeQuestion(id) {
  return rowToIntakeQuestion(db.getConnection().prepare('SELECT * FROM intake_questions WHERE id = ?').get(id));
}

/** 接题通过题分页清单（新→旧 id DESC）。 */
function listIntakeQuestions(opts) {
  const o = opts || {};
  const limit = o.limit === undefined ? 20 : o.limit;
  const offset = o.offset === undefined ? 0 : o.offset;
  const conn = db.getConnection();
  const total = conn.prepare('SELECT COUNT(*) AS n FROM intake_questions').get().n;
  const rows = conn.prepare('SELECT * FROM intake_questions ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  return { items: rows.map(rowToIntakeQuestion), total: total, limit: limit, offset: offset };
}

module.exports = {
  ensureIntakeTables, ensureIntakeTable, insertReject, getReject, listRejects, rejectStats, REASONS,
  INTAKE_LAYERS, OUTCOMES, GATES, insertIntakeQuestion, getIntakeQuestion, listIntakeQuestions,
  SCHEMA_INTAKE_QUESTIONS, SCHEMA_PREDICTIONS_R4,
};
