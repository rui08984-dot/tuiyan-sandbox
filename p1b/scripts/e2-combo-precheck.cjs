#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/e2-combo-precheck.cjs —— E2 立票前置「组合增益预检套件」（16⑦7A/7B/7C · 2026-09-17）
 *
 * 依据（唯一）：`PREREG-E2-路由分配-v1.md` §3（立票前置，先跑后立）四条：
 *   §3.1 组合增益预检（Bates–Granger ρ̂）：成员两两 Brier 误差相关 ρ̂＋配对 bootstrap；**ρ̂ CI 下界 ≥0.95 ⇒ 该域组合臂判死不立票**
 *   §3.2 歧义分解预检（Ē = Ē_members − A）：期望增益读数与实测 ΔBrier 的秩相关 CI（与 1 同脚本）
 *   §3.3 组合池 RES 准入门：引擎格级 Murphy RES 的 **CI 下界 > 0** 才进混合池（16⑦7C）
 *   §3.4 开关自身判据：预测域集合与实测增益域集合一致率 ≥70%（须下游数据 ⇒ 本件 n/a）
 * 出处锚（照 16 号件实抓）：Bates & Granger 1969 DOI 10.1057/jors.1969.103｜Krogh & Vedelsby 1995（教科书级，无 DOI）｜
 *   Kuncheva & Whitaker 2003 DOI 10.1023/a:1022859003006｜Murphy 1973（在盘，15-I4）。
 *
 * ☆ 本件与 `e2-shadow-score.cjs`（2026-09-16 预检）的**关键差别（本件立项理由）**：
 *   旧预检把引擎**按 layer 门控**（`if (r.layer==='L3') 才跑 L3`）⇒ 每题引擎数天然 ≤1 ⇒
 *   「跨引擎重叠人口 0 题」**是脚本构造的产物，不是账本事实**（该结论正是 PREREG §3.0 据以判「R3 双臂不启动」的前提）。
 *   本件改为**全引擎可用性矩阵**：每题**试遍所有 5 个引擎**（谁输入齐谁出数，不看 layer）⇒ 这才是
 *   「同一题上是否存在 ≥2 个可估引擎」的正确测量。（shadow 语义＝读侧重放，零 LLM、零账本写、不碰生产路由。）
 *
 * 纪律：**零账本写／零 LLM／零网络**；库 readOnly；只披露不进门控。
 * ⚠ 本件**不改任何冻结判据**：是否据本件结果改写 PREREG §3.0 的「R3 不启动」＝**版本递进（须拍板）**，本件只测量。
 * 用法：node p1b/scripts/e2-combo-precheck.cjs [--db <path>] [--out-dir <dir>] [--boot 1000]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const NB = Number(arg('boot', '1000'));
const SEED = Number(arg('seed', '987654321'));
const RHO_KILL = 0.95;          // §3.1 写死
const MIN_PAIR_N = 10;          // §3.1/§3.3「格 n<10 不参与」
const BINS = 10;

// ── 纯函数区（可 require，零副作用） ─────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const brier = (p, y) => (p - y) * (p - y);
const variance = (a) => (a.length ? mean(a.map((x) => (x - mean(a)) ** 2)) : null);

