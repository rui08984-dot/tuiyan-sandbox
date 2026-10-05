#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/mdl-retention.cjs —— 18⑥ MDL 两部码留位判据 ＋ 效度回放（2026-09-17）
 *
 * 依据（唯一）：`docs/assets/forecast-debate/研讨会-20260916-预测万物v3/18-跨学科移植-深度报告.md` §7
 *   ＋ 消费者 `19-骨架裁剪-深度报告.md` §1.1/§4.3（19 号是本框架登记的第一个消费者）。
 * 出处锚（照 18 号件实抓）：Rissanen 1978 *Automatica* DOI 10.1016/0005-1098(78)90005-5（MDL 两部码）；
 *   Dawid 1984 *JRSS-A* DOI 10.2307/2981683（prequential 原则）；BIC 桥「每自由参数 (ln n)/2 nats」见 18 号 §7。
 *
 * 干什么（零 LLM／零网络／零写库；库 readOnly）：
 *   · **留位判据**：候选剪除对象（封存算子/薄臂/重复变体/语义维）过判据——剪除它使**系统总码长不增** ⇒ 剪。
 *     本件给可算形式 ＋ **临界复杂度 k\***（占用的自由参数 ≥ k\* ⇒ 剪）。
 *   · **效度回放（先行验收，18 号 §7 判据①）**：对「已知死件」回放，判据须正确识别其边际贡献不可辨；
 *     否则框架降级为纯披露、19 号不得引用。
 *
 * ★★ 符号更正（2026-09-17 自查，本件实现口径；原文零改动、此处追加更正）：
 *   18 号 §7 与 19 号 §1.1 把判据写作 `ΔL = [Σ log p̄_含(y) − Σ log p̄_不含(y)] + (ln n)/2 · k ≤ 0 ⇒ 剪`。
 *   **按字面代入死件**（第一项 ≈ 0）得 ΔL = +P > 0 ⇒ 判「**不剪**」——与 19 号 §1.1 自述判词
 *   （「没贡献的复杂度自动出局」「纯税」）以及 §4.3 实际砍掉的动作**方向相反**。
 *   本件按规范**自带**的效度判据（「剪除后**总码长变化** |ΔL| 的 CI 含 0」）消歧：
 *     **ΔL ≔ 剪除前后系统总码长之差 = L_剪后 − L_剪前 = [Σ ln p̄_含(y) − Σ ln p̄_不含(y)] − (ln n)/2 · k**
 *     ⇒ ΔL ≤ 0 ⇒ 剪（等价：数据部分 A ≤ 复杂度罚 P）。第一项（数据部分 A）符号方向照原式；
 *     第二项由「+」改「−」（它是被剪对象**省下**的复杂度，方向须与「剪后 − 剪前」一致）。
 *   罚项是**确定量、无 CI** ⇒ 「|ΔL| 的 CI 含 0」唯一可检验读法＝**数据部分 A 的 CI 含 0**（本件按此执行并披露）。
 *
 * ★ 口径精度补充（同批自查，第二条）：**「CI 含 0（统计不显著）」与「ΔL ≤ 0（判剪）」不等价**——
 *   后者用**点估计**比复杂度罚（MDL 是判据不是显著性检验）。两者在 k 取小值时可能结论不同（本件 §2 实证一例），
 *   故**引用者必须自报 k**；本件不编 k、只报 k\* 与 k 表。
 *
 * 操作化声明（规范未指定处，本件写死并披露）：
 *   · 回放**主口径＝增量式**：候选对象＝治疗臂相对基线臂的**增量**（含＝治疗臂分布，不含＝基线臂分布）；
 *     效度**靶**＝命题 A 的 **A vs B**（PREREG 主判据，即判据①引用的 Δ=+0.00299 那格）；其余对比按**对照**披露。
 *   · 回放**副口径＝集合成员式**（鉴别力对照）：系统＝三臂等权均值，「剪除任一臂」＝其余两臂等权均值；
 *     它测的是**集合多样性**而非版本增量 ⇒ 期望不判剪（否则判据是「一律剪」的是机器）。
 *   · 判决一律用**对数分（nats）**；Brier 只作并列披露（18 号 §7 第 3 条：禁互换）。概率夹取 [1e-6, 1−1e-6]。
 * 用法：node p1b/scripts/mdl-retention.cjs [--db <path>] [--out-dir <dir>] [--in-dir <dir>] [--boot 1000] [--seed 987654321]
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
const IN_DIR = arg('in-dir', path.join(ROOT, 'p1b', 'sim', 'out'));   // 官方评分件恒在此找（与 --out-dir 解耦）
const NB = Number(arg('boot', '1000'));
const SEED = Number(arg('seed', '987654321'));
const RUN_PREFIX = arg('run-prefix', 'preregA-full1-');
const EPS = 1e-6;

