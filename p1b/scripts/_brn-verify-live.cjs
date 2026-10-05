'use strict';
// _brn-verify-live：在【实况库】上证明 174 条是「纯加 baseRateNote」，其余键逐字不动，且新注记可被 g2-report 解析。
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const SNAP = new Database('E:/music player/.run-out/backup/p1a-pre-brnbackfill-20260913082428.db', { readonly: true });
const LIVE = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const KINDS = ['openmeteo_daily_max', 'dbnomics_series_value', 'cwl_ssq_red_contains', 'cwl_ssq_blue_odd'];
function parseBaseRate(note) {
  if (!note) return null;
  let m = /占\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (m) return { b: parseFloat(m[1]) / 100, pattern: 'pct_share' };
  m = /基率\s*[=:：]\s*(?:组合数理论值\s*)?([0-9]*\.?[0-9]+)/.exec(note);
  if (m) { const x = parseFloat(m[1]); return { b: x > 1 ? x / 100 : x, pattern: 'base_rate_eq' }; }
  m = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(note);
  if (m) return { b: parseFloat(m[1]) / 100, pattern: 'pct_fallback' };
  return null;
}
let n = 0, pureAdd = 0, parseable = 0, hardest = 0, allInPool = 0;
const bad = [];
for (const k of KINDS) {
  const rows = SNAP.prepare("SELECT p.id, p.evidence_json, e.key AS ek FROM predictions p, json_each(p.evidence_json) e WHERE p.g2_regime='R4' AND json_extract(e.value,'$.resolve.kind')=? AND json_extract(e.value,'$.baseRateNote') IS NULL").all(k);
  let kn = 0;
  for (const r of rows) {
    n++; kn++;
    const live = LIVE.prepare('SELECT evidence_json FROM predictions WHERE id=?').get(r.id);
    if (!live) { bad.push({ id: r.id, why: 'live row missing' }); continue; }
    const lev = JSON.parse(live.evidence_json), sev = JSON.parse(r.evidence_json);
    const added = lev[r.ek] ? lev[r.ek].baseRateNote : undefined;
    delete lev[r.ek].baseRateNote;
    if (JSON.stringify(lev) === JSON.stringify(sev)) pureAdd++; else bad.push({ id: r.id, why: 'not-pure-add' });
    const pr = parseBaseRate(added);
    if (pr) { parseable++; if (pr.b * (1 - pr.b) >= 0.21) hardest++; } else bad.push({ id: r.id, why: 'unparseable' });
    if (k === 'openmeteo_daily_max') allInPool++;
  }
  console.log(k + ' verified=' + kn);
}
console.log(JSON.stringify({ total: n, pureAdd: pureAdd, parseable: parseable, hardest_b: hardest, inPool: allInPool, bad: bad.length, badSample: bad.slice(0, 5) }));
console.log(n === 174 && pureAdd === 174 && parseable === 174 && bad.length === 0 ? 'RESULT PASS' : 'RESULT FAIL');
SNAP.close(); LIVE.close();