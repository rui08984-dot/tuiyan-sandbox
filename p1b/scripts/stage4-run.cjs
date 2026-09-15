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
const { l2Baseline, parseBaseRateNote } = require(path.join(ROOT, 'p1b/src/engines/l2_baseline'));
const { l5Certified } = require(path.join(ROOT, 'p1b/src/engines/l5_certified'));
const { certifiedSourceForRow } = require(path.join(ROOT, 'p1b/src/engines/l5_sources')); // 2026-09-14：L5 认证源读侧结构化（按 kind 组合数重建）
const { l3Aci, aciReplay } = require(path.join(ROOT, 'p1b/src/engines/l3_aci')); // 2026-09-14：L3 引擎（stat_baseline + ACI）
const { procCalc } = require(path.join(ROOT, 'p1b/src/engines/l1_proc')); // 2026-09-14：L1 引擎（proc_calc 程序复算）
const { l6Structural } = require(path.join(ROOT, 'p1b/src/engines/l6_structural')); // 2026-09-14：L6 引擎（判词结构聚合＝狼人杀线接入）
const baseRateMod = require(path.join(ROOT, 'p1b/src/evidence/baseRate')); // 批次 3：基率解析/结构化读数的单一真源
const domainMod = require(path.join(ROOT, 'p1b/src/evidence/domain')); // 2026-09-15：域派生单一真源（design §4.2.5 A 轴；阶段 4 出口「分域读数」）

/** 批次 3：行内结构化基率（evidence.baseRate；旧行无此键 ⇒ null ⇒ 三引擎一律退文本兜底，读数不变）。 */
function baseRateOf(r) {
  if (!r || !r.brs) return null;
  try { const o = JSON.parse(r.brs); return baseRateMod.isStructured(o) ? o : null; } catch (e) { return null; }
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const all = (s) => db.prepare(s).all();
// node:sqlite 的坑（2026-09-14 实测）：无参语句调 `.get(undefined)` 会抛
// 「Provided value cannot be bound to SQLite parameter 1」——必须真·无参调用 .get()
const one = (s) => db.prepare(s).get();

// 只跑引擎已建的层（design §5.3：先导期只 L2/L5 有引擎；其余层 classify-only）
// 2026-09-14：L3 引擎（stat_baseline+ACI）＋ L1 引擎（proc_calc）落地 ⇒ 加入真跑
const ENGINED_LAYERS = ['L1', 'L2', 'L3', 'L5', 'L6'];
// 2026-09-15（用户裁定「丙：排除出池」）：**真值口径缺陷**行（resolved_at<事件日 ∧ resolve 含 forecast）
// 不进分层计分 —— 其「真值」取自当时预报值，非实际观测（Q0-2 时点不成立）。
// 依据 docs/specs/阶段5-检索可行性勘察-20260915.md §六；判据单一真源 p1b/src/evidence/truthBasis.js。
const truthBasisMod = require(path.join(ROOT, 'p1b/src/evidence/truthBasis'));
const NOT_TB_DEFECT = truthBasisMod.NOT_TRUTH_BASIS_DEFECT_SQL();
const rows = all('SELECT p.id, p.game_id, p.layer, p.outcome, p.assigned_prob, p.created_at, p.matures_at, p.statement, '
  + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
  + "(SELECT json_extract(e.value,'$.baseRate') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRate') IS NOT NULL LIMIT 1) AS brs, "
  + "(SELECT json_extract(e.value,'$.certifiedSource') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.certifiedSource') IS NOT NULL LIMIT 1) AS cs, "
  + "(SELECT json_extract(e.value,'$.resolve.certified_source') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.certified_source') IS NOT NULL LIMIT 1) AS rcs, "
  + "(SELECT json_extract(e.value,'$.resolve') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve') IS NOT NULL LIMIT 1) AS rj, "
  // 2026-09-15 分域读数（additive）：域派生的两个兜底来源——题源批类型 evidence[0].kind ＋ 对局域 games.game_type
  + "(SELECT json_extract(e.value,'$.kind') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.kind') IS NOT NULL LIMIT 1) AS evk, "
  + 'g.game_type AS gtype '
  + 'FROM predictions p LEFT JOIN games g ON g.id = p.game_id WHERE ' + REGIME + ' AND ' + NOT_TB_DEFECT).filter((r) => ENGINED_LAYERS.indexOf(r.layer) !== -1);
const TB_DEFECT_EXCLUDED = one('SELECT COUNT(*) n FROM predictions p WHERE ' + REGIME + ' AND NOT ' + NOT_TB_DEFECT).n;

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
  scored: 0, p_list: [], y_list: [], prior_list: [], engine_results_sample: [] };
