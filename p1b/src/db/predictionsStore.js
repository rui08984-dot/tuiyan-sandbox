'use strict';
/**
 * p1b/src/db/predictionsStore.js —— 预测卡 L0 账本（第十棒 W1，p1b 私有表 predictions）。
 *
 * L0 门禁（D-裁决 §4 / C-创新 §二 L0，语义写死在此层）：n≥30 局 ∧ 200 条前「只记不评」——
 * 本存储只做记账与 resolve 真值回填，不产出任何准确率/校准评分（评分属 W2 消融+仪表盘，
 * 且必须等门禁解锁）。l0Gate() 如实回报门禁状态，供 UI 挂「参考」横幅（禁「预测」字样）。
 *
 * 存储切分照 botc/claims.js（B2）与 db/oracleStore.js（p9 W1）先例：共享库禁 DDL →
 * p1b 私有表启动时 CREATE TABLE IF NOT EXISTS 的 additive 新表，不改任何 p1a 既有表结构。
 *
 * 字段语义：
 *   source_type '验证点' = 参谋卡 checkpoint 天结算自动落卡（convertCheckpointsToPredictions，
 *                          照 C 方案 1「账本每日自动出题」机制）；
 *   source_type '预测卡' = 人工/调用方落注（POST /api/games/:id/predictions；口语概率如
 *                          「大概率」必须由调用方澄清为 0-1 数值后才许落库）。
 *   assigned_prob        = 落注时的数值概率；验证点自动落卡时 p1a 引擎 checkpoint={text,resolves}
 *                          （只读不改）无概率字段 → NULL（L0 只记不评，概率可后补；W2 多路判词
 *                          的 implied_prob 落 verdicts 表，不占用本列）。
 *   outcome              = resolve 真值回填：'true'|'false'|'ambiguous'；判定标准歧义 → 恒走
 *                          ambiguous 不许硬判（C 的 L0 判据：判定标准歧义争议率<5%）。
 *   evidence_json        = 证据事件 id 引用数组（验证点=top-3：其 resolves 指向假设的
 *                          support_events/oppose_events 并集前 3，id 已过 p1a postValidate 白名单）。
 *
 * ── 万物可预测性审计器 MVP-A（Q 棒 2026-09-11，设计=docs/specs/2026-09-11-万物可预测性审计器-design.md §3）──
 *   七个 additive 可空列（layer/secondary_layer/engine/baseline_brier/public_exposure/checklist_hash/gate），
 *   零破坏既有列；旧库由 ensurePredictionsTable 内 PRAGMA 检缺列+事务 ALTER 补齐（瞬时，锁 <5s）。
 *   layer=可预测性六层（L1 决定论/L2 系综/L3 短窗混沌/L4 自反/L5 不可约随机/L6 对抗），
 *   gate=descriptive/scored/blocked（G2 未过→检索来源题恒 descriptive），tier 与 layer 正交。
 *   tautology（批次1-M1，p15）=重言标记 0/1（DEFAULT 0）：判定标准与结算定义重言的题
 *   （如 L1 程序结算题）置 1，供 v3 基率注入豁免（L1 一律不注入）与后续消融分层。
 */
const { db } = require('../deps');

const SOURCE_TYPES = ['验证点', '预测卡'];
const OUTCOMES = ['true', 'false', 'ambiguous'];

const SCHEMA_PREDICTIONS = [
  'CREATE TABLE IF NOT EXISTS predictions (',
  '  id INTEGER PRIMARY KEY,',
  '  game_id INTEGER NOT NULL REFERENCES games(id),',
  '  day INTEGER,',
  "  source_type TEXT NOT NULL CHECK(source_type IN ('验证点','预测卡')),",
  '  statement TEXT NOT NULL,',
  '  assigned_prob REAL CHECK(assigned_prob IS NULL OR (assigned_prob >= 0 AND assigned_prob <= 1)),',
  '  evidence_json TEXT,',
  "  created_at TEXT DEFAULT (datetime('now')),",
  '  resolved_at TEXT,',
  "  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('true','false','ambiguous')),",
  '  resolve_note TEXT,',
  "  layer TEXT CHECK(layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6')),",
  "  secondary_layer TEXT CHECK(secondary_layer IS NULL OR secondary_layer IN ('L1','L2','L3','L4','L5','L6')),",
  '  engine TEXT,',
  '  baseline_brier REAL CHECK(baseline_brier IS NULL OR (baseline_brier >= 0 AND baseline_brier <= 1)),',
  '  public_exposure INTEGER CHECK(public_exposure IS NULL OR public_exposure IN (0,1)),',
  '  checklist_hash TEXT,',
  "  gate TEXT CHECK(gate IS NULL OR gate IN ('descriptive','scored','blocked')),",
  '  tautology INTEGER DEFAULT 0',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_predictions_game ON predictions(game_id, id DESC);',
  'CREATE INDEX IF NOT EXISTS idx_predictions_open ON predictions(outcome) WHERE outcome IS NULL;',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_cp_dedupe',
  "  ON predictions(game_id, day, statement) WHERE source_type = '验证点';",
].join('\n');

