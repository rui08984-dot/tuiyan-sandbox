'use strict';
// RB-③ 溯源纠正：R-B 批行 run_id 从 f232e2a54689（误用 R-A PREREG hash）改 ca1b5cdbddfc（PREREG-RB）。
// 只动 f232e2a54689 前缀行（R-B 批），R-A 268 行 NULL 与烟测 ca1b 行不动；前后分布留痕。
const { db } = require('../src/deps');
db.init();
const conn = db.getConnection();
const dist = () => conn.prepare('SELECT run_id, COUNT(*) n FROM verdicts GROUP BY run_id ORDER BY n DESC').all();
console.log('BEFORE=' + JSON.stringify(dist()));
const info = conn.prepare("UPDATE verdicts SET run_id = 'ca1b5cdbddfc' WHERE run_id = 'f232e2a54689'").run();
console.log('UPDATE changes=' + info.changes);
console.log('AFTER=' + JSON.stringify(dist()));
const tot = conn.prepare('SELECT COUNT(*) n FROM verdicts').get().n;
const rbRows = conn.prepare("SELECT COUNT(*) n FROM verdicts WHERE run_id = 'ca1b5cdbddfc'").get().n;
console.log('verdicts 总数=' + tot + '（R-B 批 ca1b 行=' + rbRows + '，应为 1080=360×3）');
const missing = conn.prepare("SELECT COUNT(DISTINCT p.id) n FROM predictions p LEFT JOIN verdicts v ON v.prediction_id = p.id WHERE p.checklist_hash='v2' AND v.id IS NULL").get().n;
console.log('v2 题无判词行数=' + missing + '（应为 0）');
const partial = conn.prepare("SELECT p.id, COUNT(v.id) n FROM predictions p LEFT JOIN verdicts v ON v.prediction_id = p.id WHERE p.checklist_hash='v2' GROUP BY p.id HAVING n <> 3").all();
console.log('路数≠3 的题=' + JSON.stringify(partial));
db.closeCurrent();
