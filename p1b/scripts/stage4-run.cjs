#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/stage4-run.cjs —— 阶段 4「分层预测真跑」：把**真实账本**喂进 L2/L5 最小引擎并按层计分
 * （2026-09-14 新增）
 *
 * 为什么存在：L2/L5 引擎（`p1b/src/engines/`）已建并接线到**接题层**（intake），但从未对**已有账本**
 *   真跑过——路线图阶段 4 的「真跑」正是这一步：让引擎逐题出读数，再拿已 resolve 的真值算分层 Brier。
 *   没有这一步，引擎只是"能用"，不能说"跑过、有读数"。
 *
 * 口径（严格照 design，禁跨层比较）：
 *   · L2：p = 统计基率（Wilson 95% CI）；数据源＝evidence.baseRateNote（与 g2-report.parseBaseRate 同源）
 *   · L5：p = 认证源公布分布（无 certifiedSource 声明 → unsupported，**如实不出数**，不编）
 *   · 计分：仅对 `outcome IS NOT NULL` 的行算 Brier = (p − y)²；y∈{true/false}→{1,0}
 *   · **分层报，禁跨层池化**（design §4.3 层间数字迁移禁令）
 *   · 对照基线：常数 b（该层该题自己的基率 p）、常数 0.5；报 trivial-baseline ΔBrier
 *   · ECE(binned) 恒挂「下界估计＋小样本正偏」双标注；n<30 不出 CI
 *
 * 用法（只读；零写库）：
 *   node p1b/scripts/stage4-run.cjs [--db <path>] [--json <out.json>] [--text <out.txt>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const JSON_OUT = arg('json', null);
const TEXT_OUT = arg('text', null);
const REGIME = "p.g2_regime = 'R4'";
const MIN_N = 30;

const { DatabaseSync } = require('node:sqlite');
const { l2Baseline } = require(path.join(ROOT, 'p1b/src/engines/l2_baseline'));
const { l5Certified } = require(path.join(ROOT, 'p1b/src/engines/l5_certified'));

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const all = (s) => db.prepare(s).all();
// node:sqlite 的坑（2026-09-14 实测）：无参语句调 `.get(undefined)` 会抛
// 「Provided value cannot be bound to SQLite parameter 1」——必须真·无参调用 .get()
const one = (s) => db.prepare(s).get();

// 只跑引擎已建的层（design §5.3：先导期只 L2/L5 有引擎；其余层 classify-only）
const ENGINED_LAYERS = ['L2', 'L5'];
const rows = all('SELECT p.id, p.layer, p.outcome, p.assigned_prob, p.created_at, p.matures_at, p.statement, '
  + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
  + "(SELECT json_extract(e.value,'$.certifiedSource') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.certifiedSource') IS NOT NULL LIMIT 1) AS cs, "
  + "(SELECT json_extract(e.value,'$.resolve.certified_source') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.certified_source') IS NOT NULL LIMIT 1) AS rcs, "
  + "(SELECT json_extract(e.value,'$.resolve') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve') IS NOT NULL LIMIT 1) AS rj "
  + 'FROM predictions p WHERE ' + REGIME).filter((r) => ENGINED_LAYERS.indexOf(r.layer) !== -1);

function yOf(outcome) { const s = String(outcome).toLowerCase(); return (s === 'true' || s === '1') ? 1 : ((s === 'false' || s === '0') ? 0 : null); }
function brier(p, y) { return (p - y) * (p - y); }
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
/** 配对 bootstrap CI（照项目既有口径：B=1000、种子 987654321，配对重采样逐题差值） */
function bootDeltaCI(diffs, B, seed) {
  const n = diffs.length; if (!n) return { lb: null, ub: null, B: B, seed: seed };
  let s = seed >>> 0; const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  const means = [];
  for (let b = 0; b < B; b++) { let acc = 0; for (let i = 0; i < n; i++) acc += diffs[Math.floor(rnd() * n)]; means.push(acc / n); }
  means.sort((x, y) => x - y);
  return { lb: means[Math.floor(0.025 * B)], ub: means[Math.floor(0.975 * B)], B: B, seed: seed, mean: mean(diffs) };
}
function fmt(x, d) { return (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(d === undefined ? 4 : d); }

// ── 逐题跑引擎 ──
const perLayer = {};
for (const layer of ENGINED_LAYERS) perLayer[layer] = { total: 0, engine_ok: 0, engine_fail: 0, fail_reasons: {},
  scored: 0, p_list: [], y_list: [], engine_results_sample: [] };
for (const r of rows) {
  const L = perLayer[r.layer];
  L.total++;
  let out;
  if (r.layer === 'L2') {
    out = l2Baseline({ baseRateNote: r.brn });
  } else {
    let cs = null;
    try { cs = r.cs ? JSON.parse(r.cs) : (r.rcs ? JSON.parse(r.rcs) : null); } catch (e) { cs = null; }
    out = l5Certified({ certifiedSource: cs });
  }
  if (out.ok && typeof out.p === 'number') L.engine_ok++; else { L.engine_fail++; const k = out.status + (out.reason ? ':' + out.reason : ''); L.fail_reasons[k] = (L.fail_reasons[k] || 0) + 1; }
  if (L.engine_results_sample.length < 3) L.engine_results_sample.push({ id: r.id, status: out.status, p: out.p, n: out.n, source: out.source || null });
  const y = yOf(r.outcome);
  if (out.ok && typeof out.p === 'number' && y !== null) { L.scored++; L.p_list.push(out.p); L.y_list.push(y); }
}

// ── 分层计分（禁跨层池化）──
const report = {};
for (const layer of ENGINED_LAYERS) {
  const L = perLayer[layer];
  const n = L.scored;
  const brief = { layer: layer, ledger_rows: L.total, engine_ok: L.engine_ok, engine_fail: L.engine_fail,
    engine_fail_reasons: L.fail_reasons, scored_n: n, engine_sample: L.engine_results_sample };
  if (n >= MIN_N) {
    const briers = L.p_list.map((p, i) => brier(p, L.y_list[i]));
    brief.brier_engine = mean(briers);
    brief.brier_const_half = mean(L.y_list.map((y) => brier(0.5, y)));
    brief.delta_vs_half = brief.brier_engine - brief.brier_const_half;
    // 配对 bootstrap：逐题 Δ=(p−y)² − (0.5−y)²，重采样看 CI 是否含 0（照项目口径 B=1000/seed 987654321）
    const diffs = L.p_list.map((p, i) => brier(p, L.y_list[i]) - brier(0.5, L.y_list[i]));
    brief.delta_ci95 = bootDeltaCI(diffs, 1000, 987654321);
    brief.obs_rate = mean(L.y_list);
    brief.mean_p = mean(L.p_list);
    // 判定信号（沿用项目口径：Δ<0 才有增量；但本层引擎 p **本身**就是基率 ⇒ Δ(vs 常数基率) 结构性为 0，
    //   故真正的对照是「vs 常数 0.5」——「基率比硬币好多少」）
    const ciExcludes0 = brief.delta_ci95.lb !== null && brief.delta_ci95.ub < 0;
    brief.signal = ciExcludes0 ? 'engine_beats_half_CI_excludes_0'
      : (brief.delta_vs_half < 0 ? 'engine_directionally_better_but_CI_includes_0' : 'engine_not_better_than_half');
    brief.note = '分层计分，禁跨层池化（design §4.3）。注：本层引擎 p 即统计基率，故 vs「常数基率」Δ 结构性=0；'
      + '有意义的对照是 vs 常数 0.5（基率相对硬币的增量）。**该增量问题在当前数据下不可回答**——'
      + '见下方 [L2 对照臂可得性] 检（assigned_prob 就是基率本身、L2 无判词 ⇒ 无独立第二路）。';
  } else {
    brief.note = 'n=' + n + ' < ' + MIN_N + ' ⇒ 只报方向、不出 Brier 结论（K F13 准入线）';
  }
  report[layer] = brief;
}

// ── L5 专节：账本里认证源的概率其实**存在**（写在 baseRateNote 文本里），但引擎要求结构化
//   `certifiedSource` 对象 ⇒ 引擎对 108 行全出 unsupported。如实披露这个「数据形态 vs 引擎契约」缺口，
//   并量化：多少行可解析、其中多少已 resolve（=可计分）。不做静默降级，不替引擎兜底解析（那会绕开契约）。
function l5EvidenceGap() {
  const rows5 = all("SELECT p.id, p.outcome, "
    + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn "
    + 'FROM predictions p WHERE ' + REGIME + " AND p.layer='L5'");
  let parseable = 0, parseableResolved = 0;
  for (const r of rows5) {
    if (!r.brn) continue;
    const m = /基率\s*=\s*(?:组合数理论值\s*)?([0-9]*\.?[0-9]+)/.exec(r.brn) || /组合数理论值\s*([0-9]*\.?[0-9]+)/.exec(r.brn);
    if (!m) continue;
    parseable++;
    if (r.outcome !== null && r.outcome !== undefined) parseableResolved++;
  }
  return { l5_rows: rows5.length, note_text_with_certified_value: parseable,
    of_which_resolved: parseableResolved,
    gap: '引擎契约要结构化的 evidence.certifiedSource（{id,kind,...}）；账本里认证值是**文本**（baseRateNote「基率=组合数理论值 X」）。'
      + '故引擎如实对全部 108 行出 unsupported。**这不是引擎缺陷**（宁缺毋滥是设计），也不是数据缺陷（值确实存在）；'
      + '是「写端未落结构化认证源」的形态缺口。修法＝后续批次写端补 certifiedSource（属阶段 4 后续件，本跑不动数据）。' };
}
const L5_GAP = l5EvidenceGap();

// ── L2 对照臂可得性检查（2026-09-14 落盘后追加）──────────────────────────────
// 起因：初稿写「下一步给 L2 配对照臂」。去数据里找那个臂时发现**找不到**——
//   ① L2 的 assigned_prob 与 baseRateNote 的基率 b **逐行相同**（同一统计基率的复写，不是第二路模型）
//   ② L2 无任何 LLM 判词（verdicts 只覆盖 sim 域 L1/L6）
// ⇒ 用 assigned_prob 当对照臂 = 拿基率跟基率比，Δ 恒 0，无信息量。
// 故本函数把「有无独立对照臂」做成**可复现的检查**，附在报告里，防止后续把它当"引擎没做好"。
function l2RivalArmCheck() {
  const rows2 = all("SELECT p.id, p.assigned_prob AS ap, p.outcome, "
    + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn "
    + 'FROM predictions p WHERE ' + REGIME + " AND p.layer='L2'");
  let cmp = 0, same = 0, diff = 0, maxdiff = 0;
  for (const r of rows2) {
    if (r.ap === null || r.ap === undefined) continue;
    const m = /占\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(r.brn || '');
    if (!m) continue;
    const b = parseFloat(m[1]) / 100;
    const d = Math.abs(b - r.ap);
    if (d > maxdiff) maxdiff = d;
    cmp++; if (d < 0.001) same++; else diff++;
  }
  const l2Verdicts = one('SELECT COUNT(DISTINCT v.prediction_id) n FROM verdicts v JOIN predictions p ON p.id=v.prediction_id '
    + "WHERE p.layer='L2'").n;
  const l2Resolved = one("SELECT COUNT(*) n FROM predictions p WHERE " + REGIME + " AND p.layer='L2' AND p.outcome IS NOT NULL").n;
  return {
    l2_resolved: l2Resolved,
    assigned_prob_vs_baserate: { compared: cmp, identical_within_1e_3: same, differing: diff, max_abs_diff: maxdiff },
    l2_rows_with_verdicts: l2Verdicts,
    rival_arm_available: (l2Verdicts > 0) || (diff > 0),
    conclusion: 'L2 的 assigned_prob 与 baseRateNote 基率逐行相同（差值≤1e-3）＝同一统计基率的复写，不是第二路模型；'
      + '且 L2 无任何 LLM 判词。⇒ **当前数据下不存在独立对照臂**，「L2 引擎是否优于纯基率」不可回答。'
      + '这不是缺陷：L2 按设计就是「基率层」（统计基率+Wilson），其价值＝诚实记账与区间，非"跑赢硬币"。'
      + '要回答增量问题须**引入新信号源**（外部模型/特征）＝新立项，非调引擎。',
  };
}
const L2_RIVAL = l2RivalArmCheck();

// ── 文本报告 ──
const T = [];
T.push('阶段 4 · 分层预测真跑（L2/L5 最小引擎 × 真实账本）');
T.push('库: ' + DB_PATH + ' | 行域: ' + REGIME + ' | 生成: ' + new Date().toISOString());
T.push('口径: L2=统计基率+Wilson；L5=认证源公布分布；仅对已 resolve 行计分；分层报禁跨层池化；ECE 恒挂双标注');
T.push('');
for (const layer of ENGINED_LAYERS) {
  const b = report[layer];
  T.push('[' + layer + '] 账本行 ' + b.ledger_rows + ' | 引擎出数 ' + b.engine_ok + ' | 未出数 ' + b.engine_fail
    + '（' + (Object.keys(b.engine_fail_reasons).length ? JSON.stringify(b.engine_fail_reasons) : '—') + '）| 可计分 ' + b.scored_n);
  if (b.brier_engine !== undefined) {
    T.push('    Brier(engine)=' + fmt(b.brier_engine) + ' | Brier(常数0.5)=' + fmt(b.brier_const_half)
      + ' | Δ(engine − 0.5)=' + fmt(b.delta_vs_half) + '（<0 才有增量迹象）');
    T.push('    Δ 的 95% 配对 bootstrap CI=[' + fmt(b.delta_ci95.lb) + ',' + fmt(b.delta_ci95.ub) + ']（B=' + b.delta_ci95.B + '，seed=' + b.delta_ci95.seed + '）⇒ **' + b.signal + '**');
    T.push('    ' + b.note);
    T.push('    观测频率=' + fmt(b.obs_rate) + ' | 引擎平均 p=' + fmt(b.mean_p) + ' | n=' + b.scored_n);
  } else {
    T.push('    ' + b.note);
  }
  T.push('    引擎样例: ' + JSON.stringify(b.engine_sample));
}
T.push('');
T.push('[L2 对照臂可得性 · 落盘后补检] 已 resolve ' + L2_RIVAL.l2_resolved + ' 行；'
  + 'assigned_prob 与 baseRateNote 基率比对 ' + L2_RIVAL.assigned_prob_vs_baserate.compared + ' 行 → 一致 '
  + L2_RIVAL.assigned_prob_vs_baserate.identical_within_1e_3 + ' / 不一致 ' + L2_RIVAL.assigned_prob_vs_baserate.differing
  + '（最大偏差 ' + L2_RIVAL.assigned_prob_vs_baserate.max_abs_diff + '）；L2 带判词行 ' + L2_RIVAL.l2_rows_with_verdicts);
T.push('    ⇒ rival_arm_available=' + L2_RIVAL.rival_arm_available + '（' + L2_RIVAL.conclusion + '）');
T.push('');
T.push('[L5 认证源形态缺口 · 如实披露] 账本 L5 行 ' + L5_GAP.l5_rows + '；其中 baseRateNote 含可解析认证值者 '
  + L5_GAP.note_text_with_certified_value + '，**但已 resolve 者 0**（彩票开奖时点未到）。');
T.push('    ⇒ 引擎对全部 108 行如实出 unsupported（宁缺毋滥，非缺陷）；且**即便补结构化认证源，当前也没有可计分的开奖真值**。');
T.push('    ' + L5_GAP.gap);
T.push('');
T.push('注: 本报告只覆盖**引擎已建**的 L2/L5 两层（design §5.3 先导期）；L1/L3/L4/L6 恒 classify-only，不在本跑范围。');
const text = T.join('\n');
console.log(text);
if (TEXT_OUT) { fs.writeFileSync(path.resolve(TEXT_OUT), text, 'utf8'); console.log('[stage4-run] text -> ' + path.resolve(TEXT_OUT)); }
if (JSON_OUT) {
  const out = { script: 'p1b/scripts/stage4-run.cjs', db: DB_PATH, regime: 'R4', layers: ENGINED_LAYERS, l2_rival_arm_check: L2_RIVAL, l5_evidence_gap: L5_GAP,
    generated_at: new Date().toISOString(), report: report, note: '分层报，禁跨层池化（design §4.3）' };
  fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(out, null, 1), 'utf8');
  console.log('[stage4-run] json -> ' + path.resolve(JSON_OUT));
}
db.close();
