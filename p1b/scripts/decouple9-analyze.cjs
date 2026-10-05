#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/decouple9-analyze.cjs —— 9 臂解耦实验 · 判据机（2026-09-17）
 *
 * 依据（唯一）：`docs/assets/forecast-debate/PREREG-9臂解耦-v1.md`（**冻结件**；正文 sha 不符 ⇒ exit 3）。
 * 输入：`p1b/sim/out/decouple9-verdicts-20260917.jsonl`（runner 产物）＋ 锚题工件 ＋ 账本（只读，用于**存量混淆基线**）。
 * 输出：`decouple9-analysis-20260917.{json,md}`（读数件）。
 *
 * 估计量**单一实现**：λ̂ 双口径与附录 B 的 MLE 一律 require `p1b/scripts/lambda-overlap.cjs`
 *   （`probit`/`clamp`/`lambdaCorr`/`lambdaAgree`/`fitSymmetricMLE`），本件不另写一套。
 * 口径（逐条＝PREREG §4）：配对差按题；CI＝按题重采样 B=1000／seed=987654321／百分位法；
 *   bootstrap 双侧 p＝2·min(P(d*≤0),P(d*≥0))（截断 ≤1）；族内 Holm（α=0.05）；缺测剔除并报 n。
 * 纪律：零 LLM／零网络／零写库（库 readOnly）；不动任何既有 PREREG；只落读数件。
 * 用法：node p1b/scripts/decouple9-analyze.cjs [--jsonl <f>] [--out-dir <d>] [--boot 1000] [--seed 987654321]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const STRICT = process.argv.indexOf('--allow-partial') === -1;   // 默认：工件不全 ⇒ 硬失败（防拿半批出读数）
const JSONL = path.resolve(arg('jsonl', path.join(ROOT, 'p1b', 'sim', 'out', 'decouple9-verdicts-20260917.jsonl')));
const ANCHOR = path.resolve(arg('anchor', path.join(ROOT, 'p1b', 'sim', 'out', 'decouple9-anchor-20260917.json')));
const PREREG_PATH = path.resolve(arg('prereg', path.join(ROOT, 'docs', 'assets', 'forecast-debate', 'PREREG-9臂解耦-v1.md')));
const OUT_DIR = path.resolve(arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out')));
const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const NB = Number(arg('boot', '1000'));
const SEED = Number(arg('seed', '987654321'));
const LAMBDA_THRESHOLD = 0.8;      // 蓝图 §2.2 #4 写死
const CLIP = 0.001;                // 照论文 GJP 做法（代理口径 B 用）

const M = require(path.join(__dirname, 'lambda-overlap.cjs'));   // 估计量单一实现
const { probit, clamp, lambdaCorr, lambdaAgree, fitSymmetricMLE, bootCI } = M;

const VARIANTS = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
const TEMPERATURES = [0.2, 0.7, 1.0];
const VAR_SHORT = { v1_evidence: 'v1', v2_skeptical: 'v2', v3_baserate: 'v3' };

// ── 纯函数区（可 require；零 IO） ───────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
/** 配对差读数：rows=[{pa,pb}]（两侧非空 ⇒ 由调用方过滤）⇒ 均值/CI/p/σ。 */
function pairedStat(rows, boot, seed) {
  const d = rows.map((r) => r.pa - r.pb);
  const n = d.length;
  if (!n) return { n: 0, mean: null, ci: { lo: null, hi: null }, p: null, sd: null, se: null };
  const ci = bootCI(d.map((x) => ({ d: x })), (sub) => mean(sub.map((x) => x.d)), boot, seed);
  // bootstrap 双侧 p（同源同数据）：2·min(P(d*≤0), P(d*≥0))，截断 ≤1
  let s = seed >>> 0;
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const m = mean(d);
  let le = 0, ge = 0;
  for (let b = 0; b < boot; b++) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += d[Math.floor(rnd() * n)];
    const dm = acc / n;
    if (dm <= 0) le++;
    if (dm >= 0) ge++;
  }
  const p = Math.min(1, 2 * Math.min(le / boot, ge / boot));
  return { n: n, mean: m, ci: { lo: ci.lo, hi: ci.hi }, p: p, sd: sd(d), se: sd(d) / Math.sqrt(n),
    ci_excludes_0: (ci.lo > 0) || (ci.hi < 0) };
}
/** Holm 步降（同族内；返回校正后 p，保序）。 */
function holm(ps) {
  const m = ps.length;
  if (!m) return [];
  const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const adj = new Array(m);
  let prev = 0;
  idx.forEach(([p, i], k) => { const v = Math.min(1, Math.max(prev, (m - k) * p)); adj[i] = v; prev = v; });
  return adj;
}
const fmt = (x, k) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(k === undefined ? 4 : k);

