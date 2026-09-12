'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// rc-score.cjs · R-C 判词修复 2.0 计分（PREREG-RC v1 §三 字面计分 · 零 LLM · 库只读）
// 三张表：①L6 主判据（7 题型×3 路 Brier vs b(1−b)，噪声带 ±0.06，合并条款 ≥3）
//        ②R-B 配对对照锚（同题同路配对 ΔBrier=R-B−R-C，bootstrap 95%CI 下界>0=改善；
//          改善跨 ≥3 题型 → 「证据呈现修复有效」）③proc_calc 单列（机械复算，不进 LLM 对比）
// 附：TOST d=0.5（L6 汇总）+ λ̂/γ̂ 记账（不得版）+ 完成度统计。
// 规则复算代码 lifted 自 rb-attribution.cjs（360/360 与落库 resolve 一致已证）。
// 运行：node p1b/scripts/rc-score.cjs
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const P1A_ROOT = path.join(__dirname, '..', '..', 'p1a-terminal');
const Database = require(path.join(P1A_ROOT, 'node_modules', 'better-sqlite3'));
const DB_PATH = path.join(P1A_ROOT, 'data', 'p1a.db');
const db = new Database(DB_PATH, { readonly: true });
db.pragma('query_only = TRUE');

const RUNID_RC = 'f4f760aa50e1';
const RUNID_RB = 'ca1b5cdbddfc';
const ROUTES = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
const L6_TYPES = ['T1', 'T2', 'T6', 'T8', 'T9a', 'T9', 'T10'];
const PC_TYPES = ['T3', 'T4', 'T5', 'T7', 'T9b'];
const NOISE = 0.06;

