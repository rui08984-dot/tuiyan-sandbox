/** 探针：闸在"同秒"与"跨秒"两种情形下的读数（秒级分辨率的直接后果）。 */
const path = require('path');
const ROOT = 'E:/music player';
const { db } = require(path.join(ROOT, 'p1b/src/deps'));
const predictions = require(path.join(ROOT, 'p1b/src/db/predictionsStore'));
const vstore = require(path.join(ROOT, 'p1b/src/db/verdictsStore'));
db.init(':memory:');
predictions.ensurePredictionsTable(db.getConnection());
const conn = db.getConnection();
vstore.ensureVerdictsTable(conn);
const gid = conn.prepare("INSERT INTO games (name, game_type, player_count) VALUES ('秒分辨率探针','werewolf',6)").run().lastInsertRowid;
const sleep = (ms) => { const w = Date.now() + ms; while (Date.now() < w); };
let n = 0;
for (const delay of [0, 1200, 0, 0]) {
  const p = predictions.insertPrediction({ gameId: gid, day: 1, sourceType: '预测卡', statement: '探针' + (++n) + '#' + Date.now(), prob: 0.5, layer: 'L3', evidence: [] });
  predictions.resolvePrediction(p.id, 'true', '探针真值');
  sleep(delay);                                   // ← 延迟在结算之后、写入之前
  const t = conn.prepare('SELECT resolved_at r FROM predictions WHERE id=?').get(p.id);
  const r = vstore.saveVerdict({ predictionId: p.id, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: '探针。\nP=0.5' });
  console.log('结算后等 ' + String(delay).padStart(4) + 'ms 写入 → resolved_at=' + t.r
    + ' ⇒ ' + (r.ok ? '放行(clean)' : '拒写(' + r.reason + ')'));
}
db.closeCurrent();
