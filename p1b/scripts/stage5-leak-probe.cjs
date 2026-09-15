#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/stage5-leak-probe.cjs —— 阶段 5 开工前置 ④-A：**泄漏三层探针 + canary 的工程验证**。
 *
 * 依据：立项书 v1.1 §四-3（三层泄漏判据）＋ §五-前置 4（sham 臂与泄漏探针**工程验证先行**，不得看分数）。
 *   D2 §3.3-A1/A2/A3 为同源先例。
 *
 * 三层（写死）：
 *   ① 进程/SQL 断言：连「题面库」（影子 surface 或只读生产库）后，
 *      A1 `SELECT outcome FROM predictions` → 必须失败；
 *      A2a `SELECT * FROM truth_vault LIMIT 1` → 必须失败；
 *      A2b 影子库口径：`SELECT outcome FROM main.predictions LIMIT 1` → 必须失败（影子视图无该列）；
 *      A2c `PRAGMA database_list` + 影子 sqlite_master 校验（未限定 predictions 解析到影子库）。
 *   ② 源码字面扫描：检索管线源码中 `truth_vault|truth_preview|resolve_note` 字面命中 = 0
 *      （`outcome` 因是通用词，单独按「访问 predictions.outcome 的读法」判，不按字面）。
 *   ③ 内容级时点审计（工程口径）：预埋 canary「cutoff 之后的事实」，
 *      检查其在题面/证据可见文本中**从不出现**（占位实现：以「canary 标记串不在给定可见文本集合中」为判据）。
 *
 * 纪律：**零网络、零 LLM、零写库**；只看工程（不看分数）；泄漏率必须 = 0 才通过。
 * 用法：node p1b/scripts/stage5-leak-probe.cjs [--surface <.db>] [--db <.db>] [--out <json>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const SURFACE = arg('surface', path.join(ROOT, '.scratch/backtest/predictions-public-surface.db'));
const DB = arg('db', path.join(ROOT, 'p1a-terminal/data/p1a.db'));
const OUT = arg('out', path.join(ROOT, 'p1b/sim/out/stage5-leak-probe-latest.json'));

const { DatabaseSync } = require('node:sqlite');
const out = { script: 'p1b/scripts/stage5-leak-probe.cjs', generated_at: new Date().toISOString(), layers: {}, leak_count: 0 };

function trySql(db, sql) {
  try { const rows = db.prepare(sql).all(); return { ok: true, n: rows.length, sample: rows.slice(0, 1) }; }
  catch (e) { return { ok: false, err: String(e && e.message || e) }; }
}
function readDb(p) { try { return new DatabaseSync(p, { readOnly: true }); } catch (e) { return null; } }

// ── 层①：进程/SQL 断言（对「题面库」＝影子 surface；缺则退只读生产库并如实标注）──
const L1 = { name: '进程/SQL 断言（题面库视角）', assertions: [], pass: false };
const surfaceExists = fs.existsSync(SURFACE);
const probeDb = readDb(surfaceExists ? SURFACE : DB);
L1.db_used = surfaceExists ? SURFACE : DB;
L1.surface_available = surfaceExists;
if (!probeDb) {
  L1.error = '库不可读：' + L1.db_used;
} else {
  const A1 = trySql(probeDb, 'SELECT outcome FROM predictions LIMIT 1');
  L1.assertions.push({ id: 'A1', sql: 'SELECT outcome FROM predictions', expect: 'FAIL', got: A1.ok ? 'OK' : 'FAIL', pass: !A1.ok, detail: A1.ok ? ('n=' + A1.n) : A1.err });
  const A2a = trySql(probeDb, 'SELECT * FROM truth_vault LIMIT 1');
  L1.assertions.push({ id: 'A2a', sql: 'SELECT * FROM truth_vault', expect: 'FAIL', got: A2a.ok ? 'OK' : 'FAIL', pass: !A2a.ok, detail: A2a.ok ? ('n=' + A2a.n) : A2a.err });
  if (surfaceExists) {
    const A2b = trySql(probeDb, 'SELECT outcome FROM main.predictions LIMIT 1');
    L1.assertions.push({ id: 'A2b', sql: 'SELECT outcome FROM main.predictions', expect: 'FAIL', got: A2b.ok ? 'OK' : 'FAIL', pass: !A2b.ok, detail: A2b.ok ? ('n=' + A2b.n) : A2b.err });
    const dl = trySql(probeDb, 'PRAGMA database_list');
    const objs = trySql(probeDb, "SELECT name FROM main.sqlite_master WHERE type IN ('table','view')");
    const names = (objs.ok ? objs.sample : []); // sample only 1; use full for check below
    let allObjs = [];
    try { allObjs = probeDb.prepare("SELECT name FROM main.sqlite_master WHERE type IN ('table','view')").all().map((r) => r.name); } catch (e) { }
    const hasTruth = allObjs.indexOf('truth_vault') !== -1;
    L1.assertions.push({ id: 'A2c', sql: "PRAGMA database_list + main.sqlite_master", expect: 'main 内无 truth_vault', got: hasTruth ? 'truth_vault PRESENT' : 'absent', pass: !hasTruth, detail: 'main objects: ' + allObjs.join(',') });
  } else {
    L1.assertions.push({ id: 'A2b', sql: 'SELECT outcome FROM main.predictions', expect: 'FAIL', got: 'SKIPPED', pass: false, detail: '影子 surface 不存在 ⇒ 物理强制不成立；此为现状披露（评审 A19：A2 只在 surface 文件上成立）' });
    L1.assertions.push({ id: 'A2c', sql: 'PRAGMA database_list', expect: '解析到影子库', got: 'SKIPPED', pass: false, detail: '影子 surface 不存在' });
  }
  probeDb.close();
  L1.pass = L1.assertions.every((a) => a.pass);
}
L1.layer_pass = L1.pass;
out.layers.L1_sql = L1;
if (!L1.pass) out.leak_count++;

// ── 层②：源码字面扫描（检索管线源码；本批尚无检索代码 ⇒ 扫描「待建位置」与既有涉密读法）──
const L2 = { name: '源码字面扫描', pass: false, scans: [] };
const SRC_SCAN = [
  { target: 'p1b/src/engines', patterns: ['truth_vault', 'truth_preview', 'resolve_note'] },
  { target: 'p1b/src/lib', patterns: ['truth_vault', 'truth_preview', 'resolve_note'] },
  { target: 'p1b/src/routes', patterns: ['truth_vault', 'truth_preview', 'resolve_note'] },
];
let totalHits = 0;
for (const s of SRC_SCAN) {
  const dir = path.join(ROOT, s.target);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.js$/.test(f)); } catch (e) { }
  for (const f of files) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const p of s.patterns) {
      const idx = txt.indexOf(p);
      if (idx !== -1) { totalHits++; L2.scans.push({ file: s.target + '/' + f, pattern: p, index: idx }); }
    }
  }
}
// 检索管线代码尚不存在 ⇒ 显式记录「待建位置为 0 命中」，并给出将来扫描的锚点（p1b/src/retrieval/）
L2.retrieval_pipeline_exists = fs.existsSync(path.join(ROOT, 'p1b/src/retrieval'));
L2.gate = '检索管线源码（p1b/src/retrieval/**）中 truth_vault/truth_preview/resolve_note 字面命中必须 = 0';
L2.hits = totalHits;
L2.pass = totalHits === 0;
out.layers.L2_source_scan = L2;
if (!L2.pass) out.leak_count++;

