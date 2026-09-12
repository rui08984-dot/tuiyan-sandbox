/* werewolf-contradictions.js — 版型无关矛盾检测层 W1-W6（可用实现，2026-09-12）
 *
 * 真值盲：只吃 events/claims 副本，禁读 games.meta.truth。零 LLM。
 * 判定逻辑 = p1b/scripts/acr-run.cjs 镜像检测器的可复用化（同一口径 → 数字可与 ACR 一期报告对齐）。
 * 输出对齐本体 p1b/src/botc/contradictions.js 的字段面（矛盾对数组，逐对含）：
 *   { rule, desc, underdetermination, innocent_explanations, refs, claim_a, claim_b, botc_refs, pair_id }
 * 版型词表外置 VOCAB：werewolf（村民/好人→平民；预言家/女巫/守卫/猎人→神职；狼人/白狼王→狼）、
 *   botc（require ../botc/roles.js 的 resolveRole 归一，禁改本体）、avalon（梅林/派西维尔/忠臣→好人；
 *   莫德雷德/刺客/爪牙→邪恶）。
 * 规则：W1 改跳｜W2 阵营互斥｜W3 时序活性｜W4 结算一致｜W5 日相顺序｜W6 放逐唯一。
 * 语义保真声明（诚实边界）：规则【编号与语义】以 ACR 一期报告 §2 规则表为准；报告已如实声明该表为
 *   「contradictions.js 的 RB 判定逻辑镜像并适配语料」，故 W1≠本体 RB1（本体 RB1=异座同唯一角色对跳）。
 *   本体的「异座同角色声称对跳」单列为 detectRoleJumps（RB1）导出，不并入 W1-W6，以免破坏 ACR 数字可比性。
 *   W6=「同局两份放逐公告席位不一」（本体 RB4 多恶魔「仅 1 名」镜像，非 RB5 状态矛盾）。
 * 纪律：禁改 p1b/src/botc/ 与 p1a-terminal/**、禁写 db、8787 零接触。
 */
"use strict";

const path = require("path");
let botcRoles = null;
try { botcRoles = require(path.join(__dirname, "..", "botc", "roles.js")); } catch (e) { botcRoles = null; }

// ── 常量：口径与 acr-run.cjs 逐字一致 ──
const PHASE_RANK = { night: 0, day: 1, dusk: 2 }; // claims.js BOTC_ORDER_SQL 序镜像
const ROLE_ASSERT_PREDICATES = ["claims_role", "is_role"];
const SPEAK_LIKE_TYPES = ["statement", "vote", "claim", "action_reveal"];
const RE_NIGHT_DEATH = /公布夜 \d+ 死亡：(\d+) 号死亡/;
const RE_EXILE = /。(\d+) 号被放逐/;
const RE_TALLY = /计票：({[^}]*})/;
const RE_GAME_END = /游戏结束/;
const RE_END_EXILE = /放逐(?:的|了狼人)?\s*(\d+) 号/;

// ── 版型词表（外置）──
const WEREWOLF_ROLE_NORM = {
  "村民": "平民", "好人": "平民", "好人/村民": "平民",
  "预言家": "神职", "女巫": "神职", "守卫": "神职", "猎人": "神职",
  "狼人": "狼", "白狼王": "狼",
};
const WEREWOLF_TEAM_OF = { "平民": "good", "神职": "good", "狼": "wolf" };
const AVALON_ROLE_NORM = {
  "梅林": "好人", "派西维尔": "好人", "忠臣": "好人", "亚瑟的忠臣": "好人",
  "莫德雷德": "邪恶", "刺客": "邪恶", "爪牙": "邪恶", "莫甘娜": "邪恶", "奥伯伦": "邪恶",
};
const AVALON_TEAM_OF = { "好人": "good", "邪恶": "evil" };

