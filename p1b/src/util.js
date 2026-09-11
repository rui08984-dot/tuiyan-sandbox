'use strict';
/**
 * p1b/src/util.js —— 小工具：HTTP 错误构造 / 整数与枚举校验。
 * 枚举唯一来源 = p1a-terminal/src/llm.js 导出的常量（引擎复用，不另立魔法字符串）。
 */
const { llm } = require('./deps');

const GAME_TYPES = ['werewolf', 'botc', 'script'];
const PHASES = llm.PHASES;
const PREDICATES = llm.PREDICATES;
const ACTIONS = llm.ACTIONS;
const ACTIONS_NEED_TARGET = ['vote', 'kill_target', 'poison_target', 'protect_target', 'check_target'];
const EVENT_TYPES = llm.EVENT_TYPES;

function httpError(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

function toInt(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
}

/** 要求整数且 ≥ min，否则抛 400 */
function requireInt(name, v, min) {
  const n = toInt(v);
  if (n === null || n < min) throw httpError(400, name + ' 必须是 ≥' + min + ' 的整数，收到: ' + JSON.stringify(v));
  return n;
}

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
  GAME_TYPES, PHASES, PREDICATES, ACTIONS, ACTIONS_NEED_TARGET, EVENT_TYPES,
  httpError, toInt, requireInt, requireEnum, requireNonEmptyString,
};
