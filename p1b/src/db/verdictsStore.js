'use strict';
/**
 * p1b/src/db/verdictsStore.js —— 多路判词全量落库（第十棒 W2，p1b 私有表 verdicts）。
 *
 * 口径（G-合并 §2 六臂 C 臂 / C 方案 3 原文）：判词全量逐行落库（不只存聚合值），
 * 消融在库上离线跑（scripts/ablation.cjs）。3 路 = 同 provider（tokenrhythm）×
 * 3 prompt 变体 × 温度多样性（0.2/0.7/1.0），每路一行；provider 维度留空待第二把 key
 * 扩展 3×N（表结构直接兼容：将来加 provider 列或以 prompt_variant 命名空间区分）。
 *
 * 铁律落点：verdict_text 是 LLM 唯一产出（多路推理=合法四角色）；implied_prob 必须
 * 由路由层按固定输出格式（末行 P=0.xx）正则机械抽取，禁 LLM 自由给数直进数值列
 *（项目两次负结果均死于 LLM 直接输出数字——temperature=0 也只是稳定地错同一个数）。
 *
 * 存储切分照 predictionsStore/oracleStore 先例：p1b 私有表 additive，零碰 p1a 既有表。
 *
 * 版本戳（p13 批次0.5 additive 迁移）：model=生成该判词的模型标识；run_id=预注册重跑
 * 批次 id（重跑 90 条实验隔离旧判词用）。可空 TEXT，旧行两列 NULL 如实留空不回填。
 */
const { db } = require('../deps');

const PROMPT_VARIANTS = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
const TEMPERATURES = [0.2, 0.7, 1.0];

// 版本戳两列的 additive 迁移定义（列名 = 定义串第一个 token，照 predictionsStore.AUDIT_COLUMNS 先例）
const VERSION_COLUMNS = ['model TEXT', 'run_id TEXT'];

const SCHEMA_VERDICTS = [
  'CREATE TABLE IF NOT EXISTS verdicts (',
  '  id INTEGER PRIMARY KEY,',
  '  prediction_id INTEGER NOT NULL REFERENCES predictions(id),',
  "  prompt_variant TEXT NOT NULL CHECK(prompt_variant IN ('v1_evidence','v2_skeptical','v3_baserate')),",
  '  temperature REAL NOT NULL CHECK(temperature BETWEEN 0 AND 1),',
  '  verdict_text TEXT NOT NULL,',
  '  implied_prob REAL CHECK(implied_prob IS NULL OR (implied_prob >= 0 AND implied_prob <= 1)),',
  '  model TEXT,',
  '  run_id TEXT,',
  "  created_at TEXT DEFAULT (datetime('now'))",
  ');',
  'CREATE INDEX IF NOT EXISTS idx_verdicts_pred ON verdicts(prediction_id, id);',
  // 幂等：同一预测点同一路只留首条判词（created_at=证据时间戳语义，F 防泄漏要求稳定）
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_verdicts_route ON verdicts(prediction_id, prompt_variant, temperature);',
].join('\n');

/** p1b 启动/路由注册时调用一次（幂等；绝不触碰 p1a 既有表） */
function ensureVerdictsTable(conn) {
  if (!conn) throw new Error('ensureVerdictsTable: 需要 better-sqlite3 连接');
  conn.exec(SCHEMA_VERDICTS);
  // additive 迁移（p13 批次0.5，照 predictionsStore.ensurePredictionsTable 先例）：
  // 旧库缺 model/run_id → PRAGMA 检测后事务内逐条 ALTER（毫秒级，锁 <5s）；旧行两列 NULL。
  const cols = new Set(conn.prepare('PRAGMA table_info(verdicts)').all().map((c) => c.name));
  const missing = VERSION_COLUMNS.filter((def) => !cols.has(def.split(' ')[0]));
  if (missing.length) {
    const migrate = conn.transaction(() => {
      for (const def of missing) conn.exec('ALTER TABLE verdicts ADD COLUMN ' + def);
    });
    migrate();
  }
}

function rowToVerdict(row) {
  if (!row) return null;
  return {
    id: row.id,
    prediction_id: row.prediction_id,
    prompt_variant: row.prompt_variant,
    temperature: row.temperature,
    verdict_text: row.verdict_text,
    implied_prob: row.implied_prob === undefined ? null : row.implied_prob,
    model: row.model === undefined ? null : row.model,
    run_id: row.run_id === undefined ? null : row.run_id,
    created_at: row.created_at,
  };
}

/**
 * 落一行判词（INSERT OR IGNORE 幂等：同点同路重复生成保首条，返回既有/新插入行）。
 * @param {{predictionId:number, promptVariant:string, temperature:number,
 *   verdictText:string, impliedProb?:number|null, model?:string|null, runId?:string|null}} v
 */
function saveVerdict(v) {
  if (!v || PROMPT_VARIANTS.indexOf(v.promptVariant) === -1) {
    throw new Error('prompt_variant 必须是 ' + PROMPT_VARIANTS.join('|'));
  }
  if (typeof v.verdictText !== 'string' || !v.verdictText.trim()) {
    throw new Error('verdict_text 必须是非空字符串');
  }
  const prob = (v.impliedProb === undefined || v.impliedProb === null) ? null : v.impliedProb;
  if (prob !== null && (typeof prob !== 'number' || !Number.isFinite(prob) || prob < 0 || prob > 1)) {
    throw new Error('implied_prob 必须是 [0,1] 数值或 null，收到: ' + JSON.stringify(prob));
  }
  // model/runId 可选版本戳：缺省 NULL=旧调用方行为不变；重跑批次由调用方显式传 runId
  const model = (v.model === undefined || v.model === null) ? null : String(v.model);
  const runId = (v.runId === undefined || v.runId === null) ? null : String(v.runId);
  const conn = db.getConnection();
  conn.prepare('INSERT OR IGNORE INTO verdicts (prediction_id, prompt_variant, temperature, verdict_text, implied_prob, model, run_id)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(v.predictionId, v.promptVariant, v.temperature, v.verdictText.trim(), prob, model, runId);
  return conn.prepare('SELECT * FROM verdicts WHERE prediction_id = ? AND prompt_variant = ? AND temperature = ?')
    .get(v.predictionId, v.promptVariant, v.temperature);
}

/** 单点全量判词（新→旧）。 */
function listVerdictsByPrediction(pid) {
  const rows = db.getConnection().prepare('SELECT * FROM verdicts WHERE prediction_id = ? ORDER BY id ASC').all(pid);
  return rows.map(rowToVerdict);
}

module.exports = { ensureVerdictsTable, saveVerdict, listVerdictsByPrediction, PROMPT_VARIANTS, TEMPERATURES };
