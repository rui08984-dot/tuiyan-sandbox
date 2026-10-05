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
const SURFACE = arg('surface', path.join(ROOT, 'docs/assets/backtest/predictions-public-surface.db'));
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

// ── 层②：源码字面扫描 ──
// ★2026-09-28 收口重写。原实现扫的是硬编码目录表 [engines / lib / routes]，
//   注释自陈「本批尚无检索代码 ⇒ 扫描『待建位置』」——**那个前提今天已不成立**：
//   p1b/src/retrieval/ 已存在，而探针自己的 gate 串与立项书 v1.1 §四-3② 写的门
//   恰恰是「**检索管线**源码中密封列字面命中 = 0」，即它声明要守的那道门**当时根本没扫**。
//   同一时刻，占位目录表里的 p1b/src/routes 反而把**结算/审计面**判成了泄漏。
// 判据归属（据立项书 v1.1 §四-3②「禁检索管线访问 resolve.url_template …」+ process_roles 角色表）：
//   密封列 truth_vault / truth_preview / resolve_note 的合法读者只有两类角色：
//     · resolver（结算回填）· scorer（事后算分/口径审计）——**结算之后**才碰得到真值；
//     · participant / backtest（题面/检索侧）——forbidden 明列这三列，**题时面**一律不得出现。
//   ⇒ 重写为「角色感知的全域扫描」：p1b/src 下逐文件扫，凡命名密封列者，
//     必须落在**显式声明**的结算/审计面白名单里；其余（含任何新目录、新文件）**默认判泄漏**。
const L2 = { name: '源码字面扫描（角色感知·全域）', pass: false, scans: [] };
const SEALED = ['truth_vault', 'truth_preview', 'resolve_note'];
/** 题时面（participant/backtest 角色）：检索管线 + 预答计算面。这几处命中 = 泄漏。 */
const QUESTION_TIME_DIRS = ['p1b/src/retrieval', 'p1b/src/engines', 'p1b/src/lib'];
/**
 * 结算/审计面（resolver/scorer 角色）：按设计**必须**能命名密封列——
 * 写回填（resolve 端点）、读展示（单题详情）、判口径缺陷（真值锚是不是当时的预报值）、事后算资格池。
 * 这些是**结算之后**的路径，泄漏面由层① 的只读题面视图 predictions_public 封住（见 L2.boundary）。
 * 逐条带角色与理由入表；不是「按目录放行」，是**按文件 + 按角色**逐条说清为什么它不是泄漏。
 */
const POST_ANSWER_ALLOW = [
  { file: 'p1b/src/routes/predictions.js', role: 'resolver', why: '结算回填（写 resolve_note）＋ 结算后只读展示（GET /api/predictions/:id）与真值口径缺陷判定；结算前该行 outcome/resolve_note 本就为 NULL' },
  { file: 'p1b/src/db/predictionsStore.js', role: 'resolver', why: '账本真值回填的唯一写入点（UPDATE … resolve_note = ?）' },
  { file: 'p1b/src/evidence/truthBasis.js', role: 'scorer', why: '真值口径缺陷谓词单一真源：判「这个真值其实是当时的预报值」并排除出读数——**防泄漏的那一侧**' },
  { file: 'p1b/src/evidence/stage5Pool.js', role: 'scorer', why: '事后配对资格池（按 outcome/matures_at/resolved_at 筛池），题时面不读' },
  { file: 'p1b/src/db/intakeStore.js', role: 'resolver', why: 'process_roles 角色表 + truth_vault 建表 + predictions_public 只读题面视图 DDL：它是**边界本身**的声明处' },
];
const ALLOW_SET = new Set(POST_ANSWER_ALLOW.map((a) => a.file));

function jsFilesRecursive(dir) {                       // 返回相对 ROOT 的 posix 风格路径
  const outFiles = [];
  (function walk(d) {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.js$/.test(e.name)) outFiles.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  })(dir);
  return outFiles;
}
function sealedHitsIn(rel) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return []; }
  const hits = [];
  for (const p of SEALED) {
    let from = 0, idx;
    while ((idx = txt.indexOf(p, from)) !== -1) { hits.push({ file: rel, pattern: p, index: idx }); from = idx + p.length; }
  }
  return hits;
}

// ②a 题时面门（探针 gate 串与立项书点名的真门）：检索管线**必须存在**（不存在 ⇒ FAIL，不许空过），
//    递归扫 p1b/src/retrieval/** ＋ 它的 require 传递闭包（防「把读真值的那行挪到隔壁文件再 require 过来」）＋ engines/lib。
L2.retrieval_pipeline_exists = fs.existsSync(path.join(ROOT, 'p1b/src/retrieval'));
L2.gate = '题时面（p1b/src/retrieval/** 及其 require 传递闭包 ＋ p1b/src/engines ＋ p1b/src/lib）中 '
  + SEALED.join('|') + ' 字面命中必须 = 0，且检索管线必须存在（不存在不得空过）';