/** 载入 JSONL 工件 ⇒ {rows, byArm, cube, badLines}（容错：坏行跳过并计数——并发 append 的防御） */
function loadArtifact() {
  let badLines = 0;
  const items = [];
  for (const l of fs.readFileSync(JSONL, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { items.push(JSON.parse(l)); } catch (e) { badLines++; }   // 半行/损坏行不计入（收据须报）
  }
  const byArm = {}; const cube = {}; let dupRows = 0; let retryRows = 0;
  for (const r of items) {
    byArm[r.arm] = byArm[r.arm] || { n: 0, extracted: 0, errors: 0 };
    byArm[r.arm].n++; if (r.extracted) byArm[r.arm].extracted++; if (r.error) byArm[r.arm].errors++;
    const k = r.pid + '|' + r.variant + '|' + r.temperature + '|' + r.copy;
    // ★去重口径（写死）：**首行优先**（＝原始批读数为准）；仅当首行失败/未抽取时，才用后续（重试）行替换。
    //   理由：本批重试通道曾误带全集条件（未带 --qshard）造成重复执行 ⇒ 若「后写覆盖」会把部分格换成重试期的
    //   采样（跨时段混批）；改为「首个成功行胜出」后，重复执行只作浪费登记，不进读数。
    if (!cube[k]) { cube[k] = r; continue; }
    dupRows++;
    if (!cube[k].extracted && r.extracted) { cube[k] = r; retryRows++; }
  }
  return { items: items, byArm: byArm, cube: cube, badLines: badLines, dupRows: dupRows, retryRows: retryRows };
}
const getP = (cube, pid, v, T, copy) => {
  const r = cube[pid + '|' + v + '|' + T + '|' + (copy || 1)];
  return (r && r.extracted && r.implied_prob !== null) ? Number(r.implied_prob) : null;
};
/** [{pa,pb}]（双侧非空） */
function pairs(cube, pids, getA, getB) {
  const rows = [];
  for (const pid of pids) { const a = getA(pid), b = getB(pid); if (a !== null && b !== null) rows.push({ pid: pid, pa: a, pb: b }); }
  return rows;
}

/** 存量混淆基线（同 40 题；口径＝L6 现役：每变体取 id 最大的一行）。 */
function ledgerBaseline(pids) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const sel = db.prepare('SELECT v.prediction_id AS pid, v.prompt_variant AS variant, v.implied_prob AS p, v.created_at AS at, v.run_id AS run'
      + " FROM verdicts v WHERE v.prediction_id = ? AND v.implied_prob IS NOT NULL AND v.prompt_variant = ? ORDER BY v.id DESC LIMIT 1");
    const by = {};
    for (const pid of pids) {
      by[pid] = {};
      for (const v of VARIANTS) { const r = sel.get(pid, v); if (r) by[pid][v] = { p: Number(r.p), run: r.run, at: r.at }; }
    }
    return by;
  } finally { db.close(); }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
