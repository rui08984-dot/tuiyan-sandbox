#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/e2-shadow-score.cjs —— E2 影子评分（六臂）＋ 判据机 · **v2 · 2026-09-17 重写**
 *
 * 依据（唯一冻结文本）：`PREREG-E2-路由分配-v1.md`（sha `5c354501…`）——§1 池／§2 六臂／§4 判据 C1-C4／§6 泄漏防线 M5①-⑤。
 *   详卡：`10-算子攻坚-深度报告.md` §5（五臂设计）｜`11-拒绝项救援-深度报告.md` §⑧（判据 v1.1 五修正 M1-M4）；
 *   蓝图 `20-合议-v3.1大升级蓝图.md` §2.2 #2（R3h 规格：Hedge＋sleeping experts＋η=1 冻结＋敏感性臂 {0.1,0.5,2} 只披露＋
 *   权重轨迹逐题落盘＋延迟结算队列＋组合池 RES 准入门）＋ 16③（Freund–Schapire 1997 DOI 10.1006/jcss.1997.1504；
 *   Freund et al. 1996 sleeping experts DOI 10.1145/258533.258616）；组合预检＝`e2-combo-precheck.cjs`；R1 落点＝`e2-r1-rules.cjs`。
 *
 * ★★ v2 相对 09-16 旧件（同路径，自标「未冻结·探索性」）的**两处缺陷修复**（缺陷已留痕，本件修根因）：
 *   ① 旧件**按 layer 门控引擎**（`if (r.layer==='L3') 才跑 L3`）⇒ 每题引擎数天然 ≤1 ⇒ 其「跨引擎重叠 0 题」是**脚本构造的产物**
 *      （而该 0 正是 PREREG §3.0 判「R3 双臂不启动」的前提 —— 该前提后经 `e2-combo-precheck.cjs` 全引擎矩阵更正为 1116 题）；
 *   ② 旧件调 `procCalc({statement:''})` ⇒ L1 恒 `rule_unmatched` ⇒ **180 道 L1 题从它所有臂读数里静默消失**。
 *   本件一律走 `buildEngineMatrix()`（全引擎可用性矩阵、**真题面**）——**单一实现**，与 combo-precheck／r1-rules 同源，禁写第二份。
 *
 * 六臂（PREREG §2 全预注册；KK516 many-designs ⇒ 全臂披露）：
 *   R0 现状重放｜R1 语义重判 v1（规则版 sha 冻结；落点＝`r1Plan()` 单一实现）｜R2 全基率（＝L2 引擎输出，全题跑基率）｜
 *   R3a 误差反馈 argmin（walk-forward）｜R3h Hedge 混合（sleeping experts＋延迟结算队列＋权重轨迹逐题落盘）｜R4 随机（单 seed）。
 *   泄漏防线（§6 M5）：① R1 规则 sha 冻结**先于读数**（机器闸）② R3 双臂 walk-forward（t 题只用 resolved_at<t 的结局）
 *   ③ 薄格 n<10 不参与 argmin、默认回 R0 ④ R4 单 seed 禁择优 ⑤ **shadow 无选择权**（降档/拒出题一律留 R0 口径评分，防幸存者偏差）。
 *
 * 判据机（§4）：
 *   C2（primary）R1 vs R0 配对非劣：ΔCI **上界 ≤ +0.005**；主口径＝控制 layer×domain 的**分层**配对 CI（§4 原文「条件化」）；
 *     M4 义务＝并报 MDE，且 CI 宽于 ±0.01 时判「非劣成立但信息量极低」。
 *   C4a/C4b（secondary）R3 双臂 vs R0／vs R2：**下界 > 0 ⇒ 有限开启**；CI 含 0 ⇒ 报 CI＋MDE，结论限定为
 *     「在该 MDE 分辨率下无增益证据」；要正面主张「无增益」⇒ **TOST 等效性检验**。M2＝Holm 校正与「仅描述性」两声明并列。
 *   C3 姿态指标：各臂出概率题数/占比变化 **披露**（禁「拒掉难题抬 Brier」）；并列 own_set 与 common_set 两口径 Brier。
 *   C1（人工分层双编码 ≥85%）＝**本件 n/a**（人工门；本件只提供 Wilson 工具函数，不代填判读）。
 *
 * ★ 三处**实现选择**（冻结文本未逐字给定；全部显式声明、可配置、不新造阈值）：
 *   ① **TOST ε**：§4 只说「用 TOST」，未命名 ε ⇒ 默认 ε＝**0.005＝C2 既有非劣边际（同一把尺）**，并列敏感性 {0.0025, 0.005, 0.01}；
 *      正式判读须版本递进补记（**须拍板**），本件只披露不据此判生死。
 *   ② **R3a tie-break**：历史 Brier 并列时取 **design §1.2 层优先级 L5>L6>L1>L3>L2**（项目既有序，不新造）。
 *   ③ **R4 随机口径**：在**本题可估引擎**中均匀随机取一（旧件同口径）；单引擎题上退化 ⇒ 与「随机层＋回退」在该类题上等价。
 *   ★ 符号口径（统一披露，禁混用）：**非劣**用「臂 − 基线」（上界 ≤ +0.005 ⇒ 臂不更差）；**增益**用「基线 − 臂」（下界 > 0 ⇒ 臂更好）。
 *
 * ★★ 开跑令闸（机械执行「冻结的是判据，不是开跑令」——PREREG §3.0）：
 *   **无 `--arms` ⇒ 打印开跑前提状态并 `exit 3`，不写任何读数件**；有 `--arms` ⇒ 先核 R1 冻结件 sha MATCH（不 MATCH 即 exit 3）再跑。
 *   ⇒ 「开跑」＝一次显式动作（照 `corpus-resolve-daemon --confirm` 先例），防「多次开跑的选择性」。
 *
 * 纪律：库 readOnly｜**零账本写／零 LLM／零网络**｜不碰生产路由｜失败零迁移损伤。
 * 用法：
 *   node p1b/scripts/e2-shadow-score.cjs            # 无 --arms ⇒ 报开跑前提状态、exit 3、零写盘
 *   node p1b/scripts/e2-shadow-score.cjs --arms [--db <p>] [--out-dir <d>] [--boot 1000] [--seed 987654321]
 *                                            [--eta 1] [--tost-eps 0.005] [--rules <冻结件>]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const RULES = arg('rules', path.join(ROOT, '.scratch', 'forecast-debate', 'E2-R1-规则版-v1-冻结件-20260917.md'));
