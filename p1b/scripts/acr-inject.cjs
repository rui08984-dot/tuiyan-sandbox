'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// acr-inject.cjs · ACR 抗投毒一期·注入器（零 LLM · 零 db 写入 · 2026-09-12）
// 协议（S2续集-Gemini增量设计 §①，PREREG 预注册口径）：
//   语料=31 局 sim（gid 7..37，werewolf_sim_6p_onenight，每局 10 行公开事件流 E）。
//   ρ∈{10%,30%,50%} → n_inj=max(1,round(ρ×|E|))=1/3/5 个注入点/局/类。
//   A 改票型（翻转/改写计票 JSON 与结算矛盾）；B 插假声称（死亡角色再发言/身份声称
//   与 truth 相悖，结构照 claims/events 真实 schema）；C 时序错位（夜死公告挪到发言前等）。
// 全部内存深拷贝，库与文件只读。确定性：LCG 种子=f(gid,class,rho)，重跑逐位一致（TV_self=0 前提）。
// ─────────────────────────────────────────────────────────────────────────────

const RATES = [0.10, 0.30, 0.50];
const CLASSES = ['A', 'B', 'C'];

/** 确定性 LCG（mulberry32 简化版）：种子=f(gid,class,rho)，重跑一致 */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFor(gid, cls, rho) {
  const ci = CLASSES.indexOf(cls), ri = RATES.indexOf(rho);
  return makeRng(gid * 7919 + ci * 613 + ri * 31 + 1);
}
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
function renumber(events) {
  events.sort((a, b) => (a._ord - b._ord));
  events.forEach((e, i) => { e.seq = i + 1; delete e._ord; });
  return events;
}

/** 逐局注入主入口：game={gid,events,claims,players(Seat->pid 备用),truth} → {events,claims,manifest}
 *  注入行 actor_seat 一律用【座位号】（与 loadGame JOIN 还原后的 events.actor_seat 同域）。 */
function injectGame(game, cls, rho) {
  const g = { events: deepCopy(game.events), claims: deepCopy(game.claims) };
  const E = g.events.length;
  const nInj = Math.max(1, Math.round(rho * E));
  g.events.forEach((e, i) => { e._ord = i; });
  const manifest = { gid: game.gid, cls: cls, rho: rho, n_inj_target: nInj, points: [] };
  const rng = rngFor(game.gid, cls, rho);
  const maxEvId = Math.max(...g.events.map(e => e.id));
  const maxClId = Math.max(...g.claims.map(c => c.id), 0);
  const ctx = { g, game, manifest, rng, nInj, maxEvId, maxClId };
  if (cls === 'A') injectClassA(ctx);
  else if (cls === 'B') injectClassB(ctx);
  else injectClassC(ctx);
  renumber(g.events);
  manifest.n_inj_actual = manifest.points.length;
  return { events: g.events, claims: g.claims, manifest: manifest };
}
// ── 定位器（语料形态恒定：sn|dd|sd×5|sd|dd|sd，共 10 行）──
function findEv(g, pred) { return g.events.find(pred) || null; }
function locators(g) {
  return {
    nightStart: findEv(g, e => e.type === 'system' && e.phase === 'night'),
    nightDeath: findEv(g, e => e.type === 'death' && e.phase === 'day'),
    exile: findEv(g, e => e.type === 'death' && e.phase === 'dusk'),
    voteCall: findEv(g, e => e.type === 'system' && e.phase === 'day'),
    gameEnd: findEv(g, e => e.type === 'system' && e.phase === 'dusk'),
  };
}
function parseNightDead(text) { const m = (text || '').match(/公布夜 \d+ 死亡：(\d+) 号死亡/); return m ? Number(m[1]) : null; }
function parseExiled(text) { const m = (text || '').match(/。(\d+) 号被放逐/); return m ? Number(m[1]) : null; }
function parseTally(text) { const m = (text || '').match(/计票：({[^}]*})/); try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; } }
function seatPid(game, seat) { return (game.players[seat] !== undefined) ? game.players[seat] : null; }
function point(manifest, p) { manifest.points.push(p); }