function main() {
  const fr = require(path.join(__dirname, 'prereg-freeze.cjs')).freezeSha(PREREG_PATH);
  console.log('[analyze] PREREG sha=' + fr.sha256.slice(0, 12) + '… MATCH=' + fr.match);
  if (!fr.match) { console.error('[analyze] PREREG 冻结校验失败 ⇒ exit 3'); process.exit(3); }

  const anchorArt = JSON.parse(fs.readFileSync(ANCHOR, 'utf8'));
  const pids = anchorArt.questions.map((q) => q.id);
  const stmtSha = {}; for (const q of anchorArt.questions) stmtSha[q.id] = q.statement_sha16;

  const A = loadArtifact();
  const EXPECT = pids.length * 10;
  const uniqKeys = Object.keys(A.cube).length;
  console.log('[analyze] 工件行=' + A.items.length + ' 唯一条件=' + uniqKeys + '（期望 ' + EXPECT + '）');

  // 完整性（防拿半批出读数）
  const missing = [];
  for (const pid of pids) for (const v of VARIANTS) for (const T of TEMPERATURES) {
    const need = (v === 'v1_evidence' && T === 0.2) ? [1, 2] : [1];
    for (const c of need) if (!A.cube[pid + '|' + v + '|' + T + '|' + c]) missing.push(pid + '|' + v + '|T' + T + '#' + c);
  }
  if (missing.length && STRICT) {
    console.error('[analyze] 工件不全：缺 ' + missing.length + ' 个条件（示例 ' + missing.slice(0, 3).join('、') + '）⇒ exit 3（--allow-partial 可强出，届时如实标）');
    process.exit(3);
  }
  // 行级完整性：题面指纹须与冻结锚题一致（题面变过 ⇒ 该行作废）
  const stmtMismatch = A.items.filter((r) => stmtSha[r.pid] && r.statement_sha16 !== stmtSha[r.pid]).map((r) => r.pid + '|' + r.arm);
  // 重复臂提示词一致性（C0 成立前提）
  const repPrompt = pids.map((pid) => {
    const a = A.cube[pid + '|v1_evidence|0.2|1'], b = A.cube[pid + '|v1_evidence|0.2|2'];
    return (a && b) ? (a.prompt_sha16 === b.prompt_sha16) : null;
  });
  const repPromptSame = repPrompt.filter((x) => x === true).length;
  const repPromptDiff = pids.filter((pid, i) => repPrompt[i] === false);

  // ── C0 阴性对照（重复臂 vs 对角臂）──
  const c0rows = pairs(A.cube, pids, (pid) => getP(A.cube, pid, 'v1_evidence', 0.2, 2), (pid) => getP(A.cube, pid, 'v1_evidence', 0.2, 1));
  const C0 = pairedStat(c0rows, NB, SEED);
  const sigmaR = C0.sd;   // 噪声底
  const C0_pass = C0.n > 0 && C0.ci.lo !== null && (C0.ci.lo <= 0 && C0.ci.hi >= 0);

  // ── C1 角色效应（3 对 × 3 温度）──
  const pairsList = [['v1_evidence', 'v2_skeptical'], ['v1_evidence', 'v3_baserate'], ['v2_skeptical', 'v3_baserate']];
  const C1 = [];
  for (const T of TEMPERATURES) for (const [a, b] of pairsList) {
    const rows = pairs(A.cube, pids, (pid) => getP(A.cube, pid, a, T), (pid) => getP(A.cube, pid, b, T));
    const s = pairedStat(rows, NB, SEED);
    C1.push({ family: 'C1', temperature: T, pair: VAR_SHORT[a] + '-' + VAR_SHORT[b], a: a, b: b, n: s.n, mean: s.mean,
      ci: s.ci, p: s.p, ci_excludes_0: s.ci_excludes_0, sd: s.sd, snr: (sigmaR && s.mean !== null) ? Math.abs(s.mean) / sigmaR : null });
  }
  const C1_holm = holm(C1.map((x) => x.p));
  C1.forEach((x, i) => { x.p_holm = C1_holm[i]; x.significant_holm = C1_holm[i] < 0.05; });
  const roleDetected = C1.some((x) => x.significant_holm);

  // ── 披露块（**非判据**）：逐臂离散度 ＋ 逐对「带符号差 vs 绝对差」（判据只测位置；离散度差异须并列披露）──
  //   触发理由（本批实测）：v3 臂读数近似常数（SD≈0.00–0.02）⇒ 位置差（判据量）小、离散度差（未判据化）大。
  const armStats = {};
  for (const v of VARIANTS) for (const T of TEMPERATURES) {
    const a = pids.map((pid) => getP(A.cube, pid, v, T)).filter((x) => x !== null);
    armStats[VAR_SHORT[v] + '@' + T] = { n: a.length, mean: mean(a), sd: sd(a), distinct: new Set(a.map((x) => Number(x).toFixed(4))).size,
      min: a.length ? Math.min.apply(null, a) : null, max: a.length ? Math.max.apply(null, a) : null };
  }
  const dispersion = [];
  for (const T of TEMPERATURES) for (const [a, b] of pairsList) {
    const rows = pairs(A.cube, pids, (pid) => getP(A.cube, pid, a, T), (pid) => getP(A.cube, pid, b, T));
    if (!rows.length) continue;
    const d = rows.map((r) => r.pa - r.pb);
    // ★去噪分解（披露）：一次调用噪声方差 = σ̂_R²/2（σ̂_R＝同配置重跑差的标准差 ⇒ 差含两次独立噪声）
    //   ⇒ 变体「真差异」方差 = Var(d) − σ̂_R²（可为负 ⇒ 截 0，表示差异被采样抖动完全解释）
    const varD = sd(d) !== null ? sd(d) * sd(d) : null;
    const varSignal = (varD !== null && sigmaR) ? Math.max(0, varD - sigmaR * sigmaR) : null;
    dispersion.push({ temperature: T, pair: VAR_SHORT[a] + '-' + VAR_SHORT[b], n: rows.length, sd_d: sd(d),
      mean_signed: mean(d), mean_abs: mean(d.map(Math.abs)), max_abs: Math.max.apply(null, d.map(Math.abs)),
      sd_signal_after_noise: varSignal !== null ? Math.sqrt(varSignal) : null,
      noise_explained_share: (varD && sigmaR) ? Number(Math.min(1, (sigmaR * sigmaR) / varD).toFixed(4)) : null });
  }
  // 干净对（**排除退化臂 v3**）：N=2 的 MLE ＋ 代理双口径（只作披露，不替代 §4.4 的判定量）
  const cleanPair = { pair: 'v1-v2', by_temperature: [] };
  for (const T of TEMPERATURES) {
    const rows = pairs(A.cube, pids, (pid) => getP(A.cube, pid, 'v1_evidence', T), (pid) => getP(A.cube, pid, 'v2_skeptical', T));
    if (!rows.length) continue;
    const fit2 = fitSymmetricMLE(rows.map((r) => [probit(clamp(r.pa)), probit(clamp(r.pb))]));
    cleanPair.by_temperature.push({ temperature: T, n: rows.length, lambda_A: lambdaCorr(rows),
      lambda_B: lambdaAgree(rows.map((r) => ({ pa: clamp(r.pa), pb: clamp(r.pb) }))),
      lambda_MLE_N2: fit2 ? fit2.lambda : null, delta_MLE_N2: fit2 ? fit2.delta : null, feasible: fit2 ? fit2.feasible : null });
  }

  // ── C2 温度效应（3 变体 × 3 温度对）──
  const tempsPairs = [[0.2, 0.7], [0.2, 1.0], [0.7, 1.0]];
  const C2 = [];
  for (const v of VARIANTS) for (const [t1, t2] of tempsPairs) {
    const rows = pairs(A.cube, pids, (pid) => getP(A.cube, pid, v, t1), (pid) => getP(A.cube, pid, v, t2));
    const s = pairedStat(rows, NB, SEED);
    C2.push({ family: 'C2', variant: VAR_SHORT[v], variant_full: v, t_a: t1, t_b: t2, n: s.n, mean: s.mean, ci: s.ci,
      p: s.p, ci_excludes_0: s.ci_excludes_0, sd: s.sd, snr: (sigmaR && s.mean !== null) ? Math.abs(s.mean) / sigmaR : null });
  }
  const C2_holm = holm(C2.map((x) => x.p));
  C2.forEach((x, i) => { x.p_holm = C2_holm[i]; x.significant_holm = C2_holm[i] < 0.05; });
  const tempDetected = C2.some((x) => x.significant_holm);

  // ── C3 λ̂（双口径 ＋ 附录 B MLE N=3）──
  const C3 = { by_temperature: [], proxies: [], mle: [] };
  for (const T of TEMPERATURES) {
    for (const [a, b] of pairsList) {
      const rows = pairs(A.cube, pids, (pid) => getP(A.cube, pid, a, T), (pid) => getP(A.cube, pid, b, T));
      if (!rows.length) continue;
      C3.proxies.push({ temperature: T, pair: VAR_SHORT[a] + '-' + VAR_SHORT[b], n: rows.length,
        lambda_A: lambdaCorr(rows), lambda_B: lambdaAgree(rows.map((r) => ({ pa: clamp(r.pa), pb: clamp(r.pb) }))) });
    }
    const P = [];
    for (const pid of pids) {
      const v1 = getP(A.cube, pid, 'v1_evidence', T), v2 = getP(A.cube, pid, 'v2_skeptical', T), v3 = getP(A.cube, pid, 'v3_baserate', T);
      if (v1 === null || v2 === null || v3 === null) continue;
      P.push([probit(clamp(v1)), probit(clamp(v2)), probit(clamp(v3))]);
    }
    const fit = fitSymmetricMLE(P);
    // ★可行域指标（N=3）：δ(N−(N−1)λ) ≤ 1 —— 该量 ≈1 表示解落在**约束边界**（此时点估计有偏、须披露，不当作真值）
    const feasIdx = fit ? fit.delta * (3 - 2 * fit.lambda) : null;
    C3.mle.push({ temperature: T, n_questions: P.length, lambda: fit ? fit.lambda : null, delta: fit ? fit.delta : null,
      feasible: fit ? fit.feasible : null, rho: fit ? fit.rho : null, A_Omega: fit ? fit.A_Omega : null, B_Omega: fit ? fit.B_Omega : null,
      feasibility_index: feasIdx, at_boundary: feasIdx !== null && Math.abs(feasIdx - 1) < 1e-3 });
  }
  const proxyVals = C3.proxies.flatMap((x) => [x.lambda_A, x.lambda_B]).filter((x) => x !== null && isFinite(x));
  const mleVals = C3.mle.map((x) => x.lambda).filter((x) => x !== null && isFinite(x));
  const lambdaLo = Math.min.apply(null, proxyVals.concat(mleVals));
  const lambdaLoProxy = proxyVals.length ? Math.min.apply(null, proxyVals) : null;
  const lambdaLoMLE = mleVals.length ? Math.min.apply(null, mleVals) : null;

  // ── 存量混淆基线（同 40 题；L6 现役口径＝每变体取 id 最大行）──
  const baseLedger = ledgerBaseline(pids);
  const baseProxy = []; const baseMleP = [];
  for (const [a, b] of pairsList) {
    const rows = [];
    for (const pid of pids) { const x = baseLedger[pid] && baseLedger[pid][a], y = baseLedger[pid] && baseLedger[pid][b]; if (x && y) rows.push({ pa: x.p, pb: y.p }); }
    if (rows.length) baseProxy.push({ pair: VAR_SHORT[a] + '-' + VAR_SHORT[b], n: rows.length, lambda_A: lambdaCorr(rows),
      lambda_B: lambdaAgree(rows.map((r) => ({ pa: clamp(r.pa), pb: clamp(r.pb) }))) });
  }
  for (const pid of pids) {
    const g = baseLedger[pid]; if (!g || !g.v1_evidence || !g.v2_skeptical || !g.v3_baserate) continue;
    baseMleP.push([probit(clamp(g.v1_evidence.p)), probit(clamp(g.v2_skeptical.p)), probit(clamp(g.v3_baserate.p))]);
  }
  const baseMleFit = fitSymmetricMLE(baseMleP);
  const baseProxVals = baseProxy.flatMap((x) => [x.lambda_A, x.lambda_B]).filter((x) => x !== null && isFinite(x));
  const baseVals = baseProxVals.concat(baseMleFit && baseMleFit.lambda !== null ? [baseMleFit.lambda] : []);
  const base = { proxies: baseProxy, mle: baseMleFit ? { n_questions: baseMleP.length, lambda: baseMleFit.lambda, delta: baseMleFit.delta,
    feasible: baseMleFit.feasible } : null, lambda_lo: (baseVals.length ? Math.min.apply(null, baseVals) : null) };

  // ── L6 口径污染 what-if（零写库的量化证据；支撑「本批不写 verdicts 表」的决定）──
  // 机制：`l6Structural`（L6 生产引擎）每变体取 **id 最大** 的一行、**不按 run_id 过滤** ⇒ 若把本批 10 臂写进
  //   verdicts 表，新行（id 更大）会立刻成为 L6 的生产输入，且**非对角臂**（如 v1@1.0）会被当作该变体的读数。
  //   本件只读地算「现状 p」与「假想写入后 p」的逐题差 ⇒ 量化该风险（不写任何行）。
  const whatif = { n: 0, changed: 0, mean_abs_delta: null, max_abs_delta: null, per_question: [] };
  {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const sel = db.prepare('SELECT v.prompt_variant AS variant, v.implied_prob AS p FROM verdicts v'
      + ' WHERE v.prediction_id = ? AND v.implied_prob IS NOT NULL ORDER BY v.id DESC');
    try {
      const deltas = [];
      for (const pid of pids) {
        const rows = sel.all(pid); const cur = {};
        for (const r of rows) if (cur[r.variant] === undefined) cur[r.variant] = Number(r.p);   // id 降序 ⇒ 首见即最大 id
        const curVals = VARIANTS.map((v) => cur[v]).filter((x) => x !== undefined);
        // 假想：生产路由配置（v1@0.2 / v2@0.7 / v3@1.0）改读**本批**的行
        const newVals = [getP(A.cube, pid, 'v1_evidence', 0.2), getP(A.cube, pid, 'v2_skeptical', 0.7), getP(A.cube, pid, 'v3_baserate', 1.0)].filter((x) => x !== null);
        if (curVals.length !== 3 || newVals.length !== 3) continue;
        const pCur = curVals.reduce((s, x) => s + x, 0) / 3, pNew = newVals.reduce((s, x) => s + x, 0) / 3;
        whatif.n++; if (Math.abs(pCur - pNew) > 1e-9) whatif.changed++;
        deltas.push(Math.abs(pCur - pNew));
        whatif.per_question.push({ pid: pid, p_ledger: Number(pCur.toFixed(6)), p_if_written: Number(pNew.toFixed(6)), delta: Number((pNew - pCur).toFixed(6)) });
      }
      if (deltas.length) {
        whatif.mean_abs_delta = deltas.reduce((s, x) => s + x, 0) / deltas.length;
        whatif.max_abs_delta = Math.max.apply(null, deltas);
      }
    } finally { db.close(); }
  }

  // ── 出口判定（机械映射，PREREG §5）──
  const lambdaHigh = lambdaLo >= LAMBDA_THRESHOLD;
  let exit, exitText;
  if (!C0_pass) { exit = 'C0_FAIL'; exitText = 'C0 阴性对照未通过 ⇒ C1/C2 作废（只报 λ̂ 与执行缺陷）'; }
  else if (!roleDetected && lambdaHigh) { exit = '①'; exitText = '变体池≈单信号：正式归档（负结果）＋聚合层维持机械平均＋变体池叙事永久关闭'; }
  else if (roleDetected && !lambdaHigh) { exit = '②'; exitText = '变体多样性有真实信息量 ⇒ 第二把 key 立项（4A）＋λ̂ 喂极端化决策'; }
  else if (roleDetected && lambdaHigh) { exit = '③-a'; exitText = '可辨 ∧ 高重叠：如实登记、不立项不关闭（交用户裁决）'; }
  else { exit = '③-b'; exitText = '不可辨 ∧ 低重叠：如实登记、不立项不关闭（交用户裁决）'; }

  const out = {
    script: 'p1b/scripts/decouple9-analyze.cjs', generated_at: new Date().toISOString(),
    prereg_sha256: fr.sha256, jsonl: JSONL, anchor: ANCHOR, boot: NB, seed: SEED,
    integrity: {
      rows: A.items.length, bad_lines: A.badLines, duplicate_rows: A.dupRows, unique_conditions: uniqKeys,
      expected_conditions: EXPECT, missing: missing.length,
      missing_sample: missing.slice(0, 5), strict: STRICT,
      statement_mismatch: stmtMismatch.length, statement_mismatch_sample: stmtMismatch.slice(0, 5),
      repeat_prompt_same: repPromptSame, repeat_prompt_diff_pids: repPromptDiff,
      extraction_fail_by_arm: Object.keys(A.byArm).sort().map((k) => ({ arm: k, n: A.byArm[k].n, extracted: A.byArm[k].extracted, errors: A.byArm[k].errors })),
      resolved_models: Array.from(new Set(A.items.map((r) => r.resolved_model))),
      effort: Array.from(new Set(A.items.map((r) => r.reasoning_effort))),
      latency_ms: { min: Math.min.apply(null, A.items.map((r) => r.latency_ms || 0)), max: Math.max.apply(null, A.items.map((r) => r.latency_ms || 0)) },
    },
    C0: Object.assign({}, C0, { pass: C0_pass, sigma_R: sigmaR }),
    C1: { readings: C1, detected: roleDetected, holm_alpha: 0.05 },
    disclosure: { arm_stats: armStats, paired_dispersion: dispersion, clean_pair_v1v2: cleanPair },
    C2: { readings: C2, detected: tempDetected, holm_alpha: 0.05 },
    C3: { by_temperature: null, proxies: C3.proxies, mle: C3.mle, lambda_lo: lambdaLo, lambda_lo_proxy: lambdaLoProxy,
      lambda_lo_mle: lambdaLoMLE, threshold: LAMBDA_THRESHOLD, high: lambdaHigh },
    baseline_confounded: base,
    l6_whatif: whatif,
    exit: { code: exit, text: exitText },
    per_question: pids.map((pid) => {
      const o = { pid: pid };
      for (const v of VARIANTS) for (const T of TEMPERATURES) o[VAR_SHORT[v] + '@' + T] = getP(A.cube, pid, v, T);
      o['v1@0.2#rep'] = getP(A.cube, pid, 'v1_evidence', 0.2, 2);
      return o;
    }),
  };
  delete out.C3.by_temperature;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const JP = path.join(OUT_DIR, 'decouple9-analysis-20260917.json');
  fs.writeFileSync(JP, JSON.stringify(out, null, 1), 'utf8');
  const MD = mdReport(out);
  const MP = path.join(OUT_DIR, 'decouple9-analysis-20260917.md');
  fs.writeFileSync(MP, MD, 'utf8');
  console.log('[analyze] json -> ' + JP + '\n[analyze] md   -> ' + MP);
  console.log(MD.split('\n').slice(0, 40).join('\n'));
  return out;
}

