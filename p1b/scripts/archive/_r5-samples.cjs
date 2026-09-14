'use strict';
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const REG = ['openmeteo_daily_max','dbnomics_series_value','cwl_ssq_red_contains','cwl_ssq_blue_odd','openmeteo_forecast_daily_max','cwl_ssq_blue_odd_forward','dlt_draw_result'];
const kinds = db.prepare("SELECT DISTINCT json_extract(e.value,'$.resolve.kind') k FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind') IS NOT NULL AND p.outcome IS NULL ORDER BY k").all().map(x => x.k);
const st = db.prepare("SELECT p.id, e.value rv FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=? AND p.outcome IS NULL LIMIT 1");
const out = {};
for (const k of kinds) { if (REG.indexOf(k) !== -1) continue; const r = st.get(k); out[k] = { id: r.id, resolve: JSON.parse(r.rv).resolve }; }
require('fs').writeFileSync('p1b/sim/out/r5-kind-samples.json', JSON.stringify(out, null, 1), 'utf8');
console.log('kinds needing impl=' + Object.keys(out).length);
console.log(JSON.stringify(out, null, 1).slice(0, 9000));
db.close();