// ── A 类·改票型：翻转/改写计票 JSON 与结算矛盾（测跨事件一致性）──
function injectClassA(ctx) {
  const { g, game, manifest, rng, nInj } = ctx;
  const L = locators(g);
  const exiled = parseExiled(L.exile.raw_text);
  const alive = Object.keys(game.players).map(Number).filter(s => s !== exiled);
  // 槽1：改写放逐事件计票 JSON——最高票挪给非被放逐席位，公告原样 → argmax≠公告
  if (nInj >= 1 && L.exile) {
    const t = parseTally(L.exile.raw_text);
    if (t && exiled) {
      const wrong = alive[Math.floor(rng() * alive.length)];
      const t2 = {}; for (const k of Object.keys(t)) { if (k !== String(exiled)) t2[k] = t[k]; }
      t2[String(wrong)] = (t[String(exiled)] || 1) + (t2[String(wrong)] || 0);
      L.exile.raw_text = L.exile.raw_text.replace(/计票：\{[^}]*\}/, '计票：' + JSON.stringify(t2));
      point(manifest, { kind: 'modify-event', event_id: L.exile.id, sub: 'tally_flip', detail: 'argmax→' + wrong + ' 公告仍 ' + exiled });
    }
  }
  // 槽2：改写终局结算被逐席位 → 与放逐公告矛盾（兼容两变体：放逐的 X 号/放逐了狼人 X 号）
  if (nInj >= 2 && L.gameEnd && exiled) {
    const wrong2 = alive[Math.floor(rng() * alive.length)];
    let done = false;
    if (L.gameEnd.raw_text.includes('放逐的 ' + exiled + ' 号')) {
      L.gameEnd.raw_text = L.gameEnd.raw_text.replace('放逐的 ' + exiled + ' 号', '放逐的 ' + wrong2 + ' 号'); done = true;
    } else if (L.gameEnd.raw_text.includes('放逐了狼人 ' + exiled + ' 号')) {
      L.gameEnd.raw_text = L.gameEnd.raw_text.replace('放逐了狼人 ' + exiled + ' 号', '放逐了狼人 ' + wrong2 + ' 号'); done = true;
    }
    if (done) point(manifest, { kind: 'modify-event', event_id: L.gameEnd.id, sub: 'outcome_seat', detail: '结算被逐 ' + wrong2 + ' vs 公告 ' + exiled });
  }
  // 槽3+：伪造重复结算公告（同日第二份放逐，席位不同）→ 放逐唯一性必有一假
  for (let k = 2; k < nInj; k++) {
    if (!L.exile || !exiled) break;
    const wrong = alive[Math.floor(rng() * alive.length)];
    const t = parseTally(L.exile.raw_text) || {};
    const id = ctx.maxEvId + k;
    g.events.push({ id: id, day: L.exile.day, phase: 'dusk', seq: 0, type: 'death', actor_seat: null,
      raw_text: '计票：' + JSON.stringify(Object.assign({}, t, { [String(exiled)]: 0, [String(wrong)]: (t[String(exiled)] || 1) })) + '。' + wrong + ' 号被放逐出局。', _ord: L.exile._ord + 0.001 * (k - 1) });
    point(manifest, { kind: 'inject-event', event_id: id, sub: 'forge_exile', detail: '伪造放逐 ' + wrong + ' vs 真 ' + exiled });
  }
}

