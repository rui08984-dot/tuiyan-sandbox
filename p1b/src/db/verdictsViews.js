'use strict';
/**
 * p1b/src/db/verdictsViews.js —— 判词读侧收口（2026-09-29 判词层口径改造）
 *
 * 【为什么要有这个文件】
 *   判词这一层的语义刚被改对：判词只有在**父题结算之前**生成，才是"结算前你手上有什么"
 *   的读数；结算之后生成的，那是拿着答案回头看（`db/verdictsStore.js` 头注有实测数据：
 *   生产库 5156 行判词全部晚于其父题结算）。列与写闸在 verdictsStore，这里管读侧。
 *
 * 【为什么不逐个改 30 个读侧站点的 SQL】
 *   判词的 SELECT 散在 scripts/ 与引擎接线里（实测 41 个文件 73 处 `FROM verdicts`）。
 *   逐个改 = 一次改动碰 41 个文件，且下次再加一道口径闸还得再来一遍。
 *   ⇒ 建一个**只收 clean 行**的视图，读侧站点只需把 `FROM verdicts` 换成 `FROM verdicts_clean`。
 *   视图建法照 `db/intakeStore.js` 的 `predictions_r4` / `predictions_public`（`CREATE VIEW IF NOT EXISTS`，
 *   列显式列出、additive、幂等）；本视图用 `v.*` 是因为判词表是本层私有表、列形状由本层自管，
 *   换 `SELECT v.*` 是为了**加列时读侧不必重建视图**（改列清单会把既有视图钉死在旧形状上）。
 *
 * ★**排除数必须与读数一起返回**（`leakDisclosure` / `listVerdictsClean`）：
 *   照 `engines/l6_structural.js:41,66` 的 excluded++ 披露纪律——"从视图里消失了"这件事
 *   本身就是要告知的事实，静默过滤等于把"这一层一半的行不能用"说成"这一层就这些行"。
 *   三桶分开计数是因为它们是三句不同的断言（同 verdictsStore 头注）：
 *     legacy_unknown            leak_state IS NULL：闸上线前写的行，**没核实过**（生产库 5156 行全在此桶）
 *     legacy_post_settlement    明知是结算后读数而显式豁免留存的行
 *     quarantined               污染方式说不清、任何读侧都不得收的行（本轮无路径写它，见头注）
 *   合成一个数字会把"没核实"读成"已知合规"。
 */
const { db } = require('../deps');

/** 只收 clean 行的读侧视图（NULL 与两个 legacy 态自然落选，不需额外条件）。 */
const VERDICTS_CLEAN_SQL = [
  'CREATE VIEW IF NOT EXISTS verdicts_clean AS',
  'SELECT v.* FROM verdicts v',
  "WHERE v.leak_state = 'clean';",
].join('\n');

/**
 * 建视图（幂等 additive；须在 `ensureVerdictsTable` 之后调用——列先于视图）。
 * 视图必须是**视图**而不是表：表会变成第二个要维护的副本，而这一层正在被加口径闸。
 */
function ensureVerdictsCleanView(conn) {
  if (!conn) throw new Error('ensureVerdictsCleanView: 需要 better-sqlite3 连接');
  conn.exec(VERDICTS_CLEAN_SQL);
}

/**
 * 排除数披露（读侧配套；`pid` 缺省＝全表）。
 * @param {number|null} [pid]
 * @returns {{rows_total:number, clean:number, legacy_unknown:number, legacy_post_settlement:number,
 *   quarantined:number, total_excluded:number, note:string}}
 */
function leakDisclosure(pid) {
  const scoped = (pid !== undefined && pid !== null);
  const stmt = db.getConnection().prepare('SELECT COUNT(*) AS total,'
    + " SUM(CASE WHEN leak_state = 'clean' THEN 1 ELSE 0 END) AS clean,"
    + ' SUM(CASE WHEN leak_state IS NULL THEN 1 ELSE 0 END) AS unk,'
    + " SUM(CASE WHEN leak_state = 'legacy_post_settlement' THEN 1 ELSE 0 END) AS post,"
    + " SUM(CASE WHEN leak_state = 'quarantined' THEN 1 ELSE 0 END) AS quar"
    + ' FROM verdicts' + (scoped ? ' WHERE prediction_id = ?' : ''));
  const c = scoped ? stmt.get(pid) : stmt.get();
  const rows_total = Number(c && c.total) || 0;
  const clean = Number(c && c.clean) || 0;
  const legacy_unknown = Number(c && c.unk) || 0;
  const legacy_post_settlement = Number(c && c.post) || 0;
  const quarantined = Number(c && c.quar) || 0;
  const total_excluded = legacy_unknown + legacy_post_settlement + quarantined;
  return {
    rows_total: rows_total, clean: clean,
    legacy_unknown: legacy_unknown, legacy_post_settlement: legacy_post_settlement,
    quarantined: quarantined, total_excluded: total_excluded,
    note: total_excluded === 0 ? '' : disclosureText(legacy_unknown, legacy_post_settlement, quarantined, total_excluded),
  };
}

/** 披露文案（纯函数，可单测）。**只在真的有排除时给**——没有排除就没有"少了多少"可说。 */
function disclosureText(unk, post, quar, total) {
  const parts = [];
  if (unk) parts.push('闸上线前写的历史行 ' + unk + ' 条（未核实，不当作合规）');
  if (post) parts.push('显式豁免的结算后读数 ' + post + ' 条');
  if (quar) parts.push('隔离行 ' + quar + ' 条');
  return '已排除 ' + total + ' 条不进 clean 读侧：' + parts.join('；')
    + '。它们不是被删掉了——账本不可变，账本里原样留着，只是读侧不收，且数量在此如实报出。';
}

/**
 * 读侧收口：只返 clean 行，且与排除数一起返回。
 * 与 `listVerdictsByPrediction` 的区别是**这一条会过滤**（那里保持原样不动，
 * 因为改它的返回形状会打断既有读端点）。
 * @param {number} pid
 * @returns {{items:object[], excluded:number, disclosure:object, note:string}}
 */
function listVerdictsClean(pid) {
  const rows = db.getConnection().prepare('SELECT * FROM verdicts_clean WHERE prediction_id = ? ORDER BY id ASC').all(pid);
  const disclosure = leakDisclosure(pid);
  return {
    items: rows, excluded: disclosure.total_excluded, disclosure: disclosure, note: disclosure.note,
  };
}

module.exports = {
  ensureVerdictsCleanView, leakDisclosure, listVerdictsClean, disclosureText, VERDICTS_CLEAN_SQL,
};