function mdReport(o) {
  const L = [];
  L.push('# 9 臂解耦实验 · 读数（' + o.generated_at + '）');
  L.push('');
  L.push('> 判据来源：`PREREG-9臂解耦-v1.md`（冻结 sha `' + o.prereg_sha256.slice(0, 12) + '…`）｜锚题 40（L6 / 30 局）｜条件 10/题｜'
    + 'CI＝按题重采样 B=' + o.boot + '／seed=' + o.seed + '／百分位法｜族内 Holm（α=0.05）');
  L.push('');
  L.push('## 0 完整性');
  L.push('- 工件行 ' + o.integrity.rows + '（坏行 ' + (o.integrity.bad_lines||0) + '／重复行 ' + (o.integrity.duplicate_rows||0) + '）／唯一条件 ' + o.integrity.unique_conditions + '（期望 ' + o.integrity.expected_conditions + '，缺 ' + o.integrity.missing + '）'
    + '｜题面指纹不符 ' + o.integrity.statement_mismatch + '｜重复臂同提示词 ' + o.integrity.repeat_prompt_same + '/40');
  L.push('- 上游：resolved_model=' + JSON.stringify(o.integrity.resolved_models) + '｜reasoning_effort=' + JSON.stringify(o.integrity.effort)
    + '｜单次延迟 ' + o.integrity.latency_ms.min + '–' + o.integrity.latency_ms.max + ' ms');
  const exf = o.integrity.extraction_fail_by_arm.filter((x) => x.extracted < x.n);
  L.push('- 抽取失败：' + (exf.length ? exf.map((x) => x.arm + ' ' + (x.n - x.extracted) + '/' + x.n).join('、') : '无（10/10 全量抽取成功）')
    + '｜错误行：' + o.integrity.extraction_fail_by_arm.reduce((s, x) => s + x.errors, 0));
  L.push('');
  L.push('## 1 C0 阴性对照（仪器校准门）');
  L.push('- 重复臂 vs 对角臂（同题同提示词重采样）：n=' + o.C0.n + '｜d̄=' + fmt(o.C0.mean) + '｜95% CI [' + fmt(o.C0.ci.lo) + ', ' + fmt(o.C0.ci.hi) + ']'
    + '｜p=' + fmt(o.C0.p) + '｜**噪声底 σ̂_R=' + fmt(o.C0.sigma_R) + '**（单次调用重跑差的标准差）');
  L.push('- **判定：' + (o.C0.pass ? '通过（CI 含 0 ⇒ C1/C2 可读）' : '★未通过 ⇒ C1/C2 作废（只报 λ̂ 与执行缺陷）') + '**');
  L.push('');
  L.push('## 2 C1 角色效应（主判据）');
  L.push('| 温度 | 变体对 | n | d̄ | 95% CI | p | p(Holm) | 显著 | SNR |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of o.C1.readings) L.push('| ' + r.temperature + ' | ' + r.pair + ' | ' + r.n + ' | ' + fmt(r.mean) + ' | ['
    + fmt(r.ci.lo) + ', ' + fmt(r.ci.hi) + '] | ' + fmt(r.p) + ' | ' + fmt(r.p_holm) + ' | ' + (r.significant_holm ? '**是**' : '否') + ' | ' + fmt(r.snr, 2) + ' |');
  L.push('');
  L.push('- **判定：角色效应' + (o.C1.detected ? '**可辨**（Holm 校正后存在 p<0.05）' : '**不可辨**（Holm 校正后全部 p≥0.05）') + '**');
  L.push('- 口径声明：变体效应＝**提示词＋注入内容**的联合效应（v1 证据块／v2 纯题面／v3 基率行）——这是「变体」的定义，禁读成「换个说法而已」。');
  L.push('');
  L.push('## 2b ★披露（**非判据**）：判据只测「位置」，主导差异在「离散度」');
  L.push('- 逐臂读数分布（同一批 40 题）：');
  L.push('| 臂 | n | 均值 | SD | 唯一值数 | min | max |');
  L.push('|---|---|---|---|---|---|---|');
  for (const k of Object.keys(o.disclosure.arm_stats).sort()) { const s = o.disclosure.arm_stats[k];
    L.push('| ' + k + ' | ' + s.n + ' | ' + fmt(s.mean, 3) + ' | ' + fmt(s.sd, 3) + ' | ' + s.distinct + ' | ' + fmt(s.min, 2) + ' | ' + fmt(s.max, 2) + ' |'); }
  L.push('');
  L.push('- 逐对：**带符号差**（判据量）vs **绝对差**（离散度指示）：');
  L.push('| 温度 | 变体对 | n | 带符号 d̄ | 平均 \\|d\\| | max \\|d\\| | SD(d) | 去噪后 SD(真差异) | 噪声解释占比 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of o.disclosure.paired_dispersion) L.push('| ' + r.temperature + ' | ' + r.pair + ' | ' + r.n + ' | ' + fmt(r.mean_signed) + ' | ' + fmt(r.mean_abs) + ' | ' + fmt(r.max_abs) + ' | ' + fmt(r.sd_d) + ' | ' + fmt(r.sd_signal_after_noise) + ' | ' + fmt(r.noise_explained_share, 2) + ' |');
  L.push('');
  L.push('- **★退化臂**：`v3_baserate` 读数近似**常数**（T=0.7 时 40/40＝0.58，SD≈0.000）⇒ ① 涉及 v3 的 λ̂（代理 A 两对 ＋ N=3 联合 MLE）**不作「低重叠」证据**（常数成员的相关系数由构造为 0）；② 冻结判据测的是**位置**（配对均值差），对「离散度差异」**盲** ⇒ 故并列本表。');
  L.push('- **干净对（排除退化臂 v3）**：v1–v2 的 λ̂ = ');
  for (const r of o.disclosure.clean_pair_v1v2.by_temperature) L.push('  · T=' + r.temperature + ' n=' + r.n + '：代理 A=' + fmt(r.lambda_A) + '｜代理 B=' + fmt(r.lambda_B) + '｜**N=2 MLE λ̂=' + fmt(r.lambda_MLE_N2) + '**（δ̂=' + fmt(r.delta_MLE_N2) + '，feasible=' + r.feasible + '）');
  L.push('');
  L.push('## 3 C2 温度效应（副判据）');
  L.push('| 变体 | 温度对 | n | d̄ | 95% CI | p | p(Holm) | 显著 | SNR |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of o.C2.readings) L.push('| ' + r.variant + ' | ' + r.t_a + '→' + r.t_b + ' | ' + r.n + ' | ' + fmt(r.mean) + ' | ['
    + fmt(r.ci.lo) + ', ' + fmt(r.ci.hi) + '] | ' + fmt(r.p) + ' | ' + fmt(r.p_holm) + ' | ' + (r.significant_holm ? '**是**' : '否') + ' | ' + fmt(r.snr, 2) + ' |');
  L.push('');
  L.push('- **判定：温度效应' + (o.C2.detected ? '**可辨**' : '**不可辨**') + '**');
  L.push('');
  L.push('## 4 C3 λ̂（核心副产物；阈值 ' + o.C3.threshold + ' 蓝图写死）');
  L.push('### 4.1 附录 B MLE（N=3 联合拟合，按温度）');
  L.push('| 温度 | n | λ̂_MLE | δ̂ | ρ̂=δλ | feasible | δ(3−2λ) | 边界解? |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of o.C3.mle) L.push('| ' + r.temperature + ' | ' + r.n_questions + ' | ' + fmt(r.lambda) + ' | ' + fmt(r.delta) + ' | ' + fmt(r.rho)
    + ' | ' + r.feasible + ' | ' + fmt(r.feasibility_index) + ' | ' + (r.at_boundary ? '**是**' : '否') + ' |');
  L.push('');
  L.push('> 边界解提示：`δ(3−2λ)` ≈ 1 ⇒ 点估计落在模型约束边界（低 λ 侧的可行域边界），此时 λ̂ 有偏、**只作下界读**。');
  L.push('');
  L.push('### 4.2 代理双口径（逐对×逐温度；A＝probit 相关／B＝同意率反演）');
  L.push('| 温度 | 变体对 | n | λ̂_A | λ̂_B |');
  L.push('|---|---|---|---|---|');
  for (const r of o.C3.proxies) L.push('| ' + r.temperature + ' | ' + r.pair + ' | ' + r.n + ' | ' + fmt(r.lambda_A) + ' | ' + fmt(r.lambda_B) + ' |');
  L.push('');
  L.push('- **λ̂_lo（判定用）=' + fmt(o.C3.lambda_lo) + '**（代理最小 ' + fmt(o.C3.lambda_lo_proxy) + '／MLE 最小 ' + fmt(o.C3.lambda_lo_mle) + '）'
    + ' ⇒ **' + (o.C3.high ? '≥0.8 判「高重叠」' : '<0.8 判「低重叠（无法确认高重叠）」') + '**');
  L.push('- 存量混淆基线（同 40 题；L6 现役口径＝每变体取 id 最大行）：λ̂_lo=' + fmt(o.baseline_confounded.lambda_lo)
    + '｜MLE λ̂=' + fmt(o.baseline_confounded.mle && o.baseline_confounded.mle.lambda) + '（**口径与 §11 批的全库三元组不同，不直接可比**，仅示量级）');
  L.push('');
  L.push('## 5 出口判定（机械映射，PREREG §5）');
  L.push('- **出口 ' + o.exit.code + '：' + o.exit.text + '**');
  L.push('');
  L.push('## 5b ★L6 口径污染 what-if（零写库的量化证据；本批为何不写 verdicts 表）');
  L.push('- `l6Structural` 每变体取 **id 最大** 的一行且**不按 run_id 过滤** ⇒ 任何新插入的判词行都会**立刻成为 L6 的生产输入**。');
  L.push('- 若把本批 10 臂写入（假想，**未发生**）：可算题 n=' + o.l6_whatif.n + '｜读数会变 ' + o.l6_whatif.changed + '/' + o.l6_whatif.n
    + ' 题｜平均 |Δp|=' + fmt(o.l6_whatif.mean_abs_delta) + '｜最大 |Δp|=' + fmt(o.l6_whatif.max_abs_delta));
  L.push('- ⇒ 本批**改走工件通道**（JSONL＋读数件），账本零写；是否把本批晋升入账本 ⇒ **拍板项**。');
  L.push('');
  L.push('## 6 逐题读数（10 条件）');
  L.push('| pid | v1@0.2 | v1@0.2rep | v2@0.7 | v3@1.0 | v1@0.7 | v1@1.0 | v2@0.2 | v2@1.0 | v3@0.2 | v3@0.7 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of o.per_question) L.push('| ' + [r.pid, r['v1@0.2'], r['v1@0.2#rep'], r['v2@0.7'], r['v3@1'], r['v1@0.7'], r['v1@1'], r['v2@0.2'], r['v2@1'], r['v3@0.2'], r['v3@0.7']]
    .map((x) => (x === null ? 'n/a' : fmt(x, 2))).join(' | ') + ' |');
  L.push('');
  L.push('（9 臂解耦读数完 · 零账本写 · 零 LLM · 零网络）');
  return L.join('\n');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('[analyze] FAIL ' + (e && e.stack ? e.stack : e)); process.exit(1); }
}

module.exports = { pairedStat, holm, fmt };
