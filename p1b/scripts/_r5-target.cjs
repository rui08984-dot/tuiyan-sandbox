'use strict';
const fs = require('fs'), path = require('path');
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const src = fs.readFileSync('p1b/scripts/corpus-resolve.cjs', 'utf8');
const i = src.indexOf('//RESOLVE-B2');
const mod = { exports: {} };
let body = src.slice(0, i) + '\nmodule.exports = { RESOLVERS: RESOLVERS };';
new Function('module', 'exports', 'require', '__dirname', body)(mod, mod.exports, require, path.join(process.cwd(), 'p1b/scripts'));
const R = mod.exports.RESOLVERS;
(async () => {
  for (const kind of ['wikimedia_pageviews', 'energycharts_daily_mean', 'energycharts_public_power_daily_mean']) {
    const rows = db.prepare("SELECT p.id, e.value rv FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=? AND p.outcome IS NULL ORDER BY p.id LIMIT 5").all(kind);
    for (const row of rows) {
      const r = JSON.parse(row.rv).resolve;
      let out;
      try { out = await R[kind](r); } catch (e) { out = { error: e.message }; }
      console.log(kind + ' id=' + row.id + ' -> ' + JSON.stringify(out).slice(0, 200));
    }
  }
  db.close();
})();
