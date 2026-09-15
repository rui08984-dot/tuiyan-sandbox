'use strict';
/*
 * base-rate-golden.cjs —— 基率解析金样冻结器（任务 6 批次 3 / B1-1 前置）
 *
 * 用途：把**现网三解析器**对账本真实 baseRateNote 的解析结果冻结成 fixture
 *   （`p1b/test/fixtures/base-rate-golden.json`），供 B1-1 重构后做 parity 回放：
 *   重构后逐条比对必须是**逐字节相同**的解析输出 ⇒ 证明「三解析器收敛为一份共享模块」零读数变化。
 *
 * 口径与纪律：
 *   · 只读库（readonly 打开）；不写任何表。
 *   · 每 kind 取前 N 条**互不相同**的注记（默认 3）⇒ 覆盖面采样，非全量；全量零翻转另由
 *     stage4-run / g2-report 改前改后 diff 背书（见收据）。
 *   · 冻结的是**重构前**的逐字实现：l2 = l2_baseline.l2Baseline（实模块）｜l5 = l5_sources.parseCertifiedFromNote
 *     （实模块）｜g2 = g2-report.cjs 的 parseBaseRate/parseNoteN **逐字复制**（该脚本 require 即执行全文，
 *     不可 import，故复制并标注来源行）；重构后 g2 两函数改为委托共享模块，金样仍按复制实现比对。
 *   · **重跑本脚本 = 重新冻结，不是校验**。校验请跑 `node --test test/base-rate-module.test.cjs`。
 *
 * 用法：node p1b/scripts/base-rate-golden.cjs [--out <file>] [--per-kind 3] [--db <file>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));

function arg(name, dflt) {
  const eq = process.argv.find((a) => a.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : dflt;
}
const OUT = arg('out', path.join(ROOT, 'p1b', 'test', 'fixtures', 'base-rate-golden.json'));
const PER_KIND = Number(arg('per-kind', '3'));
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));

const { l2Baseline } = require(path.join(ROOT, 'p1b', 'src', 'engines', 'l2_baseline'));
const { parseCertifiedFromNote } = require(path.join(ROOT, 'p1b', 'src', 'engines', 'l5_sources'));

// ── g2-report.cjs 逐字复制（重构前实现；源行：parseBaseRate L131-143 / parseNoteN L304-325）──
function g2ParseBaseRate(note) {
  if (!note) return null;
  let m = /占\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (m) return { b: parseFloat(m[1]) / 100, pattern: 'pct_share' };
  m = /基率\s*[=:：]\s*(?:组合数理论值\s*)?([0-9]*\.?[0-9]+)/.exec(note);
  if (m) { const v = parseFloat(m[1]); return { b: v > 1 ? v / 100 : v, pattern: 'base_rate_eq' }; }
  m = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (m) return { b: parseFloat(m[1]) / 100, pattern: 'pct_fallback' };
  return null;
}
function g2ParseNoteN(note) {
  if (!note) return null;
  const ns = [];
  const res = [
    /(?:共|近|前|上)\s*([0-9]+)\s*(?:个|天|月|期|条)/g,
    /([0-9]+)\s*(?:个|天|月|期)[^0-9%]{0,12}?(?:的|中|值)/g,
    /(?:已发布|已开奖|已结算)\s*([0-9]+)\s*(?:个|天|月|期|条)/g,
    // ★ 2026-09-15 版本递进（留痕 §49）：同步单一真源新增的第 4 条句式「过去 N 天/个/月/期/条」。
    //   背景：前瞻批主句式「过去 365 天（…）365 个 PM10 日均中 ≤ … 占 30.1%」的「365 个」与「的/中」
    //   间隔 5 字符，落在旧第 2 条模式窗口 [^0-9%]{0,12}? 之外 ⇒ 旧实现取不到 n ⇒ 引擎按 n<30 拒出数。
    //   本副本（g2 逐字复制件）须与 p1b/src/evidence/baseRate.js 的 parseCount 同步，否则重冻结不自洽。
    /过去\s*([0-9]+)\s*(?:个|天|月|期|条)/g,
  ];
  for (const re of res) {
    let m; while ((m = re.exec(note)) !== null) { const v = Number(m[1]); if (isFinite(v) && v > 0 && v < 100000) ns.push(v); }
  }
  return ns.length ? Math.min.apply(null, ns) : null;
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const kinds = db.prepare(
  "SELECT DISTINCT json_extract(e.value,'$.resolve.kind') AS k FROM predictions p, json_each(p.evidence_json) e "
  + "WHERE json_extract(e.value,'$.resolve.kind') IS NOT NULL ORDER BY 1").all().map((r) => r.k);
const samples = [];
let scanned = 0, distinctNotes = 0;
for (const kind of kinds) {
  const rows = db.prepare(
    "SELECT p.id, p.layer, json_extract(e.value,'$.baseRateNote') note FROM predictions p, json_each(p.evidence_json) e "
    + "WHERE json_extract(e.value,'$.resolve.kind')=? AND json_extract(e.value,'$.baseRateNote') IS NOT NULL ORDER BY p.id").all(kind);
  const seen = new Set();
  for (const r of rows) {
    scanned++;
    if (seen.has(r.note)) continue;
    seen.add(r.note);
    if (seen.size > PER_KIND) break;
    distinctNotes++;
    samples.push({
      kind: kind, id: r.id, layer: r.layer, note: r.note,
      l2: l2Baseline({ baseRateNote: r.note }),
      g2: { base: g2ParseBaseRate(r.note), note_n: g2ParseNoteN(r.note) },
      l5: parseCertifiedFromNote(r.note),
    });
  }
}
const totalWithNote = db.prepare(
  "SELECT COUNT(*) n FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL").get().n;
db.close();

const fixture = {
  generated_at: new Date().toISOString(),
  generator: 'p1b/scripts/base-rate-golden.cjs',
  semantics: '重构前逐字实现冻结（l2=实模块 / l5=实模块 / g2=逐字复制）；重跑=重新冻结，不是校验',
  db: path.relative(ROOT, DB_PATH).replace(/\\/g, '/'),
  ledger_rows_with_note: totalWithNote,
  per_kind: PER_KIND,
  kinds: kinds.length,
  samples: samples,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(fixture, null, 1), 'utf8');
console.log('[golden] kind=' + kinds.length + ' samples=' + samples.length + ' (scanned ' + scanned + ' rows, 去重后每 kind ≤' + PER_KIND + ')');
console.log('[golden] 账本含注记行=' + totalWithNote + ' -> ' + OUT);
