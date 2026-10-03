'use strict';
/**
 * p1b/src/macros.js —— P1B-SPEC §4 三宏（跳身份/查杀/金水）。
 * 铁律：直接结构化构造，不走 LLM；产出的待确认卡与自由文本抽取同构
 *（同 PendingCard 形状），confirmed 后与自由文本走同一入库路径（/events/confirm）。
 * object 命名与 p1a llm.js mock/真实抽取约定逐字对齐：
 *   跳身份 → claims_role + 角色名；查杀 → is_wolf + "查杀"；金水 → is_good + "好人"。
 */
const { httpError, requireInt, requireNonEmptyString, PHASES } = require('../http/util');

const MACRO_KINDS = ['claim_role', 'check', 'good'];

/**
 * 构造宏待确认卡。
 * @param {object} body {kind, seat, role?, target_seat?, day, phase?}
 * @returns {{card: object}} 抛 400 表示参数非法（seat 存在性由路由层结合名单校验）
 */
function buildMacroCard(body) {
  if (!body || typeof body !== 'object') throw httpError(400, 'body 必须是对象');
  const kind = requireNonEmptyString('kind', String(body.kind || ''));
  if (!MACRO_KINDS.includes(kind)) throw httpError(400, 'kind 必须是 ' + MACRO_KINDS.join('|'));
  const seat = requireInt('seat', body.seat, 1);
  const day = requireInt('day', body.day, 1);
  let phase = body.phase === undefined || body.phase === null || body.phase === '' ? 'day' : body.phase;
  if (!PHASES.includes(phase)) throw httpError(400, 'phase 必须是 ' + PHASES.join('|'));

  let event;
  let claims;
  if (kind === 'claim_role') {
    const role = requireNonEmptyString('role', body.role === undefined ? '' : String(body.role));
    event = { day, phase, type: 'claim', actor_seat: seat, raw_text: seat + '号跳' + role };
    claims = [{ seat, subject_seat: seat, predicate: 'claims_role', object: role }];
  } else {
    const target = requireInt('target_seat', body.target_seat, 1);
    if (target === seat) throw httpError(400, '查杀/金水的对象不能是自己（seat=' + seat + '）');
    if (kind === 'check') {
      event = { day, phase, type: 'claim', actor_seat: seat, raw_text: seat + '号查杀' + target + '号' };
      claims = [{ seat, subject_seat: target, predicate: 'is_wolf', object: '查杀' }];
    } else {
      event = { day, phase, type: 'claim', actor_seat: seat, raw_text: seat + '号给' + target + '号发金水' };
      claims = [{ seat, subject_seat: target, predicate: 'is_good', object: '好人' }];
    }
  }
  return {
    event,
    claims,
    actions: [],
    warnings: [],
    extracted_by: 'macro',
    meta: { source: 'macro', kind, mode: 'macro', attempts: 0 },
  };
}

module.exports = { MACRO_KINDS, buildMacroCard };
