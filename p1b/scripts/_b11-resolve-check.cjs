'use strict';
// _b11-resolve-check：12 条新题「真值锚机检可复核」——resolver 存在 + required keys 齐 + 调用返回 pending
const fs = require('fs'); const path = require('path');
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const src = fs.readFileSync('p1b/scripts/corpus-resolve.cjs', 'utf8');
const i = src.indexOf('//RESOLVE-B2');
const mod = { exports: {} };
new Function('module', 'exports', 'require', '__dirname', src.slice(0, i) + '\nmodule.exports = { RESOLVERS: RESOLVERS };')(mod, mod.exports, require, path.join(process.cwd(), 'p1b/scripts'));
const R = mod.exports.RESOLVERS;
const NEED = {
  usgs_nwis_daily_discharge: ['url_template', 'site', 'date', 'threshold', 'cmp', 'field'],
  noaa_gml_co2_daily: ['url', 'date', 'threshold', 'cmp', 'field'],
  ghcn_daily_tmax: ['url_template', 'station', 'date', 'threshold', 'cmp', 'field'],
};
async function main() {
  const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
  const rows = db.prepare("SELECT p.id, p.matures_at, p.g2_regime, p.checklist_hash, p.public_exposure, json_extract(p.evidence_json,'$[0].resolve') rj, json_extract(p.evidence_json,'$[0].baseRateNote') bn FROM predictions p WHERE p.checklist_hash='v3' ORDER BY p.id").all();
  console.log('v3 rows=' + rows.length);
  let pass = 0, fail = 0;
  for (const r of rows) {
    const spec = JSON.parse(r.rj);
    const fn = R[spec.kind];
    const miss = (NEED[spec.kind] || []).filter((k) => spec[k] === undefined);
    let call = 'n/a';
    if (typeof fn === 'function') { try { const o = await fn(spec); call = o && o.pending ? 'pending' : JSON.stringify(o).slice(0, 50); } catch (e) { call = 'ERR ' + e.message.slice(0, 36); } }
    const hasN = /n=\d+/.test(String(r.bn));
    const ok = typeof fn === 'function' && miss.length === 0 && call === 'pending' && r.g2_regime === 'R4' && !!r.matures_at && r.public_exposure === 0 && hasN;
    if (ok) pass++; else fail++;
    console.log((ok ? 'PASS ' : 'FAIL ') + 'id=' + r.id + ' kind=' + spec.kind + ' resolver=' + (typeof fn === 'function') + ' missKeys=' + JSON.stringify(miss) + ' call=' + call + ' mat=' + r.matures_at + ' n_in_note=' + hasN);
  }
  console.log('RESULT pass=' + pass + ' fail=' + fail);
  db.close();
}
main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });