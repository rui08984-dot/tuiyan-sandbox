
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });

console.log('=== players rows for candidate games ===');
for (const gid of [43,47,48,49,72]) {
  console.log(gid + ': ' + JSON.stringify(db.prepare('SELECT * FROM players WHERE game_id=?').all(gid)));
}

console.log('=== dlt statements per game ===');
for (const gid of [47,49]) {
  console.log('--- game ' + gid);
  const rows = db.prepare('SELECT id, day, statement, assigned_prob, resolved_at, outcome, layer, engine, created_at, substr(evidence_json,1,60) ev FROM predictions WHERE game_id=? ORDER BY id').all(gid);
  for (const r of rows) console.log(JSON.stringify(r));
}

console.log('=== statement overlap 47 vs 49 ===');
const s47 = new Set(db.prepare('SELECT statement FROM predictions WHERE game_id=47').all().map(r=>r.statement));
const s49 = db.prepare('SELECT statement FROM predictions WHERE game_id=49').all().map(r=>r.statement);
const dup = s49.filter(s=>s47.has(s));
console.log('47count=' + s47.size + ' 49count=' + s49.length + ' overlap=' + dup.length);
console.log(JSON.stringify(dup.slice(0,5), null, 1));
db.close();