// 2026-09-15 分域读数（additive；路线图阶段 4 出口「分域带校准分数」，域规则见 p1b/src/evidence/domain.js）：
//   按 `layer × 域` 收 p/y 对，供报告给出**每域**的 Brier/覆盖率；**不改任何既有层的数字**。
const perDom = {};   // key = layer + '\u0000' + domain
const domBasis = {}; // 域派生来源计数（如实披露：resolve_kind / evidence_kind / game_type / none）
function domBucket(layer, domain) {
  const k = layer + '\u0000' + domain;
  if (!perDom[k]) perDom[k] = { layer: layer, domain: domain, total: 0, engine_ok: 0, scored: 0, p_list: [], y_list: [] };
  return perDom[k];
}
// L5 认证源来源统计（2026-09-14 读侧结构化后）：structured=写端已给；read_side=读侧注册表重建；none=两路皆无
const L5_SRC = { structured: 0, read_side: 0, none: 0, note_consistent: 0, note_mismatch: 0, note_empirical: 0, note_absent: 0, mismatch_ids: [] };
// L1 复算所需的记录（只读；按局缓存）
const stEv = db.prepare('SELECT seq, day, phase, type, actor_seat, raw_text FROM events WHERE game_id = ? ORDER BY seq, id');
const stCl = db.prepare('SELECT e.day AS day, c.predicate AS predicate FROM claims c JOIN events e ON e.id = c.event_id WHERE e.game_id = ?');
const stPc = db.prepare('SELECT player_count FROM games WHERE id = ?');
const evCache = new Map(), clCache = new Map(), pcCache = new Map();
function eventsOf(gid) { if (!evCache.has(gid)) evCache.set(gid, stEv.all(gid)); return evCache.get(gid); }
function claimsOf(gid) { if (!clCache.has(gid)) clCache.set(gid, stCl.all(gid)); return clCache.get(gid); }
function pcOf(gid) { if (!pcCache.has(gid)) { const r = stPc.get(gid); pcCache.set(gid, r ? r.player_count : null); } return pcCache.get(gid); }
// L6 判词供给（只读；按题缓存）
const stV = db.prepare('SELECT id, prompt_variant, implied_prob FROM verdicts WHERE prediction_id = ? ORDER BY id');
const vCache = new Map();
function verdictsOf(pid) { if (!vCache.has(pid)) vCache.set(pid, stV.all(pid)); return vCache.get(pid); }

// L3 ACI 反馈序列（2026-09-14）：已解 L3 行按 id 时序**全局回放**（仅用于 α 适配与覆盖率披露；不影响 p/计分）
const L3_FEEDBACK = (() => {
  const rs = all("SELECT p.id, p.outcome, "
    + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
    + "(SELECT json_extract(e.value,'$.baseRate') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRate') IS NOT NULL LIMIT 1) AS brs "
    + 'FROM predictions p WHERE ' + REGIME + " AND p.layer='L3' AND p.outcome IS NOT NULL ORDER BY p.id");
  const fb = [];
  for (const r of rs) {
    const sBr = baseRateOf(r);
    if (sBr && sBr.n !== null && sBr.k !== null) { fb.push({ p: sBr.p, y: yOf(r.outcome) }); continue; } // 批次 3：结构化优先
    const parsed = parseBaseRateNote(String(r.brn || ''));
    if (!parsed) continue;
    fb.push({ p: parsed.p, y: yOf(r.outcome) });
  }
  return fb;
})();
const L3_ACI = Object.assign({ feedback_n: L3_FEEDBACK.length,
  basis: '已解 L3 行按 id 时序全局回放（仅披露；p 与计分不受影响）' }, aciReplay(L3_FEEDBACK));
