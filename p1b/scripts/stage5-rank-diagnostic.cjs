#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/stage5-rank-diagnostic.cjs —— 滞后集合 3 档秩检验（Watson）· **逐对件**（2026-09-17）
 *
 * 依据（唯一）：`docs/assets/forecast-debate/研讨会-20260916-预测万物v3/18-跨学科移植-深度报告.md` §2.3
 *   ＋ 蓝图 `docs/assets/forecast-debate/研讨会-20260916-预测万物v3/20-合议-v3.1大升级蓝图.md` 第 5 步
 *   （「U8 加滞后集合 3 档秩检验节（Watson 统计量）」，0.5 人日）。
 * 出处锚（照 18 号件实抓）：Hamill 2001 DOI 10.1175/1520-0493(2001)129<0550:iorhfv>2.0.co;2；
 *   Elmore 2005 DOI 10.1175/waf884.1（卡方对秩序不敏感，小样本改用 Cramér–von Mises 家族 ⇒ 采 Watson）。
 *
 * 干什么：给 stage5 冻结池（93 对）穿一次气象学自己的验证服，**只体检、不设生死判据**：
 *   · 3 档秩＝观测在 {day1, day3} 两名成员中的位次（1=低于两者／2=居中／3=高于两者；并列取中秩）
 *     ⇒「逐对（城×lead）」的两条逐对比较（obs vs day1、obs vs day3）合成一档秩，一题一个秩。
 *   · 数据来源**三零**：day1/day3 日最高温读**冻结信号件**（零重抓）；连续观测读**账本 resolve_note**
 *     的机检读数（=「当时判 y 的那个数」，零网络；与 y 做逐行一致性自检，不一致即披露）。
 *   · Watson U²（圆上 CvM；Stephens 1970 计算式）＋**置换 p 值**（B=1000）：置换＝题内三值等可能当
 *     「观测」标签 ⇒ 可交换零假设下的**精确**零分布（并列结构随置换保留）。
 *   · 先导判据（18 号件 §2.3 写死，**不是门控**）：4 城中 ≥3 城观测秩分布向同一端倾斜（Watson p<0.10）
 *     ⇒ MOS 主件立票优先级提到 A8 首位；全无倾斜 ⇒ MOS 持票不提前。
 *
 * 诚实边界：m=2 ⇒ 只有 3 档秩，**功效极低**（Hamill 2001 原文明言秩直方图需大样本）⇒ 本件任何数字
 *   都不得当能力宣称；它只回答「day1/day3 与观测的相对位置是否存在系统性倾斜」。
 *
 * 纪律：**零账本写、零 LLM、零网络**；硬门照 stage5 信号件同款（名册/指纹不符 ⇒ exit 3，不写件）。
 * 用法：node p1b/scripts/stage5-rank-diagnostic.cjs [--out <dir>] [--tag 20260917] [--signal <件>]
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const OUTDIR = arg('out', path.join(ROOT, 'p1b/sim/out'));
const INDIR = arg('in-dir', path.join(ROOT, 'p1b/sim/out'));   // 输入件恒在此解析（与 --out 解耦；同族教训第三次）
const TAG = arg('tag', new Date().toISOString().slice(0, 10).replace(/-/g, ''));
const B_PERM = Number(arg('b', 1000));
const SEED = 987654321;                              // bootstrap/置换口径照 stage4 先例（B=1000）

// 池谓词 / 指纹锚 / 名册：**单一真源**（stage5Pool.js）
const P = require(path.join(ROOT, 'p1b/src/evidence/stage5Pool'));

// ── 纯函数区（可 require，零副作用；供测试） ─────────────────────────────────

/** 观测在三值集合中的秩（1-based，并列取中秩）。vals=[day1,day3,obs]，obsIdx 指定谁是观测。 */
function rankOfObs(vals, obsIdx) {
  const obs = vals[obsIdx];
  let below = 0, equal = 0;
  for (let i = 0; i < vals.length; i++) {
    if (i === obsIdx) continue;
    if (vals[i] < obs) below++;
    else if (vals[i] === obs) equal++;
  }
  return 1 + below + 0.5 * equal;
}

/**
 * Watson U²（圆上 Cramér–von Mises，Stephens 1970 计算式；旋转不变）：
 *   U² = Σ (x_(i) − (2i−1)/(2n))² − n (x̄ − 1/2)² + 1/(12n)
 * 并列块取中秩（否则并列顺序会抖动 (2i−1)/(2n) 的分配）。
 * @param {number[]} us 圆上位置 ∈ (0,1]（本件＝秩/3）
 */
