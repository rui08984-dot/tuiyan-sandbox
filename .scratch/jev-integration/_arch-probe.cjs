// 引擎架构师 · 只读探针（本次亲测用；只读连接，零写库、零网络、零安装）
// 目的：核验 stage4-run.cjs::l2RivalArmCheck() 的两个承重前提
//   ① L2 行是否真的"无任何 LLM 判词"（l2Verdicts === 0）
//   ② L2 的 assigned_prob 是否与 baseRateNote 基率逐行相同
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('p1a-terminal/data/p1a.db', { readOnly: true });

const q = (sql) => db.prepare(sql).all();
const one = (sql) => db.prepare(sql).get();

console.log('=== 1. 层 × 是否有判词（R4 已解行）===');
console.log(q(`SELECT p.layer AS layer,
                      COUNT(*) AS rows_n,
                      SUM(CASE WHEN (SELECT COUNT(*) FROM verdicts v WHERE v.prediction_id=p.id)>0 THEN 1 ELSE 0 END) AS rows_with_verdicts,
                      (SELECT COUNT(*) FROM verdicts v JOIN predictions p2 ON p2.id=v.prediction_id WHERE p2.layer=p.layer AND p2.g2_regime='R4') AS verdict_rows
                 FROM predictions p
                WHERE p.g2_regime='R4' AND p.outcome IS NOT NULL
                GROUP BY p.layer ORDER BY p.layer`));

console.log('=== 2. assigned_prob vs evidence.baseRate（L2/L3）===');
console.log(q(`SELECT p.layer AS layer, COUNT(*) AS n,
                      SUM(CASE WHEN p.assigned_prob IS NULL THEN 1 ELSE 0 END) AS assigned_null,
                      SUM(CASE WHEN json_extract(e.value,'$.baseRate.p') IS NOT NULL THEN 1 ELSE 0 END) AS has_baserate_p
                 FROM predictions p, json_each(p.evidence_json) e
                WHERE p.g2_regime='R4' AND p.outcome IS NOT NULL
                  AND json_extract(e.value,'$.baseRate') IS NOT NULL
                GROUP BY p.layer ORDER BY p.layer`));

console.log('=== 3. L2 行样本：assigned_prob 与 baseRate.p 逐行差（前 5 行 + 最大差）===');
const pairs = q(`SELECT p.id, p.assigned_prob AS ap, json_extract(e.value,'$.baseRate.p') AS bp
                   FROM predictions p, json_each(p.evidence_json) e
                  WHERE p.g2_regime='R4' AND p.outcome IS NOT NULL AND p.layer='L2'
                    AND json_extract(e.value,'$.baseRate') IS NOT NULL
                  ORDER BY p.id`);
let maxd = 0, cmp = 0, same = 0, diff = 0;
for (const r of pairs) {
  if (r.ap === null || r.bp === null) continue;
  const d = Math.abs(Number(r.ap) - Number(r.bp)); cmp++;
  if (d > maxd) maxd = d;
  if (d <= 1e-3) same++; else diff++;
}
console.log({ l2_pairs_compared: cmp, within_1e_3: same, differing: diff, max_abs_diff: maxd });

console.log('=== 4. 层 × 域 格（第 4 期放行门相关，n≥30 计数）===');
const cells = q(`SELECT p.layer AS layer,
                        json_extract(e.value,'$.resolve.kind') AS kind,
                        COUNT(*) AS n
                   FROM predictions p, json_each(p.evidence_json) e
                  WHERE p.g2_regime='R4' AND p.outcome IS NOT NULL
                    AND json_extract(e.value,'$.resolve.kind') IS NOT NULL
                  GROUP BY p.layer, kind ORDER BY n DESC LIMIT 12`);
console.log(cells);
console.log('cells_with_n_ge_30 =', cells.filter((c) => c.n >= 30).length, '（本探针只按 resolve.kind 粗切，非 domain.js 派生态）');

console.log('=== 5. verdicts 的 prompt_variant / run_id 分布（实验命名空间）===');
console.log(q(`SELECT prompt_variant, COUNT(*) AS n FROM verdicts GROUP BY prompt_variant`));
console.log(q(`SELECT COALESCE(run_id,'(null)') AS run_id, COUNT(*) AS n FROM verdicts GROUP BY run_id ORDER BY n DESC LIMIT 10`));

db.close();
