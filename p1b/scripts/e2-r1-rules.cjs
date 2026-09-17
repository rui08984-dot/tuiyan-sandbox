#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/e2-r1-rules.cjs —— E2 · R1 语义重判臂：规则冻结核验 ＋ 错配/降档人口计数（2026-09-17）
 *
 * 规则来源（唯一）：`.scratch/forecast-debate/E2-R1-规则版-v1-冻结件-20260917.md`（**已冻结**；改动＝版本递进）。
 * 依据链：PREREG-E2 §2 R1 行｜11 号件 §⑧ **M5①**（「R1 规则版 v1 须 sha 冻结**先于任何 R1-vs-R0 读数**」）｜
 *   design §1.2 层判定优先级 **L5→L6→L1→L3→L2→L4**（取最特殊层）｜19 号件 §3 裁决三（layer×resolve_kind 错配审计＝E2 C1 供料）。
 *
 * 本件做三件事（纪律：**零账本写／零 LLM／零网络**；库 readOnly）：
 *   ① **核验冻结**：调 `prereg-freeze.cjs` 复算冻结件 sha ⇒ 必须 MATCH（不 MATCH 即停，exit 3）。
 *   ② **错配/降档人口计数（描述性）**：按冻结规则 R1-A/R1-B 逐题判定 no-op／改层／降档，报人口数。
 *   ③ **明示未做**：**不跑任何 R1-vs-R0 读数**（Brier/对数分比较）——按 M5① 与 E2 §3.0，
 *      读数须待「本件冻结 ＋ 覆盖补齐」后**一次性跑**，防多次开跑的选择性。本件输出里**不含**任何臂读数。
 *
 * ★ 单一实现：可估引擎集 A(q) **直接 require** `e2-combo-precheck.cjs` 的 `buildEngineMatrix()`
 *   （冻结件 §1-A1 写死「同一实现；本件不另写第二份」）。
 * 用法：node p1b/scripts/e2-r1-rules.cjs [--db <path>] [--out-dir <dir>] [--rules <冻结件>] [--boot 1000]
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
const NB = Number(arg('boot', '1000'));
const SEED = Number(arg('seed', '987654321'));
const MIN_N = 30;                 // R1-B 阈值＝项目既有准入线（K F13），不新造

/** 设计优先级（design §1.2「取最特殊层」）；L4 为叠加层、不出数 ⇒ 不参与。 */
const PRIORITY = ['L5', 'L6', 'L1', 'L3', 'L2'];

// ── 纯函数区（可 require，零副作用） ─────────────────────────────────────────
/** R1-A 单题判定（纯函数）：assignedLayer ＋ 可估引擎键 ⇒ {action, layer, reason}。 */
function r1aDecide(assignedLayer, keys) {
  const k = keys || [];
  if (k.indexOf(assignedLayer) !== -1) return { action: 'no-op', layer: assignedLayer, reason: '本层引擎可估' };
  if (k.length) {
    const target = PRIORITY.filter((L) => k.indexOf(L) !== -1)[0];
    return target
      ? { action: 'reassign', layer: target, reason: '本层引擎不可估 ⇒ 按设计优先级改层' }
      : { action: 'downgrade', layer: null, reason: '有可估引擎但均不在设计优先级内' };
  }
  return { action: 'downgrade', layer: null, reason: '无任何可估引擎（A(q)=∅）' };
}

/**
 * R1 全流程（纯函数，零副作用）——★ 单一实现：影子评分臂（`e2-shadow-score.cjs`）直接 require 本函数，
 * 禁写第二份 R1-A/R1-B（冻结件 §1-A1「同一实现」；与 `buildEngineMatrix` 同一纪律）。
 * ① R1-A 逐题判定 ② R1-B 格审计（layer×domain；n<MIN_N 或 RES CI 下界 ≤0 ⇒ 整格降档）
 * ③ 逐题落点（action≠downgrade 且其格保留 ⇒ 进 R1 臂计分；否则降档 ⇒ 只剩 shadow 评分）
 * @param {Array} items 矩阵题（buildEngineMatrix().items；元素含 id/layer/domain/eng/keys/y）
 * @param {Object} [opts] { combo：combo-precheck 模块（含 murphyRes/bootCI）；minN；B；seed }
 */
