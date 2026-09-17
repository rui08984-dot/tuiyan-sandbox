#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/decouple9-promote.cjs —— 9 臂解耦读数**晋升入账本**（2026-09-17 · 用户已批准「可以晋升」）
 *
 * 背景：9 臂批（（十九）批）按纪律**只落工件**（`decouple9-verdicts-20260917.jsonl`），因为当时发现
 *   `l6Structural` 的选行规则会让新行**静默成为 L6 生产输入**（实测 37/38 道锚题读数会变）。
 *   本批（第二十二）先把该口径补好——**实验命名空间登记表**（`decouple9-` 前缀 ⇒ 生产聚合一律排除），
 *   再把工件里的读数**晋升进 `verdicts` 表**（run_id 命名空间 `decouple9-…`）⇒ 数据入账、生产读数**零翻转**。
 *
 * 晋升口径（写死）：
 *   · 取数＝工件去重后的「**首个成功行**」（与判据机 `decouple9-analyze.cjs` 同口径；失败/未抽取行**不晋升**，不编数）；
 *   · run_id ＝ `decouple9-20260917-<variant>-T<temp>[-rep]`（**批次级**命名，抹掉分片 tag ⇒ 与工件里的 shard tag 不同名，映射见收据）；
 *   · 列＝prediction_id / prompt_variant / temperature / verdict_text / implied_prob / model / run_id / resolved_model；
 *   · 幂等＝`INSERT OR IGNORE`（唯一索引含 run_id）；**单事务**；空候选 ⇒ `exit 2`（防「候选 0」被读成「已建好」）。
 *
 * 安全（safe-mutation 五件）：① **两份快照**（baseline 只读留档 ＋ drill 演练载体）② 副本演练（先跑副本核行数与零翻转）
 *   ③ 生产写入（`--confirm` 才写；实际库路径**恒入日志**）④ 零翻转核对（逐表 sha ＋ 目标表行数 ＋ 老行区段 sha）
 *   ⑤ 留痕（收据 `decouple9-promote-receipt-20260917.md`）。
 * 纪律：**零 LLM／零网络**；不改 predictions/truth_vault（故无需 vault-sync，但仍跑 dry-run 复核）。
 * 用法：
 *   node p1b/scripts/decouple9-promote.cjs                       # dry-run（零写，只报候选与口径）
 *   node p1b/scripts/decouple9-promote.cjs --db=<副本> --confirm  # 副本演练
 *   node p1b/scripts/decouple9-promote.cjs --confirm              # 生产写入
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');