for (const r of rows) {
  const L = perLayer[r.layer];
  L.total++;
  let out;
  if (r.layer === 'L1') {
    out = procCalc({ statement: r.statement, events: eventsOf(r.game_id), claims: claimsOf(r.game_id), playerCount: pcOf(r.game_id) });
  } else if (r.layer === 'L2') {
    out = l2Baseline({ baseRate: baseRateOf(r), baseRateNote: r.brn });
  } else if (r.layer === 'L3') {
    out = l3Aci({ baseRate: baseRateOf(r), baseRateNote: r.brn, feedback: L3_FEEDBACK });
  } else if (r.layer === 'L6') {
    out = l6Structural({ verdicts: verdictsOf(r.id) });
  } else {
    let cs = null;
    try { cs = r.cs ? JSON.parse(r.cs) : (r.rcs ? JSON.parse(r.rcs) : null); } catch (e) { cs = null; }
    if (cs) L5_SRC.structured++;
    else {
      let rj = null;
      try { rj = r.rj ? JSON.parse(r.rj) : null; } catch (e) { rj = null; }
      const built = certifiedSourceForRow({ resolve: rj, baseRate: baseRateOf(r), baseRateNote: r.brn });
      if (built.ok) {
        cs = built.source; L5_SRC.read_side++;
        const kindN = built.meta.note_kind;
        if (kindN === 'certified_text') {
          if (built.meta.note_consistent) L5_SRC.note_consistent++;
          else {
            L5_SRC.note_mismatch++;
            if (L5_SRC.mismatch_ids.length < 10) L5_SRC.mismatch_ids.push({ id: r.id, kind: built.meta.kind, p_registry: built.meta.p, p_note: built.meta.note_p });
          }
        } else if (kindN === 'empirical_pct') L5_SRC.note_empirical++;
        else L5_SRC.note_absent++;
      } else { L5_SRC.none++; }
    }
    out = l5Certified({ certifiedSource: cs });
  }
  if (out.ok && typeof out.p === 'number') L.engine_ok++; else { L.engine_fail++; const k = out.status + (out.reason ? ':' + out.reason : ''); L.fail_reasons[k] = (L.fail_reasons[k] || 0) + 1; }
  if (L.engine_results_sample.length < 3) L.engine_results_sample.push({ id: r.id, status: out.status, p: out.p, n: out.n, source: out.source || null });
  const y = yOf(r.outcome);
  if (out.ok && typeof out.p === 'number' && y !== null) { L.scored++; L.p_list.push(out.p); L.y_list.push(y);
    L.prior_list.push(Number.isFinite(Number(r.assigned_prob)) ? Number(r.assigned_prob) : null); }
  // 2026-09-15 分域（additive）：域派生（resolve.kind → evidence.kind → game_type → (unknown)）
  let rjObj = null; try { rjObj = r.rj ? JSON.parse(r.rj) : null; } catch (e) { rjObj = null; }
  const dd = domainMod.deriveDomain({ resolve: rjObj, evKind: r.evk, gameType: r.gtype });
  domBasis[dd.basis] = (domBasis[dd.basis] || 0) + 1;
  const DB_ = domBucket(r.layer, dd.domain);
  DB_.total++;
  if (out.ok && typeof out.p === 'number') DB_.engine_ok++;
  if (out.ok && typeof out.p === 'number' && y !== null) { DB_.scored++; DB_.p_list.push(out.p); DB_.y_list.push(y); }
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
    // 账本先验对照（2026-09-14）：assigned_prob＝创建时记录的先验（**非本引擎输出**）——全非空才给对照
    if (L.prior_list.length === n && L.prior_list.every((x) => x !== null)) {
      brief.brier_ledger_prior = mean(L.prior_list.map((q, i) => brier(q, L.y_list[i])));
      brief.delta_vs_ledger_prior = brief.brier_engine - brief.brier_ledger_prior;
    } else { brief.brier_ledger_prior = null; brief.delta_vs_ledger_prior = null; }
    // 判定信号（沿用项目口径：Δ<0 才有增量；但本层引擎 p **本身**就是基率 ⇒ Δ(vs 常数基率) 结构性为 0，
    //   故真正的对照是「vs 常数 0.5」——「基率比硬币好多少」）
    const ciExcludes0 = brief.delta_ci95.lb !== null && brief.delta_ci95.ub < 0;
    if (layer === 'L6') {
      // L6 对抗层（2026-09-14 接线）：p＝判词结构聚合（固定规则）。**本层是真读数**（判词含信息），
      //   与 L1/L3/L5 的"平凡读数"不同；披露：①聚合既有判词（非新模型）②多跑/旧行 provenance。
      brief.signal = ciExcludes0 ? 'aggregate_beats_half_CI_excludes_0'
        : (brief.delta_vs_half < 0 ? 'aggregate_directionally_better_CI_includes_0' : 'aggregate_not_better_than_half');
      brief.note = 'L6 对抗层＝狼人杀/对抗域**首批真读数**：p＝判词结构聚合（每变体取最新非空 implied_prob 再求均值，固定规则）。'
        + '与 L1/L3/L5 的"平凡读数"不同，这里 vs 0.5 的 Δ 是**实际信息量**；但须披露：①聚合的是**既有判词**（不是新模型），'
        + '②判词多跑（每变体取最新）与旧行 provenance（run_id=null）为披露项；更严的对照见「账本先验」行（assigned_prob＝创建时记录的先验）。';
    } else if (layer === 'L1') {
      // L1 决定论层（2026-09-14 接线）：引擎=程序复算（proc_calc，6 条规则族），输出 0/1 计算结论。
      brief.signal = 'proc_calc_deterministic';
      brief.accuracy = (brief.brier_engine === undefined || brief.brier_engine === null) ? null : Number((1 - brief.brier_engine).toFixed(6));
      brief.note = 'L1 决定论层：**本层 Brier 语义＝计算错误率**（design §1.5），不与概率层混比；'
        + 'vs 常数 0.5 的 Δ 在此层无概率含义（仅记录，不构成任何"更准"宣称）。accuracy = 1 − 错误率。';
    } else if (layer === 'L5') {
      // L5 专属口径（2026-09-14）：引擎 p 即认证源公布分布，vs 0.5 的 Δ 只反映「事件基率偏离 50%」，
      //   不构成任何「更准」宣称（L5 铁律：显著优于认证源＝泄漏信号，非本事）。信号名中性化。
      brief.signal = ciExcludes0 ? 'delta_vs_half_negative_CI_excludes_0'
        : (brief.delta_vs_half < 0 ? 'delta_vs_half_negative_CI_includes_0' : 'delta_vs_half_not_negative');
      brief.note = 'L5：引擎 p 即认证源公布分布（本层按定义「无信息优势可学」）。vs 常数 0.5 的 Δ 只反映事件基率偏离 50%'
        + '（本批彩票事件 p≈0.17–0.63）——**不构成任何"更准/有本事"宣称**：L5 铁律，显著优于认证源＝泄漏信号，不是本事。'
        + '本层有意义的读数＝**校准**（观测频率 vs 引擎平均 p，当前样本小、仅披露）；开奖真值持续到达后读数自然增长。';
    } else if (layer === 'L3') {
      // L3 专属口径（2026-09-14）：p 与 L2 同源（基率）；ACI 只调预测集与覆盖率披露、不调 p ⇒ Δ(vs 0.5) 同为平凡读数。
      brief.signal = ciExcludes0 ? 'delta_vs_half_negative_CI_excludes_0'
        : (brief.delta_vs_half < 0 ? 'delta_vs_half_negative_CI_includes_0' : 'delta_vs_half_not_negative');
      brief.note = 'L3 短窗混沌：p=基率（与 L2 同源解析/Wilson 口径），**ACI 只调预测集与覆盖率披露、不调 p**。'
        + 'vs 常数 0.5 的 Δ 只反映「基率相对 50% 的贴合程度」——**若 Δ<0 且 CI 不含 0，也属边缘读数，不构成可声称的"更准"**'
        + '（引擎 p 即基率、无第二路信号；同 L2 层结论：该增量问题须引入新信号源才算数）。'
        + '本层有意义的读数＝**ACI 覆盖率 vs 名义水平**（见 [L3 ACI] 节）；短窗检验（时界）留待后续。';
    } else {
      brief.signal = ciExcludes0 ? 'engine_beats_half_CI_excludes_0'
        : (brief.delta_vs_half < 0 ? 'engine_directionally_better_but_CI_includes_0' : 'engine_not_better_than_half');
      brief.note = '分层计分，禁跨层池化（design §4.3）。注：本层引擎 p 即统计基率，故 vs「常数基率」Δ 结构性=0；'
        + '有意义的对照是 vs 常数 0.5（基率相对硬币的增量）。**该增量问题在当前数据下不可回答**——'
        + '见下方 [L2 对照臂可得性] 检（assigned_prob 就是基率本身、L2 无判词 ⇒ 无独立第二路）。';
    }
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
      + '**2026-09-14 修（读侧）**：新增 `p1b/src/engines/l5_sources.js` 按 resolve.kind 从**组合数精确值**重建认证分布，'
      + '并与文本可解析数值交叉核对（不一致如实标记、不静默）；**账本零改动、写端零改动**。'
      + '写端补结构化 certifiedSource 仍留待与 F4 真值分库同批迁移（届时本注册表自动退居兜底）。' };
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
    if (b.brier_ledger_prior !== null && b.brier_ledger_prior !== undefined) {
      T.push('    账本先验对照: Brier(assigned_prob)=' + fmt(b.brier_ledger_prior) + ' | Δ(engine − 先验)=' + fmt(b.delta_vs_ledger_prior)
        + '（先验＝创建时记录，非本引擎输出）');
    }
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
T.push('[L5 认证源 · 读侧结构化（2026-09-14）] 账本 L5 行 ' + L5_GAP.l5_rows + '：写端结构化 certifiedSource ' + L5_SRC.structured
  + ' 行；**读侧注册表重建 ' + L5_SRC.read_side + ' 行**（按 resolve.kind 的组合数精确值，`p1b/src/engines/l5_sources.js`）；两路皆无 ' + L5_SRC.none + ' 行。');
