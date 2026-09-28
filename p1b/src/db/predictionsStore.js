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
const baseRateMod = require('../evidence/baseRate'); // 批次 3：证据元素随行落库结构化基率（见 insertPrediction）

const SOURCE_TYPES = ['验证点', '预测卡'];
const OUTCOMES = ['true', 'false', 'ambiguous'];

/** predictions 表 DDL（按表名生成：合并迁移的标准 12 步重建需要同一定义换名 new_predictions）。
 *  layer 允许 L1-L6 **+ 'unknown'**（D-8.1 入账层闭环，2026-09-13 合并迁移 phase2）；
 *  secondary_layer 仍限 L1-L6——'unknown' 作 secondary 无意义，用 NULL 表达（与 intake_questions 同口径）。 */
function predictionsTableDdl(tableName) {
  const t = tableName || 'predictions';
  return [
  'CREATE TABLE IF NOT EXISTS ' + t + ' (',
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
  "  layer TEXT CHECK(layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6','unknown')),",
  "  secondary_layer TEXT CHECK(secondary_layer IS NULL OR secondary_layer IN ('L1','L2','L3','L4','L5','L6')),",
  '  engine TEXT,',
  '  baseline_brier REAL CHECK(baseline_brier IS NULL OR (baseline_brier >= 0 AND baseline_brier <= 1)),',
  '  public_exposure INTEGER CHECK(public_exposure IS NULL OR public_exposure IN (0,1)),',
  '  checklist_hash TEXT,',
  "  gate TEXT CHECK(gate IS NULL OR gate IN ('descriptive','scored','blocked')),",
  '  tautology INTEGER DEFAULT 0,',
  // R4（2026-09-13）：G2 门禁世代标记 + 到期日列（design §4.2 实现前置）
  '  g2_regime TEXT,',
  '  matures_at TEXT,',
  // #1（批次1）：D2 回测题落库必写两列（D2 §8.2）；非空即被 G2 排除出 ① 池
  '  metric_version TEXT,',
  '  backtest_batch TEXT',
  ');',
  ].join('\n');
}
const PREDICTIONS_TABLE_DDL = predictionsTableDdl('predictions');
const SCHEMA_PREDICTIONS = [
  PREDICTIONS_TABLE_DDL,
  'CREATE INDEX IF NOT EXISTS idx_predictions_game ON predictions(game_id, id DESC);',
  'CREATE INDEX IF NOT EXISTS idx_predictions_open ON predictions(outcome) WHERE outcome IS NULL;',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_cp_dedupe',
  "  ON predictions(game_id, day, statement) WHERE source_type = '验证点';",
].join('\n');

// 审计器七列的 additive 迁移定义（列名 = 定义串第一个 token）
const AUDIT_COLUMNS = [
  "layer TEXT CHECK(layer IS NULL OR layer IN ('L1','L2','L3','L4','L5','L6','unknown'))",
  "secondary_layer TEXT CHECK(secondary_layer IS NULL OR secondary_layer IN ('L1','L2','L3','L4','L5','L6'))",
  'engine TEXT',
  'baseline_brier REAL CHECK(baseline_brier IS NULL OR (baseline_brier >= 0 AND baseline_brier <= 1)),',
  'public_exposure INTEGER CHECK(public_exposure IS NULL OR public_exposure IN (0,1)),',
  'checklist_hash TEXT',
  "gate TEXT CHECK(gate IS NULL OR gate IN ('descriptive','scored','blocked'))",
  // 批次1-M1（p15）：tautology 重言标记列（评审攻击 6 裁定捆同一次账本变更；M2 起由分类流程置位）
  'tautology INTEGER DEFAULT 0',
  // R4（2026-09-13）：新增两列 additive 迁移定义（旧库 ALTER；新库随建表即有）
  'g2_regime TEXT',
  'matures_at TEXT',
  // #1（批次1）：D2 回测题标识两列（additive 迁移）
  'metric_version TEXT',
  'backtest_batch TEXT',
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
    g2_regime: row.g2_regime === undefined ? null : row.g2_regime,
    matures_at: row.matures_at === undefined ? null : row.matures_at,
    metric_version: row.metric_version === undefined ? null : row.metric_version,
    backtest_batch: row.backtest_batch === undefined ? null : row.backtest_batch,
  };
}