function loadGame(gid) {
  const events = db.prepare('SELECT e.id, e.seq, e.day, e.phase, e.type, p.seat AS actor_seat, e.raw_text FROM events e LEFT JOIN players p ON p.id = e.actor_seat WHERE e.game_id=? ORDER BY e.seq').all(gid);
  const claims = db.prepare("SELECT c.id, c.event_id, c.seat, c.subject_seat, c.predicate, c.object FROM claims c JOIN events e ON c.event_id=e.id WHERE e.game_id=? ORDER BY c.id").all(gid);
  let meta = {};
  try { meta = JSON.parse((db.prepare('SELECT meta FROM games WHERE id=?').get(gid) || {}).meta || '{}'); } catch (e) { meta = {}; }
  const truth = meta.truth || {};
  const g = { gid, events, claims, roles: truth.roles || null, wolves: truth.wolves || null };
  const dawn = events.find(function (e) { return e.type === 'death' && e.phase === 'day'; }) || null;
  const exile = events.find(function (e) { return e.type === 'death' && e.phase === 'dusk'; }) || null;
  g.victim = dawn ? dawn.actor_seat : null;
  g.exiled = exile ? exile.actor_seat : null;
  g.tally = null;
  if (exile) { const m = exile.raw_text.match(/计票：({[^}]*})/); if (m) { try { g.tally = JSON.parse(m[1]); } catch (e) {} } }
  g.statements = events.filter(function (e) { return e.type === 'statement'; });
  g.firstSpeaker = g.statements.length ? g.statements[0].actor_seat : null;
  g.idClaimCount = g.claims.filter(function (c) { return ['is_wolf', 'is_good', 'claims_role'].indexOf(c.predicate) !== -1; }).length;
  return g;
}
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
function countFalseClaims(g) {
  if (!g.roles) return null; let n = 0;
  for (const c of g.claims) {
    const subj = g.roles[String(c.subject_seat)];
    if (c.predicate === 'is_wolf' && subj && subj !== 'werewolf') n++;
    else if (c.predicate === 'is_good' && subj && subj !== 'villager') n++;
    else if (c.predicate === 'claims_role' && c.seat === c.subject_seat && String(c.object).indexOf('平民') !== -1 && g.roles[String(c.seat)] !== 'villager') n++;
  } return n;
}
function recompute(g) { // 机械复算 outcome（真值侧；与落库 resolve 对照）
  const vals = g.tally ? Object.values(g.tally).sort(function (a, b) { return b - a; }) : [];
  const falseC = countFalseClaims(g);
  return {
    T1: (g.gid % 6 + 1) !== g.victim && (g.gid % 6 + 1) !== g.exiled,
    T2: falseC !== null && falseC >= 4,
    T3: vals.length ? vals[0] - (vals.length > 1 ? vals[1] : 0) <= 1 : false,
    T4: g.tally ? Object.values(g.tally).reduce(function (a, b) { return a + b; }, 0) === 6 - (g.victim ? 1 : 0) : false,
    T5: vals.length ? vals[0] >= 4 : false,
    T6: g.firstSpeaker !== null && g.firstSpeaker !== g.exiled,
    T7: g.idClaimCount >= 10,
    T8: g.tally && g.wolves ? Object.keys(g.tally).some(function (s) { return g.wolves.map(String).indexOf(String(s)) !== -1; }) : false,
    T9a: g.exiled !== null && g.roles && g.roles[String(g.exiled)] === 'werewolf',
    T9b: vals.length > 0 && (vals.length === 1 || vals[0] > vals[1]),
    T9: (g.exiled !== null && g.roles && g.roles[String(g.exiled)] === 'werewolf') && vals.length > 0 && (vals.length === 1 || vals[0] > vals[1]),
    T10: (g.firstSpeaker !== g.exiled) && (g.tally ? Object.values(g.tally).reduce(function (a, b) { return a + b; }, 0) === 6 - (g.victim ? 1 : 0) : false),
  };
}
const brier = (qs, ys) => qs.reduce((a, q, i) => a + Math.pow(q - ys[i], 2), 0) / qs.length;
const fmt = (x) => (x === null || x === undefined || Number.isNaN(x)) ? 'n/a' : Number(x).toFixed(4);
function pearson(a, b) {
  const n = a.length; if (n < 3) return null;
  let sa = 0, sb = 0; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n; let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; cov += x * y; va += x * x; vb += y * y; }
  return (va && vb) ? cov / Math.sqrt(va * vb) : null;
}
function bootstrapCI(deltas, iters) { // LCG 987654321（PREREG 复现口径）
  const n = deltas.length; let s = 987654321;
  function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
  const means = [];
  for (let it = 0; it < iters; it++) { let sum = 0; for (let i = 0; i < n; i++) sum += deltas[Math.floor(rnd() * n)]; means.push(sum / n); }
  means.sort((x, y) => x - y);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}