const ARMS = process.argv.indexOf('--arms') !== -1;
const NB = Number(arg('boot', '1000'));
const SEED = Number(arg('seed', '987654321'));
const ETA = Number(arg('eta', '1'));
const TOST_EPS = Number(arg('tost-eps', '0.005'));
const ENGINE_KEYS = ['L1', 'L2', 'L3', 'L5', 'L6'];       // L4 为叠加层、按设计不出数
const PRIORITY = ['L5', 'L6', 'L1', 'L3', 'L2'];           // design §1.2（R3a tie-break 取其序）
const MIN_CELL = 10;          // M5③ 冻结：格 n<10 不参与 argmin
const C2_MARGIN = 0.005;      // §4 C2 冻结线（非劣上界）
const R4_SEED = 987654321;    // M5④ 单一冻结 seed（禁多 seed 择优）
const ETA_SENS = [0.1, 0.5, 2];        // 蓝图 §2.2#2：敏感性臂**只披露**
const TOST_EPS_GRID = [0.0025, 0.005, 0.01];

// ── 纯函数区（可 require，零副作用） ─────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const brier = (p, y) => (p - y) * (p - y);
const variance = (a) => (a.length ? mean(a.map((x) => (x - mean(a)) ** 2)) : null);
const f6 = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(6);

/** 配对（按题）bootstrap 百分位 CI —— ★照 `stage4-run.cjs::bootDeltaCI` 既有口径（B／seed／LCG／百分位法），不另立。 */
function bootDeltaCI(diffs, B, seed) {
  const n = diffs.length;
  if (!n) return { lb: null, ub: null, mean: null, se: null, B: B, seed: seed };
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const ms = [];
  for (let b = 0; b < B; b++) { let acc = 0; for (let i = 0; i < n; i++) acc += diffs[Math.floor(rnd() * n)]; ms.push(acc / n); }
  ms.sort((x, y) => x - y);
  const q = (t) => ms[Math.min(ms.length - 1, Math.max(0, Math.floor(t * ms.length)))];
  return { lb: q(0.025), ub: q(0.975), lo90: q(0.05), hi90: q(0.95), mean: mean(diffs), se: Math.sqrt(variance(ms)), B: B, seed: seed };
}

/**
 * 分层配对 bootstrap（§4 C2「控制 layer×domain 后条件化」的主口径）——★照 `dna-s-judge.cjs` 既有口径：
 *   Δ ＝ Σ_格 w_格·mean_格(Δ)，w_格 ＝ 格内题数占全样本比；**重采样在格内逐题**进行（格×臂内重采样）。
 *   ★恒等自检：点估计 ≡ 全样本均值（Σ w_格 mean_格 恒等于总体均值）⇒ 本函数并列 `identity_residual`；
 *   分层改变的是**区间**（消除格间构成差对区间的贡献），不是点估计 —— 这正是「条件化」的含义。
 */
function stratDeltaCI(rows, B, seed) {
  const n = rows.length;
  if (!n) return { delta: null, lo: null, hi: null, lo90: null, hi90: null, se: null, cells: 0, n: 0, identity_residual: null, B: B, seed: seed };
  const cells = {};
  for (const r of rows) (cells[r.cell] = cells[r.cell] || []).push(r.d);
  const keys = Object.keys(cells);
  const w = {};
  for (const k of keys) w[k] = cells[k].length / n;
  const stat = (cc) => { let s = 0; for (const k of keys) { const a = cc[k]; if (!a || !a.length) continue; s += w[k] * (a.reduce((x, y) => x + y, 0) / a.length); } return s; };
  const point = stat(cells);
  let s2 = (seed >>> 0) || 1;
  const rnd = () => { s2 = (1664525 * s2 + 1013904223) >>> 0; return s2 / 4294967296; };
  const v = [];
  for (let b = 0; b < B; b++) {
    const samp = {};
    for (const k of keys) { const a = cells[k], out = new Array(a.length); for (let i = 0; i < a.length; i++) out[i] = a[Math.floor(rnd() * a.length)]; samp[k] = out; }
    v.push(stat(samp));
  }
  v.sort((x, y) => x - y);
  const q = (t) => v[Math.min(v.length - 1, Math.max(0, Math.floor(t * v.length)))];
  const raw = mean(rows.map((r) => r.d));
  return { delta: point, lo: q(0.025), hi: q(0.975), lo90: q(0.05), hi90: q(0.95), se: Math.sqrt(variance(v)),
    cells: keys.length, n: n, identity_residual: Math.abs(point - raw), B: B, seed: seed };
}

/** 单侧 bootstrap p：H0「增益 ≤ 0」对 H1「增益 > 0」⇒ p ＝ #{增益* ≤ 0}/B（百分位法）。 */
function bootPGreaterZero(gains, B, seed) {
  const n = gains.length;
  if (!n) return null;
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  let c = 0;
  for (let b = 0; b < B; b++) { let acc = 0; for (let i = 0; i < n; i++) acc += gains[Math.floor(rnd() * n)]; if (acc / n <= 0) c++; }
  return c / B;
}

/** MDE（α=.05 双侧、80% 功效）：MDE ＝ (z_{1−α/2} + z_{1−β})·SE ＝ 2.802·SE（§4 M4 义务用）。 */
function mdeFromSE(se) { return (se === null || se === undefined || !isFinite(se)) ? null : 2.802 * se; }

/** Holm 逐步校正（§4 M2：secondary 检验族；保序输出）。输入 p 值数组 ⇒ {adjusted:[…], order:[…]}。 */
function holm(pvals) {
  const idx = pvals.map((p, i) => ({ p: p === null || p === undefined ? 1 : p, i: i })).sort((a, b) => a.p - b.p);
  const m = idx.length; const adj = new Array(m); let run = 0;
  for (let r = 0; r < m; r++) { const val = Math.min(1, idx[r].p * (m - r)); run = Math.max(run, val); adj[r] = run; }
  const out = new Array(m);
  for (let r = 0; r < m; r++) out[idx[r].i] = adj[r];
  return out;
}

/**
 * TOST 等效性检验（bootstrap 百分位实现；§4 C4 支路）：
 *   p_lower ＝ #{Δ* ≤ −ε}/B｜p_upper ＝ #{Δ* ≥ +ε}/B｜TOST p ＝ max(两者)。
 *   ★恒等（已被测试锁定）：TOST p < α ⇔ **(1−2α) CI ⊂ (−ε, +ε)**（α=.05 ⇔ 90% CI）——两种写法同一件事。
 */
function tostFromDelta(diffs, eps, B, seed) {
  const n = diffs.length;
  if (!n) return { eps: eps, p_lower: null, p_upper: null, tost_p: null, equivalent_at_05: false, ci90: [null, null], n: 0 };
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const ms = [];
  for (let b = 0; b < B; b++) { let acc = 0; for (let i = 0; i < n; i++) acc += diffs[Math.floor(rnd() * n)]; ms.push(acc / n); }
  ms.sort((x, y) => x - y);
  const shareLE = ms.filter((x) => x <= -eps).length / B;
  const shareGE = ms.filter((x) => x >= eps).length / B;
  const q = (t) => ms[Math.min(ms.length - 1, Math.max(0, Math.floor(t * ms.length)))];
  const lo90 = q(0.05), hi90 = q(0.95);
  const tostP = Math.max(shareLE, shareGE);
  return { eps: eps, p_lower: shareLE, p_upper: shareGE, tost_p: tostP, equivalent_at_05: tostP < 0.05,
    ci90: [lo90, hi90], ci90_within_eps: (lo90 > -eps) && (hi90 < eps), n: n, B: B, seed: seed };
}

