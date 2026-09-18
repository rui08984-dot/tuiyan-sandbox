'use strict';
/**
 * p1b/scripts/thickcell-replay.cjs —— **厚格基建总票·共享 walk-forward 重放骨架**（2026-09-18 · 第 3 期票 B 的实现件）
 *
 * 依据（唯一冻结文本）：`.scratch/forecast-debate/PREREG-厚格基建总票-v1.md`
 *   （sha256 `e12c9db67ab2f5dd5a94d0ecf712944eff682db8b06b4bf714b9a2bbd5752985`）
 *   §1 池与单元／§2 共享骨架／§3 共享判据 C1–C3／§5 撤票／§6 MDE 义务／§8 泄漏防线／§10 边界。
 *
 * 本件＝**四臂共享的那一份骨架**（19 号件「四张票并成一队，一次基建四次消费」里的「基建」）：
 *   · 池与单元：域 ∈ {openmeteo, dbnomics} ∧ 层 ∈ {L2,L3} ∧ 已解 ∧ 可计分；单元＝(layer×domain) 格；
 *     **按规则派生、不硬编码计数**；域口径复用 `p1b/src/evidence/domain.js`（单一真源）。
 *   · 重放：逐题按 `resolved_at` 升序；**题 t 的臂只看到 `resolved_at < t` 的结局**；
 *     **同刻批量零信息流**（同一 resolved_at 的题互不可见）。机器化在 `replayCell()` 里（逐题推进游标）。
 *   · 判据：C1 非劣（ΔBrier 配对 bootstrap CI 上界 ≤ +0.005，Δ 方向＝**臂 − 基线**）；
 *     C2 resolution 不降（Murphy RES 点估计，口径自报）；C3 ρ̂ 预检**不在本件**（属组合类臂，复用
 *     `e2-combo-precheck.cjs` §3.1 同一实现）。
 *   · 功效：报 **σ̂_d**（配对差标准差）与 **MDE ≈ 2.8·σ̂_d/√n**（PREREG §6 义务：二者必须同报）。
 *
 * ★★ 开跑令闸（机械执行「冻结的是判据，不是开跑令」——PREREG §3/§10，照 E2 先例）：
 *   **无 `--arms` ⇒ 打印开跑前提状态并 `exit 3`，不写任何读数件**。
 *
 * ★ 本棒实现边界（如实）：**四臂（MOS/nowcast/Granger/kNN）尚未实现** ⇒ `--arms` 里给真臂名会 `exit 4`。
 *   本件自带**两个自检臂**（不是能力读数、不入判读）：
 *     · `identity`（金样：臂≡基线 ⇒ ΔBrier 恒 0、σ̂_d=0、CI=[0,0] —— 证「无差异时不出假差异」）
 *     · `const_half`（对照组：臂≡0.5 ⇒ Δ 应显著且带符号 —— 证「有差异时机器看得见」，防金样恒真）
 *
 * 纪律：库 **readOnly**｜**零账本写／零 LLM／零网络**｜不改任何冻结件｜失败零迁移损伤。
 * 用法：
 *   node p1b/scripts/thickcell-replay.cjs                      # 无 --arms ⇒ 报前提状态、exit 3、零写盘
 *   node p1b/scripts/thickcell-replay.cjs --arms identity,const_half [--db <p>] [--out-dir <d>] [--boot 1000] [--seed 987654321]
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
const BOOT = Number(arg('boot', 1000));
const SEED = Number(arg('seed', 987654321));
const ARMS = (arg('arms', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

// PREREG §1（写死，改动＝版本递进）
const DOMAINS = ['openmeteo', 'dbnomics'];
const LAYERS = ['L2', 'L3'];
const MIN_N = 30;                 // 照 stage4-run 的 DOM_MIN_N（不新造阈值）
// PREREG §3（判据阈值，写死）
const NONINF_MARGIN = 0.005;      // C1：CI 上界 ≤ +0.005

// ── 四臂登记表（PREREG §4）：★实现状态如实反映（未实现者给名字 ⇒ exit 4，禁「静默当没这回事」）──
// kNN：参数**已预注册**于 `PREREG-厚格基建总票-v1.2-补充-kNN预注册-20260918.md`（sha `7d2015d2…`）
const KNN_K = 30;                 // v1 §4「k 冻结（建议 k=30）」
const KNN_KAPPA = 2.903;          // v1.2 §2 主口径（合并 37 格）；敏感性 {4.469, 1.687, 2.223, 4.038} 只披露
const KNN_SENS_KAPPA = [4.469, 1.687, 2.223, 4.038];
// v1.2 §1 冻结的「同变量异获取模式」对（**只有这四对**；其余 kind 禁入参照类）
const PAIR_KINDS = {
  OPEN_daily_max: ['openmeteo_daily_max', 'openmeteo_forecast_daily_max'],
  OPEN_daily_precipitation_sum: ['openmeteo_archive_daily_precipitation_sum', 'openmeteo_forecast_daily_precipitation_sum'],
  OPEN_daily_sunshine_duration: ['openmeteo_archive_daily_sunshine_duration', 'openmeteo_forecast_daily_sunshine_duration'],
  OPEN_daily_wind_speed_10m_max: ['openmeteo_archive_daily_wind_speed_10m_max', 'openmeteo_forecast_daily_wind_speed_10m_max'],
};
const KIND2PAIR = (() => { const m = {}; for (const f of Object.keys(PAIR_KINDS)) for (const k of PAIR_KINDS[f]) m[k] = f; return m; })();

const DECLARED_ARMS = {
  mos: { impl: null, note: 'MOS 统计订正（PREREG §4；附加 4 城一致 ≥3/4＋城市×季度 16 格）—★前置不足：已发布高频观测仅 2.8% 覆盖（特征审计 §2）' },
  nowcast: { impl: null, note: 'nowcast（PREREG §4；P1/P2/P3）—★开跑前须先测 P2 空窗层覆盖率（v1 §9④）' },
  granger_lag: { impl: null, note: 'Granger 滞后（PREREG §4）—★实现前提不成立：账本不存序列值（v1.1 §2；须先定「联网重取数／封存」路径）' },
  knn: { impl: null, note: 'kNN 基率（PREREG §4；k=30＋标准化欧氏＋格 n<30 不启用）—参数已预注册（v1.2）' },
};
// kNN 臂的实现（参数已预注册于 v1.2；臂签名与其它臂一致＝(ctx, q) → p）
// 做成**工厂**：κ 是唯一可换的参数（敏感性披露用），其余（k／距离／向量）一律冻结。
function makeKnnArm(kappa) {
  return function knnArm(ctx, q) {
    const fam = q.fam;
    const hist = ctx.history.filter((h) => h.fam === fam);
    if (!hist.length) return q.base;                       // 无历史 ⇒ 退静态格基率（不猜）
    const D = 4;
    const vec = (r) => [Math.sin(2 * Math.PI * r.month / 12), Math.cos(2 * Math.PI * r.month / 12), r.lat, r.lon];
    const qv = vec(q);
    const mat = hist.map(vec);
    // 标准化：均值/标准差**只用历史题**（同一条防泄漏线，照 PREREG §2）
    const mu = [], sd = [];
    for (let d = 0; d < D; d++) {
      const col = mat.map((v) => v[d]);
      const m = col.reduce((a, b) => a + b, 0) / col.length;
      const v = col.length > 1 ? col.reduce((s, x) => s + (x - m) * (x - m), 0) / (col.length - 1) : 0;
      mu.push(m); sd.push(Math.sqrt(v) || 1);
    }
    const z = (v) => v.map((x, d) => (x - mu[d]) / sd[d]);
    const qz = z(qv);
    const dists = hist.map((h, i) => ({ i: i, d2: z(mat[i]).reduce((s, x, d) => s + (x - qz[d]) * (x - qz[d]), 0) }))
      .sort((a, b) => (a.d2 === b.d2 ? a.i - b.i : a.d2 - b.d2));
    const k = Math.min(KNN_K, dists.length);                // ★近邻不足 k ⇒ 用可得全部
    const nb = dists.slice(0, k).map((x) => hist[x.i].y);
    const thetaKnn = nb.reduce((a, b) => a + b, 0) / nb.length;
    const w = k / (k + kappa);                              // v1.2 §2：w = n/(n+κ)，n＝近邻数
    return w * thetaKnn + (1 - w) * q.base;                 // θ̂ = w·θ̂_kNN + (1−w)·θ̂_格
  };
}
DECLARED_ARMS.knn.impl = makeKnnArm(KNN_KAPPA);
/** 敏感性用：同一条臂、只换 κ（**只披露，不据以判生死**——v1.2 §2）。 */
function replayCellWithKappa(rows, kappa) { return replayCell(rows, makeKnnArm(kappa)); }
// ── 自检臂（**非能力读数**；不入判读，只证机器）──
const SELFTEST_ARMS = {
  identity: { impl: (ctx, q) => q.base, note: '金样：臂≡基线 ⇒ Δ≡0、σ̂_d=0' },
  const_half: { impl: () => 0.5, note: '对照组：臂≡0.5 ⇒ Δ 应显著带符号' },
};

