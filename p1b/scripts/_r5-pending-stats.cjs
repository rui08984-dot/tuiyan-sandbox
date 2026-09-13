'use strict';
// _r5-pending-stats：未结算 corpus 行的相位/kind 分布（backfill = 目标日已过）
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const q = (sql, ...a) => db.prepare(sql).all(...a);
const byPhase = q("SELECT json_extract(e.value,'$.phase') ph, COUNT(*) n FROM predictions p, json_each(p.evidence_json) e WHERE p.outcome IS NULL AND json_extract(e.value,'$.resolve.kind') IS NOT NULL GROUP BY ph ORDER BY n DESC");
const bf = q("SELECT json_extract(e.value,'$.resolve.kind') k, COUNT(*) n FROM predictions p, json_each(p.evidence_json) e WHERE p.outcome IS NULL AND json_extract(e.value,'$.phase')='backfill' GROUP BY k ORDER BY n DESC");
const done = q("SELECT COUNT(*) n FROM predictions WHERE outcome IS NOT NULL")[0].n;
const donePh = q("SELECT json_extract(e.value,'$.phase') ph, COUNT(*) n FROM predictions p, json_each(p.evidence_json) e WHERE p.outcome IS NOT NULL GROUP BY ph ORDER BY n DESC");
console.log('resolved_total=' + done + '  byPhase=' + JSON.stringify(donePh));
console.log('unsettled_by_phase=' + JSON.stringify(byPhase));
console.log('unsettled_backfill_total=' + bf.reduce((a, x) => a + x.n, 0));
console.log('unsettled_backfill_by_kind=' + JSON.stringify(bf));
db.close();
