'use strict';
/*
 * snapshot.cjs — 在线快照（VACUUM INTO）＋ integrity ＋ 行数核验
 * 用法：node .scratch/p25/snapshot.cjs <out.db> [--db=<src>]
 * 纪律：禁拷文件（WAL 未 checkpoint 会丢事务）⇒ 一律用 SQLite 在线备份 API（VACUUM INTO）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.argv[2];
const arg = (n, d) => { const a = process.argv.filter((x) => x.indexOf('--' + n + '=') === 0)[0]; return a ? a.slice(n.length + 3) : d; };
const SRC = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
if (!OUT) { console.error('[snap] 用法：node snapshot.cjs <out.db> [--db=<src>]'); process.exit(2); }

const db = new DatabaseSync(SRC, { readOnly: true });
db.exec("VACUUM INTO '" + OUT.replace(/'/g, "''") + "'");
const cnt = {};
for (const t of ['predictions', 'verdicts', 'truth_vault', 'games', 'events', 'claims']) cnt[t] = db.prepare('SELECT COUNT(*) c FROM ' + t).get().c;
db.close();

const snap = new DatabaseSync(OUT, { readOnly: true });
const integrity = snap.prepare('PRAGMA integrity_check').get().integrity_check;
const cnt2 = {};
for (const t of Object.keys(cnt)) cnt2[t] = snap.prepare('SELECT COUNT(*) c FROM ' + t).get().c;
snap.close();

const bytes = fs.statSync(OUT).size;
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(OUT)).digest('hex');
const same = Object.keys(cnt).every((t) => cnt[t] === cnt2[t]);
console.log('[snap] src=' + SRC);
console.log('[snap] out=' + OUT);
console.log('[snap] bytes=' + bytes + '｜sha256=' + sha256.slice(0, 16) + '…');
console.log('[snap] rows(src)=' + JSON.stringify(cnt));
console.log('[snap] rows(snap)=' + JSON.stringify(cnt2));
console.log('[snap] integrity=' + integrity + '｜row_counts_match=' + same);
if (integrity !== 'ok' || !same) { console.error('[snap] 核验失败 ⇒ exit 3'); process.exit(3); }
console.log('[snap] full sha256=' + sha256);
