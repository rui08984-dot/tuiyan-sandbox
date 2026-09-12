'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// rb-attribution.cjs · R-B 负结果归因诊断（零 LLM · 只读 · 探索性 · 2026-09-13）
// 问题：R-B 360×3 判词≈基率（负结果）——C2 时点的账本证据里到底有没有可判别信号？
// 口径：①库只读（readonly 连接 + query_only pragma，全文件无写语句）
//  ②特征全部 cutoff=C2 前可观测（夜死公告/发言/claims）；计票/终局/roles/wolves
//    只用于复算 outcome 对照落库 resolve，绝不进特征。
//  ③n=30/型：只报方向与效应量（|r| 分档），禁 p 值；噪声带 ±0.06 对齐 PREREG-RB v1。
//  ④探索性：12 型 × 特征 × 路的多重比较，全部标注 exploratory。
// 运行：node p1b/scripts/rb-attribution.cjs
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const P1A_ROOT = path.join(__dirname, '..', '..', 'p1a-terminal');
const Database = require(path.join(P1A_ROOT, 'node_modules', 'better-sqlite3'));
const DB_PATH = path.join(P1A_ROOT, 'data', 'p1a.db');
const db = new Database(DB_PATH, { readonly: true });
db.pragma('query_only = TRUE');

// ── 单局加载（照 sim-templates-v2.cjs 口径：actor_seat=players.id，JOIN 还原座位号）──
function loadGame(db, gid) {
  const events = db.prepare('SELECT e.id, e.seq, e.day, e.phase, e.type, p.seat AS actor_seat, e.raw_text FROM events e LEFT JOIN players p ON p.id = e.actor_seat WHERE e.game_id=? ORDER BY e.seq').all(gid);
  const claims = db.prepare("SELECT c.id, c.event_id, c.seat, c.subject_seat, c.predicate, c.object FROM claims c JOIN events e ON c.event_id=e.id WHERE e.game_id=? ORDER BY c.id").all(gid);
  let meta = {};
  try { meta = JSON.parse((db.prepare('SELECT meta FROM games WHERE id=?').get(gid) || {}).meta || '{}'); } catch (e) { meta = {}; }
  const truth = meta.truth || {};
  const g = { gid: gid, events: events, claims: claims, meta: meta, truth: truth, roles: truth.roles || null, wolves: truth.wolves || null };
  g.dawnDeath = events.find(function (e) { return e.type === 'death' && e.phase === 'day'; }) || null;
  g.exileDeath = events.find(function (e) { return e.type === 'death' && e.phase === 'dusk'; }) || null;
  g.victim = g.dawnDeath ? g.dawnDeath.actor_seat : null;
  g.exiled = g.exileDeath ? g.exileDeath.actor_seat : null;
  g.tally = null;
  if (g.exileDeath) { const m = g.exileDeath.raw_text.match(/计票：({[^}]*})/); if (m) { try { g.tally = JSON.parse(m[1]); } catch (e) {} } }
  g.statements = events.filter(function (e) { return e.type === 'statement'; });
  g.firstSpeaker = g.statements.length ? g.statements[0].actor_seat : null;
  g.idClaimCount = g.claims.filter(function (c) { return ['is_wolf', 'is_good', 'claims_role'].indexOf(c.predicate) !== -1; }).length;
  return g;
}

