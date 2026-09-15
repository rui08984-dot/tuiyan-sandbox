'use strict';
/**
 * p1b/src/evidence/domain.js —— **域（domain）派生的单一真源**。
 *
 * 依据：`docs/specs/2026-09-11-万物可预测性审计器-design.md` §4.2.5 A 轴（R4.4）：
 *   「**域＝题源 kind 族，取 `evidence[0].kind` 前缀归一**」；实现落点「`g2-report.cjs` ② 节增域分布披露
 *   （additive，不改主判据）；审计清单 meta 增 `domain_key` 字段」
 *   ＋ 路线图阶段 4 出口原文：「出口＝**分域**带校准分数的预测能力，每域拿数据说话」。
 *
 * 为何单列此文件：域此前只实现在 `g2-report.cjs` 内部（#12 域分布披露）。阶段 4 的**分域读数**
 * 需要同一口径 ⇒ 收敛为一份，两处委托，**禁各写一套**（同 `baseRate.js` 范式）。
 *
 * 派生规则（写死；改动＝版本递进）：
 *   1. 优先 `evidence[0].resolve.kind` 的**前缀**（第一个 `_` 之前）——如
 *      `openmeteo_air_pm10_daily_mean` → `openmeteo`。
 *   2. kind 缺 → 退 `evidence[0].kind` 前缀（题源批类型，如 `b4_forward` → `b4`）。
 *   3. 仍缺 → 对局域：`games.game_type`（如 `werewolf_sim_6p_onenight`）⇒ 归 `werewolf_sim`。
 *      （L1/L6 的狼人杀题没有 `resolve.kind`，其域就是**对局域**。）
 *   4. 全缺 → `(unknown)`（**如实标注**，禁静默丢弃）。
 *
 * 纪律：纯函数；不做 db 读取、不做网络。
 */

/** 对局域前缀归一（`werewolf_sim_6p_onenight` → `werewolf_sim`）。 */
const GAME_TYPE_PREFIX = { werewolf_sim: 'werewolf_sim', werewolf: 'werewolf_real', botc: 'botc' };

/**
 * @param {object} opts
 * @param {object|null} opts.resolve    evidence[0].resolve（可空）
 * @param {string|null} opts.evKind     evidence[0].kind（题源批类型，可空）
 * @param {string|null} opts.gameType   games.game_type（可空）
 * @returns {{domain:string, basis:string}} basis ∈ {resolve_kind, evidence_kind, game_type, none}
 */
function deriveDomain(opts) {
  const o = opts || {};
  const kind = o.resolve && o.resolve.kind ? String(o.resolve.kind) : null;
  if (kind) return { domain: prefixOf(kind), basis: 'resolve_kind' };
  const ek = o.evKind ? String(o.evKind) : null;
  if (ek) return { domain: prefixOf(ek), basis: 'evidence_kind' };
  const gt = o.gameType ? String(o.gameType) : null;
  if (gt) {
    for (const k of Object.keys(GAME_TYPE_PREFIX)) if (gt.indexOf(k) === 0) return { domain: GAME_TYPE_PREFIX[k], basis: 'game_type' };
    return { domain: prefixOf(gt), basis: 'game_type' };
  }
  return { domain: '(unknown)', basis: 'none' };
}

/** 第一个 `_` 之前；无 `_` 则原样。 */
function prefixOf(s) {
  const i = String(s).indexOf('_');
  return i > 0 ? String(s).slice(0, i) : String(s);
}

module.exports = { deriveDomain, prefixOf, GAME_TYPE_PREFIX };
