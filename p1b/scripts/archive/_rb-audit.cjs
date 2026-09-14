'use strict';
// RB 精确复核（临时）：ca1b 行数 vs 按题路数分布
const { db } = require('../src/deps');
db.init();
const conn = db.getConnection();
const a = conn.prepare("SELECT COUNT(*) n FROM verdicts WHERE run_id='ca1b5cdbddfc'").get().n;
const per = conn.prepare("SELECT p.id, COUNT(v.id) n FROM predictions p LEFT JOIN verdicts v ON v.prediction_id=p.id AND v.run_id='ca1b5cdbddfc' WHERE p.checklist_hash='v2' GROUP BY p.id").all();
const dist = {};
let sum = 0;
for (const x of per) { dist[x.n] = (dist[x.n] || 0) + 1; sum += x.n; }
console.log('ca1b 行=' + a + ' 按题求和=' + sum);
console.log('路数分布（n路:题数）=' + JSON.stringify(dist));
const bad = per.filter((x) => x.n !== 3);
console.log('非 3 路题明细=' + JSON.stringify(bad));
for (const x of bad) {
  const p = conn.prepare('SELECT id, statement, layer FROM predictions WHERE id = ?').get(x.id);
  const have = conn.prepare('SELECT prompt_variant FROM verdicts WHERE prediction_id = ?').all(x.id).map((y) => y.prompt_variant);
  const missing = ['v1_evidence', 'v2_skeptical', 'v3_baserate'].filter((rt) => have.indexOf(rt) === -1);
  console.log('  pid=' + x.id + ' layer=' + p.layer + ' 已有=' + have.join(',') + ' 缺=' + missing.join(','));
}
const stray = conn.prepare("SELECT v.id, v.prediction_id, v.prompt_variant, p.checklist_hash, p.statement FROM verdicts v LEFT JOIN predictions p ON p.id = v.prediction_id WHERE v.run_id='ca1b5cdbddfc' AND (p.checklist_hash IS NULL OR p.checklist_hash != 'v2')").all();
console.log('ca1b 但非 v2 题的行=' + JSON.stringify(stray));
db.closeCurrent();