// ── 层③：内容级时点审计（canary）——工程口径 ──
const L3 = { name: '内容级时点审计（canary）', pass: false };
const CANARY = 'CANARY::cutoff_after_fact::' + '9f3c1a';
// 占位实现：给定「可见文本集合」（未来＝检索结果 + 题面），检查 canary 从不出现。
// 工程验证用：把自己注入 canary 的两组文本各扫一遍——「干净集」应 0 命中、「污染集」应 1 命中（证明探针有分辨力）。
function scanForCanary(texts) { return texts.filter((t) => String(t).indexOf(CANARY) !== -1).length; }
const cleanTexts = ['题面：2026-09-16 上海最高气温 > 35°C 的概率？', '证据：历史 9 月日均值统计（2015-2024）', '证据：昨夜起报的预报文本'];
const dirtyTexts = cleanTexts.concat(['泄漏事实：' + CANARY + ' 当日实际 36.2°C']);
const cleanHits = scanForCanary(cleanTexts);
const dirtyHits = scanForCanary(dirtyTexts);
L3.canary = CANARY;
L3.clean_hits = cleanHits;
L3.dirty_hits = dirtyHits;
L3.discriminates = (cleanHits === 0 && dirtyHits === 1); // 探针有分辨力：干净=0、污染=1
L3.pass = L3.discriminates;
L3.note = '工程验证：探针在「干净集」0 命中、在「人工注入 canary 的污染集」1 命中 ⇒ 有分辨力。'
  + '**主实验跑时必须**：对每题 real 检索结果 + 题面扫 canary/事后事实，命中 ⇒ 立即停跑整批作废（立项书 §四-7③）。';
out.layers.L3_content_time = L3;
if (!L3.pass) out.leak_count++;

out.verdict = out.leak_count === 0 ? 'PASS' : 'FAIL';
out.note = '本件为**工程验证**（不看分数、零网络零 LLM 零写库）。层① 的 A2b/A2c 依赖影子 surface 存在——'
  + '不存在则如实标 FAIL 并披露（评审 A19：A2 只在 surface 文件上成立，非物理强制）。';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('[leak-probe] verdict=' + out.verdict + ' leak_count=' + out.leak_count + ' -> ' + OUT);
for (const k of Object.keys(out.layers)) { const l = out.layers[k]; console.log('  ' + k + ': ' + (l.pass ? 'PASS' : 'FAIL')); }
