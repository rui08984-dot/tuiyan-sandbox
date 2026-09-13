'use strict';
// 口径B 微步1 探测（零写库）：抽 resolve 样本看日期键实态。只读打开。
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const db = new Database('E:/music player/p1a-terminal/data/p1a.db', { readonly: true, fileMustExist: true });
const KINDS = ['crossref_week_total','openalex_works_count','jpl_cad_monthly_count','bom_weekend_top10_gross','nvd_cve_week_count','dbnomics_wb_commodity_annual','github_weekly_commits','npm_downloads_window','delphi_fluview_ili','cwl_ssq_red_contains','dlt_draw_result'];
for (const k of KINDS) {
  const rows = db.prepare("SELECT p.id, e.value AS ev FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=? ORDER BY p.id LIMIT 2").all(k);
  const n = db.prepare("SELECT COUNT(DISTINCT p.id) n FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=?").get(k).n;
  console.log('## ' + k + ' (n=' + n + ')');
  for (const r of rows) {
    let o; try { o = JSON.parse(r.ev).resolve || {}; } catch (e) { o = { __err: e.message }; }
    console.log('  id=' + r.id + ' ' + JSON.stringify(o).slice(0, 400));
  }
}
// 彩票期号范围（锚期用）
for (const k of ['cwl_ssq_red_contains','cwl_ssq_blue_odd','dlt_draw_result']) {
  const mm = db.prepare("SELECT MIN(json_extract(e.value,'$.resolve.issue')) lo, MAX(json_extract(e.value,'$.resolve.issue')) hi FROM predictions p, json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve.kind')=?").get(k);
  console.log('ISSUE-RANGE ' + k + ' lo=' + mm.lo + ' hi=' + mm.hi);
}
db.close();
