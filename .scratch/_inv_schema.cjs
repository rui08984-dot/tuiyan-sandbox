
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
console.log('TABLES: ' + JSON.stringify(tables));
for (const t of tables) {
  const cols = db.prepare('PRAGMA table_info("' + t + '")').all().map(c => c.name + ':' + c.type);
  const n = db.prepare('SELECT COUNT(*) c FROM "' + t + '"').get().c;
  console.log('--- ' + t + ' rows=' + n);
  console.log('    cols: ' + cols.join(', '));
}
console.log('=== games sample ===');
try { console.log(JSON.stringify(db.prepare('SELECT * FROM games ORDER BY id LIMIT 5').all(), null, 1)); } catch (e) { console.log('ERR ' + e.message); }
db.close();
