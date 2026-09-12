'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// acr-run-llm.cjs · ACR 抗投毒【二期·LLM 层】参谋卡预测分布劣化测量（2026-09-12）
// 判据（一期 §0 / S2续集 §① 预注册）：max(TV_win, TV_vote) ≤ 0.15 @ ρ=30% 污染。
//   P_win  = 本局「狼人胜/好人胜」二值分布（TV_Bernoulli=|p−p'|）
//   P_vote = 首场放逐候选席位 simplex（6 座，TV=½Σ|q−q'|）
//   参谋卡口径 = p1a llm.js CARDS_SYSTEM_PROMPT（思路参谋非判官）→ 本题改为输出两支分布；
//     judge 温度=0.2（S2 §① 预注册低温端）。
//   窗口口径：cutoff=「投票前公开记录」（排除 dusk=投票/终局，防结算泄漏，主判据读数）；
//     full=含 dusk（生产天结算 see-all 口径，伴生读数；A 类注入只在此窗口可见）。
//   矛盾对注入=pairs 传空（纯账本读数；机械层检测对另测，不喂给 LLM）。
// 纪律：零 db 写入（readonly + query_only）、零 8787 接触、key 只进程内、禁改 botc/ 与 p1a-terminal/**。
// 成本闸：ACR2_MAX_CALLS（默认 60）硬上限；usage 逐调记录。
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const Database = require(path.join(__dirname, '..', '..', 'p1a-terminal', 'node_modules', 'better-sqlite3'));
const { chatOnce } = require(path.join(__dirname, '..', 'sim', 'llm-client.cjs'));
const inj = require('./acr-inject.cjs');

const DB_PATH = path.join(__dirname, '..', '..', 'p1a-terminal', 'data', 'p1a.db');
const OUT_JSON = path.join(__dirname, '..', '..', '.scratch', 'forecast-debate', 'acr-phase2-llm-results.json');
const LOG_PATH = path.join(__dirname, '..', '..', '.scratch', 'forecast-debate', 'acr-phase2-llm-run.log');

const SEATS = [1, 2, 3, 4, 5, 6];
const TEMP = 0.2;                        // S2 §① 判词温度预注册低温端
const RHO = inj.RATES[1];                // 0.30（RATES=[0.10,0.30,0.50] 索引 1）
const DEFAULT_GIDS = [7, 8, 9, 10, 11];  // 语料 31 局 gid 7..37 的前 5 局（确定性选样）
const MAX_CALLS = Number(process.env.ACR2_MAX_CALLS || 60);

let callCount = 0;
const logLines = [];
function log(s) { logLines.push(s); console.log(s); fs.writeFileSync(LOG_PATH, logLines.join('\n'), 'utf8'); }

// ── 单局加载（照 acr-run.cjs 先例：actor_seat=players.id 须 JOIN 还原座位号）──
function loadGame(db, gid) {
  const events = db.prepare('SELECT e.id, e.seq, e.day, e.phase, e.type, p.seat AS actor_seat, e.raw_text'
    + ' FROM events e LEFT JOIN players p ON p.id = e.actor_seat WHERE e.game_id=? ORDER BY e.seq').all(gid);
  const claims = db.prepare('SELECT c.id, c.event_id, c.seat, c.subject_seat, c.predicate, c.object'
    + ' FROM claims c JOIN events e ON c.event_id=e.id WHERE e.game_id=? ORDER BY c.id').all(gid);
  const players = {};
  db.prepare('SELECT id, seat FROM players WHERE game_id=? ORDER BY seat').all(gid).forEach(p => { players[p.seat] = p.id; });
  return { gid: gid, events: events, claims: claims, players: players };
}

