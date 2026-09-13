'use strict';
// _b1-g2-backtest-e2e：端到端证明 #1 回测排除子句真的生效（临时库，非生产）
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const S = require('../src/db/predictionsStore');
const P = 'E:/music player/p1b/sim/out/_b1-backtest-e2e.db';
try { fs.unlinkSync(P); } catch (e) {}
const db = new DatabaseSync(P);
db.exec(S.predictionsTableDdl('predictions'));
db.exec('CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT, game_type TEXT, player_count INTEGER)');
db.exec("INSERT INTO games (id, name, game_type, player_count) VALUES (1, 'e2e', 't', 1)");
const ins = db.prepare('INSERT INTO predictions (game_id, day, source_type, statement, evidence_json, layer, created_at, matures_at, checklist_hash, tautology, g2_regime, metric_version, backtest_batch) VALUES (1, 0, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)');
const ev = (d, pct) => JSON.stringify([{ resolve: { date: d, kind: 'openmeteo_daily_max' }, baseRateNote: '占 ' + pct + '%' }]);
ins.run('预测卡', '前瞻 A（正常题）', ev('2026-09-20', '50.0'), 'L3', '2026-09-01 00:00:00', '2026-09-20', 'v2', 'R4', null, null);
ins.run('预测卡', '前瞻 B（正常题）', ev('2026-09-21', '50.0'), 'L3', '2026-09-02 00:00:00', '2026-09-21', 'v2', 'R4', null, null);
ins.run('预测卡', '【backfill】D2 回测题（应被排除）', ev('2024-06-01', '50.0'), 'L2', '2020-01-01 00:00:00', '2024-06-01', 'v2', 'R4', 'bt-v1', 'D2-001');
console.log('temp rows=' + db.prepare('SELECT COUNT(*) n FROM predictions').get().n + ' | backtest标记行=' + db.prepare("SELECT COUNT(*) n FROM predictions WHERE metric_version IS NOT NULL OR backtest_batch IS NOT NULL").get().n);
db.close();