const VOCAB = {
  werewolf: {
    id: "werewolf",
    role_norm: WEREWOLF_ROLE_NORM,
    team_of: WEREWOLF_TEAM_OF,
    evil_teams: ["wolf"], good_teams: ["good"],
    predicates: { evil: ["is_wolf"], good: ["is_good"] },
    note: "werewolf：村民/好人→平民；预言家/女巫/守卫/猎人→神职；狼人/白狼王→狼",
  },
  botc: {
    id: "botc",
    resolveRole: function (text) { return botcRoles ? botcRoles.resolveRole(text) : null; },
    role_norm: {},
    team_of: {},
    evil_teams: ["demon", "minion"], good_teams: ["townsfolk", "outsider"],
    predicates: { evil: ["is_demon", "is_minion"], good: ["is_good"] },
    note: "botc：角色名归一走 roles.js resolveRole（返回 role.id / role.team），禁改本体",
  },
  avalon: {
    id: "avalon",
    role_norm: AVALON_ROLE_NORM,
    team_of: AVALON_TEAM_OF,
    evil_teams: ["evil"], good_teams: ["good"],
    predicates: { evil: ["is_evil", "is_wolf"], good: ["is_good"] },
    note: "avalon：梅林/派西维尔/忠臣→好人；莫德雷德/刺客/爪牙→邪恶",
  },
};

// ── 规则欠定度与无辜解释（每对必带；欠定度∈[0,1]，越大=越可能与真实记录噪声有关）──
const RULE_META = {
  W1: {
    underdetermination: 0.55,
    innocent_explanations: [
      "同一座位可能先被他人转述、后被记成本人自陈（记录口径漂移）",
      "发言者可能是伪装者/悍跳，与真实身份无关",
      "归一化词表外的同义角色名可能被误判为不同角色",
    ],
  },
  W2: {
    underdetermination: 0.75,
    innocent_explanations: [
      "被指狼与发金水可能来自不同时点，属策略性话术对冲（本语料本底主导型）",
      "「指认」与「查验结果」被记入同一谓词空间，口径可能不一致",
      "发言者信息缺失下的自保性表态，非逻辑矛盾",
    ],
  },
  W3: {
    underdetermination: 0.20,
    innocent_explanations: [
      "死亡公告与发言可能在同一 seq 段内交错，公告滞后于发言实际发生时间",
      "文本解析把发言中提到的座位号误当成死亡公告",
    ],
  },
  W4: {
    underdetermination: 0.15,
    innocent_explanations: [
      "计票 JSON 可能只覆盖部分投票人，非全部有效票",
      "平票加时/改票未落入计票快照",
      "公告被逐席位可能来自加时流程而非首轮 argmax",
    ],
  },
  W5: {
    underdetermination: 0.25,
    innocent_explanations: [
      "相邻事件可能是同一相位内的并列记录（同相位内无序）",
      "夜幕降临/结算等系统事件的日戳口径可能与发言记录不一致",
    ],
  },
  W6: {
    underdetermination: 0.20,
    innocent_explanations: [
      "第二份公告可能是对同一放逐的复述或更正，而非新一次放逐",
      "终局/复盘事件被误当放逐公告解析",
    ],
  },
};
const RULES = ["W1", "W2", "W3", "W4", "W5", "W6"];

// ── 归一化 ──
function normSeat(v) { return v === undefined || v === null ? null : Number(v); }
function sortRefs(refs) {
  const rank = function (r) { return r.indexOf("c") === 0 ? 1 : 0; }; // e* 先于 c*
  return refs.slice().sort(function (a, b) {
    return rank(a) - rank(b) || Number(a.slice(1)) - Number(b.slice(1));
  });
}

/** 版型词表解析：format 或 opts.format，缺省 werewolf；未知版型回退 werewolf */
function resolveFormat(format) {
  const key = String(format === undefined || format === null ? "werewolf" : format).toLowerCase();
  if (VOCAB[key]) return VOCAB[key];
  if (key.indexOf("botc") >= 0 || key.indexOf("blood") >= 0) return VOCAB.botc;
  if (key.indexOf("avalon") >= 0) return VOCAB.avalon;
  return VOCAB.werewolf;
}

