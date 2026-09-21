// 引擎架构师 · 只读探针 2：L6/L1 生产聚合实际吃的是哪一批 verdicts（run_id）
// 照 l6_structural.js 固定规则：每变体取 id 最大的非空 implied_prob 一条 ⇒ p = 各可用变体均值
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('p1a-terminal/data/p1a.db', { readOnly: true });
const q = (sql) => db.prepare(sql).all();

console.log('=== A. 全部 verdicts：run_id × prompt_variant 交叉 ===');
console.log(q(`SELECT COALESCE(run_id,'(null)') AS run_id, prompt_variant, COUNT(*) AS n, MAX(id) AS max_id
                 FROM verdicts GROUP BY run_id, prompt_variant ORDER BY max_id DESC LIMIT 30`));

console.log('=== B. L6 行的"生产输入"（每变体 id 最大一条）归属哪一批 ===');
console.log(q(`SELECT COALESCE(v.run_id,'(null)') AS run_id, COUNT(*) AS n
                 FROM verdicts v
                WHERE v.implied_prob IS NOT NULL
                  AND v.id IN (SELECT MAX(v2.id) FROM verdicts v2
                                WHERE v2.prediction_id=v.prediction_id AND v2.prompt_variant=v.prompt_variant
                                  AND v2.implied_prob IS NOT NULL)
                  AND v.prediction_id IN (SELECT id FROM predictions WHERE layer='L6')
                GROUP BY run_id ORDER BY n DESC`));

console.log('=== C. L1 行同理 ===');
console.log(q(`SELECT COALESCE(v.run_id,'(null)') AS run_id, COUNT(*) AS n
                 FROM verdicts v
                WHERE v.implied_prob IS NOT NULL
                  AND v.id IN (SELECT MAX(v2.id) FROM verdicts v2
                                WHERE v2.prediction_id=v.prediction_id AND v2.prompt_variant=v.prompt_variant
                                  AND v2.implied_prob IS NOT NULL)
                  AND v.prediction_id IN (SELECT id FROM predictions WHERE layer='L1')
                GROUP BY run_id ORDER BY n DESC`));

console.log('=== D. EXPERIMENT_RUN_PREFIXES 当前登记值 ===');
const fs = require('fs');
const src = fs.readFileSync('p1b/src/engines/l6_structural.js', 'utf8');
const m = src.match(/EXPERIMENT_RUN_PREFIXES\s*=\s*\[[^\]]*\]/);
console.log(m ? m[0] : '未匹配');

db.close();
