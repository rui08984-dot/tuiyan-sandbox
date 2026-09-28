'use strict';
/**
 * p1b/src/evidence/labBoundary.js —— **实验场/真实对局的边界单一真源**（2026-09-27 · 边界硬规则 C2）。
 *
 * 问题：接题层（`routes/intake.js`）与预测账本（`predictions`）此前**不区分题挂在哪种局上**。
 *   真实对局（`werewolf` / `botc` …）的题与模拟局（`werewolf_sim_*`）、语料局（`corpus:*`）的题
 *   混在同一本账里 ⇒ 「预测能力」的分母被真实局污染，而真实局**没有可复核的真值锚**
 *   （`resolve` 走不到任何第三方源）⇒ 这类题天然该进拒收门，而不是进池子等结算。
 *
 * 判定口径（写死；改动＝版本递进）：
 *   1. `games.source` 列存在且取值已知（real|sim|corpus|**external**）⇒ **它权威**（`basis='source'`）。
 *      证据：`p1b/sim/sim-loop.cjs:77` 的 additive `ALTER TABLE games ADD COLUMN source`，
 *      生产库实测 source 分布 real=13 / sim=32 / corpus=45（90 局）。
 *   2. `source` 列不存在（新库 / `:memory:` 测试库）或取值未知 ⇒ 回退 `games.game_type` 前缀
 *      （`basis='game_type'`）。**新库无此列**：`p1a-terminal/src/db.js` 的 games DDL 只有
 *      id/name/game_type/player_count/created_at，source 列由 sim-loop 的 ALTER 才有。
 *      ★2026-09-28 追加：外部题容器局**自己**补这一列（`db/externalLedger.ensureExternalContainer`），
 *      补法照 sim-loop 的 additive ALTER 先例 ⇒ 已有库与新库两种形态都判得出同一个 scope。
 *   3. `game_type` 以 `werewolf_sim` 或 `corpus` 开头 ⇒ 实验场（`scope='lab'`）；
 *      **`game_type` 恰为 `external` ⇒ 外部题容器（`scope='external'`，2026-09-28 新增第三种域，
 *      必须在白名单回退**之前**命中，否则会落进 real）；
 *      **其余一切非空 game_type（含 `werewolf`、`botc`、adapter 登记的第三型）⇒ 真实局**
 *      （`scope='real'`）。白名单式而非黑名单式：新增游戏类型默认落真实局（保守）。
 *   4. 查不到局行 / `game_type` 缺省 ⇒ `scope='unknown'`，**不据此拒收**（外部题本就没有局，
 *      `intake_questions` 表无 game_id 依赖，见 `db/intakeStore.js` SCHEMA_INTAKE_QUESTIONS）。
 *      取「拒收」需确凿证据，禁把「没登记」当「是真实局」——否则四个不带 game_id 的既有调用方全被打红。
 *
 * 已知 `source` 取值未知时的处置：**回退 game_type，不静默放行**（`basis` 如实标注）。
 *
 * 纪律：纯函数（除调用方自行查库外不做任何 db 读取）；不做网络；不写任何表。
 *   消费方：① `routes/intake.js` 第 -1 步·实验场域门（拒收真实局题，`scope === 'real'`）；
 *           ② `routes/predictions.js` 的读侧披露：`GET /api/predictions/domains`
 *              （按域分组，报「其中 N 条是人手写的」）+ `/api/predictions/unresolved`
 *              与 `/api/predictions/calibration` 各自的 `by_scope` 拆分。
 *   ★**禁挂任何写库路径**（写侧加闸会确定性打红既有测试局，见边界硬规则 C1 撤回记录）。
 *
 * ★2026-09-28 改正一处**假话**（洞一）：本段原来写的是
 *     「② 读侧排除谓词 `NOT_REAL_GAME_PREDICTION_SQL()`（报表侧披露排除计数）」。
 *   实测全仓 grep（排除 node_modules/dist），那个谓词的调用点只有它自己的定义/导出
 *   ＋ 两个测试文件；**报表侧一个消费方都没有**。给一个没人用的谓词写上消费方，
 *   读者会以为"排除计数已经在报表里了"，而那时报表里根本没有域分组。
 *   ⇒ 本轮把消费方换成真接上的读侧端点，并由测试反向自证（文件头写的端点必须真的存在）。
 */

