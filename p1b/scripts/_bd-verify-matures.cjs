'use strict';
// 口径B 微步3 收尾凭证（只读）：补列后账本实态
const fs = require('fs');
const crypto = require('crypto');
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });
const nn = db.prepare('SELECT COUNT(*) n FROM predictions WHERE matures_at IS NOT NULL').get().n;
const rtNN = db.prepare("SELECT COUNT(*) n FROM predictions WHERE matures_at IS NOT NULL AND statement NOT LIKE '%【backfill】%'").get().n;
const bfNN = db.prepare("SELECT COUNT(*) n FROM predictions WHERE matures_at IS NOT NULL AND statement LIKE '%【backfill】%'").get().n;
const total = db.prepare('SELECT COUNT(*) n FROM predictions').get().n;
console.log('MATURES_NONNULL=' + nn + ' (rt=' + rtNN + ' bf=' + bfNN + ') total=' + total);
const chk = db.prepare('PRAGMA integrity_check').get();
console.log('INTEGRITY=' + JSON.stringify(chk));
db.close();
for (const f of ['p1a.db', 'p1a.db-wal', 'p1a.db-shm', 'p1a-bd3-backup-20260914.db']) {
  const p = 'E:/music player/p1a-terminal/data/' + f;
  if (fs.existsSync(p)) { const st = fs.statSync(p); console.log(f + ' size=' + st.size + ' mtime=' + st.mtime.toISOString()); }
  else console.log(f + ' ABSENT');
}
console.log('WAL_SHA=' + crypto.createHash('sha256').update(fs.readFileSync('E:/music player/p1a-terminal/data/p1a.db-wal')).digest('hex').slice(0, 16));
