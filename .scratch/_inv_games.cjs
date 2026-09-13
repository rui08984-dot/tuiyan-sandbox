
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });
const rows = db.prepare(`
SELECT g.id, g.name, g.game_type, g.player_count, g.created_at, g.source,
 (SELECT COUNT(*) FROM predictions p WHERE p.game_id=g.id) AS preds,
 (SELECT COUNT(*) FROM events e WHERE e.game_id=g.id) AS events,
 (SELECT COUNT(*) FROM players pl WHERE pl.game_id=g.id) AS players,
 (SELECT COUNT(*) FROM predictions p WHERE p.game_id=g.id AND p.resolved_at IS NOT NULL) AS resolved
FROM games g ORDER BY g.id`).all();
console.log('id\ttype\tsrc\tpred\tevt\tply\tresolved\tname');
for (const r of rows) console.log([r.id, r.game_type, r.source, r.preds, r.events, r.players, r.resolved, r.name].join('\t'));
console.log('--- distinct game_type ---');
console.log(JSON.stringify(db.prepare('SELECT game_type, COUNT(*) c FROM games GROUP BY game_type ORDER BY game_type').all()));
console.log('--- distinct source ---');
console.log(JSON.stringify(db.prepare('SELECT source, COUNT(*) c FROM games GROUP BY source').all()));
console.log('--- predictions.source_type distinct ---');
console.log(JSON.stringify(db.prepare('SELECT source_type, COUNT(*) c FROM predictions GROUP BY source_type').all()));
db.close();