function r1Plan(items, opts) {
  const o = opts || {};
  const M = o.combo || require(path.join(ROOT, 'p1b', 'scripts', 'e2-combo-precheck.cjs'));
  const minN = o.minN === undefined ? MIN_N : o.minN;
  const NB = o.B === undefined ? 1000 : o.B;
  const SEED = o.seed === undefined ? 987654321 : o.seed;

  const counts = { 'no-op': 0, reassign: 0, downgrade: 0 };
  const reassignBy = {}, noEngineByLayer = {};
  for (const it of items) {
    const d = r1aDecide(it.layer, it.keys);
    counts[d.action]++;
    if (d.action === 'reassign') { const k = it.layer + '→' + d.layer; reassignBy[k] = (reassignBy[k] || 0) + 1; }
    if (d.action === 'downgrade') noEngineByLayer[it.layer] = (noEngineByLayer[it.layer] || 0) + 1;
    it.r1a = d;
  }
  const cells = {};
  for (const it of items) {
    if (it.r1a.action === 'downgrade') continue;
    const L = it.r1a.layer, k = L + '/' + it.domain;
    if (!cells[k]) cells[k] = { layer: L, n: 0, ps: [], ys: [] };
    const p = it.eng[L]; if (p === undefined) continue;
    cells[k].n++; cells[k].ps.push(p); cells[k].ys.push(it.y);
  }
  const r1b = [];
  let downgradeByR1B = 0;
  for (const [k, c] of Object.entries(cells)) {
    const enough = c.n >= minN;
    let resLo = null, res = null;
    if (enough) {
      const pt = M.murphyRes(c.ps, c.ys); res = pt.res;
      const ci = M.bootCI(c.ps.map((p, i) => ({ p: p, y: c.ys[i] })), (s) => { const m = M.murphyRes(s.map((x) => x.p), s.map((x) => x.y)); return m.res === null ? 0 : m.res; }, NB, SEED);
      resLo = ci.lo;
    }
    const keep = enough && resLo !== null && resLo > 0;
    if (!keep) downgradeByR1B += c.n;
    r1b.push({ cell: k, n: c.n, RES: res, ci95_RES_lo: resLo, kept: keep,
      reason: !enough ? 'n<' + minN + '（K F13 准入线）' : (resLo !== null && resLo <= 0 ? 'RES CI 下界 ≤ 0（无分辨力）' : '') });
  }
  const cellKept = {}; for (const r of r1b) cellKept[r.cell] = r.kept;
  const perItem = {};
  for (const it of items) {
    const d = it.r1a;
    const cell = d.layer ? d.layer + '/' + it.domain : null;
    const kept = d.action !== 'downgrade' && cellKept[cell] === true;
    perItem[it.id] = { action: d.action, layer: d.layer, cell: cell, kept: kept,
      r1Layer: kept && d.layer ? d.layer : null, reason: d.reason };
  }
  const r1aKeep = items.length - counts.downgrade;
  const afterB = r1b.filter((r) => r.kept).reduce((s, r) => s + r.n, 0);
  return { counts: counts, reassignBy: reassignBy, noEngineByLayer: noEngineByLayer,
    cells: r1b, cellKept: cellKept, perItem: perItem,
    downgradedQuestions: downgradeByR1B, scoreableAfter: { phase_a: r1aKeep, after_b: afterB },
    minN: minN, B: NB, seed: SEED };
}

