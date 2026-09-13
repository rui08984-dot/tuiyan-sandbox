'use strict';
const crypto = require('crypto');
const fs = require('fs');
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const KINDS = ['openmeteo_daily_max', 'dbnomics_series_value', 'cwl_ssq_red_contains', 'cwl_ssq_blue_odd'];
let tot = 0;
for (const k of KINDS) {
  const n = db.prepare("SELECT COUNT(DISTINCT p.id) n FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=? AND json_extract(e.value,'$.baseRateNote') IS NULL").get(k).n;
  tot += n; console.log('missing ' + k + ' = ' + n);
}
console.log('missing TOTAL = ' + tot);
console.log('predictions rows = ' + db.prepare('SELECT COUNT(*) n FROM predictions').get().n);
console.log('integrity_check = ' + db.prepare('PRAGMA integrity_check').get().integrity_check);
const cs = db.prepare("SELECT COUNT(*) n FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL").get().n;
console.log('elements with baseRateNote = ' + cs);
db.close();
const buf = fs.readFileSync('E:/music player/p1a-terminal/data/p1a.db');
console.log('p1a.db bytes = ' + buf.length + ' sha256 = ' + crypto.createHash('sha256').update(buf).digest('hex').toUpperCase());