const closure = new Set();
if (L2.retrieval_pipeline_exists) {
  const roots = jsFilesRecursive(path.join(ROOT, 'p1b/src/retrieval'));
  const queue = roots.slice();
  while (queue.length) {                            // require 传递闭包（仅 p1b/src 内相对 require）
    const rel = queue.pop();
    if (closure.has(rel)) continue;
    closure.add(rel);
    let txt = '';
    try { txt = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { continue; }
    const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const abs = path.resolve(path.dirname(path.join(ROOT, rel)), m[1]);
      for (const cand of [abs + '.js', path.join(abs, 'index.js'), abs]) {
        const r = path.relative(ROOT, cand).split(path.sep).join('/');
        if (r.startsWith('p1b/src/') && /\.js$/.test(r) && fs.existsSync(path.join(ROOT, r)) && !closure.has(r)) queue.push(r);
      }
    }
  }
}
L2.retrieval_closure = Array.from(closure).sort();
const questionTimeFiles = new Set();
for (const d of QUESTION_TIME_DIRS) for (const f of jsFilesRecursive(path.join(ROOT, d))) questionTimeFiles.add(f);
for (const f of L2.retrieval_closure) questionTimeFiles.add(f);
L2.question_time_files_scanned = questionTimeFiles.size;
if (!L2.retrieval_pipeline_exists) {
  L2.scans.push({ file: 'p1b/src/retrieval', pattern: '(目录不存在)', index: -1, note: '检索管线缺失 ⇒ 门无从成立，判 FAIL（不得空过）' });
  L2.hits = 1;
} else {
  let qtHits = 0;
  for (const f of questionTimeFiles) {
    for (const h of sealedHitsIn(f)) { qtHits++; L2.scans.push(h); }
  }
  L2.hits = qtHits;
}

// ②b 角色门（堵「把文件挪个目录就绕过 ②a」）：p1b/src **全域**逐文件扫，
//     不在结算/审计面白名单里的命中一律计入 hits（默认判泄漏＝fail-closed）。
L2.post_answer_named = [];
let strayHits = 0;
for (const f of jsFilesRecursive(path.join(ROOT, 'p1b/src'))) {
  if (ALLOW_SET.has(f)) continue;                   // 白名单文件在下面单独披露
  for (const h of sealedHitsIn(f)) { strayHits++; L2.scans.push(h); }
}
L2.hits += strayHits;
L2.stray_hits_outside_declared_roles = strayHits;

// ②c 白名单自证：逐条核对 role 确实是 process_roles 里声明过的结算/审计角色，
//     并核对结算/审计面与题时面的物理边界（predictions_public 视图不含密封列、
//     participant/backtest 角色 forbidden 明列三列）——白名单不是「按目录放行」，它挂在真实边界上。
L2.boundary = { checks: [], pass: true };
(function boundary() {
  const intake = fs.readFileSync(path.join(ROOT, 'p1b/src/db/intakeStore.js'), 'utf8');
  const badRoles = POST_ANSWER_ALLOW.filter((a) => ['resolver', 'scorer'].indexOf(a.role) === -1);
  L2.boundary.checks.push({ id: 'B1', desc: '白名单每条都声明为 resolver/scorer 角色', pass: badRoles.length === 0 });
  const viewStart = intake.indexOf('PREDICTIONS_PUBLIC_SQL');
  const viewTxt = viewStart === -1 ? '' : intake.slice(viewStart, viewStart + 3000);
  const viewClean = SEALED.every((p) => viewTxt.indexOf('p.' + p) === -1);
  L2.boundary.checks.push({ id: 'B2', desc: '只读题面视图 predictions_public 的列清单不含 p.outcome/p.resolved_at/p.resolve_note', pass: viewClean });
  const forbidOk = ['participant', 'backtest'].every((r) => {
    const i = intake.indexOf("role: '" + r + "'");
    if (i === -1) return false;
    const seg = intake.slice(i, i + 900);
    return ['truth_vault', 'predictions.outcome', 'predictions.resolve_note'].every((p) => seg.indexOf(p) !== -1);
  });
  L2.boundary.checks.push({ id: 'B3', desc: 'process_roles：participant/backtest 的 forbidden 明列密封列', pass: forbidOk });
  L2.boundary.pass = L2.boundary.checks.every((c) => c.pass);
})();
L2.boundary_ok = L2.boundary.pass;

// 白名单逐条如实披露（不隐藏：这些文件确实命名了密封列，理由写在 why 里）
for (const a of POST_ANSWER_ALLOW) {
  const hits = sealedHitsIn(a.file);
  L2.post_answer_named.push({
    file: a.file, role: a.role, why: a.why,
    n: hits.length,
    patterns: Array.from(new Set(hits.map((h) => h.pattern))).sort(),
  });
}
L2.pass = L2.hits === 0 && L2.boundary_ok;
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