/** 实验场 game_type 前缀白名单（`werewolf_sim_6p_onenight`、`corpus:dlt` …）。 */
const LAB_GAME_TYPE_PREFIXES = ['werewolf_sim', 'corpus'];

/**
 * ★2026-09-28 新增第三种域：external（外部题容器局）。
 *
 * 【为什么必须有第三种，而不是塞进 sim/corpus】
 *   `predictions.game_id NOT NULL` ⇒ 落注必须挂一局；而外部题（天气/汇率/…）没有局。
 *   `routes/intake.js:25` 明写「外部题 resolve 后的**域容器规则待定义**，禁沿用隐式
 *   `corpus:*` 模式」——即那条路是**有意留空**的，不是漏做。
 *   本轮据此建了一个**显式**容器局（见 `db/externalLedger.js`）并在此登记成第三种 scope：
 *     · 它**不是真实局**（real）：外部题没有对局，挂 real 会被拒收门当 no_anchor 挡掉；
 *     · 它**不是实验场**（lab）：那正是"人手写的一道题"在统计上冒充
 *       那批 CLI 灌入的语料题的形状——两者混在一栏，报表再也说不清"其中 N 条是人写的"。
 *   ⇒ 任何按域／按局的读数都能靠 scope 把它单独摘出来数。
 *
 * 【与既有两种并列，不得由既有分支"顺手"命中】
 *   `classifyGameType` 是白名单式回退（非空且未命中 ⇒ real）。所以 external 必须在
 *   回退**之前**显式命中，否则它会被落进 real —— 那正是上一条说的最坏结果。
 *
 * ⚠ **本条是依据 `intake.js:25` 做的实现裁定，不是创始人拍板**（域容器规则本就待定）。
 *   需创始人复核：外部题是否该有自己的域，还是该继续留在 intake 层不入 predictions 账。
 */
const EXTERNAL_GAME_TYPE = 'external';

/** `games.source` 已知取值 → scope。未列出的取值视为「未知 ⇒ 回退 game_type」。 */
const KNOWN_GAME_SOURCES = { real: 'real', sim: 'lab', corpus: 'lab', external: 'external' };

/**
 * ★域的全集（2026-09-28，读侧分组用）。**四值互斥且穷尽** ⇒ 各域计数之和恒等于总数。
 *   写死在这里是为了让读端能"按全集开桶"（含 0 计数照报），而不是只报碰巧非空的那些域
 *   ——只报非空的域，读者无法判断"这个域是 0 条"还是"这个域根本没查"。
 * ⚠ 新增第四种域时**只改这一处**：`classifyGameType`（加精确值分支）与
 *   `PREDICTION_SCOPE_SQL`（加 CASE 分支）必须同步，否则口径分叉。
 *   `external-domain-views.test.cjs` 的"逐 games 行比对"就是盯这两处同步的。
 */
const SCOPES = ['real', 'lab', 'external', 'unknown'];

/**
 * game_type → 域归属。
 * @param {string|null|undefined} gameType games.game_type（可空）
 * @returns {{scope:'lab'|'real'|'external'|'unknown', family:string, basis:'prefix'|'exact'|'missing'}}
 *   family = 命中的白名单前缀（未命中为空串）；basis = 判定依据（供 detail 留痕）
 */
function classifyGameType(gameType) {
  const gt = gameType === undefined || gameType === null ? '' : String(gameType).trim();
  if (!gt) return { scope: 'unknown', family: '', basis: 'missing' };
  // ★先判 external：它是**精确值**不是前缀，且必须在白名单回退之前命中，
  //   否则会落进 real（见上面那段"为什么必须是第三种"）。
  if (gt === EXTERNAL_GAME_TYPE) return { scope: 'external', family: EXTERNAL_GAME_TYPE, basis: 'exact' };
  for (const p of LAB_GAME_TYPE_PREFIXES) {
    if (gt.indexOf(p) === 0) return { scope: 'lab', family: p, basis: 'prefix' };
  }
  return { scope: 'real', family: '', basis: 'prefix' };
}

