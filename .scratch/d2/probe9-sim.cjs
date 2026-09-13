'use strict';
const path = require('path'); const ROOT = path.resolve(__dirname, '..', '..');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'), { readOnly: true });
const all = (s) => db.prepare(s).all(); const one = (s) => db.prepare(s).get();
const out = (k, v) => console.log(k + ': ' + JSON.stringify(v));
// 题源=games.source（predictions.source_type 恒为中文「预测卡」，不可作域过滤）
out('sim_games', one("SELECT COUNT(*) c FROM games WHERE source='sim'").c);
out('sim_games_types', all("SELECT game_type, COUNT(*) c FROM games WHERE source='sim' GROUP BY game_type"));
out('sim_predictions', one("SELECT COUNT(*) c FROM predictions p JOIN games g ON g.id=p.game_id WHERE g.source='sim'").c);
out('sim_resolved_predictions', one("SELECT COUNT(*) c FROM predictions p JOIN games g ON g.id=p.game_id WHERE g.source='sim' AND p.outcome IS NOT NULL").c);
out('sim_resolved_distinct_points', one("SELECT COUNT(DISTINCT v.prediction_id || '|' || v.prompt_variant) c FROM verdicts v JOIN predictions p ON p.id=v.prediction_id JOIN games g ON g.id=p.game_id WHERE g.source='sim' AND p.outcome IS NOT NULL").c);
out('sim_resolved_points_by_runid', all("SELECT v.run_id, COUNT(DISTINCT v.prediction_id || '|' || v.prompt_variant) pts, COUNT(*) rows FROM verdicts v JOIN predictions p ON p.id=v.prediction_id JOIN games g ON g.id=p.game_id WHERE g.source='sim' AND p.outcome IS NOT NULL GROUP BY v.run_id"));
out('sim_all_points_by_runid', all("SELECT v.run_id, COUNT(DISTINCT v.prediction_id || '|' || v.prompt_variant) pts FROM verdicts v JOIN predictions p ON p.id=v.prediction_id JOIN games g ON g.id=p.game_id WHERE g.source='sim' GROUP BY v.run_id"));
out('sim_pairing_capacity', one("SELECT COUNT(*) c FROM (SELECT v.prediction_id, v.prompt_variant FROM verdicts v JOIN predictions p ON p.id=v.prediction_id JOIN games g ON g.id=p.game_id WHERE g.source='sim' GROUP BY v.prediction_id, v.prompt_variant HAVING COUNT(DISTINCT v.run_id) >= 2)").c);
out('sim_pairing_capacity_all_runs', one("SELECT COUNT(*) c FROM (SELECT v.prediction_id, v.prompt_variant FROM verdicts v JOIN predictions p ON p.id=v.prediction_id JOIN games g ON g.id=p.game_id WHERE g.source='sim' GROUP BY v.prediction_id, v.prompt_variant)").c);
out('sim_pred_resolution_split', all("SELECT p.layer, SUM(p.outcome IS NOT NULL) resolved, COUNT(*) total FROM predictions p JOIN games g ON g.id=p.game_id WHERE g.source='sim' GROUP BY p.layer ORDER BY p.layer"));
out('runs_per_sim_point', all("SELECT n_runs, COUNT(*) pts FROM (SELECT v.prediction_id, v.prompt_variant, COUNT(DISTINCT v.run_id) n_runs FROM verdicts v JOIN predictions p ON p.id=v.prediction_id JOIN games g ON g.id=p.game_id WHERE g.source='sim' GROUP BY v.prediction_id, v.prompt_variant) GROUP BY n_runs ORDER BY n_runs"));
db.close();