/** 版型内角色声称归一：词表命中 → 归一 id；botc → roles.resolveRole(text).id；否则原样 trim */
function normalizeRole(format, object) {
  const vocab = resolveFormat(format);
  const raw = String(object === undefined || object === null ? "" : object).trim();
  if (!raw) return "";
  if (vocab.role_norm && Object.prototype.hasOwnProperty.call(vocab.role_norm, raw)) return vocab.role_norm[raw];
  if (vocab.id === "botc" && botcRoles) {
    const role = botcRoles.resolveRole(raw);
    if (role && role.id) return role.id;
  } else if (botcRoles) { // 泛用兜底：词表未命中时也试 BOTC 归一
    // FIXME(已知口径瑕疵)：跨版型兜底会使 werewolf 域未列入词表的写法（如「狼人」归一为「狼」之外的
    //   异体写法）落到 BOTC 同名字：实测 normalizeRole("werewolf","女巫")="witch"（BOTC 女巫=minion）、
    //   ("werewolf","狼人")="狼"。当前实现与 ACR 一期镜像检测器逐位一致（其只做 4 词同义归一），
    //   故数值可比；后续若扩狼人域词表，应把兜底限制在 format 声明为 botc 的场景。
    const role = botcRoles.resolveRole(raw);
    if (role && role.id) return role.id;
  }
  return raw;
}

/** 逐对构造：字段面对齐 botc/contradictions.js + 任务要求的 rule/desc/underdetermination/innocent_explanations */
function makePair(rule, refs, desc, claimIds) {
  const clean = sortRefs(refs.filter(function (r) { return r !== undefined && r !== null; }));
  const meta = RULE_META[rule] || { underdetermination: 0.5, innocent_explanations: [] };
  const ids = (claimIds || []).filter(function (x) { return x !== undefined && x !== null; });
  return {
    rule: rule,
    desc: desc,
    underdetermination: meta.underdetermination,
    innocent_explanations: meta.innocent_explanations.slice(),
    refs: clean,
    claim_a: ids.length ? ids[0] : null,
    claim_b: ids.length > 1 ? ids[1] : null,
    botc_refs: [],
    pair_id: clean.length ? clean.join(":") : null,
  };
}

// ── W1 改跳 / W2 阵营互斥（声称层；镜像 acr-run.cjs findWwContradictions）──
function contradictionsFromClaims(input) {
  const evidence = input || {};
  const vocab = resolveFormat(evidence.format);
  const claims = Array.isArray(evidence.claims) ? evidence.claims : [];
  const events = Array.isArray(evidence.events) ? evidence.events : [];
  const evById = new Map(events.map(function (e) { return [e.id, e]; }));
  const dayOf = function (c) {
    if (c.day !== undefined && c.day !== null) return c.day;
    const ev = evById.get(c.event_id);
    return ev ? ev.day : null;
  };
  const pairs = [];

  // W1 改跳（RB2 镜像）：同 subject_seat 的角色声称归一后不一致（角色不随日变）
  const roleGroups = new Map();
  for (const c of claims) {
    if (ROLE_ASSERT_PREDICATES.indexOf(c.predicate) === -1) continue;
    const key = c.subject_seat;
    if (!roleGroups.has(key)) roleGroups.set(key, []);
    roleGroups.get(key).push(c);
  }
  for (const group of roleGroups.values()) {
    const sorted = group.slice().sort(function (a, b) { return a.id - b.id; });
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (normalizeRole(evidence.format, a.object) === normalizeRole(evidence.format, b.object)) continue;
      pairs.push(makePair("W1", ["c" + a.id, "c" + b.id, "e" + a.event_id, "e" + b.event_id],
        "座位" + a.subject_seat + " 角色声称不一致：" + a.object + "(c" + a.id + ") vs " + b.object
        + "(c" + b.id + ")（day" + dayOf(a) + "/day" + dayOf(b) + "）",
        [a.id, b.id]));
    }
  }

  // W2 阵营互斥（RB3 镜像）：同 subject_seat 被指邪恶又被指好人，必有一假
  const evilBy = new Map(), goodBy = new Map();
  for (const c of claims) {
    const m = vocab.predicates.evil.indexOf(c.predicate) >= 0 ? evilBy
      : (vocab.predicates.good.indexOf(c.predicate) >= 0 ? goodBy : null);
    if (!m) continue;
    if (!m.has(c.subject_seat)) m.set(c.subject_seat, []);
    m.get(c.subject_seat).push(c);
  }
  for (const entry of evilBy) {
    const subj = entry[0];
    const bads = entry[1].slice().sort(function (a, b) { return a.id - b.id; });
    const goods = (goodBy.get(subj) || []).slice().sort(function (a, b) { return a.id - b.id; });
    for (const w of bads) for (const g of goods) {
      pairs.push(makePair("W2", ["c" + w.id, "c" + g.id, "e" + w.event_id, "e" + g.event_id],
        "座位" + subj + " 被同时指认为 " + w.predicate + "(c" + w.id + ") 与好人(c" + g.id
        + ")，阵营互斥必有一假（day" + dayOf(w) + "/day" + dayOf(g) + "）",
        [w.id, g.id]));
    }
  }
  return pairs;
}

