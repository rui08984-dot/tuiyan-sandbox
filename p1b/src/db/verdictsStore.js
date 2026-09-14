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
 *
 * 批次 2-RC 索引升级（additive）：UNIQUE 路由索引扩展 run_id——R-C「不清表+三批隔离」
 * 要求同一 (pid,variant,temperature) 可按 runId 并存多批判词（R-A NULL/R-B ca1b/R-C 各自
 * 一行）；表达式索引 COALESCE(run_id,'') 保旧幂等语义（NULL 行组内仍保首条）。
 */
const { db } = require('../deps');

const PROMPT_VARIANTS = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
const TEMPERATURES = [0.2, 0.7, 1.0];

// 版本戳两列的 additive 迁移定义（列名 = 定义串第一个 token，照 predictionsStore.AUDIT_COLUMNS 先例）
// resolved_model（2026-09-14 additive）：**生成该行时实际生效**的模型（由 llmOptions.describeEffective
//   在调用点现算，与 providers.json 实时同步）。与 model 列的分工：
//   - model          = 调用方**声明**的批次标签（如 'tokenrhythm/glm-5.3-flash'，是 prereg-a-bootstrap
//                      配对键的组成部分——**不得改动**，改格式会把同一批次拆成两个"模型"而破坏配对）；
//   - resolved_model = 事实层，回答"这行到底是谁生成的"。背景：2026-09-14 实测发现 model 列只是编排器
//                      写死的标签，与真正生效的 provider/model 脱钩 ⇒ 换供应商后行标签不变、无法验收。
//                      两列并存＝声明与事实分离，历史行 resolved_model 为 NULL（如实留空不回填）。
const VERSION_COLUMNS = ['model TEXT', 'run_id TEXT', 'resolved_model TEXT'];

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
  '  resolved_model TEXT,',
  "  created_at TEXT DEFAULT (datetime('now'))",
  ');',
  'CREATE INDEX IF NOT EXISTS idx_verdicts_pred ON verdicts(prediction_id, id);',
  // 幂等唯一索引不在本 SCHEMA 内创建（批次 2-RC：索引引用 run_id 列，必须等 ensure 内补列
  // 完成后再建——统一由 ensureVerdictsTable 末尾的索引管理段负责）
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
  // 批次 2-RC 索引管理（补列完成之后执行；索引引用 run_id 列）：
  // 旧 UNIQUE 索引（不含 run_id）→ 含 run_id 表达式索引；新库/重建表直接建新索引。
  const idxNames = new Set(conn.prepare('PRAGMA index_list(verdicts)').all().map((i) => i.name));
  const hasOld = idxNames.has('idx_verdicts_route');
  const hasNew = idxNames.has('idx_verdicts_route_run');
  if (hasOld && !hasNew) {
    const migrateIdx = conn.transaction(() => {
      conn.exec('DROP INDEX idx_verdicts_route');
      conn.exec("CREATE UNIQUE INDEX idx_verdicts_route_run ON verdicts(prediction_id, prompt_variant, temperature, COALESCE(run_id,''))");
    });
    migrateIdx();
  } else if (!hasOld && !hasNew) {
    conn.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_verdicts_route_run ON verdicts(prediction_id, prompt_variant, temperature, COALESCE(run_id,''))");
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
    resolved_model: row.resolved_model === undefined ? null : row.resolved_model,
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
  // resolved_model=实际生效模型（事实层）；缺省 NULL（旧调用方/历史行——如实留空不回填）
  const resolvedModel = (v.resolvedModel === undefined || v.resolvedModel === null) ? null : String(v.resolvedModel);
  const conn = db.getConnection();
  conn.prepare('INSERT OR IGNORE INTO verdicts (prediction_id, prompt_variant, temperature, verdict_text, implied_prob, model, run_id, resolved_model)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(v.predictionId, v.promptVariant, v.temperature, v.verdictText.trim(), prob, model, runId, resolvedModel);
  // 返回**本批次**行（按 runId 过滤；跨批旧行不混返——批次 2-RC 烟测假象根因之二）
  return conn.prepare('SELECT * FROM verdicts WHERE prediction_id = ? AND prompt_variant = ? AND temperature = ?'
    + " AND COALESCE(run_id,'') = COALESCE(?, '')")
    .get(v.predictionId, v.promptVariant, v.temperature, runId === undefined || runId === null ? null : runId);
}

/** 单点全量判词（新→旧）。 */
function listVerdictsByPrediction(pid) {
  const rows = db.getConnection().prepare('SELECT * FROM verdicts WHERE prediction_id = ? ORDER BY id ASC').all(pid);
  return rows.map(rowToVerdict);
}

module.exports = { ensureVerdictsTable, saveVerdict, listVerdictsByPrediction, PROMPT_VARIANTS, TEMPERATURES, VERSION_COLUMNS };