function main() {
  const preds = db.prepare("SELECT id, game_id, statement, layer, engine, outcome FROM predictions WHERE checklist_hash='v2' AND statement LIKE '[cutoff=C2%' ORDER BY id").all();
  const rcRows = db.prepare("SELECT prediction_id, prompt_variant, implied_prob FROM verdicts WHERE run_id=? AND implied_prob IS NOT NULL").all(RUNID_RC);
  const rbRows = db.prepare("SELECT prediction_id, prompt_variant, implied_prob FROM verdicts WHERE run_id=? AND implied_prob IS NOT NULL").all(RUNID_RB);
  const rcMap = new Map(), rbMap = new Map();
  for (const v of rcRows) { if (!rcMap.has(v.prediction_id)) rcMap.set(v.prediction_id, {}); rcMap.get(v.prediction_id)[v.prompt_variant] = v.implied_prob; }
  for (const v of rbRows) { if (!rbMap.has(v.prediction_id)) rbMap.set(v.prediction_id, {}); rbMap.get(v.prediction_id)[v.prompt_variant] = v.implied_prob; }
  console.log('=== R-C 计分（PREREG-RC v1 §三 · 零 LLM · 库只读） ===');
  console.log('v2 题=' + preds.length + ' R-C 行=' + rcRows.length + ' R-B 行=' + rbRows.length);
  // 按题型分组（含机械复算对照）
  const byType = {};
  let recomputeAgree = 0, recomputeN = 0;
  for (const p of preds) {
    const t = detectTemplate(p.statement);
    if (t === 'UNK') { console.log('未识别题型: pred#' + p.id); continue; }
    const g = loadGame(p.game_id);
    const mech = recompute(g);
    const py = p.outcome === 'true' ? 1 : 0;
    if ((mech[t] ? 1 : 0) === py) recomputeAgree++; else console.log('  ⚠ 复算不一致 pred#' + p.id + ' ' + t);
    recomputeN++;
    (byType[t] = byType[t] || []).push({ id: p.id, y: py, layer: p.layer, engine: p.engine, mech: mech[t] });
  }
  console.log('机械复算 vs resolve 一致=' + recomputeAgree + '/' + recomputeN);
  // ── 表①：L6 主判据 ──
  console.log('\n== 表① L6 主判据（Brier vs b(1−b)；Δ=floor−Brier，>0 超基率；★=超噪声 ±' + NOISE + '） ==');
  console.log('题型   n    b      floor  |  v1 Brier Δv1     |  v2 Brier Δv2     |  v3 Brier Δv3');
  const directional = { v1_evidence: 0, v2_skeptical: 0, v3_baserate: 0 };
  const pooled = {};
  for (const t of L6_TYPES) {
    const rows = byType[t] || [];
    const b = rows.reduce((a, r) => a + r.y, 0) / rows.length;
    const floor = b * (1 - b);
    const line = [t.padEnd(5) + String(rows.length).padStart(4) + ' ' + b.toFixed(4) + ' ' + floor.toFixed(4)];
    for (const rt of ROUTES) {
      const qs = [], ys = []; let imputed = 0;
      for (const r of rows) {
        const m = rcMap.get(r.id) || {};
        if (m[rt] !== undefined) { qs.push(m[rt]); ys.push(r.y); }
        else { qs.push(b); ys.push(r.y); imputed++; } // PREREG-RC §四：L6 失败 impute 型基率
      }
      const br = brier(qs, ys);
      const delta = floor - br;
      if (delta > NOISE) directional[rt]++;
      line.push('  ' + br.toFixed(4) + ' ' + (delta >= 0 ? '+' : '') + delta.toFixed(4) + (delta > NOISE ? '★' : '') + (imputed ? '(imp' + imputed + ')' : ''));
      (pooled[rt] = pooled[rt] || { qs: [], ys: [] });
      pooled[rt].qs.push.apply(pooled[rt].qs, qs); pooled[rt].ys.push.apply(pooled[rt].ys, ys);
    }
    console.log(line.join(''));
  }
  console.log('--- 合并条款（超噪声带题型跨 ≥3） ---');
  for (const rt of ROUTES) console.log('  ' + rt + ': ' + directional[rt] + ' 型' + (directional[rt] >= 3 ? ' → 达成' : ' → 未达成'));
  // ── 表②：R-B 配对对照锚（L6 组，同题同路都有实测行才配对） ──
  console.log('\n== 表② R-B 配对对照锚（ΔBrier=R-B−R-C/题，>0=R-C 改善；bootstrap95%CI 下界>0 计改善） ==');
  const improved = { v1_evidence: 0, v2_skeptical: 0, v3_baserate: 0 };
  for (const t of L6_TYPES) {
    const rows = byType[t] || [];
    const line = [t.padEnd(5)];
    for (const rt of ROUTES) {
      const d = [];
      for (const r of rows) {
        const mrc = (rcMap.get(r.id) || {})[rt], mrb = (rbMap.get(r.id) || {})[rt];
        if (mrc === undefined || mrb === undefined) continue;
        d.push(Math.pow(mrb - r.y, 2) - Math.pow(mrc - r.y, 2));
      }
      if (d.length < 5) { line.push('  ' + rt + ': 配对n=' + d.length + ' 不足'); continue; }
      const mean = d.reduce((a, x) => a + x, 0) / d.length;
      const ci = bootstrapCI(d, 2000);
      const ok = ci[0] > 0;
      if (ok) improved[rt]++;
      line.push('  ' + rt + ': n=' + d.length + ' Δ=' + fmt(mean) + ' CI=[' + fmt(ci[0]) + ',' + fmt(ci[1]) + ']' + (ok ? '✓改善' : ''));
    }
    console.log(line.join(''));
  }
  console.log('--- 「证据呈现修复有效」判定（改善跨 ≥3 题型） ---');
  for (const rt of ROUTES) console.log('  ' + rt + ': 改善题型数=' + improved[rt] + (improved[rt] >= 3 ? ' → 修复有效成立' : ' → 未达成'));
  // ── 表③：proc_calc 单列（机械复算，不进 LLM 对比） ──
  console.log('\n== 表③ proc_calc 单列（机械直算 vs resolve；不进 LLM 判词对比与合并条款） ==');
  for (const t of PC_TYPES) {
    const rows = byType[t] || [];
    const b = rows.reduce((a, r) => a + r.y, 0) / rows.length;
    let line = t.padEnd(5) + ' n=' + rows.length + ' b=' + b.toFixed(4);
    if (t === 'T7') {
      // 精确规则硬预测：q=0.999/0.001 按【机械复算规则输出】（idclaims≥10），非 outcome——防循环论证
      let s = 0;
      for (const r of rows) s += Math.pow((r.mech ? 0.999 : 0.001) - r.y, 2);
      line += ' | T7 精确规则（idclaims≥10）直算 Brier=' + (s / rows.length).toFixed(4) + '（上限参照）';
    } else {
      const agree = rows.filter((r) => (r.mech ? 1 : 0) === r.y).length;
      line += ' | 直算复现=' + agree + '/' + rows.length;
    }
    console.log(line);
  }
  // ── TOST + λ̂/γ̂ ──
  console.log('\n== TOST d=0.5（L6 汇总，CI 落 [−0.5,+0.5] 判等价）+ λ̂/γ̂ 记账 ==');
  for (const rt of ROUTES) {
    const { qs, ys } = pooled[rt];
    const br = brier(qs, ys);
    const bPool = ys.reduce((a, y) => a + y, 0) / ys.length;
    const floorPool = bPool * (1 - bPool);
    const deltas = qs.map((q, i) => Math.pow(floorPool - ys[i], 2) - Math.pow(q - ys[i], 2));
    const ci = bootstrapCI(deltas, 2000);
    console.log('  ' + rt + ': n=' + ys.length + ' Brier=' + fmt(br) + ' floorPool=' + fmt(floorPool) + ' Δ=' + fmt(floorPool - br) + ' CI95=[' + fmt(ci[0]) + ',' + fmt(ci[1]) + ']' + (Math.abs(floorPool - br) < 0.5 ? ' TOST等价带内' : ''));
  }
  const common = preds.filter((r) => { const m = rcMap.get(r.id); return m && ROUTES.every((rt) => m[rt] !== undefined) && L6_TYPES.indexOf(detectTemplate(r.statement)) !== -1; });
  let lam = 0;
  for (let i = 0; i < ROUTES.length; i++) for (let j = i + 1; j < ROUTES.length; j++) {
    const xs = common.map((r) => rcMap.get(r.id)[ROUTES[i]]), ys2 = common.map((r) => rcMap.get(r.id)[ROUTES[j]]);
    const r = pearson(xs, ys2); lam += r;
    console.log('  r(' + ROUTES[i] + '~' + ROUTES[j] + ')=' + fmt(r));
  }
  lam /= 3;
  console.log('  λ̂=' + fmt(lam) + ' → γ̂=' + fmt(3 / (1 + 2 * lam)) + '（n_common=' + common.length + '；只记校准列不得版）');
  // ── 完成度（补跑决策输入） ──
  console.log('\n== 完成度 ==');
  for (const rt of ROUTES) {
    const miss = preds.filter((r) => (rcMap.get(r.id) || {})[rt] === undefined).length;
    console.log('  ' + rt + ': 缺 ' + miss + '/' + preds.length);
  }
  db.close();
  return 0;
}
try { process.exit(main()); } catch (e) { console.error('[rc-score] 失败: ' + ((e && e.stack) ? e.stack : e)); process.exit(1); }