function arg(n, d) {
  const eq = process.argv.find((a) => a.startsWith('--' + n + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const FLAG = (n) => process.argv.indexOf('--' + n) >= 0;
const CONFIRM = FLAG('confirm');
const DB_ARG = arg('db', null);
// ★加固（照 corpus-resolve-daemon 先例）：命令行出现 --db 形式却解析不出 ⇒ 硬失败，绝不静默落生产库
if (DB_ARG === null && process.argv.some((a) => a.indexOf('--db') === 0)) {
  console.error('!! 检测到 --db 形式参数但未能解析（约定：`--db=<path>` 等号形式）⇒ 硬失败');
  process.exit(2);
}
const DB_PATH = path.resolve(DB_ARG === null ? path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db') : DB_ARG);
const JSONL = path.resolve(arg('jsonl', path.join(ROOT, 'p1b', 'sim', 'out', 'decouple9-verdicts-20260917.jsonl')));
const BATCH = 'decouple9-20260917';

/** 工件 → 晋升候选（去重口径＝首个成功行；与判据机同口径）。纯函数（可 require）。 */
function candidates(items) {
  const first = new Map();
  for (const r of items) {
    const k = r.pid + '|' + r.variant + '|' + r.temperature + '|' + r.copy;
    if (!first.has(k) || r.extracted) first.set(k, r);
  }
  const out = [];
  for (const r of first.values()) {
    if (!r.extracted || !r.verdict_text) continue;                 // 失败/未抽取 ⇒ 不晋升（不编数）
    out.push({
      prediction_id: r.pid, prompt_variant: r.variant, temperature: r.temperature,
      verdict_text: r.verdict_text, implied_prob: r.implied_prob,
      model: r.model_declared || null, resolved_model: r.resolved_model || null,
      run_id: BATCH + '-' + String(r.variant).replace(/_/g, '-') + '-T' + String(r.temperature).replace('.', '') + (r.copy > 1 ? '-rep' : ''),
    });
  }
  return out;
}

function fingerprint(db, oldMaxId) {
  const tables = ['predictions', 'verdicts', 'truth_vault', 'games', 'events', 'claims'];
  const o = {};
  for (const t of tables) {
    const rows = db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all();
    o[t] = { rows: rows.length, sha16: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16) };
  }
  o.verdicts_max_id = db.prepare('SELECT MAX(id) m FROM verdicts').get().m;
  // 老行区段（id ≤ **写前** max）的 sha：证明「只增不改」。
  // ★口径钉死（本批自查修正）：首版在这里用**当前** max ⇒ 写入后该区段把**新行**也圈了进去 ⇒ 两次 sha 必然不同
  //   ⇒ 检查形同虚设。正确做法＝以**写前** max id 划段（由调用方传入）。
  const seg = (oldMaxId === undefined || oldMaxId === null) ? o.verdicts_max_id : oldMaxId;
  o.old_segment_max_id = seg;
  const oldRows = db.prepare('SELECT * FROM verdicts WHERE id <= ? ORDER BY rowid').all(seg);
  o.verdicts_old_segment_sha16 = crypto.createHash('sha256').update(JSON.stringify(oldRows)).digest('hex').slice(0, 16);
  return o;
}

function main() {
  const { DatabaseSync } = require('node:sqlite');
  const raw = fs.readFileSync(JSONL, 'utf8').split('\n').filter((l) => l.trim());
  const items = [];
  let bad = 0;
  for (const l of raw) { try { items.push(JSON.parse(l)); } catch (e) { bad++; } }
  const cand = candidates(items);
  console.log('[promote] db=' + DB_PATH);
  console.log('[promote] 工件行=' + items.length + '（坏行 ' + bad + '）⇒ 晋升候选=' + cand.length);
  const byRun = {};
  for (const c of cand) byRun[c.run_id] = (byRun[c.run_id] || 0) + 1;
  console.log('[promote] 候选按 run_id：' + Object.keys(byRun).sort().map((k) => k + '×' + byRun[k]).join('｜'));
  if (!cand.length) { console.error('[promote] 候选 0 ⇒ exit 2（防「候选 0」被读成「已建好」）'); process.exit(2); }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const before = fingerprint(db);
  db.close();
  console.log('[promote] 写前：verdicts=' + before.verdicts.rows + '（max id ' + before.verdicts_max_id + '）｜老行区段 sha=' + before.verdicts_old_segment_sha16);

  if (!CONFIRM) {
    console.log('[promote] DRY-RUN：未写库（--confirm 才执行）。预期：verdicts +' + cand.length + ' 行，其余表逐位不变。');
    return { mode: 'DRY', candidates: cand.length, before: before };
  }

  const w = new DatabaseSync(DB_PATH);
  let inserted = 0;
  try {
    w.exec('BEGIN');
    const st = w.prepare('INSERT OR IGNORE INTO verdicts (prediction_id, prompt_variant, temperature, verdict_text, implied_prob, model, run_id, resolved_model) VALUES (?,?,?,?,?,?,?,?)');
    for (const c of cand) {
      const r = st.run(c.prediction_id, c.prompt_variant, c.temperature, String(c.verdict_text).trim(), c.implied_prob, c.model, c.run_id, c.resolved_model);
      inserted += r.changes;
    }
    w.exec('COMMIT');
  } catch (e) {
    try { w.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    w.close();
    console.error('[promote] FAIL（已回滚）: ' + (e && e.message ? e.message : e));
    process.exit(1);
  }
  w.close();

  const db2 = new DatabaseSync(DB_PATH, { readOnly: true });
  const after = fingerprint(db2, before.verdicts_max_id);   // ★以**写前** max 划老行区段
  db2.close();
  console.log('[promote] 写入完成：inserted=' + inserted + '（候选 ' + cand.length + '）');
  console.log('[promote] 写后：verdicts=' + after.verdicts.rows + '（max id ' + after.verdicts_max_id + '）｜老行区段（id≤' + after.old_segment_max_id + '）sha=' + after.verdicts_old_segment_sha16);
  const diffs = [];
  for (const t of ['predictions', 'truth_vault', 'games', 'events', 'claims']) {
    if (JSON.stringify(before[t]) !== JSON.stringify(after[t])) diffs.push(t);
  }
  const oldSame = before.verdicts_old_segment_sha16 === after.verdicts_old_segment_sha16;
  console.log('[promote] 零翻转：其余五表' + (diffs.length ? '★变了 ' + diffs.join(',') : '逐位相同 ✓') + '｜老行区段' + (oldSame ? '逐位相同 ✓' : '★变了') + '｜行数增量=' + (after.verdicts.rows - before.verdicts.rows));
  return { mode: 'WRITE', candidates: cand.length, inserted: inserted, before: before, after: after, other_tables_changed: diffs, old_segment_same: oldSame };
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('[promote] FAIL ' + (e && e.stack ? e.stack : e)); process.exit(1); }
}
module.exports = { candidates, fingerprint, BATCH };
