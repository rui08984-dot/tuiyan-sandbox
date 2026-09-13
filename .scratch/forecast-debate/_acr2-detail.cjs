'use strict';
const fs = require('fs');
const dir = 'E:/music player/.scratch/forecast-debate/';
const base = JSON.parse(fs.readFileSync(dir + 'acr-phase2-llm-results-A.json', 'utf8'));
const w = base.windows.cutoff;
const out = [];
out.push('== per_game cutoff (A) ==');
for (const p of w.per_game) {
  const pol = (w.polluted_per_game || []).find(r => r.gid === p.gid) || {};
  const b = (w.baseline_per_game || []).find(r => r.gid === p.gid) || {};
  out.push('gid ' + p.gid + ' tw=' + p.tv_win.toFixed(4) + ' tv=' + p.tv_vote.toFixed(4) + ' max=' + p.max.toFixed(4)
    + ' nInj=' + pol.n_inj_actual + ' subs=' + JSON.stringify(pol.subs || [])
    + ' bPwin=' + (b.agg ? b.agg.p_win.toFixed(3) : 'NA') + ' pPwin=' + (pol.agg ? pol.agg.p_win.toFixed(3) : 'NA')
    + ' bTop=' + (b.top_vote_base || 'NA') + ' pTop=' + (pol.top_vote_poll || 'NA'));
  out.push('   bVote=' + JSON.stringify(b.agg ? b.agg.p_vote : null));
  out.push('   pVote=' + JSON.stringify(pol.agg ? pol.agg.p_vote : null));
}
out.push('== baseline within noise per game ==');
for (const b of (w.baseline_per_game || [])) {
  out.push('gid ' + b.gid + ' within=' + JSON.stringify(b.within) + ' K=' + (b.usages || []).length + ' errors=' + JSON.stringify(b.errors || []));
}
out.push('== poll errors ==');
for (const r of (w.polluted_per_game || [])) if (r.error) out.push('gid ' + r.gid + ' ' + r.error);
out.push('== baseline errors ==');
for (const r of (w.baseline_per_game || [])) if (r.error) out.push('gid ' + r.gid + ' ' + r.error);
fs.writeFileSync(dir + '_acr2-detail.txt', out.join('\n'), 'utf8');
console.log('OK lines=' + out.length);