// ── 主流程（只在 CLI 直跑；require 不写盘、不读库） ───────────────────────────
function main() {
  // ① 冻结核验（调冻结工具，保持 sha 口径单一真源）
  const freezeOut = execFileSync(process.execPath, [path.join(ROOT, 'p1b', 'scripts', 'prereg-freeze.cjs'), RULES], { encoding: 'utf8' });
  const sha = (/sha256\s*=\s*([0-9a-f]{64})/.exec(freezeOut) || [])[1] || null;
  const match = /MATCH\s*=\s*true/.test(freezeOut);
  if (!match) { console.error('!! R1 冻结件 sha 未 MATCH ⇒ 停（规则可能被改；改动须走版本递进）'); console.error(freezeOut.trim()); process.exit(3); }

  // ② 单一实现取矩阵
  const M = require(path.join(ROOT, 'p1b', 'scripts', 'e2-combo-precheck.cjs'));
  const mat = M.buildEngineMatrix(DB_PATH);
  const items = mat.items;

  // ③＋④ R1-A 逐题判定 ＋ R1-B 低信号格降档 —— ★纯函数 r1Plan（影子评分臂直接 require 同一实现）
  const plan = r1Plan(items, { combo: M, minN: MIN_N, B: NB, seed: SEED });
  const counts = plan.counts, reassignBy = plan.reassignBy, noEngineByLayer = plan.noEngineByLayer;
  const r1b = plan.cells, downgradeByR1B = plan.downgradedQuestions;

  const total = items.length;
  const f6 = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : Number(x).toFixed(6);
  const L = [];
  L.push('# E2 · R1 语义重判臂 · 冻结核验 ＋ 错配/降档人口计数 · ' + new Date().toISOString().slice(0, 10));
  L.push('');
  L.push('> 规则来源（唯一）：`' + path.relative(ROOT, RULES).replace(/\\/g, '/') + '`（**已冻结**；改动＝版本递进）。');
  L.push('> 依据：PREREG-E2 §2 R1 行｜11 号件 §⑧ **M5①**（sha 冻结**先于任何 R1-vs-R0 读数**）｜design §1.2 优先级 **' + PRIORITY.join(' → ') + '**｜19 号件 §3 裁决三。');
  L.push('> 纪律：**零账本写／零 LLM／零网络**；库 readOnly。可估引擎集 A(q) **直接 require `e2-combo-precheck.cjs::buildEngineMatrix`**（单一实现）。');
  L.push('> **⚠ 本件不含任何臂读数**：R1-vs-R0 的 Brier/对数分比较**未跑**（按 M5①＋E2 §3.0，须待冻结 ＋ 覆盖补齐后**一次性跑**）。');
  L.push('');
  L.push('## 1. 冻结核验');
  L.push('');
  L.push('- 冻结件 sha256 ＝ `' + sha + '`｜**MATCH ＝ ' + match + '**（口径：文件除登记块外全部原始字节，字节级）');
  L.push('- 时序：**先冻结（本件 ①）后计数（本件 ②）** ⇒ M5① 的「冻结先于读数」满足（计数非读数）。');
  L.push('');
  L.push('## 2. R1-A 错配审计人口（队列 ' + total + ' 题）');
  L.push('');
  L.push('| 判定 | 题数 | 占比 |');
  L.push('|---|---|---|');
  for (const a of ['no-op', 'reassign', 'downgrade']) L.push('| ' + a + ' | ' + counts[a] + ' | ' + (total ? (counts[a] / total * 100).toFixed(1) : 'n/a') + '% |');
  L.push('');
  if (Object.keys(reassignBy).length) L.push('- **改层明细**（原层 → 新层）：' + Object.entries(reassignBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v + ' 题').join('｜'));
  if (Object.keys(noEngineByLayer).length) L.push('- **无引擎可估（⇒ 降档）按原层**：' + Object.entries(noEngineByLayer).sort().map(([k, v]) => k + ' ' + v + ' 题').join('｜'));
  L.push('');
  L.push('## 3. R1-B 低信号格降档（格＝R1 判定层 × 域；阈值：n≥' + MIN_N + ' 且 RES CI 下界 > 0）');
  L.push('');
  L.push('| 格 | n | RES | RES CI 下界 | 保留? | 降档理由 |');
  L.push('|---|---|---|---|---|---|');
  for (const r of r1b.sort((a, b) => b.n - a.n)) L.push('| ' + r.cell + ' | ' + r.n + ' | ' + f6(r.RES) + ' | ' + f6(r.ci95_RES_lo) + ' | ' + (r.kept ? '保留' : '**降档**') + ' | ' + (r.reason || '—') + ' |');
  L.push('');
  L.push('- 格数 ' + r1b.length + '｜**保留格** ' + r1b.filter((r) => r.kept).length + '｜降档格 ' + r1b.filter((r) => !r.kept).length + '（涉 **' + downgradeByR1B + '** 题）');
  L.push('');
  L.push('## 4. R1 后的可计分人口（描述性，非读数）');
  L.push('');
  const r1aKeep = plan.scoreableAfter.phase_a;
  const afterB = plan.scoreableAfter.after_b;
  L.push('- R1-A 后仍可估：**' + r1aKeep + '** 题（no-op ' + counts['no-op'] + ' ＋ 改层 ' + counts.reassign + '）');
  L.push('- 再经 R1-B：**保留格题数 ' + afterB + '** 题进 R1 臂计分；其余降档 descriptive（进 shadow，M5⑤）。');
  L.push('- **本件到此为止**：R1 臂 vs R0 的任何 Brier/对数分读数**未跑、也不在此件**。');
  L.push('');
  L.push('## 5. 边界');
  L.push('');
  L.push('- 可估性＝「引擎自己说能算」，**不等于**语义上属于那层（语义判定本属 checklist／人）；R1 的定位即**机械可估性审计**。');
  L.push('- 本件为**描述性计数**，不进任何门控、不构成任何臂的读数；引用须同时引冻结件与 PREREG-E2。');
  L.push('- 域派生照 `domain.js` 单一真源（`deriveDomain`）。');
  L.push('');
  L.push('（R1 审计完 · 零账本写 · 零 LLM · 零网络 · 含冻结核验与人口计数，不含臂读数）');

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, 'e2-r1-rules-' + today);
  fs.writeFileSync(base + '.json', JSON.stringify({
    script: 'p1b/scripts/e2-r1-rules.cjs',
    rules_file: RULES, rules_sha256: sha, rules_match: match,
    basis: 'PREREG-E2 §2 R1 行 ＋ 11 号件 §⑧ M5① ＋ design §1.2 优先级 ＋ 19 号件 §3 裁决三',
    generated_at: new Date().toISOString(),
    discipline: { ledger_write: false, llm: false, network: false, arms_reading_run: false },
    not_run: 'R1-vs-R0 读数未跑（M5①＋E2 §3.0：须待冻结＋覆盖补齐后一次性跑）；本件只做描述性计数。',
    single_implementation: '可估引擎集 A(q) require e2-combo-precheck.cjs::buildEngineMatrix（冻结件 §1-A1 要求「同一实现」）',
    priority: PRIORITY, min_n: MIN_N,
    cohort: total, r1a_counts: counts, reassign_detail: reassignBy, no_engine_by_layer: noEngineByLayer,
    r1b_cells: r1b, r1b_downgraded_questions: downgradeByR1B,
    r1_scoreable_after: { phase_a: r1aKeep, after_b: afterB },
    bootstrap: { B: NB, seed: SEED, method: '按题配对重采样·百分位法' },
  }, null, 1), 'utf8');
  fs.writeFileSync(base + '.md', L.join('\n') + '\n', 'utf8');
  console.log('=== E2 · R1 规则冻结核验 ＋ 人口计数 ===');
  console.log('  冻结 sha ' + String(sha).slice(0, 16) + '…｜MATCH=' + match);
  console.log('  队列 ' + total + '｜R1-A: no-op ' + counts['no-op'] + '／改层 ' + counts.reassign + '／降档 ' + counts.downgrade);
  console.log('  R1-B: 格 ' + r1b.length + '（保留 ' + r1b.filter((r) => r.kept).length + '／降档 ' + r1b.filter((r) => !r.kept).length + '，涉 ' + downgradeByR1B + ' 题）');
  console.log('  R1 后可计分（描述性）：A 后 ' + r1aKeep + ' ⇒ B 后 ' + afterB);
  console.log('  ⚠ 未跑任何 R1-vs-R0 读数（M5①＋E2 §3.0）');
  console.log('json/md -> ' + OUT_DIR);
}

module.exports = { r1aDecide, r1Plan, PRIORITY, MIN_N };
if (require.main === module) { main(); }
