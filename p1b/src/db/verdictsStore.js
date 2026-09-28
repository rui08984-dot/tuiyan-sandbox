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
 *
 * ★2026-09-29「结算后才生成」闸：leak_state（additive，**不回填**）
 *   病象不是"有一笔坏账"，是**整层语义错了**。判词这一层一直被读成"题还没结算时模型给出的
 *   倾向"，而生产库实测 5156 行判词**全部**写于其父题结算之后（父题未结算者 0 条）——
 *   也就是说这一层产出的是已揭晓题的事后读数。把读数当信号用，算出来的 Brier 量的是
 *   "模型会后见之明"，不是"模型会预判"。闸要做的是把这个事实写进数据，而不是写进注释。
 *
 *   列：`leak_state TEXT`，可空、缺省 NULL、带 CHECK 白名单。
 *   ★**历史 5156 行靠 NULL 落进 legacy 桶，源码里零 `UPDATE verdicts`**——它们是闸上线前
 *   写的，我们没核实过它们是"读数"还是别的什么，NULL 说的正是"没核实"，不是"合规"。
 *   （同 VERSION_COLUMNS 的处理：旧行 NULL 如实留空不回填。）
 *
 *   三个取值为什么这么分（它们是三句不同的断言，合成一句就是把"没核实"读成"已知合规"）：
 *     clean                   结算前生成＝这一层唯一有意义的形态，可进一切读侧；
 *     legacy_post_settlement  **明知**是结算后读数而仍要留（如 R-A 读数实验整层），
 *                             落库时自报家门，计入排除数披露；它不是脏数据，是另一种资产；
 *     quarantined             污染方式说不清、连"只是读数"都不能断言的行：任何读侧都不得收。
 *   ★`quarantined` 本轮**无任何代码路径写它**——账本不可变不许回填标记，所以它现在只是一个
 *     CHECK 白名单落点与披露桶；等真出现需要人工判定的行时再由外部显式写入。
 *
 *   三态判定的形状照 `predictionsStore.maturityState`（due/not_due/no_due_date）：
 *   每态自带一句人话 `why`，且三句互不相同——「说得清是哪一种」正是分态的全部价值。
 *   比较口径**复用既有的全时间戳字面比较**（`evidence/truthBasis.js:47` 的 `String(ra) >= String(ma)`
 *   那一款），**不用** `maturityState` 的日历日截断：按日截断会把生产库 964 行"同日但晚 5 小时"
 *   的判词判成 clean，闸在这些行上等于没装。
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

/**
 * 结算时序闸的 additive 列（2026-09-29；理由见文件头注）。
 * ★CHECK 白名单只有三个值：自由文本的"状态列"等于没有状态列——一句话就能绕过整道闸。
 *   NULL 也在白名单里（`leak_state IS NULL` 分支），因为**历史行必须能原样留下**：
 *   闸上线前写的行我们没核实过，NULL 说的正是"没核实"。
 */
const LEAK_STATE = 'leak_state';
const LEAK_STATES = ['clean', 'legacy_post_settlement', 'quarantined'];
const LEAK_COLUMNS = [
  'leak_state TEXT CHECK(leak_state IS NULL OR leak_state IN (\'clean\',\'legacy_post_settlement\',\'quarantined\'))',
];

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

/**
 * additive 补列（p13 批次0.5 迁移段抽出来的，两处共用）：
 * PRAGMA 探测缺哪列 → 事务内逐条 `ALTER TABLE ADD COLUMN`（毫秒级，锁 <5s）。
 * ★**只加列、不碰行**：旧行在新列上取默认值（本项目两处都是 NULL），因此这一步对
 *   既有行是**零字节写**——「回填」会把"闸上线前写的"改写成"闸确认过的"，那是伪造历史。
 * @param {object} conn @param {string[]} defs 列定义串（首 token = 列名）
 */
function addMissingColumns(conn, table, defs) {
  const cols = new Set(conn.prepare('PRAGMA table_info(' + table + ')').all().map((c) => c.name));
  const missing = defs.filter((def) => !cols.has(def.split(' ')[0]));
  if (!missing.length) return 0;
  const migrate = conn.transaction(() => {
    for (const def of missing) conn.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + def);
  });
  migrate();
  return missing.length;
}