// ── 池与单元（PREREG §1：按规则派生）──
function buildPool(dbPath) {
  const M = require(path.join(ROOT, 'p1b', 'scripts', 'e2-combo-precheck.cjs'));
  const mat = M.buildEngineMatrix(dbPath);          // 复用同一实现：池/域/引擎读数一律取自此
  const rows = (mat.items || []).filter((r) =>
    LAYERS.indexOf(r.layer) !== -1 &&
    DOMAINS.indexOf(r.domain) !== -1 &&
    r.y !== null && r.y !== undefined &&
    r.eng && typeof r.eng[r.layer] === 'number' && isFinite(r.eng[r.layer]));
  const pool = rows.map((r) => ({
    id: r.id, layer: r.layer, domain: r.domain,
    y: Number(r.y), base: Number(r.eng[r.layer]),
    resolved_at: r.resolved_at || '', created_at: r.created_at || '',
  }));
  // 重放序：resolved_at 升序（同刻 → 按 id 稳定排序，保证确定性）
  pool.sort((a, b) => (a.resolved_at < b.resolved_at ? -1 : a.resolved_at > b.resolved_at ? 1 : (a.id - b.id)));
  return { pool, cells: cellsOf(pool) };
}

function cellsOf(pool) {
  const m = new Map();
  for (const q of pool) {
    const k = q.layer + '/' + q.domain;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(q);
  }
  return [...m.entries()].map(([k, rows]) => {
    const [layer, domain] = k.split('/');
    return { cell: k, layer, domain, rows, n: rows.length, eligible: rows.length >= MIN_N };
  }).sort((a, b) => (a.layer === b.layer ? a.n - b.n : (a.layer < b.layer ? -1 : 1)));
}

