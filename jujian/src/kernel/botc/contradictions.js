'use strict';
/**
 * p1b/src/botc/contradictions.js —— 剧本数据驱动的 BOTC 矛盾比对器（B2 棒）。
 *
 * 职责边界对齐 p1a engine（红队 RD1）：只出「字面冲突对」，不判欠定度、不生成无辜解释
 * ——由 llm.generateCards 统一补（BOTC 局 advise 预处理用本模块的输出替代
 * engine.findContradictions 的 R1/R2 werewolf 路径，engine 的 UNIQUE_ROLES 不认识血染角色）。
 *
 * 规则（剧本数据驱动，roles-zh.json 的 editions/unique_note/team 为唯一事实源）：
 *   RB1 对跳·唯一角色（主表×主表）：claims_role/is_role 声称同一 unique_note=唯一的
 *       本剧本角色、不同 subject_seat → 互斥必有一假。旅行者（非唯一）不对跳。
 *   RB2 改跳（主表×主表）：同 subject_seat + 同角色谓词 + 不同角色 → 身份不随日变，改跳即报。
 *   RB3 阵营互斥（跨主表+botc_claims）：同 subject_seat 的角色团队 × 阵营/好人指认按
 *       数据驱动矩阵相斥（好人团队×is_demon/is_minion、demon×is_good/is_minion、
 *       minion×is_good/is_demon、is_demon×is_minion、is_demon×is_good、is_minion×is_good）。
 *       旅行者 team 不参与（官方规则可任意阵营）。
 *   RB4 多恶魔（botc_claims）：本剧本恶魔仅 1 名在场，≥2 个不同 subject 被指认 is_demon → 两两互斥。
 *   RB5 状态矛盾（botc_claims）：同一天、同一来源、同一 subject 同时报醉酒与中毒 → 待查
 *       （状态可叠加，欠定度最高；交 LLM 层标注）。
 *
 * 引用记号：主表 claims → claim_a/claim_b（整数 id）；botc_claims → botc_refs 数组
 * （botc 表 id 与主表 id 空间独立，绝不能塞进 claim_a/b——共享 contradictions 表 FK 只认
 * claims/actions，saveAdvisorCard 的引用存在性校验会拒收）。仅引用 botc_claims 的冲突对
 * （botc_only）不落共享矛盾表，只挂 live 参谋卡；含主表引用的对可持久化存档。
 * pair_id 记号：c<claimId> / b<botcClaimId> 连缀。
 */
const roles = require('./roles');

const ROLE_ASSERT_PREDICATES = ['claims_role', 'is_role'];

function normSeat(v) { return v === undefined || v === null ? null : Number(v); }

/** team → 相斥矩阵（数据驱动：好团队/恶魔/爪牙各自的互斥指认集合） */
const TEAM_CONFLICTS = {
  townsfolk: ['is_demon', 'is_minion'],
  outsider: ['is_demon', 'is_minion'],
  demon: ['is_good', 'is_minion'],
  minion: ['is_good', 'is_demon'],
  // traveler 不参与（官方规则：旅行者阵营任意）
};

