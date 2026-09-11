/**
 * 录入页纯逻辑层（P1b-3）—— 与 React 解耦，便于对齐测试。
 * 宏构造逐字对齐 p1b/src/macros.js buildMacroCard（§4：不走 LLM，前端直接结构化）；
 * 卡片变更函数返回新对象（不可变），供确认卡的「任一修改重显」判定。
 */
import type { AnyPredicate, BotcPredicate, EventPhase, PendingAction, PendingCard, PendingEvent, PendingClaim } from '../../types';

export type MacroKind = 'claim_role' | 'check' | 'good';
export const MACRO_KINDS: MacroKind[] = ['claim_role', 'check', 'good'];
export const MACRO_LABEL: Record<MacroKind, string> = {
  claim_role: '跳身份', check: '查杀', good: '金水',
};
export const PHASES: EventPhase[] = ['night', 'day', 'dusk'];
export const PHASE_LABEL: Record<EventPhase, string> = { night: '夜晚', day: '白天', dusk: '黄昏' };

/** B4：BOTC 专属谓词（仅 botc 局可选；后端落 p1b 私有表 botc_claims） */
export const BOTC_PREDICATES: BotcPredicate[] = ['is_demon', 'is_minion', 'status_drunk', 'status_poisoned'];
export const BOTC_PRED_LABEL: Record<BotcPredicate, string> = {
  is_demon: '是恶魔', is_minion: '是爪牙', status_drunk: '自称醉酒', status_poisoned: '自称中毒',
};
/** BOTC 局确认卡/编辑表单的谓词全集 = 通用 7 + BOTC 专属 4（werewolf 局仍只用通用 7） */
export const ALL_PREDICATES: AnyPredicate[] = [
  'is_wolf', 'is_good', 'is_role', 'claims_role', 'voted', 'did_action', 'said',
  ...BOTC_PREDICATES,
];
export const PRED_LABEL: Record<AnyPredicate, string> = {
  is_wolf: '查杀(is_wolf)', is_good: '金水(is_good)', is_role: '指认角色(is_role)',
  claims_role: '跳身份(claims_role)', voted: '投票(voted)', did_action: '行动(did_action)', said: '说过(said)',
  is_demon: '是恶魔(is_demon)', is_minion: '是爪牙(is_minion)',
  status_drunk: '自称醉酒(status_drunk)', status_poisoned: '自称中毒(status_poisoned)',
};
/** 角色类谓词（botc 局 object=角色名，确认卡/事件流展示中文角色名） */
export const ROLE_PREDICATES: AnyPredicate[] = ['claims_role', 'is_role'];

/** 席位上下文：roster 由 state.players 提供（1 基座位号） */
export interface SeatCtx { maxSeat: number; seats: number[] }

/** 合法返回 null；非法返回拒绝原因（对齐终端 confirmSeat：整数 + 名单内才放行） */
export function seatError(v: unknown, ctx: SeatCtx): string | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > ctx.maxSeat) {
    return '席位需 1-' + ctx.maxSeat + ' 的整数';
  }
  if (!ctx.seats.includes(n)) return '席位 ' + n + ' 不在名单中';
  return null;
}

export interface MacroInput {
  kind: MacroKind;
  seat: number;
  role?: string;
  target_seat?: number;
  day: number;
  phase: EventPhase;
}

