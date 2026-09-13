'use strict';
// _b1-matures-audit：#2 对已产批次核对（只读）——每条 R4 行的 matures_at vs 由 evidence 现推
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const { deriveMaturesAt } = require('../../p1b/src/db/predictionsStore');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const rows = db.prepare("SELECT p.id, p.layer, p.matures_at, p.evidence_json, json_extract(p.evidence_json,'$[0].resolve.kind') k FROM predictions p WHERE p.g2_regime='R4'").all();
let stored = 0, dOk = 0, match = 0, mismatch = [], nullButDerivable = [], underivable = 0, bothNull = 0;
const underByKind = {};
for (const r of rows) {
  const hasStored = r.matures_at !== null && r.matures_at !== undefined && String(r.matures_at) !== '';
  if (hasStored) stored++;
  let ev = []; try { ev = JSON.parse(r.evidence_json || '[]'); } catch (e) { ev = []; }
  const el = ev.find((x) => x && x.resolve);
  let d = null;
  if (el) { try { d = deriveMaturesAt(el.resolve, ev); } catch (e) { d = null; } }
  if (d) dOk++;
  if (hasStored && d) { if (String(r.matures_at) === d) match++; else mismatch.push({ id: r.id, stored: r.matures_at, derived: d, k: r.k }); }
  else if (!hasStored && d) nullButDerivable.push({ id: r.id, derived: d, k: r.k });
  else if (!hasStored && !d) { underivable++; const kk = r.k || '(no-resolve)'; underByKind[kk] = (underByKind[kk] || 0) + 1; }
  else bothNull++;
}
console.log(JSON.stringify({ R4_rows: rows.length, stored_nonnull: stored, derived_ok: dOk, match, mismatch: mismatch.length, stored_null_but_derivable: nullButDerivable.length, underivable }, null, 0));
console.log('mismatch sample=' + JSON.stringify(mismatch.slice(0, 5)));
console.log('null_but_derivable by kind=' + JSON.stringify(nullButDerivable.reduce((a, x) => { a[x.k] = (a[x.k] || 0) + 1; return a; }, {})));
console.log('underivable by kind=' + JSON.stringify(underByKind));
db.close();