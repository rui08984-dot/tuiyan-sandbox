'use strict';
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const KINDS = ['usgs_nwis_daily_discharge','noaa_gml_co2_daily','ghcn_daily_tmax','cta_daily_total_rides','elexon_fuelhh_daily_mean','noaa_tide_daily_max'];
for (const k of KINDS) {
  const row = db.prepare("SELECT e.value AS ev FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=? LIMIT 1").get(k);
  if (!row) { console.log('--- ' + k + ' : 无样本 ---'); continue; }
  const o = JSON.parse(row.ev);
  console.log('--- ' + k + ' ---');
  console.log('  resolve=' + JSON.stringify(o.resolve));
  console.log('  baseRateNote=' + String(o.baseRateNote || o.note || '').slice(0, 200));
  console.log('  meta=' + JSON.stringify(o.meta || null).slice(0, 200));
}
db.close();