/**
 * games 行 → 域归属（source 列优先，其次 game_type）。
 * @param {object|null} row games 行（`SELECT * FROM games WHERE id=?` 的行；无 source 列时 row.source 为 undefined）
 * @returns {{scope:'lab'|'real'|'external'|'unknown', family:string, basis:'source'|'game_type'|'missing', source:?string}}
 */
function classifyGame(row) {
  if (!row) return { scope: 'unknown', family: '', basis: 'missing', source: null };
  const src = row.source === undefined || row.source === null ? '' : String(row.source).trim();
  if (src && KNOWN_GAME_SOURCES[src] !== undefined) {
    return { scope: KNOWN_GAME_SOURCES[src], family: '', basis: 'source', source: src };
  }
  const gt = classifyGameType(row.game_type);
  return { scope: gt.scope, family: gt.family, basis: gt.basis === 'missing' ? 'missing' : 'game_type', source: src || null };
}

/** 行式真值判定（`true` = 真实对局）。`!row` ⇒ false（查不到局不禁作真实局判）。 */
function isRealGame(row) {
  return classifyGame(row).scope === 'real';
}

/**
 * SQL 片段：**一条 predictions 行属于哪个域**（四值互斥，见 `SCOPES`）。用于 `SELECT … GROUP BY`。
 *
 * 【为什么必须有这一段 SQL，而不能"把行取回 JS 再 classifyGame"】
 *   读侧要的是**计数**（"其中 N 条是人手写的"）。要计数就得在 SQL 里分组，
 *   而一旦在 SQL 里分组，这份判定就有了第二份实现 —— 口径分叉＝报表读数不可信。
 *   ⇒ 本函数是 `classifyGame` 的**镜像**而不是**另写一套**：分支顺序逐条对着上面
 *     `classifyGame` / `classifyGameType` 的判定顺序写（source 权威 → external 精确值 →
 *     白名单前缀 → 其余非空即 real → 空即 unknown），连 `TRIM` 都照抄
 *     （`classifyGameType` 对入参 `String(x).trim()`，SQL 侧不 TRIM 就会出现"JS 判 lab、
 *     SQL 判 real"这种只在带空白的行上才发作的分叉）。
 *   测试 `external-domain-views.test.cjs`「域分组在 SQL 侧与 classifyGame 同源」逐行比对，
 *   就是为了让这两个实现**没法各自漂走**。
 *
 * ★`opts.hasSource` 必须由调用方传：**SQLite 在 prepare 期就解析列名**，
 *   所以库上没有 `games.source` 这一列时，写死 `COALESCE(g.source,'')` 会直接
 *   `SqliteError: no such column: g.source` —— COALESCE **救不了**缺列（这点极易误诊为 SQL 写错）。
 *   而"没有这一列"是**常态而非边角**：`p1a-terminal/src/db.js` 的 games DDL 里没有它，
 *   它由 `sim-loop.cjs:77` / `db/externalLedger.ensureSourceColumn` 的 additive ALTER 才有。
 *   传 `hasSource:false` 时整段 source 分支被拿掉，只按 game_type 判 ——
 *   那正是 `classifyGame` 读到 `row.source === undefined` 时走的同一条回退路（文件头第 2 条）。
 *   （附带修掉一个潜伏缺陷：旧的 `NOT_REAL_GAME_PREDICTION_SQL` 同样硬写了这一列，
 *     在无 source 列的库上一用就炸；它此前零生产调用，所以从没被触发过。）
 *
 * 依赖：`games` 侧别名（默认 `g`）。调用方须 `LEFT JOIN games g ON g.id = p.game_id`
 *   （LEFT JOIN ⇒ 无局行的行 `g.*` 全 NULL ⇒ COALESCE 兜底 ⇒ 落 'unknown'，不当作 real）。
 * @param {string} [gameAlias] games 侧别名（默认 'g'）
 * @param {{hasSource?:boolean}} [opts] `hasSource:false` = 库上没有 games.source 列
 * @returns {string} `CASE … END`，取值 ∈ SCOPES，**恒非 NULL**（有 ELSE）
 */