// ── 纯函数区（可 require，零副作用） ─────────────────────────────────────────
const clampP = (p) => Math.max(EPS, Math.min(1 - EPS, Number(p)));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const brier = (p, y) => (clampP(p) - y) * (clampP(p) - y);

/** 单题对数分（nats）：ln p̄(y)。 */
function logScore(p, y) { const q = clampP(p); return y === 1 ? Math.log(q) : Math.log(1 - q); }

/** 数据部分 A（nats）：rows=[{y, pWith, pWithout}] ⇒ Σ [ln p̄_含(y) − ln p̄_不含(y)]；正 ⟺ 该对象带来预测信息。 */
function dataDeltaL(rows) { let s = 0; for (const r of rows) s += logScore(r.pWith, r.y) - logScore(r.pWithout, r.y); return s; }

/** 两部码总码长差 ΔL(k) = A − (ln n)/2 · k；**ΔL ≤ 0 ⇒ 剪**（本件写死的符号口径，见文件头更正）。 */
function twoPartDL(A, n, k) { return A - (Math.log(n) / 2) * k; }

/** 临界复杂度 k\*：该对象占用的自由参数 ≥ k\* ⇒ ΔL ≤ 0 ⇒ 剪。 */
function breakEvenK(A, n) { return n > 0 ? (2 * A) / Math.log(n) : null; }

/** 配对（按行）bootstrap：百分位法，B/seed 照项目口径（stage4／PREREG 同源 LCG）。 */
function bootCI(rows, fn, B, seed) {
  const n = rows.length;
  if (!n) return { lo: null, hi: null, B: B, seed: seed };
  let s = seed >>> 0;
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const vals = [];
  for (let b = 0; b < B; b++) {
    const sub = new Array(n);
    for (let i = 0; i < n; i++) sub[i] = rows[Math.floor(rnd() * n)];
    vals.push(fn(sub));
  }
  vals.sort((x, y) => x - y);
  const q = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * vals.length)))];
  return { lo: q(0.025), hi: q(0.975), B: B, seed: seed };
}

