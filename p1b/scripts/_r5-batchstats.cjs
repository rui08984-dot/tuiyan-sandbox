'use strict';
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const q = (sql) => db.prepare(sql).all();
console.log('unsettled_by_evidence_kind=' + JSON.stringify(q("SELECT json_extract(e.value,'$.kind') k, COUNT(*) n FROM predictions p, json_each(p.evidence_json) e WHERE p.outcome IS NULL AND json_extract(e.value,'$.resolve.kind') IS NOT NULL GROUP BY k ORDER BY n DESC")));
console.log('resolved_by_evidence_kind=' + JSON.stringify(q("SELECT json_extract(e.value,'$.kind') k, COUNT(*) n FROM predictions p, json_each(p.evidence_json) e WHERE p.outcome IS NOT NULL AND json_extract(e.value,'$.kind') LIKE '%backfill%' GROUP BY k ORDER BY n DESC")));
db.close();