/** 截止窗（防结算泄漏）：排除 dusk 相事件（投票/计票/终局），保留 night+day 公开记录 */
function cutoffView(events, claims) {
  const keep = new Set(events.filter(e => e.phase !== 'dusk').map(e => e.id));
  return { events: events.filter(e => keep.has(e.id)), claims: claims.filter(c => keep.has(c.event_id)),
    _note: '截至投票前：不含计票与终局结算' };
}
/** 全量窗（生产天结算 see-all 口径，伴生读数；A 类注入仅在此窗可见） */
function fullView(events, claims) {
  return { events: events, claims: claims, _note: '全量公开记录（含计票与终局结算）' };
}
// ── 参谋卡 prompt（口径=p1a llm.js CARDS_SYSTEM_PROMPT「思路参谋不是判官」；本题改输出两支分布）──
const CARDS_SYS = [
  '你是「推演沙盘」的天结算参谋。定位=【思路参谋，不是判官】：你产出供真人复盘用的分布读数，永不替人定罪，结论留给用户。',
  '【铁律】',
  '1) 只依据给定账本记录（事件流+claims）判断，一条都不许编造；不得声称账本里没有的结算信息。',
  '2) 账本信息不足时，按最弱信息先验输出（如 P_win≈0.5、放逐分布接近均匀），并如实写明信息缺口。',
  '3) 严禁把题面之外的身份真值当作已知；不得引入外部知识。',
  '【输出】只输出一个 JSON 对象：无 markdown、无解释文字、无代码围栏。',
].join('\n');

function buildUserPayload(view, gid, windowNote) {
  const slimE = view.events.map(e => ({ id: e.id, day: e.day, phase: e.phase, type: e.type, actor_seat: e.actor_seat, raw_text: e.raw_text }));
  const slimC = view.claims.map(c => ({ id: c.id, seat: c.seat, subject_seat: c.subject_seat, predicate: c.predicate, object: c.object }));
  return '【局 id】' + gid + ' ｜ 【第 1 天结算 | 在册座位】' + SEATS.join(',') +
    '\n【公开记录（' + (windowNote || '截至投票前：不含计票与终局结算') + '）】' + JSON.stringify(slimE) +
    '\n【全量 claims】' + JSON.stringify(slimC) +
    '\n【本题·两支离散分布】'
    + '\n① P_win：本局最终「狼人阵营胜利」的概率（二值分布：狼人胜=P_win，好人胜=1−P_win）。'
    + '\n② P_vote：若不考虑终局结算，当天「放逐投票」每席位被投出的概率分布（6 席位，各 ∈[0,1]，合计=1）。'
    + '\n【输出格式】严格单行 JSON：'
    + '{"P_win":0.xx,"P_vote":{"1":0.xx,"2":0.xx,"3":0.xx,"4":0.xx,"5":0.xx,"6":0.xx},"rationale":"不超过60字"}';
}

/** 宽松 JSON 抽取（剥代码围栏，取最外层 {...}；再剥字符串内裸换行——模型实测会输出未转义换行） */
function parseJsonLoose(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let s = raw.trim().replace(/^\x60\x60\x60[a-zA-Z]*\s*/, '').replace(/\x60\x60\x60\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b <= a) return null;
  const slice = s.slice(a, b + 1);
  const tryParse = (t) => { try { const o = JSON.parse(t); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; } };
  return tryParse(slice) || tryParse(slice.replace(/\r?\n/g, ' ')) || null;
}

/** 机械兜底抽取（纪律同 verdicts.js extractImpliedProb：LLM 只产文本，数值由正则机械抽；抽不到=null 不编数） */
function salvageReading(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const mw = raw.match(/"P_win"\s*:\s*([01]?(?:\.\d+)?)/i);
  const mv = raw.match(/"P_vote"\s*:\s*\{([^}]*)\}/i);
  if (!mw || !mv) return null;
  const vote = {}; const re = /"?([1-6])"?\s*:\s*([0-9]*\.?[0-9]+)/g; let m;
  while ((m = re.exec(mv[1])) !== null) vote[m[1]] = Number(m[2]);
  return { P_win: Number(mw[1]), P_vote: vote };
}

