'use strict';
const { db } = require("E:/music player/p1b/src/deps");
db.init("E:/music player/p1a-terminal/data/p1a.db");
const conn = db.getConnection();
console.log("sim_claims(join)=", conn.prepare("SELECT COUNT(*) n FROM claims c JOIN events e ON c.event_id=e.id JOIN games g ON e.game_id=g.id WHERE g.source='sim'").get().n);
db.closeCurrent();
// p10-w3.db 临时库
db.init("E:/music player/docs/sandbox/p1b/itest/p10-w3.db");
const c2 = db.getConnection();
console.log("w3_predictions=", JSON.stringify(c2.prepare("SELECT id, game_id, statement, assigned_prob, outcome FROM predictions ORDER BY id").all()));
console.log("w3_verdicts_count=", c2.prepare("SELECT COUNT(*) n FROM verdicts").get().n);
console.log("w3_verdicts_prob=", JSON.stringify(c2.prepare("SELECT prediction_id, prompt_variant, implied_prob FROM verdicts ORDER BY id").all()));
db.closeCurrent();