T.push('    与文本交叉核对：认证值声明一致 ' + L5_SRC.note_consistent + ' ｜ **认证值声明不一致 ' + L5_SRC.note_mismatch + '**'
  + ' ｜ 文本为历史频率 ' + L5_SRC.note_empirical + '（与认证值不同属预期，非矛盾）｜ 无文本 ' + L5_SRC.note_absent
  + (L5_SRC.note_mismatch ? '（不一致样本 ' + JSON.stringify(L5_SRC.mismatch_ids) + '）' : ''));
T.push('    已可计分 ' + (report.L5 && report.L5.scored_n !== undefined ? report.L5.scored_n : 0) + ' 行（开奖真值随时间到达；本修后**到达即可自动计分**）。');
T.push('    ' + L5_GAP.gap);
T.push('');
T.push('[L1 复算正确率] ' + (report.L1 && report.L1.accuracy !== null && report.L1.accuracy !== undefined ? report.L1.accuracy : 'n/a')
  + '（= 1 − Brier；本层语义＝计算错误率，design §1.5）｜ 规则族 6 条（proc_calc：首夜平安/票差≤1/无弃票/最高票≥4/day1 声称≥10/最高票唯一）');
T.push('[L3 ACI · 全局回放] 反馈 ' + L3_ACI.feedback_n + ' 条（已解 L3 按 id 时序）｜ α*=' + L3_ACI.alpha_star + ' γ=' + L3_ACI.gamma
  + ' ⇒ α_final=' + L3_ACI.alpha_final + '｜ 实测覆盖 ' + (L3_ACI.coverage ? L3_ACI.coverage.rate : 'n/a')
  + '（名义 ' + (1 - L3_ACI.alpha_star) + '）｜ EWMA 覆盖 ' + (L3_ACI.ewma_coverage === null ? 'n/a' : L3_ACI.ewma_coverage));
