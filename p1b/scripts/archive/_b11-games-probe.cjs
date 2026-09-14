'use strict';
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const gs = db.prepare("SELECT id, name, game_type, source FROM games WHERE game_type LIKE 'corpus:%' ORDER BY id").all();
console.log('corpus games=' + gs.length);
for (const g of gs) {
  const np = db.prepare('SELECT COUNT(*) n FROM predictions WHERE game_id=?').get(g.id).n;
  console.log('  id=' + g.id + ' src=' + g.source + ' np=' + np + ' gt=' + g.game_type + ' name=' + g.name);
}
console.log('games by source=' + JSON.stringify(db.prepare('SELECT source, COUNT(*) n FROM games GROUP BY source').all()));
db.close();