/**
 * R3h · Hedge 在线指数加权（PREREG §2 R3h；蓝图 §2.2#2 规格逐条）：
 *   · **sleeping experts**（Freund et al. 1996）：本题无输出的引擎既不参与预测也不吃损失；
 *   · 预测 p̂ ＝ Σ_awake w_e·p_e / Σ_awake w_e（**混合**，不是选择）；
 *   · 权重更新 w_e ← w_e·exp(−η·ℓ_e)，ℓ_e＝Brier(p_e, y)，**只在结算时**对 awake 者施乘子，随后统一归一化；
 *   · **延迟结算队列**（Adamskiy 2017 口径）：题按 resolved_at 升序进入队列，**仅当后续题 resolved_at 严格大于**本题时才结算
 *     ⇒ 题 t 的预测只用 resolved_at < t 的结局（M5② walk-forward 的在线版；**同刻批量零信息流**，防批内泄漏）；
 *   · η 冻结＝1；敏感性臂 {0.1, 0.5, 2} 由调用方**只披露**（不进门控）。
 * @returns {{preds:Object, traj:Array, counts:Object, weights_final:Object, eta:number}}
 */
function hedgeRun(seq, opts) {
  const o = opts || {};
  const eta = o.eta === undefined ? 1 : o.eta;
  const ek = o.engines || ENGINE_KEYS;
  const w = {}; for (const e of ek) w[e] = 1 / ek.length;         // 均匀初值
  const snap = () => { const c = {}; for (const e of ek) c[e] = w[e]; return c; };
  let pending = [];
  const preds = {}; const traj = []; const counts = { predicted: 0, no_awake: 0 };
  const settle = (items) => {                                     // 一批同刻题的乘子累乘后统一归一化
    const mult = {}; for (const e of ek) mult[e] = 1;
    for (const it of items) for (const e of it.awake) mult[e] *= Math.exp(-eta * it.loss[e]);
    let s = 0; for (const e of ek) { w[e] *= mult[e]; s += w[e]; }
    if (s > 0) for (const e of ek) w[e] /= s;
  };
  for (const q of seq) {
    const t = String(q.resolved_at === undefined || q.resolved_at === null ? '' : q.resolved_at);
    const ready = pending.filter((p) => p.t < t);
    if (ready.length) { settle(ready); pending = pending.filter((p) => p.t >= t); }
    const awake = (q.keys || []).filter((e) => q.eng[e] !== undefined && q.eng[e] !== null && isFinite(q.eng[e]));
    if (!awake.length) { counts.no_awake++; traj.push({ id: q.id, t: t, awake: [], w: snap(), p: null, note: 'no_awake' }); continue; }
    let num = 0, den = 0;
    for (const e of awake) { num += w[e] * q.eng[e]; den += w[e]; }
    const p = den > 0 ? num / den : null;
    preds[q.id] = p; counts.predicted++;
    traj.push({ id: q.id, t: t, awake: awake.slice(), w: snap(), p: p });
    const loss = {}; for (const e of awake) loss[e] = brier(q.eng[e], q.y);
    pending.push({ t: t, awake: awake, loss: loss });
  }
  return { preds: preds, traj: traj, counts: counts, weights_final: snap(), eta: eta };
}

/**
 * R3a · 误差反馈 argmin（walk-forward；PREREG §2 R3a ＋ M5②③）：
 *   格＝**题所属域**（§2「按 domain 格历史 Brier 选引擎」）；历史＝resolved_at < t 的已结题在该域上的**引擎级**平均 Brier；
 *   格历史题数 < MIN_CELL ⇒ **不参与 argmin、默认回 R0**（M5③ 冻结）；引擎级历史 ≥1 才为候选（样本为 0 ⇒ 均值未定义，不是阈值）；
 *   并列 ⇒ tie-break 取 design §1.2 优先级序（★实现选择①/②）；选中引擎在本题不可用（sleeping）⇒ 回 R0，如实计数。
 * @returns {{choices:Object, counts:Object}}  choices[id] ＝ {pick:'Lx'|null, why:string}
 */
function r3aRun(seq, opts) {
  const o = opts || {};
  const minCell = o.minCell === undefined ? MIN_CELL : o.minCell;
  const ek = o.engines || ENGINE_KEYS;
  const prio = o.priority || PRIORITY;
  const hist = {};           // domain -> {n: 题数, e:{Lx:{n,s}}}
  let pending = [];
  const choices = {}; const counts = { argmin: 0, default_r0_thin: 0, sleeping_fallback: 0 };
  const fold = (items) => {
    for (const it of items) {
      const c = hist[it.domain] || (hist[it.domain] = { n: 0, e: {} });
      c.n++;
      for (const e of (it.keys || [])) { if (it.eng[e] === undefined) continue; const x = c.e[e] || (c.e[e] = { n: 0, s: 0 }); x.n++; x.s += brier(it.eng[e], it.y); }
    }
  };
  for (const q of seq) {
    const t = String(q.resolved_at === undefined || q.resolved_at === null ? '' : q.resolved_at);
    const ready = pending.filter((p) => p.t < t);
    if (ready.length) { fold(ready); pending = pending.filter((p) => p.t >= t); }
    const c = hist[q.domain];
    let pick = null, why = '';
    if (!c || c.n < minCell) { why = 'default_r0（格历史 n<' + minCell + '）'; counts.default_r0_thin++; }
    else {
      const cands = ek.filter((e) => c.e[e] && c.e[e].n >= 1);
      if (!cands.length) { why = 'default_r0（格内无引擎历史）'; counts.default_r0_thin++; }
      else {
        cands.sort((a, b) => {
          const ma = c.e[a].s / c.e[a].n, mb = c.e[b].s / c.e[b].n;
          if (ma !== mb) return ma - mb;                       // 历史均值小者胜（Brier 越低越好）
          return prio.indexOf(a) - prio.indexOf(b);            // ★tie-break＝design §1.2 序
        });
        pick = cands[0]; why = 'argmin（域历史均值 ' + (c.e[pick].s / c.e[pick].n).toFixed(6) + '，n=' + c.e[pick].n + '）';
        counts.argmin++;
      }
    }
    if (pick && (q.eng[pick] === undefined || q.eng[pick] === null)) { why = 'default_r0（argmin 选中 ' + pick + '，本题不可用 ⇒ sleeping 回退）'; pick = null; counts.sleeping_fallback++; }
    choices[q.id] = { pick: pick, why: why };
    pending.push({ t: t, keys: (q.keys || []).slice(), eng: q.eng, y: q.y, domain: q.domain, id: q.id });
  }
  return { choices: choices, counts: counts };
}

