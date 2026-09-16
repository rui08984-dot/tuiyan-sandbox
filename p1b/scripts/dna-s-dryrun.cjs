#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/dna-s-dryrun.cjs —— DNA S 维读侧**试标**（P0-U6 · 2026-09-16）
 *
 * 规则源＝`12-PREREG-E1-DNA加列S维-v1.md` §1（**已冻结** sha 1875382d…）：逐字实现、零 LLM、零网络。
 * 与 E1 正式回填件 `dna-s-backfill.cjs` 的边界：本件**只读 dry-run**——不建表、不落表、
 *   不提供任何写库参数（旁路表 dna_s_labels 的建表与写行留待 E1 实施）；无源码写路径。
 *
 * 本件定位（硬印）：**分布披露，非判据**。判据须 E1 PREREG 冻结后（12 §3 弃权条款为准）。
 * 窗口来源（P0 范围照【13】U6）：仅**账本结局序列回退档**（同系列已解结局按时序；源侧快照重建留 E1）。
 *   诚实边界：回退档的「结局被观察到」时点晚于 cutoff，存在 look-ahead 风险 ⇒ 本件只做分布披露，
 *   不冒充 E1 主口径（主口径＝源数据侧快照重建，12 §1）。
 * 用法：node p1b/scripts/dna-s-dryrun.cjs [--db <path>] [--out-dir <dir>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }

const Z = 1.96;
/** Wilson score 区间（两半期比例各自专用） */
function wilson(k, n) {
  if (!n) return { l: 0, u: 1 };
  const p = k / n; const z2 = Z * Z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { l: center - half, u: center + half };
}
/** Newcombe hybrid-score 区间（差值 p2−p1 的 95% CI；方法=各自 Wilson 后"平方相加"） */
function newcombe(k1, n1, k2, n2) {
  if (!n1 || !n2) return null;
  const p1 = k1 / n1, p2 = k2 / n2, d = p2 - p1;
  const w1 = wilson(k1, n1), w2 = wilson(k2, n2);
  const lb = d - Math.sqrt((p1 - w1.l) * (p1 - w1.l) + (w2.u - p2) * (w2.u - p2));
  const ub = d + Math.sqrt((w1.u - p1) * (w1.u - p1) + (p2 - w2.l) * (p2 - w2.l));
  return { p1: p1, p2: p2, d: d, lb: lb, ub: ub };
}
/** 标签判定（12 §1 冻结阈值：CI 不含 0→漂移；含 0→平稳；min(n1,n2)<10 或 n<20→不可判） */
function labelOf(k1, n1, k2, n2) {
  const n = n1 + n2;
  if (n < 20 || Math.min(n1, n2) < 10) return { label: '不可判', ci: null };
  const ci = newcombe(k1, n1, k2, n2);
  if (!ci) return { label: '不可判', ci: null };
  const drift = (ci.lb > 0 || ci.ub < 0);
  return { label: drift ? '漂移' : '平稳', ci: ci };
}

