'use strict';
/**
 * p1b/src/db/externalLedger.js —— **外部题容器局**（2026-09-28 · 显式容器，非隐式 `corpus:*`）
 *
 * 【为什么需要它】
 *   `predictions.game_id INTEGER NOT NULL REFERENCES games(id)`（predictionsStore.js:45）
 *   ⇒ 任何落注都必须挂一局。而「记一笔」收的是**外部题**（天气/汇率/开奖…），
 *   它们没有对局，`games` 里也就没有它们那一行。
 *   `routes/intake.js:25` 把这件事写成了待定项：
 *     「本轮**不自动落 predictions**（外部题 resolve 后的**域容器规则待定义**，
 *       禁沿用隐式 `corpus:*` 模式）」
 *   ⇒ 此前"账本里没有外部题"是**有意的留空**，不是漏做。本文件是那条例外被填上。
 *
 * 【为什么是"一个显式容器局"，不是别的两种做法】
 *   ① 不改 `game_id` 为可空：那是对账本表做结构变更（1994 行、账本不可变、
 *      `game_id` 在建表串里），SQLite 改可空要整表重建，风险远超本轮该付的。
 *   ② 不塞进 `corpus:*`：`intake.js:25` 明令禁的正是"隐式 corpus 模式"——
 *      而危害是实的：人手写的一道题会与那批 CLI 灌入的语料题同栏，
 *      报表再也说不清"其中 N 条是人写的"，而这正是 P0-5 要消灭的那种混淆。
 *   ⇒ 建**一个**看得见的容器局，`games.source='external'`、`game_type='external'`，
 *     并在 `evidence/labBoundary.js` 登记成第三种 scope（real / lab / external）。
 *     它不是真实局（挂 real 会被拒收门当 no_anchor 挡掉），也不是实验场。
 *
 * 【写侧范式：照既有先例，不另立】
 *   games 行的创建照 `p1a-terminal/src/db.js:172 createGameCore`（INSERT 后 SELECT 回读）。
 *   `source` 列的补法照 `p1b/sim/sim-loop.cjs:77` 的 **additive ALTER**
 *   （新库/`:memory:` 测试库没有这一列，见 labBoundary.js 文件头第 2 条）。
 *   唯一与 createGameCore 的差别：**不建席**。容器局不是对局，没有座位可言；
 *   建 1..N 个「1号…N号」席位进去只会让读端误以为那是个可开局的对局。
 *
 * 【幂等与唯一性】
 *   `ensureExternalContainer` 可反复调用，全库**恰好一个**容器局（按 game_type 精确匹配）。
 *   已存在多于一个时**如实抛错**而不是默默挑一个：多出来的那个意味着有人手工建过，
 *   默默挑一个等于让"哪些题算外部题"变得不可复现。
 *
 * 纪律：additive、幂等；只写 games（不碰 predictions / p1a 既有列）；不建网络调用。
 *   ⚠ **本件是依据 `intake.js:25` 做的实现裁定，不是创始人拍板**（域容器规则本就待定），
 *     需创始人复核：外部题是否该有自己的域，还是该继续留在 intake 层不入 predictions 账。
 */
const { db } = require('../deps');
const lab = require('../evidence/labBoundary');

/** 容器局的 game_type（与 labBoundary.EXTERNAL_GAME_TYPE 同源，单一真源在那儿）。 */
const EXTERNAL_GAME_TYPE = lab.EXTERNAL_GAME_TYPE;
/** 容器局的名字。**要人一眼看懂它不是对局** —— 报表上按局分组时会直接看到这个名字。 */
const CONTAINER_NAME = '外部题（容器局 · 非对局）';
/** 席位一律 1：容器局无对局语义，但仍要满足 games.player_count 的 NOT NULL/取值域。 */
const CONTAINER_PLAYERS = 1;

/** games 是否有 source 列（无则 additive 补，照 sim-loop.cjs:77 先例）。 */
function ensureSourceColumn(conn) {
  const cols = conn.pragma('table_info(games)').map((c) => c.name);
  if (cols.indexOf('source') === -1) conn.exec('ALTER TABLE games ADD COLUMN source TEXT');
}

/**
 * 取（必要时建）唯一的外部题容器局。
 * @param {object} [conn] better-sqlite3 连接（默认取 deps 的当前连接）
 * @returns {{id:number, name:string, game_type:string, source:?string, created:boolean}}
 */
function ensureExternalContainer(conn) {
  const c = conn || db.getConnection();
  const rows = c.prepare('SELECT id, name, game_type FROM games WHERE game_type = ?').all(EXTERNAL_GAME_TYPE);
  if (rows.length > 1) {
    // 不默默挑一个：多出来的那个意味着有人手工建过，"哪些题算外部题"会变得不可复现
    throw new Error('外部题容器局必须全库恰好一个，实得 ' + rows.length + ' 个（id='
      + rows.map((r) => r.id).join(',') + '）——请先人工确认哪个是容器局，多余的删掉');
  }
  if (rows.length === 1) {
    return Object.assign({}, rows[0], { source: EXTERNAL_GAME_TYPE, created: false });
  }
  // 照 createGameCore（p1a db.js:172）：INSERT 后 SELECT 回读，不自己拼 id
  ensureSourceColumn(c);
  const info = c.prepare('INSERT INTO games (name, game_type, player_count, source) VALUES (?,?,?,?)')
    .run(CONTAINER_NAME, EXTERNAL_GAME_TYPE, CONTAINER_PLAYERS, EXTERNAL_GAME_TYPE);
  const row = c.prepare('SELECT id, name, game_type FROM games WHERE id=?').get(info.lastInsertRowid);
  return Object.assign({}, row, { source: EXTERNAL_GAME_TYPE, created: true });
}

/**
 * 只读体检：全库容器局清单（供"恰好一个"这条纪律被外部命令复查，不靠测试自证）。
 * @returns {{ok:boolean, count:number, ids:number[], scope:string, note:string}}
 */
function inspectExternalContainer(conn) {
  const c = conn || db.getConnection();
  const rows = c.prepare('SELECT id, name FROM games WHERE game_type = ?').all(EXTERNAL_GAME_TYPE);
  return {
    ok: rows.length === 1,
    count: rows.length,
    ids: rows.map((r) => r.id),
    scope: lab.classifyGameType(EXTERNAL_GAME_TYPE).scope,
    note: rows.length === 1
      ? '容器局唯一，scope=' + lab.classifyGameType(EXTERNAL_GAME_TYPE).scope
        + '（既不是 real 也不是 lab ⇒ 报表里能与真实局、语料局分开数）'
      : '容器局数量为 ' + rows.length + '，必须恰好一个（多出来的多半是有人手工建过）',
  };
}

module.exports = {
  ensureExternalContainer, inspectExternalContainer,
  EXTERNAL_GAME_TYPE, CONTAINER_NAME, ensureSourceColumn,
};
