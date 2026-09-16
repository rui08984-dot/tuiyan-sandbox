'use strict';
/**
 * p1b/src/evidence/seriesKey.js —— E1 源系列键的**单一真源**（2026-09-17）
 *
 * 用途：把题面 `resolve` 映射成「源数据系列」的唯一键——取数（dna-s-source-snapshot.cjs）与
 *   标签计算（dna-s-backfill.cjs）**共用本件**，防两边各写一套键导致匹配漂移（E1 主口径纪律）。
 * 规则（按 kind 分派，逐条写明）：
 *   · openmeteo 族（有 lat/lon）        → kind|lat|lon
 *   · dbnomics_series_value             → kind|provider|dataset|series
 *   · frankfurter*（汇率）              → kind|base|quote
 *   · wikimedia_pageviews               → kind|article
 *   · npm_downloads_window              → kind|package
 *   · github_weekly_commits             → kind|repo
 *   其余 kind 返回 null（本轮不支持的源，如实登记）。
 */
function seriesKeyOf(rj) {
  if (!rj) return null;
  const k = String(rj.kind || '');
  if (!k) return null;
  if (rj.lat !== undefined && rj.lat !== null && rj.lon !== undefined && rj.lon !== null) return [k, rj.lat, rj.lon].join('|');
  if (k === 'dbnomics_series_value') return [k, rj.provider, rj.dataset, rj.series].join('|');
  if (/^frankfurter/.test(k)) return [k, rj.base, rj.quote].join('|');
  if (k === 'wikimedia_pageviews') return [k, rj.article].join('|');
  if (k === 'npm_downloads_window') return [k, rj.package].join('|');
  if (k === 'github_weekly_commits') return [k, rj.repo].join('|');
  return null;
}
module.exports = { seriesKeyOf: seriesKeyOf };
