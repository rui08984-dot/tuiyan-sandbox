
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });
console.log('=== verdicts per corpus game ===');
const rows = db.prepare(`
SELECT g.id, g.game_type,
 (SELECT COUNT(*) FROM predictions p WHERE p.game_id=g.id) preds,
 (SELECT COUNT(*) FROM verdicts v JOIN predictions p ON p.id=v.prediction_id WHERE p.game_id=g.id) verd
FROM games g WHERE g.game_type LIKE 'corpus:%' ORDER BY g.id`).all();
for (const r of rows) console.log(r.id + '\t' + r.game_type + '\tpreds=' + r.preds + '\tverdicts=' + r.verd);
console.log('=== dlt games: engine/layer/gate/tautology/source_type/day breakdown ===');
console.log(JSON.stringify(db.prepare("SELECT game_id, engine, layer, gate, source_type, tautology, COUNT(*) c FROM predictions WHERE game_id IN (47,48,49) GROUP BY game_id, engine, layer, gate, source_type, tautology").all(), null, 1));
console.log('=== total corpus preds / resolved ===');
console.log(JSON.stringify(db.prepare("SELECT g.id, g.game_type, COUNT(*) n, SUM(CASE WHEN p.resolved_at IS NOT NULL THEN 1 ELSE 0 END) res FROM predictions p JOIN games g ON g.id=p.game_id WHERE g.game_type LIKE 'corpus:%' GROUP BY g.id ORDER BY g.id").all()));
console.log('=== max ids (for reference) ===');
console.log('games max=' + db.prepare('SELECT MAX(id) m FROM games').get().m + ' predictions max=' + db.prepare('SELECT MAX(id) m FROM predictions').get().m + ' events max=' + db.prepare('SELECT MAX(id) m FROM events').get().m + ' players max=' + db.prepare('SELECT MAX(id) m FROM players').get().m);
db.close();
