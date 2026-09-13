'use strict';
/** 只读探测 p1a.db 现状：sqlite_master 全量 + predictions 元信息 + 计数。零写。 */
const path = require('path');
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const DB = process.argv[2] || path.join(__dirname, '..', '..', 'p1a-terminal', 'data', 'p1a.db');
const db = new Database(DB, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 15000');
const out = { db: DB, objects: {}, predictions: {}, counts: {}, integrity: null };
out.objects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
out.predictions.table_info = db.prepare("PRAGMA table_info(predictions)").all();
out.predictions.index_list = db.prepare("PRAGMA index_list(predictions)").all();
out.predictions.fk_list = db.prepare("PRAGMA foreign_key_list(predictions)").all();
out.predictions.index_xinfo = {};
for (const ix of out.predictions.index_list) {
  out.predictions.index_xinfo[ix.name] = db.prepare("PRAGMA index_xinfo(" + JSON.stringify(ix.name) + ")").all();
}
out.counts.predictions_n = db.prepare('SELECT COUNT(*) AS n FROM predictions').get().n;
out.counts.resolved_n = db.prepare('SELECT COUNT(*) AS n FROM predictions WHERE outcome IS NOT NULL').get().n;
out.counts.by_layer = db.prepare('SELECT layer, COUNT(*) AS n FROM predictions GROUP BY layer ORDER BY n DESC').all();
out.counts.by_secondary = db.prepare('SELECT secondary_layer, COUNT(*) AS n FROM predictions GROUP BY secondary_layer ORDER BY n DESC').all();
out.integrity = db.prepare('PRAGMA integrity_check').get();
console.log(JSON.stringify(out, null, 1));
db.close();
