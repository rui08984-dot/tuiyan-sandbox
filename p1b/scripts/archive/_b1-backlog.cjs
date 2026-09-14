'use strict';
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true });
const q = (s) => db.prepare(s).get().n;
console.log('today(UTC)=' + db.prepare("SELECT date('now') d").get().d);
const defs = [
  ['A 未结算且已过到期日', "SELECT COUNT(*) n FROM predictions WHERE outcome IS NULL AND matures_at IS NOT NULL AND matures_at <> '' AND matures_at < date('now')"],
  ['B A 且 R4', "SELECT COUNT(*) n FROM predictions WHERE outcome IS NULL AND matures_at IS NOT NULL AND matures_at <> '' AND matures_at < date('now') AND g2_regime='R4'"],
  ['C 未结算且 matures 非空且 <= 今天', "SELECT COUNT(*) n FROM predictions WHERE outcome IS NULL AND matures_at IS NOT NULL AND matures_at <> '' AND matures_at <= date('now')"],
  ['D 未结算总数', 'SELECT COUNT(*) n FROM predictions WHERE outcome IS NULL'],
  ['E 未结算且有 resolve.date', "SELECT COUNT(*) n FROM predictions WHERE outcome IS NULL AND json_extract(evidence_json,'$[0].resolve.date') IS NOT NULL"],
];
for (const d of defs) console.log('  ' + d[0] + ' = ' + q(d[1]));
console.log('A ids=' + JSON.stringify(db.prepare("SELECT id FROM predictions WHERE outcome IS NULL AND matures_at IS NOT NULL AND matures_at <> '' AND matures_at < date('now') ORDER BY matures_at").all().map((r) => r.id)));
console.log('A by matures=' + JSON.stringify(db.prepare("SELECT matures_at, COUNT(*) n FROM predictions WHERE outcome IS NULL AND matures_at IS NOT NULL AND matures_at <> '' AND matures_at < date('now') GROUP BY matures_at ORDER BY matures_at").all()));
db.close();