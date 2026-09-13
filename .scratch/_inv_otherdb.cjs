
const path = 'E:/music player/p1a-terminal/node_modules/better-sqlite3';
const Database = require(path);
const files = [
 'E:/music player/p1a-terminal/data/p1a-multidev.db',
 'E:/music player/_p1a_backup_pre_m2.db',
 'E:/music player/docs/sandbox/p1b/itest/p20.db',
 'E:/music player/docs/sandbox/p1b/itest/p22.db'
];
for (const f of files) {
  try {
    const db = new Database(f, { readonly: true, fileMustExist: true });
    const has = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='games'").get().c;
    if (!has) { console.log(f + ' :: no games table'); db.close(); continue; }
    const cols = db.prepare('PRAGMA table_info(games)').all().map(c=>c.name);
    const n = db.prepare('SELECT COUNT(*) c FROM games').get().c;
    const corpus = db.prepare("SELECT game_type, COUNT(*) c FROM games WHERE game_type LIKE 'corpus:%' GROUP BY game_type").all();
    console.log(f + ' :: games=' + n + ' cols=' + cols.join('/') + ' corpus=' + JSON.stringify(corpus));
    db.close();
  } catch (e) { console.log(f + ' :: ERR ' + e.message); }
}
