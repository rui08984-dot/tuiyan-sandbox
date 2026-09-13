'use strict';
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
for (const k of ['usgs_nwis_daily_discharge', 'noaa_gml_co2_daily', 'ghcn_daily_tmax']) {
  const rows = db.prepare("SELECT p.id, p.layer, p.engine, p.game_id, p.checklist_hash, json_extract(p.evidence_json,'$[0].batch') ba, json_extract(p.evidence_json,'$[0].kind') ek, json_extract(p.evidence_json,'$[0].meta.dom') dom, p.statement FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=? LIMIT 3").all(k);
  console.log('--- ' + k + ' ---');
  for (const r of rows) console.log('  id=' + r.id + ' layer=' + r.layer + ' engine=' + r.engine + ' gid=' + r.game_id + ' ch=' + r.checklist_hash + ' batch=' + r.ba + ' ek=' + r.ek + ' dom=' + r.dom + '\n    ' + String(r.statement).slice(0, 150));
}
db.close();