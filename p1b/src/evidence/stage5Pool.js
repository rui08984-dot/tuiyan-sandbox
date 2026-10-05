'use strict';
/**
 * p1b/src/evidence/stage5Pool.js —— **阶段 5 路线 (b) 冻结池谓词与指纹的单一真源**。
 *
 * 判据来源（唯一）：`docs/assets/forecast-debate/PREREG-阶段5-前瞻数值信号-v1.md` §3（八条资格谓词）
 *   ＋ 勘误件 `docs/assets/forecast-debate/PREREG-阶段5-前瞻数值信号-v1.1-补充与勘误.md`（§3 指纹填实）。
 *
 * 为何单列此文件（缺陷 D-B 的教训）：
 *   首发实验把池谓词**内联在未入库的 `.tmp` 脚本**里，且抓取失败静默 `continue` ⇒
 *   ① 池谓词无法被测试锁定；② 分块失败时样本静默截断却仍报达标（留痕 §44）。
 *   本模块把谓词**提出来**，由 `p1b/test/stage5-forecast-pool.test.cjs` 断言其指纹 == 冻结锚，
 *   并由 `p1b/scripts/stage5-forecast-signal.cjs` 引用 ⇒ 池漂移会在**跑前**被硬门拦下。
 *
 * 纪律：只导出**字符串**与**纯函数**（不在此文件做任何 db 读取/网络调用）。
 */

/** 冻结锚：PREREG §3「池＝105 道／有效配对 93 对／no_val 12 道」的 id 集合指纹。 */
const POOL_FINGERPRINT_SHA256 = '901981a5790f6b26d5be9b264f2dbb4ddc18c33bd3f6dc9f9e57a995e2b97251';
const POOL_N_AT_FREEZE = 105;
/** 有效配对（题）数与 no_val 题数（PREREG §3）。 */
const PAIRED_N_AT_FREEZE = 93;
const NO_VAL_N_AT_FREEZE = 12;

/**
 * **冻结名册**（105 个 id，升序）——实验唯一合法跑批集合。
 *
 * 为何写死名册（而非只存指纹）：谓词是**活谓词**，随账本自然增长（新题 resolve）会选到新的行。
 * 2026-09-15 当天就发生过一次：到期例行结算把池从 105 涨到 **109**（+4 条同 kind 的当日到期题）。
 * 那是**合法增长、非漂移**（去掉这 4 条后指纹仍精确命中锚），但 PREREG §6 明写「**不补样**」——
 * 冻结实验的样本必须钉死在冻结那一刻。故此处落**名册**：实验只跑名册内的 id，
 * 谓词选到名单外的行一律进 `unrostered` 披露（不参与配对、不影响判据）。
 *
 * 纪律：本数组**冻结后禁改**；要纳新样本 ⇒ 版本递进（v1.2+）并全量重跑。
 */
const POOL_ROSTER_FROZEN = [
  451, 455, 456, 459, 460, 463, 464, 467, 468, 473, 474, 475,
  476, 477, 478, 479, 480, 481, 482, 483, 484, 485, 486, 487,
  488, 489, 490, 491, 492, 493, 494, 495, 496, 497, 498, 499,
  500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511,
  512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523,
  524, 525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535,
  536, 537, 538, 539, 540, 541, 542, 543, 544, 545, 546, 547,
  548, 549, 550, 551, 552, 553, 554, 555, 556, 557, 558, 559,
  560, 561, 562, 563, 564, 565, 566, 567, 568,
];

/**
 * 资格谓词（照 PREREG §3 八条）。
 * 第 7 条「非真值口径缺陷行」的 SQL 片段与 `p1b/src/evidence/truthBasis.js` 同口径（双条件防误伤）。
 * 依赖列：p.id/p.outcome/p.matures_at/p.resolved_at/p.resolve_note/p.evidence_json。
 * @returns {string} 可直接嵌入 `WHERE` 的布尔片段
 */
