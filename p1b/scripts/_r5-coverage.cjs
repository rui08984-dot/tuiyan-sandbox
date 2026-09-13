'use strict';
// _r5-coverage：复刻 daemon 的抽取机制，核对每个库内 kind 是否有 resolver + 定义行号
const fs = require('fs'), path = require('path');
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const src = fs.readFileSync('p1b/scripts/corpus-resolve.cjs', 'utf8');
const i = src.indexOf('//RESOLVE-B2');
const lines = src.split('\n');
const mod = { exports: {} };
let body = src.slice(0, i);
body += '\nmodule.exports = { RESOLVERS: RESOLVERS, getJson: getJson };';
new Function('module', 'exports', 'require', '__dirname', body)(mod, mod.exports, require, path.join(process.cwd(), 'p1b/scripts'));
const R = mod.exports.RESOLVERS;
const kinds = db.prepare("SELECT json_extract(e.value,'$.resolve.kind') k, COUNT(*) n FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind') IS NOT NULL AND p.outcome IS NULL GROUP BY k ORDER BY n DESC").all();
const lineOf = (k) => {
  let def = 0, alias = 0;
  lines.forEach((t, idx) => { if (t.indexOf('async ' + k + '(') !== -1) def = idx + 1; if (t.indexOf('  ' + k + ': RESOLVERS.') === 0) alias = idx + 1; });
  return alias ? ('alias@' + alias) : (def ? ('def@' + def) : '—');
};
let miss = 0, cover = 0, nCover = 0, nMiss = 0;
console.log('registered_total=' + Object.keys(R).length + ' (7 old + new)');
kinds.forEach((x) => {
  const ok = typeof R[x.k] === 'function';
  if (ok) { cover++; nCover += x.n; } else { miss++; nMiss += x.n; }
  console.log((ok ? 'OK  ' : 'MISS') + '\t' + x.n + '\t' + x.k + '\t' + lineOf(x.k));
});
console.log('--- kinds=' + kinds.length + ' covered=' + cover + ' missing=' + miss + ' rows_covered=' + nCover + ' rows_missing=' + nMiss);
db.close();
