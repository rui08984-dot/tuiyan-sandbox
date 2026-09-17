#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/a1-whatif.cjs —— A1 假设重算器 **完整版 v1**（2026-09-17 · 第 3 期首选票，蓝图 §2.3-1／11 号件 §6）
 *
 * 定位＝「如果…会怎样」的**只读 what-if 重算**：给定一条**显式假设改动**，只重跑**机械引擎**（零 LLM），
 *   输出 **Δ 读数对比报告**。是 v0（`assumption-recalc.cjs`，格子级加权扣除、**不重算 CI**）的补齐：
 *   v1 在**逐题**层面重算 ⇒ **可给 bootstrap CI**（v0 自述的缺口）。
 *
 * 依据（唯一）：11 号件 §6「反事实半——降格收编为假设重算器」：
 *   · 输入＝一条冻结 prediction 行＋一个显式假设改动（如「移除基率锚证据行」「改判某判词路缺席」）；
 *   · 操作＝只重跑机械引擎（零 LLM）；输出 Δ 读数对比；
 *   · 禁令＝**不模拟世界状态／不产新概率进账本／输出一律标注「探索性 what-if 读数」／不进校准口径**；
 *   · 操作化判据＝「重算读数与原始读数的差**被如实披露**且**不回写账本**」＋**金样回放零读数变化**。
 *   ＋ 19 号裁剪执行记录 §2.2：**对内件也强制挂探索性标注**（防「对内件漂移成对外品」）。
 *
 * ★读数口径（显式声明；**单一实现**）：
 *   · 逐题引擎读数一律取自 `e2-combo-precheck.cjs::buildEngineMatrix()`（全引擎可用性矩阵；**禁写第二份**）；
 *   · 「本层读数」＝该题**自身层**引擎的输出（`eng[layer]`）；参照线＝常数 0.5（Brier 的恒等对照）；
 *   · 聚合＝Brier 均值（可计分题），CI＝**配对 bootstrap**（按题重采样、B=1000／seed=987654321／百分位法，
 *     复用 `lambda-overlap.cjs::bootCI` 同一实现）；
 *   · 本件**不声称复现 `stage4-run` 五层读数件**（后者按 gate/scored 细分、口径不同）——本件只出
 *     「**同一矩阵上**假设变更的相对差」。变更前/后的口径**完全同源**，故差值可比。
 *
 * 支持的三类假设（写死；未列出的假设**不支持**，不得外推）：
 *   1. `--whatif exclude --drop cell:L3/usgs[,cell:…|domain:…]` —— 排除题/格（**逐题**重算＋CI，补 v0 缺口）；
 *   2. `--whatif drop-baserate --where cell:L2/dbnomics[,…]` —— **移除基率锚**（该题在 L2/L3 侧不再出数，如实）；
 *   3. `--whatif drop-variant --variant v3_baserate` —— **判词路缺席**（L6 用 `l6Structural` 少一路重算，单一实现）。
 * 另有自检：`--whatif none` ⇒ 与基线**逐位一致**（金样回放零读数变化，蓝图判据）。
 *
 * 纪律：**零账本写**（库 readOnly）／**零 LLM**／**零网络**／`main()`＋`require.main` 守卫（require 零副作用）。
 * 用法：
 *   node p1b/scripts/a1-whatif.cjs --whatif none
 *   node p1b/scripts/a1-whatif.cjs --whatif exclude --drop cell:L3/usgs,domain:openmeteo
 *   node p1b/scripts/a1-whatif.cjs --whatif drop-baserate --where cell:L2/dbnomics
 *   node p1b/scripts/a1-whatif.cjs --whatif drop-variant --variant v3_baserate
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const OUT_DIR = path.resolve(arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out')));
const TAG = String(arg('tag', '')).trim();   // 可选：给读数件加后缀（多假设并存时不互相覆盖）
const WHATIF = String(arg('whatif', 'none')).trim();
const DROP = String(arg('drop', '')).trim();
const WHERE = String(arg('where', '')).trim();
const VARIANT = String(arg('variant', '')).trim();
const NB = Number(arg('boot', '1000'));
const SEED = Number(arg('seed', '987654321'));
const LAYERS = ['L1', 'L2', 'L3', 'L5', 'L6'];
const VARIANTS = ['v1_evidence', 'v2_skeptical', 'v3_baserate'];
const EXPLORATORY = '探索性 what-if 读数（不进校准口径、不进账本、不作任何能力宣称）';

// ── 纯函数区（可 require；零 IO） ───────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const brier = (p, y) => (p === null || p === undefined || y === null || y === undefined) ? null : (p - y) * (p - y);

/** 「格键」解析：`cell:L3/usgs` / `domain:openmeteo`（同一把尺：--drop 与 --where 共用）。 */
function parseKeys(s) {
  const out = [];
  for (const part of String(s || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (part.indexOf('cell:') === 0) { const b = part.slice(5).split('/'); out.push({ kind: 'cell', layer: b[0], domain: b[1] }); }
    else if (part.indexOf('domain:') === 0) out.push({ kind: 'domain', domain: part.slice(7) });
    else out.push({ kind: 'raw', raw: part });
  }
  return out;
}
function keyHits(item, keys) {
  for (const k of keys) {
    if (k.kind === 'cell' && item.layer === k.layer && item.domain === k.domain) return true;
    if (k.kind === 'domain' && item.domain === k.domain) return true;
  }
  return false;
}

/**
 * 逐层基线读数（纯函数）：只算**本层引擎出数**的题（`eng[layer]` 有限）；
 * 同时给参照线（常数 0.5）与 Δ（引擎 − 0.5），供 what-if 的差分。
 * @param {Array} items 矩阵题
 * @returns {{byLayer: Object, rows: Array}}
 */
function readingsOf(items) {
  const byLayer = {};
  const rows = [];
  for (const it of items) {
    const p = it.eng && it.eng[it.layer];
    if (p === null || p === undefined || !isFinite(p)) continue;
    if (it.y === null || it.y === undefined) continue;
    const b = brier(p, it.y), bh = brier(0.5, it.y);
    rows.push({ id: it.id, layer: it.layer, domain: it.domain, p: p, y: it.y, brier: b, brier_half: bh, delta_vs_half: b - bh });
  }
  for (const L of LAYERS) {
    const rs = rows.filter((r) => r.layer === L);
    byLayer[L] = { n: rs.length, brier: rs.length ? mean(rs.map((r) => r.brier)) : null,
      brier_half: rs.length ? mean(rs.map((r) => r.brier_half)) : null,
      delta_vs_half: rs.length ? mean(rs.map((r) => r.delta_vs_half)) : null };
  }
  const all = rows;
  byLayer.ALL = { n: all.length, brier: all.length ? mean(all.map((r) => r.brier)) : null,
    brier_half: all.length ? mean(all.map((r) => r.brier_half)) : null,
    delta_vs_half: all.length ? mean(all.map((r) => r.delta_vs_half)) : null };
  return { byLayer: byLayer, rows: rows };
}

/** 假设①排除：把命中 `keys` 的题**整行剔除**（逐题层面，可给 CI）。 */
function applyExclude(items, keys) {
  const kept = items.filter((it) => !keyHits(it, keys));
  return { items: kept, dropped: items.length - kept.length, note: '整行剔除（该题不再计入任何层）' };
}
/** 假设②移除基率锚：命中 `keys` 的题在 **L2/L3 侧不再出数**（其余引擎读数保留；如实、不补 0.5）。 */
function applyDropBaserate(items, keys) {
  let touched = 0;
  const out = items.map((it) => {
    if (!keyHits(it, keys)) return it;
    const eng = Object.assign({}, it.eng);
    let hit = false;
    for (const e of ['L2', 'L3']) if (eng[e] !== undefined) { delete eng[e]; hit = true; }
    if (hit) touched++;
    const keys2 = (it.keys || []).filter((k) => k !== 'L2' && k !== 'L3');
    return Object.assign({}, it, { eng: eng, keys: keys2, _baserate_removed: hit });
  });
  return { items: out, dropped: 0, touched: touched, note: '移除基率锚 ⇒ 命中题在 L2/L3 侧不再出数（读数**不补** 0.5，如实记「无输出」）' };
}
/** 假设③判词路缺席：用替换过的 L6 读数（由调用方以 l6Structural 单一实现算出）构造新矩阵。 */
function applyDropVariant(items, pByPid) {
  let touched = 0;
  const out = items.map((it) => {
    if (it.layer !== 'L6') return it;
    const v = pByPid[it.id];
    if (v === undefined) return it;
    touched++;
    const eng = Object.assign({}, it.eng);
    if (v === null) delete eng.L6; else eng.L6 = v;
    return Object.assign({}, it, { eng: eng, keys: v === null ? (it.keys || []).filter((k) => k !== 'L6') : (it.keys || ['L6']) });
  });
  return { items: out, dropped: 0, touched: touched, note: '判词路缺席 ⇒ L6 用 l6Structural 少一路重算（其余引擎不动）' };
}

/** Δ 读数（纯函数）：**层聚合读数之差**（新 − 原）＋ 配对 bootstrap CI（复用 lambda-overlap 的 bootCI 单一实现）。
 *  ★口径（自查修正，2026-09-17）：首版用「配对均值差」（只算两侧都在的题）⇒ **剔除题不计入 ⇒ 排除类假设的 Δ 恒为 0**
 *   （答的不是「读数会变成什么」）。改为：**Δ_agg ＝ mean(变更后读数) − mean(基线读数)**（各自在自己的人口上取均值，
 *   ⇒ 分母变化也被计入）；CI ＝ 对**基线题**重采样，每重复内按同一保留规则同时算两侧聚合再作差（配对 bootstrap）。
 */
function deltaOf(baseRows, altRows, bootCI) {
  const altById = new Map(altRows.map((r) => [r.id, r]));
  const out = {};
  for (const L of LAYERS.concat(['ALL'])) {
    const b = baseRows.filter((r) => L === 'ALL' || r.layer === L);
    const pairs = b.map((r) => { const a = altById.get(r.id); return { id: r.id, base: r.brier, alt: a ? a.brier : null }; });
    const present = pairs.filter((x) => x.alt !== null);
    const baseMean = b.length ? mean(pairs.map((x) => x.base)) : null;
    const altMean = present.length ? mean(present.map((x) => x.alt)) : null;
    const delta = (baseMean !== null && altMean !== null) ? altMean - baseMean : null;
    const ci = (pairs.length >= 3)
      ? bootCI(pairs, (s) => {
        const pr = s.filter((x) => x.alt !== null);
        if (!s.length || !pr.length) return 0;
        return mean(pr.map((x) => x.alt)) - mean(s.map((x) => x.base));
      }, NB, SEED)
      : { lo: null, hi: null };
    out[L] = { n_base: b.length, n_alt: present.length, n_lost: b.length - present.length,
      base_brier: baseMean, alt_brier: altMean, delta: delta, ci95: ci,
      ci_excludes_0: (ci.lo !== null) && (ci.lo > 0 || ci.hi < 0) };
  }
  return out;
}

// ── 主流程（只在 CLI 直跑时执行） ───────────────────────────────────────────
function main() {
  const pre = require(path.join(__dirname, 'e2-combo-precheck.cjs'));
  const { bootCI } = require(path.join(__dirname, 'lambda-overlap.cjs'));
  const mat = pre.buildEngineMatrix(DB_PATH);
  const items = mat.items || mat;
  const base = readingsOf(items);

  let alt = { items: items, dropped: 0, touched: 0, note: '无假设（基线自检）' };
  let assumption = { kind: WHATIF };

  if (WHATIF === 'exclude') {
    const keys = parseKeys(DROP);
    if (!keys.length) throw new Error('exclude 模式须给 --drop cell:<layer>/<domain>[,domain:<d>]');
    alt = applyExclude(items, keys);
    assumption.keys = keys;
  } else if (WHATIF === 'drop-baserate') {
    const keys = parseKeys(WHERE);
    if (!keys.length) throw new Error('drop-baserate 模式须给 --where cell:<layer>/<domain>[,domain:<d>]');
    alt = applyDropBaserate(items, keys);
    assumption.keys = keys;
  } else if (WHATIF === 'drop-variant') {
    if (VARIANTS.indexOf(VARIANT) === -1) throw new Error('drop-variant 模式须给 --variant ∈ ' + VARIANTS.join('|'));
    // L6 单一实现：l6Structural({verdicts}) 少一路重算
    const { l6Structural } = require(path.join(ROOT, 'p1b', 'src', 'engines', 'l6_structural'));
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    let pByPid = {};
    try {
      const sel = db.prepare('SELECT id, prompt_variant, implied_prob FROM verdicts WHERE prediction_id = ? ORDER BY id');
      for (const it of items) {
        if (it.layer !== 'L6') continue;
        const vs = sel.all(it.id).filter((v) => v.prompt_variant !== VARIANT);
        const o = l6Structural({ verdicts: vs });
        pByPid[it.id] = (o && o.ok) ? o.p : null;
      }
    } finally { db.close(); }
    alt = applyDropVariant(items, pByPid);
    assumption.variant = VARIANT;
  } else if (WHATIF !== 'none') {
    throw new Error('不支持的 --whatif: ' + WHATIF + '（支持 none|exclude|drop-baserate|drop-variant）');
  }

  const altRead = readingsOf(alt.items);
  const deltas = deltaOf(base.rows, altRead.rows, bootCI);
  // 金样自检：none 模式须与基线逐位一致
  const health = (WHATIF === 'none')
    ? { mode: 'golden-replay', identical: deltas.ALL.n_base > 0 && deltas.ALL.delta === 0 && deltas.ALL.n_lost === 0,
        note: '无假设 ⇒ 重算读数与基线逐位一致（金样回放零读数变化）' }
    : null;

  const out = {
    script: 'p1b/scripts/a1-whatif.cjs', version: 1, generated_at: new Date().toISOString(),
    label: EXPLORATORY, basis: '蓝图 §2.3-1／11 号件 §6（假设重算器）／19 号裁剪执行记录 §2.2（对内件也挂探索性标注）',
    discipline: { ledger_write: false, llm: false, network: false, into_calibration: false, world_simulation: false },
    reading_basis: '逐题引擎读数＝e2-combo-precheck.buildEngineMatrix()（单一实现）；本层读数＝eng[layer]；参照线＝常数 0.5；'
      + 'CI＝配对 bootstrap（按题重采样 B=' + NB + '／seed=' + SEED + '／百分位法，复用 lambda-overlap.bootCI）',
    not_claiming: '本件不声称复现 stage4-run 五层读数件（口径不同）——只出同一矩阵上假设变更的相对差',
    cohort: items.length, assumption: assumption, whatif_note: alt.note,
    drops: { dropped: alt.dropped || 0, touched: alt.touched || 0 },
    baseline: base.byLayer, alternative: altRead.byLayer, delta: deltas, health_check: health,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stem = path.join(OUT_DIR, 'a1-whatif' + (TAG ? '-' + TAG : '') + '-20260917');
  fs.writeFileSync(stem + '.json', JSON.stringify(out, null, 1), 'utf8');

  const f6 = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(6);
  const L = [];
  L.push('# A1 假设重算器（完整版 v1）· 探索性 what-if 读数 · ' + out.generated_at.slice(0, 10));
  L.push('');
  L.push('> ★**' + EXPLORATORY + '**——本件不进校准口径、不进账本、不作任何能力宣称（19 号裁剪执行记录 §2.2：对内件同样强制挂标注）。');
  L.push('> 依据：蓝图 §2.3-1（第 3 期首选票）／11 号件 §6（反事实降格收编）｜纪律：零账本写／零 LLM／零网络。');
  L.push('> 口径：' + out.reading_basis);
  L.push('');
  L.push('## 1 假设');
  L.push('- kind＝`' + assumption.kind + '`' + (assumption.keys ? '｜目标＝`' + JSON.stringify(assumption.keys) + '`' : '')
    + (assumption.variant ? '（缺席变体 `' + assumption.variant + '`）' : ''));
  L.push('- 变更语义：' + alt.note + '｜剔除题 ' + out.drops.dropped + '／受影响题 ' + out.drops.touched + '（总题 ' + out.cohort + '）');
  L.push('');
  L.push('## 2 读数对比（Brier；参照线＝常数 0.5）');
  L.push('> Δ 口径：**Δ_agg ＝ mean(变更后读数) − mean(基线读数)**（各自在自己的人口上取均值 ⇒ **分母变化也计入**）；');
  L.push('> CI＝对基线题重采样、每重复内按同一保留规则同时算两侧聚合再作差（配对 bootstrap，B=' + NB + '／seed=' + SEED + '）。');
  L.push('> ★**`ALL` 行禁跨层池化引用**（项目铁律：分层报）——该行只作「选择题集后的池化披露」，不得当读数宣称。');
  L.push('| 层 | n(基线) | n(变更后) | 基线 Brier | 变更后 Brier | **Δ(聚合差)** | 95% CI | CI 不含 0 | 丢失题数 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const K of LAYERS.concat(['ALL'])) {
    const b = out.baseline[K], a = out.alternative[K], d = out.delta[K];
    L.push('| ' + K + ' | ' + d.n_base + ' | ' + d.n_alt + ' | ' + f6(d.base_brier) + ' | ' + f6(d.alt_brier) + ' | **' + f6(d.delta) + '** | ['
      + f6(d.ci95.lo) + ', ' + f6(d.ci95.hi) + '] | ' + (d.ci_excludes_0 ? '**是**' : '否') + ' | ' + d.n_lost + ' |');
  }
  L.push('');
  L.push('## 3 基线明细（参照线对照）');
  L.push('| 层 | n | Brier | 常数 0.5 的 Brier | Δ(vs 0.5) |');
  L.push('|---|---|---|---|---|');
  for (const K of LAYERS.concat(['ALL'])) { const b = out.baseline[K];
    L.push('| ' + K + ' | ' + b.n + ' | ' + f6(b.brier) + ' | ' + f6(b.brier_half) + ' | ' + f6(b.delta_vs_half) + ' |'); }
  L.push('');
  if (health) {
    L.push('## 4 金样自检（蓝图判据：金样回放零读数变化）');
    L.push('- **' + (health.identical ? 'PASS' : '★FAIL') + '**：' + health.note
      + '（Δ(ALL)=' + f6(out.delta.ALL.delta) + '，丢失 ' + out.delta.ALL.n_lost + ' 题）');
    L.push('');
  }
  L.push('## 5 禁令（写死）');
  L.push('- **不模拟世界状态**｜**不产新概率进账本**｜**输出恒挂探索性标注**｜**不进校准口径**（11 号件 §6 原文）。');
  L.push('- 本件**不设 Brier 承诺**（它是解释工具，不是预测工具）；唯一健康指标＝「差被如实披露且不回写账本」。');
  fs.writeFileSync(stem + '.md', L.join('\n') + '\n', 'utf8');
  console.log(L.join('\n'));
  console.log('json/md -> ' + OUT_DIR);
  return out;
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('[a1-whatif] FAIL ' + (e && e.stack ? e.stack : e)); process.exit(1); }
}

module.exports = { parseKeys, keyHits, readingsOf, applyExclude, applyDropBaserate, applyDropVariant, deltaOf, LAYERS, VARIANTS };
