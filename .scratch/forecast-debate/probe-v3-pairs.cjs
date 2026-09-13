'use strict';
// probe2：只读 —— 按 ACR loader 口径跑可复用检测器，核对实跑矛盾数与 format 映射
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const DET = require('E:/music player/p1b/src/detectors/werewolf-contradictions.js');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
function loadGame(gid) {
  const events = db.prepare('SELECT e.id, e.seq, e.day, e.phase, e.type, p.seat AS actor_seat, e.raw_text FROM events e LEFT JOIN players p ON p.id = e.actor_seat WHERE e.game_id=? ORDER BY e.seq').all(gid);
  const claims = db.prepare('SELECT c.id, c.event_id, c.seat, c.subject_seat, c.predicate, c.object FROM claims c JOIN events e ON c.event_id=e.id WHERE e.game_id=? ORDER BY c.id').all(gid);
  return { events, claims };
}
function fmtOf(gt) { const s = String(gt || '').toLowerCase(); if (s.indexOf('botc') >= 0 || s.indexOf('blood') >= 0) return 'botc'; if (s.indexOf('wolf') >= 0) return 'werewolf'; return null; }
console.log('--- werewolf family games ---');
const games = db.prepare("SELECT id, game_type FROM games WHERE game_type LIKE '%wolf%' OR game_type = 'botc' ORDER BY id").all();
let tot = 0;
for (const g of games) {
  const d = loadGame(g.id);
  const pairs = DET.detectWerewolfContradictions({ format: fmtOf(g.game_type), events: d.events, claims: d.claims });
  const h = DET.summarize(pairs);
  tot += pairs.length;
  console.log('gid=' + g.id + ' ' + g.game_type + ' ev=' + d.events.length + ' cl=' + d.claims.length + ' hist=' + JSON.stringify(h));
}
console.log('total pairs (werewolf family) =', tot);
console.log('--- corpus games: do they have events/claims? ---');
const cg = db.prepare("SELECT id, game_type FROM games WHERE game_type LIKE 'corpus:%' ORDER BY id LIMIT 6").all();
for (const g of cg) {
  const d = loadGame(g.id);
  const pairs = DET.detectWerewolfContradictions({ format: null, events: d.events, claims: d.claims });
  console.log('gid=' + g.id + ' ev=' + d.events.length + ' cl=' + d.claims.length + ' pairs=' + pairs.length);
}
console.log('--- prediction layer/game_type dist where evidence non-empty ---');
console.log(JSON.stringify(db.prepare("SELECT g.game_type AS gt, p.layer AS lyr, COUNT(*) n FROM predictions p JOIN games g ON g.id=p.game_id WHERE p.evidence_json NOT IN ('','[]') GROUP BY g.game_type, p.layer ORDER BY n DESC LIMIT 12").all()));
