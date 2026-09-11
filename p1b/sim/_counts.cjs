'use strict';
const fs = require('fs');
const path = require('path');
const OUTFILE = path.join(__dirname, 'out', 'batch', '_counts.txt');
const NL = String.fromCharCode(10);
try {
  const db = require('../../p1a-terminal/src/db.js');
  db.init(path.join(__dirname, '..', '..', 'p1a-terminal', 'data', 'p1a.db'));
  const c = db.getConnection();
  const cl = c.prepare("SELECT COUNT(*) n FROM claims WHERE game_id IN (SELECT id FROM games WHERE source='sim')").get().n;
  const ev = c.prepare("SELECT COUNT(*) n FROM events WHERE game_id IN (SELECT id FROM games WHERE source='sim')").get().n;
  fs.writeFileSync(OUTFILE, 'claims=' + cl + ' events=' + ev + NL);
} catch (e) {
  fs.writeFileSync(OUTFILE, 'ERR ' + (e && e.message) + NL);
}
