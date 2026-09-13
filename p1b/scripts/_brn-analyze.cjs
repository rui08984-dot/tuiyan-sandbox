'use strict';
// _brn-analyze：从 confirm 报告生成每 kind 抽样表与「最难档+108」的逐项拆解
const fs = require('fs');
const rep = JSON.parse(fs.readFileSync('p1b/sim/out/brn-backfill-dry.report.json', 'utf8'));
const rows = rep.rows;
const inPool = (k) => k === 'openmeteo_daily_max';
const hardest = (b) => b !== null && b !== undefined && b * (1 - b) >= 0.21;
const byKind = {};
for (const r of rows) {
  const g = byKind[r.kind] = byKind[r.kind] || { n: 0, agree: 0, disagree: 0, noStored: 0, smallN: 0, inPool: 0, hardestInPool: 0, bfHardest: 0, fwHardest: 0 };
  g.n++;
  if (r.agree === true) g.agree++; else if (r.agree === false) g.disagree++; else g.noStored++;
  if (r.n !== null && r.n < 100) g.smallN++;
  if (inPool(r.kind)) { g.inPool++; if (hardest(r.hit)) { g.hardestInPool++; if (r.backfill) g.bfHardest++; else g.fwHardest++; } }
}
console.log('[byKind] ' + JSON.stringify(byKind));
console.log('[inPool hardest 合计] ' + Object.values(byKind).reduce((a, g) => a + g.hardestInPool, 0));
const L = ['| kind | id | cutoff | 样本 n | hit(外生基率) | b(1-b) | 存量注记% | 重算% | 一致 |', '|---|---|---|---|---|---|---|---|---|'];
for (const kind of Object.keys(byKind)) {
  for (const r of rows.filter((x) => x.kind === kind).slice(0, 3)) {
    const b = r.hit; const bb = b === null ? 'n/a' : (b * (1 - b)).toFixed(4);
    L.push('| ' + kind + ' | ' + r.id + ' | ' + r.cutoff + ' | ' + (r.n === null ? 'n/a' : r.n) + ' | ' + (b === null ? 'n/a' : b) + ' | ' + bb + ' | ' + (r.stored_pct || '—') + ' | ' + r.pct_recomputed + ' | ' + r.agree + ' |');
  }
}
fs.writeFileSync('p1b/sim/out/brn-sample-table.md', L.join('\n') + '\n');
console.log(L.join('\n'));