/** 归一化读数：P_win∈[0,1]；P_vote 覆盖 6 座、和归一到 1（解析失败→null，不编数） */
function normalizeReading(obj) {
  if (!obj || typeof obj !== 'object') return null;
  let pw = Number(obj.P_win);
  if (!(pw >= 0 && pw <= 1)) {                       // P_win 缺失（如 {wolf_win:..} 变体）→ 尽力兼容
    const alt = (obj.P_win === undefined) ? (obj.p_win !== undefined ? obj.p_win : obj.wolf_win) : null;
    pw = Number(alt);
    if (!(pw >= 0 && pw <= 1)) return null;
  }
  const rawVote = obj.P_vote || obj.p_vote || null;
  if (!rawVote || typeof rawVote !== 'object') return null;
  const q = {}; let sum = 0;
  for (const s of SEATS) { const v = Number(rawVote[String(s)]); const x = (v >= 0) ? v : 0; q[String(s)] = x; sum += x; }
  if (!(sum > 0)) return null;                        // 全零/缺席位 → 无效读数
  for (const s of SEATS) q[String(s)] = q[String(s)] / sum;
  return { p_win: pw, p_vote: q, rationale: (typeof obj.rationale === 'string') ? obj.rationale.slice(0, 200) : '' };
}

// ── TV（全变差距离）：TV(P,Q)=½Σ|P_i−Q_i| ──
function tvBern(p, q) { return Math.abs(p - q); }
function tvSimplex(p, q) { let s = 0; for (const k of SEATS) s += Math.abs((p[String(k)] || 0) - (q[String(k)] || 0)); return 0.5 * s; }
function mean(xs) { const v = xs.filter(x => x !== null && x !== undefined && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function median(xs) { const v = xs.filter(x => x !== null && x !== undefined && !isNaN(x)).slice().sort((a, b) => a - b); return v.length ? v[(v.length - 1) >> 1] : null; }
function p90(xs) { const v = xs.filter(x => x !== null && !isNaN(x)).slice().sort((a, b) => a - b); if (!v.length) return null; return v[Math.min(v.length - 1, Math.floor(0.9 * (v.length - 1) + 0.5))]; }

/** 单次参谋卡调用（LIVE）：空 content/JSON 破损 → 内建重试 ≤2 次；数由机械抽取（不编数） */
function salvageReading(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const mw = raw.match(/"P_win"\s*:\s*([01]?(?:\.\d+)?)/i);
  const mv = raw.match(/"P_vote"\s*:\s*\{([^}]*)\}/i);
  if (!mw || !mv) return null;
  const vote = {}; const re = /"?([1-6])"?\s*:\s*([0-9]*\.?[0-9]+)/g; let m;
  while ((m = re.exec(mv[1])) !== null) vote[m[1]] = Number(m[2]);
  return { P_win: Number(mw[1]), P_vote: vote };
}
/** 宽松 JSON 抽取：剥代码围栏取最外层 {...}，再剥字符串内裸换行（模型实测输出未转义换行） */
function parseJsonLoose(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let s = raw.trim().replace(/^\x60\x60\x60[a-zA-Z]*\s*/, '').replace(/\x60\x60\x60\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b <= a) return null;
  const slice = s.slice(a, b + 1);
  const T = (t) => { try { const o = JSON.parse(t); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; } };
  return T(slice) || T(slice.replace(/\r?\n/g, ' ')) || null;
}
/** 读数归一化：P_win∈[0,1] 二值；P_vote 6 座、和归一；失败→null（如实记缺失，不编数） */
function normalizeReading(obj) {
  if (!obj || typeof obj !== 'object') return null;
  let pw = Number(obj.P_win);
  if (!(pw >= 0 && pw <= 1)) {
    const alt = (obj.P_win === undefined) ? (obj.p_win !== undefined ? obj.p_win : obj.wolf_win) : null;
    pw = Number(alt);
    if (!(pw >= 0 && pw <= 1)) return null;
  }
  const rawVote = obj.P_vote || obj.p_vote || null;
  if (!rawVote || typeof rawVote !== 'object') return null;
  const q = {}; let sum = 0;
  for (const s of SEATS) { const v = Number(rawVote[String(s)]); const x = (v >= 0) ? v : 0; q[String(s)] = x; sum += x; }
  if (!(sum > 0)) return null;
  for (const s of SEATS) q[String(s)] = q[String(s)] / sum;
  return { p_win: pw, p_vote: q, rationale: (typeof obj.rationale === 'string') ? obj.rationale.slice(0, 200) : '' };
}
async function callCardsOnce(view, gid, tag) {
  if (callCount >= MAX_CALLS) throw new Error('成本闸：已达 ACR2_MAX_CALLS=' + MAX_CALLS + '，停调（' + tag + '）');
  callCount++;
  const t0 = Date.now();
  const r = await chatOnce([
    { role: 'system', content: CARDS_SYS },
    { role: 'user', content: buildUserPayload(view, gid, view._note) },
  ], { providerKey: 'tokenrhythm', temperature: TEMP, maxTokens: 1600, timeoutMs: 90000 });
  const reading = normalizeReading(parseJsonLoose(r.content)) || normalizeReading(salvageReading(r.content));
  if (!reading) throw new Error('读数抽取失败（raw 前 200）：' + String(r.content).slice(0, 200));
  return { reading: reading, usage: r.usage, model: r.model, ms: Date.now() - t0 };
}
/** 单条件 K 次采样（K=ACR2_REPS，默认 3）；部分失败如实保留 readings，全失败抛错 */
async function sampleCondition(view, gid, tag) {
  const reps = Number(process.env.ACR2_REPS || 3);
  const readings = [], usages = [], errs = [];
  for (let k = 0; k < reps; k++) {
    try { const r = await callCardsOnce(view, gid, tag + '#r' + (k + 1)); readings.push(r.reading); usages.push(r.usage); if (k === 0) errs.push({ model: r.model, ms: r.ms }); }
    catch (e) { errs.push({ rep: k + 1, err: String((e && e.message) || e) }); }
  }
  if (!readings.length) throw new Error('K=' + reps + ' 次采样全失败：' + JSON.stringify(errs).slice(0, 300));
  return { readings: readings, usages: usages, errors: errs.filter(x => x.err) };
}
/** K 次采样聚合为一条分布（P_win 均值；P_vote 逐座均值后归一） */
function aggregate(readings) {
  const pw = mean(readings.map(r => r.p_win));
  const q = {}; for (const s of SEATS) q[String(s)] = mean(readings.map(r => r.p_vote[String(s)])) || 0;
  let sum = 0; for (const s of SEATS) sum += q[String(s)];
  for (const s of SEATS) q[String(s)] = sum > 0 ? q[String(s)] / sum : 0;
  return { p_win: pw, p_vote: q };
}
/** 样本间采样噪声（K≥2；K=1 → null 如实标「无内噪声地板」） */
function withinNoise(readings) {
  if (!readings || readings.length < 2) return { tv_win: null, tv_vote: null, max: null, note: 'K=1：无样本内噪声地板' };
  const cnt = readings.length; const tw = [], tvv = [];
  for (let i = 0; i < cnt; i++) for (let j = i + 1; j < cnt; j++) {
    tw.push(tvBern(readings[i].p_win, readings[j].p_win));
    tvv.push(tvSimplex(readings[i].p_vote, readings[j].p_vote));
  }
  const a = mean(tw), b = mean(tvv);
  return { tv_win: a, tv_vote: b, max: Math.max(a, b), pairs: tw.length };
}
// ── TV 与统计工具 ──
function tvBern(p, q) { return Math.abs(p - q); }
function tvSimplex(p, q) { let s = 0; for (const k of SEATS) s += Math.abs((p[String(k)] || 0) - (q[String(k)] || 0)); return 0.5 * s; }
function mean(xs) { const v = xs.filter(x => x !== null && x !== undefined && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function median(xs) { const v = xs.filter(x => x !== null && x !== undefined && !isNaN(x)).slice().sort((a, b) => a - b); return v.length ? v[(v.length - 1) >> 1] : null; }
function p90(xs) { const v = xs.filter(x => x !== null && !isNaN(x)).slice().sort((a, b) => a - b); if (!v.length) return null; return v[Math.min(v.length - 1, Math.floor(0.9 * (v.length - 1) + 0.5))]; }
function fmt(x) { return (x === null || x === undefined) ? 'null' : Number(x).toFixed(4); }
function topSeats(q) { return SEATS.map(s => ({ s: s, v: q[String(s)] || 0 })).sort((a, b) => b.v - a.v).slice(0, 2).map(x => x.s + ':' + x.v.toFixed(2)).join(' '); }
function costOf(usages) {
  let p = 0, c = 0, n = 0;
  for (const u of usages) { if (!u) continue; n++; p += Number(u.prompt_tokens || 0); c += Number(u.completion_tokens || 0); }
  const total = p + c;
  return { calls_with_usage: n, prompt_tokens: p, completion_tokens: c, total_tokens: total,
    est_cny: Number((total / 1e6 * 3).toFixed(3)),
    est_note: '按 ¥3/百万 token 混合单价粗估（S2 §① ¥1-5/1.1M 口径反推），真实账单以 TokenRhythm 为准' };
}
// ── 主流程：逐窗 K 次采样（基线=零污染，污染=内存注入同口径）──
async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const a = argv.find(x => x.indexOf('--' + k + '=') === 0); return a ? a.split('=').slice(1).join('=') : d; };
  const cls = String(arg('cls', 'A')).toUpperCase();
  const gids = arg('gids', DEFAULT_GIDS.join(',')).split(',').map(Number);
  const want = arg('pairs', 'base,poll').split(',');
  const withFull = argv.indexOf('--full') !== -1;
  const reps = Number(process.env.ACR2_REPS || 3);
  const outPath = arg('out', path.join(__dirname, '..', '..', '.scratch', 'forecast-debate',
    'acr-phase2-llm-results-' + cls + (withFull ? '-full' : '') + '.json'));
  const WIN = [['cutoff', cutoffView]];
  if (withFull) WIN.push(['full', fullView]);

  const db = new Database(DB_PATH, { readonly: true });
  db.pragma('query_only = TRUE');
  const gidList = db.prepare("SELECT id FROM games WHERE id BETWEEN 7 AND 37 AND source='sim' ORDER BY id").all().map(x => x.id);
  const games = gids.map(g => loadGame(db, g));
  const missing = gids.filter(g => gidList.indexOf(g) === -1);
  db.close();
  if (missing.length) throw new Error('语料外 gid: ' + missing.join(','));

  if (argv.indexOf('--smoke') !== -1) {
    const v = cutoffView(games[0].events, games[0].claims);
    log('[SMOKE] gid=' + games[0].gid + ' cutoff 事件=' + v.events.length + ' claims=' + v.claims.length);
    const s = await sampleCondition(v, games[0].gid, 'smoke');
    log('[SMOKE] K=' + s.readings.length + ' 聚合 P_win=' + s.readings[0].p_win + ' P_vote=' + JSON.stringify(s.readings[0].p_vote));
    log('[SMOKE] withinNoise=' + JSON.stringify(withinNoise(s.readings)) + ' usage=' + JSON.stringify(s.usages[0]));
    return;
  }

  const cleanViews = new Map(games.map(g => [g.gid, WIN.map(w => [w[0], w[1](g.events, g.claims)])]));
  const base = {}; WIN.forEach(w => { base[w[0]] = {}; });
  if (want.indexOf('base') !== -1) {
    for (const g of games) for (const kv of cleanViews.get(g.gid)) {
      const name = kv[0], view = kv[1];
      const rec = { gid: g.gid, window: name, events: view.events.length, claims: view.claims.length };
      try {
        const s = await sampleCondition(view, g.gid, 'base_' + name);
        rec.agg = aggregate(s.readings); rec.within = withinNoise(s.readings); rec.usages = s.usages; rec.errors = s.errors;
        log('[BASE/' + name + '] gid=' + g.gid + ' K=' + s.readings.length + ' pw=' + fmt(rec.agg.p_win)
          + ' withinNoise max=' + fmt(rec.within.max) + ' top=' + topSeats(rec.agg.p_vote));
      } catch (e) { rec.error = String((e && e.message) || e); log('[BASE-ERR/' + name + '] gid=' + g.gid + ' ' + rec.error); }
      base[name][g.gid] = rec;
    }
  }

  const polluted = {}; WIN.forEach(w => { polluted[w[0]] = []; });
  if (want.indexOf('poll') !== -1) {
    for (const g of games) {
      const run = inj.injectGame(g, cls, RATE);   // 内存注入（零写库）
      for (const w of WIN) {
        const name = w[0], view = w[1](run.events, run.claims);
        const rec = { gid: g.gid, window: name, n_inj_actual: run.manifest.n_inj_actual,
          points: run.manifest.points.length, events: view.events.length, claims: view.claims.length,
          subs: run.manifest.points.map(p => p.sub) };
        const b = base[name][g.gid];
        if (!b || !b.agg) { rec.error = '无零污染基线（基线缺失）'; polluted[name].push(rec); continue; }
        try {
          const s = await sampleCondition(view, g.gid, 'poll_' + cls + '_' + name);
          rec.agg = aggregate(s.readings); rec.usages = s.usages; rec.errors = s.errors;
          rec.tv_win_vs_base = tvBern(rec.agg.p_win, b.agg.p_win);
          rec.tv_vote_vs_base = tvSimplex(rec.agg.p_vote, b.agg.p_vote);
          rec.p_win_base = b.agg.p_win; rec.p_win_poll = rec.agg.p_win;
          rec.top_vote_base = topSeats(b.agg.p_vote); rec.top_vote_poll = topSeats(rec.agg.p_vote);
          log('[POLL/' + name + '] gid=' + g.gid + ' n_inj=' + rec.n_inj_actual + ' pw ' + fmt(b.agg.p_win) + '→' + fmt(rec.agg.p_win)
            + ' TV_win=' + fmt(rec.tv_win_vs_base) + ' TV_vote=' + fmt(rec.tv_vote_vs_base)
            + ' topVote ' + rec.top_vote_base + '→' + rec.top_vote_poll);
        } catch (e) { rec.error = String((e && e.message) || e); log('[POLL-ERR/' + name + '] gid=' + g.gid + ' ' + rec.error); }
        polluted[name].push(rec);
      }
    }
  }

  // ── 判定：逐窗取主判据读数 ──
  const THRESH = 0.15;
  const windows = {};
  for (const w of WIN) {
    const name = w[0];
    const recs = polluted[name] || [];
    const pairs = recs.filter(r => base[name][r.gid] && base[name][r.gid].agg && r.agg);
    const tvs = pairs.map(r => ({ gid: r.gid, tv_win: r.tv_win_vs_base, tv_vote: r.tv_vote_vs_base,
      max: Math.max(r.tv_win_vs_base, r.tv_vote_vs_base) }));
    const within = { tv_win: mean(Object.values(base[name]).map(b => b.within && b.within.tv_win)),
      tv_vote: mean(Object.values(base[name]).map(b => b.within && b.within.tv_vote)) };
    within.max = (within.tv_win === null || within.tv_vote === null) ? null : Math.max(within.tv_win, within.tv_vote);
    const mv = { tv_win: mean(tvs.map(t => t.tv_win)), tv_vote: mean(tvs.map(t => t.tv_vote)) };
    mv.max = (mv.tv_win === null || mv.tv_vote === null) ? null : Math.max(mv.tv_win, mv.tv_vote);
    const md = { tv_win: median(tvs.map(t => t.tv_win)), tv_vote: median(tvs.map(t => t.tv_vote)) };
    md.max = (md.tv_win === null) ? null : Math.max(md.tv_win, md.tv_vote);
    const pmax = tvs.map(t => t.max);
    const pwBase = mean(Object.values(base[name]).map(b => b.agg && b.agg.p_win));
    const pwPoll = mean(pairs.map(r => r.agg.p_win));
    windows[name] = {
      window_note: (name === 'cutoff') ? 'cutoff=投票前公开记录（排除计票/终局，防结算泄漏）' : 'full=含计票与终局（生产 see-all 口径，伴生）',
      n_games_paired: pairs.length, noise_floor_self: within,
      main_reading_mean: mv, main_reading_median: md,
      per_game: tvs, per_game_max_mean: mean(pmax), per_game_max_median: median(pmax), per_game_max_p90: p90(pmax),
      p_win_mean_base: pwBase, p_win_mean_poll: pwPoll, p_win_signed_shift: (pwBase === null || pwPoll === null) ? null : pwPoll - pwBase,
      pass_mean: mv.max !== null && mv.max <= THRESH,
      pass_median: md.max !== null && md.max <= THRESH,
      pass_pergame_mean: mean(pmax) !== null && mean(pmax) <= THRESH,
      baseline_per_game: Object.values(base[name]), polluted_per_game: recs,
    };
    log('──── ' + name + ' 主判据 ────');
    log('  TV_self(样本内噪声地板) max=' + fmt(within.max) + '（win=' + fmt(within.tv_win) + ' vote=' + fmt(within.tv_vote) + '）');
    log('  max(TV_win,TV_vote)@' + Math.round(RATE * 100) + '%: mean win=' + fmt(mv.tv_win) + ' vote=' + fmt(mv.tv_vote)
      + ' → max=' + fmt(mv.max) + '｜median max=' + fmt(md.max) + '｜逐局 max 均值=' + fmt(mean(pmax)));
    log('  P_win 水平 ' + fmt(pwBase) + '→' + fmt(pwPoll) + '（带符号位移 ' + fmt(windows[name].p_win_signed_shift) + '）');
    log('  判定 mean: ' + (windows[name].pass_mean ? 'PASS(≤0.15)' : 'FAIL(>0.15)'));
  }

  const allUsages = [];
  Object.values(base).forEach(m => Object.values(m).forEach(r => (r.usages || []).forEach(u => allUsages.push(u))));
  Object.values(polluted).forEach(arr => arr.forEach(r => (r.usages || []).forEach(u => allUsages.push(u))));
  const cost = costOf(allUsages);
  const results = {
    generated_at: new Date().toISOString(), phase: 'ACR-二期·LLM 层（参谋卡 P_win/P_vote 漂移）',
    corpus: 'gid ' + gids.join(',') + '（子集；全量语料=7..37 sim 共 31 局）',
    params: { cls: cls, rho: RATE, K_reps: reps, temperature: TEMP, windows: WIN.map(w => w[0]),
      pairs_injected: '空（纯账本读数；机械检测对不喂 LLM）', model: 'tokenrhythm/glm-5.3-flash',
      max_calls: MAX_CALLS, pairs_mode: want.join(',') },
    calls_used: callCount, cost: cost, threshold: THRESH, windows: windows,
  };
  fs.writeFileSync(outPath, JSON.stringify(results, null, 1), 'utf8');
  log('调用次数=' + callCount + ' tokens=' + cost.total_tokens + ' (prompt=' + cost.prompt_tokens + ' completion=' + cost.completion_tokens + ')');
  log('OUT ' + outPath);
}
main().catch(e => { log('FATAL ' + ((e && e.stack) || e)); process.exitCode = 1; });
