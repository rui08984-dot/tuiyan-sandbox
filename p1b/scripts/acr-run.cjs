'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// acr-run.cjs · ACR 抗投毒一期·检测退化测量（零 LLM · 零 db 写入 · 2026-09-12）
// 检测器口径（重要）：contradictions.js 为 BOTC 剧本数据驱动（roles.resolveRole 对本
// werewolf 语料的全部角色名返回 null，findBotcContradictions 在本语料恒返回空——已实测）。
// 故本文件按其判定逻辑【镜像实现只读版】：RB1→W1 改跳、RB3→W2 阵营互斥、
// 「时序活性」（S2⑤③ 同源规格）→W3、跨事件结算一致→W4、RB4 多恶魔「仅 1 名」镜像
// →W6 放逐唯一、claims.js BOTC_ORDER_SQL 日相序镜像→W5。
// ★镜像实现，非调用本体★（任务授权：导出面不适配注入副本时允许重实现并如实标注）。
// 运行：node p1b/scripts/acr-run.cjs（readonly 连接 + query_only pragma，全文件无 db 写）。
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const inj = require('./acr-inject.cjs');

const P1A_ROOT = path.join(__dirname, '..', '..', 'p1a-terminal');
const Database = require(path.join(P1A_ROOT, 'node_modules', 'better-sqlite3'));
const DB_PATH = path.join(P1A_ROOT, 'data', 'p1a.db');
const OUT_JSON = path.join(__dirname, '..', '..', '.run-out', 'forecast-debate', 'acr-phase1-results.json');

// ── 单局加载（照 rb-attribution.cjs 先例：actor_seat=players.id 须 JOIN 还原座位号）──
function loadGame(db, gid) {
  const events = db.prepare('SELECT e.id, e.seq, e.day, e.phase, e.type, p.seat AS actor_seat, e.raw_text'
    + ' FROM events e LEFT JOIN players p ON p.id = e.actor_seat WHERE e.game_id=? ORDER BY e.seq').all(gid);
  const claims = db.prepare('SELECT c.id, c.event_id, c.seat, c.subject_seat, c.predicate, c.object'
    + ' FROM claims c JOIN events e ON c.event_id=e.id WHERE e.game_id=? ORDER BY c.id').all(gid);
  const players = {};
  db.prepare('SELECT id, seat FROM players WHERE game_id=? ORDER BY seat').all(gid).forEach(p => { players[p.seat] = p.id; });
  return { gid: gid, events: events, claims: claims, players: players };
}

// ── 镜像检测器（真值盲：只吃 events/claims 副本，禁读 meta.truth）──
const ROLE_NORM = { '村民': '平民', '好人': '平民', '好人/村民': '平民' };
const normRole = (o) => ROLE_NORM[String(o || '').trim()] || String(o || '').trim();
const PHASE_RANK = { night: 0, day: 1, dusk: 2 }; // claims.js BOTC_ORDER_SQL 序镜像