function POOL_WHERE_SQL() {
  return [
    "p.g2_regime='R4'",
    "p.layer='L3'",
    "p.outcome IN ('true','false')",
    "json_extract(p.evidence_json,'$[0].resolve.kind')='openmeteo_daily_max'",
    "json_extract(p.evidence_json,'$[0].resolve.lat') IS NOT NULL",
    "json_extract(p.evidence_json,'$[0].resolve.threshold_c') IS NOT NULL",
    'p.matures_at IS NOT NULL',
    // 第 7 条：非缺陷行（与 truthBasis.js 同口径）
    '(NOT (p.resolved_at IS NOT NULL AND p.matures_at IS NOT NULL AND p.resolved_at < p.matures_at '
      + "AND (json_extract(p.evidence_json,'$[0].resolve.kind') LIKE '%forecast%' "
      + "OR p.resolve_note LIKE '%预报%' OR p.resolve_note LIKE '%forecast%')))",
  ].join('\n   AND ');
}

/** 池选取查询（列集合即实验所需字段；顺序稳定以便指纹可复现）。 */
function POOL_SQL() {
  return `SELECT p.id, p.outcome, p.matures_at, p.created_at,
  json_extract(p.evidence_json,'$[0].resolve.lat') lat,
  json_extract(p.evidence_json,'$[0].resolve.lon') lon,
  json_extract(p.evidence_json,'$[0].resolve.cmp') cmp,
  json_extract(p.evidence_json,'$[0].resolve.date') rdate,
  json_extract(p.evidence_json,'$[0].resolve.threshold_c') thr,
  json_extract(p.evidence_json,'$[0].baseRate') br,
  json_extract(p.evidence_json,'$[0].baseRateNote') brn
 FROM predictions p
 WHERE ${POOL_WHERE_SQL()}
 ORDER BY p.matures_at`;
}

/**
 * 指纹口径（勘误件 §3 明写）：id 升序去重 ⇒ `JSON.stringify` ⇒ sha256(UTF-8)。
 * @param {number[]} ids
 * @param {*} [crypto] 注入以避免顶层 require 副作用（默认 node:crypto）
 * @returns {string}
 */
function fingerprint(ids, crypto) {
  const c = crypto || require('node:crypto');
  const uniq = [...new Set(ids)].sort((a, b) => a - b);
  return c.createHash('sha256').update(JSON.stringify(uniq)).digest('hex');
}

/** 基率解析（PREREG §4 base 臂：账本 `evidence.baseRate`，回退 `baseRateNote` 的「占 X%」）。 */
function parseBaseRate(row) {
  if (row && row.br) {
    try { const s = JSON.parse(row.br); if (s && typeof s.p === 'number') return s.p; } catch (e) { /* fallthrough */ }
  }
  const m = /占\s*([\d.]+)\s*%/.exec((row && row.brn) || '');
  return m ? parseFloat(m[1]) / 100 : null;
}

/** 软概率映射（PREREG §4 写死；冻结后禁调）。 */
function softProb(fmax, threshold, isGt) {
  const raw = isGt ? 0.5 + (fmax - threshold) / 6 : 0.5 + (threshold - fmax) / 6;
  return Math.max(0.02, Math.min(0.98, raw));
}

/**
 * 把「谓词选出的行」切分为**名册内**（可跑）与**名册外**（仅披露）。
 * 名册外的新行**不进配对、不影响判据**（PREREG §6「不补样」）。
 * @param {Array<{id:number}>} rows 谓词选出的行
 * @returns {{rostered:Array, unrostered:Array<number>}}
 */
function splitByRoster(rows) {
  const set = new Set(POOL_ROSTER_FROZEN);
  const rostered = [], unrostered = [];
  for (const r of rows) { if (set.has(r.id)) rostered.push(r); else unrostered.push(r.id); }
  return { rostered, unrostered };
}

module.exports = {
  POOL_WHERE_SQL, POOL_SQL, fingerprint, parseBaseRate, softProb, splitByRoster,
  POOL_FINGERPRINT_SHA256, POOL_N_AT_FREEZE, PAIRED_N_AT_FREEZE, NO_VAL_N_AT_FREEZE,
  POOL_ROSTER_FROZEN,
};