function assertProb(prob) {
  if (prob === null || prob === undefined) return null;
  if (typeof prob !== 'number' || !Number.isFinite(prob) || prob < 0 || prob > 1) {
    throw new Error('assigned_prob 必须是 [0,1] 数值或 null，收到: ' + JSON.stringify(prob));
  }
  return prob;
}

/** 'YYYY-MM-DD' 形状校验（不用正则，便于跨层引用）。 */
function isIsoDate(v) {
  const s = String(v);
  return s.length === 10 && s[4] === '-' && s[7] === '-' && !isNaN(Date.parse(s));
}
/** 月末日（'YYYY-MM' → 'YYYY-MM-DD'）；非法返回 null。 */
function lastDayOfMonth(ym) {
  const p = String(ym).split('-');
  if (p.length !== 2 || p[0].length !== 4 || p[1].length !== 2) return null;
  const y = Number(p[0]), mo = Number(p[1]);
  if (!isFinite(y) || !isFinite(mo) || mo < 1 || mo > 12) return null;
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}
/** MMWR/CDC 疫病周（'YYYYWW'）→ 该周周六（第 1 周含 1 月 4 日，周 = 周日..周六）。 */
function epiweekEnd(yw) {
  const s = String(yw);
  if (s.length !== 6) return null;
  const y = Number(s.slice(0, 4)), w = Number(s.slice(4));
  if (!isFinite(y) || !isFinite(w) || w < 1 || w > 53) return null;
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const sun = jan4.getTime() - jan4.getUTCDay() * 86400000;
  return new Date(sun + (w - 1) * 7 * 86400000 + 6 * 86400000).toISOString().slice(0, 10);
}
/** 'YYYYWww' → 该 ISO 周的周日。 */
function isoWeekSunday(yw) {
  const s = String(yw), i = s.indexOf('W');
  if (i !== 4) return null;
  const y = Number(s.slice(0, 4)), w = Number(s.slice(5));
  if (!isFinite(y) || !isFinite(w) || w < 1 || w > 53) return null;
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000;
  return new Date(mon + (w - 1) * 7 * 86400000 + 6 * 86400000).toISOString().slice(0, 10);
}
/**
 * #2（批次1）写端到期日推导：写端不得留空；推导不出即抛错（防 A2「新行默认 g2_regime=NULL 静默出域」）。
 * 覆盖：date / week_end / end / date_plus7 / week_start / period(月末) / month(月末) / year(次年 12-31)
 *       / epiweek(周六) / week('YYYYWww'→周日) / evidence.meta.drawDate|expectDate。
 *
 * ★**本函数不是契约的实现，是与契约并排的另一份手写件**——只有 `year` 一组已逐条对齐
 *   `g2-contract-frozen-r4.json`（回归锁 p1b/test/matures-at-year.test.cjs）。
 *   `period` / `month` / `end` / `week_start` 四组与契约、且与守护进程 `dueOf` 仍不一致
 *   （详见 p1b/src/evidence/dueBranches.js 的分组登记与 UNIMPLEMENTED 表）；
 *   那四组口径未拍板前**不要顺手改**——早一年与晚一月都会让结算通道选错题，且改错方向同样静默。
 */
