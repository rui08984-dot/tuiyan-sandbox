'use strict';
/**
 * P1a mock 数据层 —— B 路（CLI）dev/测试专用，交付时保留供测试。
 *
 * 接口 = B→A 接口期望（与 p1a-terminal/src/cli.js 头注释一致，签名逐一对齐）。
 * A 路 src/db.js（better-sqlite3）集成时按同签名替换本文件即可，CLI 零改动。
 *
 * 与契约 v0 的差异声明（需 A 路在契约 v0→v1 落地）：
 * 1) retract 软删：契约 §1 的 claims/actions 表无 retracted 列，mock 以
 *    retracted INTEGER DEFAULT 0 实现；A 路需补列（list/export/day 读态过滤）。
 * 2) 玩家播种：「new」命令无逐个报名入口，createGame 自动播种 seat=1..N、
 *    name="N号"；claims.seat / claims.subject_seat / events.actor_seat /
 *    actions.seat / actions.target_seat 一律存「席位号」。
 *
 * 校验对齐契约 §1 的 CHECK 约束：枚举非法直接 throw（等价 SQLite CHECK 失败）。
 * 零依赖、纯内存、无任何 IO。
 * 可选文件持久化（dev 多进程链用）：设 P1A_MOCK_DB_FILE=<json 路径> 时，每次写操作后
 * 快照落盘、创建时载入；缺省不设则保持纯内存零 IO（测试口径不变）。
 */

const fs = require('fs');

