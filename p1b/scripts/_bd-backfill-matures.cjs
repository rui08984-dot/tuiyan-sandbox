'use strict';
// 口径B 微步3：前瞻行补列 matures_at=effective_date（254 行预期；分批 ≤100；幂等 WHERE 守卫）
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const DB = 'E:/music player/p1a-terminal/data/p1a.db';
const db = new Database(DB, { fileMustExist: true });
db.pragma('busy_timeout = 15000');
// ── 派生函数（与 g2-report.cjs 补丁逐字同构）──
const pad2 = (n) => String(n).padStart(2, '0');
function addDays(ds, n) { const t = new Date(ds + 'T00:00:00Z').getTime(); return isNaN(t) ? null : new Date(t + n * 86400000).toISOString().slice(0, 10); }
function monthlyNextEnd(s) { const m = /^([0-9]{4})-([0-9]{2})$/.exec(s); if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]); if (mo < 1 || mo > 12) return null;
  let ny = y, nm = mo + 1; if (nm > 12) { nm = 1; ny++; }
  return ny + '-' + pad2(nm) + '-' + pad2(new Date(Date.UTC(ny, nm, 0)).getUTCDate()); }
function epiweek(s) { const m = /^([0-9]{4})([0-9]{2})$/.exec(s); if (!m) return null;
  const y = Number(m[1]), n = Number(m[2]); if (n < 1 || n > 53) return null;
  const dow = new Date(Date.UTC(y, 0, 4)).getUTCDay();
  const s1 = addDays(y + '-01-04', 6 - dow); return s1 ? addDays(s1, (n - 1) * 7) : null; }
function bomWeek(s) { const m = /^([0-9]{4})W([0-9]{2})$/.exec(s); if (!m) return null;
  const n = Number(m[2]); if (n < 1 || n > 53) return null;
  return addDays(m[1] + '-01-04', (n - 1) * 7); }
function draw(s) {
  const cfg = { 7: { yl: 4, year: 2026, issue: 106, date: '2026-09-13', offs: [0, 2, 4] }, 5: { yl: 2, year: 26, issue: 105, date: '2026-09-14', offs: [0, 2, 5] } }[s.length];
  if (!cfg) return null;
  const y = Number(s.slice(0, cfg.yl)); if (y !== cfg.year) return null;
  const k = Number(s.slice(cfg.yl)) - cfg.issue;
  return addDays(cfg.date, Math.floor(k / 3) * 7 + cfg.offs[((k % 3) + 3) % 3]); }
// ── 锚点自检（微步1/2 已实证值；不一致即中止不写库）──
const T = [["2026-09", monthlyNextEnd, '2026-10-31'], ["2027", (s) => /^[0-9]{4}$/.test(s) ? (Number(s) + 1) + '-12-31' : null, '2028-12-31'],
  ["2026101", draw, '2026-09-01'], ["2026099", draw, '2026-08-27'], ["2026106", draw, '2026-09-13'], ["2026124", draw, '2026-10-25'],
  ["26104", draw, '2026-09-12'], ["26105", draw, '2026-09-14'], ["26107", draw, '2026-09-19'], ["26123", draw, '2026-10-26'],
  ["202639", epiweek, '2026-10-03'], ["2026W37", bomWeek, '2026-09-13'], ["2026W40", bomWeek, '2026-10-04']];