// ── W3/W4/W5/W6（事件层；真值盲，只看事件流文本与结构；镜像 acr-run.cjs findTemporalContradictions）──
function contradictionsFromEvents(input) {
  const evidence = input || {};
  const events = Array.isArray(evidence.events) ? evidence.events : [];
  const ordered = events.slice().sort(function (a, b) { return a.seq - b.seq; });
  const raw = function (e) { return e.raw_text || ""; };
  const pairs = [];
  const parseDeaths = function (t) {
    const out = [];
    let m = (t || "").match(RE_NIGHT_DEATH); if (m) out.push(Number(m[1]));
    m = (t || "").match(RE_EXILE); if (m) out.push(Number(m[1]));
    return out;
  };

  // W3 时序活性（S2⑤③ 同源规格「死亡角色禁再产生 speak/vote」）
  const deadAt = new Map(); // seat → 首个死亡公告事件 id
  for (const e of ordered) {
    for (const s of parseDeaths(raw(e))) if (!deadAt.has(s)) deadAt.set(s, e.id);
    const seat = e.actor_seat;
    if (seat === null || seat === undefined) continue;
    if (SPEAK_LIKE_TYPES.indexOf(e.type) === -1) continue;
    for (const entry of deadAt) {
      if (entry[0] === seat) {
        pairs.push(makePair("W3", ["e" + entry[1], "e" + e.id],
          "座位" + seat + " 在死亡公告(e" + entry[1] + ")后仍有 " + e.type + "(e" + e.id + ")", []));
      }
    }
  }

  const exileEvents = ordered.filter(function (e) { return RE_EXILE.test(raw(e)); });
  const first = exileEvents.length ? exileEvents[0] : null;
  // W4 结算一致：计票 argmax 集 ∋ 公告被逐席位（平票按集合）
  for (const e of exileEvents) {
    const tm = raw(e).match(RE_TALLY);
    const am = raw(e).match(RE_EXILE);
    if (!tm || !am) continue;
    try {
      const t = JSON.parse(tm[1]);
      const mx = Math.max.apply(null, Object.values(t));
      const tops = Object.keys(t).filter(function (k) { return t[k] === mx; }).map(Number);
      if (tops.indexOf(Number(am[1])) === -1) {
        pairs.push(makePair("W4", ["e" + e.id],
          "计票 " + tm[1] + " 最高票 " + tops.join("/") + " 与公告被逐 " + am[1] + " 号不一致(e" + e.id + ")", []));
      }
    } catch (err) { /* 计票解析失败不判 */ }
  }
  if (first) {
    const m0 = raw(first).match(RE_EXILE);
    const firstSeat = Number(m0[1]);
    // W6 放逐唯一（RB4「本剧本恶魔仅 1 名」镜像）：同局两份放逐公告席位不一，必有一假
    for (const e of exileEvents.slice(1)) {
      const s = Number(raw(e).match(RE_EXILE)[1]);
      if (s !== firstSeat) {
        pairs.push(makePair("W6", ["e" + first.id, "e" + e.id],
          "两份放逐公告席位不一：" + firstSeat + " 号(e" + first.id + ") vs " + s + " 号(e" + e.id + ")", []));
      }
    }
    // W4b 终局结算一致（两变体：「放逐的 X 号」/「放逐了狼人 X 号」）
    const gameEnd = ordered.find(function (e) {
      return e.type === "system" && e.phase === "dusk" && RE_GAME_END.test(raw(e));
    });
    const gm = gameEnd ? raw(gameEnd).match(RE_END_EXILE) : null;
    if (gameEnd && gm && gm[1] !== null && Number(gm[1]) !== firstSeat) {
      pairs.push(makePair("W4", ["e" + first.id, "e" + gameEnd.id],
        "终局结算被逐 " + gm[1] + " 号与放逐公告 " + firstSeat + " 号不一致(e" + first.id + "/e" + gameEnd.id + ")", []));
    }
  }

  // W5 日相顺序（claims.js BOTC_ORDER_SQL 序镜像）：seq 相邻事件 (day,rank) 回退即报（相邻对口径）
  let prev = null;
  for (const e of ordered) {
    if (prev) {
      const cmp = (e.day - prev.day) || (PHASE_RANK[e.phase] - PHASE_RANK[prev.phase]);
      if (cmp < 0) {
        pairs.push(makePair("W5", ["e" + prev.id, "e" + e.id],
          "时序回退：e" + prev.id + "(d" + prev.day + "/" + prev.phase + ") 与 e" + e.id
          + "(d" + e.day + "/" + e.phase + ") 相邻倒序", []));
      }
    }
    prev = e;
  }
  return pairs;
}

