'use strict';
/*
 * .scratch/p31/fingerprint.cjs —— 六表 SQL 级指纹（只读；口径＝p25/fingerprint.cjs 同源）
 * 用法：node .scratch/p31/fingerprint.cjs [--db=<path>] [--out=<json>]
 * 口径：逐表 SELECT * ORDER BY rowid ⇒ JSON.stringify ⇒ sha256 前 16 位。
 * 只读打开（readonly:true）⇒ 零写入；--db 缺省＝生产库（实际路径恒入 stdout）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const B = require(path.join(__dirname, '..', '..', 'p1a-terminal', 'node_modules', 'better-sqlite3'));

const ROOT = path.resolve(__dirname, '..', '..');
const arg = (n, d) => { const a = process.argv.filter((x) => x.indexOf('--' + n + '=') === 0)[0]; return a ? a.slice(n.length + 3) : d; };
const DB = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT = arg('out', null);

const TABLES = ['predictions', 'games', 'verdicts', 'events', 'claims', 'players'];
const db = new B(DB, { readonly: true, fileMustExist: true });
const o = { db: DB, generated_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00', tables: {} };
for (const t of TABLES) {
  const rows = db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all();
  o.tables[t] = { n: rows.length, sha16: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16) };
}
o.predictions_max_id = db.prepare('SELECT MAX(id) m FROM predictions').get().m;
o.resolved = db.prepare('SELECT COUNT(*) c FROM predictions WHERE outcome IS NOT NULL').get().c;
o.integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
db.close();

console.log('[fp] db=' + o.db);
for (const t of TABLES) console.log('[fp] ' + t + ' n=' + o.tables[t].n + ' sha16=' + o.tables[t].sha16);
console.log('[fp] MAX(id)=' + o.predictions_max_id + ' | resolved=' + o.resolved + ' | integrity=' + o.integrity);
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(o, null, 1), 'utf8'); console.log('[fp] wrote ' + OUT); }
