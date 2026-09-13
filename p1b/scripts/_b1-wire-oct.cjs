'use strict';
const fs = require('fs');
const p = 'E:/music player/p1b/scripts/corpus-forward-oct.cjs';
let s = fs.readFileSync(p, 'utf8');
const reps = [
  ["const { insertPrediction, l0Gate, ensurePredictionsTable } = require('../src/db/predictionsStore');",
   "const { insertPrediction, l0Gate, ensurePredictionsTable, deriveMaturesAt } = require('../src/db/predictionsStore');"],
  ["gameId: g, day: null, sourceType: '预测卡', statement: r.statement, prob: r.prob,",
   "gameId: g, day: null, sourceType: '预测卡', statement: r.statement, prob: r.prob, g2Regime: 'R4', maturesAt: deriveMaturesAt(r.resolve, [{ meta: r.meta }]),"],
];
let n = 0;
for (const pair of reps) {
  const c = s.split(pair[0]).length - 1;
  if (c !== 1) { console.log('BAD count=' + c + ' :: ' + pair[0].slice(0, 60)); process.exit(1); }
  s = s.replace(pair[0], pair[1]); n++;
}
fs.writeFileSync(p, s);
console.log('OK corpus-forward-oct.cjs reps=' + n);