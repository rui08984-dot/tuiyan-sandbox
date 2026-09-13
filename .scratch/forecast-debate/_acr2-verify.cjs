'use strict';
const fs = require('fs');
const dir = 'E:/music player/.scratch/forecast-debate/';
const cache = JSON.parse(fs.readFileSync(dir + 'acr2-cache.json', 'utf8'));
const SEATS = [1,2,3,4,5,6];
const mean = xs => { const v = xs.filter(x => x !== null && x !== undefined && !isNaN(x)); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; };
function aggregate(rs) {
  const pw = mean(rs.map(r => r.p_win));
  const q = {}; for (const s of SEATS) q[String(s)] = mean(rs.map(r => r.p_vote[String(s)])) || 0;
  let sum = 0; for (const s of SEATS) sum += q[String(s)];
  for (const s of SEATS) q[String(s)] = sum > 0 ? q[String(s)]/sum : 0;
  return { p_win: pw, p_vote: q };
}
const tvSimplex = (p,q) => 0.5 * SEATS.reduce((s,k)=>s+Math.abs((p[String(k)]||0)-(q[String(k)]||0)),0);
const out = [];
function aggKey(cls, gid, name, cond) { return ['v2', cls, gid, name, cond, 'K3'].join('|'); }
function get(cls, gid, name, cond) {
  const k = aggKey(cls === 'clean' ? '-' : cls, gid, name, cond);
  const e = cache[k]; return e ? { k, agg: aggregate(e.readings), n: e.readings.length } : null;
}
const files = [['A','acr-phase2-llm-results-A.json','cutoff'],['A','acr-phase2-llm-results-A-full.json','cutoff'],['A','acr-phase2-llm-results-A-full.json','full'],['B','acr-phase2-llm-results-B.json','cutoff'],['C','acr-phase2-llm-results-C.json','cutoff']];
for (const [cls, f, win] of files) {
  const j = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
  const w = j.windows[win]; if (!w) continue;
  out.push('## ' + f + ' win=' + win + ' n=' + w.n_games_paired);
  for (const pg of (w.per_game || [])) {
    const gid = pg.gid;
    const b = get('clean', gid, win, 'clean'), p = get(cls, gid, win, 'poll' + cls);
    const okB = b && Math.abs(b.agg.p_win - pg.p_win_base) < 1e-9 && Math.abs(tvSimplex(b.agg.p_vote, p.agg.p_vote) - pg.tv_vote) < 1e-9;
    out.push('  gid ' + gid + ' json(tw=' + pg.tv_win.toFixed(4) + ' tv=' + pg.tv_vote.toFixed(4) + ') recompute(tw=' + (p.agg.p_win - b.agg.p_win).toFixed(4) + ' tv=' + tvSimplex(b.agg.p_vote, p.agg.p_vote).toFixed(4) + ') Kbase=' + b.n + ' Kpoll=' + p.n + ' MATCH=' + okB);
  }
}
fs.writeFileSync(dir + '_acr2-verify.txt', out.join('\n'), 'utf8');
console.log('WROTE ' + out.length + ' lines');
