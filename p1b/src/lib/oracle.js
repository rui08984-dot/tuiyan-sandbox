'use strict';
/**
 * p1b/src/lib/oracle.js —— 对局玄学化判词「确定性起卦派生」（P2 线 W1）。
 *
 * 边界铁律（拍板 #3，写死在代码里）：
 *   本模块只做「纯数学排盘」（架构口径 docs/specs/2026-09-07-推演沙盘-design.md §2.3）。
 *   「梅花查狼」实验（docs/sandbox/p2-yijing/oracle-experiment-result.md）已证判词
 *   无任何游戏研判效力 → 本功能是赛后娱乐彩蛋，输出恒挂「娱乐参考」标注，
 *   绝不接入任何游戏研判功能；本模块返回值禁止被参谋/研判类模块引用。
 *
 * 确定性口径（自定，写死于此注释；要求：同局输入永远同卦，零用户操作）：
 *   输入 = games 表一行投影 {id, game_type|type, created_at, player_count}。
 *   created_at 是 SQLite datetime('now') 文本（UTC 'YYYY-MM-DD HH:MM:SS'，建局后不变），
 *   本模块把它当不透明字符串用（不 Date.parse，避免时区/平台差异）。
 *   两数派生（FNV-1a 32bit，字段拼接顺序写死）：
 *     数A（上卦数）= fnv1a(id + '|' + type + '|' + created_at) % 512 + 1   → 1..512
 *     数B（下卦数）= fnv1a(player_count + '|' + created_at + '|' + id) % 512 + 1
 *   取 1..512：足够覆盖 8×8×6 的全卦象空间，又避免超大数字进起卦。
 *   两数交给 meihua.qiGuaByNumbers（先天八卦数：上卦 A%8 余0取8，下卦 B%8 余0取8，
 *   动爻 (A+B)%6 余0取6）→ 本卦/互卦/变卦/动爻/体用/五行生克全套。
 *   注意：这是「本局数据哈希派生」口径，不是传统年月日时起卦——拍板 #2 要求
 *   本局数据自动派生、零用户操作，故取哈希而非时间起卦；确定性即唯一硬约束。
 */
const path = require('path');
const meihua = require(path.join(__dirname, 'meihua.js'));

/** 恒挂标注（拍板 #3）：API disclaimer 字段的唯一来源 */
const DISCLAIMER = '娱乐参考';

/**
 * FNV-1a 32bit（公开测试向量：fnv1a('')===0x811c9dc5，fnv1a('a')===0xe40c292c）。
 * 纯字符串 → 无符号 32 位整数，逐字节异或后乘素数 16777619（用移位加实现，JS 数值精度内精确）。
 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

function requirePositiveInt(v, label) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError('deriveCasting: ' + label + ' 必须是 ≥1 的整数，收到: ' + JSON.stringify(v));
  }
  return n;
}

/**
 * 从本局数据确定性派生两数并起卦。同局（同 id/type/created_at/player_count）永远同一卦。
 * @param {object} game games 表行（id/game_type/player_count/created_at；兼容 type 别名）
 * @returns {object} casting = meihua 起卦全套（本卦/互卦/变卦/动爻/体用/五行生克）
 *                   + numbers{a,b}（派生两数，留档可解释）+ derived_from（输入投影）
 */
function deriveCasting(game) {
  if (!game || typeof game !== 'object') {
    throw new TypeError('deriveCasting: game 必须是对象');
  }
  const id = requirePositiveInt(game.id, 'game.id');
  const type = String(game.game_type !== undefined ? game.game_type : game.type || '');
  const createdAt = String(game.created_at === undefined || game.created_at === null ? '' : game.created_at);
  const playerCount = requirePositiveInt(game.player_count, 'game.player_count');
  if (!type) throw new TypeError('deriveCasting: game.type 不能为空');
  if (!createdAt) throw new TypeError('deriveCasting: game.created_at 不能为空');

  const a = fnv1a(id + '|' + type + '|' + createdAt) % 512 + 1;
  const b = fnv1a(playerCount + '|' + createdAt + '|' + id) % 512 + 1;
  const casting = meihua.qiGuaByNumbers(a, b); // 非法数会在此抛错（meihua 自校验）
  return Object.assign({}, casting, {
    numbers: { a: a, b: b },
    derived_from: { id: id, type: type, created_at: createdAt, player_count: playerCount },
  });
}

/**
 * MOCK 断语：固定模板（零网络、确定性、含卦名+娱乐参考字样）。
 * 只用 casting 里确定性字段拼装，绝不做任何吉凶研判暗示 beyond 娱乐话术。
 */
function mockVerdict(casting) {
  return '【' + casting.benGua.fullName + ' · 第' + casting.dongYao + '爻动】'
    + casting.ti.trigram + '（' + casting.ti.wuXing + '）为体，' + casting.yong.trigram
    + '（' + casting.yong.wuXing + '）为用，' + casting.tiYongRelation + '，势将变向「'
    + casting.bianGua.fullName + '」。卦是死的局是活的，胜负在桌上不在卦里——娱乐参考，一乐足矣。';
}

module.exports = { deriveCasting, mockVerdict, fnv1a, DISCLAIMER };
