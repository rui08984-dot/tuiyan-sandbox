'use strict';
const fs = require('fs');
const jobs = [
  ['corpus-backfill.cjs', "maturesAt: deriveMaturesAt(q.resolve, [snap])", "maturesAt: deriveMaturesAt(q.resolve, [{ meta: q.meta }, snap])", '\r\n'],
  ['corpus-ingest.cjs', "maturesAt: deriveMaturesAt(q.resolve, ev)", "maturesAt: deriveMaturesAt(q.resolve, [{ meta: q.meta }].concat(ev))", '\n'],
  ['corpus-ingest-b2.cjs', "maturesAt: deriveMaturesAt(q.resolve, [snap])", "maturesAt: deriveMaturesAt(q.resolve, [{ meta: q.meta }, snap])", '\n'],
];
for (const [f, o, nw] of jobs) {
  const p = 'E:/music player/p1b/scripts/' + f;
  let s = fs.readFileSync(p, 'utf8');
  const c = s.split(o).length - 1;
  if (c !== 1) { console.log('BAD ' + f + ' count=' + c); continue; }
  fs.writeFileSync(p, s.replace(o, nw));
  console.log('OK ' + f);
}