function findWwContradictions(events, claims) {
  const evById = new Map(events.map(e => [e.id, e]));
  const claimsByEv = new Map();
  for (const c of claims) { if (!claimsByEv.has(c.event_id)) claimsByEv.set(c.event_id, []); claimsByEv.get(c.event_id).push(c); }
  const pairs = [];
  const push = (rule, refs, desc) => pairs.push({ rule: rule, refs: refs.filter(x => x !== undefined && x !== null), desc: desc });
  const ordered = events.slice().sort((a, b) => a.seq - b.seq);

  // W1 改跳（RB2 镜像）：同 subject 的角色声称不一致（角色不随日变）
  const roleGroups = new Map();
  for (const c of claims) {
    if (c.predicate !== 'claims_role' && c.predicate !== 'is_role') continue;
    const key = c.subject_seat;
    if (!roleGroups.has(key)) roleGroups.set(key, []);
    roleGroups.get(key).push(c);
  }
  for (const group of roleGroups.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (normRole(a.object) === normRole(b.object)) continue;
      push('W1', ['c' + a.id, 'c' + b.id, 'e' + a.event_id, 'e' + b.event_id], '座位' + a.subject_seat + ' 角色声称不一致：'
        + a.object + '(c' + a.id + ') vs ' + b.object + '(c' + b.id + ')');
    }
  }

  // W2 阵营互斥（RB3 镜像）：同 subject 既被指狼又被发金水，必有一假
  const wolfBy = new Map(), goodBy = new Map();
  for (const c of claims) {
    if (c.predicate === 'is_wolf') { if (!wolfBy.has(c.subject_seat)) wolfBy.set(c.subject_seat, []); wolfBy.get(c.subject_seat).push(c); }
    if (c.predicate === 'is_good') { if (!goodBy.has(c.subject_seat)) goodBy.set(c.subject_seat, []); goodBy.get(c.subject_seat).push(c); }
  }
  for (const [subj, ws] of wolfBy) for (const w of ws) for (const gd of goodBy.get(subj) || []) {
    push('W2', ['c' + w.id, 'c' + gd.id, 'e' + w.event_id, 'e' + gd.event_id], '座位' + subj + ' 被同时指狼(c' + w.id + ')与发金水(c' + gd.id + ')');
  }
  return { pairs, ordered, evById, claimsByEv };
}
// ── 时序/结算镜像规则（W3/W4/W5/W6；真值盲，只看事件流文本与结构）──
function findTemporalContradictions(ordered) {
  const pairs = [];
  const push = (rule, refs, desc) => pairs.push({ rule: rule, refs: refs.filter(x => x !== undefined && x !== null), desc: desc });
  const parseDeaths = (t) => {
    const out = [];
    let m = (t || '').match(/公布夜 \d+ 死亡：(\d+) 号死亡/); if (m) out.push(Number(m[1]));
    m = (t || '').match(/。(\d+) 号被放逐/); if (m) out.push(Number(m[1]));
    return out;
  };
  // W3 时序活性：死亡角色禁再产生 statement/vote/claim（S2⑤③ 同源规格）
  const deadAt = new Map(); // seat → 首个死亡事件 id
  for (const e of ordered) {
    for (const s of parseDeaths(e.raw_text)) if (!deadAt.has(s)) deadAt.set(s, e.id);
    if (e.actor_seat !== null && e.actor_seat !== undefined && ['statement', 'vote', 'claim', 'action_reveal'].includes(e.type)) {
      for (const [seat, deathEvId] of deadAt) {
        if (seat === e.actor_seat) push('W3', ['e' + deathEvId, 'e' + e.id], '座位' + seat + ' 在死亡公告(e' + deathEvId + ')后仍有 ' + e.type + '(e' + e.id + ')');
      }
    }
  }
  // W4 结算一致 + W6 放逐唯一（RB4「仅 1 名」镜像）
  const exileEvents = ordered.filter(e => /。(\d+) 号被放逐/.test(e.raw_text || ''));
  const first = exileEvents[0] || null;
  for (const e of exileEvents) { // W4a：计票 argmax 须含公告被逐席位（平票按 tiebreak 集合）
    const tm = (e.raw_text || '').match(/计票：({[^}]*})/);
    const am = (e.raw_text || '').match(/。(\d+) 号被放逐/);
    if (!tm || !am) continue;
    try {
      const t = JSON.parse(tm[1]);
      const mx = Math.max.apply(null, Object.values(t));
      const tops = Object.keys(t).filter(k => t[k] === mx).map(Number);
      if (tops.indexOf(Number(am[1])) === -1) push('W4', ['e' + e.id], '计票 ' + tm[1] + ' 最高票 ' + tops.join('/') + ' 与公告被逐 ' + am[1] + ' 号不一致(e' + e.id + ')');
    } catch (err) { /* 计票解析失败不判 */ }
  }
  if (first) {
    const firstSeat = Number((first.raw_text.match(/。(\d+) 号被放逐/) || [])[1]);
    for (const e of exileEvents.slice(1)) { // W6：同局被逐席位唯一，第二份不同公告必有一假
      const s = Number((e.raw_text.match(/。(\d+) 号被放逐/) || [])[1]);
      if (s !== firstSeat) push('W6', ['e' + first.id, 'e' + e.id], '两份放逐公告席位不一：' + firstSeat + ' 号(e' + first.id + ') vs ' + s + ' 号(e' + e.id + ')');
    }
    const gameEnd = ordered.find(e => e.type === 'system' && e.phase === 'dusk' && /游戏结束/.test(e.raw_text || ''));
    // 终局文本两变体：「放逐的 X 号」/「放逐了狼人 X 号」（语料实测并存）
    const gm = gameEnd ? (gameEnd.raw_text.match(/放逐(?:的|了狼人)?\s*(\d+) 号/) || [null, null]) : null;
    if (gameEnd && gm[1] !== null && Number(gm[1]) !== firstSeat) push('W4', ['e' + first.id, 'e' + gameEnd.id], '终局结算被逐 ' + gm[1] + ' 号与放逐公告 ' + firstSeat + ' 号不一致(e' + first.id + '/e' + gameEnd.id + ')');
  }
  // W5 日相顺序（claims.js BOTC_ORDER_SQL 序镜像）：seq 序上相邻事件 (day,rank) 不得回退。
  // 采用相邻对口径：归因精确（回退对=前件×后件），多处置位互相遮蔽属真实交互效应，如实上报。
  let prev = null;
  for (const e of ordered) {
    if (prev) {
      const cmp = (e.day - prev.day) || (PHASE_RANK[e.phase] - PHASE_RANK[prev.phase]);
      if (cmp < 0) push('W5', ['e' + prev.id, 'e' + e.id], '时序回退：e' + prev.id + '(d' + prev.day + '/' + prev.phase + ') 与 e' + e.id + '(d' + e.day + '/' + e.phase + ') 相邻倒序');
    }
    prev = e;
  }
  return pairs;
}