// 审计器七列的 additive 迁移定义（列名 = 定义串第一个 token）
const AUDIT_COLUMNS = [
  "layer TEXT CHECK(layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6'))",
  "secondary_layer TEXT CHECK(secondary_layer IS NULL OR secondary_layer IN ('L1','L2','L3','L4','L5','L6'))",
  'engine TEXT',
  'baseline_brier REAL CHECK(baseline_brier IS NULL OR (baseline_brier >= 0 AND baseline_brier <= 1)),',
  'public_exposure INTEGER CHECK(public_exposure IS NULL OR public_exposure IN (0,1)),',
  'checklist_hash TEXT',
  "gate TEXT CHECK(gate IS NULL OR gate IN ('descriptive','scored','blocked'))",
  // 批次1-M1（p15）：tautology 重言标记列（评审攻击 6 裁定捆同一次账本变更；M2 起由分类流程置位）
  'tautology INTEGER DEFAULT 0',
];

/** p1b 启动/路由注册时调用一次：建 p1b 私有表（幂等；绝不触碰 p1a 既有表）。
 *  含 additive 迁移：旧库缺审计列 → PRAGMA 检测后事务内逐条 ALTER（毫秒级，锁 <5s），
 *  与 M1 批量写库互不冲突（单写者事务队列天然串行）。 */
function ensurePredictionsTable(conn) {
  if (!conn) throw new Error('ensurePredictionsTable: 需要 better-sqlite3 连接');
  conn.exec(SCHEMA_PREDICTIONS);
  const cols = new Set(conn.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name));
  const missing = AUDIT_COLUMNS.filter((def) => !cols.has(def.split(' ')[0]));
  if (missing.length) {
    const migrate = conn.transaction(() => {
      for (const def of missing) conn.exec('ALTER TABLE predictions ADD COLUMN ' + def);
    });
    migrate();
  }
}

/** 行 → 读模型（evidence_json 解析回数组；assigned_prob 列 NULL 保持 null） */
function rowToPrediction(row) {
  if (!row) return null;
  let evidence = [];
  if (row.evidence_json) {
    try { evidence = JSON.parse(row.evidence_json); } catch (e) { evidence = []; }
  }
  return {
    id: row.id,
    game_id: row.game_id,
    day: row.day,
    source_type: row.source_type,
    statement: row.statement,
    assigned_prob: row.assigned_prob === undefined ? null : row.assigned_prob,
    evidence: evidence,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    outcome: row.outcome,
    resolve_note: row.resolve_note,
    layer: row.layer === undefined ? null : row.layer,
    secondary_layer: row.secondary_layer === undefined ? null : row.secondary_layer,
    engine: row.engine === undefined ? null : row.engine,
    baseline_brier: row.baseline_brier === undefined ? null : row.baseline_brier,
    public_exposure: row.public_exposure === undefined ? null : row.public_exposure,
    checklist_hash: row.checklist_hash === undefined ? null : row.checklist_hash,
    gate: row.gate === undefined ? null : row.gate,
    tautology: row.tautology === undefined ? null : row.tautology,
  };
}

function assertProb(prob) {
  if (prob === null || prob === undefined) return null;
  if (typeof prob !== 'number' || !Number.isFinite(prob) || prob < 0 || prob > 1) {
    throw new Error('assigned_prob 必须是 [0,1] 数值或 null，收到: ' + JSON.stringify(prob));
  }
  return prob;
}

const LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
const GATES = ['descriptive', 'scored', 'blocked'];

