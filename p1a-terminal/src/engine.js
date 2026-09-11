'use strict';
/**
 * p1a-terminal · src/engine.js —— 纯代码矛盾比对器（契约 schema-contract-v0 §4；红队 RD1 边界内）
 *
 * 职责边界：只出「字面冲突对」，机械可单测；【不判欠定度、不生成无辜解释】——那是 LLM 层职责（RD1）。
 * 本层允许多报（照录），由 LLM 层为每个冲突对补 ≥1 条无辜解释后再入库/展示；无辜解释为空的冲突对不得展示。
 *
 * findContradictions(claims, actions, events)
 *   → [{claim_a, claim_b, action_a, action_b, conflict_desc}]（正好 5 个字段；无引用一侧为 null）
 *   · claims: db.getClaims() 行数组（须含 id/event_id/seat/subject_seat/predicate/object；day 可省略——由 events 回查）
 *   · actions: db.getActions() 行数组（须含 id/event_id/seat/action/target_seat；day 同上）
 *   · events: db.listEvents() 行数组（须含 id/day/phase/seq/type/actor_seat）
 *   · claim_a/claim_b/action_a/action_b 为输入项 id；conflict_desc 前缀标类：[对跳]/[自相矛盾]/[自相矛盾·同日行动声称]/[声称vs行动]/[死者活跃]
 *   · 纯函数：不改写输入、无 IO、无随机
 *
 * 规则（契约 §4 三类的机械展开）：
 *   R1 对跳（claims×claims）：predicate ∈ {claims_role,is_role} 且 object ∈ 唯一角色表（女巫/预言家/猎人/守卫/骑士），
 *      不同 subject_seat 的两条声称互斥 → 冲突（唯一角色全场只能有一人；6vs10 对跳女巫即此）。
 *   R2 自相矛盾（claims×claims）：同 subject_seat + 同身份谓词（is_wolf/is_good/is_role/claims_role）+ 不同 object
 *      → 冲突，不限日（身份不随日变，改跳即报）。
 *   R3 同日行动声称冲突（claims×claims）：同 subject_seat + 谓词 ∈ {did_action,voted} + 不同 object + 同一 day
 *      → 冲突；跨 day 不报——不同夜槽位/不同轮次属正常节奏（预言家每晚验人、改票），即「跨日改口不算字面冲突」；
 *      谓词不同（said 预告 vs did_action 实报）也不报。
 *   R4 声称vs行动（claims×actions）：did_action 声称 object="动词:目标"（check:8）与同座位同日同名行动
 *      （check_target→check 等）target_seat 字面不一致 → 冲突；voted 声称（object=目标座位号或 'abstain'）与同日
 *      vote/abstain 行动不一致 → 冲突；无对应行动记录（缺席不算冲突）或完全一致 → 不报。
 *   R5 死者活跃（events 驱动）：death 事件（按 day→phase→seq 全局排序）之后，该座位号出现新 claim、
 *      或 vote/abstain 行动 → 照录待查（欠定度由 LLM 层标注；死者 2 号昼2发言、死者 7 号弃票即此）。
 *
 * 声称 object 编码约定（C 路抽取时遵守）：did_action → "动词:目标座位号"（check:8 / poison:5 / protect:3 / kill:6）；
 * voted → 目标座位号字符串或 'abstain'；claims_role/is_role → 角色名（唯一角色须用唯一角色表内译名）。
 */

const ROLE_ASSERT_PREDICATES = ['claims_role', 'is_role'];
const IDENTITY_PREDICATES = ['is_wolf', 'is_good', 'is_role', 'claims_role'];
const TIME_ACTION_PREDICATES = ['did_action', 'voted'];
const UNIQUE_ROLES = new Set([
  '女巫', 'witch', '预言家', 'seer', '猎人', 'hunter', '守卫', 'guard', '骑士', 'knight',
]);
const ACTION_VERB = { kill_target: 'kill', poison_target: 'poison', protect_target: 'protect', check_target: 'check' };
const PHASE_ORDER = { night: 0, day: 1, dusk: 2 };
function normText(v) { return String(v === undefined || v === null ? '' : v).trim().toLowerCase(); }
function isUniqueRole(obj) { return UNIQUE_ROLES.has(normText(obj)); }