/** 均匀随机取一（R4；单 seed 冻结；仅本题可估引擎中取）。 */
function r4Run(seq, opts) {
  const o = opts || {};
  let s = (o.seed === undefined ? R4_SEED : o.seed) >>> 0;
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const picks = {}; const counts = { picked: 0, no_engine: 0 };
  for (const q of seq) {
    const ks = (q.keys || []).filter((e) => q.eng[e] !== undefined && q.eng[e] !== null);
    if (!ks.length) { counts.no_engine++; picks[q.id] = null; continue; }
    picks[q.id] = ks[Math.floor(rnd() * ks.length)];
    counts.picked++;
  }
  return { picks: picks, counts: counts, seed: (o.seed === undefined ? R4_SEED : o.seed) };
}

/**
 * R3h 权重塌缩自检（纯函数；**显示用，非判据/非门控**）：
 *   · `effective_experts_mean`＝逐题按 **awake 归一**后的**有效专家数**（1/Σŵ_i²）在真混合题上的均值（2＝等权，1＝完全塌缩）；
 *   · `single_engine_questions`＝当刻 awake 归一后**最大权重 ≥0.99** 的题数（即该题实际只信一个引擎）；
 *   · 终局最大权重与引擎名（`display_flag`＝终局权重 ≥0.99）。
 *   机制：w ∝ exp(−η·Σℓ)，η=1、ℓ=Brier∈[0,1] ⇒ 权重按**更新次数**指数拉开；sleeping 者不吃损失
 *   ⇒ 出现越少、失误越少者越占优。`effective_experts_mean ≈ 1` 即「混合」名存实亡（该臂退化为单引擎对照）。
 */
function weightCollapse(traj, items, weightsFinal) {
  const byId = {}; for (const it of items) byId[it.id] = it;
  let mixN = 0, singleN = 0, effSum = 0, effCnt = 0;
  for (const x of traj) {
    const aw = x.awake || [];
    if (aw.length >= 2) mixN++;
    if (!aw.length) continue;
    let tot = 0; for (const e of aw) tot += (x.w[e] || 0);
    if (tot <= 0) continue;
    let ss = 0, mx = 0;
    for (const e of aw) { const ww = (x.w[e] || 0) / tot; ss += ww * ww; if (ww > mx) mx = ww; }
    if (ss > 0) { effSum += 1 / ss; effCnt++; }
    if (mx >= 0.99) singleN++;
  }
  const keys = Object.keys(weightsFinal || {});
  const topEngine = keys.sort((a, b) => weightsFinal[b] - weightsFinal[a])[0] || null;
  const topWeight = topEngine ? weightsFinal[topEngine] : null;
  const effN = effCnt ? effSum / effCnt : null;
  return { top_engine: topEngine, top_weight: topWeight, mixed_questions: mixN, single_engine_questions: singleN,
    effective_experts_mean: effN, display_flag: topWeight !== null && topWeight >= 0.99,
    note: '★显示用（非判据/非门控）：η=1、Brier∈[0,1] 下指数权重随更新次数塌缩；effective_experts_mean≈1（或 single_engine_questions≈混合题数）⇒ 该臂实为单引擎对照。' };
}

/**
 * 六臂取值（纯函数；单一数据面）：每题的臂概率 ＋ 每臂的「改口」计数与 R0 回退计数。
 * 臂的定义（PREREG §2）：
 *   R0 ＝ eng[layer]（本层引擎不可估 ⇒ **null**，该题不进任何配对集，人口如实披露）
 *   R1 ＝ 落点层引擎（r1Plan.kept）／降档或未保留 ⇒ **保留 R0 口径**（M5⑤ 无选择权）
 *   R2 ＝ eng.L2（全题走基率；无基率 ⇒ **null，不回退 R0** —— 防「回退＝与 R0 同值」把等效性读虚高）
 *   R3a/R4/R3h ＝ 各自决策；决策落空 ⇒ 回 R0（如实计数）
 */
function runArms(items, r1plan, opts) {
  const o = opts || {};
  const seq = o.seq;                                    // 已按时序排好（buildSeq）
  const hedge = o.hedge || hedgeRun(seq, { eta: o.eta === undefined ? ETA : o.eta, engines: o.engines });
  const r3a = o.r3a || r3aRun(seq, { engines: o.engines, minCell: o.minCell, priority: o.priority });
  const r4 = o.r4 || r4Run(seq, { seed: o.seed4 === undefined ? R4_SEED : o.seed4 });
  const vals = { R0: {}, R1: {}, R2: {}, R3a: {}, R3h: {}, R4: {} };
  const meta = {};
  for (const it of items) {
    const r0 = it.eng[it.layer] === undefined ? null : it.eng[it.layer];
    const plan = r1plan.perItem[it.id] || { kept: false, r1Layer: null };
    const r1 = (plan.kept && plan.r1Layer && it.eng[plan.r1Layer] !== undefined) ? it.eng[plan.r1Layer] : r0;
    const r2 = (it.eng.L2 === undefined) ? null : it.eng.L2;
    const c = r3a.choices[it.id] || { pick: null, why: '' };
    const r3 = (c.pick && it.eng[c.pick] !== undefined) ? it.eng[c.pick] : r0;
    const hp = hedge.preds[it.id];
    const rh = (hp === undefined || hp === null) ? r0 : hp;
    const pick4 = r4.picks[it.id];
    const r4v = (pick4 && it.eng[pick4] !== undefined) ? it.eng[pick4] : r0;
    vals.R0[it.id] = r0; vals.R1[it.id] = r1; vals.R2[it.id] = r2;
    vals.R3a[it.id] = r3; vals.R3h[it.id] = rh; vals.R4[it.id] = r4v;
    meta[it.id] = { r0_definitional: r0 !== null, r1_kept: !!plan.kept, r1_layer: plan.r1Layer || null,
      r3a_pick: c.pick, r3a_why: c.why, r3h_predicted: hp !== undefined && hp !== null,
      r4_pick: pick4 || null, switched_vs_r0: { R1: (r1 !== null && r0 !== null && r1 !== r0), R2: (r2 !== null && r0 !== null && r2 !== r0),
        R3a: (r3 !== null && r0 !== null && r3 !== r0), R3h: (rh !== null && r0 !== null && rh !== r0), R4: (r4v !== null && r0 !== null && r4v !== r0) } };
  }
  return { vals: vals, meta: meta, hedge: hedge, r3a: r3a, r4: r4 };
}