function findBotcContradictions(input) {
  input = input || {};
  const script = input.script;
  const claims = Array.isArray(input.claims) ? input.claims : [];
  const botcClaims = Array.isArray(input.botcClaims) ? input.botcClaims : [];
  const events = Array.isArray(input.events) ? input.events : [];
  const eventById = new Map(events.map((e) => [e.id, e]));
  const dayOf = (item) => {
    if (item.day !== undefined && item.day !== null) return item.day;
    const ev = eventById.get(item.event_id);
    return ev ? ev.day : null;
  };
  const uniqIds = roles.getUniqueRoleIds(script);
  const out = [];
  const seen = new Set();
  const push = (row) => {
    const key = JSON.stringify([row.claim_a, row.claim_b, row.action_a, row.action_b, row.botc_refs]);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };
  const mkPair = (refs, botcRefs, desc) => ({
    claim_a: refs[0] !== undefined ? refs[0] : null,
    claim_b: refs[1] !== undefined ? refs[1] : null,
    action_a: null, action_b: null,
    botc_refs: (botcRefs && botcRefs.length) ? botcRefs.slice().sort((a, b) => a - b) : [],
    conflict_desc: desc,
  });
  const refTag = (p) => {
    const parts = [];
    if (p.claim_a !== null && p.claim_a !== undefined) parts.push('c' + p.claim_a);
    if (p.claim_b !== null && p.claim_b !== undefined) parts.push('c' + p.claim_b);
    for (const b of (p.botc_refs || [])) parts.push('b' + b);
    return parts;
  };

  // 预解析角色声称（object=角色 id，confirm 已归一；此处兼容中/英文名兜底）
  const roleClaims = [];
  for (const c of claims) {
    if (!ROLE_ASSERT_PREDICATES.includes(c.predicate)) continue;
    const role = roles.resolveRole(c.object);
    if (!role || !roles.roleInEdition(role, script)) continue; // 非本剧本角色不参与剧本检测
    roleClaims.push({ c, role });
  }

  // RB1 对跳·唯一角色（不同 subject_seat 声称同唯一角色）
  const byRole = new Map();
  for (const rc of roleClaims) {
    if (!uniqIds.has(rc.role.id)) continue; // 非唯一（旅行者）不对跳
    if (!byRole.has(rc.role.id)) byRole.set(rc.role.id, []);
    byRole.get(rc.role.id).push(rc);
  }
  for (const [roleId, group] of byRole) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i].c, b = group[j].c;
        if (a.subject_seat === b.subject_seat) continue;
        push(mkPair([a.id, b.id], [],
          '[对跳] 唯一角色「' + roles.roleNameZh(group[i].role) + '（' + roleId + '）」被 '
          + a.subject_seat + ' 号（claim#' + a.id + '）与 ' + b.subject_seat + ' 号（claim#' + b.id
          + '）同时声称/指认，互斥必有一假（day' + dayOf(a) + '/day' + dayOf(b) + '）'));
      }
    }
  }

  // RB2 改跳：同 subject + 同角色谓词 + 不同角色（不限日）
  const idGroups = new Map();
  for (const rc of roleClaims) {
    const key = rc.c.subject_seat + '|' + rc.c.predicate;
    if (!idGroups.has(key)) idGroups.set(key, []);
    idGroups.get(key).push(rc);
  }
  for (const group of idGroups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.role.id === b.role.id) continue;
        push(mkPair([a.c.id, b.c.id], [],
          '[自相矛盾] 座位' + a.c.subject_seat + ' 的角色声称不一致：claim#' + a.c.id + '="'
          + roles.roleNameZh(a.role) + '（' + a.role.id + '）" vs claim#' + b.c.id + '="'
          + roles.roleNameZh(b.role) + '（' + b.role.id + '）"（同一座位两种角色）'));
      }
    }
  }

  // RB3 阵营互斥（同 subject：角色团队 × 阵营/好人指认，主表与 botc 表跨查）
  const demonBySubject = new Map(), minionBySubject = new Map();
  for (const bc of botcClaims) {
    if (bc.predicate === 'is_demon') {
      if (!demonBySubject.has(bc.subject_seat)) demonBySubject.set(bc.subject_seat, []);
      demonBySubject.get(bc.subject_seat).push(bc);
    } else if (bc.predicate === 'is_minion') {
      if (!minionBySubject.has(bc.subject_seat)) minionBySubject.set(bc.subject_seat, []);
      minionBySubject.get(bc.subject_seat).push(bc);
    }
  }
  const goodBySubject = new Map();
  for (const c of claims) {
    if (c.predicate !== 'is_good') continue;
    if (!goodBySubject.has(c.subject_seat)) goodBySubject.set(c.subject_seat, []);
    goodBySubject.get(c.subject_seat).push(c);
  }
  const labelBotc = (bc) => 'botc_claim#' + bc.id;
  const pairMainBotc = (main, botc, desc) => push(mkPair([main.id], [botc.id], desc));
  for (const rc of roleClaims) {
    const banned = TEAM_CONFLICTS[rc.role.team] || [];
    const subj = rc.c.subject_seat;
    for (const botcArr of banned.map((p) => (p === 'is_demon' ? demonBySubject : minionBySubject).get(subj))) {
      for (const bc of botcArr || []) {
        pairMainBotc(rc.c, bc,
          '[阵营互斥] 座位' + subj + ' 自称/被指认为「' + roles.roleNameZh(rc.role) + '（' + rc.role.id
          + '，' + rc.role.team + '）」又被 ' + bc.seat + ' 号指认 ' + bc.predicate + '（' + labelBotc(bc)
          + '），必有一假（day' + dayOf(rc.c) + '/day' + dayOf(bc) + '）');
      }
    }
    if (banned.includes('is_good')) {
      for (const g of goodBySubject.get(subj) || []) {
        push(mkPair([rc.c.id, g.id], [],
          '[阵营互斥] 座位' + subj + ' 自称/被指认为「' + roles.roleNameZh(rc.role) + '（' + rc.role.id
          + '，' + rc.role.team + '）」又被发好人金水（claim#' + g.id + '），必有一假'));
      }
    }
  }
  const pairBotcBotc = (b1, b2, desc) => push(mkPair([], [b1.id, b2.id], desc));
  const crossBotc = (mapA, mapB, nameA, nameB) => {
    for (const [subj, arrA] of mapA) {
      for (const b1 of arrA) {
        for (const b2 of mapB.get(subj) || []) {
          if (b1.id === b2.id) continue;
          pairBotcBotc(b1, b2, '[阵营互斥] 座位' + subj + ' 被同时指认 ' + nameA + '（' + labelBotc(b1)
            + '）与 ' + nameB + '（' + labelBotc(b2) + '），阵营互斥必有一假');
        }
      }
    }
  };
  crossBotc(demonBySubject, minionBySubject, 'is_demon', 'is_minion');
  for (const [subj, demons] of demonBySubject) {
    for (const bc of demons) {
      for (const g of goodBySubject.get(subj) || []) {
        pairMainBotc(g, bc, '[阵营互斥] 座位' + subj + ' 被同时指认 is_demon（' + labelBotc(bc)
          + '）与好人（claim#' + g.id + '），阵营互斥必有一假');
      }
    }
  }
  for (const [subj, minions] of minionBySubject) {
    for (const bc of minions) {
      for (const g of goodBySubject.get(subj) || []) {
        pairMainBotc(g, bc, '[阵营互斥] 座位' + subj + ' 被同时指认 is_minion（' + labelBotc(bc)
          + '）与好人（claim#' + g.id + '），阵营互斥必有一假');
      }
    }
  }

  // RB4 多恶魔：≥2 个不同 subject 被指认 is_demon → 两两互斥（本剧本恶魔仅 1 名在场）
  const demonSubjects = Array.from(demonBySubject.keys()).sort((a, b) => a - b);
  for (let i = 0; i < demonSubjects.length; i++) {
    for (let j = i + 1; j < demonSubjects.length; j++) {
      const a = demonBySubject.get(demonSubjects[i])[0];
      const b = demonBySubject.get(demonSubjects[j])[0];
      pairBotcBotc(a, b, '[多恶魔] 座位' + a.subject_seat + '（' + labelBotc(a) + '）与座位'
        + b.subject_seat + '（' + labelBotc(b) + '）被不同来源指认 is_demon，本剧本恶魔仅 1 名，不能同时成立');
    }
  }

  // RB5 状态矛盾：同一天 + 同一来源 + 同一 subject 同时报醉酒与中毒
  const stGroups = new Map();
  for (const bc of botcClaims) {
    if (bc.predicate !== 'status_drunk' && bc.predicate !== 'status_poisoned') continue;
    const key = bc.seat + '|' + bc.subject_seat + '|' + dayOf(bc);
    if (!stGroups.has(key)) stGroups.set(key, { drunk: null, poisoned: null });
    const g = stGroups.get(key);
    if (bc.predicate === 'status_drunk' && !g.drunk) g.drunk = bc;
    if (bc.predicate === 'status_poisoned' && !g.poisoned) g.poisoned = bc;
  }
  for (const g of stGroups.values()) {
    if (!g.drunk || !g.poisoned) continue;
    pairBotcBotc(g.drunk, g.poisoned, '[状态矛盾] 座位' + g.drunk.subject_seat + ' 在 day' + dayOf(g.drunk)
      + ' 被同一来源（' + g.drunk.seat + ' 号）同时报醉酒（' + labelBotc(g.drunk) + '）与中毒（'
      + labelBotc(g.poisoned) + '），待查');
  }

  for (const p of out) p.pair_id = refTag(p).length ? refTag(p).join(':') : null;
  return out;
}

module.exports = { findBotcContradictions, ROLE_ASSERT_PREDICATES };
