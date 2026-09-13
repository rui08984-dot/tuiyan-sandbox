'use strict';
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const ks = db.prepare("SELECT json_extract(e.value,'$.resolve.kind') k, COUNT(DISTINCT p.id) n FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind') IS NOT NULL GROUP BY k ORDER BY n DESC").all();
console.log('KINDS=' + ks.length);
const fileKeys = new Set();
for (const r of ks) {
  const row = db.prepare("SELECT e.value AS ev FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=? LIMIT 1").get(r.k);
  let fl = {};
  try { const o = JSON.parse(row.ev); fl = o.resolve || {}; } catch (e) { fl = { __err: e.message }; }
  const keys = Object.keys(fl).filter((x) => /date|day|period|month|issue|time|end|start|expect|week|year/i.test(x));
  keys.forEach((k) => fileKeys.add(k));
  console.log('  ' + r.n + '\t' + r.k + '\t[' + keys.join(',') + ']');
}
console.log('DATE-LIKE FIELDS=' + JSON.stringify([...fileKeys].sort()));
db.close();