// ── schema 探查（stdout，只读）──
console.log('DB=' + DB_PATH);
for (const t of ['predictions', 'verdicts']) {
  console.log('SCHEMA ' + t + ': ' + db.prepare('PRAGMA table_info(' + t + ')').all().map(function (c) { return c.name + ':' + c.type; }).join(' | '));
}
console.log('RB preds(cutoff=C2)=' + db.prepare("SELECT COUNT(*) c FROM predictions WHERE statement LIKE '[cutoff=C2%'").get().c);
console.log('verdicts by prompt_variant: ' + JSON.stringify(db.prepare('SELECT prompt_variant, COUNT(*) c FROM verdicts GROUP BY prompt_variant').all()));
const vs = db.prepare("SELECT * FROM verdicts WHERE run_id='ca1b5cdbddfc' LIMIT 1").get();
console.log('verdict sample keys: ' + Object.keys(vs || {}).join(','));
if (vs) console.log('verdict sample: ' + JSON.stringify(vs).slice(0, 500));
// ── 第2块：R-B 行识别 + 逐局特征（C2 可见）+ outcome 复算对照 ──
function detectTemplate(s) {
  s = s || '';
  if (s.indexOf('且') !== -1) return s.indexOf('未被放逐') !== -1 ? 'T10' : 'T9';
  if (s.indexOf('最高票唯一') !== -1) return 'T9b';
  if (s.indexOf('被放逐者是狼人') !== -1) return 'T9a';
  if (s.indexOf('无弃票') !== -1) return 'T4';
  if (s.indexOf('存活') !== -1) return 'T1';
  if (s.indexOf('证伪') !== -1) return 'T2';
  if (s.indexOf('之差不超过') !== -1) return 'T3';
  if (s.indexOf('最高票数不少于') !== -1) return 'T5';
  if (s.indexOf('第一条公开发言') !== -1) return 'T6';
  if (s.indexOf('累计身份声称') !== -1) return 'T7';
  if (s.indexOf('狼人获得至少') !== -1) return 'T8';
  return 'UNK';
}
function countFalseClaims(g) { // 照 sim-templates-v2.cjs：真值侧，仅用于 outcome，不进特征
  if (!g.roles) return null; let n = 0;
  for (const c of g.claims) {
    const subj = g.roles[String(c.subject_seat)];
    if (c.predicate === 'is_wolf' && subj && subj !== 'werewolf') n++;
    else if (c.predicate === 'is_good' && subj && subj !== 'villager') n++;
    else if (c.predicate === 'claims_role' && c.seat === c.subject_seat && String(c.object).indexOf('平民') !== -1 && g.roles[String(c.seat)] !== 'villager') n++;
  } return n;
}
const gids = db.prepare("SELECT id FROM games WHERE id BETWEEN 8 AND 37 AND source='sim' ORDER BY id").all().map(function (x) { return x.id; });
const preds = db.prepare("SELECT id, game_id, statement, outcome, assigned_prob FROM predictions WHERE statement LIKE '[cutoff=C2%' ORDER BY game_id").all();
const byKey = {}; preds.forEach(function (p) { const k = p.game_id + '|' + detectTemplate(p.statement); byKey[k] = p; });
const verdicts = db.prepare("SELECT v.prediction_id, v.prompt_variant, v.implied_prob FROM verdicts v WHERE v.run_id='ca1b5cdbddfc'").all();
const vByKey = {}; verdicts.forEach(function (v) { vByKey[v.prediction_id + '|' + v.prompt_variant] = v.implied_prob; });
console.log('games=' + gids.length + ' preds=' + preds.length + ' rbVerdicts=' + verdicts.length);
const games = gids.map(loadGame.bind(null, db));
// 逐局特征（全部 C2 前可观测）+ outcome 复算（真值侧，仅对照）
const rows = games.map(function (g) {
  const chars = {}, sn = {}, cn = {}, icn = {}, acc = {};
  g.statements.forEach(function (e) { chars[e.actor_seat] = (chars[e.actor_seat] || 0) + (e.raw_text || '').length; sn[e.actor_seat] = (sn[e.actor_seat] || 0) + 1; });
  g.claims.forEach(function (c) { cn[c.seat] = (cn[c.seat] || 0) + 1; if (['is_wolf', 'is_good', 'claims_role'].indexOf(c.predicate) !== -1) icn[c.seat] = (icn[c.seat] || 0) + 1;
    if (c.predicate === 'is_wolf' && c.subject_seat !== c.seat) acc[c.subject_seat] = (acc[c.subject_seat] || 0) + 1; });
  const seat = function (s) { return { stmtN: sn[s] || 0, chars: chars[s] || 0, claims: cn[s] || 0, idClaims: icn[s] || 0, accused: acc[s] || 0, seat: s }; };
  const accVals = Object.keys(acc).map(function (k) { return acc[k]; }).sort(function (a, b) { return b - a; });
  const X = g.gid % 6 + 1;
  const vals = g.tally ? Object.values(g.tally).sort(function (a, b) { return b - a; }) : [];
  const falseC = countFalseClaims(g);
  const out = {
    T1: X !== g.victim && X !== g.exiled, T2: falseC !== null && falseC >= 4,
    T3: vals.length ? vals[0] - (vals.length > 1 ? vals[1] : 0) <= 1 : false,
    T4: g.tally ? Object.values(g.tally).reduce(function (a, b) { return a + b; }, 0) === 6 - (g.victim ? 1 : 0) : false,
    T5: vals.length ? vals[0] >= 4 : false, T6: g.firstSpeaker !== null && g.firstSpeaker !== g.exiled,
    T7: g.idClaimCount >= 10, T8: g.tally && g.wolves ? Object.keys(g.tally).some(function (s) { return g.wolves.map(String).indexOf(String(s)) !== -1; }) : false,
    T9a: g.exiled !== null && g.roles && g.roles[String(g.exiled)] === 'werewolf',
    T9b: vals.length > 0 && (vals.length === 1 || vals[0] > vals[1]),
    T9: (g.exiled !== null && g.roles && g.roles[String(g.exiled)] === 'werewolf') && vals.length > 0 && (vals.length === 1 || vals[0] > vals[1]),
    T10: (g.firstSpeaker !== g.exiled) && (g.tally ? Object.values(g.tally).reduce(function (a, b) { return a + b; }, 0) === 6 - (g.victim ? 1 : 0) : false)
  };
  return { gid: g.gid, X: X, roles: g.roles, wolves: g.wolves, out: out,
    g: { stmtN_total: g.statements.length, chars_total: Object.values(chars).reduce(function (a, b) { return a + b; }, 0), claims_total: g.claims.length, idclaims_total: g.idClaimCount, wolfacc_total: accVals.reduce(function (a, b) { return a + b; }, 0), accused_distinct: Object.keys(acc).length, top_accused: accVals.length ? accVals[0] : 0, victim: g.victim || 0, first_speaker: g.firstSpeaker || 0, exiled: g.exiled || 0 },
    x: Object.assign(seat(X), { isVictim: X === g.victim }), fs: Object.assign(seat(g.firstSpeaker), { isVictim: g.firstSpeaker === g.victim }) };
});
// ── 第3块：统计工具（零依赖）+ outcome 复算校验 ──
function pearson(xs, ys) { const n = xs.length; let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
  let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return (sx && sy) ? sxy / Math.sqrt(sx * sy) : 0; }