// ── kNN 臂所需特征的装配（PREREG v1.2 §3：实际向量＝[sin,cos,lat,lon]；滞后维**缺席**）──
// 特征来源：`resolve.lat/lon`（站点坐标）＋ `resolve.date`/`period`（→事件月）＋ `resolve.kind`（→族）。
function attachFeatures(pool, dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const ev = new Map();
  for (const r of db.prepare('SELECT id, evidence_json FROM predictions').all()) {
    let a = []; try { a = JSON.parse(r.evidence_json || '[]'); } catch (e) { a = []; }
    ev.set(r.id, a[0] || {});
  }
  db.close();
  return pool.map((q) => {
    const e0 = ev.get(q.id) || {};
    const rz = e0.resolve || {};
    const kind = rz.kind || null;
    const dstr = rz.date || rz.period || null;
    const month = dstr ? Number(String(dstr).slice(5, 7)) : null;
    return Object.assign({}, q, {
      kind: kind,
      fam: kind ? (KIND2PAIR[kind] || null) : null,            // 只认 v1.2 §1 的四对；其余 null（禁入参照类）
      lat: isFinite(rz.lat) ? Number(rz.lat) : null,
      lon: isFinite(rz.lon) ? Number(rz.lon) : null,
      month: (month >= 1 && month <= 12) ? month : null,
    });
  });
}
/** kNN 的可用池：**只含 v1.2 §1 的四对**，且四维特征齐备（否则该题不入臂——禁「缺维硬算」）。 */
function knnPool(featured) {
  const rows = featured.filter((q) => q.fam && q.lat !== null && q.lon !== null && q.month !== null);
  const byPair = {};
  for (const f of Object.keys(PAIR_KINDS)) byPair[f] = rows.filter((q) => q.fam === f);
  return { rows: rows, byPair: byPair };
}