T.push('    ' + L3_ACI.basis + '；ACI 只影响预测集与披露，**不调 p**（L3 点估计恒为基率）。');
T.push('注: 本报告覆盖**引擎已建**的 L1/L2/L3/L5/L6 五层（design §5.3：L4 为后置叠加标注层、按设计不出数，不在本跑范围）。');
T.push('注: **真值口径缺陷排除 ' + TB_DEFECT_EXCLUDED + ' 行**（resolved_at<事件日 ∧ resolve 含 forecast ⇒ 真值取自当时预报值，Q0-2 时点不成立；'
  + '零账本写／读取侧排除，用户 2026-09-15 裁定「丙」；判据 p1b/src/evidence/truthBasis.js，指纹 '
  + String(truthBasisMod.DEFECT_FINGERPRINT_SHA256).slice(0, 16) + '…）。');

// ── 分域读数（2026-09-15 新增；additive，不改上层任何数字）──
// 依据：路线图阶段 4 出口「出口＝**分域**带校准分数的预测能力，每域拿数据说话」；
//   域规则＝design §4.2.5 A 轴「题源 kind 族，前缀归一」，单一真源 p1b/src/evidence/domain.js。
// 纪律：与分层同款——**n<30 的格子只记方向、不下结论**（design §4.3 第 3 条）；禁跨域池化成"总体读数"。
const DOM_MIN_N = MIN_N;
const domRows = Object.keys(perDom).map((k) => {
  const b = perDom[k];
  const n = b.scored;
  const r = { layer: b.layer, domain: b.domain, ledger_rows: b.total, engine_ok: b.engine_ok, scored_n: n };
  if (n > 0) r.obs_rate = mean(b.y_list);
  if (n >= DOM_MIN_N) {
    r.brier_engine = mean(b.p_list.map((p, i) => brier(p, b.y_list[i])));
    r.brier_const_half = mean(b.y_list.map((y) => brier(0.5, y)));
    r.delta_vs_half = r.brier_engine - r.brier_const_half;
    const diffs = b.p_list.map((p, i) => brier(p, b.y_list[i]) - brier(0.5, b.y_list[i]));
    r.delta_ci95 = bootDeltaCI(diffs, 1000, 987654321);
    r.mean_p = mean(b.p_list);
    r.conclusion_allowed = true;
  } else {
    r.conclusion_allowed = false;   // n<30 ⇒ 只记方向（设计 §4.3-3）
    r.note = 'n=' + n + ' < ' + DOM_MIN_N + ' ⇒ 样本不足·仅记方向，不出结论';
  }
  return r;
}).sort((a, b) => (a.layer === b.layer ? b.scored_n - a.scored_n : (a.layer < b.layer ? -1 : 1)));
const domWithConclusion = domRows.filter((x) => x.conclusion_allowed);
const domThin = domRows.filter((x) => !x.conclusion_allowed);
T.push('');
T.push('[分域读数] 域规则＝题源 kind 族（前缀归一；`p1b/src/evidence/domain.js`）｜ 派生来源 '
  + JSON.stringify(domBasis) + ' ⇒ 域共 ' + domRows.length + ' 格，其中 **n≥' + DOM_MIN_N + ' 可出结论 ' + domWithConclusion.length
  + ' 格、样本不足（仅记方向）' + domThin.length + ' 格');
