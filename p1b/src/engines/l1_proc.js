'use strict';
/**
 * p1b/src/engines/l1_proc.js —— L1 决定论层最小引擎：proc_calc（程序复算）（2026-09-14）
 *
 * 依据：design §1.5 —— L1 引擎姿态＝**程序计算**（LLM 零概率角色）；账本记 **0/1 与计算正确性**；
 *   **Brier 在本层语义＝计算错误率**，不与概率层混比。
 *
 * 契约（纯函数：零 db / 零 LLM / 零网络）：
 *   入参 procCalc({ statement, events, claims, playerCount })
 *     events=[{ seq, day, phase, type, actor_seat?, raw_text? }]（该局**记录**，时序）
 *     claims=[{ day, predicate, ... }]（该局声称；仅 day1 身份声称族用到）
 *   出参（合格）{ ok:true, method:'proc_calc', rule, value:0|1, p:0|1, basis, note, derived }
 *        （不收）{ ok:false, status:'rule_unmatched'|'missing_input', value:null, p:null, note }
 *
 * 收录的 6 条规则族（每条写明 basis；覆盖当前账本 L1 全部 6 模板）：
 *   ① first_night_peace   首夜平安        ：day=1 无 type=death
 *   ② vote_margin_le_1    最高票−次高票≤1  ：计票排名 [v0−v1] ≤ 1（单票时次高=0）
 *   ③ no_abstention       无弃票          ：计票条目数 == 存活者数（玩家数 − 计票前死亡数）
 *   ④ top_votes_ge_4      最高票数≥4      ：计票排名首位 ≥ 4
 *   ⑤ claims_day1_ge_10   day1 身份声称≥10：day1 的 is_wolf/is_good/claims_role 条数 ≥ 10
 *   ⑥ top_vote_unique     最高票唯一      ：计票首位严格大于次位（未触发破平）
 *
 * 纪律：只收**能精确复算**的族；未收录题面或派生所需输入缺失 ⇒ unsupported（宁缺毋滥，不猜）。
 *   输出是**计算结论**（0/1）不是概率；p 字段只为统一计分器口径而设。
 */
const DAY1_CLAIM_PREDICATES = ['is_wolf', 'is_good', 'claims_role'];

/** 从记录派生各规则的输入（缺则对应规则不收）。 */
function derive(input) {
  const events = Array.isArray(input.events) ? input.events : [];
  const claims = Array.isArray(input.claims) ? input.claims : [];
  const tallyEvent = events.filter((e) => /^计票/.test(String(e.raw_text || '')))[0] || null;
  let tallyMap = null;
  if (tallyEvent) {
    const m = /\{([^}]*)\}/.exec(String(tallyEvent.raw_text));
    if (m) { try { tallyMap = JSON.parse('{' + m[1] + '}'); } catch (e) { tallyMap = null; } }
  }
  const ranked = tallyMap ? Object.keys(tallyMap).map((k) => Number(tallyMap[k]) || 0).sort((a, b) => b - a) : null;
  const votesSum = ranked ? ranked.reduce((s, x) => s + x, 0) : null;
  const deathsBeforeVote = tallyEvent ? events.filter((e) => String(e.type) === 'death' && Number(e.seq) < Number(tallyEvent.seq)).length : null;
  const alive = (tallyEvent && Number.isFinite(Number(input.playerCount)) && deathsBeforeVote !== null)
    ? Number(input.playerCount) - deathsBeforeVote : null;
  const day1Claims = claims.filter((c) => Number(c.day) === 1 && DAY1_CLAIM_PREDICATES.indexOf(String(c.predicate)) !== -1).length;
  return {
    hasDeathDay1: events.some((e) => Number(e.day) === 1 && String(e.type) === 'death' && String(e.phase) !== 'dusk'),
    tally: ranked ? { ranked: ranked, entries: ranked.length, sum: votesSum, map: tallyMap } : null,
    alive: alive, day1Claims: day1Claims,
    claimsLoaded: Array.isArray(input.claims) ? true : null, // null=未载入（区别于"载入且为 0 条"）
  };
}

const RULES = [
  { id: 'first_night_peace', match: (s) => /首夜平安|无人死亡/.test(s),
    need: ['hasDeathDay1'],
    compute: (d) => (d.hasDeathDay1 ? 0 : 1),
    basis: '记录中 day=1 **白天公布**是否存在 type=death（＝夜 1 死亡公告，phase=day；黄昏放逐致死 phase=dusk 不计）' },
  { id: 'vote_margin_le_1', match: (s) => /最高票与次高票之差不超过\s*1\s*票/.test(s),
    need: ['tally'],
    compute: (d) => ((d.tally.ranked[0] - (d.tally.ranked[1] || 0)) <= 1 ? 1 : 0),
    basis: '计票排名：首位 − 次位 ≤ 1（单条目时次位按 0 计）' },
  { id: 'no_abstention', match: (s) => /无弃票/.test(s),
    need: ['tally', 'alive'],
    compute: (d) => (d.tally.sum === d.alive ? 1 : 0),
    basis: '计票**总票数**（各目标票数之和）== 存活者数（玩家数 − 计票前死亡数）' },
  { id: 'top_votes_ge_4', match: (s) => /最高票数不少于\s*4\s*票/.test(s),
    need: ['tally'],
    compute: (d) => (d.tally.ranked[0] >= 4 ? 1 : 0),
    basis: '计票排名首位 ≥ 4' },
  { id: 'claims_day1_ge_10', match: (s) => /累计身份声称/.test(s),
    need: ['claimsLoaded'],
    compute: (d) => (d.day1Claims >= 10 ? 1 : 0),
    basis: 'day1 的 is_wolf/is_good/claims_role 声称条数 ≥ 10' },
  { id: 'top_vote_unique', match: (s) => /最高票唯一/.test(s),
    need: ['tally'],
    compute: (d) => (d.tally.ranked[0] > (d.tally.ranked[1] || 0) ? 1 : 0),
    basis: '计票首位严格大于次位（未触发破平）' },
];

/**
 * @param {{statement?:string, events?:Array, claims?:Array, playerCount?:number}} input
 */
function procCalc(input) {
  const opt = input || {};
  const rule = RULES.filter((r) => r.match(String(opt.statement || '')))[0];
  if (!rule) {
    return { ok: false, status: 'rule_unmatched', method: 'proc_calc', value: null, p: null, rule: null,
      note: '题面未命中任何已收录规则族 ⇒ 不收（宁缺毋滥，不猜）。(statement=' + String(opt.statement || '').slice(0, 40) + '…)' };
  }
  const d = derive(opt);
  const missing = (rule.need || []).filter((k) => d[k] === null || d[k] === undefined);
  if (missing.length) {
    return { ok: false, status: 'missing_input', method: 'proc_calc', value: null, p: null, rule: rule.id,
      note: '规则 ' + rule.id + ' 所需输入缺失：' + missing.join(',') + ' ⇒ 不收（缺数据不猜）。' };
  }
  const value = rule.compute(d);
  return {
    ok: true, status: 'ok', method: 'proc_calc', rule: rule.id, value: value, p: value,
    basis: rule.basis, derived: { tally_ranked: d.tally ? d.tally.ranked : null, alive: d.alive, day1_claims: d.day1Claims },
    note: 'L1 程序复算（' + rule.id + '）：' + rule.basis + ' ⇒ ' + value + '（1=成立/0=不成立）。'
      + '本值是**计算结论**不是概率；本层 Brier 语义＝计算错误率（design §1.5），不与概率层混比。',
  };
}

module.exports = { procCalc, derive, RULES };
