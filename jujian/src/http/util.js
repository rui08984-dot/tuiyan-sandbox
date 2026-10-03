'use strict';
/**
 * 局鉴 · src/http/util.js —— 入口判据（HTTP 层唯一真源）
 *
 * 这里的每个函数只做一件事：**把「不合法的输入」变成一条说得清人话的 400**。
 * 判据放宽一行，产品就会开始编造；所以它们集中一处、逐条有名字、不允许散落。
 *
 * 与存储层（src/db/store.js）的分工：
 *   · 本层判「HTTP 请求是否成形」→ 400
 *   · 存储层判「这件事在账本上是否成立」→ 500 级错误（数据不变量被破坏）
 * 两条线不合并，因为它们对调用方的含义不同：400 是「你写错了」，500 是「我这边出事了」。
 */

/** 可建的对局类型 = 内置三型 ∪ adapters/ 目录登记 id（见 http/adapters.js）。 */
const GAME_TYPES = ['werewolf', 'botc', 'script'];
/** 单局人数上限：挡住天文数字把人当到 99 席以上（UI 与玩家心智的双重上限）。 */
const MAX_PLAYERS = 24;

const PHASES = ['night', 'day', 'dusk'];
const EVENT_TYPES = ['statement', 'vote', 'death', 'claim', 'action_reveal', 'system'];
const PREDICATES = ['is_wolf', 'is_good', 'is_role', 'claims_role', 'voted', 'did_action', 'said'];
const ACTIONS = ['vote', 'abstain', 'kill_target', 'poison_target', 'protect_target', 'check_target', 'self_explode'];
/** 这些行动必须带目标席位（弃票与自爆除外）。 */
const ACTIONS_NEED_TARGET = ['vote', 'kill_target', 'poison_target', 'protect_target', 'check_target'];

/** 带状态码的错误：路由层 throw 它，server 层统一转成对应 HTTP 响应。 */
function httpError(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

function toInt(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
}

/** 要求整数且 ≥ min，否则 400。 */
function requireInt(name, v, min) {
  const n = toInt(v);
  if (n === null || n < min) {
    throw httpError(400, name + ' 必须是 ≥' + min + ' 的整数，收到: ' + JSON.stringify(v));
  }
  return n;
}

/** 要求落在枚举里，否则把允许值一并说清 —— 报错信息本身就是使用说明。 */
function requireEnum(name, v, enums) {
  if (typeof v !== 'string' || !enums.includes(v)) {
    throw httpError(400, name + ' 必须是 ' + enums.join('|') + '，收到: ' + JSON.stringify(v));
  }
  return v;
}

function requireNonEmptyString(name, v) {
  if (typeof v !== 'string' || !v.trim()) throw httpError(400, name + ' 必须是非空字符串');
  return v.trim();
}

module.exports = {
  GAME_TYPES, MAX_PLAYERS, PHASES, EVENT_TYPES, PREDICATES, ACTIONS, ACTIONS_NEED_TARGET,
  httpError, toInt, requireInt, requireEnum, requireNonEmptyString,
};
