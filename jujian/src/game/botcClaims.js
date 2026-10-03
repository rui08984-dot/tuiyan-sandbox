'use strict';
/**
 * 局鉴 · src/game/botcClaims.js —— BOTC 专属声称：归一化、切分、CRUD
 *
 * ══ 为什么这层是重写而不是平移 ═══════════════════════════════════════════
 *   沙盘的 `p1b/src/botc/claims.js` 混着两件事：① BOTC 语义（该留在局鉴）
 *   ② 对 p1a `db` 与 `httpError` 的调用（该重写）。平移会把 p1a 的引用一起搬进来，
 *   那就等于没剥离。⇒ 语义逐条照搬，存储与报错全部改接局鉴自己的。
 *
 * ══ 它解决的真问题：BOTC 没有「狼阵营」 ═════════════════════════════════
 *   通用谓词表里有 is_wolf，但血染钟楼里根本没有狼人阵营——恶魔、爪牙、醉酒、中毒
 *   是四件不同的事。硬把「恶魔」塞进 is_wolf 会制造出一个语义上不存在的阵营，
 *   然后所有基于它的矛盾检测都建立在谎话上。
 *   ⇒ 阵营/状态走 botc_claims 私有表，与通用 claims 物理隔离，永不混用。
 */

/**
 * 三条护栏，共同的原则：**能修的不拒，只有需要人确认的才拒。**
 *   ① 阵营/状态词被硬塞进角色谓词 → 修复归入专属谓词，记 warning，不拒
 *   ② 角色名解析不出来（口误/自然语言）→ 降级 said 留痕，记 warning，不拒
 *   ③ 角色能解析但不属于本剧本 → **400 拒绝**，这是真实录入错误，须人工确认
 * 降级不是丢弃：原词一定留在 object 里，账本不丢信息。
 */

const store = require('../db/store');
const { httpError } = require('../http/util');
const roles = require('../kernel/botc/roles');
// ★局鉴改动：三张表搬进 kernel/botc/wordmap.js（纯数据）。
//   原来它们在这里定义、抽取侧在函数体内惰性 require 本模块去取，
//   于是 kernel 里藏了一条通往存储层的边。现在两侧共用同一个真源。
const { BOTC_CLAIM_PREDICATES, ROLE_ASSERT_PREDICATES, BOTC_WORD_MAP } = require('../kernel/botc/wordmap');

const BOTC_GAME_TYPE = 'botc';

/** 建 BOTC 私有表（幂等）。 */
function ensureBotcTables() { return store.ensureBotcTables(); }

/** 挂剧本（建局时调用；同局重复挂 = 改剧本，upsert 幂等）。 */
function setGameScript(gameId, script) {
  try {
    return store.setGameScript(gameId, script);
  } catch (e) {
    // 存储层抛的是带 [jujian-db] 前缀的通用错误；这里翻成 400 并说清允许值。
    throw httpError(400, e.message.replace(/^\[jujian-db\] /, ''));
  }
}

function getGameScript(gameId) { return store.getGameScript(gameId); }

/**
 * BOTC 局声称归一化 + 切分（confirm 落库前调用；入参已过通用校验）。
 * @returns {{main: Array, botc: Array, warnings: string[]}}
 *   main=通用 claims 行参｜botc=botc_claims 行参｜warnings=护栏动作留痕（逐条面向人）
 */