/** p1b 启动/路由注册时调用一次（幂等；绝不触碰 p1a 既有表） */
function ensureVerdictsTable(conn) {
  if (!conn) throw new Error('ensureVerdictsTable: 需要 better-sqlite3 连接');
  conn.exec(SCHEMA_VERDICTS);
  // additive 迁移（p13 批次0.5，照 predictionsStore.ensurePredictionsTable 先例）：
  // 旧库缺 model/run_id → PRAGMA 检测后事务内逐条 ALTER（毫秒级，锁 <5s）；旧行两列 NULL。
  addMissingColumns(conn, 'verdicts', VERSION_COLUMNS);
  // 结算时序闸（2026-09-29 additive）：补 leak_state 列。★同样不回填——历史行落 NULL 桶。
  addMissingColumns(conn, 'verdicts', LEAK_COLUMNS);
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
    leak_state: row[LEAK_STATE] === undefined ? null : row[LEAK_STATE],
  };
}

/**
 * 结算时序三态判定（**纯函数**，零 db 零 LLM，导出供单测直接打）。
 * 形状照 `predictionsStore.maturityState`（due/not_due/no_due_date）：每态自带一句人话 `why`，
 * 且三句互不相同——「说得清是哪一种」正是分态的全部价值，合成一句就是把三种病读成同一种。
 *
 *   clean            判词生成时刻不晚于父题结算（含"父题还没结算"这一整类：没有结算可越过）
 *                    ⇒ 正常写，可进一切读侧
 *   post_settlement  父题已结算、判词却在结算之后才生成 ⇒ **拒写**。这一行表达的是
 *                    "拿着答案回头看"，落进账本就会冒充信息差信号。
 *   legacy           **明知**是结算后读数而仍要留（R-A 读数实验整层的历史口径）⇒ 放行，
 *                    但落库自报 `legacy_post_settlement` 并计入排除数披露。放行≠免费。
 *
 * 比较口径：`String(now) <= String(resolvedAt)`，**全时间戳字面比较**（与 `evidence/truthBasis.js:47`
 * 的 `String(ra) >= String(ma)` 同一款）。两侧都是 SQLite `datetime('now')` 的
 * 'YYYY-MM-DD HH:MM:SS' 文本，字典序即时序，所以**不需要**任何日期库。
 * ★不用 `maturityState` 的日历日截断：按日比较会把"同日但晚 5 小时"判成 clean
 *   （生产库 964 行属这一类）⇒ 闸在这些行上等于没装。
 *   同秒算 clean：`datetime()` 秒级分辨率，判词与结算落在同一秒是常态，按"晚"判会误伤。
 *
 * @param {{resolvedAt:string|null, now:string, exempt?:boolean}} input
 * @returns {{state:'clean'|'post_settlement'|'legacy', why:string, resolved_at:string|null, now:string}}
 */
function leakState(input) {
  const x = input || {};
  const ra = (x.resolvedAt === undefined || x.resolvedAt === null || x.resolvedAt === '') ? null : String(x.resolvedAt);
  const now = (x.now === undefined || x.now === null) ? '' : String(x.now);
  if (ra === null) {
    return {
      state: 'clean', resolved_at: null, now: now,
      why: '父题还没结算（resolved_at 为空）——此刻生成的判词正是这一层唯一有意义的形态：'
        + '它比的是"结算前你手上有什么"，而不是"事后你答对没有"',
    };
  }
  if (String(now) <= ra) {
    return {
      state: 'clean', resolved_at: ra, now: now,
      why: '判词 ' + now + ' 早于（或同于）父题结算 ' + ra + ' ⇒ 结算前生成，可进 clean 读侧',
    };
  }
  if (x.exempt === true) {
    return {
      state: 'legacy', resolved_at: ra, now: now,
      why: '判词 ' + now + ' 晚于父题结算 ' + ra + '，属结算后读数；本次为**显式豁免**（读数实验口径），'
        + '故放行但自报 legacy_post_settlement 并计入排除数披露——读侧不得把它当信息差信号',
    };
  }
  return {
    state: 'post_settlement', resolved_at: ra, now: now,
    why: '父题已于 ' + ra + ' 结算，判词到 ' + now + ' 才生成——那是拿着答案回头看，'
      + '不是对这道题的信息读数。要能写的时刻只有一个：父题结算之前',
  };
}

/**
 * 结算时序闸的读侧（一次 SELECT 取父题结算时间 ＋ **库自己的钟**）。
 * ★用库钟而不是 `new Date()`：落进行的 `created_at` 也是库钟写的，两边同钟才谈得上
 *   "行里那个 leak_state 与行里那个 created_at 自洽"；JS 钟与库钟有偏差时会写出自相矛盾的行。
 * 父题取不到 → **抛错**（判据需要父题的 resolved_at，取不到就不能判 clean）。
 * @param {number} predictionId @param {{allowPostSettlement?:boolean}} [opts]
 */