function deriveMaturesAt(resolve, evidence) {
  const r = resolve || {};
  let d = isIsoDate(r.date) ? r.date : null;
  if (!d && isIsoDate(r.week_end)) d = r.week_end;
  if (!d && isIsoDate(r.end)) d = r.end;
  if (!d && isIsoDate(r.date_plus7)) d = r.date_plus7;
  if (!d && isIsoDate(r.week_start)) d = r.week_start;
  if (!d) d = lastDayOfMonth(r.period);
  if (!d) d = lastDayOfMonth(r.month);
  // 年度题到期日＝**次年** 12-31，不是本年：契约 year/yearly 四 kind 明写「date = 次年 12 月 31 日；输入 YYYY」
  // （保守上界＝年度发布滞后可达一年+，本年最后一日等于还没到发布窗口就判到期）。
  // 原实现写 String(r.year)+'-12-31'，整整早一年——到期日是结算通道的选题闸门，早一年会让年度题
  // 在真值尚未发布时就被选中。回归锁：p1b/test/matures-at-year.test.cjs（断言直接读契约，不信本行）。
  if (!d && String(r.year).length === 4 && isFinite(Number(r.year))) d = (Number(r.year) + 1) + '-12-31';
  if (!d) d = epiweekEnd(r.epiweek);
  if (!d) d = isoWeekSunday(r.week);
  if (!d) {
    for (const el of (Array.isArray(evidence) ? evidence : [])) {
      const meta = (el && el.meta) || {};
      if (isIsoDate(meta.drawDate)) { d = meta.drawDate; break; }
      if (isIsoDate(meta.expectDate)) { d = meta.expectDate; break; }
    }
  }
  if (!d) throw new Error('deriveMaturesAt: 无法推导到期日（#2 写端不得留空）：resolve=' + JSON.stringify(r).slice(0, 220));
  return d;
}
const LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
// D-8.1（2026-09-13 合并迁移）：primary layer 多一个 'unknown' 出口；secondary 仍限 LAYERS
// （'unknown' 作 secondary 无信息量 → 用 NULL 表达，与 intake_questions 的 CHECK 同口径）。
const PRIMARY_LAYERS = LAYERS.concat(['unknown']);
const GATES = ['descriptive', 'scored', 'blocked'];

