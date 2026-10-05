'use strict';
// _b11-snapshot：VACUUM INTO 快照 + sha256。源库一律 {readonly:true} 打开（避免回写头部致既有 sha 失效）
const fs = require('fs');
const crypto = require('crypto');
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const SRC = 'E:/music player/p1a-terminal/data/p1a.db';
const stamp = process.argv[2] || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const out = 'E:/music player/.run-out/backup/p1a-pre-long2-' + stamp + '.db';
if (fs.existsSync(out)) throw new Error('snapshot exists: ' + out);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
const db = new Database(SRC, { readonly: true });
const before = sha(SRC);
const integ = db.prepare('PRAGMA integrity_check').get().integrity_check;
const n = db.prepare('SELECT COUNT(*) n FROM predictions').get().n;
db.exec("VACUUM INTO '" + out + "'");
db.close();
console.log(JSON.stringify({ snapshot: out, bytes: fs.statSync(out).size, integrity: integ, predictions: n,
  src_sha_before: before, src_sha_after: sha(SRC), snapshot_sha256: sha(out) }));