function leakStateOf(predictionId, opts) {
  const conn = db.getConnection();
  const row = conn.prepare("SELECT p.resolved_at AS resolved_at, datetime('now') AS now"
    + ' FROM predictions p WHERE p.id = ?').get(predictionId);
  if (!row) {
    throw new Error('saveVerdict: 父题不存在（prediction_id=' + predictionId
      + '）——判词没有父题就无法判结算时序，不能当 clean 放过去');
  }
  return leakState({
    resolvedAt: row.resolved_at, now: row.now,
    exempt: !!(opts && opts.allowPostSettlement === true),
  });
}

/**
 * 落一行判词（INSERT OR IGNORE 幂等：同点同路重复生成保首条，返回既有/新插入行）。
 *
 * ★结算时序闸（2026-09-29）：写前先过 `leakStateOf`。
 *   `post_settlement` → **不写**，返回 `{ok:false, reason:'post_settlement', resolved_at, now, why}`。
 *     返回体形状照 `predictionsStore.resolvePrediction` 的拒写分支（同款 `{ok:false,reason}`），
 *     路由据此映射 409（照 not_due 的文案形状）——吞成 200+空体＝状态码骗人，本项目吃过一次亏。
 *   `legacy`（显式豁免）→ 写，但落 `leak_state='legacy_post_settlement'` 并在返回值里
 *     `excluded++` 披露（照 `engines/l6_structural.js:41,66` 的 excluded++ + note 形状）。
 *
 * ⚠ `opts.allowPostSettlement` 是**唯一的**豁免口（同 `resolvePrediction` 的 `allowNotDue` 那一款），
 *   仅供读数实验批次与口径夹具。**HTTP 路由一律不得透传**——透传即等于把这道闸拆掉。
 *
 * 返回体形状：成功时返回**行本身并一个 `ok:true`**，而不是 `{ok,row}`。
 *   理由：既有调用方（scripts/ablation.cjs、routes/verdicts.js、既有测试）都直接读
 *   `.id`/`.model`/`.resolved_model`，换成 `{ok,row}` 是一次性打断；`ok` 字段让新调用方
 *   有统一的 `if (!r.ok)` 可写，两个方向都不牺牲。
 *
 * @param {{predictionId:number, promptVariant:string, temperature:number,
 *   verdictText:string, impliedProb?:number|null, model?:string|null, runId?:string|null,
 *   resolvedModel?:string|null}} v
 * @param {{allowPostSettlement?:boolean}} [opts]
 */
function saveVerdict(v, opts) {
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
  // ── 闸：先判时序，再谈落库。判据不写在这里（见 leakState）——
  const gate = leakStateOf(v.predictionId, opts);
  if (gate.state === 'post_settlement') {
    return { ok: false, reason: 'post_settlement', resolved_at: gate.resolved_at, now: gate.now, why: gate.why };
  }
  // clean 行写 'clean'；豁免行写 'legacy_post_settlement'（自报家门，不许冒充 clean）
  const leak = gate.state === 'legacy' ? 'legacy_post_settlement' : 'clean';
  conn.prepare('INSERT OR IGNORE INTO verdicts (prediction_id, prompt_variant, temperature, verdict_text, implied_prob, model, run_id, resolved_model, leak_state)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(v.predictionId, v.promptVariant, v.temperature, v.verdictText.trim(), prob, model, runId, resolvedModel, leak);
  // 返回**本批次**行（按 runId 过滤；跨批旧行不混返——批次 2-RC 烟测假象根因之二）
  const row = conn.prepare('SELECT * FROM verdicts WHERE prediction_id = ? AND prompt_variant = ? AND temperature = ?'
    + " AND COALESCE(run_id,'') = COALESCE(?, '')")
    .get(v.predictionId, v.promptVariant, v.temperature, runId === undefined || runId === null ? null : runId);
  const out = Object.assign({ ok: true }, row);
  if (gate.state === 'legacy') {
    out.excluded = 1;          // ★放行不等于免费：排除数必须跟着返回值一起走
    out.leak_note = gate.why;
  }
  return out;
}

/** 单点全量判词（新→旧）。★含未过闸的 legacy 行（不过滤，保持既有读模型形状不变）。 */
function listVerdictsByPrediction(pid) {
  const rows = db.getConnection().prepare('SELECT * FROM verdicts WHERE prediction_id = ? ORDER BY id ASC').all(pid);
  return rows.map(rowToVerdict);
}

module.exports = {
  ensureVerdictsTable, saveVerdict, listVerdictsByPrediction,
  PROMPT_VARIANTS, TEMPERATURES, VERSION_COLUMNS,
  // 结算时序闸（2026-09-29）：leakState=纯函数判定，leakStateOf=读库钟的薄壳，LEAK_STATES=CHECK 白名单
  leakState, leakStateOf, LEAK_STATES, LEAK_STATE, LEAK_COLUMNS,
};