function main() {
  const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
  const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const all = (s) => db.prepare(s).all();
  const domMod = require(path.join(ROOT, 'p1b', 'src', 'evidence', 'domain'));

  const rows = all('SELECT p.id, p.layer, p.outcome, p.matures_at, p.created_at, p.evidence_json, g.game_type AS gtype, '
    + "(SELECT json_extract(e.value,'$.cutoff') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.cutoff') IS NOT NULL LIMIT 1) AS ev_cutoff "
    + 'FROM predictions p LEFT JOIN games g ON g.id = p.game_id '
    + "WHERE p.layer IN ('L1','L2','L3','L5','L6') ORDER BY p.id");
  db.close();

  const parseEv = (j) => { try { return JSON.parse(j || '[]'); } catch (e) { return []; } };
  const kindOf = (ev) => String((((ev[0] || {}).resolve) || {}).kind || '');
  const tailOf = (r) => String(r.ev_cutoff || r.matures_at || r.created_at || '').slice(0, 10);
  const eventOf = (r) => String(r.matures_at || r.ev_cutoff || r.created_at || '').slice(0, 10);

  // 系列索引（L2/L3；账本回退档：同系列已解结局按时序）
  const series = {};
  for (const r of rows) {
    if (r.layer !== 'L2' && r.layer !== 'L3') continue;
    const ev = parseEv(r.evidence_json); const k = kindOf(ev);
    if (!k) continue;
    (series[k] = series[k] || []).push({ id: r.id, layer: r.layer, kind: k, outcome: r.outcome, event: eventOf(r), tail: tailOf(r), gtype: r.gtype, evk: (ev[0] || {}).kind });
  }

  const labels = [];  // {id, layer, series, domain, dna_s, basis}
  const counts = { 平稳: 0, 漂移: 0, 不可判: 0, '先验:恒平稳': 0, 剔除_L1: 0 };
  for (const r of rows) {
    const ev = parseEv(r.evidence_json);
    let dd = { domain: '(unknown)' };
    try { dd = domMod.deriveDomain({ resolve: (ev[0] || {}).resolve || null, evKind: (ev[0] || {}).kind, gameType: r.gtype }); } catch (e) { dd = { domain: '(unknown)' }; }
    if (r.layer === 'L1') { counts['剔除_L1']++; continue; }                       // 12 §1：不赋档，整层剔除
    if (r.layer === 'L5' || r.layer === 'L6') {                                     // 12 §1：先验档
      counts['先验:恒平稳']++;
      labels.push({ id: r.id, layer: r.layer, series: r.layer === 'L5' ? '(认证源)' : '(对局)', domain: dd.domain, dna_s: '先验:恒平稳', basis: { 窗口来源: '先验档（12 §1 冻结）' } });
      continue;
    }
    const k = kindOf(ev);
    const seq = (series[k] || []).filter((x) => x.id !== r.id && x.outcome !== null && x.event && x.event <= tailOf(r))
      .sort((a, b) => (a.event < b.event ? -1 : a.event > b.event ? 1 : a.id - b.id));
    const n = seq.length;
    if (n < 20) {                                                                   // cold-start / 薄系列 ⇒ 不可判
      counts['不可判']++;
      labels.push({ id: r.id, layer: r.layer, series: k, domain: dd.domain, dna_s: '不可判', basis: { 窗口来源: '账本结局序列（回退档）', n: n, reason: n < 20 ? 'series_n<20' : 'thin' } });
      continue;
    }
    const half = Math.floor(n / 2);
    const first = seq.slice(0, half), second = seq.slice(n - half);
    const k1 = first.filter((x) => String(x.outcome) === 'true').length, n1 = first.length;
    const k2 = second.filter((x) => String(x.outcome) === 'true').length, n2 = second.length;
    const res = labelOf(k1, n1, k2, n2);
    counts[res.label]++;
    labels.push({ id: r.id, layer: r.layer, series: k, domain: dd.domain, dna_s: res.label,
      basis: { 窗口来源: '账本结局序列（回退档）', k1: k1, n1: n1, k2: k2, n2: n2, diff: res.ci ? res.ci.d : null, ci_lb: res.ci ? res.ci.lb : null, ci_ub: res.ci ? res.ci.ub : null } });
  }

  // 列联：标签 × 系列 × layer × domain
  const cells = {};
  for (const l of labels) {
    const key = l.dna_s + '\u0000' + l.layer + '\u0000' + l.domain + '\u0000' + l.series;
    if (!cells[key]) cells[key] = { dna_s: l.dna_s, layer: l.layer, domain: l.domain, series: l.series, n: 0 };
    cells[key].n++;
  }
  const cellRows = Object.keys(cells).map((k) => cells[k]).sort((a, b) => b.n - a.n);
  // 集中度预检（12 §6①）：漂移标签按域格占比 ≥80% ⇒ 警示
  const driftTotal = counts['漂移'];
  const byDomain = {};
  for (const l of labels) if (l.dna_s === '漂移') { const dk = l.layer + '/' + l.domain; byDomain[dk] = (byDomain[dk] || 0) + 1; }
  const concentration = Object.keys(byDomain).map((k) => ({ cell: k, n: byDomain[k], share: driftTotal ? byDomain[k] / driftTotal : 0 }))
    .sort((a, b) => b.share - a.share);
  const warnings = concentration.filter((c) => c.share >= 0.8).map((c) => '漂移标签集中度 ≥80%：' + c.cell + '（' + (c.share * 100).toFixed(1) + '%）⇒ 照 12 §6① 触发「无充分跨格变异」处置提示（本件只披露）');

  const report = {
    script: 'p1b/scripts/dna-s-dryrun.cjs', title: 'DNA S 维试标（分布披露）',
    hard_notice: '本件为**分布披露，非判据**；判据须 E1 PREREG 冻结后（12 §3 弃权条款为准）',
    rule_source: '12-PREREG-E1-DNA加列S维-v1.md §1（已冻结 sha 1875382deddd6a5b…）',
    window_route: '账本结局序列回退档（P0 范围；源侧快照重建留 E1）',
    honest_boundary: '回退档结局可达时点晚于 cutoff，存在 look-ahead 风险 ⇒ 本件不冒充 E1 主口径读数',
    db: DB_PATH, rows_considered: rows.length,
    counts: counts, cells_total: cellRows.length, cells: cellRows,
    concentration: { drift_total: driftTotal, by_domain: concentration, warnings: warnings },
    labels_written: false, note_writes: '无旁路表、无 DDL、无任何写库路径（旁路表留 E1；本件源码无写库参数）',
    generated_at: new Date().toISOString(),
  };

  const L = [];
  L.push('# DNA S 维试标 · 分布披露（' + new Date().toISOString().slice(0, 10) + '）');
  L.push('');
  L.push('> **' + report.hard_notice + '**');
  L.push('> 规则源：' + report.rule_source + '；窗口来源：' + report.window_route + '。');
  L.push('> 诚实边界：' + report.honest_boundary + '。');
  L.push('');
  L.push('## 标签分布');
  for (const k of ['平稳', '漂移', '不可判', '先验:恒平稳', '剔除_L1']) L.push('- ' + k + '：' + counts[k]);
  L.push('');
  L.push('## 列联表（标签 × layer × domain × 系列；前 40 行）');
  L.push('| 标签 | 层 | 域 | 系列 | n |');
  L.push('|---|---|---|---|---|');
  for (const c of cellRows.slice(0, 40)) L.push('| ' + c.dna_s + ' | ' + c.layer + ' | ' + c.domain + ' | ' + c.series + ' | ' + c.n + ' |');
  L.push('');
  L.push('## 集中度预检（漂移标签）');
  if (concentration.length) for (const c of concentration) L.push('- ' + c.cell + '：' + c.n + '（' + (c.share * 100).toFixed(1) + '%）');
  else L.push('- （无漂移标签）');
  for (const w of warnings) L.push('- ⚠ ' + w);
  L.push('');
  L.push('（零写库 · 无旁路表 · 只读 dry-run · ' + report.note_writes + '）');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const jf = path.join(OUT_DIR, 'dna-s-dryrun-' + today + '.json');
  const mf = path.join(OUT_DIR, 'dna-s-dryrun-' + today + '.md');
  fs.writeFileSync(jf, JSON.stringify(report, null, 1), 'utf8');
  fs.writeFileSync(mf, L.join('\n') + '\n', 'utf8');
  console.log('=== DNA S 维试标（P0-U6，分布披露·非判据）===');
  console.log('分布 ' + JSON.stringify(counts) + ' ｜ 列联 ' + cellRows.length + ' 格 ｜ 集中度警示 ' + warnings.length);
  console.log('json -> ' + jf);
  console.log('md   -> ' + mf);
}

module.exports = { wilson: wilson, newcombe: newcombe, labelOf: labelOf };
if (require.main === module) { main(); }