function assertAuditFields(f) {
  const src = f || {};
  const o = {};
  const put = (key, v, ok, msg) => {
    if (v === undefined) return;
    if (v === null) { o[key] = null; return; }
    if (!ok(v)) throw new Error(msg + '，收到: ' + JSON.stringify(v));
    o[key] = v;
  };
  put('layer', src.layer, (v) => LAYERS.indexOf(v) !== -1, 'layer 必须是 ' + LAYERS.join('|') + ' 或 null');
  put('secondary_layer', src.secondaryLayer, (v) => LAYERS.indexOf(v) !== -1, 'secondaryLayer 枚举错');
  put('engine', src.engine, (v) => typeof v === 'string' && v.trim() !== '', 'engine 必须是非空字符串或 null');
  put('baseline_brier', src.baselineBrier, (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1, 'baselineBrier 必须是 [0,1] 数值或 null');
  put('public_exposure', src.publicExposure, (v) => v === 0 || v === 1, 'publicExposure 必须是 0/1 或 null');
  put('checklist_hash', src.checklistHash, (v) => typeof v === 'string' && v.trim() !== '', 'checklistHash 必须是非空字符串或 null');
  put('gate', src.gate, (v) => GATES.indexOf(v) !== -1, 'gate 必须是 ' + GATES.join('|') + ' 或 null');
  return o;
}

/**
 * 落注一行。@param {{gameId:number, day?:number|null, sourceType:string,
 *   statement:string, prob?:number|null, evidence?:number[]}} p
 * @returns 读模型行（含 id/created_at）
 */
function insertPrediction(p) {
  if (!p || SOURCE_TYPES.indexOf(p.sourceType) === -1) {
    throw new Error('source_type 必须是 ' + SOURCE_TYPES.join('|'));
  }
  if (typeof p.statement !== 'string' || !p.statement.trim()) {
    throw new Error('statement 必须是非空字符串');
  }
  const prob = assertProb(p.prob);
  const a = assertAuditFields(p);
  const conn = db.getConnection();
  const info = conn
    .prepare('INSERT INTO predictions (game_id, day, source_type, statement, assigned_prob, evidence_json, layer, secondary_layer, engine, baseline_brier, public_exposure, checklist_hash, gate)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      p.gameId,
      p.day === undefined ? null : p.day,
      p.sourceType,
      p.statement.trim(),
      prob,
      JSON.stringify(Array.isArray(p.evidence) ? p.evidence : []),
      a.layer === undefined ? null : a.layer,
      a.secondary_layer === undefined ? null : a.secondary_layer,
      a.engine === undefined ? null : a.engine,
      a.baseline_brier === undefined ? null : a.baseline_brier,
      a.public_exposure === undefined ? null : a.public_exposure,
      a.checklist_hash === undefined ? null : a.checklist_hash,
      a.gate === undefined ? null : a.gate
    );
  return getPrediction(Number(info.lastInsertRowid));
}

function getPrediction(id) {
  const row = db.getConnection().prepare('SELECT * FROM predictions WHERE id = ?').get(id);
  return rowToPrediction(row);
}

/** 分页实现（新→旧 id DESC）。limit 上限 100 由调用方（路由）钳制。 */
function listWhere(where, args, opts) {
  const o = opts || {};
  const limit = o.limit === undefined ? 20 : o.limit;
  const offset = o.offset === undefined ? 0 : o.offset;
  const conn = db.getConnection();
  const countStmt = conn.prepare('SELECT COUNT(*) AS n FROM predictions WHERE ' + where);
  const total = countStmt.get.apply(countStmt, args).n; // apply 须以 statement 自身为 thisArg（better-sqlite3 原生绑定）
  const rowsStmt = conn.prepare('SELECT * FROM predictions WHERE ' + where
    + ' ORDER BY id DESC LIMIT ? OFFSET ?');
  const rows = rowsStmt.all.apply(rowsStmt, args.concat([limit, offset]));
  return { items: rows.map(rowToPrediction), total: total, limit: limit, offset: offset };
}

/** 按局分页清单。 */
function listByGame(gameId, opts) {
  return listWhere('game_id = ?', [gameId], opts);
}

/** 未 resolve 清单（outcome IS NULL）。 */
function listUnresolved(opts) {
  return listWhere('outcome IS NULL', [], opts);
}

/**
 * resolve 真值回填（账本不可变：已 resolve 拒改，纠错另开修正记录）。
 * @returns {{ok:true,row:object}|{ok:false,reason:'not_found'}|{ok:false,reason:'already_resolved',row:object}}
 */
function resolvePrediction(id, outcome, note) {
  const conn = db.getConnection();
  const row = conn.prepare('SELECT * FROM predictions WHERE id = ?').get(id);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.outcome !== null && row.outcome !== undefined) {
    return { ok: false, reason: 'already_resolved', row: rowToPrediction(row) };
  }
  conn.prepare("UPDATE predictions SET resolved_at = datetime('now'), outcome = ?, resolve_note = ? WHERE id = ?")
    .run(outcome, note === undefined || note === null ? null : note, id);
  return { ok: true, row: rowToPrediction(conn.prepare('SELECT * FROM predictions WHERE id = ?').get(id)) };
}

