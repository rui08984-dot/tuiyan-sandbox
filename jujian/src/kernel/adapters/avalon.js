/* avalon.js — 阿瓦隆（Avalon）第二场景适配器 · 五方法契约（S2 §1.2）· 2026-09-13
 *
 * 契约（docs/specs/推演沙盘-终极路线图-20260913.md §3 引用 S2 §1.2）：
 *   listOpenQuestions(gameId)   列出该局此刻可出的待判题（判据+真值锚+cutoff 冻结）
 *   resolveQuestion(qid)        机检 resolve（找锚→比对→outcome，无锚=pending，cutoff 晚于锚=void/leak）
 *   featurePack(gameId, cutoff) 截止 cutoff 的特征包（只吃公开信息；真值盲）
 *   baseline(gameId)            该局基率（先验常量 + 同局公开统计 + Wilson 区间）
 *   exposure(gameId)            自反暴露度（L4 语义：public_exposure 0/1 + reflexivity_breach）
 *
 * 设计纪律（全部继承既有裁定，不新造）：
 *   · 真值盲：只吃 ≤cutoff 的 events/claims/actions 副本；传入行若含 truth 类字段一律剥离并计数。
 *   · 零 db 写：本模块不 import 任何 db 模块，无 prepare/exec；数据由调用方注入（fixture / 只读查询件）。
 *   · 零 LLM：纯代码机检。
 *   · schema 零改动：events/vote/claims_role 原样复用（p1a-terminal/src/db.js SCHEMA_A/B）；
 *     阿瓦隆「提名队伍」无既有 action 枚举值 → 用 events.type='system' + raw_text 前缀「提名：」承载，
 *     不新增 EVENT_TYPES/ACTION_KINDS 值（复用声明见 module.exports.SCHEMA_REUSE）。
 *   · 词表复用：p1b/src/detectors/werewolf-contradictions.js 的 VOCAB.avalon（只读 require，不改本体）。
 *   · 无真值锚禁入（审计器 §1.1 Q0-1）+ cutoff 早于决定性时点（§1.1 Q0-2）。
 *   · L6 对抗层引擎 = ③结构推断（矛盾特征+belief 统计），layer=L6；L4 语义只作叠加标注。
 */
"use strict";

const DET = require("../detectors/werewolf-contradictions.js");
const VOCAB_AVALON = DET.VOCAB.avalon;

const LAYER = "L6";              // 对抗层（审计器 §1.4）
const SECONDARY_LAYER = null;
const ENGINE = "structural";     // ③结构推断（矛盾特征+belief），对齐审计器 §2 表
const ADAPTER_ID = "avalon";
const CHECKLIST_HASH = "avalon-v1";  // 判据清单版本（清单改动=新版本号，不回填旧题）
// ── 阿瓦隆语料规约（引擎无关，只认下列形状；宿主按 db 行原样传入即可）──────────────────
//   players: [{ seat, name }]
//   events : [{ id, day, phase|'day', seq, type, actor_seat, raw_text }]  type ∈ p1a EVENT_TYPES ∪ 约定
//   claims : [{ id, event_id, seat, subject_seat, predicate, object, retracted? }]
//   actions: [{ id, event_id, seat, action, target_seat, result }]
// 阿瓦隆约定（system 事件承载，schema 零改动）：
//   提名：提名：<round>队=[3,4]            → 队长提名队伍（action 枚举无 nominate_team，用 system 顶）
//   表决：表决：<round>队={3:"approve",4:"reject"}  → 队伍表决逐座结果（亦作 vote 行）
//   任务：任务：<round>队=<success|fail>   → 任务结果（唯一硬真值之一）
//   刺杀：刺杀：<seat>                     → 终局刺杀目标
//   出局：出局：<seat>（<reason>）          → 轮次否决出局/终局
// 角色声称 predicate=claims_role，object 走 VOCAB.avalon.role_norm 归一（梅林/派西维尔/忠臣→好人…）
const PRIOR = {
  approve_rate: 0.62,      // 队伍提名被通过的历史先验（公开规则常识级，非语料学得）
  mission_fail_given_evil: 0.85, // 含邪恶的队伍任务失败先验
  evil_seat_base: { 5: 2 / 5, 6: 2 / 6, 7: 3 / 7, 8: 3 / 8, 9: 3 / 9, 10: 4 / 10 },
  evil_team_min: 2, evil_team_max: 4,
};
const RE_NOMINATE = /提名：\s*R?(\d+)\s*队\s*=\s*\[([^\]]*)\]/;
const RE_VOTE = /表决：\s*R?(\d+)\s*队\s*=\s*(\{[^}]*\})/;
const RE_MISSION = /任务：\s*R?(\d+)\s*队\s*=\s*(success|fail)/i;
const RE_ASSASSIN = /刺杀：\s*(\d+)\s*号?/;
const RE_OUT = /出局：\s*(\d+)\s*号?/;