// ── 重放（PREREG §2）：逐题推进游标；**题 t 只看 resolved_at < t**；同刻批量零信息流 ──
// 返回每题的 {id, y, base, p}（p＝臂读数）。臂拿到的 ctx.history 只含**已结算**的题（resolved_at < t）。
function replayCell(rows, armFn) {
  const out = [];
  let i = 0;                       // 游标：history = rows[0..i-1]（均满足 resolved_at < 当前题）
  for (let t = 0; t < rows.length; t++) {
    const q = rows[t];
    // 同刻批量零信息流：把 resolved_at < q.resolved_at 的题**全部**推入 history（同刻者不入）
    while (i < rows.length && rows[i].resolved_at < q.resolved_at) i++;
    const history = rows.slice(0, i);
    const p = armFn({ history: history, cell: { layer: q.layer, domain: q.domain } }, q);
    out.push({ id: q.id, y: q.y, base: q.base, p: clamp01(p), at: q.resolved_at, hist_n: history.length });
  }
  return out;
}
function clamp01(p) { const v = Number(p); if (!isFinite(v)) return null; return Math.min(1, Math.max(0, v)); }

// ── 判据机（PREREG §3＋§6）──
function brier(rows, key) {
  const ok = rows.filter((r) => r[key] !== null && r[key] !== undefined);
  if (!ok.length) return null;
  return ok.reduce((a, r) => a + Math.pow(r[key] - r.y, 2), 0) / ok.length;
}
function pairedDiff(rows) { return rows.filter((r) => r.p !== null).map((r) => r.p - r.base); }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
/** 配对 bootstrap：对**题**重采样（配对保留），返回均值的 CI。*/
function bootCI(diffs, B, seed) {
  if (!diffs.length) return null;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const means = [];
  for (let b = 0; b < B; b++) {
    let acc = 0;
    for (let i = 0; i < diffs.length; i++) acc += diffs[Math.floor(rnd() * diffs.length)];
    means.push(acc / diffs.length);
  }
  means.sort((a, b) => a - b);
  const q = (p) => means[Math.min(means.length - 1, Math.max(0, Math.floor(p * means.length)))];
  return { lb: q(0.025), ub: q(0.975), B: B, seed: seed, mean: mean(diffs) };
}
function metricsOf(rows, B, seed) {
  const d = pairedDiff(rows);
  const ci = bootCI(d, B, seed);
  const n = d.length;
  const sdD = sd(d);
  const M = require(path.join(ROOT, 'p1b', 'scripts', 'e2-combo-precheck.cjs'));
  const rowsOk = rows.filter((r) => r.p !== null);
  // murphyRes(ps, ys)：与 u8-columns 同口径的 10 桶离散版（复用同一实现，不另立）
  const resArm = M.murphyRes(rowsOk.map((r) => r.p), rowsOk.map((r) => r.y)).res;
  const resBase = M.murphyRes(rows.map((r) => r.base), rows.map((r) => r.y)).res;
  return {
    n: n,
    brier_arm: brier(rows, 'p'), brier_base: brier(rows, 'base'),
    delta: mean(d), ci95: ci,
    sd_d: sdD, mde: (sdD !== null && n) ? 2.8 * sdD / Math.sqrt(n) : null,
    resolution_arm: resArm, resolution_base: resBase,
    c1_pass: !!(ci && ci.ub <= NONINF_MARGIN),            // C1：非劣
    c2_pass: (resArm !== null && resBase !== null) ? (resArm >= resBase) : null,   // C2：resolution 不降
  };
}