const ENUMS = {
  gameType: ['werewolf', 'botc', 'script'],
  phase: ['night', 'day', 'dusk'],
  eventType: ['statement', 'vote', 'death', 'claim', 'action_reveal', 'system'],
  predicate: ['is_wolf', 'is_good', 'is_role', 'claims_role', 'voted', 'did_action', 'said'],
  action: ['vote', 'abstain', 'kill_target', 'poison_target', 'protect_target', 'check_target', 'self_explode'],
  underdetermination: ['high', 'mid', 'low'],
  tendency: ['strong', 'mid', 'weak'],
};

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function createMockDb() {
  const persistPath = process.env.P1A_MOCK_DB_FILE || null;
  const games = [];
  const players = [];
  const events = [];
  const claims = [];
  const actions = [];
  const contradictions = [];
  const hypotheses = [];
  const ids = { game: 0, player: 0, event: 0, claim: 0, action: 0, contradiction: 0, hypothesis: 0 };

  const findGame = (id) => games.find((g) => g.id === id) || null;
  const findPlayer = (gameId, seat) => players.find((p) => p.game_id === gameId && p.seat === seat) || null;
  const findEvent = (id) => events.find((e) => e.id === id) || null;

  function requireGame(gameId) {
    const g = findGame(gameId);
    if (!g) throw new Error('局 ' + gameId + ' 不存在');
    return g;
  }
  function enumCheck(kind, value, allowed) {
    if (!allowed.includes(value)) throw new Error(kind + ' 非法: ' + JSON.stringify(value) + '（契约 §1 CHECK）');
  }
  function requireSeat(gameId, seat, label) {
    if (!Number.isInteger(seat)) throw new Error(label + ' 非法: ' + JSON.stringify(seat));
    if (!findPlayer(gameId, seat)) throw new Error(label + ' ' + seat + ' 不是已存在玩家（局 ' + gameId + '）');
  }

  const api = {
    // ---------- games / players ----------
    createGame(name, game_type, player_count) {
      if (typeof name !== 'string' || !name.trim()) throw new Error('局名不能为空');
      enumCheck('game_type', game_type, ENUMS.gameType);
      if (!Number.isInteger(player_count) || player_count < 2 || player_count > 99) {
        throw new Error('人数非法: ' + player_count);
      }
      const g = { id: ++ids.game, name: name.trim(), game_type, player_count, created_at: now() };
      games.push(g);
      for (let s = 1; s <= player_count; s++) {
        players.push({ id: ++ids.player, game_id: g.id, seat: s, name: s + '号' });
      }
      return Object.assign({}, g);
    },
    getGame(gameId) { const g = findGame(gameId); return g ? Object.assign({}, g) : null; },
    getPlayers(gameId) {
      requireGame(gameId);
      return players.filter((p) => p.game_id === gameId).map((p) => Object.assign({}, p));
    },
    seatExists(gameId, seat) { return !!findPlayer(gameId, seat); },

    // ---------- events ----------
    addEvent({ game_id, day, phase, type, actor_seat = null, raw_text }) {
      requireGame(game_id);
      if (!Number.isInteger(day) || day < 1) throw new Error('event.day 非法: ' + JSON.stringify(day));
      enumCheck('event.phase', phase, ENUMS.phase);
      enumCheck('event.type', type, ENUMS.eventType);
      if (typeof raw_text !== 'string' || raw_text.length === 0) {
        throw new Error('event.raw_text 不能为空（用户原话不可改写）');
      }
      if (actor_seat != null) requireSeat(game_id, actor_seat, 'event.actor_seat');
      const seq = events.filter((e) => e.game_id === game_id).length + 1;
      const row = { id: ++ids.event, game_id, day, phase, seq, type, actor_seat, raw_text };
      events.push(row);
      return Object.assign({}, row);
    },

    // ---------- claims / actions ----------
    addClaim({ event_id, seat, subject_seat, predicate, object, extracted_by = 'llm', confirmed_by_user = 0 }) {
      const ev = findEvent(event_id);
      if (!ev) throw new Error('event ' + event_id + ' 不存在');
      requireSeat(ev.game_id, seat, 'claim.seat');
      requireSeat(ev.game_id, subject_seat, 'claim.subject_seat');
      enumCheck('claim.predicate', predicate, ENUMS.predicate);
      if (object == null || String(object).trim() === '') throw new Error('claim.object 不能为空');
      const row = {
        id: ++ids.claim, game_id: ev.game_id, event_id, seat, subject_seat,
        predicate, object: String(object), extracted_by,
        confirmed_by_user: confirmed_by_user ? 1 : 0, retracted: 0,
      };
      claims.push(row);
      return Object.assign({}, row);
    },
    addAction({ event_id, seat, action, target_seat = null, result = null }) {
      const ev = findEvent(event_id);
      if (!ev) throw new Error('event ' + event_id + ' 不存在');
      requireSeat(ev.game_id, seat, 'action.seat');
      enumCheck('action.action', action, ENUMS.action);
      if (target_seat != null) requireSeat(ev.game_id, target_seat, 'action.target_seat');
      const row = {
        id: ++ids.action, game_id: ev.game_id, event_id, seat, action,
        target_seat, result: result == null ? null : String(result), retracted: 0,
      };
      actions.push(row);
      return Object.assign({}, row);
    },
    getClaim(id) { const r = claims.find((c) => c.id === id); return r ? Object.assign({}, r) : null; },
    getAction(id) { const r = actions.find((a) => a.id === id); return r ? Object.assign({}, r) : null; },

    updateClaimObject(id, object) {
      const r = claims.find((c) => c.id === id);
      if (!r) throw new Error('claim c' + id + ' 不存在');
      if (object == null || String(object).trim() === '') throw new Error('claim.object 新值不能为空');
      r.object = String(object);
      r.confirmed_by_user = 1; // 用户人工修正视同已确认
      return Object.assign({}, r);
    },
    updateAction(id, patch = {}) {
      const r = actions.find((a) => a.id === id);
      if (!r) throw new Error('action a' + id + ' 不存在');
      if (patch.target_seat !== undefined) {
        if (patch.target_seat != null) requireSeat(r.game_id, patch.target_seat, 'action.target_seat');
        r.target_seat = patch.target_seat;
      }
      if (patch.result !== undefined) r.result = patch.result == null ? null : String(patch.result);
      return Object.assign({}, r);
    },

    // 软删（retracted=1）：list/export/day 读态一律过滤
    retractClaim(id) { const r = claims.find((c) => c.id === id); if (!r) return false; r.retracted = 1; return true; },
    retractAction(id) { const r = actions.find((a) => a.id === id); if (!r) return false; r.retracted = 1; return true; },

    // 某席位（说话人）最近 limit 条声称（未撤回，带所在事件 day/phase/seq）
    recentClaimsBySeat(gameId, seat, limit = 2) {
      requireGame(gameId);
      return claims
        .filter((c) => c.game_id === gameId && c.seat === seat && !c.retracted)
        .map((c) => {
          const ev = findEvent(c.event_id);
          return Object.assign({}, c, { day: ev.day, phase: ev.phase, event_seq: ev.seq });
        })
        .sort((a, b) => (b.day - a.day) || (b.event_seq - a.event_seq) || (b.id - a.id))
        .slice(0, limit);
    },

    // 天结算/列表/导出共用的读态：event.day <= uptoDay，未撤回
    loadGameState(gameId, uptoDay = Infinity) {
      const game = findGame(gameId);
      if (!game) return null;
      const evs = events
        .filter((e) => e.game_id === gameId && e.day <= uptoDay)
        .sort((a, b) => (a.day - b.day) || (a.seq - b.seq))
        .map((e) => Object.assign({}, e));
      const evIds = new Set(evs.map((e) => e.id));
      const cls = claims
        .filter((c) => evIds.has(c.event_id) && !c.retracted)
        .map((c) => {
          const ev = findEvent(c.event_id);
          return Object.assign({}, c, { day: ev.day, phase: ev.phase, event_seq: ev.seq });
        });
      const acts = actions
        .filter((a) => evIds.has(a.event_id) && !a.retracted)
        .map((a) => Object.assign({}, a));
      return {
        game: Object.assign({}, game),
        players: players.filter((p) => p.game_id === gameId).map((p) => Object.assign({}, p)),
        events: evs, claims: cls, actions: acts,
      };
    },

    exportGame(gameId) {
      const state = this.loadGameState(gameId, Infinity);
      if (!state) return null;
      return Object.assign({}, state, {
        meta: {
          exported_at: now(),
          retracted_claims: claims.filter((c) => c.game_id === gameId && c.retracted).length,
          retracted_actions: actions.filter((a) => a.game_id === gameId && a.retracted).length,
        },
      });
    },

    // 参谋卡回存（契约 §1 contradictions/hypotheses；RD1：innocent_explanations 非空强校验）
    saveAdvisorCard(game_id, day, card) {
      requireGame(game_id);
      const savedContr = [];
      for (const c of card.contradictions || []) {
        const expl = c.innocent_explanations;
        if (!Array.isArray(expl) || expl.length < 1) {
          throw new Error('矛盾对 ' + c.pair_id + ' innocent_explanations 为空（RD1 非空强校验）');
        }
        enumCheck('underdetermination', c.underdetermination, ENUMS.underdetermination);
        const row = {
          id: ++ids.contradiction, game_id, day,
          claim_a: c.claim_a != null ? c.claim_a : null,
          claim_b: c.claim_b != null ? c.claim_b : null,
          action_a: c.action_a != null ? c.action_a : null,
          action_b: c.action_b != null ? c.action_b : null,
          conflict_desc: c.pair_id != null ? String(c.pair_id) : '',
          underdetermination: c.underdetermination,
          innocent_explanations: JSON.stringify(expl),
          generated_by: 'llm',
        };
        contradictions.push(row);
        savedContr.push(Object.assign({}, row));
      }
      const savedHyp = [];
      for (const h of card.hypotheses || []) {
        enumCheck('tendency', h.tendency, ENUMS.tendency);
        const row = {
          id: ++ids.hypothesis, game_id, day,
          content: h.content,
          stance: JSON.stringify(h.stance != null ? h.stance : {}),
          support_events: JSON.stringify(h.support_events != null ? h.support_events : []),
          oppose_events: JSON.stringify(h.oppose_events != null ? h.oppose_events : []),
          tendency: h.tendency,
        };
        hypotheses.push(row);
        savedHyp.push(Object.assign({}, row));
      }
      return { contradictions: savedContr, hypotheses: savedHyp };
    },

    /** 测试直查内部表（非 A 路接口，仅 _debug） */
    _debug: { games, players, events, claims, actions, contradictions, hypotheses },
  };
  // ── 可选文件持久化（P1A_MOCK_DB_FILE）：写操作后快照，进程间延续（原位填充保 _debug 引用）──
  if (persistPath) {
    if (fs.existsSync(persistPath)) {
      const snap = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
      const fill = (arr, rows) => { arr.length = 0; (rows || []).forEach((r) => arr.push(r)); };
      fill(games, snap.games); fill(players, snap.players); fill(events, snap.events);
      fill(claims, snap.claims); fill(actions, snap.actions);
      fill(contradictions, snap.contradictions); fill(hypotheses, snap.hypotheses);
      Object.assign(ids, snap.ids);
    }
    const persist = () => {
      fs.writeFileSync(persistPath, JSON.stringify({
        v: 1, ids, games, players, events, claims, actions, contradictions, hypotheses,
      }));
    };
    for (const name of ['createGame', 'addEvent', 'addClaim', 'addAction', 'updateClaimObject',
      'updateAction', 'retractClaim', 'retractAction', 'saveAdvisorCard']) {
      const orig = api[name];
      api[name] = function (...args) {
        const r = orig.apply(this, args);
        persist();
        return r;
      };
    }
  }
  return api;
}

module.exports = { createMockDb, ENUMS };
