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

// ── 四臂登记表（PREREG §4）：★尚未实现 ⇒ 给真臂名 exit 4（禁「静默当没这回事」）──
const DECLARED_ARMS = {
  mos: { impl: null, note: 'MOS 统计订正（PREREG §4；附加 4 城一致 ≥3/4＋城市×季度 16 格）' },
  nowcast: { impl: null, note: 'nowcast（PREREG §4；P1/P2/P3 三件套，⚠ P2 空窗层样本量未测）' },
  granger_lag: { impl: null, note: 'Granger 滞后（PREREG §4；滞后阶数与筛选规则须预注册）' },
  knn: { impl: null, note: 'kNN 基率（PREREG §4；k=30 冻结＋标准化欧氏＋格 n<30 不启用）' },
};
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

  // 真臂名 ⇒ 明确 exit 4（禁静默）
  const unknown = ARMS.filter((a) => !SELFTEST_ARMS[a] && !DECLARED_ARMS[a]);
  if (unknown.length) { console.error('★未知臂名：' + unknown.join(', ') + ' ⇒ exit 4'); process.exit(4); }
  const real = ARMS.filter((a) => DECLARED_ARMS[a]);
  if (real.length) {
    console.error('★以下臂**已在 PREREG §4 登记但尚未实现**：' + real.map((r) => r + '（' + DECLARED_ARMS[r].note + '）').join('；'));
    console.error('  ⇒ exit 4（禁把「未实现」静默成「跑了没差异」）');
    process.exit(4);
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
module.exports = { buildPool, cellsOf, replayCell, metricsOf, bootCI, SELFTEST_ARMS, DECLARED_ARMS, DOMAINS, LAYERS, MIN_N, NONINF_MARGIN };