function runSelftest(pool, cells) {
  const checks = [];
  // ① 金样：identity ⇒ Δ≡0、σ̂_d=0、CI=[0,0]
  for (const c of cells.filter((x) => x.eligible)) {
    const rows = replayCell(c.rows, SELFTEST_ARMS.identity.impl);
    const m = metricsOf(rows, BOOT, SEED);
    checks.push({
      name: 'identity@' + c.cell, pass: (Math.abs(m.delta) < 1e-12 && m.sd_d === 0 && m.ci95.lb === 0 && m.ci95.ub === 0),
      delta: m.delta, sd_d: m.sd_d, n: m.n,
    });
  }
  // ② 对照组（防金样恒真）：const_half ⇒ Δ 应带符号且 |Δ|>0（且有差异时 σ̂_d>0）
  for (const c of cells.filter((x) => x.eligible)) {
    const rows = replayCell(c.rows, SELFTEST_ARMS.const_half.impl);
    const m = metricsOf(rows, BOOT, SEED);
    checks.push({
      name: 'const_half@' + c.cell, pass: (m.delta !== null && Math.abs(m.delta) > 1e-9 && m.sd_d > 0),
      delta: m.delta, sd_d: m.sd_d, n: m.n,
    });
  }
  // ③ 泄漏防线自检：history 长度必须单调不减，且**严格小于**「resolved_at <= 当前题」的题数（同刻不入）
  const c0 = cells.filter((x) => x.eligible)[0];
  if (c0) {
    const rows = replayCell(c0.rows, SELFTEST_ARMS.identity.impl);
    let leak = 0, mono = true;
    for (let i = 1; i < rows.length; i++) if (rows[i].hist_n < rows[i - 1].hist_n) mono = false;
    for (const r of rows) {
      const q = c0.rows.find((x) => x.id === r.id);
      const eligibleHist = c0.rows.filter((x) => x.resolved_at < q.resolved_at).length;
      if (r.hist_n !== eligibleHist) leak++;
    }
    checks.push({ name: 'walkforward-leak@' + c0.cell, pass: (mono && leak === 0), hist_leak: leak, monotonic: mono });
  }
  return checks;
}

