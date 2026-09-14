// bug-29 收尾核验：14 条过期未结清单的终态 + 全库计数 + integrity
const path = require('path');
const ROOT = 'E:/music player';
const D = require(path.join(ROOT, 'p1a-terminal/node_modules/better-sqlite3'));
const db = new D(path.join(ROOT, 'p1a-terminal/data/p1a.db'), { readonly: true });
const ids = [1761, 1765, 1769, 1785, 1787, 1789, 1791, 1793, 453, 454, 731, 732, 817, 829];
const rows = db.prepare('SELECT id, outcome, substr(coalesce(resolve_note,\'\'),1,100) note FROM predictions WHERE id IN (' + ids.join(',') + ')').all();
for (const r of rows) console.log('id=' + String(r.id).padEnd(5), '| outcome=' + String(r.outcome === null ? 'NULL' : r.outcome).padEnd(5), '|', r.note || '(无 note)');
console.log('----');
console.log('TOTAL=' + db.prepare('SELECT COUNT(*) c FROM predictions').get().c
  + '  RESOLVED=' + db.prepare('SELECT COUNT(*) c FROM predictions WHERE outcome IS NOT NULL').get().c
  + '  VERDICTS=' + db.prepare('SELECT COUNT(*) c FROM verdicts').get().c);
console.log('NULLBALL_NOTES=' + db.prepare("SELECT COUNT(*) c FROM predictions WHERE resolve_note LIKE '%含 null%'").get().c);
console.log('INTEGRITY=' + JSON.stringify(db.pragma('integrity_check')));
const be = db.prepare("SELECT COUNT(*) c FROM predictions WHERE resolve_note LIKE '%be %' AND resolve_note LIKE '%本地日全窗口口径%'").get().c;
console.log('B29_FORMAT_NOTES=' + be);
db.close();