/**
 * L0 门禁状态（只读统计，不含任何评分——「评」要等门禁解锁）。
 * review_unlocked = 局数 ≥30 且记录数 ≥200；false 时 UI 一切数字只配「参考」。
 */
function l0Gate() {
  const conn = db.getConnection();
  const records = conn.prepare('SELECT COUNT(*) AS n FROM predictions').get().n;
  const games = conn.prepare('SELECT COUNT(DISTINCT game_id) AS n FROM predictions').get().n;
  const resolved = conn.prepare('SELECT COUNT(*) AS n FROM predictions WHERE outcome IS NOT NULL').get().n;
  return {
    gate: 'L0 只记不评：n≥30 局 ∧ 200 条前不评分，UI 数字只配「参考」',
    games: games,
    records: records,
    resolved: resolved,
    unresolved: records - resolved,
    review_unlocked: games >= 30 && records >= 200,
  };
}

/**
 * 参谋卡验证点 → predictions 自动落卡（L0 核心自动化，天结算时调用）。
 * checkpoint={text,resolves}（p1a 引擎只读）：statement=text；assigned_prob 取 cp.prob
 * 数值（现引擎无此字段 → NULL）；evidence=resolves 指向假设的 support/oppose 事件并集前 3。
 * 幂等：同局同天同 statement 重复结算走 UNIQUE 索引跳过（不重复落卡）。
 * 防御：resolves 无有效命中的 cp（无证据锚点）skip 不落卡——p1a postValidate 本会删除此类 cp，
 * 此处兜底防异常输入落脏卡（队长口径：越界→skip）。
 * @param {{gameId:number, day:number, card:{checkpoints?:Array, hypotheses?:Array}}} o
 * @returns {{inserted:number, skipped:number}}
 */
function convertCheckpointsToPredictions(o) {
  const card = o && o.card;
  if (!card || !Array.isArray(card.checkpoints)) return { inserted: 0, skipped: 0 };
  const hyps = Array.isArray(card.hypotheses) ? card.hypotheses : [];
  const conn = db.getConnection();
  let inserted = 0, skipped = 0;
  for (const cp of card.checkpoints) {
    if (!cp || typeof cp.text !== 'string' || !cp.text.trim()) { skipped++; continue; }
    const ids = [];
    let hits = 0;
    for (const idx of (Array.isArray(cp.resolves) ? cp.resolves : [])) {
      const h = hyps[idx];
      if (!h) continue;
      hits++;
      for (const key of ['support_events', 'oppose_events']) {
        for (const id of (Array.isArray(h[key]) ? h[key] : [])) {
          if (typeof id === 'number' && ids.indexOf(id) === -1) ids.push(id);
        }
      }
    }
    if (hits === 0) { skipped++; continue; } // resolves 无有效命中=无证据锚点，不落脏卡
    const prob = (typeof cp.prob === 'number' && Number.isFinite(cp.prob)) ? cp.prob : null;
    try {
      conn.prepare('INSERT INTO predictions (game_id, day, source_type, statement, assigned_prob, evidence_json)'
        + ' VALUES (?, ?, ?, ?, ?, ?)')
        .run(o.gameId, o.day === undefined ? null : o.day, '验证点', cp.text.trim(), prob, JSON.stringify(ids.slice(0, 3)));
      inserted++;
    } catch (e) {
      if (String((e && e.message) || e).indexOf('UNIQUE') !== -1) skipped++; // 重复结算幂等跳过
      else throw e;
    }
  }
  return { inserted: inserted, skipped: skipped };
}

/**
 * ECE+分桶纯计算（C 方案 5 口径）：rows = 已 resolve（true/false）且 assigned_prob 非空的行。
 * 10 等宽桶 [0,0.1)...[0.9,1.0]（p=1.0 落末桶）；ECE=Σ(n_b/N)*|trueRate_b−meanProb_b|。
 * 纯统计零 LLM——本函数是其余方案的天然对照组（G-合并 §2 总架构）。
 */