function main() {
  const frozen = path.join(ROOT, '.scratch', 'forecast-debate', 'PREREG-厚格基建总票-v1.md');
  const hasFrozen = fs.existsSync(frozen);
  const { pool, cells } = buildPool(DB_PATH);

  // ★★ 开跑令闸
  if (!ARMS.length) {
    console.log('=== 厚格基建总票 · 开跑前提状态（无 --arms ⇒ 拒跑，零写盘）===');
    console.log('  PREREG 冻结件：' + (hasFrozen ? '在盘（.scratch/forecast-debate/PREREG-厚格基建总票-v1.md）' : '★缺失'));
    console.log('  池（PREREG §1 规则派生）：域 ∈ {' + DOMAINS.join(', ') + '}｜层 ∈ {' + LAYERS.join(', ') + '}⇒ 得 ' + pool.length + ' 题');
    console.log('  单元（layer×domain 格；准入门 n≥' + MIN_N + '）：');
    for (const c of cells) console.log('    ' + c.cell.padEnd(20) + ' n=' + String(c.n).padStart(4) + '  ' + (c.eligible ? '✅ 可判读' : '⚠ n<' + MIN_N + ' 只探索'));
    console.log('  真臂实现状态（PREREG §4）：');
    for (const k of Object.keys(DECLARED_ARMS)) console.log('    ' + k.padEnd(12) + (DECLARED_ARMS[k].impl ? '已实现' : '★未实现'));
    console.log('  ⇒ 本件当前只能跑**自检臂**（' + Object.keys(SELFTEST_ARMS).join('／') + '）——它们**不是能力读数**，不入判读。');
    console.log('  ⇒ 开跑＝一次显式动作：加 --arms <名,名>。');
    process.exit(3);
  }

  // 未知臂 ⇒ 明确 exit 4（禁静默）
  const unknown = ARMS.filter((a) => !SELFTEST_ARMS[a] && !DECLARED_ARMS[a]);
  if (unknown.length) { console.error('★未知臂名：' + unknown.join(', ') + ' ⇒ exit 4'); process.exit(4); }
  // **已登记但实现为 null** 的真臂 ⇒ exit 4（禁把「未实现」静默成「跑了没差异」）
  const notImpl = ARMS.filter((a) => DECLARED_ARMS[a] && !DECLARED_ARMS[a].impl);
  if (notImpl.length) {
    console.error('★以下臂**已在 PREREG §4 登记但尚未实现**：');
    for (const r of notImpl) console.error('    ' + r + '：' + DECLARED_ARMS[r].note);
    console.error('  ⇒ exit 4（禁把「未实现」静默成「跑了没差异」）');
    process.exit(4);
  }
  const realArms = ARMS.filter((a) => DECLARED_ARMS[a]);

  // ★真臂跑批：库里**只在预注册的池与格上**跑；读数落盘（含 κ 敏感性并列披露）
  if (realArms.length) {
    const featured = attachFeatures(pool, DB_PATH);
    const out = {
      script: 'p1b/scripts/thickcell-replay.cjs',
      generated_at: new Date().toISOString(),
      zero_write_ledger: true, zero_llm: true, zero_network: true,
      arms: realArms, bootstrap: { B: BOOT, seed: SEED },
      prereg: {
        v1: 'PREREG-厚格基建总票-v1.md',
        v12: 'PREREG-厚格基建总票-v1.2-补充-kNN预注册-20260918.md（sha 7d2015d2…）',
        k: KNN_K, kappa_main: KNN_KAPPA, kappa_sensitivity: KNN_SENS_KAPPA,
        pairs: Object.keys(PAIR_KINDS),
        feature_vector: '[sin(2πm/12), cos(2πm/12), lat, lon]（滞后维缺席，v1.1 §2）',
      },
      cells: [], sensitivity: [],
    };
    for (const armName of realArms) {
      if (armName !== 'knn') continue;                    // 目前只有 kNN 实现
      const kp = knnPool(featured);
      console.log('=== kNN 臂（PREREG v1.2 预注册）===');
      console.log('  可用池：' + kp.rows.length + ' 题／' + Object.keys(PAIR_KINDS).length + ' 对');
      for (const f of Object.keys(PAIR_KINDS)) {
        const rows = kp.byPair[f];
        if (!rows.length) { console.log('    ' + f + '：0 题 ⇒ 跳过'); continue; }
        const played = replayCell(rows, DECLARED_ARMS.knn.impl);
        const m = metricsOf(played, BOOT, SEED);
        out.cells.push({ pair: f, n: m.n, delta: m.delta, ci95: m.ci95, sd_d: m.sd_d, mde: m.mde, brier_arm: m.brier_arm, brier_base: m.brier_base, resolution_arm: m.resolution_arm, resolution_base: m.resolution_base, c1_pass: m.c1_pass, c2_pass: m.c2_pass });
        console.log('    ' + f.padEnd(34) + ' n=' + String(m.n).padStart(4)
          + ' Δ=' + fmt(m.delta) + ' σ̂_d=' + fmt(m.sd_d) + ' MDE=' + fmt(m.mde)
          + ' CI=[' + fmt(m.ci95 && m.ci95.lb) + ',' + fmt(m.ci95 && m.ci95.ub) + ']'
          + ' C1=' + (m.c1_pass ? '过' : '未过') + ' C2=' + (m.c2_pass === null ? 'n/a' : (m.c2_pass ? '不降' : '降')));
        // κ 敏感性（v1.2 §2：**只披露，不据以判生死**）
        for (const kap of KNN_SENS_KAPPA) {
          const alt = metricsOf(replayCellWithKappa(rows, kap), BOOT, SEED);
          out.sensitivity.push({ pair: f, kappa: kap, delta: alt.delta, ci95: alt.ci95, c1_pass: alt.c1_pass });
        }
      }
      // 合并（四对并成一行，仅作**方向披露**——不是判读单元）
      if (kp.rows.length) {
        const all = replayCell(kp.rows, DECLARED_ARMS.knn.impl);
        const m = metricsOf(all, BOOT, SEED);
        out.pooled = { n: m.n, delta: m.delta, ci95: m.ci95, sd_d: m.sd_d, mde: m.mde, c1_pass: m.c1_pass, c2_pass: m.c2_pass };
        console.log('    ' + '【合并（仅方向披露，非判读单元）】'.padEnd(20) + ' n=' + String(m.n).padStart(4) + ' Δ=' + fmt(m.delta)
          + ' CI=[' + fmt(m.ci95 && m.ci95.lb) + ',' + fmt(m.ci95 && m.ci95.ub) + ']');
      }
    }
    console.log('  ★读法（PREREG §6）：Δ 与 CI **必须与 σ̂_d／MDE 同报**；κ 敏感性**只披露不判生死**（v1.2 §2）。');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const jp = path.join(OUT_DIR, 'thickcell-knn-20260918.json');
    fs.writeFileSync(jp, JSON.stringify(out, null, 2), 'utf8');
    console.log('  json -> ' + jp);
    return;
  }

  // 自检臂：只在**可判读格**上跑
  const eligible = cells.filter((c) => c.eligible);
  if (!eligible.length) { console.error('★无 n≥' + MIN_N + ' 的格 ⇒ exit 5'); process.exit(5); }
  const out = {
    script: 'p1b/scripts/thickcell-replay.cjs',
    basis: { prereg: 'PREREG-厚格基建总票-v1.md', sha_hint: 'e12c9db67ab2f5dd…（完整 sha 见冻结件）', sections: '§1 池/§2 骨架/§3 判据/§6 MDE' },
    generated_at: new Date().toISOString(),
    zero_write_ledger: true, zero_llm: true, zero_network: true,
    arms_requested: ARMS, selftest_only: true,
    pool: { domains: DOMAINS, layers: LAYERS, min_n: MIN_N, n: pool.length },
    cells: eligible.map((c) => ({ cell: c.cell, n: c.n })),
    metrics: {}, selftest: [],
  };
  for (const a of ARMS) {
    for (const c of eligible) {
      const rows = replayCell(c.rows, SELFTEST_ARMS[a].impl);
      out.metrics[a + '@' + c.cell] = metricsOf(rows, BOOT, SEED);
    }
  }
  out.selftest = runSelftest(pool, cells);
  out.selftest_pass = out.selftest.every((x) => x.pass);

  console.log('=== 厚格基建 · 自检（**非能力读数**）===');
  for (const k of Object.keys(out.metrics)) {
    const m = out.metrics[k];
    console.log('  ' + k.padEnd(24) + ' n=' + String(m.n).padStart(4) + ' Δ=' + fmt(m.delta) + ' σ̂_d=' + fmt(m.sd_d) + ' MDE=' + fmt(m.mde)
      + ' CI=[' + fmt(m.ci95 && m.ci95.lb) + ',' + fmt(m.ci95 && m.ci95.ub) + ']');
  }
  console.log('  自检（金样／对照组／泄漏）' + (out.selftest_pass ? '**全过**' : '**★有不过**') + '：');
  for (const c of out.selftest) console.log('    [' + (c.pass ? '✔' : '✗') + '] ' + c.name + ' ' + JSON.stringify(Object.assign({}, c, { name: undefined, pass: undefined })));
  console.log('  ★读法提醒（PREREG §6）：Δ 与 CI **必须与 σ̂_d／MDE 同报**，否则「CI 上界 > +0.005」会被误读成「臂更差」。');

  if (!out.selftest_pass) { console.error('★自检未过 ⇒ exit 6（不落盘）'); process.exit(6); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jp = path.join(OUT_DIR, 'thickcell-replay-selftest-20260918.json');
  fs.writeFileSync(jp, JSON.stringify(out, null, 2), 'utf8');
  console.log('  json -> ' + jp);
}
function fmt(v) { return (v === null || v === undefined) ? 'n/a' : Number(v).toFixed(6); }

if (require.main === module) main();
module.exports = { buildPool, cellsOf, replayCell, metricsOf, bootCI, SELFTEST_ARMS, DECLARED_ARMS, DOMAINS, LAYERS, MIN_N, NONINF_MARGIN, attachFeatures, knnPool, makeKnnArm, replayCellWithKappa, KNN_K, KNN_KAPPA, KNN_SENS_KAPPA, PAIR_KINDS, KIND2PAIR };