function findContradictions(claims, actions, events) {
  claims = Array.isArray(claims) ? claims : [];
  actions = Array.isArray(actions) ? actions : [];
  events = Array.isArray(events) ? events : [];
  const eventById = new Map(events.map(e => [e.id, e]));
  const dayOf = (item) => {
    if (item.day !== undefined && item.day !== null) return item.day;
    const ev = eventById.get(item.event_id);
    return ev ? ev.day : null;
  };
  const out = [];
  const seen = new Set();
  const push = (row) => {
    const key = JSON.stringify([row.claim_a === undefined ? null : row.claim_a, row.claim_b === undefined ? null : row.claim_b,
      row.action_a === undefined ? null : row.action_a, row.action_b === undefined ? null : row.action_b]);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };

  // R1 对跳：唯一角色被不同 subject_seat 同时声称/指认
  const roleGroups = new Map();
  for (const c of claims) {
    if (!ROLE_ASSERT_PREDICATES.includes(c.predicate) || !isUniqueRole(c.object)) continue;
    const key = normText(c.object);
    if (!roleGroups.has(key)) roleGroups.set(key, []);
    roleGroups.get(key).push(c);
  }
  for (const group of roleGroups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.subject_seat === b.subject_seat) continue;
        push({
          claim_a: a.id, claim_b: b.id, action_a: null, action_b: null,
          conflict_desc: '[对跳] 唯一角色「' + a.object + '」被 ' + a.subject_seat + ' 号（claim#' + a.id
            + '）与 ' + b.subject_seat + ' 号（claim#' + b.id + '）同时声称/指认，互斥必有一假（day'
            + dayOf(a) + '/day' + dayOf(b) + '）',
        });
      }
    }
  }

  // R2 自相矛盾：同 subject_seat + 同身份谓词 + 不同 object（不限日）
  const idGroups = new Map();
  for (const c of claims) {
    if (!IDENTITY_PREDICATES.includes(c.predicate)) continue;
    const key = c.subject_seat + '|' + c.predicate;
    if (!idGroups.has(key)) idGroups.set(key, []);
    idGroups.get(key).push(c);
  }
  for (const group of idGroups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (normText(a.object) === normText(b.object)) continue;
        push({
          claim_a: a.id, claim_b: b.id, action_a: null, action_b: null,
          conflict_desc: '[自相矛盾] 座位' + a.subject_seat + ' 的「' + a.predicate + '」声称不一致：claim#'
            + a.id + '="' + a.object + '" vs claim#' + b.id + '="' + b.object + '"（同一对象两种说法）',
        });
      }
    }
  }

  // R3 同日行动声称冲突：跨日不报（跨夜槽位不同，正常节奏），谓词不同也不报
  const timeGroups = new Map();
  for (const c of claims) {
    if (!TIME_ACTION_PREDICATES.includes(c.predicate)) continue;
    const d = dayOf(c);
    if (d === null || d === undefined) continue;
    const key = c.subject_seat + '|' + c.predicate + '|' + d;
    if (!timeGroups.has(key)) timeGroups.set(key, []);
    timeGroups.get(key).push(c);
  }
  for (const group of timeGroups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (normText(a.object) === normText(b.object)) continue;
        push({
          claim_a: a.id, claim_b: b.id, action_a: null, action_b: null,
          conflict_desc: '[自相矛盾·同日行动声称] 座位' + a.subject_seat + ' 在 day' + dayOf(a) + ' 的「'
            + a.predicate + '」声称冲突：claim#' + a.id + '="' + a.object + '" vs claim#' + b.id + '="' + b.object
            + '"（同一时段同一动作两种说法；跨日改口不在此列）',
        });
      }
    }
  }
  // R4 声称vs行动：同座位同日，声称与行动记录字面不一致；无记录/一致 → 不报
  for (const c of claims) {
    const d = dayOf(c);
    if (c.predicate === 'did_action') {
      const m = /^([a-z_]+)\s*[:\uff1a]\s*(.+)$/.exec(normText(c.object));
      if (!m) continue;
      const verb = m[1];
      const claimedTarget = m[2].trim();
      const rel = actions.filter(a => a.seat === c.subject_seat && dayOf(a) === d && ACTION_VERB[a.action] === verb);
      if (rel.length === 0) continue;
      if (rel.some(a => normText(a.target_seat) === claimedTarget)) continue;
      const act = rel[0];
      push({
        claim_a: c.id, claim_b: null, action_a: act.id, action_b: null,
        conflict_desc: '[声称vs行动] 座位' + c.subject_seat + ' 声称 ' + c.object + '（claim#' + c.id + '，day' + d
          + '）与行动记录不符：action#' + act.id + ' 实际 ' + ACTION_VERB[act.action] + ':'
          + (act.target_seat === undefined || act.target_seat === null ? '无' : act.target_seat) + '（day' + dayOf(act) + '）',
      });
    } else if (c.predicate === 'voted') {
      const claimed = normText(c.object);
      if (!claimed) continue;
      const rel = actions.filter(a => a.seat === c.subject_seat && dayOf(a) === d && (a.action === 'vote' || a.action === 'abstain'));
      if (rel.length === 0) continue;
      const actualOf = (a) => (a.action === 'abstain' ? 'abstain' : String(a.target_seat === undefined || a.target_seat === null ? '' : a.target_seat));
      if (rel.some(a => actualOf(a) === claimed)) continue;
      const act = rel[0];
      push({
        claim_a: c.id, claim_b: null, action_a: act.id, action_b: null,
        conflict_desc: '[声称vs行动] 座位' + c.subject_seat + ' 声称投 ' + claimed + '（claim#' + c.id + '，day' + d
          + '）与投票记录不符：action#' + act.id + ' 实际 ' + act.action + '->' + actualOf(act) + '（day' + dayOf(act) + '）',
      });
    }
  }

  // R5 死者活跃：death 事件之后该座位号出现新 claim 或 vote/abstain 行动 → 照录待查
  const sorted = events.slice().sort((x, y) => ((x.day - y.day) || ((PHASE_ORDER[x.phase] === undefined ? 0 : PHASE_ORDER[x.phase]) - (PHASE_ORDER[y.phase] === undefined ? 0 : PHASE_ORDER[y.phase])) || ((x.seq === undefined ? 0 : x.seq) - (y.seq === undefined ? 0 : y.seq))));
  const rank = new Map(sorted.map((e, i) => [e.id, i]));
  const deathRank = new Map();
  for (const e of sorted) {
    if (e.type === 'death' && e.actor_seat !== null && e.actor_seat !== undefined) {
      const r = rank.get(e.id);
      const cur = deathRank.get(e.actor_seat);
      if (cur === undefined || r < cur) deathRank.set(e.actor_seat, r);
    }
  }
  for (const c of claims) {
    const ev = eventById.get(c.event_id);
    if (!ev) continue;
    const dr = deathRank.get(c.seat);
    if (dr === undefined) continue;
    const r = rank.get(ev.id);
    if (r === undefined || r <= dr) continue;
    push({
      claim_a: c.id, claim_b: null, action_a: null, action_b: null,
      conflict_desc: '[死者活跃] 座位' + c.seat + ' 在死亡之后仍有新声称：claim#' + c.id + '（event#' + ev.id
        + '，day' + ev.day + ' ' + ev.phase + '）——照录待查，欠定度由 LLM 层标注',
    });
  }
  for (const a of actions) {
    if (a.action !== 'vote' && a.action !== 'abstain') continue;
    const ev = eventById.get(a.event_id);
    if (!ev) continue;
    const dr = deathRank.get(a.seat);
    if (dr === undefined) continue;
    const r = rank.get(ev.id);
    if (r === undefined || r <= dr) continue;
    push({
      claim_a: null, claim_b: null, action_a: a.id, action_b: null,
      conflict_desc: '[死者活跃] 座位' + a.seat + ' 在死亡之后仍有投票行动：action#' + a.id + ' ' + a.action
        + '（event#' + ev.id + '，day' + ev.day + ' ' + ev.phase + '）——照录待查，欠定度由 LLM 层标注',
    });
  }

  out.sort((x, y) => ((x.claim_a === null ? (x.action_a || 0) : x.claim_a) - (y.claim_a === null ? (y.action_a || 0) : y.claim_a)));
  return out;
}

module.exports = { findContradictions, UNIQUE_ROLES, ACTION_VERB };