function eceOf(rows) {
  const buckets = [];
  for (let i = 0; i < 10; i++) buckets.push({ lo: i / 10, hi: (i + 1) / 10, n: 0, sumProb: 0, sumTrue: 0 });
  for (const r of rows) {
    const idx = Math.min(9, Math.floor(r.assigned_prob * 10));
    const b = buckets[idx];
    b.n++;
    b.sumProb += r.assigned_prob;
    b.sumTrue += (r.outcome === 'true' ? 1 : 0);
  }
  let ece = 0;
  const out = buckets.map((b) => {
    const meanProb = b.n ? b.sumProb / b.n : null;
    const trueRate = b.n ? b.sumTrue / b.n : null;
    if (b.n) ece += (b.n / rows.length) * Math.abs(trueRate - meanProb);
    return { lo: b.lo, hi: b.hi, n: b.n, mean_prob: meanProb, true_rate: trueRate };
  });
  return { ece: ece, buckets: out };
}

/**
 * 校准读数（W2，GET /api/predictions/calibration）：总体 + 按 source_type 分层。
 * n<30 → 「数据不足」（C 方案 5 分层判据：宁缺毋滥，防分层噪声自信）；
 * n≥200 才到预注册校准样本（L1 判据 ECE<0.10）——note 恒挂「参考」铁律。
 * 拟合件（Platt/isotonic/logit 蛋）零实现只留挂点——无 resolve 积累不装学习件（F 陷阱五）。
 */
function calibration() {
  const conn = db.getConnection();
  const rows = conn.prepare("SELECT assigned_prob, outcome, source_type FROM predictions"
    + " WHERE outcome IN ('true','false') AND assigned_prob IS NOT NULL ORDER BY id ASC").all();
  const n = rows.length;
  const gate = l0Gate();
  if (n < 30) {
    return { status: '数据不足', n: n, note: 'L0 只记不评：n≥30 才出 ECE 与分桶（C 方案 5），当前仅记账', l0_gate: gate };
  }
  const total = eceOf(rows);
  const layers = {};
  for (const st of SOURCE_TYPES) {
    const sub = rows.filter((r) => r.source_type === st);
    layers[st] = sub.length < 30 ? { status: '数据不足', n: sub.length } : Object.assign({ status: 'ok', n: sub.length }, eceOf(sub));
  }
  return {
    status: 'ok',
    n: n,
    ece: total.ece,
    buckets: total.buckets,
    layers: layers,
    note: 'L0 铁律：本接口数字只配「参考」，禁「预测」宣称；n≥200 才到预注册校准样本（C 方案 5）',
    l0_gate: gate,
  };
}

/**
 * 审计字段补录/更新（分类可在落注后进行——分类是元数据，不改 resolve 结果；账本不可变规则不受影响）。
 * @param {number} id @param {{layer?, secondaryLayer?, engine?, baselineBrier?, publicExposure?, checklistHash?, gate?}} f
 * @returns 读模型行；id 不存在返回 null；f 为空对象时原样返回当前行。
 */
function updateAuditFields(id, f) {
  const a = assertAuditFields(f);
  const keys = Object.keys(a);
  if (!keys.length) return getPrediction(id);
  const conn = db.getConnection();
  const exists = conn.prepare('SELECT id FROM predictions WHERE id = ?').get(id);
  if (!exists) return null;
  const stmt = conn.prepare('UPDATE predictions SET ' + keys.map((k) => k + ' = ?').join(', ') + ' WHERE id = ?');
  stmt.run.apply(stmt, keys.map((k) => a[k]).concat([id]));
  return getPrediction(id);
}

/**
 * 重言标记置位/清除（批次1-M1 additive 列 tautology；评审攻击 6 裁定捆同一次账本变更）。
 * 语义：tautology=1 表示该判定标准与结算定义重言（如「首夜平安」layer=L1 的程序结算题），
 * 其基率对 v3 无信息量（0/30 白送）——loadBaseline 对 L1 一律不注入即源于此。
 * M2 起由分类流程调用置位；本微步（M1）只交付函数与列迁移，不更新任何库数据。
 * @param {number} id @param {0|1} flag
 * @returns 读模型行；id 不存在 → null。
 */
function updateTautology(id, flag) {
  if (flag !== 0 && flag !== 1) {
    throw new Error('tautology 必须是 0 或 1，收到: ' + JSON.stringify(flag));
  }
  const conn = db.getConnection();
  const exists = conn.prepare('SELECT id FROM predictions WHERE id = ?').get(id);
  if (!exists) return null;
  conn.prepare('UPDATE predictions SET tautology = ? WHERE id = ?').run(flag, id);
  return getPrediction(id);
}

module.exports = {
  ensurePredictionsTable, insertPrediction, getPrediction, listByGame, listUnresolved,
  resolvePrediction, l0Gate, convertCheckpointsToPredictions, calibration, SOURCE_TYPES, OUTCOMES,
  updateAuditFields, LAYERS, GATES,
  updateTautology,
};