/** 配对行（两臂同题均有值）⇒ [{id, d, cell}]；d ＝ Brier(臂) − Brier(基线)（非劣方向）。 */
function pairedRows(items, vals, armKey, baseKey) {
  const rows = [];
  for (const it of items) {
    const a = vals[armKey][it.id], b = vals[baseKey][it.id];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    rows.push({ id: it.id, d: brier(a, it.y) - brier(b, it.y), cell: it.layer + '/' + it.domain, y: it.y, dArm: a, dBase: b });
  }
  return rows;
}
/** 同集合上的 Brier 均值（`own_set` 口径由调用方传子集）。 */
function brierMean(items, vals, armKey, subset) {
  const ps = [];
  for (const it of items) { if (subset && !subset.has(it.id)) continue; const v = vals[armKey][it.id]; if (v === null || v === undefined) continue; ps.push(brier(v, it.y)); }
  return ps.length ? { n: ps.length, brier: mean(ps) } : { n: 0, brier: null };
}
/** 确定性时序：resolved_at 升序，同刻 tie-break＝id。 */
function buildSeq(items) {
  return items.slice().sort((a, b) => {
    const ta = String(a.resolved_at === null || a.resolved_at === undefined ? '' : a.resolved_at);
    const tb = String(b.resolved_at === null || b.resolved_at === undefined ? '' : b.resolved_at);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id - b.id;
  });
}

