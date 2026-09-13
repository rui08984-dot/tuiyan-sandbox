
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });
console.log('=== DDL games ===');
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE name='games'").get().sql);
console.log('=== DDL predictions ===');
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE name='predictions'").get().sql);
console.log('=== indexes ===');
console.log(JSON.stringify(db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index'").all(), null, 1));
console.log('=== foreign_keys pragma ===');
console.log(JSON.stringify(db.prepare('PRAGMA foreign_keys').all()));
console.log('=== journal mode ===');
console.log(JSON.stringify(db.prepare('PRAGMA journal_mode').all()));
console.log('=== corpus games detail (id 40-72) ===');
const rows = db.prepare(`
SELECT g.id, g.name, g.game_type, g.created_at, g.source, g.meta, g.player_count,
 (SELECT COUNT(*) FROM predictions p WHERE p.game_id=g.id) preds,
 (SELECT COUNT(*) FROM predictions p WHERE p.game_id=g.id AND p.resolved_at IS NOT NULL) resolved,
 (SELECT COUNT(*) FROM events e WHERE e.game_id=g.id) evt,
 (SELECT COUNT(*) FROM players pl WHERE pl.game_id=g.id) ply,
 (SELECT COUNT(*) FROM hypotheses h WHERE h.game_id=g.id) hyp,
 (SELECT COUNT(*) FROM contradictions c WHERE c.game_id=g.id) contr,
 (SELECT COUNT(*) FROM oracle_readings o WHERE o.game_id=g.id) oracle,
 (SELECT COUNT(*) FROM botc_games b WHERE b.game_id=g.id) bgame
FROM games g WHERE g.game_type LIKE 'corpus:%' ORDER BY g.id`).all();
for (const r of rows) console.log(JSON.stringify(r));
db.close();