function watsonU2(us) {
  const n = us.length;
  if (n < 2) return null;
  const x = us.slice().sort((a, b) => a - b);
  const seq = new Array(n);
  for (let i = 0; i < n; i++) seq[i] = (2 * i + 1) / (2 * n);
  let s = 0, i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && x[j + 1] === x[i]) j++;
    let avg = 0;
    for (let k = i; k <= j; k++) avg += seq[k];
    avg /= (j - i + 1);
    for (let k = i; k <= j; k++) s += Math.pow(x[i] - avg, 2);
    i = j + 1;
  }
  const xbar = x.reduce((a, v) => a + v, 0) / n;
  return s - n * Math.pow(xbar - 0.5, 2) + 1 / (12 * n);
}

/** 置换 p 值：题内三值等可能充当「观测」标签（可交换零假设的精确零分布）。LCG 照项目口径。 */
function permP(pairs, B, seed) {
  const uObs = watsonU2(pairs.map((p) => p.rank / 3));
  if (uObs === null) return { u2: null, p: null, B: B, ge: null };
  let s = (seed >>> 0);
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  let ge = 0;
  for (let b = 0; b < B; b++) {
    const us = pairs.map((p) => rankOfObs(p.vals, Math.floor(rnd() * 3)) / 3);
    if (watsonU2(us) >= uObs - 1e-12) ge++;
  }
  return { u2: uObs, p: (1 + ge) / (B + 1), B: B, ge: ge };
}

/**
 * 倾斜统计量 T = Σ(秩 − 2) = n₃ − n₁（±中秩）＋置换 p（双侧）。
 *
 * **为何 Watson U² 之外还要这一个（勘误，2026-09-17）**：18 号件 §2.3 把先导判据挂在「Watson p<0.10」上，
 * 但 Watson U² 是**圆上旋转不变**量 —— 「整团倾斜」（例：全题观测都高于两名成员 ⇒ 全部秩=3 ⇒ 圆上一个点质量）
 * 与「完美平坦」的 U² 同取最小值 1/(12n) ⇒ **p 反而→1，对倾斜全盲**。
 * 先导判据问的是「向同一端倾斜」（MOS β₀ 订正 ⇔ 系统偏差），故该判据**改挂本统计量**；
 * Watson U² 仍按蓝图原文并列披露（两个 p 都给出，读数不同之处原样呈现）。
 * 实测佐证：全秩=3 的 40 题 ⇒ U²=0.0021 p=1.0000（盲），而 T 的 p≈0.001（明）。
 */
function permPTilt(pairs, B, seed) {
  const t = pairs.reduce((s, p) => s + (p.rank - 2), 0);
  let s = (seed >>> 0);
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  let ge = 0;
  for (let b = 0; b < B; b++) {
    let tb = 0;
    for (let i = 0; i < pairs.length; i++) tb += rankOfObs(pairs[i].vals, Math.floor(rnd() * 3)) - 2;
    if (Math.abs(tb) >= Math.abs(t) - 1e-12) ge++;
  }
  return { t: t, p: (1 + ge) / (B + 1), B: B, ge: ge };
}

/** 单层体检：Watson U²＋倾斜统计量（各带置换 p）＋3 档秩直方图。 */
function diagnose(label, pairs, B, seed) {
  const s = (k) => pairs.filter((p) => p.rank === k).length;
  const n1 = s(1), n2 = s(2), n3 = s(3);
  const t = permP(pairs, B, seed);
  const tt = permPTilt(pairs, B, seed);
  return {
    label: label, n: pairs.length,
    hist: { r1: n1, r2: n2, r3: n3 },
    ties: pairs.filter((p) => !Number.isInteger(p.rank)).length,
    watson_u2: t.u2, perm_p_watson: t.p,
    tilt_stat: tt.t, perm_p_tilt: tt.p, perm_B: B,
    tilt_dir: n3 === n1 ? 0 : (n3 > n1 ? 'high' : 'low'),
    tilt_sig: tt.p !== null && tt.p < 0.10,          // 先导判据挂**倾斜**统计量（勘误见 permPTilt 注释）
    between_deficit: n2 - pairs.length / 3,          // 秩2 相对期望的亏空（欠离散倾向的读法）
  };
}