// ── B 类·插假声称：伪造与已记录事件机械矛盾的 claims 行（结构照真实 schema）──
// 每槽=1 条伪造 statement 事件+1~2 条 claims 行；子型轮转：死者发言/改跳声称/阵营互斥指认。
function injectClassB(ctx) {
  const { g, game, manifest, rng, nInj } = ctx;
  const L = locators(g);
  const nightDead = parseNightDead(L.nightDeath ? L.nightDeath.raw_text : '');
  const exiled = parseExiled(L.exile ? L.exile.raw_text : '');
  const deadSeats = [nightDead, exiled].filter(s => s);
  const liveSeats = Object.keys(game.players).map(Number).filter(s => deadSeats.indexOf(s) === -1);
  const claimsOf = (pred) => g.claims.filter(c => c.predicate === pred);
  const voteAnchor = L.voteCall || L.exile;
  let clId = ctx.maxClId;
  for (let k = 0; k < nInj; k++) {
    const kind = k % 5;
    const id = ctx.maxEvId + 1 + k;
    const speaker = (kind === 0 || kind === 3) ? nightDead : liveSeats[Math.floor(rng() * liveSeats.length)];
    if (!speaker) continue;
    const raw = kind === 0 ? (speaker + ' 号：等等，我根本没出局，我还在场上，刚才那个死讯是搞错了，我要继续发言。')
      : kind === 1 ? (speaker + ' 号：我想清楚了，摊牌，我其实是预言家，昨晚验过人了，信息我压在手里。')
      : kind === 2 ? (speaker + ' 号：我看走了眼也要说，我重新保一次人，别再冤枉好人了。')
      : kind === 3 ? (speaker + ' 号：死也要把话说完，我指认一个，就是他一直在带节奏。')
      : (speaker + ' 号：我补一刀，之前保他的人都被骗了，他就是狼，别再信他。');
    const ev = { id: id, day: (voteAnchor ? voteAnchor.day : 1), phase: (voteAnchor ? voteAnchor.phase : 'day'), seq: 0, type: 'statement', actor_seat: speaker, raw_text: raw, _ord: (voteAnchor ? voteAnchor._ord : g.events.length) - 0.001 * (k + 1) };
    g.events.push(ev);
    const newClaims = [];
    if (kind === 0) { clId += 1; g.claims.push({ id: clId, event_id: id, seat: speaker, subject_seat: speaker, predicate: 'claims_role', object: '平民' }); newClaims.push(clId); }
    else if (kind === 1) { clId += 1; g.claims.push({ id: clId, event_id: id, seat: speaker, subject_seat: speaker, predicate: 'claims_role', object: '预言家' }); newClaims.push(clId); }
    else if (kind === 2) { const accused = claimsOf('is_wolf').map(c => c.subject_seat).filter(s => liveSeats.indexOf(s) !== -1); if (accused.length) { const tgt = accused[Math.floor(rng() * accused.length)]; clId += 1; g.claims.push({ id: clId, event_id: id, seat: speaker, subject_seat: tgt, predicate: 'is_good', object: '好人' }); newClaims.push(clId); } }
    else if (kind === 3) { const tgt = liveSeats[Math.floor(rng() * liveSeats.length)]; clId += 1; g.claims.push({ id: clId, event_id: id, seat: speaker, subject_seat: tgt, predicate: 'is_wolf', object: '狼人' }); newClaims.push(clId); }
    else { const vouched = claimsOf('is_good').map(c => c.subject_seat).filter(s => liveSeats.indexOf(s) !== -1); if (vouched.length) { const tgt = vouched[Math.floor(rng() * vouched.length)]; clId += 1; g.claims.push({ id: clId, event_id: id, seat: speaker, subject_seat: tgt, predicate: 'is_wolf', object: '狼人' }); newClaims.push(clId); } }
    point(manifest, { kind: 'inject-event', event_id: id, sub: 'b_kind' + kind, claims: newClaims, detail: 'speaker=' + speaker });
  }
}

// ── C 类·时序错位：事件重排（每槽=挪 1 个既有事件）——测日相顺序/时序活性 ──
function injectClassC(ctx) {
  const { g, manifest, nInj } = ctx;
  const L = locators(g);
  const stmts = g.events.filter(e => e.type === 'statement').sort((a, b) => a._ord - b._ord);
  const moves = [
    { sub: 'nightdeath_first', ev: L.nightDeath, to: () => (L.nightStart ? L.nightStart._ord - 0.5 : null), detail: '夜死公告挪到夜幕降临前' },
    { sub: 'exile_before_speech', ev: L.exile, to: () => (stmts[0] ? stmts[0]._ord - 0.5 : (L.voteCall ? L.voteCall._ord - 0.5 : null)), detail: '放逐结果挪到发言前' },
    { sub: 'gameend_before_vote', ev: L.gameEnd, to: () => (L.voteCall ? L.voteCall._ord - 0.5 : null), detail: '终局挪到投票前' },
    { sub: 'nightstart_last', ev: L.nightStart, to: () => (L.gameEnd ? L.gameEnd._ord + 0.5 : null), detail: '夜幕降临挪到终局后' },
    { sub: 'statement_after_end', ev: stmts[0], to: () => (L.gameEnd ? L.gameEnd._ord + 0.7 : null), detail: '发言挪到终局后' },
  ];
  for (let k = 0; k < nInj && k < moves.length; k++) {
    const mv = moves[k];
    if (!mv.ev) continue;
    const to = mv.to(); if (to === null || to === undefined) continue;
    mv.ev._ord = to;
    point(manifest, { kind: 'relocate-event', event_id: mv.ev.id, sub: mv.sub, detail: mv.detail });
  }
}

module.exports = { RATES, CLASSES, injectGame, rngFor, deepCopy };