T.push('    ⚠ 纪律：格与格之间**禁池化**（同分层：禁跨基率比 Brier，比一律用 Δ 或 resolution）；n<' + DOM_MIN_N + ' 的格**不出结论**。');
for (const d of domRows) {
  if (d.conclusion_allowed) {
    T.push('    ' + d.layer + ' · ' + d.domain.padEnd(18) + ' n=' + String(d.scored_n).padStart(4)
      + '  base=' + fmt(d.brier_engine) + '  Δ(vs 0.5)=' + fmt(d.delta_vs_half) + '  CI=[' + fmt(d.delta_ci95.lb) + ',' + fmt(d.delta_ci95.ub) + ']'
      + '  观测率=' + fmt(d.obs_rate) + '');
  } else {
    T.push('    ' + d.layer + ' · ' + d.domain.padEnd(18) + ' n=' + String(d.scored_n).padStart(4) + '  （样本不足·仅记方向）');
  }
}
T.push('    注：本表是**读数完整度**的披露——它同时说明「每个域现在能不能拿数据说话」；多数格偏薄属**数据量**而非口径问题（详见勘察结论）。');
T.push('');

const text = T.join('\n');
console.log(text);
if (TEXT_OUT) { fs.writeFileSync(path.resolve(TEXT_OUT), text, 'utf8'); console.log('[stage4-run] text -> ' + path.resolve(TEXT_OUT)); }
if (JSON_OUT) {
  const out = { script: 'p1b/scripts/stage4-run.cjs', db: DB_PATH, regime: 'R4', layers: ENGINED_LAYERS, l2_rival_arm_check: L2_RIVAL, l5_evidence_gap: L5_GAP,
    truth_basis_defect_excluded_rows: TB_DEFECT_EXCLUDED,
    truth_basis_defect_fingerprint: truthBasisMod.DEFECT_FINGERPRINT_SHA256,
    l5_source_resolution: JSON.parse(JSON.stringify(L5_SRC)), l3_aci: L3_ACI,
    // 2026-09-15 分域读数（additive）：域派生来源 ＋ 逐格读数（n<30 标 conclusion_allowed=false）
    domain_rule: { source: 'p1b/src/evidence/domain.js', basis: 'resolve.kind → evidence.kind → games.game_type → (unknown)，前缀归一（design §4.2.5 A 轴）' },
    domain_basis_counts: domBasis,
    domain_min_n: DOM_MIN_N,
    domain_cells_total: domRows.length,
    domain_cells_with_conclusion: domWithConclusion.length,
    domain_cells_thin: domThin.length,
    by_domain: domRows,
    generated_at: new Date().toISOString(), report: report, note: '分层报，禁跨层池化（design §4.3）；已排除真值口径缺陷行（见 truth_basis_defect_*）；分域读数见 by_domain（格间禁池化，n<30 不出结论）' };
  fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(out, null, 1), 'utf8');
  console.log('[stage4-run] json -> ' + path.resolve(JSON_OUT));
}
db.close();