// ── 主流程（只在 CLI 直跑；require 本件不写盘、不读库） ───────────────────────
function main() {
  const SIGNAL = arg('signal', (() => {
    try {
      const c = fs.readdirSync(INDIR).filter((f) => /^stage5-forecast-signal-\d{8}\.json$/.test(f)).sort();
      if (c.length) return path.join(INDIR, c[c.length - 1]);
    } catch (e) { /* ignore */ }
    return path.join(INDIR, 'stage5-forecast-signal-20260915.json');
  })());

  // ── 池与硬门（照 stage5 信号件同款：名册/指纹不符 ⇒ exit 3） ──
  const db = new DatabaseSync(path.join(ROOT, 'p1a-terminal/data/p1a.db'), { readOnly: true });
  const predicateRows = db.prepare(P.POOL_SQL()).all();
  const { rostered: pool, unrostered } = P.splitByRoster(predicateRows);
  const poolIds = pool.map((r) => r.id);
  const poolFp = P.fingerprint(poolIds);
  if (pool.length !== P.POOL_N_AT_FREEZE || poolFp !== P.POOL_FINGERPRINT_SHA256) {
    db.close();
    console.error('!! 冻结名册与冻结锚不符 -> ABORT（名册禁改；池消失须查因）');
    console.error('   got fp=' + poolFp + ' n=' + pool.length + ' want fp=' + P.POOL_FINGERPRINT_SHA256 + ' n=' + P.POOL_N_AT_FREEZE);
    process.exit(3);
  }
  const byId = new Map(pool.map((r) => [r.id, r]));
  const ph = poolIds.map(() => '?').join(',');
  const notes = new Map(db.prepare('SELECT id, resolve_note FROM predictions WHERE id IN (' + ph + ')')
    .all(...poolIds).map((n) => [n.id, String(n.resolve_note || '')]));
  db.close();

  // ── day1/day3 日最高温：读冻结信号件（零重抓） ──
  const sig = JSON.parse(fs.readFileSync(SIGNAL, 'utf8'));
  const slot = new Map();
  for (const r of sig.results || []) { if (!slot.has(r.id)) slot.set(r.id, {}); slot.get(r.id)[r.lead] = r.fmax; }
  const offRoster = [...slot.keys()].filter((i) => !byId.has(i));
  if (offRoster.length) {
    console.error('!! 信号件含名册外题 id=' + JSON.stringify(offRoster) + ' -> ABORT（层间样本不一致）');
    process.exit(3);
  }

  // ── 拼逐对件：连续观测来自账本注记（零网络），并与 y 逐行一致性自检 ──
  const pairs = [];
  let noSlot = 0, noObs = 0, mismatch = [];
  for (const id of poolIds) {
    const r = byId.get(id);
    const sl = slot.get(id);
    if (!sl || sl[1] === undefined || sl[3] === undefined) { noSlot++; continue; }
    const m = /max=(-?[\d.]+)C/.exec(notes.get(id) || '');
    if (!m) { noObs++; continue; }
    const obs = parseFloat(m[1]);
    const thr = Number(r.thr);
    const y = r.outcome === 'true' ? 1 : 0;
    const yFromObs = obs > thr ? 1 : 0;         // 与 corpus-resolve.cjs openmeteo_daily_max 同口径（严格 >）
    if (yFromObs !== y) mismatch.push({ id: id, obs: obs, thr: thr, y_ledger: y, y_from_obs: yFromObs });
    const vals = [sl[1], sl[3], obs];
    pairs.push({
      id: id, city: r.lat + ',' + r.lon, date: r.rdate, thr: thr, y: y, obs: obs,
      f_day1: sl[1], f_day3: sl[3], gt_day1: obs > sl[1] ? 1 : 0, gt_day3: obs > sl[3] ? 1 : 0,
      rank: rankOfObs(vals, 2), vals: vals,
    });
  }
  pairs.sort((a, b) => (a.city < b.city ? -1 : a.city > b.city ? 1 : (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id)));

  // ── 分层体检：全体 / 每城（先导判据单位） / 每城×lead 逐对分解 ──
  const cities = [...new Set(pairs.map((p) => p.city))].sort();
  const all = diagnose('ALL', pairs, B_PERM, SEED);
  const perCity = cities.map((c) => diagnose('city ' + c, pairs.filter((p) => p.city === c), B_PERM, SEED));
  const perLeadTilt = [];
  for (const c of cities) {
    const sub = pairs.filter((p) => p.city === c);
    for (const L of [1, 3]) {
      const k = L === 1 ? 'gt_day1' : 'gt_day3';
      const above = sub.filter((p) => p[k] === 1).length;
      perLeadTilt.push({ city: c, lead: L, n: sub.length, obs_above: above, obs_below: sub.length - above, tilt: above - (sub.length - above) });
    }
  }
  const tiltCities = perCity.filter((c) => c.tilt_sig && c.tilt_dir !== 0);
  const dirs = {};
  for (const c of tiltCities) dirs[c.tilt_dir] = (dirs[c.tilt_dir] || 0) + 1;
  const sameSign = Object.entries(dirs).filter((e) => e[1] >= 3).map((e) => e[0]);
  const leadingSignal = sameSign.length > 0;
  const mosAction = leadingSignal
    ? '≥3 城同向倾斜 ⇒ 照 18 号件 §2.3：MOS 主件（A8 第一批新增臂）立票优先级提到队首'
    : '4 城无同向倾斜（或不足 3 城显著）⇒ 照 18 号件 §2.3：MOS 主件持票不提前';

  // ── 输出 ──
  const f4 = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(4);
  const L = [];
  L.push('# 滞后集合 3 档秩检验（Watson）· 逐对件 ' + TAG);
  L.push('');
  L.push('> **非门控声明**：本件是「体检服」不是引擎——**不设生死判据**，不进任何门控；任何数字不得当能力宣称');
  L.push('> （m=2 ⇒ 只有 3 档秩，功效极低，Hamill 2001 原文明言秩直方图需大样本）。');
  L.push('> 数据：day1/day3 读**冻结信号件**（零重抓）｜连续观测读**账本 resolve_note 机检读数**（零网络）｜**零账本写 · 零 LLM**。');
  L.push('> 依据：18 号件 §2.3（Hamill 2001 DOI 10.1175/1520-0493(2001)129<0550:iorhfv>2.0.co;2；Elmore 2005 DOI 10.1175/waf884.1）。');
  L.push('');
  L.push('## 池与逐对件');
  L.push('- 池指纹 ' + poolFp.slice(0, 16) + '… ｜名册 ' + pool.length + '｜**逐对件 ' + pairs.length + ' 题**｜缺槽 ' + noSlot + '｜缺观测 ' + noObs
    + '｜名册外（仅披露）' + unrostered.length);
  L.push('- 一致性自检：`y == (obs > thr)` 不一致 **' + mismatch.length + '** 条' + (mismatch.length ? '（如实披露：' + JSON.stringify(mismatch.slice(0, 5)) + '）' : '（全部一致）'));
  L.push('- 并列（秩非整数）题数 = ' + all.ties + '（并列取中秩）');
  L.push('- 逐对明细（题级：day1/day3/观测/两条逐对比较/秩）见 `stage5-rank-pairs-' + TAG + '.jsonl`；本件 JSON 的 `pairs` 为同源副本。');
  L.push('');
  L.push('## 体检读数（Watson U² ＋ 倾斜统计量 T=n₃−n₁，各带置换 p，B=' + B_PERM + '）');
  L.push('');
  L.push('| 层 | n | 秩1 | 秩2 | 秩3 | 秩2亏空 | Watson U² | p(U²) | T=n₃−n₁ | p(T) | p(T)<0.10 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const d of [all].concat(perCity)) {
    L.push('| ' + d.label + ' | ' + d.n + ' | ' + d.hist.r1 + ' | ' + d.hist.r2 + ' | ' + d.hist.r3 + ' | ' + f4(d.between_deficit)
      + ' | ' + f4(d.watson_u2) + ' | ' + f4(d.perm_p_watson) + ' | ' + d.tilt_stat + ' | ' + f4(d.perm_p_tilt) + ' | ' + (d.tilt_sig ? '是' : '否') + ' |');
  }
  L.push('');
  L.push('- **两个统计量各答一问**：U² 答「秩分布是否不平（含 U 形/单峰/倾斜）」；T 答「是否**向同一端**倾斜」（先导判据要的那一问）。');
  L.push('- **U² 的盲区（本件勘误）**：U² 圆上旋转不变 ⇒ 「整团倾斜」（全部秩=3 或全=1）与「完美平坦」同取最小值 1/(12n)，p 反而→1；佐证：全秩=3 的 40 题 ⇒ U²=0.0021/p=1.0000，而 T 的 p≈0.001。故先导判据挂 T（蓝图 18 号件原文的 Watson p 仍并列披露）。');
  L.push('- 置换零假设＝题内三值等可能充当「观测」标签（可交换 ⇒ 精确零分布；并列结构随置换保留）；T 双侧、U² 单侧（大者）。');
  L.push('- 口径：U²=1/(12n) ⇒ 秩分布最平（或整团集中）；Stephens 1970 计算式。');
  L.push('');
  L.push('## 逐对分解（城×lead：obs vs 该 lead 预报）');
  L.push('');
  L.push('| 城 | lead | n | obs 高于该 lead 预报 | obs 低于 | 净差 |');
  L.push('|---|---|---|---|---|---|');
  for (const t of perLeadTilt) L.push('| ' + t.city + ' | ' + t.lead + 'd | ' + t.n + ' | ' + t.obs_above + ' | ' + t.obs_below + ' | ' + t.tilt + ' |');
  L.push('');
  L.push('## 先导判据（照 18 号件 §2.3，写死）');
  L.push('- 判据：4 城中 **≥3 城**观测秩分布向同一端倾斜（Watson p<0.10）⇒ MOS 主件立票优先级提到 A8 队首。');
  L.push('- 实测：显著且方向非 0 的城 = ' + tiltCities.length + '（' + (tiltCities.map((c) => c.label.replace('city ', '') + '/' + c.tilt_dir).join('、') || '无') + '）'
    + '｜同向 ≥3 城 = ' + (sameSign.length ? sameSign.join('/') : '无'));
  L.push('- 结论：**' + (leadingSignal ? '先导信号成立 ⇒ ' : '先导信号不成立 ⇒ ') + mosAction + '**。');
  L.push('');
  L.push('（逐对件完 · 三零：零账本写／零 LLM／零网络 · 非门控 · 仅体检服务）');

  fs.mkdirSync(OUTDIR, { recursive: true });
  const base = path.join(OUTDIR, 'stage5-rank-diagnostic-' + TAG);
  fs.writeFileSync(base + '.json', JSON.stringify({
    script: 'p1b/scripts/stage5-rank-diagnostic.cjs',
    basis: 'docs/assets/forecast-debate/研讨会-20260916-预测万物v3/18-跨学科移植-深度报告.md §2.3',
    anchors: ['DOI 10.1175/1520-0493(2001)129<0550:iorhfv>2.0.co;2', 'DOI 10.1175/waf884.1'],
    generated_at: new Date().toISOString(),
    discipline: { ledger_write: false, llm: false, network: false },
    not_a_gate: '非门控：体检服不是引擎；不设生死判据；不得当能力宣称（m=2 ⇒ 3 档秩，功效极低）。',
    pool_fingerprint_sha256: poolFp, n_pool: pool.length, n_pairs: pairs.length,
    unrostered_ids: unrostered, no_slot: noSlot, no_obs: noObs, mismatch: mismatch,
    ties: all.ties, perm_B: B_PERM, seed: SEED,
    erratum_20260917: '先导判据改挂倾斜统计量 T（U² 圆上旋转不变 ⇒ 对整团倾斜全盲：全秩=3 时 U² 取最小值、p→1）；'
      + '蓝图 18 号件原文的 Watson U² 及其置换 p 仍并列披露，两者读数不同之处原样呈现。',
    strata: [all].concat(perCity), per_lead_tilt: perLeadTilt,
    leading_signal: { rule: '4 城中 ≥3 城同向倾斜（倾斜统计量 T 的置换 p<0.10）⇒ MOS 提队首', rule_src: '18 号件 §2.3（原文写 Watson p，本件勘误见 erratum_20260917）', cities_significant: tiltCities.length, same_dir_ge3: sameSign, holds: leadingSignal, action: mosAction },
    pairs: pairs,
  }, null, 1), 'utf8');
  fs.writeFileSync(base + '.md', L.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(OUTDIR, 'stage5-rank-pairs-' + TAG + '.jsonl'),
    pairs.map((p) => JSON.stringify({ id: p.id, city: p.city, date: p.date, thr: p.thr, y: p.y, obs: p.obs, f_day1: p.f_day1, f_day3: p.f_day3, gt_day1: p.gt_day1, gt_day3: p.gt_day3, rank: p.rank })).join('\n') + '\n', 'utf8');
  console.log('=== 滞后集合 3 档秩检验（Watson）· 逐对件 ===');
  console.log('  池 ' + pool.length + '｜逐对件 ' + pairs.length + ' 题｜不一致 ' + mismatch.length);
  for (const d of [all].concat(perCity)) {
    console.log('  ' + d.label + ': n=' + d.n + ' 秩(' + d.hist.r1 + ',' + d.hist.r2 + ',' + d.hist.r3 + ') U²=' + f4(d.watson_u2)
      + ' pU=' + f4(d.perm_p_watson) + ' | T=' + d.tilt_stat + ' pT=' + f4(d.perm_p_tilt) + (d.tilt_sig ? ' <0.10' : ''));
  }
  console.log('  先导：' + (leadingSignal ? '成立' : '不成立') + ' ⇒ ' + mosAction);
  console.log('json/md/jsonl -> ' + OUTDIR);
}

module.exports = { rankOfObs: rankOfObs, watsonU2: watsonU2, permP: permP, permPTilt: permPTilt, diagnose: diagnose };
if (require.main === module) { main(); }
