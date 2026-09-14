'use strict';
// 口径B 微步3 探测（只读）：427 行 no-date 精确分解 + phase 值分布交叉表
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });
const cols = db.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name);
console.log('COLS=' + cols.join(','));
const rows = db.prepare("SELECT p.id, p.statement, p.created_at, p.matures_at, e.value ev FROM predictions p, json_each(p.evidence_json) e WHERE p.g2_regime='R4' AND json_extract(e.value,'$.resolve.kind') IS NOT NULL AND json_extract(e.value,'$.resolve.date') IS NULL AND json_extract(e.value,'$.baseRateNote') IS NOT NULL").all();
console.log('NO_DATE_ROWS=' + rows.length);
// phase 候选位置：列？evidence 顶层？meta？
const s0 = rows[0];
const e0 = JSON.parse(s0.ev);
console.log('EV_KEYS=' + Object.keys(e0).join(','));
const phCol = cols.includes('phase');
console.log('HAS_PHASE_COL=' + phCol);
const byPhase = {}, byBf = { bf: 0, rt: 0 }, cross = {};
let samplePhase = [];
for (const r of rows) {
  const bf = String(r.statement || '').indexOf('【backfill】') >= 0;
  let phase = null;
  if (phCol) phase = db.prepare('SELECT phase FROM predictions WHERE id=?').get(r.id).phase;
  else { const e = JSON.parse(r.ev); phase = (e.phase !== undefined ? String(e.phase) : (e.meta && e.meta.phase !== undefined ? String(e.meta.phase) : 'ABSENT')); }
  byPhase[phase] = (byPhase[phase] || 0) + 1;
  const cls = bf ? 'bf' : 'rt';
  byBf[cls]++;
  const k = cls + '|' + phase;
  cross[k] = (cross[k] || 0) + 1;
  if (samplePhase.length < 3 && phase !== 'ABSENT') samplePhase.push(r.id + '=' + phase);
}
console.log('BY_STATEMENT_MARKER=' + JSON.stringify(byBf));
console.log('BY_PHASE=' + JSON.stringify(byPhase));
console.log('CROSS=' + JSON.stringify(cross));
console.log('SAMPLE=' + JSON.stringify(samplePhase));
db.close();
