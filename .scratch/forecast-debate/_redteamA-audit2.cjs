'use strict';
const { db } = require("E:/music player/p1b/src/deps");
db.init("E:/music player/p1a-terminal/data/p1a.db");
const conn = db.getConnection();
const q = (sql) => conn.prepare(sql).all();
const one = (sql) => conn.prepare(sql).get();
// 1) 那条 0.5 的记录（median 巧合还是漏写？）
console.log("prob05_row=", JSON.stringify(q("SELECT id, game_id, layer, statement, assigned_prob, outcome FROM predictions WHERE assigned_prob=0.5")));
// 该行的三路 verdicts
const pid = one("SELECT id FROM predictions WHERE assigned_prob=0.5").id;
console.log("prob05_verdicts=", JSON.stringify(q("SELECT prompt_variant, implied_prob FROM verdicts WHERE prediction_id=" + pid)));
// 2) 缺路明细：哪些 pid 各缺几路
console.log("pid_missing_by_variant=", JSON.stringify(q("SELECT prompt_variant, COUNT(*) missing FROM (SELECT p.id pid, v.prompt_variant FROM predictions p LEFT JOIN verdicts v ON v.prediction_id=p.id) WHERE prompt_variant IS NULL GROUP BY pid, prompt_variant LIMIT 20")));
// 直接数每路缺的 pid
console.log("per_variant_missing=", JSON.stringify(q("SELECT pv.v variant, COUNT(*) missing FROM (SELECT p.id, 'v1_evidence' v FROM predictions p LEFT JOIN verdicts v1 ON v1.prediction_id=p.id AND v1.prompt_variant='v1_evidence' WHERE v1.prediction_id IS NULL UNION ALL SELECT p.id, 'v2_skeptical' FROM predictions p LEFT JOIN verdicts v2 ON v2.prediction_id=p.id AND v2.prompt_variant='v2_skeptical' WHERE v2.prediction_id IS NULL UNION ALL SELECT p.id, 'v3_baserate' FROM predictions p LEFT JOIN verdicts v3 ON v3.prediction_id=p.id AND v3.prompt_variant='v3_baserate' WHERE v3.prediction_id IS NULL) pv GROUP BY pv.v")));
// 3) claims 正确口径（无 game_id 列——看 schema）
console.log("claims_schema=", JSON.stringify(q("SELECT name FROM pragma_table_info('claims')")));
// 4) verdicts 有没有重复行（幂等验证）
console.log("verdicts_dup=", one("SELECT COUNT(*) n FROM (SELECT prediction_id, prompt_variant, temperature, COUNT(*) c FROM verdicts GROUP BY prediction_id, prompt_variant, temperature HAVING c>1)").n);
// 5) L1 层 30 条的 implied_prob 分布（恒 false 题判词给什么值）
console.log("L1_prob_dist=", JSON.stringify(q("SELECT ROUND(v.implied_prob,1) b, COUNT(*) n FROM verdicts v JOIN predictions p ON p.id=v.prediction_id WHERE p.layer='L1' GROUP BY b ORDER BY b")));
db.closeCurrent();