// ── 主流程（只在 CLI 直跑；require 不写盘、不读库） ───────────────────────────
function main() {
  const combo = require(path.join(ROOT, 'p1b', 'scripts', 'e2-combo-precheck.cjs'));
  const r1mod = require(path.join(ROOT, 'p1b', 'scripts', 'e2-r1-rules.cjs'));
  const { wilson } = require(path.join(ROOT, 'p1b', 'src', 'engines', 'l2_baseline'));

  // ★★ 开跑令闸：无 --arms ⇒ 报前提状态并拒跑（零写盘）
  if (!ARMS) {
    let status = '（未测：闸在读数之前，未读库）';
    try {
      const M0 = combo.buildEngineMatrix(DB_PATH);
      const multi = M0.multi.length;
      status = '队列 ' + M0.cohortRows + '｜多引擎题 ' + multi + (multi >= 30 ? '（≥30 ✓ 前提①成立）' : '（<30 ⇒ 前提①未达）');
    } catch (e) { status = '（矩阵构建失败：' + e.message + '）'; }
    console.error('=== E2 影子评分 v2 · 开跑令闸 ===');
    console.error('  前提① 跨引擎覆盖 ≥30 题：' + status);
    console.error('  前提② R1 规则版 sha 冻结：' + path.relative(ROOT, RULES).replace(/\\/g, '/') + '（本闸在 --arms 路径内复核 MATCH）');
    console.error('  ★ PREREG §3.0「冻结的是判据，不是开跑令」⇒ 本件**无 --arms 一律不跑、不写任何读数件**。');
    console.error('  开跑＝一次显式动作：node p1b/scripts/e2-shadow-score.cjs --arms');
    process.exit(3);
  }

  // ① R1 冻结件复核（M5①：冻结先于读数——机器闸，不 MATCH 即停）
  const freezeOut = execFileSync(process.execPath, [path.join(ROOT, 'p1b', 'scripts', 'prereg-freeze.cjs'), RULES], { encoding: 'utf8' });
  const rulesSha = (/sha256\s*=\s*([0-9a-f]{64})/.exec(freezeOut) || [])[1] || null;
  const rulesMatch = /MATCH\s*=\s*true/.test(freezeOut);
  if (!rulesMatch) { console.error('!! R1 冻结件 sha 未 MATCH ⇒ 停（规则可能被改；改动须走版本递进）'); console.error(freezeOut.trim()); process.exit(3); }

  // ② 单一实现取矩阵 ＋ R1 落点
  const mat = combo.buildEngineMatrix(DB_PATH);
  const items = mat.items;
  const plan = r1mod.r1Plan(items, { combo: combo, B: NB, seed: SEED });
  const seq = buildSeq(items);

  // ③ 六臂（R3h 主臂 η＝ETA；敏感性臂只披露）
  const R = runArms(items, plan, { seq: seq, eta: ETA });
  const sens = {};
  for (const e of ETA_SENS) sens['eta_' + e] = hedgeRun(seq, { eta: e });

  // ④ 判据机
  const c2Rows = pairedRows(items, R.vals, 'R1', 'R0');                       // 非劣：臂 − 基线
  const c2Raw = bootDeltaCI(c2Rows.map((r) => r.d), NB, SEED);
  const c2Strat = stratDeltaCI(c2Rows, NB, SEED);
  const c2Mde = mdeFromSE(c2Strat.se);
  const c2AllZero = c2Rows.length > 0 && c2Rows.every((r) => r.d === 0);      // ★逐题同值 ⇒ 判定无信息量（不是「非劣证据」）
  const c2Width = c2Strat.hi === null ? null : (c2Strat.hi - c2Strat.lo);
  const c2Verdict = c2Strat.hi === null ? '不可估（无配对行）'
    : (c2Strat.hi > C2_MARGIN ? '非劣不通过（CI 上界 > +' + C2_MARGIN + '）'
      : (c2AllZero ? '非劣通过 —— ★但臂与基线**逐题同值**（Δ≡0）⇒ 判定**无信息量**，不得读作证据（M4 情形）'
        : (c2Width > 0.02 ? '非劣通过（★CI 宽 > ±0.01 ⇒ M4：信息量极低）' : '非劣通过')));

  const c4 = {};
  for (const [k, armKey, baseKey] of [['R3a_vs_R0', 'R3a', 'R0'], ['R3h_vs_R0', 'R3h', 'R0'], ['R3a_vs_R2', 'R3a', 'R2'], ['R3h_vs_R2', 'R3h', 'R2']]) {
    const rows = pairedRows(items, R.vals, armKey, baseKey);
    const raw = bootDeltaCI(rows.map((r) => r.d), NB, SEED);                 // 非劣方向（臂−基线）
    const strat = stratDeltaCI(rows, NB, SEED);
    const gains = rows.map((r) => -r.d);                                     // 增益方向（基线−臂）＝相反数
    const gainCI = bootDeltaCI(gains, NB, SEED);
    const allZero = rows.length > 0 && rows.every((r) => r.d === 0);         // ★逐题同值 ⇒ 等效/无差异判定皆无信息量
    // TOST（ε 默认＝C2 既有边际；敏感性网格只披露）
    const tost = tostFromDelta(gains, TOST_EPS, NB, SEED);
    const tostGrid = {}; for (const e of TOST_EPS_GRID) tostGrid['eps_' + e] = tostFromDelta(gains, e, NB, SEED);
    c4[k] = { arm: armKey, base: baseKey, n: rows.length, cells: strat.cells, identical_per_question: allZero,
      delta_noninf: { mean: raw.mean, ci: [raw.lb, raw.ub], strat_mean: strat.delta, strat_ci: [strat.lo, strat.hi], strat_identity_residual: strat.identity_residual },
      delta_gain_base_minus_arm: { mean: gainCI.mean, ci: [gainCI.lb, gainCI.ub],
        strat_ci: [strat.hi === null ? null : -strat.hi, strat.lo === null ? null : -strat.lo],   // 增益分层 CI ＝ −[hi, lo]
        p_gain_positive: bootPGreaterZero(gains, NB, SEED) },
      mde: mdeFromSE(strat.se), mde_note: 'M4 义务：CI 含 0 时结论限定为「在该 MDE 分辨率下无增益证据」',
      decision: ((gainCI.lb !== null && gainCI.lb > 0) ? '有限开启（增益 CI 下界 > 0）'
        : (gainCI.lb !== null && gainCI.ub < 0 ? '方向为负（臂显著更差）' : 'CI 含 0 ⇒ 无增益证据（禁写「全灭」；正面主张须 TOST）'))
        + (allZero ? '；★逐题同值 ⇒ 该判定的「等效/无差异」均**无信息量**（臂与 R0 逐题同值）' : ''),
      tost: tost, tost_sensitivity: tostGrid };
  }
  // Holm（secondary 族＝上表四个比较；输入＝各比较「增益 > 0」的单侧 bootstrap p）
  const c4Keys = Object.keys(c4);
  const c4P = c4Keys.map((k) => c4[k].delta_gain_base_minus_arm.p_gain_positive);
  const holmP = holm(c4P);
  const holmByKey = {}; c4Keys.forEach((k, i) => { holmByKey[k] = holmP[i]; });

  // ⑤ C3 姿态指标（出概率题数/占比；own_set 与 common_set 两口径 Brier）＋ R3h 权重塌缩自检
  const collapse = weightCollapse(R.hedge.traj, items, R.hedge.weights_final);
  const mixN = collapse.mixed_questions, differsN = collapse.differs_from_top_engine, topEngine = collapse.top_engine;
  const c3 = {};
  const switched = { R1: 0, R2: 0, R3a: 0, R3h: 0, R4: 0 };   // 与 R0 取值不同的题数（披露「改口率」）
  const commonR0 = new Set(items.filter((it) => R.vals.R0[it.id] !== null).map((it) => it.id));
  const commonR2 = new Set(items.filter((it) => R.vals.R2[it.id] !== null).map((it) => it.id));
  for (const it of items) { const m = R.meta[it.id]; if (!m) continue; for (const k of Object.keys(switched)) if (m.switched_vs_r0[k]) switched[k]++; }
  /** 姿态出数集（C3）：★R1 的**published（真出数）**＝落点保留题；降档题虽以 R0 口径**计入配对**，但**不计入姿态出数**。
   *  其余臂的 published ＝ 自身取值非 null 的题。两口径并列 = 「M5⑤ 零选择权」的可见证据。 */
  const publishedOf = (armKey) => {
    const s = new Set();
    for (const it of items) {
      if (armKey === 'R1') { const m = R.meta[it.id]; if (m && m.r1_kept && R.vals.R1[it.id] !== null) s.add(it.id); }
      else if (R.vals[armKey][it.id] !== null) s.add(it.id);
    }
    return s;
  };
  for (const armKey of ['R0', 'R1', 'R2', 'R3a', 'R3h', 'R4']) {
    const pub = publishedOf(armKey);
    const own = items.filter((it) => R.vals[armKey][it.id] !== null).map((it) => it.id);
    c3[armKey] = { published: pub.size, share_of_cohort: items.length ? pub.size / items.length : null,
      scored_nonnull: own.length,
      brier_own_set: brierMean(items, R.vals, armKey, pub).brier,
      brier_common_set: brierMean(items, R.vals, armKey, commonR0).brier,
      scored_common_set: brierMean(items, R.vals, armKey, commonR0).n,
      switched_vs_r0: armKey === 'R0' ? 0 : switched[armKey] };
  }

  // ⑥ 落盘
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, 'e2-shadow-score-' + today);
  const weightsFile = path.join(OUT_DIR, 'e2-shadow-weights-' + today + '.jsonl');
  fs.writeFileSync(weightsFile, R.hedge.traj.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');

  const L = [];
  L.push('# E2 影子评分（六臂）＋判据机 · ' + new Date().toISOString().slice(0, 10));
  L.push('');
  L.push('> 依据（唯一冻结文本）：`PREREG-E2-路由分配-v1.md`（sha `5c354501…`）§1 池／§2 六臂／§4 判据／§6 泄漏防线；详卡 10§5＋11§8；蓝图 §2.2#2（R3h 规格）。');
  L.push('> 纪律：**零账本写／零 LLM／零网络**；库 readOnly；不碰生产路由；全臂披露；**shadow 无选择权**（M5⑤）。');
  L.push('> ★★ v2 修复旧件两处缺陷：①按 layer 门控引擎（「重叠 0 题」是构造产物）②`statement:\'\'` 使 180 道 L1 题静默消失 ⇒ 本件一律走 `buildEngineMatrix()` 全引擎矩阵（真题面）。');
  L.push('> ★ 符号口径：**非劣**＝「臂 − 基线」（上界 ≤ +' + C2_MARGIN + ' ⇒ 臂不更差）；**增益**＝「基线 − 臂」（下界 > 0 ⇒ 臂更好）。两式互为相反数，禁混用。');
  L.push('> ★ 开跑令：本件 `--arms` 已显式给出；R1 冻结件 sha **MATCH=' + rulesMatch + '**（`' + String(rulesSha).slice(0, 16) + '…`）⇒ M5①「冻结先于读数」满足。');
  L.push('');
  L.push('## 0. 池与人口（PREREG §1 口径）');
  L.push('');
  L.push('- 队列（`g2_regime=\'R4\'` ＋ 真值口径排除 ＋ 已解）＝ **' + items.length + '** 题。');
  L.push('- R1 落点：no-op ' + plan.counts['no-op'] + '／改层 ' + plan.counts.reassign + '／降档 ' + plan.counts.downgrade
    + ' ⇒ R1 **落点保留（姿态出数）' + c3.R1.published + '** 题（其余保留 R0 口径 shadow 评分，M5⑤）。');
  if (plan.counts.reassign === 0) {
    L.push('- ★ 结构性事实（**非读数**，由 R1-A 规则推出）：改层 0 ⇒ R1 臂与 R0 **逐题同值**（保留题同引擎、其余同用 R0 口径）');
    L.push('  ⇒ C2 的 Δ **构造性为 0** —— 这不是「非劣证据」，是**判定无信息量**（M4 情形），如实披露。');
  } else {
    L.push('- R1-A 改层 ' + plan.counts.reassign + ' 题 ⇒ R1 臂在改层题上与 R0 取值不同（Δ 的非零来源）；其余题按 M5⑤ 回退 R0 口径。');
  }
  L.push('');
  L.push('## 1. 各臂出概率人口与 Brier（C3 姿态指标）');
  L.push('');
  L.push('| 臂 | 姿态出数 | 占队列 | 与 R0 取值不同 | own_set Brier(出数集) | common_set(R0 人口) Brier | 配对集 n |');
  L.push('|---|---|---|---|---|---|---|');
  for (const k of ['R0', 'R1', 'R2', 'R3a', 'R3h', 'R4']) {
    const r = c3[k];
    L.push('| ' + k + ' | ' + r.published + ' | ' + (r.share_of_cohort === null ? 'n/a' : (r.share_of_cohort * 100).toFixed(1) + '%')
      + ' | ' + r.switched_vs_r0 + ' | ' + f6(r.brier_own_set) + ' | ' + f6(r.brier_common_set) + ' | ' + r.scored_common_set + ' |');
  }
  L.push('');
  L.push('- ★ 两口径并列（C3 防「拒掉难题抬 Brier」）：**姿态出数**＝该臂对外真正出数的题（R1＝落点保留题）；');
  L.push('  **配对集**＝计入 C2/C4 判据的题（R1 的降档题以 **R0 口径保留评分**，M5⑤ 零选择权）⇒ 二者不等是**设计**，不是缺口。');
  L.push('- own_set 用**姿态出数集**、common_set 用 **R0 人口**（' + commonR0.size + ' 题）——同一臂两列差距即「选择题」风险的可见刻度。');
  L.push('- R2 人口（有基率可算者）＝' + commonR2.size + ' 题；R2 **不回退 R0**（无基率即不出数）⇒ C4b 的配对集以其为准。');
  L.push('- ★ 降档人口：R1 相对 R0 少出 **' + (c3.R0.published - c3.R1.published) + '** 题（' + (items.length ? ((c3.R0.published - c3.R1.published) / items.length * 100).toFixed(1) : 'n/a')
    + '%）＝ R1-B 低信号格；其 Brier 贡献在 C2 配对中**保留**（回退 R0 口径）⇒ 降档**不能**被读成「甩掉难题」。');
  L.push('');
  L.push('## 2. C2 主判据（R1 vs R0 配对非劣；上界 ≤ +' + C2_MARGIN + '）');
  L.push('');
  L.push('- 配对人口 n＝**' + c2Strat.n + '**｜格数（layer×domain）＝' + c2Strat.cells + '｜切分单元＝题（配对块 bootstrap，B=' + NB + '，seed=' + SEED + '，LCG/百分位法照 stage4）。');
  L.push('- 朴素配对 CI：Δ=' + f6(c2Raw.mean) + ' CI[' + f6(c2Raw.lb) + ', ' + f6(c2Raw.ub) + ']');
  L.push('- **主口径（控制 layer×domain 的分层配对 CI）**：Δ=' + f6(c2Strat.delta) + ' CI[' + f6(c2Strat.lo) + ', ' + f6(c2Strat.hi) + ']');
  L.push('  · 恒等自检（点估计 ≡ 全样本均值）：残差 ' + (c2Strat.identity_residual === null ? 'n/a' : c2Strat.identity_residual.toExponential(1)) + '（≈0 ⇒ 分层只改区间，符合 §4「条件化」口径）');
  L.push('- **MDE（M4 义务）**：±' + f6(c2Mde) + '（＝2.802·SE_分层；α=.05 双侧、80% 功效）');
  L.push('- **判定**：' + c2Verdict);
  L.push('');
  L.push('## 3. C4a/C4b（R3 双臂 vs R0／vs R2；下界 > 0 ⇒ 有限开启）');
  L.push('');
  L.push('| 比较 | n | 格数 | Δ增益(基线−臂) | 增益 95% CI | 增益分层 CI | MDE | 判定 | 单侧 p(增益>0) | TOST p(ε=' + TOST_EPS + ') | 90% CI ⊂ ±ε |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const k of c4Keys) {
    const r = c4[k], gi = r.delta_gain_base_minus_arm, tg = r.tost;
    L.push('| ' + k.replace(/_/g, ' ') + ' | ' + r.n + ' | ' + r.cells + ' | ' + f6(gi.mean) + ' | [' + f6(gi.ci[0]) + ', ' + f6(gi.ci[1]) + '] | ['
      + f6(gi.strat_ci[0]) + ', ' + f6(gi.strat_ci[1]) + '] | ±' + f6(r.mde) + ' | ' + r.decision + ' | ' + f6(gi.p_gain_positive) + ' | ' + f6(tg.tost_p) + ' | ' + (tg.ci90_within_eps ? '**是**' : '否') + ' |');
  }
  L.push('');
  L.push('- ★ **ε 未在冻结文本命名**（§4 只说「用 TOST」）⇒ 默认取 ε＝**' + TOST_EPS + '＝C2 既有非劣边际（同一把尺，不新造）**；敏感性网格（只披露）：');
  for (const k of c4Keys) L.push('  · ' + k.replace(/_/g, ' ') + '：' + TOST_EPS_GRID.map((e) => 'ε=' + e + ' ⇒ TOST p=' + f6(c4[k].tost_sensitivity['eps_' + e].tost_p) + (c4[k].tost_sensitivity['eps_' + e].ci90_within_eps ? '（等效）' : '（不等效）')).join('｜'));
  L.push('  **正式判读须版本递进补记（须拍板）**；本件只披露，**不据此判路由线生死**。');
  L.push('- Holm（secondary 族，4 个比较）：调整后 p ＝ ' + c4Keys.map((k) => k + ':' + f6(holmByKey[k])).join('｜')
    + ' —— 并列「声明仅描述性」选项（§4 M2 两声明并列，本件不择一）。');
  L.push('- TOST 恒等自检：`TOST p < 0.05 ⇔ 90% CI ⊂ (−ε, +ε)`（同一件事的两种写法；测试锁定）。');
  L.push('');
  L.push('## 4. 泄漏防线自检（§6 M5 逐条）');
  L.push('');
  L.push('| 条 | 内容 | 本件落实 |');
  L.push('|---|---|---|');
  L.push('| ① | R1 规则版 sha 冻结先于任何读数 | 机器闸：`--arms` 路径内复核 sha **MATCH=' + rulesMatch + '**，不 MATCH ⇒ exit 3 |');
  L.push('| ② | R3 双臂 walk-forward | 逐题（resolved_at 升序）；**延迟结算队列**只并入 `resolved_at < t` 的结局，同刻批量零信息流 |');
  L.push('| ③ | 薄格 tie-break 预声明 | 格 n<' + MIN_CELL + ' 不参与 argmin、默认回 R0；并列取 design §1.2 序（★实现选择） |');
  L.push('| ④ | R4 单 seed | seed＝' + R4_SEED + '（禁多 seed 择优；敏感性只做 η，不做 seed） |');
  L.push('| ⑤ | shadow 无选择权 | 降档/拒出题**一律**保留 R0 口径评分并计入 C2 配对集（人口见 §0/§1） |');
  L.push('');
  L.push('## 5. R3h 权重轨迹与敏感性（只披露）');
  L.push('');
  L.push('- 主臂 η＝' + ETA + '（冻结）；预测题数 ' + R.hedge.counts.predicted + '／无 awake 引擎 ' + R.hedge.counts.no_awake + '。');
  L.push('- **权重轨迹逐题落盘**：`' + path.basename(weightsFile) + '`（每题一条：id／t／awake／权重快照／p̂）。');
  L.push('- ★ **权重塌缩自检**（显示用，非判据）：真混合题（awake ≥2）**' + mixN + '** 道中，与「当刻最大权重引擎单独值」不同者仅 **' + differsN + '** 道');
  L.push('  ⇒ ' + (collapse.display_flag ? '**塌缩提示：终局最大权重 ' + f6(collapse.top_weight) + '（' + topEngine + '）≥0.99 ⇒ 该臂在现行账本上实为「' + topEngine + '-always」单引擎对照**'
    : '未触发塌缩显示阈值（最大权重 ' + f6(collapse.top_weight) + '）'));
  L.push('  · 机制（如实）：w ∝ exp(−η·Σℓ) 在 η=1、ℓ∈[0,1] 下按**更新次数**指数拉开；sleeping 者不吃损失 ⇒ **出现越少、失误越少者越占优**。');
  L.push('  · ⇒ R3h 的「混合」是否在账本上真正生效，**看 `differs_from_top_engine`**；若要改 η／改结算形态，属**版本递进（须拍板，§2 冻结 η=1）**。');
  L.push('- 终局权重：' + ENGINE_KEYS.map((e) => e + '=' + f6(R.hedge.weights_final[e])).join('｜'));
  for (const e of ETA_SENS) {
    const s = sens['eta_' + e];
    L.push('- 敏感性 η=' + e + '：预测 ' + s.counts.predicted + ' 题｜终局权重 ' + ENGINE_KEYS.map((k) => k + '=' + f6(s.weights_final[k])).join('｜') + '（**只披露，不进门控**）');
  }
  L.push('');
  L.push('## 6. C1 与未做项（如实）');
  L.push('');
  L.push('- **C1（分层人工双编码 ≥85%，Wilson CI 下界判）＝ n/a**：属**人工门**，机器不代填判读。本件只置工具函数 `wilson`（复用 `src/engines/l2_baseline`）。');
  L.push('- §3.4「开关自身判据（一致率 ≥70%）」＝ 须实测增益域集合，随本件 §3 读数一并给出后**另行判定**（本件不裁决）。');
  L.push('- R3a 回退计数：' + JSON.stringify(R.r3a.counts) + '｜R4 取数计数：' + JSON.stringify(R.r4.counts));
  L.push('');
  L.push('（影子评分 v2 完 · 零账本写 · 零 LLM · 零网络 · 全臂披露）');

  fs.writeFileSync(base + '.json', JSON.stringify({
    script: 'p1b/scripts/e2-shadow-score.cjs', version: 'v2-20260917',
    basis: 'PREREG-E2-路由分配-v1.md（sha 5c354501…）§1/§2/§4/§6＋10§5＋11§8＋蓝图 §2.2#2',
    rules_file: RULES, rules_sha256: rulesSha, rules_match: rulesMatch,
    generated_at: new Date().toISOString(),
    discipline: { ledger_write: false, llm: false, network: false, arms_reading_run: true, arms_authorized_by: '--arms（显式开跑令）' },
    threshold_note: '未新造阈值：C2 边际 0.005／格 n<10／分层口径均取冻结文本；TOST ε 默认取 C2 同一把尺＝实现选择（须版本递进补记）',
    sign_convention: '非劣＝臂−基线（上界≤+0.005）；增益＝基线−臂（下界>0 ⇒ 有限开启）',
    cohort: items.length, engine_count_distribution: (() => { const p = {}; for (const it of items) p[it.keys.length] = (p[it.keys.length] || 0) + 1; return p; })(),
    r1_plan: { counts: plan.counts, scoreable_after: plan.scoreableAfter, cells: plan.cells.length,
      kept_cells: plan.cells.filter((c) => c.kept).map((c) => c.cell).sort() },
    c3_posture: c3,
    c2_primary: { n: c2Strat.n, cells: c2Strat.cells, raw: c2Raw, stratified: c2Strat, mde: c2Mde, margin: C2_MARGIN, verdict: c2Verdict },
    c4_secondary: { comparisons: c4, holm_adjusted_p: holmByKey, holm_note: '两声明并列（Holm／仅描述性），本件不择一' },
    r3h: { eta: ETA, counts: R.hedge.counts, weights_final: R.hedge.weights_final, weights_file: path.basename(weightsFile),
      weight_collapse: collapse,
      sensitivity: Object.keys(sens).reduce((a, k) => { a[k] = { counts: sens[k].counts, weights_final: sens[k].weights_final }; return a; }, {}) },
    r3a: { counts: R.r3a.counts }, r4: { seed: R4_SEED, counts: R.r4.counts },
    not_run: { c1_human_double_coding: 'n/a（人工门）', s34_switch_agreement: '随实测增益另行判定' },
    bootstrap: { B: NB, seed: SEED, method: '配对块 bootstrap（分层口径在 layer×domain 格内逐题重采样）·百分位法' },
  }, null, 1), 'utf8');
  fs.writeFileSync(base + '.md', L.join('\n') + '\n', 'utf8');

  console.log('=== E2 影子评分（六臂）＋判据机 v2 ===');
  console.log('  队列 ' + items.length + '｜R1 冻结 MATCH=' + rulesMatch + '（' + String(rulesSha).slice(0, 16) + '…）');
  console.log('  C2（R1 vs R0）：n=' + c2Strat.n + ' 分层 Δ=' + f6(c2Strat.delta) + ' CI[' + f6(c2Strat.lo) + ',' + f6(c2Strat.hi) + '] MDE=±' + f6(c2Mde) + ' ⇒ ' + c2Verdict);
  for (const k of c4Keys) {
    const r = c4[k], gi = r.delta_gain_base_minus_arm;
    console.log('  ' + k + '：n=' + r.n + ' 增益=' + f6(gi.mean) + ' CI[' + f6(gi.ci[0]) + ',' + f6(gi.ci[1]) + '] ⇒ ' + r.decision);
  }
  console.log('json/md -> ' + base + '.{json,md}｜权重轨迹 -> ' + weightsFile);
  console.log('  R3h 权重塌缩自检：真混合 ' + mixN + ' 道／与「当刻最大权重引擎单独值」不同 ' + differsN + ' 道' + (collapse.display_flag ? ' ⇒ ★塌缩（' + topEngine + '=' + f6(collapse.top_weight) + '）' : ''));
}

module.exports = { bootDeltaCI, bootPGreaterZero, stratDeltaCI, mdeFromSE, holm, tostFromDelta, hedgeRun, r3aRun, r4Run, runArms, pairedRows, brierMean, buildSeq, weightCollapse, ENGINE_KEYS, PRIORITY, MIN_CELL, C2_MARGIN, R4_SEED, ETA_SENS, TOST_EPS_GRID };
if (require.main === module) { main(); }