/** Pearson 相关（用于 ρ̂；零方差 ⇒ null，如实不编数）。 */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return (dx > 0 && dy > 0) ? num / Math.sqrt(dx * dy) : null;   // 零方差 ⇒ null（不编数）
}
/** Spearman 秩相关（§3.2 用；并列取平均秩）。 */
function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const rank = (a) => {
    const idx = a.map((v, i) => ({ v: v, i: i })).sort((p, q) => p.v - q.v);
    const r = new Array(n); let i = 0;
    while (i < n) { let j = i; while (j + 1 < n && idx[j + 1].v === idx[i].v) j++;
      let avg = 0; for (let k = i; k <= j; k++) avg += k + 1; avg /= (j - i + 1);
      for (let k = i; k <= j; k++) r[idx[k].i] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  return pearson(rx, ry);
}
/** Murphy 三分解（10 桶离散版；与 u8-columns 同口径）：RES = Σ(n/N)(ō_b − ȳ)²。 */
function murphyRes(ps, ys) {
  const N = ps.length;
  if (!N) return { n: 0, res: null, unc: null, rel: null, brier: null };
  const b = []; for (let i = 0; i < BINS; i++) b.push({ n: 0, sf: 0, sy: 0 });
  for (let i = 0; i < N; i++) { const j = Math.min(BINS - 1, Math.max(0, Math.floor(ps[i] * BINS))); b[j].n++; b[j].sf += ps[i]; b[j].sy += ys[i]; }
  const ybar = mean(ys);
  let rel = 0, res = 0;
  for (const x of b) { if (!x.n) continue; const f = x.sf / x.n, o = x.sy / x.n; rel += (x.n / N) * (f - o) ** 2; res += (x.n / N) * (o - ybar) ** 2; }
  return { n: N, res: res, rel: rel, unc: ybar * (1 - ybar), brier: mean(ps.map((p, i) => brier(p, ys[i]))) };
}
/** 配对（按题）bootstrap 百分位 CI。 */
function bootCI(rows, fn, B, seed) {
  const n = rows.length;
  if (!n) return { lo: null, hi: null, B: B, seed: seed };
  let s = seed >>> 0;
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const v = [];
  for (let b = 0; b < B; b++) { const sub = new Array(n); for (let i = 0; i < n; i++) sub[i] = rows[Math.floor(rnd() * n)]; v.push(fn(sub)); }
  v.sort((x, y) => x - y);
  const q = (t) => v[Math.min(v.length - 1, Math.max(0, Math.floor(t * v.length)))];
  return { lo: q(0.025), hi: q(0.975), B: B, seed: seed };
}

// ── 主流程（只在 CLI 直跑；require 不写盘、不读库） ───────────────────────────
function main() {
  const truthBasis = require(path.join(ROOT, 'p1b/src/evidence/truthBasis'));
  const { l2Baseline } = require(path.join(ROOT, 'p1b/src/engines/l2_baseline'));
  const { l3Aci } = require(path.join(ROOT, 'p1b/src/engines/l3_aci'));
  const { l5Certified } = require(path.join(ROOT, 'p1b/src/engines/l5_certified'));
  const { certifiedSourceForRow } = require(path.join(ROOT, 'p1b/src/engines/l5_sources'));
  const { procCalc } = require(path.join(ROOT, 'p1b/src/engines/l1_proc'));
  const { l6Structural } = require(path.join(ROOT, 'p1b/src/engines/l6_structural'));
  const domMod = require(path.join(ROOT, 'p1b/src/evidence/domain'));

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const REGIME = "p.g2_regime='R4'", NOT_TB = truthBasis.NOT_TRUTH_BASIS_DEFECT_SQL();
  const rows = db.prepare('SELECT p.id, p.layer, p.outcome, p.game_id, p.statement, '
    + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
    + "(SELECT json_extract(e.value,'$.baseRate') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRate') IS NOT NULL LIMIT 1) AS brs, "
    + "(SELECT json_extract(e.value,'$.certifiedSource') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.certifiedSource') IS NOT NULL LIMIT 1) AS cs, "
    + "(SELECT json_extract(e.value,'$.resolve.certified_source') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.certified_source') IS NOT NULL LIMIT 1) AS rcs, "
    + "(SELECT json_extract(e.value,'$.resolve') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve') IS NOT NULL LIMIT 1) AS rj, "
    + "(SELECT json_extract(e.value,'$.resolve.kind') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind') IS NOT NULL LIMIT 1) AS rkind, "
    + "(SELECT json_extract(e.value,'$.kind') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.kind') IS NOT NULL LIMIT 1) AS ekind "
    + 'FROM predictions p WHERE ' + REGIME + ' AND ' + NOT_TB + ' AND p.outcome IS NOT NULL').all();
  const evs = db.prepare('SELECT seq, day, phase, type, actor_seat, raw_text FROM events WHERE game_id = ? ORDER BY seq, id');
  const cls = db.prepare('SELECT e.day AS day, c.predicate AS predicate FROM claims c JOIN events e ON e.id = c.event_id WHERE e.game_id = ?');
  const pcs = db.prepare('SELECT player_count, game_type FROM games WHERE id = ?');
  const vs = db.prepare('SELECT id, prompt_variant, implied_prob FROM verdicts WHERE prediction_id = ? ORDER BY id');
  const evc = {}, clc = {}, pcc = {}, vc = {};
  const eventsOf = (g) => evc[g] || (evc[g] = evs.all(g));
  const claimsOf = (g) => clc[g] || (clc[g] = cls.all(g));
  const gOf = (g) => pcc[g] || (pcc[g] = (pcs.get(g) || {}));
  const verdictsOf = (id) => vc[id] || (vc[id] = vs.all(id));
  // L3 的 ACI 反馈窗：与 stage4/u8 同口径（L3 全量已解）
  const L3FB = (() => { const rs = db.prepare('SELECT p.id, p.outcome, '
    + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
    + "(SELECT json_extract(e.value,'$.baseRate') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRate') IS NOT NULL LIMIT 1) AS brs "
    + 'FROM predictions p WHERE ' + REGIME + " AND p.layer='L3' AND p.outcome IS NOT NULL ORDER BY p.id").all();
    const fb = []; for (const r of rs) { let st = null; try { st = r.brs ? JSON.parse(r.brs) : null; } catch (e) { st = null; }
      const { parseBaseRateNote } = require(path.join(ROOT, 'p1b/src/engines/l2_baseline'));
      if (st && st.p !== undefined && st.n !== null && st.k !== null) fb.push({ p: st.p, y: String(r.outcome) === 'true' ? 1 : 0 });
      else { const q = parseBaseRateNote(String(r.brn || '')); if (q) fb.push({ p: q.p, y: String(r.outcome) === 'true' ? 1 : 0 }); } }
    return fb; })();

  // ── 全引擎可用性矩阵（★本件的关键动作：不看 layer，谁输入齐谁出数） ──
  const ENGINE_KEYS = ['L1', 'L2', 'L3', 'L5', 'L6'];
  const items = [];
  for (const r of rows) {
    let st = null; try { st = r.brs ? JSON.parse(r.brs) : null; } catch (e) { st = null; }
    const g = r.game_id, gg = gOf(g);
    const eng = {};
    // ★ L1 必须传**真题面**（照 stage4-run.cjs:156 `procCalc({statement: r.statement, …})`）；
    //   旧预检件传 `statement:''` ⇒ L1 恒 `rule_unmatched` ⇒ 180 道 L1 题被静默丢弃（本件已修，见 §0③）。
    const o1 = procCalc({ statement: r.statement, events: eventsOf(g), claims: claimsOf(g), playerCount: gg.player_count }); if (o1 && o1.ok) eng.L1 = o1.p;
    const o2 = l2Baseline({ baseRate: st, baseRateNote: r.brn }); if (o2 && o2.ok) eng.L2 = o2.p;
    const o3 = l3Aci({ baseRate: st, baseRateNote: r.brn, feedback: L3FB }); if (o3 && o3.ok) eng.L3 = o3.p;
    let cs = null; try { cs = r.cs ? JSON.parse(r.cs) : (r.rcs ? JSON.parse(r.rcs) : null); } catch (e) { cs = null; }
    if (!cs) { let rj = null; try { rj = r.rj ? JSON.parse(r.rj) : null; } catch (e) { rj = null; } const b = certifiedSourceForRow({ resolve: rj, baseRate: st, baseRateNote: r.brn }); if (b.ok) cs = b.source; }
    const o5 = l5Certified({ certifiedSource: cs }); if (o5 && o5.ok) eng.L5 = o5.p;
    const o6 = l6Structural({ verdicts: verdictsOf(r.id) }); if (o6 && o6.ok) eng.L6 = o6.p;
    items.push({ id: r.id, layer: r.layer, y: String(r.outcome) === 'true' ? 1 : 0, eng: eng, keys: Object.keys(eng),
      domain: domMod.domainOf ? null : null, gtype: gg.game_type, rkind: r.rkind, ekind: r.ekind });
  }
  // 域（照 domain.js 单一真源：resolve.kind → evidence kind → game_type → (unknown)）
  let domFailed = 0;
  for (const it of items) {
    const dd = domMod.deriveDomain({ resolve: { kind: it.rkind }, evKind: it.ekind, gameType: it.gtype });
    it.domain = dd.domain;
    if (dd.basis === 'none') domFailed++;
  }
  const multi = items.filter((it) => it.keys.length >= 2);
  // 多引擎人口按「题所属层 × 引擎对」拆分（关键：区分「本题层内多引擎」与「跨层规则命中」）
  const pairByLayer = {};
  for (const it of multi) { const k = it.layer + '｜' + it.keys.slice().sort().join('×'); pairByLayer[k] = (pairByLayer[k] || 0) + 1; }
  db.close();   // ★ 关库必须在取数循环之后（node:sqlite：close() 后预编译语句全失效）
  const pairPop = {};
  for (const it of multi) { const k = it.keys.slice().sort().join('×'); pairPop[k] = (pairPop[k] || 0) + 1; }

  // ── §3.1 组合增益预检（ρ̂：成员两两 Brier 误差相关） ──
  const rho = [];
  for (const [k, n] of Object.entries(pairPop)) {
    const [a, b] = k.split('×');
    const set = multi.filter((it) => it.keys.indexOf(a) !== -1 && it.keys.indexOf(b) !== -1);
    const rows2 = set.map((it) => ({ ea: brier(it.eng[a], it.y), eb: brier(it.eng[b], it.y), pa: it.eng[a], pb: it.eng[b] }));
    const point = pearson(rows2.map((r) => r.ea), rows2.map((r) => r.eb));
    const ci = point === null ? { lo: null, hi: null } : bootCI(rows2, (s) => { const v = pearson(s.map((r) => r.ea), s.map((r) => r.eb)); return v === null ? 0 : v; }, NB, SEED);
    const identical = rows2.every((r) => r.pa === r.pb);
    rho.push({ pair: k, n: n, rho_hat: point, ci95: ci, identical_outputs: identical,
      zero_variance: rows2.every((r) => r.ea === rows2[0].ea) || rows2.every((r) => r.eb === rows2[0].eb),
      decision: (point !== null && ci.lo !== null && ci.lo >= RHO_KILL) ? '该域组合臂判死（ρ̂ CI 下界 ≥ 0.95）'
        : (identical ? '判死（两引擎输出逐位相同 ⇒ ρ̂≡1，同一信号两次）' : (point === null ? '不可估（零方差 ⇒ ρ̂ 未定义，不编数）' : '不停用（ρ̂ CI 下界 < 0.95）')) });
  }

  // ── §3.3 组合池 RES 准入门（引擎格级 Murphy RES 的 CI 下界 > 0） ──
  const resGate = [];
  for (const E of ENGINE_KEYS) {
    const set = items.filter((it) => it.eng[E] !== undefined);
    if (set.length < MIN_PAIR_N) { resGate.push({ engine: E, n: set.length, note: 'n<' + MIN_PAIR_N + ' ⇒ 不参与' }); continue; }
    const ps = set.map((it) => it.eng[E]), ys = set.map((it) => it.y);
    const pt = murphyRes(ps, ys);
    const ci = bootCI(set.map((it, i) => ({ p: ps[i], y: ys[i] })), (s) => { const m = murphyRes(s.map((x) => x.p), s.map((x) => x.y)); return m.res === null ? 0 : m.res; }, NB, SEED);
    resGate.push({ engine: E, n: set.length, RES: pt.res, ci95_RES: ci, REL: pt.rel, UNC: pt.unc, brier: pt.brier,
      eligible: (ci.lo !== null && ci.lo > 0), verdict: (ci.lo !== null && ci.lo > 0) ? '进混合池（RES CI 下界 > 0）' : '不进混合池（CI 含 0 或下界 ≤ 0）' });
  }

  // ── §3.2 歧义分解（Ē_members − A） ──
  const amb = [];
  for (const [k, n] of Object.entries(pairPop)) {
    const [a, b] = k.split('×');
    const set = multi.filter((it) => it.keys.indexOf(a) !== -1 && it.keys.indexOf(b) !== -1);
    const per = set.map((it) => {
      const ps = [it.eng[a], it.eng[b]], bs = ps.map((p) => brier(p, it.y));
      const pbar = mean(ps);
      return { e_members: mean(bs), e_ensemble: brier(pbar, it.y), A: variance(ps), best_member: Math.min.apply(null, bs) };
    });
    const eMem = mean(per.map((x) => x.e_members)), eEns = mean(per.map((x) => x.e_ensemble));
    const A = mean(per.map((x) => x.A)), gap = mean(per.map((x) => x.e_members - x.best_member));
    const identGap = mean(per.map((x) => Math.abs((x.e_members - x.A) - x.e_ensemble)));
    amb.push({ pair: k, n: n, E_members: eMem, E_ensemble: eEns, A: A, expected_gain: eMem - eEns,
      skill_gap: gap, net_gain: A - gap, identity_residual: identGap,
      read: (A - gap) > 0 ? '净增益 > 0（组合优于直接挑最佳成员）' : '净增益 ≤ 0（组合不如直接挑最佳成员）' });
  }

  // ── 输出 ──
  const f6 = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(6);
  const L = [];
  L.push('# E2 立票前置 · 组合增益预检套件（16⑦7A/7B/7C）· ' + new Date().toISOString().slice(0, 10));
  L.push('');
  L.push('> 依据：`PREREG-E2-路由分配-v1.md` **§3 立票前置（先跑后立）**——§3.1 ρ̂（CI 下界 ≥' + RHO_KILL + ' ⇒ 该域组合臂判死）｜§3.2 歧义分解｜§3.3 RES 准入门（CI 下界 > 0 才进混合池）。');
  L.push('> 出处锚：Bates & Granger 1969 DOI 10.1057/jors.1969.103｜Krogh & Vedelsby 1995（教科书级）｜Kuncheva & Whitaker 2003 DOI 10.1023/a:1022859003006｜Murphy 1973。');
  L.push('> 纪律：**零账本写／零 LLM／零网络**；库 readOnly；**只测量，不改任何冻结判据**（改 §3.0 结论＝版本递进，须拍板）。');
  L.push('');
  L.push('## 0. ☆本件与旧预检的关键差别（本件立项理由）');
  L.push('- `e2-shadow-score.cjs`（09-16 预检）把引擎**按 layer 门控**（`if (r.layer===\'L3\') 才跑 L3`）⇒ **每题引擎数天然 ≤1**');
  L.push('  ⇒ 其「跨引擎重叠人口 **0 题**」**是脚本构造的产物，不是账本事实** —— 而该结论正是 PREREG §3.0 判「R3a/R3h 不启动」的前提。');
  L.push('- ③**旧件还把 L1 整层静默丢掉**：它调 `procCalc({statement: \'\'})`（照 **stage4-run.cjs:156 传的是真题面** `statement: r.statement`）⇒ L1 恒 `rule_unmatched`');
  L.push('  ⇒ 其 `scored_rows: 995` 实为「缺 L1 的 1175」；**180 道 L1 题从它所有臂读数里消失**（本件已修）。');
  L.push('- 本件改为**全引擎可用性矩阵**：每题**试遍 5 个引擎**（谁输入齐谁出数，不看 layer）⇒ 这才是「同一题上是否有 ≥2 个可估引擎」的正确测量。');
  L.push('');
  L.push('## 1. 全引擎影子矩阵');
  L.push('');
  L.push('- 队列（PREREG §1 池口径：`g2_regime=\'R4\'` ＋ 真值口径排除 ＋ 已解）⇒ **' + rows.length + ' 行**。');
  const per = {}; for (const it of items) per[it.keys.length] = (per[it.keys.length] || 0) + 1;
  L.push('- 每题可估引擎数分布：' + Object.keys(per).sort().map((k) => k + ' 个引擎 ⇒ ' + per[k] + ' 题').join('｜'));
  L.push('- **多引擎题数（≥2）＝ ' + multi.length + '**' + (multi.length >= 30 ? '（≥30 ✓）' : '（<30）')
    + '｜按引擎对：' + (Object.keys(pairPop).length ? Object.entries(pairPop).map(([k, v]) => k + ' ' + v + ' 题').join('｜') : '无'));
  L.push('- **多引擎人口按「题所属层 × 引擎对」拆分**（★关键：区分「层内多引擎」与「**跨层规则命中**」）：');
  for (const [k, v] of Object.entries(pairByLayer).sort()) L.push('  · ' + k.replace('｜', ' 层 ｜ ') + ' ⇒ ' + v + ' 题');
  L.push('- ⚠ 域解析兜底到 `(unknown)` 的行 ' + domFailed + '（如实披露；本件域维度只用于分组披露，不参与判据）。');
  L.push('');
  L.push('## 2. §3.1 组合增益预检（ρ̂ ＝ 成员两两 Brier 误差相关；判死线 CI 下界 ≥ ' + RHO_KILL + '）');
  L.push('');
  L.push('| 引擎对 | n | ρ̂ | 95% CI | 输出逐位相同 | 判决 |');
  L.push('|---|---|---|---|---|---|');
  for (const r of rho) L.push('| ' + r.pair + ' | ' + r.n + ' | ' + f6(r.rho_hat) + ' | [' + f6(r.ci95.lo) + ', ' + f6(r.ci95.hi) + '] | ' + (r.identical_outputs ? '**是**' : '否') + ' | ' + r.decision + ' |');
  L.push('');
  L.push('- 判据原文：ρ̂ 的 CI 下界 ≥ ' + RHO_KILL + ' ⇒ **该域组合臂判死**（负结果归档，省下组合臂预算）。');
  L.push('- **零方差 ⇒ ρ̂ 未定义 ⇒ 不编数**（如实标 `不可估`）；「输出逐位相同」时 ρ̂≡1，判决按判死处理（附实测标记）。');
  L.push('');
  L.push('## 3. §3.3 组合池 RES 准入门（引擎格级 Murphy RES 的 CI 下界 > 0）');
  L.push('');
  L.push('| 引擎 | n | RES | RES 95% CI | REL | UNC | Brier | 准入 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of resGate) {
    if (r.note) { L.push('| ' + r.engine + ' | ' + r.n + ' | — | — | — | — | — | ' + r.note + ' |'); continue; }
    L.push('| ' + r.engine + ' | ' + r.n + ' | ' + f6(r.RES) + ' | [' + f6(r.ci95_RES.lo) + ', ' + f6(r.ci95_RES.hi) + '] | ' + f6(r.REL) + ' | ' + f6(r.UNC) + ' | ' + f6(r.brier) + ' | ' + r.verdict + ' |');
  }
  L.push('');
  L.push('- 口径：RES ＝ Σ(n_b/N)(ō_b − ȳ)²（10 桶离散版，与 `u8-columns.cjs` 同口径）；n<' + MIN_PAIR_N + ' 的引擎不参与（PREREG §3.1「格 n<10 不参与」精神）。');
  L.push('');
  L.push('## 4. §3.2 歧义分解预检（Krogh–Vedelsby：Ē_ensemble ＝ Ē_members − A）');
  L.push('');
  L.push('| 引擎对 | n | Ē_members | Ē_ensemble | A（歧义度） | 期望增益(＝A) | 技巧差距 | **净增益(A−技巧差距)** | 恒等式残差 | 读法 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of amb) L.push('| ' + r.pair + ' | ' + r.n + ' | ' + f6(r.E_members) + ' | ' + f6(r.E_ensemble) + ' | ' + f6(r.A) + ' | ' + f6(r.expected_gain)
    + ' | ' + f6(r.skill_gap) + ' | **' + f6(r.net_gain) + '** | ' + (r.identity_residual === null ? 'n/a' : r.identity_residual.toExponential(1)) + ' | ' + r.read + ' |');
  L.push('');
  L.push('- 列义：`A`＝成员输出的（等权）方差（歧义度）｜`期望增益 ＝ Ē_members − Ē_ensemble ＝ A`（Krogh–Vedelsby 恒等，残差列即自检）；');
  L.push('  `技巧差距`＝Ē_members − 逐题最佳成员的 Brier 均值（**oracle，不可实现**，只作上界刻度）；**净增益 ＝ A − 技巧差距**（16⑦7A 原文式）。');
  L.push('');
  L.push('- 恒等式自检：`|Ē_members − A − Ē_ensemble|` 应 ≈0（平方损失下恒等）⇒ 残差列即自检（残差大＝口径错，读数不可用）。');
  L.push('- §3.2 的**可证伪判据**（期望增益与**实测 ΔBrier** 的秩相关 CI）**须下游实测数据** ⇒ **本件 n/a**（如实，不编数）。');
  L.push('');
  L.push('## 5. §3.4 开关自身判据');
  L.push('');
  L.push('- 「预测域集合 vs 实测增益域集合一致率 ≥70%」须**先有实测增益**（E2 跑起来才有）⇒ **本件 n/a**。');
  L.push('');
  L.push('## 6. ★结论与边界（如实）');
  L.push('');
  L.push('- 本件**只测量**：不启动任何 E2 臂、不改 PREREG 任何条文。是否据本件结果把 §3.0 的「R3a/R3h 不启动」改成别的，**属版本递进（须拍板）**。');
  L.push('- 组合臂的可行性结论以 §2 的 ρ̂ 为准（判死线写死）；§3 的 RES 门决定**谁有资格进混合池**；§4 给出**幅度估计**。');
  L.push('- 已知退化（如实）：两引擎**输出逐位相同**时 ρ̂≡1，组合在数学上等于单引擎（不是「相关高」，是**同一信号**）；');
  L.push('  引擎误差**零方差**（如完美复算层）时 ρ̂ 未定义 ⇒ 本件标 `不可估`，不编数。');
  L.push('');
  L.push('（预检套件完 · 零账本写 · 零 LLM · 零网络 · 只测量不改判据）');

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, 'e2-combo-precheck-' + today);
  fs.writeFileSync(base + '.json', JSON.stringify({
    script: 'p1b/scripts/e2-combo-precheck.cjs',
    basis: 'PREREG-E2-路由分配-v1.md §3（§3.1 ρ̂／§3.2 歧义分解／§3.3 RES 准入门／§3.4 一致率）',
    anchors: ['DOI 10.1057/jors.1969.103', 'Krogh-Vedelsby 1995（教科书级）', 'DOI 10.1023/a:1022859003006', 'Murphy 1973'],
    generated_at: new Date().toISOString(),
    discipline: { ledger_write: false, llm: false, network: false },
    difference_vs_old_precheck: '旧件 e2-shadow-score.cjs 按 layer 门控引擎 ⇒ 「重叠 0 题」是脚本构造产物；本件为全引擎可用性矩阵（每题试遍 5 引擎）。',
    does_not_change_frozen_criteria: '是否据本件改写 PREREG §3.0「R3 不启动」＝版本递进（须拍板）；本件只测量。',
    threshold_rho_kill: RHO_KILL, min_pair_n: MIN_PAIR_N,
    cohort_rows: rows.length, engine_count_distribution: per, multi_engine_items: multi.length, pair_population: pairPop,
    pair_population_by_layer: pairByLayer,
    domain_unknown_rows: domFailed,
    rho_precheck: rho, res_gate: resGate, ambiguity_decomposition: amb,
    not_run: { s32_falsification_spearman: '须下游实测 ΔBrier ⇒ n/a', s34_agreement_70pct: '须实测增益域集合 ⇒ n/a' },
    bootstrap: { B: NB, seed: SEED, method: '按题配对重采样·百分位法' },
  }, null, 1), 'utf8');
  fs.writeFileSync(base + '.md', L.join('\n') + '\n', 'utf8');
  console.log('=== E2 组合增益预检套件（16⑦7A/7B/7C）===');
  console.log('  队列 ' + rows.length + '｜可估引擎数分布 ' + JSON.stringify(per) + '｜多引擎题 ' + multi.length);
  for (const r of rho) console.log('  ρ̂ ' + r.pair + ': n=' + r.n + ' ρ̂=' + f6(r.rho_hat) + ' CI[' + f6(r.ci95.lo) + ',' + f6(r.ci95.hi) + ']' + (r.identical_outputs ? ' 输出逐位相同' : '') + ' ⇒ ' + r.decision);
  for (const r of resGate) console.log('  RES ' + r.engine + ': n=' + r.n + (r.note ? ' ' + r.note : ' RES=' + f6(r.RES) + ' CI[' + f6(r.ci95_RES.lo) + ',' + f6(r.ci95_RES.hi) + '] ⇒ ' + r.verdict));
  console.log('json/md -> ' + OUT_DIR);
}

module.exports = { pearson, spearman, murphyRes, bootCI, brier, variance };
if (require.main === module) { main(); }