function splitBotcClaims(script, claims) {
  const out = { main: [], botc: [], warnings: [] };
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];

    // 已经是 BOTC 专属谓词 → 直接进私有表（object 允许为空备注）
    if (BOTC_CLAIM_PREDICATES.includes(c.predicate)) {
      out.botc.push({
        seat: c.seat, subject_seat: c.subject_seat, predicate: c.predicate,
        object: c.object === undefined || c.object === null ? '' : String(c.object).trim(),
      });
      continue;
    }

    if (ROLE_ASSERT_PREDICATES.includes(c.predicate)) {
      const rawObj = String(c.object === undefined || c.object === null ? '' : c.object).trim();

      // 护栏①：阵营/状态词被当成角色名（如 is_role(14,'恶魔')）→ 按 BOTC 语义修复归入
      if (BOTC_WORD_MAP[rawObj]) {
        out.botc.push({
          seat: c.seat, subject_seat: c.subject_seat, predicate: BOTC_WORD_MAP[rawObj], object: rawObj,
        });
        out.warnings.push('claims[' + i + ']: ' + c.predicate + '「' + rawObj
          + '」是阵营/状态词不是角色名——按 BOTC 语义归入 ' + BOTC_WORD_MAP[rawObj]
          + '（护栏①，不拒整批）');
        continue;
      }

      const role = roles.resolveRole(rawObj);

      // 护栏②：解析不出角色（口误/自然语言，如「孙子」）→ 降级 said 留痕，不丢信息
      if (!role) {
        out.main.push(Object.assign({}, c, { predicate: 'said', object: rawObj }));
        out.warnings.push('claims[' + i + ']: ' + c.predicate + '「' + rawObj
          + '」不是剧本内有效角色名——降级为 said 留痕（护栏②，不拒整批）');
        continue;
      }

      // 护栏③：能解析但越剧本 → 拒绝。这是真实录入错误，静默修复只会把错误藏起来。
      if (!roles.roleInEdition(role, script)) {
        throw httpError(400, 'claims[' + i + '].object「' + c.object + '」不属于剧本 '
          + script + '（「' + roles.roleNameZh(role) + '」属 '
          + (role.editions || []).join('/') + '）——越剧本声称须人工确认');
      }

      // 角色名归一为 id：此后账本里存的是「小恶魔」还是「evil_130」都不影响，
      // 也不因官方改名而需要迁移历史行。
      out.main.push(Object.assign({}, c, { object: role.id }));
      continue;
    }

    // 护栏③的同构情形：is_wolf 硬塞阵营词（BOTC 局无狼阵营）→ 修复归入专属谓词
    if (c.predicate === 'is_wolf') {
      const w = String(c.object === undefined || c.object === null ? '' : c.object).trim();
      if (BOTC_WORD_MAP[w]) {
        out.botc.push({
          seat: c.seat, subject_seat: c.subject_seat, predicate: BOTC_WORD_MAP[w], object: w,
        });
        out.warnings.push('claims[' + i + ']: is_wolf「' + w + '」按 BOTC 语义归入 '
          + BOTC_WORD_MAP[w] + '（BOTC 局无狼阵营，护栏③，不拒整批）');
        continue;
      }
    }

    out.main.push(c);
  }
  return out;
}

// ── botc_claims CRUD（与通用 claims 同纪律：软删 retracted，绝不物理删）──

/** 入账一批 BOTC 专属谓词声称（confirm 的事务内调用）。 */
function addBotcClaim(opts) {
  if (!opts || typeof opts !== 'object') {
    throw httpError(400, 'addBotcClaim: 参数必须为对象 {game_id,event_id,seat,subject_seat,predicate,...}');
  }
  const rows = store.addBotcClaims(opts.event_id, [{
    seat: opts.seat, subject_seat: opts.subject_seat, predicate: opts.predicate,
    object: opts.object === undefined || opts.object === null ? '' : String(opts.object),
    extracted_by: opts.extracted_by || 'llm',
    confirmed_by_user: opts.confirmed_by_user === undefined ? 0 : opts.confirmed_by_user,
  }]);
  return rows[0];
}

/** 单条（含 game_id/day/phase，供路由做归属校验；已撤回行也可见）。 */
function getBotcClaim(id) { return store.getBotcClaim(id); }

/** 局内列表（排除已撤回；uptoDay 可选，供参谋卡按天截断）。 */
function listBotcClaims(gameId, opts) { return store.listBotcClaims(gameId, opts); }

/** 软删幂等（账本纪律；行存在即 true）。 */
function retractBotcClaim(id) { return store.retractBotcClaim(id); }

/**
 * 修订 BOTC 声称。谓词合法性由表 CHECK 约束兜底——**不重复枚举**：
 * 两处枚举必然分叉，分叉之后校验就成了摆设。
 */
function updateBotcClaim(id, patch) {
  if (!patch || typeof patch !== 'object') {
    throw httpError(400, 'updateBotcClaim: patch 必须为对象');
  }
  if (patch.object !== undefined) return store.updateBotcClaimObject(id, patch.object);
  if (patch.predicate === undefined && patch.subject_seat === undefined) {
    throw httpError(400, 'updateBotcClaim: patch 至少含 predicate/subject_seat/object 之一');
  }
  throw httpError(400, 'updateBotcClaim: 局鉴只支持改备注（object）；改谓词/主语会变更语义，须撤回重录');
}

module.exports = {
  BOTC_GAME_TYPE, BOTC_CLAIM_PREDICATES, ROLE_ASSERT_PREDICATES, BOTC_WORD_MAP,
  ensureBotcTables, setGameScript, getGameScript, splitBotcClaims,
  addBotcClaim, getBotcClaim, listBotcClaims, retractBotcClaim, updateBotcClaim,
};
