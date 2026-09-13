'use strict';
// 口径B 微步3：库快照（readonly 打开 + backup API，零写源库）+ sha256
const fs = require('fs');
const crypto = require('crypto');
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const SRC = 'E:/music player/p1a-terminal/data/p1a.db';
const DST = 'E:/music player/p1a-terminal/data/p1a-bd3-backup-20260914.db';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
console.log('SRC_SHA_BEFORE=' + sha(SRC));
const st = fs.statSync(SRC);
console.log('SRC_MTIME_BEFORE=' + st.mtime.toISOString() + ' SIZE=' + st.size);
if (fs.existsSync(DST)) { console.log('DST_EXISTS_REUSE（幂等）'); } else {
  const db = new Database(SRC, { readonly: true, fileMustExist: true });
  db.backup(DST).then(() => {
    const ok = new Database(DST, { readonly: true }).prepare('PRAGMA integrity_check').get();
    console.log('BACKUP_INTEGRITY=' + JSON.stringify(ok));
    console.log('DST_SHA=' + sha(DST));
    console.log('DST_SIZE=' + fs.statSync(DST).size);
    const n = new Database(DST, { readonly: true }).prepare('SELECT COUNT(*) n FROM predictions').get().n;
    console.log('BACKUP_ROWS=' + n);
    console.log('BACKUP_OK');
  }).catch((e) => { console.error('BACKUP_FAIL: ' + e.message); process.exit(1); });
}
