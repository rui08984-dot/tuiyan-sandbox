'use strict';
/**
 * 局鉴 · src/kernel/botc/wordmap.js —— BOTC 阵营/状态词表（纯数据，零依赖）
 *
 * ── 为什么从 game/botcClaims.js 搬到这里 ──────────────────────────────────
 *   这张表被**两处**消费：抽取侧要把模型吐出的词还原成谓词
 *   （kernel/botc/extractPrompt.js 的 mapBotcCarriersBack），落库侧要做分流归一
 *   （game/botcClaims.js 的 splitBotcClaims）。
 *   原来落库侧定义、抽取侧在**函数体内**惰性 require 落库模块去取——
 *   于是 kernel 里藏了一条通往存储层的边，纯度只在文件头看 require 时才成立。
 *
 *   ★这条边是我自己漏检的：第一遍体检 grep 的是 `^const ... require`，
 *     而它是缩进在函数体内的惰性 require。第一遍纯度结论下得太早。
 *     现在补三条机械检查（见 test/kernel-drift.test.cjs ④）：
 *     扫**全部** require（含函数体内）、禁存储层模块名、禁已知依赖名。
 *
 * 表的内容一个字没改——它是 BOTC 语义：血染钟楼里没有「狼阵营」，
 * 恶魔/爪牙/醉酒/中毒是四件不同的事，必须落在各自的谓词上。
 */

/** BOTC 专属谓词（走 botc_claims 私有表，与通用 claims 物理隔离）。 */
const BOTC_CLAIM_PREDICATES = ['is_demon', 'is_minion', 'status_drunk', 'status_poisoned'];

/** 角色类谓词：object 是角色名，需按剧本归一。 */
const ROLE_ASSERT_PREDICATES = ['is_role', 'claims_role'];

/**
 * 阵营/状态词 → BOTC 专属谓词。
 * ★精确全词匹配（查表，不是 includes）——防「带着爪牙走」这类长句被误伤。
 */
const BOTC_WORD_MAP = {
  恶魔: 'is_demon',
  爪牙: 'is_minion',
  醉酒: 'status_drunk',
  中毒: 'status_poisoned',
};

module.exports = {
  BOTC_CLAIM_PREDICATES,
  ROLE_ASSERT_PREDICATES,
  BOTC_WORD_MAP,
};