// F16 真白名单（批次1 #17b，2026-09-13）：未知键一律抛错。
// 原实现只拦 7 个下划线名（黑名单），未知键静默落空——#2 的 g2Regime/maturesAt 正是这样被吞掉的。
// 白名单 = audit 九键（七原键 + g2Regime/maturesAt）∪ 调用方核心键（仅 insert 路径传入）。
const AUDIT_KEYS = ['layer','secondaryLayer','engine','baselineBrier','publicExposure','checklistHash','gate','g2Regime','maturesAt','metricVersion','backtestBatch'];
const CORE_INSERT_KEYS = ['gameId','day','sourceType','statement','prob','evidence'];
function assertAuditFields(f, extraAllowed) {
  const src = f || {};
  const o = {};
  const allowed = AUDIT_KEYS.concat(extraAllowed || []);
  const SNAKE = { layer:'layer', secondary_layer:'secondaryLayer', engine:'engine', baseline_brier:'baselineBrier', public_exposure:'publicExposure', checklist_hash:'checklistHash', gate:'gate', g2_regime:'g2Regime', matures_at:'maturesAt', metric_version:'metricVersion', backtest_batch:'backtestBatch' };
  for (const k of Object.keys(src)) {
    if (allowed.indexOf(k) !== -1) continue;
    if (SNAKE[k]) throw new Error('audit 字段命名漂移: 收到下划线「' + k + '」，请改用驼峰「' + SNAKE[k] + '」(F16 防复发)');
    throw new Error('未知字段「' + k + '」：不在白名单 ' + allowed.join('|') + '（F16 真白名单，未知键抛错以防静默落空）');
  }
  const put = (key, v, ok, msg) => {
    if (v === undefined) return;
    if (v === null) { o[key] = null; return; }
    if (!ok(v)) throw new Error(msg + '，收到: ' + JSON.stringify(v));
    o[key] = v;
  };
  put('layer', src.layer, (v) => PRIMARY_LAYERS.indexOf(v) !== -1, 'layer 必须是 ' + PRIMARY_LAYERS.join('|') + ' 或 null');
  put('secondary_layer', src.secondaryLayer, (v) => LAYERS.indexOf(v) !== -1, 'secondaryLayer 枚举错');
  put('engine', src.engine, (v) => typeof v === 'string' && v.trim() !== '', 'engine 必须是非空字符串或 null');
  put('baseline_brier', src.baselineBrier, (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1, 'baselineBrier 必须是 [0,1] 数值或 null');
  put('public_exposure', src.publicExposure, (v) => v === 0 || v === 1, 'publicExposure 必须是 0/1 或 null');
  put('checklist_hash', src.checklistHash, (v) => typeof v === 'string' && v.trim() !== '', 'checklistHash 必须是非空字符串或 null');
  put('gate', src.gate, (v) => GATES.indexOf(v) !== -1, 'gate 必须是 ' + GATES.join('|') + ' 或 null');
  // #2（批次1）：R4 世代标记 + 到期日两列（写端必写；旧库由 additive 迁移补列）
  put('g2_regime', src.g2Regime, (v) => typeof v === 'string' && v.trim() !== '', 'g2Regime 必须是非空字符串或 null');
  put('matures_at', src.maturesAt, (v) => isIsoDate(v), 'maturesAt 必须是 YYYY-MM-DD 或 null');
  // #1（批次1）：D2 回测题标识（非空即出 G2 门域）
  put('metric_version', src.metricVersion, (v) => typeof v === 'string' && v.trim() !== '', 'metricVersion 必须是非空字符串或 null');
  put('backtest_batch', src.backtestBatch, (v) => typeof v === 'string' && v.trim() !== '', 'backtestBatch 必须是非空字符串或 null');
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
  const a = assertAuditFields(p, CORE_INSERT_KEYS);
  // 批次 3（2026-09-14）：证据元素**随行落库**结构化基率 `evidence[i].baseRate`——
  //   只在元素含 baseRateNote 且尚无 baseRate 时物化（与 L2 读序同源 ⇒ 结构化读数与文本读数逐字相同，
  //   零翻转由构造保证；旧行为不变：无注记/整数 id 证据原样通过）。物化是**加键**，不改任何既有键。
  const evidence = (Array.isArray(p.evidence) ? p.evidence : []).map((e) => baseRateMod.attachBaseRate(e));
  // #2（批次1）：声明了 g2Regime 的批次写端必须**显式**给 maturesAt——有日历到期日给日期，
  // 无日历语义者显式传 null 并注释原因。禁止省略（原实现省略即静默 NULL，正是 A2「静默出域」）。
  if (p.g2Regime !== undefined && p.g2Regime !== null && p.maturesAt === undefined) {
    throw new Error('批次写端必须显式提供 maturesAt（#2：不得留空；无日历到期日者显式传 null）');
  }
  const conn = db.getConnection();
  const info = conn
    .prepare('INSERT INTO predictions (game_id, day, source_type, statement, assigned_prob, evidence_json, layer, secondary_layer, engine, baseline_brier, public_exposure, checklist_hash, gate, g2_regime, matures_at, metric_version, backtest_batch)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      p.gameId,
      p.day === undefined ? null : p.day,
      p.sourceType,
      p.statement.trim(),
      prob,
      JSON.stringify(evidence),
      a.layer === undefined ? null : a.layer,
      a.secondary_layer === undefined ? null : a.secondary_layer,
      a.engine === undefined ? null : a.engine,
      a.baseline_brier === undefined ? null : a.baseline_brier,
      a.public_exposure === undefined ? null : a.public_exposure,
      a.checklist_hash === undefined ? null : a.checklist_hash,
      a.gate === undefined ? null : a.gate,
      a.g2_regime === undefined ? null : a.g2_regime,
      a.matures_at === undefined ? null : a.matures_at,
      a.metric_version === undefined ? null : a.metric_version,
      a.backtest_batch === undefined ? null : a.backtest_batch
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

/** 上海日历日「今天」——到期口径的唯一定义处。 */
function todayShanghai() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 10);
}

/**
 * 到期判定（**单一真源**，2026-09-28）：`matures_at <= 今天`（上海日历日，含当日）。
 * 与 T6 只读端点 `GET /api/disclosure/resolve-queue`（`p1b/src/routes/disclosure.js:70,86`）
 * 逐字同款。两边各写一套日期算法正是本项目已经吃过一次亏的地方（缺陷一的 year 分支分叉），
 * 故到期只此一套判定；新写日期算法前请先读这段。
 *
 * 三态而非两态，因为第三态是真实存在的一整类题：
 *   `due`         到期，可落定；
 *   `not_due`     未到期，**拒绝落定**（真值尚未产生，此刻落定＝把半成品当真值写进不可逆账本）；
 *   `no_due_date` 无日历到期日（matures_at 为空）——**照常放行**。
 *   第三态为什么不能一并拦掉：botc 程序结算题、cwl/dlt 开奖题全无日历到期日
 *   （全库实测 underivable 474 条 + 大量显式 null），一刀切拦死等于把整类题打死。
 *   但也不许静默放行——回带一句人话，让「不受到期日约束」是看得见的。
 */
function maturityState(row, today) {
  const t = today || todayShanghai();
  const raw = row ? row.matures_at : null;
  const due = (raw === null || raw === undefined) ? '' : String(raw).slice(0, 10);
  if (!due) {
    return { state: 'no_due_date', date: null, today: t,
      why: '本题无日历到期日（matures_at 为空）——按来源自身节奏结算（botc 程序结算 / cwl·dlt 开奖等），不受到期日约束' };
  }
  if (due <= t) return { state: 'due', date: due, today: t, why: '已到期（' + due + ' <= ' + t + '）' };
  return { state: 'not_due', date: due, today: t, why: '未到期：到期日 ' + due + ' 晚于今天 ' + t + '，真值尚未产生，此刻落定＝把半成品当真值写进不可逆账本' };
}

/**
 * 未 resolve 清单。★2026-09-28 起**默认剔除「未到期」**（原来零过滤，未到期题与已到期题混在一张待办清单里，
 *   而这张清单正是人点「落定」时看的东西）。
 *
 * ★**无到期日的题照旧留在清单里**（只剔除「有到期日但还没到」）：botc 程序结算题、cwl/dlt 开奖题
 *   全无日历到期日，它们此刻就是可落定的——一并剔除等于把整类题从待办里抹掉。
 *   本仓库的既有契约 `GET /api/predictions/unresolved`「只含未 resolve 行」也正是这么定的。
 *   它们留在清单里 + `due_filter.included_no_due_date` 如实计数，状态可见、不静默。
 * @param {{dueFilter?:false}} opts `dueFilter:false` 关闭过滤，供内部诊断/全量排查用（默认开）。
 * @returns 分页体 + `due_filter`（两桶**如实计数**，不许静默吞题）
 */
function listUnresolved(opts) {
  const o = opts || {};
  const t = todayShanghai();
  if (o.dueFilter === false) {
    const page = listWhere('outcome IS NULL', [], o);
    return Object.assign(page, { due_filter: { on: false, today: t, excluded_not_yet_due: 0, included_no_due_date: 0 } });
  }
  const page = listWhere(
    "outcome IS NULL AND (matures_at IS NULL OR matures_at = '' OR substr(matures_at,1,10) <= ?)", [t], o);
  const c = db.getConnection().prepare(
    "SELECT SUM(CASE WHEN matures_at IS NULL OR matures_at = '' THEN 1 ELSE 0 END) AS no_date,"
    + " SUM(CASE WHEN matures_at IS NOT NULL AND matures_at <> '' AND substr(matures_at,1,10) > ? THEN 1 ELSE 0 END) AS not_yet"
    + ' FROM predictions WHERE outcome IS NULL').get(t);
  return Object.assign(page, {
    due_filter: { on: true, today: t, excluded_not_yet_due: (c && c.not_yet) || 0, included_no_due_date: (c && c.no_date) || 0 },
  });
}

/**
 * resolve 真值回填（账本不可变：已 resolve 拒改）。
 * ★2026-08-28 T1（M7）：原文在此写「纠错另开修正记录」，但**全库无 amend 接口**
 *   （grep 零命中）⇒ 那是指向一条不存在的路。已改为在 409 文案里**如实说明**
 *   「目前没有修正入口」。真要做修正功能，须先定「修正记录算不算进校准统计」，
 *   属**另立项**范围，不在本轮。
 *
 * ★2026-09-28 加到期校验（本函数曾是全项目最宽的一条写入口）：
 *   原实现只查 `outcome !== null`，**完全不看 `matures_at`** ⇒ 任何未到期的题都能被落定，
 *   而账本无修正入口 ⇒ 一次误点＝不可逆污染。现在未到期一律拒写。
 *   到期口径复用 `maturityState`（与 T6 只读端点同款），**不在此另写日期算法**。
 *
 * ⚠ `opts.allowNotDue` 是**唯一的**逃生口，仅供「明知要写未到期题」的口径夹具与内部回填
 *   （例：测试 `prediction-lifeline.test.cjs` 故意造「结算早于事件日」的口径缺陷样本）。
 *   **HTTP 路由一律不得透传**——透传即等于把这次设防拆掉。
 * @returns {{ok:true,row:object,due_note?:string}|{ok:false,reason:'not_found'}|{ok:false,reason:'already_resolved',row:object}|{ok:false,reason:'not_due',due:string,today:string,why:string}}
 */
function resolvePrediction(id, outcome, note, opts) {
  const conn = db.getConnection();
  const row = conn.prepare('SELECT * FROM predictions WHERE id = ?').get(id);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.outcome !== null && row.outcome !== undefined) {
    return { ok: false, reason: 'already_resolved', row: rowToPrediction(row) };
  }
  const due = maturityState(row);
  if (due.state === 'not_due' && !(opts && opts.allowNotDue === true)) {
    return { ok: false, reason: 'not_due', due: due.date, today: due.today, why: due.why };
  }
  conn.prepare("UPDATE predictions SET resolved_at = datetime('now'), outcome = ?, resolve_note = ? WHERE id = ?")
    .run(outcome, note === undefined || note === null ? null : note, id);
  const ok = { ok: true, row: rowToPrediction(conn.prepare('SELECT * FROM predictions WHERE id = ?').get(id)) };
  // 无到期日的那类题：放行，但把「为什么不受到期日约束」摆到明面上（不许静默放行）。
  if (due.state === 'no_due_date') ok.due_note = due.why;
  return ok;
}

