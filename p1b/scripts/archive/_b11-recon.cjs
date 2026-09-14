'use strict';
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const rows = db.prepare("SELECT p.id, p.layer, p.created_at, p.matures_at, p.g2_regime, p.checklist_hash, p.statement, json_extract(p.evidence_json,'$[0].kind') ek, json_extract(p.evidence_json,'$[0].resolve.kind') rk, json_extract(p.evidence_json,'$[0].batch') ba FROM predictions p WHERE p.g2_regime='R4'").all();
const long = rows.filter((r) => {
  const t1 = new Date(String(r.matures_at) + 'T00:00:00Z').getTime();
  const t0 = new Date(String(r.created_at).replace(' ', 'T') + 'Z').getTime();
  return isFinite(t1) && isFinite(t0) && (t1 - t0) / 86400000 > 30;
});
console.log('long_horizon(>30d)=' + long.length);
const byEv = {}, byRes = {}, byBatch = {}, byMonth = {};
long.forEach((r) => { byEv[r.ek] = (byEv[r.ek] || 0) + 1; byRes[r.rk] = (byRes[r.rk] || 0) + 1; byBatch[r.ba || '(none)'] = (byBatch[r.ba || '(none)'] || 0) + 1; byMonth[String(r.created_at).slice(0, 7)] = (byMonth[String(r.created_at).slice(0, 7)] || 0) + 1; });
console.log('by evidence kind=' + JSON.stringify(byEv));
console.log('by resolve kind=' + JSON.stringify(byRes));
console.log('by batch=' + JSON.stringify(byBatch));
console.log('by created month=' + JSON.stringify(byMonth));
for (const r of long.slice(0, 8)) console.log('  id=' + r.id + ' h=' + Math.round((new Date(String(r.matures_at) + 'T00:00:00Z') - new Date(String(r.created_at).replace(' ', 'T') + 'Z')) / 86400000) + 'd created=' + r.created_at + ' mat=' + r.matures_at + ' ch=' + r.checklist_hash + ' rk=' + r.rk + '\n    ' + String(r.statement).slice(0, 120));
db.close();