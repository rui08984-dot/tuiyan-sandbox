'use strict';
/*
 * fingerprint.cjs — 六表 SQL 级指纹（例行结算批的可复算入口）
 * 用法：node .scratch/p25/fingerprint.cjs [--db=<path>] [--due=YYYY-MM-DD] [--out=<json>]
 * 口径与 decouple9-promote.cjs 的 fingerprint() 同源：逐表 SELECT * ORDER BY rowid ⇒ JSON ⇒ sha256 前 16 位。
 * 只读打开（readOnly:true）⇒ 零写入；--db 缺省＝生产库（实际路径恒入 stdout）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const arg = (n, d) => { const a = process.argv.filter((x) => x.indexOf('--' + n + '=') === 0)[0]; return a ? a.slice(n.length + 3) : d; };
const DB = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const DUE = arg('due', new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10));
const OUT = arg('out', null);

const TABLES = ['predictions', 'verdicts', 'truth_vault', 'games', 'events', 'claims'];
const db = new DatabaseSync(DB, { readOnly: true });
const o = { db: DB, due_date: DUE, tables: {} };
for (const t of TABLES) {
  const rows = db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all();
  o.tables[t] = { rows: rows.length, sha16: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16) };
}
o.predictions_max_id = db.prepare('SELECT MAX(id) m FROM predictions').get().m;
o.resolved = db.prepare('SELECT COUNT(*) c FROM predictions WHERE resolved_at IS NOT NULL').get().c;
o.unresolved = o.tables.predictions.rows - o.resolved;
o.due = db.prepare('SELECT COUNT(*) c FROM predictions WHERE resolved_at IS NULL AND matures_at IS NOT NULL AND matures_at <= ?').get(DUE + 'T23:59:59Z').c;
o.due_by_layer = {};
for (const r of db.prepare('SELECT layer, COUNT(*) c FROM predictions WHERE resolved_at IS NULL AND matures_at IS NOT NULL AND matures_at <= ? GROUP BY layer ORDER BY layer').all(DUE + 'T23:59:59Z')) o.due_by_layer[r.layer] = r.c;
o.integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
db.close();

const line = TABLES.map((t) => t + '=' + o.tables[t].rows + '/' + o.tables[t].sha16).join('｜');
console.log('[fp] db=' + o.db + ' due=' + o.due_date);
console.log('[fp] ' + line);
console.log('[fp] resolved=' + o.resolved + '｜unresolved=' + o.unresolved + '｜due=' + o.due + '｜integrity=' + o.integrity);
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(o, null, 2), 'utf8'); console.log('[fp] wrote ' + OUT); }