/** §4 宏 → 结构化待确认卡（与 p1b/src/macros.js 同构；object 命名逐字一致） */
export function buildMacroCard(input: MacroInput): PendingCard {
  const { kind, seat, day, phase } = input;
  if (kind === 'claim_role') {
    const role = String(input.role ?? '').trim();
    return {
      event: { day, phase, type: 'claim', actor_seat: seat, raw_text: seat + '号跳' + role },
      claims: [{ seat, subject_seat: seat, predicate: 'claims_role', object: role }],
      actions: [],
      warnings: [],
      extracted_by: 'macro',
      meta: { source: 'macro', kind, mode: 'macro', attempts: 0 },
    };
  }
  const target = input.target_seat as number;
  if (kind === 'check') {
    return {
      event: { day, phase, type: 'claim', actor_seat: seat, raw_text: seat + '号查杀' + target + '号' },
      claims: [{ seat, subject_seat: target, predicate: 'is_wolf', object: '查杀' }],
      actions: [],
      warnings: [],
      extracted_by: 'macro',
      meta: { source: 'macro', kind, mode: 'macro', attempts: 0 },
    };
  }
  return {
    event: { day, phase, type: 'claim', actor_seat: seat, raw_text: seat + '号给' + target + '号发金水' },
    claims: [{ seat, subject_seat: target, predicate: 'is_good', object: '好人' }],
    actions: [],
    warnings: [],
    extracted_by: 'macro',
    meta: { source: 'macro', kind, mode: 'macro', attempts: 0 },
  };
}

const clone = (c: PendingCard): PendingCard => ({
  event: { ...c.event },
  claims: c.claims.map((x) => ({ ...x })),
  actions: c.actions.map((x) => ({ ...x })),
  warnings: c.warnings ? [...c.warnings] : [],
  extracted_by: c.extracted_by,
  meta: c.meta ? { ...c.meta } : undefined,
});

/** 事件头（day/phase/type）变更；raw_text 是「事件原文」按契约不可改写，仅在 day/phase 变更时保留原样 */
export function withEventHead(card: PendingCard, patch: Partial<Pick<PendingEvent, 'day' | 'phase' | 'type'>>): PendingCard {
  const next = clone(card);
  next.event = { ...next.event, ...patch };
  return next;
}

/** 行为人席位变更：claims[].seat 跟随 actor（对齐终端 add 确认流：claim.seat = event.actor_seat） */
export function withActor(card: PendingCard, seat: number): PendingCard {
  const next = clone(card);
  next.event.actor_seat = seat;
  next.claims = next.claims.map((c) => ({ ...c, seat }));
  next.actions = next.actions.map((a) => (a.seat === card.event.actor_seat ? { ...a, seat } : a));
  return next;
}

/** 第 idx 条声称的「对象席位」变更（终端键控确认的同名字段） */
export function withClaimSubject(card: PendingCard, idx: number, subject: number): PendingCard {
  const next = clone(card);
  const c = next.claims[idx];
  if (c) next.claims[idx] = { ...c, subject_seat: subject };
  return next;
}

/** 第 idx 条声称的谓词变更（B4：botc 局确认卡谓词键控；werewolf 局不提供入口） */
export function withClaimPredicate(card: PendingCard, idx: number, predicate: AnyPredicate): PendingCard {
  const next = clone(card);
  const c = next.claims[idx];
  if (c) next.claims[idx] = { ...c, predicate };
  return next;
}

/** 第 idx 条声称的 object 变更（botc 局角色类声称改角色名 / 阵营状态类改备注） */
export function withClaimObject(card: PendingCard, idx: number, object: string): PendingCard {
  const next = clone(card);
  const c = next.claims[idx];
  if (c) next.claims[idx] = { ...c, object };
  return next;
}

/** 第 idx 条行动的行动人/目标席位变更 */
export function withActionSeat(card: PendingCard, idx: number, patch: Partial<Pick<PendingAction, 'seat' | 'target_seat'>>): PendingCard {
  const next = clone(card);
  const a = next.actions[idx];
  if (a) next.actions[idx] = { ...a, ...patch };
  return next;
}

/** 确认入账 payload：终端规则——claim.seat 一律跟随 event.actor_seat */
export function toConfirmPayload(card: PendingCard) {
  return {
    event: { ...card.event } as PendingEvent,
    claims: card.claims.map((c) => ({ ...c, seat: card.event.actor_seat } as PendingClaim)),
    actions: card.actions.map((a) => ({ ...a })) as PendingAction[],
    extracted_by: card.extracted_by === 'macro' ? 'macro' : 'llm',
  };
}