function eff(r) { const a = Math.abs(r); return a < 0.1 ? '≈0' : a < 0.2 ? 'small' : a < 0.4 ? 'moderate' : 'large'; }
function brier(ps, ys) { let s = 0; for (let i = 0; i < ps.length; i++) s += (ps[i] - ys[i]) * (ps[i] - ys[i]); return s / ps.length; }
const TYPES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T9a', 'T9b', 'T10'];
const Y = {};
console.log('\n== outcome 复算 vs 落库 resolve（校验；基率应与 p16 计分表一致）==');
for (const t of TYPES) {
  let agree = 0, trueN = 0; const mism = [];
  Y[t] = rows.map(function (r) { const y = r.out[t] ? 1 : 0; const p = byKey[r.gid + '|' + t];
    const py = p && p.outcome === 'true' ? 1 : 0; if (p && py === y) agree++; else mism.push(r.gid); if (y) trueN++; return y; });
  const b = trueN / rows.length;
  console.log(t + ' n=' + rows.length + ' b=' + b.toFixed(4) + ' floor=' + (b * (1 - b)).toFixed(4) + ' 复算一致=' + agree + '/30' + (mism.length ? ' MISMATCH gid=' + mism.join(',') : ''));
}
// ── 第4块：特征×outcome 点二列相关（全部 C2 前可见；n=30 只报方向/效应量，禁 p 值）──
const FEATS = ['stmtN_total', 'chars_total', 'claims_total', 'idclaims_total', 'wolfacc_total', 'accused_distinct', 'top_accused', 'victim', 'first_speaker'];
function featVec(key) { return rows.map(function (r) { return r.g[key]; }); }
const X1 = { isVictim: function (r) { return r.x.isVictim ? 1 : 0; }, claims: function (r) { return r.x.claims; }, accused: function (r) { return r.x.accused; }, chars: function (r) { return r.x.chars; }, X: function (r) { return r.X; } };
const F6 = { isVictim: function (r) { return r.fs.isVictim ? 1 : 0; }, accused: function (r) { return r.fs.accused; }, chars: function (r) { return r.fs.chars; }, claims: function (r) { return r.fs.claims; }, seat: function (r) { return r.fs.seat; } };
const FX = {};
for (const t of TYPES) { FX[t] = {}; for (const f of FEATS) FX[t][f] = featVec(f); }
for (const k in X1) FX.T1['x.' + k] = rows.map(X1[k]);
for (const k in F6) { FX.T6['fs.' + k] = rows.map(F6[k]); FX.T10['fs.' + k] = rows.map(F6[k]); }
console.log('\n== 相关矩阵 r×100（行=特征，列=题型；n=30 探索性，禁 p 值）==');
console.log('feat        | ' + TYPES.map(function (t) { return (t + '    ').slice(0, 5); }).join('|'));
const allFeatNames = {};
TYPES.forEach(function (t) { Object.keys(FX[t]).forEach(function (k) { allFeatNames[k] = 1; }); });
for (const f of Object.keys(allFeatNames)) {
  let line = (f + '           ').slice(0, 11) + ' | ';
  for (const t of TYPES) {
    if (!FX[t][f]) { line += '  .  |'; continue; }
    const r = pearson(FX[t][f], Y[t]);
    line += ((r >= 0 ? '+' : '') + Math.round(r * 100)).padStart(4) + ' |';
  }
  console.log(line);
}
console.log('\n== 每型 top-3 特征（|r| 降序，效应量分档：<0.1≈0 <0.2small <0.4moderate ≥0.4large）==');
for (const t of TYPES) {
  const rs = Object.keys(FX[t]).map(function (f) { return { f: f, r: pearson(FX[t][f], Y[t]) }; }).sort(function (a, b) { return Math.abs(b.r) - Math.abs(a.r); }).slice(0, 3);
  console.log(t + ': ' + rs.map(function (x) { return x.f + ' ' + (x.r >= 0 ? '+' : '') + x.r.toFixed(2) + '(' + eff(x.r) + ')'; }).join(' | '));
}
// ── 第5块：LOO 逻辑回归（ridge=0.1，标准化防泄漏）+ 确定性规则 ──
function fitLogistic(X, y, ridge) {
  const n = X.length, k = X[0].length, mu = [], sd = [];
  for (let j = 0; j < k; j++) { let m = 0; for (let i = 0; i < n; i++) m += X[i][j]; m /= n; let v = 0; for (let i = 0; i < n; i++) v += (X[i][j] - m) * (X[i][j] - m); sd.push(Math.sqrt(v / n) || 1); mu.push(m); }
  const Z = X.map(function (row) { return row.map(function (v, j) { return (v - mu[j]) / sd[j]; }); });
  const b = new Array(k + 1).fill(0);
  for (let it = 0; it < 30; it++) {
    const g = new Array(k + 1).fill(0), H = [];
    for (let a = 0; a <= k; a++) H.push(new Array(k + 1).fill(0));
    for (let i = 0; i < n; i++) { let z = b[0]; for (let j = 0; j < k; j++) z += b[j + 1] * Z[i][j]; const p = 1 / (1 + Math.exp(-z)); const w = Math.max(p * (1 - p), 1e-6); const xi = [1].concat(Z[i]);
      for (let a = 0; a <= k; a++) { g[a] += xi[a] * (y[i] - p); for (let c = 0; c <= k; c++) H[a][c] += xi[a] * xi[c] * w; } }
    for (let a = 0; a <= k; a++) { g[a] -= ridge * b[a]; H[a][a] += ridge; }
    const d = solve(H, g); for (let a = 0; a <= k; a++) b[a] += d[a];
  }
  return function (xrow) { let z = b[0]; for (let j = 0; j < k; j++) z += b[j + 1] * ((xrow[j] - mu[j]) / sd[j]); return 1 / (1 + Math.exp(-z)); };
}
function solve(A, v) { const n = A.length, M = A.map(function (r, i) { return r.concat(v[i]); });
  for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; const t = M[c]; M[c] = M[piv]; M[piv] = t;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / (M[c][c] || 1e-9); for (let k2 = c; k2 <= n; k2++) M[r][k2] -= f * M[c][k2]; } }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let c2 = r + 1; c2 < n; c2++) s -= M[r][c2] * x[c2]; x[r] = s / (M[r][r] || 1e-9); } return x; }
