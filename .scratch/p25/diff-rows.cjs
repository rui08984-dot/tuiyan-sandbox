'use strict';
/*
 * diff-rows.cjs — 两库逐表逐行 diff（零翻转核验）
 * 用法：node .scratch/p25/diff-rows.cjs <before.db> <after.db> [--key=id] [--tables=a,b,c] [--out=<json>]
 * 口径：逐表取全列 ORDER BY rowid ⇒ 以 key 列建索引 ⇒ 比「行集合」与「每行字段」。
 *   输出：每表 {rows_before, rows_after, added, removed, changed, changed_ids[]}
 *   ★差异总数与 id 清单必须落盘（不是「看起来没变」）。
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const [A, B] = process.argv.slice(2).filter((x) => x.indexOf('--') !== 0);
const arg = (n, d) => { const a = process.argv.filter((x) => x.indexOf('--' + n + '=') === 0)[0]; return a ? a.slice(n.length + 3) : d; };
const KEY = arg('key', 'id');
const TABLES = arg('tables', 'predictions,verdicts,truth_vault,games,events,claims').split(',');
const OUT = arg('out', null);
if (!A || !B) { console.error('[diff] 用法：node diff-rows.cjs <before.db> <after.db>'); process.exit(2); }

// ★key 列按表实测（truth_vault 的 PK 是 prediction_id，不是 id）——
//   首版硬用 'id' ⇒ 该表每行 key 都是 undefined ⇒ 全部塌进同一个 Map 槽 ⇒ 静默报「1 行、0 变化」。
//   修法：逐表读 PRAGMA 取 PK；PK 解析不出 ⇒ **硬失败**（禁静默降级）。
function keyOf(p, t) {
  const db = new DatabaseSync(p, { readOnly: true });
  const cols = db.prepare('PRAGMA table_info(' + t + ')').all();
  db.close();
  if (KEY !== 'id' && cols.some((c) => c.name === KEY)) return KEY;
  const pk = cols.filter((c) => c.pk).map((c) => c.name);
  if (pk.length !== 1) { console.error('[diff] 表 ' + t + ' 的 PK 解析不出（pk=' + JSON.stringify(pk) + '）⇒ exit 3'); process.exit(3); }
  return pk[0];
}

function load(p, t, k) {
  const db = new DatabaseSync(p, { readOnly: true });
  const rows = db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all();
  db.close();
  const m = new Map();
  for (const r of rows) {
    const v = r[k];
    if (v === undefined) { console.error('[diff] 表 ' + t + ' key=' + k + ' 取值为 undefined ⇒ exit 3（防塌陷）'); process.exit(3); }
    m.set(String(v), r);
  }
  return m;
}

const report = { before: A, after: B, key: KEY, tables: {} };
for (const t of TABLES) {
  const k = keyOf(A, t);
  const mb = load(A, t, k), ma = load(B, t, k);
  report.tables[t] = report.tables[t] || {};
  report.tables[t].key = k;
  const added = [], removed = [], changed = [], changedDetail = [];
  for (const k of ma.keys()) if (!mb.has(k)) added.push(k);
  for (const k of mb.keys()) if (!ma.has(k)) removed.push(k);
  for (const k of mb.keys()) {
    if (!ma.has(k)) continue;
    const rb = mb.get(k), ra = ma.get(k);
    const diffs = [];
    for (const f of Object.keys(rb)) {
      if (JSON.stringify(rb[f]) !== JSON.stringify(ra[f])) diffs.push({ field: f, before: rb[f], after: ra[f] });
    }
    if (diffs.length) { changed.push(k); changedDetail.push({ key: k, fields: diffs.map((d) => d.field), diffs }); }
  }
  report.tables[t] = Object.assign(report.tables[t], {
    rows_before: mb.size, rows_after: ma.size,
    added: added.length, removed: removed.length, changed: changed.length,
    added_ids: added.slice(0, 50), removed_ids: removed.slice(0, 50), changed_ids: changed.slice(0, 50),
    changed_detail: changedDetail.slice(0, 50),
  });
  const r = report.tables[t];
  console.log('[diff] ' + t + '（key=' + k + '）：before=' + r.rows_before + ' after=' + r.rows_after +
    '｜added=' + r.added + ' removed=' + r.removed + ' changed=' + r.changed +
    (r.changed ? '｜changed_ids=' + changed.slice(0, 20).join(',') : ''));
  if (t === 'predictions' && r.changed) {
    const byField = {};
    for (const d of changedDetail) for (const f of d.fields) byField[f] = (byField[f] || 0) + 1;
    console.log('[diff]   predictions 变化字段分布：' + JSON.stringify(byField));
  }
}
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8'); console.log('[diff] wrote ' + OUT); }