/** 统一入口：全部镜像规则，返回 pairs[{rule, refs, desc}] */
function detectAll(events, claims) {
  const base = findWwContradictions(events, claims);
  const temporal = findTemporalContradictions(base.ordered);
  return base.pairs.concat(temporal);
}

module.exports = { detectAll, findWwContradictions, findTemporalContradictions };

// ── 统计工具（零依赖）──
const RULES = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];
function hist(pairs) { const h = {}; RULES.forEach(r => { h[r] = 0; }); pairs.forEach(p => { h[p.rule]++; }); return h; }
function dist(h) { const t = Object.values(h).reduce((a, b) => a + b, 0); const d = {}; RULES.forEach(r => { d[r] = t ? h[r] / t : 0; }); return d; }
function tv(h1, h2) { const d1 = dist(h1), d2 = dist(h2); return 0.5 * RULES.reduce((a, r) => a + Math.abs(d1[r] - d2[r]), 0); }
function median(xs) { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; }

// ── 主流程：零污染基线×2（TV_self 地板）+ 3 类×3 档（TP 命中归因）──
function main() {
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma('query_only = TRUE');
  const gids = db.prepare("SELECT id FROM games WHERE id BETWEEN 7 AND 37 AND source='sim' ORDER BY id").all().map(x => x.id);
  const games = gids.map(g => loadGame(db, g));
  db.close();

  const detectPairs = (events, claims) => detectAll(events, claims);
  // 基线：同一干净副本确定性重跑两遍
  const base1 = games.map(g => detectPairs(g.events, g.claims));
  const base2 = games.map(g => detectPairs(g.events, g.claims));
  const deterministic = JSON.stringify(base1) === JSON.stringify(base2);
  const h1 = hist([].concat.apply([], base1)), h2 = hist([].concat.apply([], base2));
  const tvSelf = tv(h1, h2);
  
  const flaggedEv = new Set(); base1.forEach(ps => ps.forEach(p => p.refs.forEach(r => { if (r[0] === 'e') flaggedEv.add(r); })));
  const totalEvents = games.reduce((a, g) => a + g.events.length, 0);
  const fpRate = flaggedEv.size / totalEvents; // 误报基线=零污染被标记【事件】行比例（S2 口径）
  const baseline = {
    games: gids.length, total_events: totalEvents, total_pairs: base1.reduce((a, p) => a + p.length, 0),
    hist: h1, tv_self: tvSelf, deterministic: deterministic,
    flagged_rows_baseline: flaggedEv.size, fp_rate: fpRate,
    per_game_counts: games.map((g, i) => ({ gid: gids[i], pairs: base1[i].length })),
    games_with_pairs: base1.filter(p => p.length > 0).length,
  };
  const pointHit = (pairRefs, pt) => { const s = new Set(pt.refs); return pairRefs.some(r => s.has(r)); };
  const arms = {};
  for (const cls of inj.CLASSES) for (const rho of inj.RATES) {
    let pts = 0, tp = 0, hitPairs = 0; const perRuleTp = {}, perSub = {}; const pollPairsAll = [];
    const perGameTv = [], perGameDelta = [];
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const run = inj.injectGame(g, cls, rho);
      const pairsAll = detectPairs(run.events, run.claims);
      pollPairsAll.push(...pairsAll);
      const cleanH = hist(base1[i]), pollH = hist(pairsAll);
      perGameTv.push(tv(cleanH, pollH));
      perGameDelta.push(pairsAll.length - base1[i].length);
      // TP 口径：只认【注入引发的新对】——(rule,desc) 不在该局零污染基线集合中。
      // 防自然矛盾对（如宿主在被挪事件上的 W2）被计成命中。
      const baseKeys = base1[i].map(p => p.rule + '|' + p.desc);
      const pairs = pairsAll.filter(p => baseKeys.indexOf(p.rule + '|' + p.desc) === -1);
      const gh = {}; RULES.forEach(r => { gh[r] = 0; }); // TP 归因：pair.refs ∩ 注入点 refs
      for (const pt of run.manifest.points) {
        pts++;
        pt.refs = ['e' + pt.event_id].concat((pt.claims || []).map(c => 'c' + c)); // 引用空间分立 e*/c*，防 id 撞车
        const hits = pairs.filter(p => pointHit(p.refs, pt));
        if (hits.length) { tp++; hitPairs += hits.length; hits.forEach(p => { gh[p.rule]++; }); perSub[pt.sub] = perSub[pt.sub] || { n: 0, tp: 0 }; perSub[pt.sub].tp++; }
        else { perSub[pt.sub] = perSub[pt.sub] || { n: 0, tp: 0 }; }
        perSub[pt.sub].n++;
      }
      for (const r of RULES) if (gh[r]) perRuleTp[r] = (perRuleTp[r] || 0) + gh[r];
    }
    const aggTv = tv(h1, hist(pollPairsAll));
    arms[cls + '@' + rho] = {
      cls: cls, rho: rho, points: pts, tp: tp, recall: pts ? tp / pts : null,
      hit_pairs: hitPairs, tp_by_rule: perRuleTp, recall_by_sub: perSub,
      poll_pairs_total: pollPairsAll.length, pair_delta_median: median(perGameDelta),
      tv_type_dist_vs_clean: aggTv, per_game_tv_median: median(perGameTv),
    };
  }
  const results = { generated_at: '2026-09-12', corpus: '31 sim games gid 7..37 (werewolf_sim_6p_onenight)', detector: 'mirror reimplementation of contradictions.js judgment logic (W1-W6), truth-blind, labeled 镜像实现非调用本体', baseline: baseline, arms: arms };
  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 1), 'utf8');
  console.log('BASELINE pairs=' + baseline.total_pairs + ' hist=' + JSON.stringify(h1) + ' tv_self=' + tvSelf + ' deterministic=' + deterministic + ' fp_rate=' + fpRate.toFixed(4) + ' games_with_pairs=' + baseline.games_with_pairs);
  for (const cls of inj.CLASSES) for (const rho of inj.RATES) {
    const a = arms[cls + '@' + rho];
    console.log(cls + '@' + rho + ' points=' + a.points + ' TP=' + a.tp + ' recall=' + (a.recall * 100).toFixed(1) + '%'
      + ' rules=' + JSON.stringify(a.tp_by_rule) + ' tv=' + a.tv_type_dist_vs_clean.toFixed(3) + ' tvGameMed=' + a.per_game_tv_median.toFixed(3) + ' dPairsMed=' + a.pair_delta_median);
  }
  console.log('OUT ' + OUT_JSON);
}
main();