function looBrier(feats, t) {
  const X = rows.map(function (_, i) { return feats.map(function (f) { return FX[t][f][i]; }); });
  const y = Y[t]; let s = 0;
  for (let i = 0; i < X.length; i++) {
    const Xt = X.filter(function (_, j) { return j !== i; }), yt = y.filter(function (_, j) { return j !== i; });
    const f = fitLogistic(Xt, yt, 0.1); const p = f(X[i]); s += (p - y[i]) * (p - y[i]);
  } return s / X.length;
}
console.log('\n== LOO 逻辑回归（每型 top-2 特征；Brier vs 基率下限；±0.06 噪声带）==');
console.log('型   | 特征                    | LOO Brier | floor   | Δ       | 判读');
for (const t of TYPES) {
  const top = Object.keys(FX[t]).map(function (f) { return { f: f, r: pearson(FX[t][f], Y[t]) }; }).sort(function (a, b) { return Math.abs(b.r) - Math.abs(a.r); }).slice(0, 2).map(function (x) { return x.f; });
  const lb = looBrier(top, t); const fl = Y[t].reduce(function (a, b) { return a + b; }, 0) / 30; const floor = fl * (1 - fl); const d = floor - lb;
  console.log((t + '    ').slice(0, 4) + ' | ' + (top.join('+') + '                        ').slice(0, 23) + ' | ' + lb.toFixed(4) + '    | ' + floor.toFixed(4) + '  | ' + (d >= 0 ? '+' : '') + d.toFixed(4) + '  | ' + (d > 0.06 ? '超噪声带=有信号' : d > 0 ? '带内弱方向' : '无改善'));
}
// T7 确定性规则 + T1 确定性子规则
const t7B = brier(rows.map(function (r) { return r.g.idclaims_total >= 10 ? 0.999 : 0.001; }), Y.T7);
const vCnt = rows.filter(function (r) { return r.x.isVictim; }).length;
console.log('\nT7 直接规则（outcome≡idclaims_total≥10，与落库 resolve 一致 30/30）：机械预测 Brier=' + t7B.toFixed(4) + '（判词 v1=0.3491/v2=0.2365/v3=0.2880 vs floor=0.2400）');
const v1T1victim = rows.filter(function (r) { return r.x.isVictim; }).map(function (r) { return vByKey[(byKey[r.gid + '|T1'] || {}).id + '|v1_evidence']; }).filter(function (x) { return x !== undefined; });
console.log('T1 确定性子规则（X==夜死者→C2 时点即知必 false）：n=' + vCnt + '/30 局；判词在该子集 v1 均值 P=' + (v1T1victim.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, v1T1victim.length)).toFixed(3) + '（v1 覆盖 ' + v1T1victim.length + '/' + vCnt + '），全体 v1 均值 P=' + (rows.map(function (r) { return vByKey[(byKey[r.gid + '|T1'] || {}).id + '|v1_evidence']; }).filter(function (x) { return x !== undefined; }).reduce(function (a, b) { return a + b; }, 0) / 30).toFixed(3));
// ── 第6块：判词端信号利用度（各路 implied_prob × top 特征）+ T1 题面参数 X ──
console.log('\n== 判词端（runId=ca1b5cdbddfc）：各路 meanP / Brier（复核 p16）/ r(P, top 特征) ==');
const VARIS = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
console.log('型   | 路  | meanP  | Brier  | r(P,top1)      | r(P,top2)');
for (const t of TYPES) {
  const top = Object.keys(FX[t]).map(function (f) { return { f: f, r: pearson(FX[t][f], Y[t]) }; }).sort(function (a, b) { return Math.abs(b.r) - Math.abs(a.r); }).slice(0, 2);
  for (const v of VARIS) {
    const ps = [], keep = [];
    rows.forEach(function (r, i) { const p = vByKey[(byKey[r.gid + '|' + t] || {}).id + '|' + v]; if (p !== undefined) { ps.push(p); keep.push(i); } });
    if (!ps.length) { console.log(t + ' | ' + v.slice(0, 2) + ' | 缺行'); continue; }
    const ys = keep.map(function (i) { return Y[t][i]; });
    const r1 = pearson(ps, keep.map(function (i) { return FX[t][top[0].f][i]; }));
    const r2 = top[1] ? pearson(ps, keep.map(function (i) { return FX[t][top[1].f][i]; })) : 0;
    const mp = ps.reduce(function (a, b) { return a + b; }, 0) / ps.length;
    console.log((t + '    ').slice(0, 4) + ' | ' + v.slice(0, 2) + '  | ' + mp.toFixed(3) + '  | ' + brier(ps, ys).toFixed(4) + ' | ' + (r1 >= 0 ? '+' : '') + r1.toFixed(2) + ' (' + top[0].f + ')' + (top[1] ? ' | ' + (r2 >= 0 ? '+' : '') + r2.toFixed(2) + ' (' + top[1].f + ')' : ''));
  }
}
const byX = {}; rows.forEach(function (r) { (byX[r.X] = byX[r.X] || []).push(r); });
let sx = 0;
for (const r of rows) { const pool = byX[r.X].filter(function (q) { return q !== r; }); const p = pool.length ? pool.filter(function (q) { return q.out.T1; }).length / pool.length : 0.5; sx += (p - (r.out.T1 ? 1 : 0)) * (p - (r.out.T1 ? 1 : 0)); }
console.log('\nT1 题面参数 X 单特征（per-X LOO 经验存活率）：Brier=' + (sx / 30).toFixed(4) + ' vs floor=0.2456');
db.close();
// ── 第7块：证据注入截断咬合量化（EVIDENCE_TRUNC=200 判词端口径）──
console.log('\n== 发言事件长度分布 vs 判词端 200 字截断 ==');
const lens = [];
games.forEach(function (g) { g.statements.forEach(function (e) { lens.push((e.raw_text || '').length); }); });
lens.sort(function (a, b) { return a - b; });
const q = function (p) { return lens[Math.min(lens.length - 1, Math.floor(p * lens.length))]; };
console.log('n=' + lens.length + ' 条发言；min=' + lens[0] + ' p25=' + q(0.25) + ' med=' + q(0.5) + ' p75=' + q(0.75) + ' max=' + lens[lens.length - 1] + '；>200 字（截断）=' + lens.filter(function (l) { return l > 200; }).length + ' (' + (100 * lens.filter(function (l) { return l > 200; }).length / lens.length).toFixed(1) + '%)');
console.log('claims 总数=' + games.reduce(function (a, g) { return a + g.claims.length; }, 0) + '（全部挂载于发言事件内，判词只见发言散文不见结构化 claims 表）');
db.close();

