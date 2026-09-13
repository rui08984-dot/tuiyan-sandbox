'use strict';
/** 探针：intakeStore 的 JS 校验层是否允许 secondaryLayer='unknown'，而 DB CHECK 是否拒（潜在不一致）。零写生产库（:memory:）。 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { db } = require(path.join(ROOT, 'p1b', 'src', 'deps.js'));
db.init(':memory:');
const conn = db.getConnection();
conn.exec("CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, game_type TEXT NOT NULL, player_count INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))");
const intake = require(path.join(ROOT, 'p1b', 'src', 'db', 'intakeStore.js'));
intake.ensureIntakeTables(conn);
const res = {};
try {
  const q = intake.insertIntakeQuestion({ statement: 'secondary=unknown 探针', layer: 'unknown', secondaryLayer: 'unknown' });
  res.intake_secondary_unknown = { accepted: true, id: q.id };
} catch (e) {
  res.intake_secondary_unknown = { accepted: false, code: e.code || null, message: String(e.message).split('\n')[0] };
}
try {
  const q = intake.insertIntakeQuestion({ statement: 'secondary=L4 探针', layer: 'unknown', secondaryLayer: 'L4' });
  res.intake_secondary_L4 = { accepted: true, id: q.id };
} catch (e) { res.intake_secondary_L4 = { accepted: false, message: String(e.message).split('\n')[0] }; }
res.INTAKE_LAYERS = intake.INTAKE_LAYERS;
console.log(JSON.stringify(res, null, 1));
db.closeCurrent();
