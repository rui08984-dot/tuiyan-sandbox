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
 *   消费方：① `routes/intake.js` 第 -1 步·实验场域门（拒收真实局题）；
 *           ② 读侧排除谓词 `NOT_REAL_GAME_PREDICTION_SQL()`（报表侧披露排除计数）。
 *   ★**禁挂任何写库路径**（写侧加闸会确定性打红既有测试局，见边界硬规则 C1 撤回记录）。
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
 * @returns {{scope:'lab'|'real'|'unknown', family:string, basis:'source'|'game_type'|'missing', source:?string}}
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
 * SQL 片段：**非真实局行**（＝应入池）。用于 `WHERE`。
 * 依赖：`predictions` 侧别名 `p`，且必须 `LEFT JOIN games g ON g.id = p.game_id`
 *   （LEFT JOIN ⇒ 无局行的外部题 `g.*` 为 NULL ⇒ COALESCE 兜底 ⇒ 保留）。
 * 与 `classifyGame`/`classifyGameType` 同口径（口径分叉＝报表读数不可信，故测试须断言二者一致）：
 *   真实局 ⇔ `source='real'` ∨（source 未知 ∨ 缺省 ∧ game_type 非空 ∧ 不是 external ∧ 不在白名单前缀）。
 * ★2026-09-28 增补 `game_type <> 'external'` 与 `source <> 'external'`：外部题**不是真实局**，
 *   这条谓词只负责剔真实局，所以它必须留下。但它**不负责把 external 与语料分开**——
 *   分开靠的是 `classifyGame(...).scope`（'external' / 'lab' / 'real' 三值并列），
 *   任何按域聚合的读端都应当按 scope 分组，别拿本谓词当"域"。
 * @returns {string}
 */
function NOT_REAL_GAME_PREDICTION_SQL() {
  return '(NOT ('
    + "COALESCE(g.source,'') = 'real'"
    + " OR (COALESCE(g.source,'') NOT IN ('sim','corpus','external')"
    + " AND COALESCE(g.game_type,'') <> ''"
    + " AND g.game_type <> 'external'"
    + " AND g.game_type NOT LIKE 'werewolf_sim%'"
    + " AND g.game_type NOT LIKE 'corpus%')"
    + '))';
}

module.exports = {
  classifyGameType, classifyGame, isRealGame, NOT_REAL_GAME_PREDICTION_SQL,
  LAB_GAME_TYPE_PREFIXES, KNOWN_GAME_SOURCES, EXTERNAL_GAME_TYPE,
};
