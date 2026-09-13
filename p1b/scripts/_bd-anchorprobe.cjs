'use strict';
// 口径B 微步1 锚点探测（零写库）：彩票题面/时间戳找开奖日锚；BOM week 构造法在生成脚本侧另查。只读。
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });
for (const k of ['cwl_ssq_red_contains','cwl_ssq_blue_odd','dlt_draw_result']) {
  const rows = db.prepare("SELECT p.id, p.statement, p.created_at, p.resolved_at FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=? ORDER BY p.id LIMIT 3").all(k);
  console.log('## ' + k);
  for (const r of rows) console.log('  id=' + r.id + ' created=' + r.created_at + ' resolved=' + r.resolved_at + ' stmt=' + String(r.statement).slice(0, 160));
}
// resolved_at vs issue：看最高已结期的 resolved_at（开奖日 <= resolved_at 的紧上界）
const top = db.prepare("SELECT json_extract(e.value,'$.resolve.issue') issue, MAX(p.resolved_at) ra FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind') IN ('cwl_ssq_red_contains','cwl_ssq_blue_odd') GROUP BY issue ORDER BY issue DESC LIMIT 2").all();
console.log('SSQ top settled: ' + JSON.stringify(top));
const top2 = db.prepare("SELECT json_extract(e.value,'$.resolve.issue') issue, MAX(p.resolved_at) ra FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')='dlt_draw_result' GROUP BY issue ORDER BY issue DESC LIMIT 2").all();
console.log('DLT top settled: ' + JSON.stringify(top2));
db.close();