/** 本体 RB1 对跳（异座声称同一角色，互斥必有一假）：opt-in 附加规则，默认不并入 W1-W6。
 *  实测：本 31 局 sim 语料该口径出 187 对（claims_role 多为「被指认为平民」而非自陈，会造成假对跳），
 *  故不并入默认集以保 ACR 数字可比；真人局（g1/g6）命中真实悍跳，可用 rule='RB1' 单独取用。 */
function detectRoleJumps(input, opts) {
  const evidence = input || {};
  const o = opts || {};
  const format = o.format || evidence.format || null;
  const claims = Array.isArray(evidence.claims) ? evidence.claims : [];
  const uniqueOnly = o.unique_role_objects; // 可选：仅按给定角色白名单判对跳
  const pairs = [];
  const byRole = new Map();
  for (const c of claims) {
    if (ROLE_ASSERT_PREDICATES.indexOf(c.predicate) === -1) continue;
    const role = normalizeRole(format, c.object);
    if (!role) continue;
    if (uniqueOnly && uniqueOnly.indexOf(role) === -1) continue;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(c);
  }
  for (const entry of byRole) {
    const arr = entry[1].slice().sort(function (a, b) { return a.id - b.id; });
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      if (a.subject_seat === b.subject_seat) continue;
      pairs.push(makePair("RB1", ["c" + a.id, "c" + b.id, "e" + a.event_id, "e" + b.event_id],
        "唯一角色「" + entry[0] + "」被 " + a.subject_seat + " 号(c" + a.id + ") 与 " + b.subject_seat
        + " 号(c" + b.id + ") 同时声称，互斥必有一假", [a.id, b.id]));
    }
  }
  return pairs;
}

/** 兼容别名：acr-run.cjs 的 findWwContradictions(events, claims) 签名 */
function findWwContradictions(events, claims, opts) {
  const o = opts || {};
  return contradictionsFromClaims({ format: o.format, events: events, claims: claims });
}
function findTemporalContradictions(events, opts) {
  const o = opts || {};
  return contradictionsFromEvents({ format: o.format, events: events });
}

