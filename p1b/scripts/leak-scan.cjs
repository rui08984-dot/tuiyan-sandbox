#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/leak-scan.cjs —— 全库泄漏扫描器（2026-09-22 · 承接 leak 诊断三批）
 *
 * 依据（**引用不新造**）：
 *   ① gate 的判据＝`anchor-gate.cjs` 的 Q0-2：**cutoff 必须严格早于「事件窗口起点」**。
 *   ② 窗口起点的字段规则＝`anchor-gate.cjs` 的 `eventWindowStart()`（★**同源实现**，本件不另立清单）。
 *   ③ 周起点的 `mmwrWeekStart`＝同函数的实现（MMWR 流行病学周规则：周=周日→周六；含 ≥4 天新年者为第 1 周）。
 *
 * ★为何存在：本日三批诊断（eurostat_live → 全库扫描 → gate 缺口）暴露——
 *   ① 初版扫描**只用了 3 个字段** ⇒ 276 条「推不出」（覆盖缺口被误当「没问题」）
 *   ② 用 gate 完整规则重扫 ⇒ 收窄到 57
 *   ③ 核实 57 ⇒ 分账 21（缺 mmwrWeekStart）＋30（**gate 本身不认** commence_utc/week_start）＋6（结构性）
 *   本件＝把该扫描**固化为可重跑脚本**（含 mmwrWeekStart），并把「gate 不认的字段」**如实单列**。
 *
 * 纪律：
 *   · **零账本写**（库只读）；**零网络**；**零判据变更**（判据完全照 gate，本件只做扫描与统计）。
 *   · ★**未覆盖必须显式计数**（禁把「推不出」混入 pass）——承本日教训。
 *   · ★**gate 不认的字段单列**（`gate_unsupported`），与「结构性无日期」分开。
 *
 * 用法：
 *   node p1b/scripts/leak-scan.cjs [--json <p>] [--md <p>] [--db <p>]
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const eq = process.argv.find((a) => a.startsWith('--' + n + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const DB_PATH = path.resolve(arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db')));
const TODAY = new Date().toISOString().slice(0, 10);
const RUN_AT = new Date().toISOString();

/** MMWR 周起点（★同源实现：照 anchor-gate.cjs 的 mmwrWeekStart，逐行一致） */
function mmwrWeekStart(epiweek) {
  const s = String(epiweek);
  if (!/^\d{6}$/.test(s)) return null;
  const y = Number(s.slice(0, 4)), w = Number(s.slice(4, 6));
  if (!(w >= 1 && w <= 53)) return null;
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const sunOfJan1 = new Date(jan1.getTime() - jan1.getUTCDay() * 86400000);
  const daysInNewYear = 7 - jan1.getUTCDay();
  const week1 = daysInNewYear >= 4 ? sunOfJan1 : new Date(sunOfJan1.getTime() + 7 * 86400000);
  return new Date(week1.getTime() + (w - 1) * 7 * 86400000).toISOString().slice(0, 10);
}

/** 事件窗口起点（★同源：照 anchor-gate.cjs 的 eventWindowStart，**含 mmwrWeekStart**） */
function eventWindowStart(rz, meta) {
  const day = (s) => (s ? String(s).slice(0, 10) : null);
  if (rz.date) return day(rz.date);
  if (meta.date) return day(meta.date);
  if (rz.start) return day(rz.start);
  if (rz.epiweek) return mmwrWeekStart(rz.epiweek);
  if (meta.epiweek) return mmwrWeekStart(meta.epiweek);
  if (rz.month) return String(rz.month).slice(0, 7) + '-01';
  if (rz.period) return String(rz.period).slice(0, 7) + '-01';
  if (rz.year) return String(rz.year).slice(0, 4) + '-01-01';
  if (meta.eventDate) return day(meta.eventDate);
  if (meta.expectDate) return day(meta.expectDate);
  if (meta.expectMonth) return String(meta.expectMonth).slice(0, 7) + '-01';
  if (rz.week_end) return day(rz.week_end);
  if (rz.week) return day(rz.week);
  return null;
}

/** ★gate **不认**但账本里实际存在窗口信息的字段（本件单列，不改 gate） */
const GATE_UNSUPPORTED = [
  { field: 'resolve.commence_utc', note: '赔率族开赛时刻（含日期）——gate 的 eventWindowStart 不认' },
  { field: 'resolve.week_start', note: '周窗口起点（crossref/nvd）——gate 只认 week_end/week' },
  { field: 'meta.week_start', note: '同上' },
];
/** ★结构性无日期（期号→日期需查表） */
const STRUCTURAL_NO_DATE = [{ field: 'resolve.issue', note: '彩票期号（cwl）——期号→开奖日不固定，需查表' }];

function classifyUnsupported(rz, meta) {
  for (const u of GATE_UNSUPPORTED) {
    const [a, b] = u.field.split('.');
    const src = a === 'resolve' ? rz : meta;
    if (src && src[b]) return u.field;
  }
  for (const u of STRUCTURAL_NO_DATE) {
    const [a, b] = u.field.split('.');
    const src = a === 'resolve' ? rz : meta;
    if (src && src[b]) return u.field;
  }
  return null;
}

(function main() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const rows = db.prepare(
    "SELECT id, statement, evidence_json, resolved_at, outcome FROM predictions" +
    " WHERE json_extract(evidence_json,'$[0].meta.cutoff') IS NOT NULL ORDER BY id"
  ).all();
  const totalAll = db.prepare('SELECT COUNT(*) c FROM predictions').get().c;
  db.close();

  const res = { run_at: RUN_AT, today: TODAY, db: DB_PATH, scanned: rows.length, total_all: totalAll, pass: 0, leak: [], unverifiable: [], by_kind: {}, unsupported_by_field: {}, structural_by_field: {} };

  for (const r of rows) {
    let ev = null;
    try { ev = JSON.parse(r.evidence_json)[0]; } catch (e) { ev = null; }
    if (!ev) { res.unverifiable.push({ id: r.id, why: 'evidence 不可解析' }); continue; }
    const rz = ev.resolve || {}, meta = ev.meta || {};
    const w = eventWindowStart(rz, meta);
    if (!w) {
      // ★单列：分「gate 不认的字段」与「结构性无日期」
      const uf = classifyUnsupported(rz, meta);
      const bucket = uf && GATE_UNSUPPORTED.some((x) => x.field === uf) ? 'unsupported_by_field' : 'structural_by_field';
      res[bucket][uf || '(无已知字段)'] = (res[bucket][uf || '(无已知字段)'] || 0) + 1;
      res.unverifiable.push({ id: r.id, kind: rz.kind || null, why: uf ? ('gate 不认 ' + uf) : '无可用窗口字段' });
      continue;
    }
    const cDay = String(meta.cutoff).slice(0, 10);
    if (cDay < w) { res.pass++; continue; }
    res.leak.push({ id: r.id, kind: rz.kind || null, window_start: w, cutoff_day: cDay, resolved: !!r.resolved_at, statement: String(r.statement || '').slice(0, 90) });
    res.by_kind[rz.kind || '(无)'] = (res.by_kind[rz.kind || '(无)'] || 0) + 1;
  }

  res.totals = {
    pass: res.pass,
    leak: res.leak.length,
    unverifiable: res.unverifiable.length,
    unverifiable_unsupported: Object.values(res.unsupported_by_field).reduce((a, b) => a + b, 0),
    unverifiable_structural: Object.values(res.structural_by_field).reduce((a, b) => a + b, 0),
    leak_rate_over_scanned: res.scanned ? Number((res.leak.length / res.scanned).toFixed(4)) : null,
  };

  console.log('== 全库泄漏扫描（判据同源 gate）==');
  console.log('  库内总题 ' + totalAll + '｜有 meta.cutoff 可扫 ' + res.scanned);
  console.log('  pass ' + res.totals.pass + '｜★leak ' + res.totals.leak + '｜未判定 ' + res.totals.unverifiable
    + '（gate 不认字段 ' + res.totals.unverifiable_unsupported + '／结构性 ' + res.totals.unverifiable_structural + '）');
  if (res.totals.leak) {
    console.log('  leak 按 kind：' + Object.entries(res.by_kind).map(([k, n]) => k + '×' + n).join('｜'));
  }
  if (res.totals.unverifiable_unsupported) {
    console.log('  ★gate 不认的字段（单列，未改 gate）：' + JSON.stringify(res.unsupported_by_field));
  }
  if (res.totals.unverifiable_structural) {
    console.log('  结构性无日期（单列）：' + JSON.stringify(res.structural_by_field));
  }

  const jp = arg('json', null);
  if (jp) { fs.mkdirSync(path.dirname(path.resolve(jp)), { recursive: true }); fs.writeFileSync(path.resolve(jp), JSON.stringify(res, null, 1), 'utf8'); console.log('  json -> ' + jp); }
  const mp = arg('md', null);
  if (mp) {
    const L = ['# 全库泄漏扫描（' + TODAY + '）', '', '> 判据同源 ' + 'anchor-gate.cjs' + ' 的 Q0-2 与 eventWindowStart（**未改 gate**）｜零账本写／零网络', '',
      '| 判定 | 条数 |', '|---|---|', '| 可扫（有 meta.cutoff）| ' + res.scanned + ' |', '| pass | ' + res.totals.pass + ' |',
      '| **★leak** | **' + res.totals.leak + '** |',
      '| 未判定 | ' + res.totals.unverifiable + '（gate 不认字段 ' + res.totals.unverifiable_unsupported + '／结构性 ' + res.totals.unverifiable_structural + '）|', ''];
    if (res.totals.leak) { L.push('## leak 明细', ''); for (const x of res.leak) L.push('- id=' + x.id + ' `' + x.kind + '`：窗口起点 ' + x.window_start + ' ≤ cutoff ' + x.cutoff_day + (x.resolved ? '（已解）' : '')); L.push(''); }
    if (res.totals.unverifiable_unsupported) { L.push('## ★gate 不认的字段（单列，未改 gate）', ''); for (const [k, n] of Object.entries(res.unsupported_by_field)) L.push('- `' + k + '` × ' + n); L.push(''); }
    if (res.totals.unverifiable_structural) { L.push('## 结构性无日期（单列）', ''); for (const [k, n] of Object.entries(res.structural_by_field)) L.push('- `' + k + '` × ' + n); L.push(''); }
    fs.writeFileSync(path.resolve(mp), L.join('\n') + '\n', 'utf8');
    console.log('  md -> ' + mp);
  }
})();