function PREDICTION_SCOPE_SQL(gameAlias, opts) {
  const g = gameAlias || 'g';
  const hasSource = !(opts && opts.hasSource === false);
  const src = "TRIM(COALESCE(" + g + ".source,''))";
  const gt = "TRIM(COALESCE(" + g + ".game_type,''))";
  const srcBranches = hasSource
    // ① source 列已知且取值已知 ⇒ 权威（与 classifyGame 的 KNOWN_GAME_SOURCES 同一张表）
    ? (" WHEN " + src + " = 'real' THEN 'real'"
      + " WHEN " + src + " = 'external' THEN 'external'"
      + " WHEN " + src + " IN ('sim','corpus') THEN 'lab'")
    : '';
  return "CASE" + srcBranches
    // ② game_type 缺省 ⇒ unknown（**不据此判真实局**：取「拒收」需确凿证据）
    + " WHEN " + gt + " = '' THEN 'unknown'"
    // ③ external 是精确值且必须先于白名单（否则会落进 lab/real，见文件头那段）
    + " WHEN " + gt + " = 'external' THEN 'external'"
    // ④ 实验场白名单前缀（LAB_GAME_TYPE_PREFIXES 的 SQL 镜像）
    + " WHEN " + gt + " LIKE 'werewolf_sim%' OR " + gt + " LIKE 'corpus%' THEN 'lab'"
    // ⑤ 其余一切非空 game_type ⇒ 真实局（白名单式而非黑名单式：新增游戏默认落 real）
    + " ELSE 'real' END";
}

/**
 * SQL 片段：**非真实局行**（＝应入池）。用于 `WHERE`。
 *
 * ★2026-09-28 改为**由 `PREDICTION_SCOPE_SQL` 派生**（原来是一份手写的独立布尔式）。
 *   为什么必须派生：这份谓词和域分组回答的是同一个问题（"这条题算不算真实局"），
 *   写成两处独立实现，就等于给"口径分叉"留了一个永久入口 —— 而分叉的两种后果
 *   方向相反（一份说 real 一份说 lab：要么把外部题当真实局剔掉，要么把真实局题放进来），
 *   任一种都会让"其中 N 条是人手写的"这句话失去意义。
 *   派生后，"剔真实局"在结构上就是"域 ≠ real"，两者永远一致。
 *   （行为差异有两处，都朝"更准"的方向：① game_type 带前后空白时（如 `' corpus:dlt '`）
 *     旧写法 `g.game_type NOT LIKE 'corpus%'` 会判成真实局把它剔掉，而 `classifyGame` 先 TRIM
 *     判 lab —— 派生后两者一致；② 库上没有 source 列时旧写法直接抛错，派生后按 game_type 走。
 *     既有测试用的都是无空白行且带 source 列，口径不变。）
 *
 * 依赖：`predictions` 侧别名 `p`，且必须 `LEFT JOIN games g ON g.id = p.game_id`。
 * ⚠ 它只回答"剔不剔真实局"；**按域分组请用 `PREDICTION_SCOPE_SQL`**，别拿本谓词当"域"。
 * @param {string} [gameAlias] games 侧别名（默认 'g'）
 * @param {{hasSource?:boolean}} [opts] 透传给 PREDICTION_SCOPE_SQL
 * @returns {string}
 */
function NOT_REAL_GAME_PREDICTION_SQL(gameAlias, opts) {
  return '(' + PREDICTION_SCOPE_SQL(gameAlias, opts) + " <> 'real')";
}

module.exports = {
  classifyGameType, classifyGame, isRealGame, NOT_REAL_GAME_PREDICTION_SQL, PREDICTION_SCOPE_SQL,
  LAB_GAME_TYPE_PREFIXES, KNOWN_GAME_SOURCES, EXTERNAL_GAME_TYPE, SCOPES,
};