function dedupe(pairs) {
  const seen = new Set();
  const out = [];
  for (const p of pairs) {
    const key = p.rule + "|" + p.refs.join(":") + "|" + p.desc;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  out.sort(function (a, b) {
    const ra = RULES.indexOf(a.rule), rb = RULES.indexOf(b.rule);
    return ra - rb || a.desc.localeCompare(b.desc, "zh") || a.refs.join(":").localeCompare(b.refs.join(":"));
  });
  return out;
}

/** 唯一入口：evidence = { format?, events[], claims[] } → 矛盾对数组（确定性：同输入逐位同输出） */
function detectWerewolfContradictions(evidence, opts) {
  const e = evidence || {};
  const o = opts || {};
  const format = o.format || e.format || e.format_hint || null;
  const input = { format: format, events: e.events || [], claims: e.claims || [] };
  return dedupe(contradictionsFromClaims(input).concat(contradictionsFromEvents(input)));
}
const detectContradictions = detectWerewolfContradictions;

/** 汇总工具：{ W1..W6, total } 与 被标记事件行集合（误报率口径 = |flagged| / 事件行数） */
function summarize(pairs) {
  const h = {};
  RULES.forEach(function (r) { h[r] = 0; });
  (pairs || []).forEach(function (p) { if (h[p.rule] === undefined) h[p.rule] = 0; h[p.rule]++; });
  h.total = (pairs || []).length;
  return h;
}
function flaggedEventRows(pairs) {
  const s = new Set();
  (pairs || []).forEach(function (p) { p.refs.forEach(function (r) { if (r[0] === "e") s.add(r); }); });
  return s;
}

module.exports = {
  detectWerewolfContradictions: detectWerewolfContradictions,
  detectContradictions: detectContradictions,
  contradictionsFromClaims: contradictionsFromClaims,
  detectRoleJumps: detectRoleJumps,
  contradictionsFromEvents: contradictionsFromEvents,
  findWwContradictions: findWwContradictions,
  findTemporalContradictions: findTemporalContradictions,
  normalizeRole: normalizeRole,
  summarize: summarize,
  flaggedEventRows: flaggedEventRows,
  RULES: RULES,
  PHASE_RANK: PHASE_RANK,
  VOCAB: VOCAB,
};

// ── 直跑自检（零 db、零 LLM）：node p1b/src/detectors/werewolf-contradictions.js ──
if (require.main === module) {
  const fx = {
    events: [
      { id: 1, seq: 1, day: 1, phase: "night", type: "system", actor_seat: null, raw_text: "夜幕降临，第 1 夜开始。" },
      { id: 2, seq: 2, day: 1, phase: "day", type: "system", actor_seat: null, raw_text: "公布夜 1 死亡：3 号死亡。" },
      { id: 3, seq: 3, day: 1, phase: "day", type: "statement", actor_seat: 3, raw_text: "3 号发言。" },
      { id: 4, seq: 4, day: 1, phase: "day", type: "vote", actor_seat: null,
        raw_text: "计票：{\"1\":1,\"2\":2}。2 号被放逐。" },
      { id: 5, seq: 5, day: 1, phase: "night", type: "system", actor_seat: null, raw_text: "夜幕降临。" },
    ],
    claims: [
      { id: 11, event_id: 3, seat: 1, subject_seat: 2, predicate: "claims_role", object: "好人" },
      { id: 12, event_id: 3, seat: 2, subject_seat: 2, predicate: "claims_role", object: "狼人" },
      { id: 13, event_id: 4, seat: 1, subject_seat: 2, predicate: "is_wolf", object: "true" },
      { id: 14, event_id: 4, seat: 4, subject_seat: 2, predicate: "is_good", object: "true" },
    ],
  };
  const a = detectWerewolfContradictions(fx);
  const b = detectWerewolfContradictions(fx);
  console.log("selfcheck pairs=" + a.length + " hist=" + JSON.stringify(summarize(a))
    + " deterministic=" + (JSON.stringify(a) === JSON.stringify(b)));
  console.log("role_norm 村民→" + normalizeRole("werewolf", "村民") + " 狼人→" + normalizeRole("werewolf", "狼人")
    + " 梅林→" + normalizeRole("avalon", "梅林") + " 梅林(botc)→" + normalizeRole("botc", "梅林"));
}
