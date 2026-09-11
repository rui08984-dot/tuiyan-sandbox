'use strict';
/** p13 微步1 探测脚本：predictions/verdicts 行数 + sim 域选题数（只读，零写入）。 */
const { db } = require('../src/deps');
const conn = db.getConnection();
console.log('predictions', conn.prepare('SELECT COUNT(*) n FROM predictions').get().n);
console.log('by_source', JSON.stringify(conn.prepare('SELECT source_type, COUNT(*) n FROM predictions GROUP BY source_type').all()));
console.log('simjoin_L1L6', conn.prepare("SELECT COUNT(*) n FROM predictions pr JOIN games g ON g.id = pr.game_id WHERE g.source = 'sim' AND pr.layer IN ('L1','L6')").get().n);
console.log('games_by_source', JSON.stringify(conn.prepare("SELECT source, COUNT(*) n FROM games GROUP BY source").all()));
try {
  console.log('verdicts', conn.prepare('SELECT COUNT(*) n FROM verdicts').get().n);
  console.log('verdicts_cols', JSON.stringify(conn.prepare('PRAGMA table_info(verdicts)').all().map((c) => c.name)));
} catch (e) { console.log('verdicts ERR', e.message); }
try { db.closeCurrent(); } catch (e) {}
