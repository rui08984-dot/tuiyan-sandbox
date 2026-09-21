'use strict';
/*
 * .scratch/p31/snapshot.cjs —— 在线快照 ×2（VACUUM INTO）＋ sha256 逐位核验
 * 用法：node .scratch/p31/snapshot.cjs
 * 纪律：禁拷文件（WAL 未 checkpoint 会丢事务）⇒ 一律用 SQLite 在线备份 API（VACUUM INTO）。
 * 两份：snap-baseline.db（留存对照）＋ snap-drill.db（演练载体），sha256 必须逐位相同。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const B = require(path.join(__dirname, '..', '..', 'p1a-terminal', 'node_modules', 'better-sqlite3'));

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const OUTS = [path.join(__dirname, 'snap-baseline.db'), path.join(__dirname, 'snap-drill.db')];

for (const o of OUTS) if (fs.existsSync(o)) { console.error('[snap] 目标已存在，拒绝覆盖: ' + o); process.exit(2); }

const src = new B(SRC, { readonly: true, fileMustExist: true });
const cnt = {};
for (const t of ['predictions', 'games', 'verdicts', 'events', 'claims', 'players']) cnt[t] = src.prepare('SELECT COUNT(*) c FROM ' + t).get().c;
for (const o of OUTS) src.exec("VACUUM INTO '" + o.replace(/'/g, "''") + "'");
src.close();

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const shaA = sha(OUTS[0]), shaB = sha(OUTS[1]);
console.log('[snap] src=' + SRC);
console.log('[snap] src rows=' + JSON.stringify(cnt));
for (const o of OUTS) {
  const s = new B(o, { readonly: true, fileMustExist: true });
  const integ = s.prepare('PRAGMA integrity_check').get().integrity_check;
  const c2 = {};
  for (const t of Object.keys(cnt)) c2[t] = s.prepare('SELECT COUNT(*) c FROM ' + t).get().c;
  s.close();
  console.log('[snap] ' + path.basename(o) + ' bytes=' + fs.statSync(o).size + ' integrity=' + integ + ' rows=' + JSON.stringify(c2) + ' rowsMatch=' + Object.keys(cnt).every((t) => cnt[t] === c2[t]));
}
console.log('[snap] sha256(baseline)=' + shaA);
console.log('[snap] sha256(drill)   =' + shaB);
console.log('[snap] BYTE_IDENTICAL=' + (shaA === shaB));
if (shaA !== shaB) { console.error('[snap] 两份快照不一致 ⇒ exit 3'); process.exit(3); }
