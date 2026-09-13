'use strict';
// 微步2 探测：172 类行的构成（只读）
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT p.id, p.matures_at, p.created_at, json_extract(e.value,'$.resolve.kind') k, json_extract(e.value,'$.resolve.issue') iss FROM predictions p, json_each(p.evidence_json) e WHERE p.g2_regime='R4' AND json_extract(e.value,'$.resolve.date') IS NULL AND p.statement LIKE '%【backfill】%' AND p.matures_at IS NULL").all();
const byk = {};
for (const r of rows) byk[r.k] = (byk[r.k] || 0) + 1;
console.log('bf_no_matures_by_kind=' + JSON.stringify(byk) + ' total=' + rows.length);
const s = db.prepare("SELECT p.id, p.matures_at, p.created_at, json_extract(e.value,'$.resolve.kind') k FROM predictions p, json_each(p.evidence_json) e WHERE p.g2_regime='R4' AND json_extract(e.value,'$.resolve.date') IS NULL AND p.matures_at IS NOT NULL AND p.statement LIKE '%【backfill】%' LIMIT 3").all();
console.log('bf_with_matures_sample=' + JSON.stringify(s));
db.close();
