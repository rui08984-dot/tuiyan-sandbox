'use strict';
// _b1-wire-writers：#2 写端补 g2Regime/maturesAt（11 脚本）+ deriveMaturesAt 注入
const fs = require('fs');
const REQ_OLD = "const { insertPrediction, l0Gate, ensurePredictionsTable } = require('../src/db/predictionsStore');";
const REQ_NEW = "const { insertPrediction, l0Gate, ensurePredictionsTable, deriveMaturesAt } = require('../src/db/predictionsStore');";
const FW_OLD = "statement: r.statement, prob: r.prob,";
const FW_NEW = "statement: r.statement, prob: r.prob, g2Regime: 'R4', maturesAt: deriveMaturesAt(r.resolve, [{ meta: r.meta }]),";
const JOBS = [
  { f: 'corpus-ingest.cjs', nl: '\n', reps: [[REQ_OLD, REQ_NEW], ["statement, prob: q.prob, layer: q.layer", "statement, prob: q.prob, g2Regime: 'R4', maturesAt: deriveMaturesAt(q.resolve, ev), layer: q.layer"]] },
  { f: 'corpus-ingest-b2.cjs', nl: '\n', reps: [[REQ_OLD, REQ_NEW], ["statement, prob: q.prob, layer: q.layer", "statement, prob: q.prob, g2Regime: 'R4', maturesAt: deriveMaturesAt(q.resolve, [snap]), layer: q.layer"]] },
  { f: 'corpus-backfill.cjs', nl: '\r\n', reps: [[REQ_OLD, REQ_NEW], ["statement: statement, prob: q.prob, layer: q.layer", "statement: statement, prob: q.prob, g2Regime: 'R4', maturesAt: deriveMaturesAt(q.resolve, [snap]), layer: q.layer"]] },
  { f: 'corpus-forward.cjs', nl: '\n', reps: [[REQ_OLD, REQ_NEW], [FW_OLD, FW_NEW]] },
  { f: 'corpus-forward-b2.cjs', nl: '\n', reps: [[REQ_OLD, REQ_NEW], [FW_OLD, FW_NEW]] },
  { f: 'corpus-forward-oct.cjs', nl: '\n', reps: [[REQ_OLD, REQ_NEW], [FW_OLD, FW_NEW]] },
  { f: 'corpus-sources-b3.cjs', nl: '\n', reps: [[REQ_OLD, REQ_NEW], [FW_OLD, FW_NEW]] },
  { f: 'corpus-sources-b4.cjs', nl: '\n', reps: [[REQ_OLD, REQ_NEW], [FW_OLD, FW_NEW]] },
  { f: 'sim-titles.cjs', nl: '\n', reps: [["gate: 'descriptive',\n      evidence: t.evidence", "gate: 'descriptive', g2Regime: 'R4', maturesAt: null, // botc 无日历到期日：显式 null（#2 不许省略）\n      evidence: t.evidence"]] },
  { f: 'sim-templates-v2.cjs', nl: '\n', reps: [["gate: 'descriptive',\n          evidence: preIds", "gate: 'descriptive', g2Regime: 'R4', maturesAt: null, // botc 无日历到期日：显式 null（#2）\n          evidence: preIds"]] },
  { f: 'ablation.cjs', nl: '\n', reps: [["prob: 0.5, evidence: [],", "prob: 0.5, g2Regime: 'R4', maturesAt: null, evidence: [],"]] },
];
let ok = 0; const bad = [];
for (const j of JOBS) {
  const p = 'E:/music player/p1b/scripts/' + j.f;
  let s = fs.readFileSync(p, 'utf8'); let n = 0;
  for (const pair of j.reps) {
    const oo = pair[0].split('\n').join(j.nl), nn = pair[1].split('\n').join(j.nl);
    const c = s.split(oo).length - 1;
    if (c !== 1) { bad.push(j.f + ' count=' + c + ' :: ' + pair[0].slice(0, 45)); continue; }
    s = s.replace(oo, nn); n++;
  }
  if (n === j.reps.length) { fs.writeFileSync(p, s); ok++; console.log('OK   ' + j.f + ' reps=' + n); }
  else console.log('SKIP ' + j.f + ' applied=' + n + '/' + j.reps.length);
}
console.log('FILES_OK=' + ok + ' BAD=' + JSON.stringify(bad));