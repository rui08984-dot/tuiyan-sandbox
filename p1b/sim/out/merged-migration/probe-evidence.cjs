'use strict';
/** 只读探测 predictions.evidence_json 形状（设计 predictions_public 安全列）。零写。 */
const path = require('path');
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const DB = process.argv[2] || path.join(__dirname, '..', '..', 'p1a-terminal', 'data', 'p1a.db');
const db = new Database(DB, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 15000');
const keys = db.prepare("SELECT COUNT(*) AS n FROM predictions WHERE evidence_json IS NOT NULL AND evidence_json <> '' AND evidence_json <> '[]'").get().n;
console.log('non-empty evidence_json:', keys);
// 收集顶层键与 [0] 子键分布
const rows = db.prepare("SELECT id, source_type, evidence_json FROM predictions WHERE evidence_json IS NOT NULL AND evidence_json <> '' AND evidence_json <> '[]'").all();
const topKeys = {}, sub0Keys = {}, resolveKeys = {}, cutoffHits = {};
let bad = 0;
const cutoffSamples = [];
for (const r of rows) {
  let v; try { v = JSON.parse(r.evidence_json); } catch (e) { bad++; continue; }
  if (!Array.isArray(v)) { topKeys['<nonarray:' + typeof v + '>'] = (topKeys['<nonarray:' + typeof v + '>'] || 0) + 1; continue; }
  topKeys['<array len=' + v.length + '>'] = (topKeys['<array len=' + v.length + '>'] || 0) + 1;
  const e0 = v[0];
  if (e0 && typeof e0 === 'object') {
    for (const k of Object.keys(e0)) sub0Keys[k] = (sub0Keys[k] || 0) + 1;
    if (e0.resolve && typeof e0.resolve === 'object') for (const k of Object.keys(e0.resolve)) resolveKeys[k] = (resolveKeys[k] || 0) + 1;
    const c = e0.cutoff !== undefined ? e0.cutoff : (e0.resolve && e0.resolve.cutoff !== undefined ? e0.resolve.cutoff : (e0.meta && e0.meta.cutoff));
    if (c !== undefined) { cutoffHits[typeof c] = (cutoffHits[typeof c] || 0) + 1; if (cutoffSamples.length < 3) cutoffSamples.push({ id: r.id, c: c }); }
    if (e0.truth_preview !== undefined) console.log('  !! truth_preview present at id', r.id);
    if (e0.outcome !== undefined) console.log('  !! outcome present at id', r.id);
  }
}
console.log('topKeys', JSON.stringify(topKeys));
console.log('sub0Keys', JSON.stringify(sub0Keys));
console.log('resolveKeys', JSON.stringify(resolveKeys));
console.log('cutoffHits', JSON.stringify(cutoffHits), JSON.stringify(cutoffSamples));
console.log('bad json rows:', bad);
// meta 形状抽样（corpus 行）
const metaRow = db.prepare("SELECT id, evidence_json FROM predictions WHERE evidence_json LIKE '%meta%' LIMIT 1").get();
if (metaRow) console.log('meta sample id=' + metaRow.id + ' :: ' + metaRow.evidence_json.slice(0, 600));
const plainRow = db.prepare("SELECT id, evidence_json FROM predictions WHERE evidence_json IS NOT NULL AND evidence_json <> '[]' LIMIT 1").get();
if (plainRow) console.log('plain sample id=' + plainRow.id + ' :: ' + String(plainRow.evidence_json).slice(0, 400));
db.close();
