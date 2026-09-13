'use strict';
// 真实样例：从 450 条狼人域预测里取首条矛盾对数>0 的 3.0 d 段
const { db } = require('E:/music player/p1b/src/deps');
const modern = require('E:/music player/p1b/src/routes/verdicts.js');
db.init('E:/music player/.scratch/forecast-debate/_v3proof/p1a-proof.db');
const conn = db.getConnection();
const rows = conn.prepare("SELECT p.id, p.game_id, p.evidence_json, g.name, g.game_type FROM predictions p JOIN games g ON g.id=p.game_id WHERE g.game_type LIKE '%wolf%' ORDER BY p.id").all();
let found = 0, dist = {};
for (const r of rows) {
  const pred = { id: r.id, game_id: r.game_id, evidence: JSON.parse(r.evidence_json) };
  const block = modern.loadEvidence(pred);
  const i = block.indexOf(modern.CONTRADICTION_HEAD);
  if (i === -1) continue;
  const tail = block.slice(i);
  if (!/矛盾对数：0/.test(tail)) { found++; if (found <= 1) { console.log('gid=' + r.game_id + ' pid=' + r.id + ' (' + r.game_type + ')'); console.log(tail); } }
  const m = tail.match(/矛盾对数：(\d+)；涉及席位：([^；]*)；类型分布：([^\n]*)/);
  if (m) { const k = m[1] === '0' ? 'zero' : 'nonzero'; dist[k] = (dist[k] || 0) + 1; }
}
console.log('--- 分布（450 条狼人域预测的 d 段）:', JSON.stringify(dist), 'nonzeroSamples=' + found);