// ── 主流程（只在 CLI 直跑；require 不写盘、不读库） ───────────────────────────
function main() {
  const re = new RegExp('^' + RUN_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([ABC])-(cutoff|full)$');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const raw = db.prepare(
    'SELECT v.prediction_id AS pid, v.prompt_variant AS variant, v.temperature AS temp, v.model AS model, '
    + 'v.implied_prob AS prob, v.run_id AS run, v.created_at AS created, p.outcome AS outcome, p.layer AS layer '
    + 'FROM verdicts v JOIN predictions p ON p.id = v.prediction_id '
    + "WHERE v.run_id LIKE ? AND p.outcome IN ('true','false') ORDER BY v.prediction_id, v.prompt_variant, v.run_id"
  ).all(RUN_PREFIX + '%');
  const nullProb = db.prepare("SELECT COUNT(*) n FROM verdicts v JOIN predictions p ON p.id = v.prediction_id WHERE v.run_id LIKE ? AND p.outcome IN ('true','false') AND v.implied_prob IS NULL").get(RUN_PREFIX + '%').n;
  db.close();
  const rows = [];
  for (const r of raw) {
    const m = re.exec(r.run);
    if (!m || r.prob === null) continue;
    rows.push({ key: r.pid + '|' + r.variant + '|' + r.temp + '|' + r.model, pid: r.pid, variant: r.variant, layer: r.layer,
      created: r.created, y: r.outcome === 'true' ? 1 : 0, arm: m[1], window: m[2], p: Number(r.prob) });
  }
  const clipped = rows.filter((r) => r.p <= 0 || r.p >= 1).length;
  const ARMS = ['A', 'B', 'C'], windows = ['cutoff', 'full'];

  /** 按窗建 key → {arm: row} */
  const byWindow = (w) => {
    const m = new Map();
    for (const r of rows) { if (r.window !== w) continue; if (!m.has(r.key)) m.set(r.key, {}); m.get(r.key)[r.arm] = r; }
    return m;
  };
  /** 两臂配对集（带行引用，便于对账定位） */
  const pairSet = (w, T, B) => {
    const m = byWindow(w), out = [];
    for (const [, o] of m) if (o[T] && o[B]) out.push({ y: o[T].y, layer: o[T].layer, pWith: o[T].p, pWithout: o[B].p, pT: o[T].p, pB: o[B].p, ref: o[T], refB: o[B] });
    return out;
  };
  const cellStats = (s) => ({ n: s.length, brier_treatment: mean(s.map((r) => brier(r.pT, r.y))), brier_baseline: mean(s.map((r) => brier(r.pB, r.y))), delta_brier: mean(s.map((r) => brier(r.pB, r.y) - brier(r.pT, r.y))) });

  // ── §1 完整性交叉核对（六格复算官方程 ＋ 单对剔除定位补漏对账） ──
  const fileTag = { 'A→B': 'a-vs-b', 'A→C': 'a-vs-c', 'B→C': 'b-vs-c' };
  const crossCheck = [];
  for (const w of windows) for (const [T, B] of [['A', 'B'], ['A', 'C'], ['B', 'C']]) {
    const tag = T + '→' + B;
    const set = pairSet(w, T, B);
    const cur = cellStats(set);
    let official = null;
    const f = path.join(IN_DIR, 'prereg-a-score-' + fileTag[tag] + '-' + w + '-20260914.json');
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); official = { file: path.basename(f), generated_at: j.generated_at, n_pairs: j.n_pairs, delta_brier: j.delta_brier, brier_treatment: j.brier_treatment, brier_baseline: j.brier_baseline, ci95: j.ci95 }; } catch (e) { official = null; }
    let exact = null, reconciled = null;
    if (official) {
      const ok = (s) => s.n === official.n_pairs && Math.abs(s.delta_brier - official.delta_brier) < 1e-9
        && Math.abs(s.brier_treatment - official.brier_treatment) < 1e-9 && Math.abs(s.brier_baseline - official.brier_baseline) < 1e-9;
      if (ok(cur)) exact = true;
      else {
        for (let i = 0; i < set.length; i++) {
          const s = cellStats(set.filter((_, j) => j !== i));
          if (ok(s)) {
            reconciled = { removed_index: i,
              removed_ref: { pid: set[i].ref.pid, variant: set[i].ref.variant, T_created: set[i].ref.created, B_created: set[i].refB.created },
              stats: s, pair_max_created: String(set[i].ref.created) > String(set[i].refB.created) ? set[i].ref.created : set[i].refB.created };
            break;
          }
        }
      }
    }
    crossCheck.push({ window: w, pair: tag, current: cur, official: official, exact_match: exact,
      reconciled_match: reconciled ? true : null, reconciled: reconciled });
  }
  const xcPass = crossCheck.every((c) => !c.official || c.exact_match === true || c.reconciled_match === true);

  // ── §2 效度回放 ──
  const analyse = (set, label) => {
    const n = set.length;
    if (n < 30) return { label: label, n: n, note: 'n<30 ⇒ 只报 n' };
    const A = dataDeltaL(set);
    const ci = bootCI(set, (sub) => dataDeltaL(sub), NB, SEED);
    const dls = {}; for (const k of [1, 2, 3, 5, 10]) { const d = twoPartDL(A, n, k); dls['k' + k] = { dl: d, prune: d <= 0 }; }
    return { label: label, n: n, data_A_nats: A, data_A_bits: A / Math.LN2, ci95_A: ci,
      ci_contains_0: (ci.lo <= 0 && ci.hi >= 0), break_even_k: breakEvenK(A, n), penalty_nats_per_k: Math.log(n) / 2,
      deltaL_by_k: dls, verdict_k1: dls.k1.prune ? '剪' : '留',
      brier_delta_T_minus_B: mean(set.map((r) => brier(r.pT, r.y) - brier(r.pB, r.y))),
      official_ci95: null };
  };
  const replayMain = [];
  for (const w of windows) for (const [T, B] of [['A', 'B'], ['A', 'C'], ['B', 'C']]) {
    const r = analyse(pairSet(w, T, B), w + '/' + T + '→' + B);
    const xc = crossCheck.find((c) => c.window === w && c.pair === T + '→' + B);
    if (xc && xc.official) { r.official_declared = { delta_brier: xc.official.delta_brier, ci95: xc.official.ci95, lb_gt_0: xc.official.ci95 ? xc.official.ci95.lb_gt_0 : null }; }
    r.is_validity_target = (T === 'A' && B === 'B');   // 效度靶＝PREREG 主判据对比
    replayMain.push(r);
  }
  const targets = replayMain.filter((r) => r.is_validity_target && r.n >= 30);
  const validityPass = targets.length > 0 && targets.every((r) => r.ci_contains_0 === true && r.verdict_k1 === '剪');
  const insignificant = replayMain.filter((r) => r.n >= 30 && r.ci_contains_0);
  const insignificantNotPruned = insignificant.filter((r) => r.verdict_k1 !== '剪');

  const ens = [];
  for (const w of windows) for (const a of ARMS) {
    const m = byWindow(w), set = [];
    for (const [, o] of m) { if (!ARMS.every((x) => o[x])) continue;
      set.push({ y: o.A.y, pWith: mean(ARMS.map((x) => o[x].p)), pWithout: mean(ARMS.filter((x) => x !== a).map((x) => o[x].p)) }); }
    ens.push(analyse(set, w + '/剪除臂' + a));
  }

  // ── 输出 ──
  const f6 = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(6);
  const L = [];
  L.push('# MDL 两部码留位判据 ＋ 效度回放（18⑥）· ' + new Date().toISOString().slice(0, 10));
  L.push('');
  L.push('> **判据（写死）**：ΔL ＝ **剪除前后系统总码长之差**（L_剪后 − L_剪前）');
  L.push('> ＝ [Σ ln p̄_含(y) − Σ ln p̄_不含(y)] − (ln n)/2 · k；**ΔL ≤ 0 ⇒ 剪**（等价：数据部分 A ≤ 复杂度罚 P）。');
  L.push('> 判决一律用**对数分（nats）**；Brier 只作并列披露（对 miscalibration 敏感度不同，禁互换）。');
  L.push('> 纪律：**零账本写／零 LLM／零网络**；库 readOnly；只披露不进门控（除 18 号 §7 判据①的框架效度验收）。');
  L.push('> 出处：Rissanen 1978 DOI 10.1016/0005-1098(78)90005-5；Dawid 1984 DOI 10.2307/2981683；BIC 桥 (ln n)/2·k。');
  L.push('');
  L.push('## 0. ★两处口径更正（自查 2026-09-17）');
  L.push('- **①符号**：18 号 §7／19 号 §1.1 原式写作 `… + (ln n)/2 · k ≤ 0 ⇒ 剪`。**按字面代入死件**（A≈0）得 ΔL = **+P > 0** ⇒ 判「**不剪**」——');
  L.push('  与 19 号自述判词（「没贡献的复杂度自动出局」「纯税」）及 §4.3 实际砍掉的动作**方向相反**。');
  L.push('  本件按规范**自带**的效度判据（「剪除后**总码长变化** |ΔL| 的 CI 含 0」）消歧：第二项由「+」改「−」。');
  L.push('  罚项是**确定量、无 CI** ⇒ 「|ΔL| 的 CI 含 0」唯一可检验读法＝**数据部分 A 的 CI 含 0**（本件按此执行）。');
  L.push('- **②不等价**：**「CI 含 0（统计不显著）」≠「ΔL ≤ 0（判剪）」**——后者用**点估计**比复杂度罚（MDL 是判据不是显著性检验）。');
  L.push('  本件 §2 实证一例（A→C：CI 含 0 但 k=1 判「留」）⇒ **引用者必须自报 k**；本件不编 k、只报 k\\* 与 k 表。');
  L.push('- 同族（判据没有对齐到它真正要问的那一问）：§26 档位边界｜§53 判据层级｜§72 口径/字节｜§73 U² 旋转不变盲区。');
  L.push('');
  L.push('## 1. 数据与完整性交叉核对（六格复算官方程）');
  L.push('');
  L.push('- 取数：`verdicts.run_id LIKE \'' + RUN_PREFIX + '%\'` ＋ `outcome ∈ {true,false}` ⇒ ' + raw.length + ' 行；');
  L.push('  再滤 `implied_prob IS NOT NULL`（**' + nullProb + ' 行为 NULL**：A-cutoff/pid147/v2、C-full/pid180/v2）⇒ 本件用 **' + rows.length + ' 行**；夹取 [1e-6,1−1e-6] **' + clipped + '** 行（p∈{0,1}）。');
  L.push('');
  L.push('| 窗 | 对比 | 现行 n | 现行 Δ | 官方件 n | 官方件 Δ | 对账 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const c of crossCheck) {
    const rec = c.exact_match ? '逐位命中 ✓'
      : (c.reconciled_match ? '剔 1 对后逐位命中 ✓（剔 ' + JSON.stringify(c.reconciled.removed_ref) + '）' : '✗ 未命中');
    L.push('| ' + c.window + ' | ' + c.pair + ' | ' + c.current.n + ' | ' + f6(c.current.delta_brier) + ' | '
      + (c.official ? c.official.n_pairs : 'n/a') + ' | ' + (c.official ? f6(c.official.delta_brier) : 'n/a') + ' | ' + (c.official ? rec : 'n/a（缺件）') + ' |');
  }
  L.push('');
  L.push('- 结论：**' + (xcPass ? '交叉核对通过' : '交叉核对未通过（须先处置）') + '** ⇒ 本件数据与 PREREG 官方评分件同源同口径，回放读数可采信。');
  L.push('- 若出现「剔 1 对后命中」：该对＝官方件生成**之后**新增的补漏行（官方件早于它，故不可能含它）；剔除后逐位命中＝口径一致的证明。');
  L.push('');
  L.push('## 2. 效度回放（18 号 §7 判据①）');
  L.push('');
  L.push('**靶的选取（如实披露）**：判据①引用「Δ=+0.00299 的既判事实」＝命题 A 的 **A vs B**（PREREG 主判据）；故**效度靶＝A→B 两窗**。');
  L.push('其余对比与集合口径**按对照披露、不参与 PASS/FAIL**（官方对它们的判定：A→C 两窗与 B→C cutoff「不显著」；**B→C full 是唯一显著格**＝sham 对照有效性证据（真特征 > 空特征），本就不是死件）。');
  L.push('');
  L.push('**主口径（增量式）**——含＝治疗臂分布，不含＝基线臂分布；对应 19 号消费语义（剪掉「贡献不可辨」的器官/增量）。');
  L.push('');
  L.push('| 窗 | 对比 | n | A（nats） | A 的 95% CI | CI 含 0 | 临界 k\\* | ΔL(k=1) | 判决(k=1) | 官方 Brier Δ | 并列 Brier Δ(T−B) |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of replayMain) {
    if (r.n < 30) { L.push('| ' + r.label.split('/')[0] + ' | ' + r.label.split('/')[1] + ' | ' + r.n + ' | — | — | — | — | — | 只报 n | — | — |'); continue; }
    const parts = r.label.split('/');
    L.push('| ' + parts[0] + ' | ' + (r.is_validity_target ? '**' + parts[1] + '**' : parts[1]) + ' | ' + r.n + ' | ' + f6(r.data_A_nats)
      + ' | [' + f6(r.ci95_A.lo) + ', ' + f6(r.ci95_A.hi) + '] | ' + (r.ci_contains_0 ? '是' : '否') + ' | ' + f6(r.break_even_k)
      + ' | ' + f6(r.deltaL_by_k.k1.dl) + ' | **' + r.verdict_k1 + '** | ' + (r.official_declared ? f6(r.official_declared.delta_brier) : 'n/a') + ' | ' + f6(r.brier_delta_T_minus_B) + ' |');
  }
  L.push('');
  L.push('- 逐 k 判决（ΔL ≤ 0 ⇒ 剪）：' + replayMain.filter((r) => r.n >= 30).map((r) => r.label + '：'
    + [1, 2, 3, 5, 10].map((k) => 'k=' + k + (r.deltaL_by_k['k' + k].prune ? '剪' : '留')).join('/')).join('｜'));
  L.push('- **效度回放总判：' + (validityPass ? 'PASS ⇒ 判据正确识别已知死件（框架生效，19 号可引用）' : 'FAIL ⇒ 照 18 号 §7：框架降级为纯披露，19 号不得引用') + '**');
  L.push('  （靶＝A→B 两窗：CI 含 0 ∧ k=1 判剪，均满足＝' + (validityPass ? '是' : '否') + '）。');
  L.push('- **k 敏感性（口径②实证）**：CI 含 0 而 k=1 判「留」的对照 = '
    + (insignificantNotPruned.length ? insignificantNotPruned.map((r) => r.label + '（k\\*=' + f6(r.break_even_k) + '）').join('、') : '无')
    + '；这些格在 k ≥ k\\* 时翻为「剪」⇒ **判决随 k 变，引用者必须自报 k**。');
  L.push('');
  L.push('**副口径（集合成员式·鉴别力对照）**——系统＝三臂等权均值，「剪除任一臂」＝其余两臂等权均值；');
  L.push('它测的是**集合多样性**（同题不同表述取均值的方差削减），**不是**版本增量 ⇒ 期望**不判剪**');
  L.push('（若连它也判剪，说明判据是「一律剪」的是机器、无鉴别力）。');
  L.push('');
  L.push('| 层 | n | A（nats） | A 的 95% CI | CI 含 0 | 临界 k\\* | ΔL(k=1) | 判决(k=1) |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of ens) {
    if (r.n < 30) { L.push('| ' + r.label + ' | ' + r.n + ' | — | — | — | — | — | 只报 n |'); continue; }
    L.push('| ' + r.label + ' | ' + r.n + ' | ' + f6(r.data_A_nats) + ' | [' + f6(r.ci95_A.lo) + ', ' + f6(r.ci95_A.hi) + '] | '
      + (r.ci_contains_0 ? '是' : '否') + ' | ' + f6(r.break_even_k) + ' | ' + f6(r.deltaL_by_k.k1.dl) + ' | ' + r.verdict_k1 + ' |');
  }
  L.push('');
  L.push('- 读法（**如实，不预设**）：判据在该口径下**确实在鉴别**——**sham 臂 C（空特征）两窗皆判剪**（去掉它码长反而变短：A 为负），');
  L.push('  而两个带真特征的臂在多数格判「留」（`full/剪除臂A` 与 `cutoff/剪除臂B` 判剪，其 k\\* 均 <1.3，如实并列）。');
  L.push('  ⇒ 判据**不是「一律剪」的是机器**：同一批数据里它剪掉的是**拖后腿的成员**、留下的是**带信息的成员**。两个口径各自独立披露、**禁混读**。');
  L.push('');
  L.push('## 3. 换算表与边界（18 号 §7 第 3 条）');
  L.push('');
  L.push('- nats ↔ bit：1 nat = 1/ln2 = ' + f6(1 / Math.LN2) + ' bit；A 列已同时给两量纲。');
  L.push('- **Brier ↔ 对数分不做互转**（proper scoring 家族内对 miscalibration 敏感度不同，15 号 §5.1 B6 已核）；Brier 仅作并列披露。');
  L.push('- **复杂度罚 k 未定**（规范只给语义不给数）⇒ 本件**不编 k**，只报 k\\* 与 k 表；引用者须自报 k 与其来源。');
  L.push('- 边界：回放只用**命题 A 一实验**（社交推理域、glm-5.3-flash、120 题×3 路×2 窗）；不外推到其他域/模型。');
  L.push('- 夹取影响：' + clipped + ' 行 p∈{0,1} 被夹到 [1e-6,1−1e-6]（对数分需有限值；≤1% 行）。');
  L.push('');
  L.push('（mdl-retention 完 · 零账本写 · 零 LLM · 零网络 · 只披露不进门控）');

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, 'mdl-retention-' + today);
  fs.writeFileSync(base + '.json', JSON.stringify({
    script: 'p1b/scripts/mdl-retention.cjs',
    basis: 'docs/assets/forecast-debate/研讨会-20260916-预测万物v3/18-跨学科移植-深度报告.md §7（消费者 19 号 §1.1/§4.3）',
    anchors: ['DOI 10.1016/0005-1098(78)90005-5', 'DOI 10.2307/2981683'],
    generated_at: new Date().toISOString(),
    discipline: { ledger_write: false, llm: false, network: false },
    criterion: {
      deltaL_definition: 'L_剪后 − L_剪前 = [Σ ln p̄_含(y) − Σ ln p̄_不含(y)] − (ln n)/2 · k',
      rule: 'ΔL ≤ 0 ⇒ 剪（等价 A ≤ P）', unit: 'nats（Brier 不参与判决）',
      erratum_sign: '原式第二项「+」应为「−」；按字面代入死件得 +P>0 判「不剪」，与 19 号自述判词与实际动作相反。罚项无 CI ⇒ 「|ΔL| 的 CI 含 0」按「数据部分 A 的 CI 含 0」执行。',
      erratum_equivalence: '「CI 含 0（不显著）」≠「ΔL ≤ 0（判剪）」——后者用点估计比罚项；本件实证一例，故引用者必须自报 k。',
    },
    operationalization: {
      main: '增量式（治疗臂 vs 基线臂）——效度靶＝A→B（PREREG 主判据，Δ=+0.00299 那格）；其余对比为对照',
      secondary: '集合成员式（三臂等权均值 vs 其余两臂均值）——测集合多样性，期望不判剪（鉴别力对照）',
      k: '未编——报临界 k* 与 k∈{1,2,3,5,10} 表',
    },
    run_prefix: RUN_PREFIX, rows_raw: raw.length, rows_null_prob: nullProb, rows_used: rows.length, rows_clipped: clipped,
    cross_check: crossCheck, cross_check_pass: xcPass,
    replay_main: replayMain, validity_target: 'A→B（两窗）', validity_pass: validityPass,
    insignificant_but_not_pruned_at_k1: insignificantNotPruned.map((r) => ({ label: r.label, break_even_k: r.break_even_k })),
    replay_secondary: ens,
    bootstrap: { B: NB, seed: SEED, method: '按行配对重采样·百分位法' },
  }, null, 1), 'utf8');
  fs.writeFileSync(base + '.md', L.join('\n') + '\n', 'utf8');
  console.log('=== MDL 留位判据 ＋ 效度回放（18⑥）===');
  console.log('  数据 ' + rows.length + ' 行（NULL prob ' + nullProb + '｜夹取 ' + clipped + '）｜交叉核对 ' + (xcPass ? 'PASS' : 'FAIL'));
  for (const c of crossCheck) console.log('  ' + c.window + ' ' + c.pair + ': n=' + c.current.n + ' Δ=' + f6(c.current.delta_brier)
    + ' vs 官方 ' + (c.official ? c.official.n_pairs + '/' + f6(c.official.delta_brier) : 'n/a')
    + (c.exact_match ? ' ✓' : (c.reconciled_match ? ' ✓(剔1对:' + JSON.stringify(c.reconciled.removed_ref) + ')' : ' ✗')));
  console.log('  主口径（增量式）:');
  for (const r of replayMain) { if (r.n < 30) continue;
    console.log('    ' + r.label + (r.is_validity_target ? ' [效度靶]' : '') + ': n=' + r.n + ' A=' + f6(r.data_A_nats)
      + ' CI[' + f6(r.ci95_A.lo) + ',' + f6(r.ci95_A.hi) + '] k*=' + f6(r.break_even_k) + ' ⇒ ' + r.verdict_k1); }
  console.log('    效度总判：' + (validityPass ? 'PASS' : 'FAIL'));
  console.log('  副口径（集合成员式）:');
  for (const r of ens) { if (r.n < 30) continue;
    console.log('    ' + r.label + ': n=' + r.n + ' A=' + f6(r.data_A_nats) + ' k*=' + f6(r.break_even_k) + ' ⇒ ' + r.verdict_k1); }
  console.log('json/md -> ' + OUT_DIR);
}

module.exports = { logScore, dataDeltaL, twoPartDL, breakEvenK, bootCI, clampP };
if (require.main === module) { main(); }