for (const [inp, fn, want] of T) { const got = fn(inp); if (got !== want) { console.error('SELFTEST_FAIL ' + inp + ' got=' + got + ' want=' + want); process.exit(1); } }
console.log('SELFTEST_OK ' + T.length + ' anchors');
// ── 取 427 行并派生 ──
const rows = db.prepare("SELECT p.id, p.statement, p.created_at, p.matures_at, e.value ev FROM predictions p, json_each(p.evidence_json) e WHERE p.g2_regime='R4' AND json_extract(e.value,'$.resolve.kind') IS NOT NULL AND json_extract(e.value,'$.resolve.date') IS NULL AND json_extract(e.value,'$.baseRateNote') IS NOT NULL").all();
function tryDerive(ev) {
  const o = JSON.parse(ev); const r = o.resolve || {};
  const RULES = { 'dbnomics_series_value': ['period', 'monthly'], 'dbnomics_bis_monthly_mean': ['month', 'monthly'], 'dbnomics_eurostat_unemployment_monthly': ['month', 'monthly'], 'eurostat_live_unemployment_monthly': ['month', 'monthly'], 'swpc_solar_cycle_monthly': ['month', 'monthly'], 'noaa_solar_cycle_ssn_monthly': ['month', 'monthly'], 'jpl_cad_monthly_count': ['month', 'monthly'], 'dbnomics_wb_commodity_annual': ['year', 'yearly'], 'eurostat_demo_pjan_annual': ['year', 'yearly'], 'eurostat_live_tertiary_attain': ['year', 'yearly'], 'dbnomics_eurostat_tertiary_attain': ['year', 'yearly'], 'npm_downloads_window': ['end', 'daily'], 'github_weekly_commits': ['week_end', 'daily'], 'openalex_works_count': ['end', 'daily'], 'delphi_fluview_ili': ['epiweek', 'weekly'], 'delphi_fluview_num_ili': ['epiweek', 'weekly'], 'cwl_ssq_red_contains': ['issue', 'draw'], 'cwl_ssq_blue_odd': ['issue', 'draw'], 'dlt_draw_result': ['issue', 'draw'], 'crossref_week_total': ['week_start', 'weekly'], 'nvd_cve_week_count': ['week_start', 'weekly'], 'bom_weekend_top10_gross': ['week', 'weekly'] };
  const rule = RULES[r.kind]; if (!rule) return { ok: false, reason: 'no_rule' };
  const sv = r[rule[0]]; if (sv === undefined || sv === null) return { ok: false, reason: 'missing' };
  const s = String(sv); let out = null; const g = rule[1];
  if (g === 'daily') out = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) ? s : null;
  else if (g === 'monthly') out = monthlyNextEnd(s);
  else if (g === 'yearly') out = /^[0-9]{4}$/.test(s) ? (Number(s) + 1) + '-12-31' : null;
  else if (g === 'weekly') { if (/^[0-9]{6}$/.test(s)) out = epiweek(s); else if (/^[0-9]{4}W[0-9]{2}$/.test(s)) out = bomWeek(s); else if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) out = addDays(s, 6); }
  else if (g === 'draw') out = draw(s);
  return out ? { ok: true, date: out } : { ok: false, reason: 'derive_failed' };
}
const updates = []; const stats = { total: rows.length, bf: 0, rt_derived: 0, rt_cutoff_excl: 0, rt_has_matures: 0, failed: 0 };
for (const r of rows) {
  const bf = String(r.statement || '').indexOf('【backfill】') >= 0;
  if (bf) { stats.bf++; continue; }
  const dd = tryDerive(r.ev);
  if (!dd.ok) { stats.failed++; continue; }
  stats.rt_derived++;
  const created = String(r.created_at).slice(0, 19);
  if (!(created < dd.date)) { stats.rt_cutoff_excl++; continue; }
  if (r.matures_at !== null && r.matures_at !== undefined && String(r.matures_at) !== '') { stats.rt_has_matures++; continue; }
  updates.push({ id: r.id, date: dd.date });
}
console.log('STATS=' + JSON.stringify(stats));
console.log('UPDATE_CANDIDATES=' + updates.length);
if (updates.length !== 254) { console.error('SCOPE_MISMATCH（预期 254）——中止不写'); process.exit(1); }
const nonNull = db.prepare('SELECT COUNT(*) n FROM predictions WHERE matures_at IS NOT NULL').get().n;
console.log('MATURES_NONNULL_BEFORE=' + nonNull);
let done = 0;
for (let i = 0; i < updates.length; i += 100) {
  const chunk = updates.slice(i, i + 100);
  db.transaction(() => { for (const u of chunk) done += db.prepare('UPDATE predictions SET matures_at=? WHERE id=? AND matures_at IS NULL').run(u.date, u.id).changes; })();
  console.log('BATCH ' + (Math.floor(i / 100) + 1) + ' updated_cum=' + done);
}
const nonNull2 = db.prepare('SELECT COUNT(*) n FROM predictions WHERE matures_at IS NULL').get();
const chk = db.prepare('PRAGMA integrity_check').get();
console.log('UPDATED_TOTAL=' + done);
console.log('MATURES_NONNULL_AFTER=' + (nonNull + done));
console.log('STILL_NULL=' + nonNull2.n + ' INTEGRITY=' + JSON.stringify(chk));
db.close();