function asArray(x) { return Array.isArray(x) ? x : []; }
function seatNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function parseSeatList(s) {
  return String(s || "").split(/[,\s]+/).map(function (t) { return seatNum(t); })
    .filter(function (n) { return n !== null; });
}
function parseVoteObj(s) {
  const out = {};
  const body = String(s || "").replace(/^\{|\}$/g, "");
  if (!body.trim()) return out;
  body.split(",").forEach(function (seg) {
    const m = seg.split(":");
    if (m.length < 2) return;
    const seat = seatNum(m[0]);
    if (seat === null) return;
    out[seat] = String(m[1]).replace(/["'\s]/g, "");
  });
  return out;
}
/** 从 system 事件文本解析一个阿瓦隆结构行；不匹配返回 null */
function parseSystemLine(raw) {
  const t = String(raw === undefined || raw === null ? "" : raw);
  let m = t.match(RE_NOMINATE);
  if (m) return { kind: "nominate", round: Number(m[1]), team: parseSeatList(m[2]) };
  m = t.match(RE_VOTE);
  if (m) return { kind: "team_vote", round: Number(m[1]), votes: parseVoteObj(m[2]) };
  m = t.match(RE_MISSION);
  if (m) return { kind: "mission", round: Number(m[1]), result: String(m[2]).toLowerCase() };
  m = t.match(RE_ASSASSIN);
  if (m) return { kind: "assassinate", seat: Number(m[1]) };
  m = t.match(RE_OUT);
  if (m) return { kind: "expelled", seat: Number(m[1]) };
  return null;
}
// ── 真值盲装载：只吃公开行，剥离任何 truth 类字段（计数留证）────────────────────────
const TRUTH_KEYS = ["truth", "is_evil", "is_wolf", "real_role", "true_role", "allegiance", "team", "meta"];
let STRIP_LOG = { count: 0, keys: [] };   // 每个 view 调用前重置；调用后由 _lastStrip 暴露

function sanitizeRow(row) {
  const out = {};
  Object.keys(row || {}).forEach(function (k) {
    if (TRUTH_KEYS.indexOf(k) >= 0) { STRIP_LOG.count++; if (STRIP_LOG.keys.indexOf(k) < 0) STRIP_LOG.keys.push(k); return; }
    out[k] = row[k];
  });
  return out;
}
function resetStrip() { STRIP_LOG = { count: 0, keys: [] }; }

/** cutoff 解析：数字=seq 上界；"D3"/{day:3}=该日末；缺省=全部（Infinity） */
function cutoffSeqOf(events, cutoff) {
  if (cutoff === undefined || cutoff === null) return Infinity;
  if (typeof cutoff === "number") return cutoff;
  if (typeof cutoff === "object" && cutoff.seq !== undefined) return Number(cutoff.seq);
  const s = String(cutoff);
  const m = s.match(/^D?(\d+)$/);
  if (m) {
    const day = Number(m[1]);
    const last = asArray(events).filter(function (e) { return Number(e.day) === day; })
      .reduce(function (a, e) { return Math.max(a, Number(e.seq)); }, -Infinity);
    return last === -Infinity ? -1 : last;
  }
  return Infinity;
}
function orderKey(e) { return [Number(e.day) || 0, Number(e.seq) || 0, Number(e.id) || 0]; }
function cmpEvent(a, b) {
  const ka = orderKey(a), kb = orderKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
}

/** 装载视图：{ game?, players[], events[], claims[], actions[] } → 剥离真值 + 排序 + cutoff 截断 */
function loadView(gameId, src) {
  resetStrip();
  const s = src || {};
  const allEvents = asArray(s.events).map(sanitizeRow).slice().sort(cmpEvent);
  const cutoff = cutoffSeqOf(allEvents, s.cutoff);
  const inWindow = function (e) { return Number(e.seq) <= cutoff; };
  const events = allEvents.filter(inWindow);
  const evIds = new Set(events.map(function (e) { return e.id; }));
  const claims = asArray(s.claims).map(sanitizeRow).filter(function (c) {
    return c.retracted ? false : evIds.has(c.event_id);
  });
  const actions = asArray(s.actions).map(sanitizeRow).filter(function (a) {
    return a.retracted ? false : evIds.has(a.event_id);
  });
  const players = asArray(s.players).map(sanitizeRow);
  const seats = (function () {
    const set = new Set(players.map(function (p) { return Number(p.seat); }));
    events.forEach(function (e) { if (e.actor_seat !== null && e.actor_seat !== undefined) set.add(Number(e.actor_seat)); });
    return Array.from(set).filter(function (n) { return Number.isFinite(n); }).sort(function (a, b) { return a - b; });
  })();
  const game = sanitizeRow(s.game || {});
  return {
    adapter: ADAPTER_ID,
    game_id: gameId === undefined ? (game.id === undefined ? null : game.id) : gameId,
    game: game,
    players: players, seats: seats, events: events, claims: claims, actions: actions,
    cutoff_seq: cutoff === Infinity ? null : cutoff,
    cutoff_mode: s.cutoff === undefined || s.cutoff === null ? "all" : "at",
    total_events: allEvents.length,
    truncated_events: allEvents.length - events.length,
    truth_blind: { stripped_fields: STRIP_LOG.count, stripped_keys: STRIP_LOG.keys.slice() },
  };
}

/** 结构抽取：system 事件行 → 提名/表决/任务/刺杀/出局（schema 零改动的承载方式） */
function deriveStructure(view) {
  const st = { nominations: [], team_votes: [], missions: [], expulsions: [], assassinate: null, malformed: 0 };
  view.events.forEach(function (e) {
    let parsed = null;
    if (e.type === "system") parsed = parseSystemLine(e.raw_text);
    if (e.type === "vote" && !parsed) {
      const t = String(e.raw_text || "");
      const mv = t.match(RE_VOTE);
      if (mv) parsed = { kind: "team_vote", round: Number(mv[1]), votes: parseVoteObj(mv[2]) };
    }
    if (!parsed) { if (e.type === "system") st.malformed++; return; }
    parsed.event_id = e.id; parsed.seq = Number(e.seq); parsed.day = Number(e.day); parsed.actor_seat = e.actor_seat === undefined ? null : e.actor_seat;
    if (parsed.kind === "nominate") st.nominations.push(parsed);
    else if (parsed.kind === "team_vote") st.team_votes.push(parsed);
    else if (parsed.kind === "mission") st.missions.push(parsed);
    else if (parsed.kind === "expelled") st.expulsions.push(parsed);
    else if (parsed.kind === "assassinate") st.assassinate = parsed;
  });
  return st;
}
// ── 题面（判据写作技能的可复用模板；qid = gameId:type:arg）──────────────────────────
//   锚：mission/表决/出局/刺杀 均为程序结算行的直接读数 → 天然可机检（审计器 §1.1 Q0-1）。
//   每题的 cutoff 恒 ≤ 该题锚事件之前 → 满足 Q0-2（禁事后诸葛）。
const QTYPES = ["mission_fail_Rk", "team_approved_Rk", "expelled_seat_Rk", "assassin_target_evil"];

function makeQ(view, type, arg, statement, anchorSeq, extra) {
  const q = {
    qid: view.game_id + ":" + type + (arg === null || arg === undefined ? "" : ":" + arg),
    game_id: view.game_id,
    game: ADAPTER_ID,
    type: type,
    arg: arg === undefined ? null : arg,
    layer: LAYER,
    secondary_layer: SECONDARY_LAYER,
    engine: ENGINE,
    statement: statement,
    cutoff: { seq: extra && extra.cutoff_seq !== undefined ? extra.cutoff_seq : anchorSeq - 1, mode: "before_anchor" }, // 判据冻结时点：锚事件之前
    anchor: { kind: type, event_id: extra && extra.event_id !== undefined ? extra.event_id : null, seq: anchorSeq, anchor_seq: extra && extra.cutoff_seq !== undefined ? extra.cutoff_seq : anchorSeq },
    gate: "scored",
    checklist_hash: CHECKLIST_HASH,
    baseline_ref: ADAPTER_ID + ":" + type,
  };
  return q;
}

/** 待判题清单（纯函数：只吃视图，零 db）。已出现锚的题不再出（已可 resolve）。 */
function questionsFromView(view) {
  const st = view.seats;
  const out = [];
  const missions = {}, votesByRound = {}, outSeats = [];
  const stx = deriveStructure(view);
  stx.missions.forEach(function (m) { missions[m.round] = m; });
  stx.team_votes.forEach(function (v) { votesByRound[v.round] = v; });
  stx.expulsions.forEach(function (x) { outSeats.push(x.seat); });
  // ① 任务结果题（每题一个轮次）：真值=任务牌，纯程序结算
  stx.nominations.forEach(function (n) {
    const r = n.round;
    const delegated = String(n.team.join(","));
    const rejected = votesByRound[r] && countApprovals(votesByRound[r].votes) <= (Object.keys(votesByRound[r].votes).length - countApprovals(votesByRound[r].votes));
    if (!missions[r] && !rejected) {
      const failThreshold = (st.length >= 7 && r === 4) ? 2 : 1;   // 第 4 轮 7 人+ 需 2 张失败牌
      out.push(makeQ(view, "mission_fail_Rk", "R" + r,
        "第 " + r + " 轮任务（队伍=[" + delegated + "]，队长席 " + (n.actor_seat === undefined ? "未知" : n.actor_seat) + "）"
        + "结果是否为 fail？（需 " + failThreshold + " 张失败牌即 fail；锚=" + r + " 轮任务裁定行）",
        n.seq + 0.5, { event_id: n.event_id, cutoff_seq: n.seq }));
    }
  });
  // ② 表决通过题：真值=表决行 approve 多数
  stx.nominations.forEach(function (n) {
    const r = n.round;
    const v = votesByRound[r];
    if (!v) {
      out.push(makeQ(view, "team_approved_Rk", "R" + r,
        "第 " + r + " 轮队伍 [" + n.team.join(",") + "] 是否获多数通过（approve > reject）？（锚=" + r + " 轮表决行）",
        n.seq + 0.5, { event_id: n.event_id, cutoff_seq: n.seq }));
    }
  });
  // ③ 出局席题：真值=出局/放逐裁定行（阿瓦隆=连续否决轮代价）
  stx.nominations.forEach(function (n) {
    const r = n.round;
    const v = votesByRound[r];
    if (!v) return;
    const approved = countApprovals(v.votes) > (Object.keys(v.votes).length / 2);
    if (approved) return;                                 // 通过则不触发出局题
    if (outSeats.length === 0) {
      out.push(makeQ(view, "expelled_seat_Rk", "R" + r,
        "第 " + r + " 轮队伍被否决后出局的是哪一席？（锚=" + r + " 轮出局裁定行；cutoff 在表决行之后、出局行之前）",
        v.seq + 0.5, { event_id: v.event_id, cutoff_seq: v.seq }));
    }
  });
  // ④ 终局刺杀题：真值=刺杀行 + 该席位真实阵营（judge 侧读锚，非 featurePack）
  if (stx.assassinate === null && st.length >= 5) {
    out.push(makeQ(view, "assassin_target_evil", "final",
      "终局刺杀目标席是否为邪恶方？（锚=刺杀裁定行 + 该席位真实阵营；cutoff 在最后一次任务之后）",
      (view.events.length ? Number(view.events[view.events.length - 1].seq) + 1 : 1), { event_id: null, cutoff_seq: (view.events.length ? Number(view.events[view.events.length - 1].seq) : 0) }));
  }
  return out;
}
function countApprovals(votes) {
  let n = 0;
  Object.keys(votes || {}).forEach(function (k) { if (String(votes[k]).toLowerCase() === "approve") n++; });
  return n;
}
// ── 题册（内存注册表；本棒零 db 写入，qid→快照 仅存进程内存，供 resolveQuestion 机检）──
const REGISTRY = new Map();      // qid → { q, snapshot }
const LAST_SRC = new Map();      // gameId → 最近一次装载的源快照（只读引用，不落盘）

/** 二元判据机检：锚行读数 → {status, outcome|null, truth, anchor} */
function judgeQuestion(q, src) {
  const s = src || {};
  // 判题视图=全量（锚行必须可见）；q.cutoff 只作冻结声明 + 反事后诸葛校验（见 leak）
  const view = loadView(q.game_id, Object.assign({}, s, { cutoff: null }));
  const stx = deriveStructure(view);
  const leak = function (anchSeq) {
    return q.cutoff && anchSeq !== undefined && anchSeq !== null && Number(q.cutoff.seq) >= Number(anchSeq);
  };
  if (q.type === "mission_fail_Rk") {
    const round = Number(String(q.arg).replace(/^R/, ""));
    const v = stx.team_votes.filter(function (x) { return x.round === round; })[0];
    if (v && countApprovals(v.votes) <= (Object.keys(v.votes).length - countApprovals(v.votes))) {
      return { status: "void", outcome: null, reason: "team_rejected_no_mission", truth: { round: round, anchor_event_id: v.event_id } };
    }
    const m = stx.missions.filter(function (x) { return x.round === round; })[0];
    if (!m) return { status: "pending", outcome: null, reason: "anchor_not_yet_in_window" };
    if (leak(m.seq)) return { status: "void", outcome: null, reason: "leak" };
    return { status: "resolved", outcome: m.result === "fail" ? 1 : 0, truth: { mission: m.result, round: round, anchor_event_id: m.event_id } };
  }
  if (q.type === "team_approved_Rk") {
    const round = Number(String(q.arg).replace(/^R/, ""));
    const v = stx.team_votes.filter(function (x) { return x.round === round; })[0];
    if (!v) return { status: "pending", outcome: null, reason: "anchor_not_yet_in_window" };
    if (leak(v.seq)) return { status: "void", outcome: null, reason: "leak" };
    const ap = countApprovals(v.votes), votes = Object.keys(v.votes).length;
    const rej = votes - ap;
    return { status: "resolved", outcome: ap > rej ? 1 : 0, truth: { approve: ap, reject: rej, round: round, anchor_event_id: v.event_id } };
  }
  if (q.type === "expelled_seat_Rk") {
    const v = stx.team_votes.filter(function (x) { return x.round === Number(String(q.arg).replace(/^R/, "")); })[0];
    const after = stx.expulsions.filter(function (x) { return v && x.seq > v.seq; }).sort(function (a, b) { return a.seq - b.seq; })[0];
    if (!after) return { status: "pending", outcome: null, reason: "anchor_not_yet_in_window" };
    if (leak(after.seq)) return { status: "void", outcome: null, reason: "leak" };
    return { status: "resolved", outcome: 1, truth: { seat: after.seat, anchor_event_id: after.event_id } };
  }
  if (q.type === "assassin_target_evil") {
    if (!stx.assassinate) return { status: "pending", outcome: null, reason: "anchor_not_yet_in_window" };
    if (leak(stx.assassinate.seq)) return { status: "void", outcome: null, reason: "leak" };
    const truth = s.truth || {};                                        // 仅 judge 侧读真值，featurePack 永不读
    const seat = stx.assassinate.seat;
    const alleg = (truth.seat_allegiance && truth.seat_allegiance[seat]) || null;
    const evilList = asArray(truth.evil_seats);
    if (alleg === null && evilList.length === 0) {
      return { status: "pending", outcome: null, reason: "truth_anchor_missing_no_anchor" };
    }
    const isEvil = alleg ? alleg === "evil" : evilList.map(Number).indexOf(seat) >= 0;
    return { status: "resolved", outcome: isEvil ? 1 : 0, truth: { seat: seat, allegiance: alleg || (isEvil ? "evil" : "good"), anchor_event_id: stx.assassinate.event_id } };
  }
  return { status: "void", outcome: null, reason: "unknown_type" };
}
// ── 特征包：只吃 ≤cutoff 的公开信息（真值盲），零 LLM，数值向量 + belief 统计 ──────────
function normAllegiance(roleText) {                     // 词表复用 detectors.VOCAB.avalon.role_norm
  const raw = String(roleText === undefined || roleText === null ? "" : roleText).trim();
  if (!raw) return null;
  const norm = VOCAB_AVALON.role_norm[raw];
  if (!norm) return null;
  return VOCAB_AVALON.team_of[norm] || null;
}
function buildFeaturePack(view) {
  const stx = deriveStructure(view);
  const seatCount = view.seats.length || 0;
  const f = {
    adapter: ADAPTER_ID,
    game_id: view.game_id,
    layer: LAYER,
    secondary_layer: SECONDARY_LAYER,
    engine: ENGINE,
    cutoff: view.cutoff_seq,
    cutoff_mode: view.cutoff_mode,
    seat_count: seatCount,
    seats: view.seats.slice(),
    derived: {
      nominations: stx.nominations.map(function (n) { return { round: n.round, team: n.team.slice(), seq: n.seq }; }),
      team_votes: stx.team_votes.map(function (v) { return { round: v.round, votes: v.votes, seq: v.seq }; }),
      missions: stx.missions.map(function (m) { return { round: m.round, result: m.result, seq: m.seq }; }),
      expulsions: stx.expulsions.map(function (x) { return { seat: x.seat, seq: x.seq }; }),
      malformed_system_lines: stx.malformed,
    },
    public_counts: {
      events: view.events.length, claims: view.claims.length, actions: view.actions.length,
      statements: view.events.filter(function (e) { return e.type === "statement"; }).length,
      rounds_observed: Object.keys(stx.team_votes.reduce(function (a, v) { a[v.round] = 1; return a; }, {})).length,
      rounds_total_in_corpus: view.total_events,
      truncated: view.truncated_events,
    },
    beliefs: null, contradictions: null, truth_blind: view.truth_blind,
  };
  // belief：per-seat 表决取向 + 角色声称归一分布（仅公开声称，不含真值）
  const belief = {};
  view.seats.forEach(function (s) { belief[s] = { approve: 0, reject: 0, approve_rate: null, claims: {}, accused: 0, defended: 0 }; });
  stx.team_votes.forEach(function (v) {
    Object.keys(v.votes).forEach(function (k) {
      const seat = Number(k); if (!belief[seat]) belief[seat] = { approve: 0, reject: 0, approve_rate: null, claims: {}, accused: 0, defended: 0 };
      const choice = String(v.votes[k]).toLowerCase();
      if (choice === "approve") belief[seat].approve++; else if (choice === "reject") belief[seat].reject++;
    });
  });
  Object.keys(belief).forEach(function (k) {
    const b = belief[k], tot = b.approve + b.reject;
    b.approve_rate = tot ? Number((b.approve / tot).toFixed(4)) : null;
  });
  view.claims.forEach(function (c) {
    const seat = Number(c.seat), subj = Number(c.subject_seat);
    if (belief[seat]) {
      const key = String(c.predicate) + "=" + String(c.object);
      belief[seat].claims[key] = (belief[seat].claims[key] || 0) + 1;
      const alleg = normAllegiance(c.object);
      if (alleg) { const k2 = "alleg_claim:" + alleg; belief[seat].claims[k2] = (belief[seat].claims[k2] || 0) + 1; }
    }
    if (belief[subj]) {
      if (String(c.predicate) === "is_evil" || String(c.predicate) === "is_wolf") belief[subj].accused++;
      if (String(c.predicate) === "is_good") belief[subj].defended++;
    }
  });
  f.beliefs = belief;
  // 矛盾特征：复用 W1-W6 检测器（format=avalon 走 VOCAB.avalon；只读 require 不改本体）
  const pairs = DET.detectWerewolfContradictions({ format: "avalon", events: view.events, claims: view.claims });
  f.contradictions = { summary: DET.summarize(pairs), pairs: pairs };
  f.feature_vector = [
    Number((seatCount ? stx.team_votes.length / Math.max(1, seatCount) : 0).toFixed(4)),
    stx.missions.filter(function (m) { return m.result === "fail"; }).length,
    stx.expulsions.length,
    f.contradictions.summary.total,
    Number((view.events.length ? view.claims.length / view.events.length : 0).toFixed(4)),
  ];
  return f;
}
// ── 源注册（宿主/fixture 注入；零 db：本模块不打开任何连接）──────────────────────────
const SOURCES = new Map();                 // gameId → { game?, players[], events[], claims[], actions[], truth?, exposure? }
function registerSource(gameId, src) { SOURCES.set(String(gameId), src || {}); return String(gameId); }
function getSource(gameId, opts) {
  const o = opts || {};
  if (o.src) return o.src;
  const key = String(gameId);
  if (SOURCES.has(key)) return SOURCES.get(key);
  throw new Error("[avalon-adapter] 未注册源 gameId=" + gameId + "（零 db：请先 registerSource 或传 opts.src）");
}

// ── 基率：先验常量 + 同局公开统计（≤cutoff）+ Wilson 区间；真值盲 ────────────────────
function wilson(k, n, z) {
  if (!n) return { low: 0, high: 1, center: null, n: 0 };
  const zz = z === undefined ? 1.96 : z, p = k / n;
  const d = 1 + zz * zz / n;
  const c = (p + zz * zz / (2 * n)) / d;
  const h = zz * Math.sqrt(p * (1 - p) / n + zz * zz / (4 * n * n)) / d;
  return { low: Number(Math.max(0, c - h).toFixed(4)), high: Number(Math.min(1, c + h).toFixed(4)), center: Number(p.toFixed(4)), n: n };
}
function baselineOfView(view) {
  const stx = deriveStructure(view);
  const seats = view.seats.length;
  let ap = 0, tot = 0;
  stx.team_votes.forEach(function (v) {
    const n = Object.keys(v.votes).length;
    ap += countApprovals(v.votes); tot += n;
  });
  const observed = tot ? wilson(ap, tot) : null;
  const mObs = stx.missions.length;
  const mFail = stx.missions.filter(function (m) { return m.result === "fail"; }).length;
  const evilCount = PRIOR.evil_seat_base[seats] !== undefined ? PRIOR.evil_seat_base[seats] * seats : null;
  return {
    adapter: ADAPTER_ID, game_id: view.game_id, layer: LAYER, engine: ENGINE,
    cutoff: view.cutoff_seq, seat_count: seats,
    priors: {
      approve_rate: PRIOR.approve_rate,
      mission_fail_given_evil: PRIOR.mission_fail_given_evil,
      evil_seat_share: seats ? Number((evilCount === null ? null : evilCount / seats).toFixed(4)) : null,
    },
    observed: {
      team_votes: tot, approvals: ap, approve_rate: observed,
      missions: mObs, mission_fail_rate: mObs ? wilson(mFail, mObs) : null,
      sample_note: mObs < 30 ? "n<30：Wilson 区间仅描述性（K F13 准入线）" : null,
    },
    per_question: {
      mission_fail_Rk: { prior: Number((1 - Math.pow(1 - PRIOR.mission_fail_given_evil, 1)).toFixed(4)), note: "含邪恶队伍任务的失败先验(朴素上界)；经验率走 observed.mission_fail_rate" },
      team_approved_Rk: { prior: PRIOR.approve_rate, note: "公开规则常识级先验；同局经验率走 observed.approve_rate" },
      expelled_seat_Rk: { prior: seats ? Number((1 / seats).toFixed(4)) : null, note: "多分类题：均匀先验 1/席数；同局未见出局行" },
      assassin_target_evil: { prior: seats ? Number((evilCount / seats).toFixed(4)) : null, note: "刺杀命中邪恶的先验=邪恶席位占比" },
    },
    baseline_brier_ref: ADAPTER_ID + ":v1",
  };
}
function cloneQ(q) { return JSON.parse(JSON.stringify(q)); }
// ── 自反暴露度（L4 语义；审计器 §1.8 + §6.1-6 处置）────────────────────────────────
function exposureOfView(view, raw) {
  const e = raw || {};
  const pub = e.publicExposure === undefined || e.publicExposure === null ? 0 : Number(e.publicExposure);
  const breach = e.breach === undefined || e.breach === null ? 0 : Number(e.breach);
  return {
    adapter: ADAPTER_ID, game_id: view.game_id,
    layer: "L4", secondary_layer: LAYER,          // L4 叠加层语义：primary=底层(L6)，secondary=L4
    public_exposure: pub === 1 ? 1 : 0,
    reflexivity_exposure: pub === 1 ? "high" : "low",
    reflexivity_breach: breach === 1 ? 1 : 0,
    published_at: e.publishedAt === undefined ? null : e.publishedAt,
    share_channel_allowed: false,                  // 铁律工程面：L4 默认私有 + UI 禁分享按钮
    iso_scope_if_breach: breach === 1 ? (ADAPTER_ID + ":" + (e.domain || "default")) : null, // 同域隔离统计
    policy: "L4 默认 private_exposure=0；公开=把预测变成系统的输入，污染后续所有域内数据",
    cutoff: view.cutoff_seq, events_in_window: view.events.length,
  };
}

// ── 五方法契约（S2 §1.2）──────────────────────────────────────────────────────
/** ① 列出该局可出的待判题（幂等：视图相同 → 输出逐位相同） */
function listOpenQuestions(gameId, opts) {
  const src = getSource(gameId, opts);
  const view = loadView(gameId, src);
  const key = String(gameId);
  const raw = questionsFromView(view);
  const kept = [], rejected = [];
  raw.forEach(function (q) {
    // Gate-Anchor Q0-1：需真值记录才可判的题型，语料无真值 → 源头拒收（reason=no_anchor）
    const needsTruth = q.type === "assassin_target_evil";
    const truth = src.truth || {};
    const hasTruth = truth.seat_allegiance || (Array.isArray(truth.evil_seats) && truth.evil_seats.length) || truth.roles;
    if (needsTruth && !hasTruth) { rejected.push({ qid: q.qid, reason: "no_anchor" }); return; }
    const verdict = judgeQuestion(q, src);
    if (verdict.status === "void") { rejected.push({ qid: q.qid, reason: verdict.reason }); return; } // 已由规则裁定出局
    kept.push(q);
    REGISTRY.set(q.qid, { q: cloneQ(q), game_id: key });
  });
  // 生成阶段即被规则裁掉/无锚的轮次：同样进拒收留痕（审计器 §4 防 Goodhart ②拒收题必须记 reason）
  const stx = deriveStructure(view);
  stx.nominations.forEach(function (n) {
    const v = stx.team_votes.filter(function (x) { return x.round === n.round; })[0];
    if (!v) return;
    const approved = countApprovals(v.votes) > (Object.keys(v.votes).length - countApprovals(v.votes));
    const done = stx.missions.some(function (m) { return m.round === n.round; });
    if (!approved && !done) {
      rejected.push({ qid: key + ":mission_fail_Rk:R" + n.round, reason: "team_rejected_no_mission" });
    }
  });
  LAST_SRC.set(key, src);
  Object.defineProperty(kept, "rejected", { value: rejected, enumerable: false });
  return kept;
}
/** ② 机检 resolve（无锚=pending；cutoff 晚于锚=void(leak)；断言未命中状态） */
function resolveQuestion(qid, opts) {
  const rec = REGISTRY.get(String(qid));
  if (!rec) return { qid: String(qid), status: "void", outcome: null, reason: "unknown_qid" };
  const src = (opts && opts.src) ? opts.src : LAST_SRC.get(rec.game_id);
  const res = judgeQuestion(rec.q, src);
  return Object.assign({
    qid: String(qid), game_id: rec.q.game_id, statement: rec.q.statement, type: rec.q.type,
    layer: LAYER, engine: ENGINE, checklist_hash: CHECKLIST_HASH, cutoff: rec.q.cutoff,
  }, res);
}
/** ③ 截止 cutoff 的特征包（只吃公开信息；cutoff=seq 或 "D3"） */
function featurePack(gameId, cutoff, opts) {
  const src = Object.assign({}, getSource(gameId, opts), { cutoff: cutoff === undefined ? null : cutoff });
  return buildFeaturePack(loadView(gameId, src));
}
/** ④ 该局基率（先验 + 同局公开统计 + Wilson） */
function baseline(gameId, opts) {
  const src = (opts && opts.cutoff !== undefined) ? Object.assign({}, getSource(gameId, opts), { cutoff: opts.cutoff }) : getSource(gameId, opts);
  return baselineOfView(loadView(gameId, src));
}
/** ⑤ 自反暴露度（L4） */
function exposure(gameId, opts) {
  const src = getSource(gameId, opts);
  const view = loadView(gameId, src);
  return exposureOfView(view, (opts && opts.exposure) || src.exposure || {});
}
// ── schema 复用声明（本棒零迁移；声明即证据）────────────────────────────────────────
const SCHEMA_REUSE = {
  declared_changes: 0,
  reused: {
    games: "原样（type 走既有 games.game_type，值 'avalon' 无需枚举改动）",
    players: "原样（座位号 seat 语义直接可用）",
    events: "原样复用：type='statement'/'vote'/'death'/'claim'/'system'；phase 仍 night/day/dusk",
    claims: "原样复用：predicate='claims_role' 承载角色声称，object 走 VOCAB.avalon.role_norm",
    actions: "原样复用：action='vote'/'abstain' 承载队伍表决单席行为（若宿主逐席落 actions）",
    predictions: "原样复用：layer=L6 / secondary_layer=null / engine='structural' / public_exposure 0|1 / checklist_hash='avalon-v1'",
  },
  needs_extension: [
    { item: "nominate_team 行动", resolved_by: "events.type='system' + raw_text 前缀「提名：R3队=[2,4]」（EVENT_TYPES/ACTION_KINDS 两个 CHECK 枚举零改动）" },
    { item: "mission 结果", resolved_by: "events.type='system' + raw_text 前缀「任务：R2队=fail」" },
    { item: "刺杀/出局", resolved_by: "events.type='system' + raw_text 前缀「刺杀：3」「出局：2」" },
  ],
  reuse_rate_note: "表结构 6/6 原样复用（0 迁移）；语义扩展 3 项全部走 system 事件文本前缀，不动任何 CHECK 约束",
};

module.exports = {
  ADAPTER_ID: ADAPTER_ID, LAYER: LAYER, SECONDARY_LAYER: SECONDARY_LAYER, ENGINE: ENGINE,
  CHECKLIST_HASH: CHECKLIST_HASH, QTYPES: QTYPES, PRIOR: PRIOR, SCHEMA_REUSE: SCHEMA_REUSE,
  listOpenQuestions: listOpenQuestions, resolveQuestion: resolveQuestion,
  featurePack: featurePack, baseline: baseline, exposure: exposure,
  // 自检/内部件（便于测试与宿主注入）
  registerSource: registerSource, _sources: SOURCES, _registry: REGISTRY,
  _loadView: loadView, _deriveStructure: deriveStructure, _parseSystemLine: parseSystemLine,
  _buildFeaturePack: buildFeaturePack, _judgeQuestion: judgeQuestion, _wilson: wilson,
  _reset: function () { SOURCES.clear(); REGISTRY.clear(); LAST_SRC.clear(); },
};
// ── 内存 fixture（6 人阿瓦隆；阿瓦隆语料尚未入库，本棒零 db）──────────────────────────
function fixtureFull() {
  return {
    game: { id: 9001, name: "fixture-avalon-6p", game_type: "avalon", player_count: 6 },
    players: [
      { seat: 1, name: "P1" }, { seat: 2, name: "P2" }, { seat: 3, name: "P3" },
      { seat: 4, name: "P4" }, { seat: 5, name: "P5" }, { seat: 6, name: "P6", is_evil: true },
    ],
    events: [
      { id: 1, day: 1, phase: "day", seq: 1, type: "system", actor_seat: 1, raw_text: "提名：R1队=[1,2]" },
      { id: 2, day: 1, phase: "day", seq: 2, type: "vote", actor_seat: 1, raw_text: '表决：R1队={1:"approve",2:"approve",3:"reject",4:"reject",5:"approve",6:"reject"}' },
      { id: 3, day: 1, phase: "day", seq: 3, type: "system", actor_seat: null, raw_text: "出局：3" },
      { id: 4, day: 2, phase: "day", seq: 4, type: "system", actor_seat: 2, raw_text: "提名：R2队=[2,5]" },
      { id: 5, day: 2, phase: "day", seq: 5, type: "vote", actor_seat: 2, raw_text: '表决：R2队={1:"approve",2:"approve",3:"approve",4:"reject",5:"approve",6:"reject"}' },
      { id: 6, day: 2, phase: "day", seq: 6, type: "system", actor_seat: null, raw_text: "任务：R2队=fail" },
      { id: 7, day: 2, phase: "day", seq: 7, type: "statement", actor_seat: 4, raw_text: "4 号：我认为 2 号有问题" },
      { id: 8, day: 2, phase: "day", seq: 8, type: "claim", actor_seat: 1, raw_text: "1 号：我是梅林" },
      { id: 9, day: 3, phase: "day", seq: 9, type: "system", actor_seat: null, raw_text: "刺杀：1" },
    ],
    claims: [
      { id: 1, event_id: 8, seat: 1, subject_seat: 1, predicate: "claims_role", object: "梅林" },
      { id: 2, event_id: 7, seat: 4, subject_seat: 2, predicate: "is_evil", object: "1" },
      { id: 3, event_id: 7, seat: 4, subject_seat: 5, predicate: "claims_role", object: "莫德雷德" },
    ],
    actions: [{ id: 1, event_id: 2, seat: 1, action: "vote", target_seat: null, result: "approve" }],
    truth: { evil_seats: [2, 5], seat_allegiance: { 1: "good", 2: "evil", 3: "good", 4: "good", 5: "evil", 6: "good" } },
    exposure: { publicExposure: 0, breach: 0, domain: "avalon" },
  };
}
/** 阶段源：截到 seq：A=2（提名+否决表决，无出局）B=8（含出局/任务/声称）C=9（含刺杀） */
function fixtureAt(seq) { const f = fixtureFull(); f.cutoff = seq; return f; }
// ── 内存自检：node p1b/src/adapters/avalon.js（零 db、零 LLM、零网络）──────────────────
function brief(o) {
  const t = JSON.stringify(o);
  return t.length > 300 ? t.slice(0, 300) + "…(" + t.length + "B)" : t;
}
function selfTest() {
  const fails = [];
  const chk = function (name, cond, detail) { if (!cond) fails.push(name + " :: " + detail); console.log((cond ? "  [ok] " : "  [FAIL] ") + name + (detail ? " — " + detail : "")); };
  console.log("=== avalon adapter self-test (fixture 9001, 6 players, zero db) ===");

  // ① listOpenQuestions：cutoff=2（A 阶段）与全量视图
  registerSource(9001, fixtureAt(2));
  const qsA = listOpenQuestions(9001);
  console.log("\n[1] listOpenQuestions(9001) @cutoff=2 → " + qsA.length + " 题");
  qsA.forEach(function (q) { console.log("    " + q.qid + " | cutoff.seq=" + q.cutoff.seq + " | anchor.kind=" + q.anchor.kind + " | layer=" + q.layer + " | " + q.statement.slice(0, 46) + "…"); });
  chk("listOpenQuestions 非空（@cutoff=2 → 2 题）", qsA.length === 2, "n=" + qsA.length);
  chk("题结构完整", qsA.every(function (q) { return q.qid && q.statement && q.cutoff && q.anchor && q.layer === "L6" && q.checklist_hash; }), brief(qsA[0]));
  chk("cutoff 不晚于锚（Q0-2 禁事后诸葛）", qsA.every(function (q) { return q.cutoff.seq <= q.anchor.anchor_seq; }), "cutoff=" + qsA.map(function (q) { return q.cutoff.seq + "/" + q.anchor.anchor_seq; }).join(","));

  registerSource(9001, fixtureFull());
  const qsFull = listOpenQuestions(9001);
  console.log("    全量视图 → " + qsFull.length + " 题（锚已出：可判题全部退场，已知真值不可再作预测题）");
  chk("全量视图可判题退场", qsFull.length === 0, "n=" + qsFull.length);
  registerSource(9001, fixtureAt(8));
  const qsB = listOpenQuestions(9001);
  const rejB = qsB.rejected || [];
  console.log("    @cutoff=8 → " + qsB.length + " 题: [" + qsB.map(function (q) { return q.type + ":" + q.arg; }).join(", ") + "] 拒收留痕: [" + rejB.map(function (x) { return x.qid + "=" + x.reason; }).join(", ") + "]");
  chk("拒收留痕带 reason（已由规则裁定的题零产出）", rejB.length === 1 && rejB[0].reason === "team_rejected_no_mission", JSON.stringify(rejB));
  const noAnchor = listOpenQuestions(9001, { src: Object.assign(fixtureAt(8), { truth: null }) });
  chk("缺真值记录 → 刺杀题源头拒收(no_anchor)", (noAnchor.rejected || []).some(function (x) { return x.reason === "no_anchor"; }) && noAnchor.length === 0, JSON.stringify(noAnchor.rejected));
  registerSource(9001, fixtureFull());
  listOpenQuestions(9001);

  // ② resolveQuestion：resolved / pending / leak 三种机检状态
  console.log("\n[2] resolveQuestion 机检");
  const rRes = resolveQuestion("9001:expelled_seat_Rk:R1");
  console.log("    resolved ?", brief(rRes));
  chk("expelled_seat_Rk → resolved(1)（R1 否决后出局 3 席）", rRes.status === "resolved" && rRes.outcome === 1, rRes.reason || "");
  const rAss = resolveQuestion("9001:assassin_target_evil:final");
  console.log("    assassin  ?", brief(rAss));
  chk("assassin_target_evil → resolved(0=good)", rAss.status === "resolved" && rAss.outcome === 0 && rAss.truth.allegiance === "good", rAss.reason || "");
  const rPend = judgeQuestion({ game_id: 9001, type: "mission_fail_Rk", arg: "R3", cutoff: { seq: 6 } }, fixtureFull());
  console.log("    pending  ?", brief(rPend));
  chk("mission_fail_Rk:R3 → pending（无锚=无真值锚禁入）", rPend.status === "pending" && rPend.outcome === null, rPend.reason || "");
  const rVoid = judgeQuestion({ game_id: 9001, type: "mission_fail_Rk", arg: "R1", cutoff: { seq: 2 } }, fixtureFull());
  console.log("    void     ?", brief(rVoid));
  chk("队伍被否决 → void(team_rejected_no_mission)", rVoid.status === "void" && rVoid.reason === "team_rejected_no_mission", rVoid.reason || "");
  const rLeak = judgeQuestion({ game_id: 9001, type: "mission_fail_Rk", arg: "R2", cutoff: { seq: 8 } }, fixtureFull());
  console.log("    leak     ?", brief(rLeak));
  chk("cutoff 晚于锚 → void(leak)", rLeak.status === "void" && rLeak.reason === "leak", rLeak.reason || "");
  const rUnknown = resolveQuestion("nope:unknown:x");
  chk("未知 qid → void(unknown_qid)", rUnknown.status === "void" && rUnknown.reason === "unknown_qid", rUnknown.reason || "");

  // ③ featurePack
  console.log("\n[3] featurePack");
  const fp = featurePack(9001, 5);
  console.log("    @cutoff=5 …", brief(fp));
  chk("featurePack 非空且结构正确", fp && fp.beliefs && fp.derived && fp.contradictions && Array.isArray(fp.feature_vector) && fp.feature_vector.length === 5, "keys=" + Object.keys(fp).join(","));
  chk("cutoff 截断生效", fp.public_counts.events < fixtureFull().events.length && fp.derived.missions.length === 0, "events=" + fp.public_counts.events + " missions=" + fp.derived.missions.length);
  const fpFull = featurePack(9001, null);
  console.log("    @全量 beliefs[1]=" + JSON.stringify(fpFull.beliefs[1]) + " contradictions=" + JSON.stringify(fpFull.contradictions.summary));
  chk("真值盲：注入行含 is_evil → 已剥离并计数", fpFull.truth_blind.stripped_fields === 1 && fpFull.truth_blind.stripped_keys.join() === "is_evil", JSON.stringify(fpFull.truth_blind));
  chk("词表复用：莫德雷德→evil", JSON.stringify(fpFull.beliefs[4].claims).indexOf("alleg_claim:evil") >= 0, JSON.stringify(fpFull.beliefs[4].claims));

  // ④ baseline
  console.log("\n[4] baseline");
  const bl = baseline(9001);
  console.log("    " + brief(bl));
  chk("baseline 非空且结构正确", bl && bl.priors && bl.observed && bl.per_question && bl.observed.approve_rate, "keys=" + Object.keys(bl).join(","));
  chk("Wilson 区间带 n", bl.observed.approve_rate && bl.observed.approve_rate.n === 12, JSON.stringify(bl.observed.approve_rate));
  chk("四类题基率齐备", ["mission_fail_Rk", "team_approved_Rk", "expelled_seat_Rk", "assassin_target_evil"].every(function (k) { return bl.per_question[k] && bl.per_question[k].prior !== undefined; }), Object.keys(bl.per_question).join(","));

  // ⑤ exposure
  console.log("\n[5] exposure");
  const ex = exposure(9001);
  console.log("    default  …", brief(ex));
  chk("默认 L4 私有 + 禁分享", ex.public_exposure === 0 && ex.reflexivity_exposure === "low" && ex.share_channel_allowed === false, JSON.stringify(ex));
  const ex2 = exposure(9001, { exposure: { publicExposure: 1, breach: 1, domain: "avalon", publishedAt: "2026-09-13T00:00:00Z" } });
  console.log("    breach   …", brief(ex2));
  chk("公开+泄漏 → high/1 + 同域隔离", ex2.public_exposure === 1 && ex2.reflexivity_breach === 1 && ex2.iso_scope_if_breach === "avalon:avalon", JSON.stringify(ex2.iso_scope_if_breach));

  // ⑥ schema 复用声明
  console.log("\n[6] schema 复用声明: declared_changes=" + SCHEMA_REUSE.declared_changes + " | reused=" + Object.keys(SCHEMA_REUSE.reused).length + " 表 | needs_extension=" + SCHEMA_REUSE.needs_extension.length + " 项（全部走 system 事件文本）");
  chk("零迁移声明", SCHEMA_REUSE.declared_changes === 0, "declared_changes=" + SCHEMA_REUSE.declared_changes);

  console.log("\n=== self-test " + (fails.length ? "FAIL(" + fails.length + ")" : "PASS(20 断言)") + " ===");
  return { ok: fails.length === 0, fails: fails };
}
if (require.main === module) { const r = selfTest(); process.exitCode = r.ok ? 0 : 1; }
module.exports._selfTest = selfTest;
module.exports._fixture = { fixtureFull: fixtureFull, fixtureAt: fixtureAt };