/**
 * L0 门禁状态（只读统计，不含任何评分——「评」要等门禁解锁）。
 * 批次 2-M2 双口径：records=总账（含重言式题）；records_valid=tautology=0 计数
 * （重言式题不计入门禁——S1 A3/批次 2 裁定：恒定结果题对校准/门禁无信息量）。
 * review_unlocked = 局数 ≥30 且 **records_valid** ≥200（改用有效口径，重言灌水不解锁门禁）；
 * false 时 UI 一切数字只配「参考」。
 */
function l0Gate() {
  const conn = db.getConnection();
  const records = conn.prepare('SELECT COUNT(*) AS n FROM predictions').get().n;
  const recordsValid = conn.prepare('SELECT COUNT(*) AS n FROM predictions WHERE tautology = 0').get().n;
  const games = conn.prepare('SELECT COUNT(DISTINCT game_id) AS n FROM predictions').get().n;
  const resolved = conn.prepare('SELECT COUNT(*) AS n FROM predictions WHERE outcome IS NOT NULL').get().n;
  return {
    gate: 'L0 只记不评：n≥30 局 ∧ 200 条前不评分，UI 数字只配「参考」；重言式题（tautology=1）不计入门禁',
    games: games,
    records: records,
    records_valid: recordsValid,
    resolved: resolved,
    unresolved: records - resolved,
    review_unlocked: games >= 30 && recordsValid >= 200,
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
  updateAuditFields, LAYERS, PRIMARY_LAYERS, GATES, predictionsTableDdl, PREDICTIONS_TABLE_DDL,
  updateTautology, deriveMaturesAt, assertAuditFields, AUDIT_KEYS, CORE_INSERT_KEYS, epiweekEnd, isIsoDate,
  todayShanghai, maturityState,
};
