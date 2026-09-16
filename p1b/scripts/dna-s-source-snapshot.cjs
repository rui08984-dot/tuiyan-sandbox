#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/dna-s-source-snapshot.cjs —— E1 主口径 · 源数据侧快照重建（2026-09-16 · P0+）
 *
 * 依据：`12-PREREG-E1-DNA加列S维-v1.md` §1「窗口来源主次：主=源数据侧快照重建（一次性拉取约 15–25 个系列的历史，
 *   零 LLM，快照与 k1/n1/k2/n2 落旁路表保复现）」。本件只做**取数与快照落盘**（零 LLM、零写库）；
 *   标签计算在 `dna-s-backfill.cjs --route source` 读本快照完成（窗口语义＝与引擎基率同窗，避免窗错位批评）。
 *
 * 窗口语义（逐类写明，来源＝题面 evidence 的 baseRateNote 实文，见【12】§1 理由②）：
 *   · 季节性窗（daily_max / forecast_daily_max）：cutoff 所在月的**同月历史日**（前 10 年，约 300 日）
 *   · 尾随窗（air / wx / forecast_precipitation 等）：cutoff 前的**最近 N 日**（N≈100–400，按 note 实文取 400 上限）
 * 取数口径：archive-api.open-meteo.com（日值直取）／air-quality-api.open-meteo.com（小时值→日算术均值，照 field 实文）。
 * 纪律：零 LLM；只落快照到 sim/out；不含任何 key；失败逐系列如实登记（不编数）。
 * 用法：node p1b/scripts/dna-s-source-snapshot.cjs [--db <path>] [--out-dir <dir>] [--max-series <n>] [--days-back <n>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const MAX_SERIES = Number(arg('max-series', 40));
const ONLY = arg('only', null);                      // 逗号分隔子串（只跑匹配系列；配合 --merge 做「冷却后补拉」）
const MERGE = process.argv.indexOf('--merge') !== -1; // 与当日既有快照合并（补拉不清空已有系列）
const DAYS_BACK = Number(arg('days-back', 420));
const TIMEOUT = Number(arg('timeout', 25000));

/** kind → 取数规则（窗口类型 / API / 变量）；未列入者本轮不支持（如实登记） */
const { seriesKeyOf } = require(path.join(ROOT, 'p1b', 'src', 'evidence', 'seriesKey')); // 系列键单一真源（与 dna-s-backfill 共用）

function ruleFor(kind, urlTemplate, rj) {
  const m = urlTemplate ? /(?:daily|hourly)=([a-z0-9_]+)/i.exec(urlTemplate) : null;
  const varFromTpl = m ? m[1] : null;
  if (kind === 'openmeteo_daily_max' || kind === 'openmeteo_forecast_daily_max') return { api: 'archive', variable: 'temperature_2m_max', window: 'seasonal', note: '同月历史日（前 10 年）' };
  if (kind === 'openmeteo_wx_daily') return { api: 'archive', variable: varFromTpl || 'temperature_2m_max', window: 'trailing', note: 'cutoff 前最近 N 日' };
  if (/^openmeteo_forecast_daily_/.test(kind)) return { api: 'archive', variable: varFromTpl || kind.replace('openmeteo_forecast_daily_', ''), window: 'trailing', note: 'cutoff 前最近 N 日' };
  if (/^openmeteo_air_/.test(kind)) return { api: 'air', variable: varFromTpl || (/pm2_5/.test(kind) ? 'pm2_5' : /pm10/.test(kind) ? 'pm10' : /ozone/.test(kind) ? 'ozone' : 'pm10'), window: 'trailing', note: 'cutoff 前最近 N 日（小时→日均）' };
  // ── 2026-09-17 扩展：五族非 openmeteo 源（免 key 通道；窗口语义照 baseRateNote 实文）──
  if (kind === 'dbnomics_series_value') return { api: 'dbnomics', window: 'full_history', note: '全历史月/期值（标签侧按 cutoff 截断）' };
  if (/^frankfurter/.test(kind)) return { api: 'frankfurter', window: 'trailing', note: 'cutoff 前最近 N 个发布日' };
  if (kind === 'wikimedia_pageviews') return { api: 'wikimedia', window: 'trailing', note: 'cutoff 前最近 N 日日浏览量' };
  if (kind === 'npm_downloads_window') return { api: 'npm7', window: 'trailing', note: 'cutoff 前近日，7 日滚动窗' };
  if (kind === 'github_weekly_commits') return { api: 'github', window: 'full_history', note: '近 ~52 周提交数（stats API 上限）' };
  // ── 2026-09-17 扩展二：模板型家族（rj.url_template 通用取数；host→解析器）──
  const tpl = (rj && (rj.url_template || rj.url)) || null;
  if (tpl) {
    const h = hostParserFor(tpl);
    if (h) return { api: 'template', parser: h, window: 'range', note: '模板型系列（' + h + '；窗口=切点前 ' + DAYS_BACK + ' 天）' };
  }
  return null;
}
/** host → 解析器名（未列入＝不支持，如实登记） */
function hostParserFor(url) {
  const u = String(url);
  if (u.includes('db.nomics.world')) return 'dbnomics';
  if (u.includes('tidesandcurrents.noaa.gov')) return 'noaa_tide';
  if (u.includes('waterservices.usgs.gov')) return 'usgs';
  if (u.includes('data.cityofchicago.org')) return 'socrata_cta';
  if (u.includes('gml.noaa.gov')) return 'csv_gml';
  if (u.includes('ncei.noaa.gov')) return 'ncei';
  if (u.includes('binance.vision') || u.includes('api.binance.com')) return 'binance';
  if (u.includes('kraken.com')) return 'kraken';
  if (u.includes('energy-charts.info')) return 'energycharts';
  if (u.includes('statsapi.mlb.com')) return 'mlb';
  if (u.includes('swpc.noaa.gov')) return 'swpc';
  if (u.includes('ec.europa.eu/eurostat')) return 'eurostat';
  return null;   // 已排除：delphi（MMWR 周换算需专门核对）／jpl（模板无占位符）／bom（HTML 页）／crossref·nvd·elexon·openalex（n<20 按冻结规则不可判）
}
/** 模板占位符替换：首个 {date}/{date_nodash} → 窗口起，其余 → 窗口止；*_ms 用毫秒 */
function buildTemplateUrl(tpl, startStr, endStr, rj) {
  let u = String(tpl);
  const sMs = String(Date.parse(startStr + 'T00:00:00Z'));
  const eMs = String(Date.parse(endStr + 'T23:59:59Z'));
  u = u.replace(/{start_ms}/g, sMs).replace(/{since_ms}/g, sMs).replace(/{end_ms}/g, eMs);
  u = u.replace(/{date_plus7}/g, endStr).replace(/{date_plus6}/g, endStr).replace(/{date_plus1}/g, endStr);
  if (rj) {
    u = u.replace(/{symbol}/g, encodeURIComponent(String(rj.symbol || '')))
         .replace(/{pair}/g, encodeURIComponent(String(rj.pair || '')))
         .replace(/{station}/g, encodeURIComponent(String(rj.station || '')))
         .replace(/{site}/g, encodeURIComponent(String(rj.site || '')))
         .replace(/{geo}/g, encodeURIComponent(String(rj.geo || '')));
  }
  u = u.replace(/lastTimePeriod=[^&]*/g, 'lastTimePeriod=500');
  let firstNodash = true;
  u = u.replace(/{date_nodash}/g, () => { const v = firstNodash ? startStr : endStr; firstNodash = false; return v.replace(/-/g, ''); });
  let firstDate = true;
  u = u.replace(/{date}/g, () => { const v = firstDate ? startStr : endStr; firstDate = false; return v; });
  return u;
}
/** 模板型解析器表：返回 [{date, value}]（date 一律 YYYY-MM-DD） */
const TPL_PARSERS = {
  dbnomics: (j) => { const doc = j && j.series && j.series.docs && j.series.docs[0]; const P = (doc && doc.period) || []; const V = (doc && doc.value) || []; const out = [];
    for (let i = 0; i < P.length; i++) { const p = String(P[i]); if (V[i] === null || V[i] === undefined) continue;
      const d = /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : /^\d{4}-\d{2}$/.test(p) ? p + '-01' : /^\d{4}$/.test(p) ? p + '-01-01' : null; if (d) out.push({ date: d, value: V[i], period: p }); }
    return out; },
  noaa_tide: (j) => { const by = {}; for (const it of (j.predictions || j.data || [])) { const d = String(it.t || '').slice(0, 10); if (!d) continue; const v = Number(it.v); if (!isFinite(v)) continue; if (by[d] === undefined || v > by[d]) by[d] = v; }
    return Object.keys(by).sort().map((d) => ({ date: d, value: by[d] })); },
  usgs: (j) => { const ts = ((j.value || {}).timeSeries || [])[0]; const vals = ts && ts.values && ts.values[0] && ts.values[0].value || []; return vals.map((x) => ({ date: String(x.dateTime || '').slice(0, 10), value: Number(x.value) })).filter((x) => x.date && isFinite(x.value)); },
  socrata_cta: (j) => (Array.isArray(j) ? j : []).map((r) => ({ date: String(r.service_date || '').slice(0, 10), value: Number(r.total_rides) })).filter((x) => x.date && isFinite(x.value)),
  csv_gml: (txt) => { const out = []; for (const line of String(txt).split(/\r?\n/)) { const c = line.split(','); if (c.length < 5) continue; const y = Number(c[0]), m = Number(c[1]), d = Number(c[2]), v = Number(c[4]); if (!isFinite(y) || !isFinite(m) || !isFinite(d) || !isFinite(v)) continue; out.push({ date: y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), value: v }); } return out; },
  ncei: (j) => (Array.isArray(j) ? j : []).map((r) => ({ date: String(r.DATE || '').slice(0, 10), value: Number(r.TMAX) })).filter((x) => x.date && isFinite(x.value)),
  binance: (j) => (Array.isArray(j) ? j : []).map((k) => ({ date: new Date(Number(k[0])).toISOString().slice(0, 10), value: Number(k[4]) })).filter((x) => isFinite(x.value)),
  kraken: (j) => { const res = (j && j.result) || {}; const key = Object.keys(res).filter((x) => x !== 'last')[0]; const arr = (res[key] || []); return arr.map((k) => ({ date: new Date(Number(k[0]) * 1000).toISOString().slice(0, 10), value: Number(k[4]) })).filter((x) => isFinite(x.value)); },
  energycharts: (j, rj) => { const types = (j && j.production_types) || []; if (!types.length) return [];
    const hint = String(rj.field || '');
    const m = /name\s*==\s*「([^」]+)」|name\s*==\s*([^\s的]+)/.exec(hint);
    const want = m ? (m[1] || m[2]) : null;
    const pick = (want && types.find((t) => String(t.name) === want)) || types[0];
    const secs = (j && j.unix_seconds) || []; const by = {};
    for (let i = 0; i < (pick.data || []).length; i++) { const v = Number(pick.data[i]); if (!isFinite(v) || v === null) continue; const t = secs[i] !== undefined ? Number(secs[i]) : null; const d = t ? new Date(t * 1000).toISOString().slice(0, 10) : null; if (!d) continue; (by[d] = by[d] || []).push(v); }
    return Object.keys(by).sort().map((d) => ({ date: d, value: by[d].reduce((a, b) => a + b, 0) / by[d].length, production_type: pick.name })); },
  mlb: (j) => (Array.isArray(j) ? [] : [(j && j.dates) || []]).flat().map((d) => { let sum = 0, n = 0; for (const g of (d.games || [])) { if (String(((g.status || {}).abstractGameState)) !== 'Final') continue; const a = ((g.teams || {}).away || {}).score, h = ((g.teams || {}).home || {}).score; if (a === undefined || h === undefined) continue; sum += Number(a) + Number(h); n++; } return { date: String(d.date || '').slice(0, 10), value: n ? sum : null }; }).filter((x) => x.date && x.value !== null),
  swpc: (j) => (Array.isArray(j) ? j : []).map((r) => ({ date: String(r['time-tag'] || '') + '-01', value: Number(r.ssn) })).filter((x) => /^\d{4}-\d{2}-01$/.test(x.date) && isFinite(x.value)),
  eurostat: (j) => { const t = j && j.dimension && j.dimension.time && j.dimension.time.category && j.dimension.time.category.index; const labels = j && j.dimension && j.dimension.time && j.dimension.time.category && j.dimension.time.category.label; if (!t) return []; const out = [];
    for (const k of Object.keys(t)) { const idx = t[k]; const v = j.value && j.value[idx]; if (v === null || v === undefined) continue; const lab = labels ? labels[k] : k; const d = /^\d{4}$/.test(String(lab)) ? lab + '-01-01' : /^\d{4}-\d{2}$/.test(String(lab)) ? lab + '-01' : null; if (d) out.push({ date: d, value: Number(v) }); } return out; },
};
async function jgetText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; e1-snapshot/1.0)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) { if (attempt === 2) throw e; await new Promise((r) => setTimeout(r, 900 * (attempt + 1))); }
  }
}

async function jget(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; e1-snapshot/1.0)' } });
      if (!res.ok) { let body = ''; try { body = (await res.text()).slice(0, 200).replace(/\s+/g, ' '); } catch (e) { body = ''; } throw new Error('HTTP ' + res.status + ' ' + body); }
      return await res.json();
    } catch (e) { if (attempt === 2) throw e; await new Promise((r) => setTimeout(r, 900 * (attempt + 1))); }   // 退避 0.9s / 1.8s（突发限流用）
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const rows = db.prepare('SELECT p.id, p.layer, '
  + "(SELECT json_extract(e.value,'$.resolve') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.resolve') IS NOT NULL LIMIT 1) AS rj, "
  + "(SELECT json_extract(e.value,'$.baseRateNote') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.baseRateNote') IS NOT NULL LIMIT 1) AS brn, "
  + "(SELECT json_extract(e.value,'$.cutoff') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,'$.cutoff') IS NOT NULL LIMIT 1) AS ev_cutoff, p.matures_at, p.created_at "
  + 'FROM predictions p WHERE p.g2_regime=\'R4\' AND p.layer IN (\'L2\',\'L3\')').all();
db.close();

// 归集系列（kind × lat × lon）
const series = {};
const unsupported = {};
for (const r of rows) {
  let rj = null; try { rj = r.rj ? JSON.parse(r.rj) : null; } catch (e) { rj = null; }
  if (!rj || !rj.kind) continue;
  const rule = ruleFor(String(rj.kind), rj.url_template, rj);
  const key = seriesKeyOf(rj);
  const keyOk = key && key.split('|').every((p) => p !== '' && p !== 'undefined' && p !== 'null');
  if (!rule || !keyOk) { unsupported[String(rj.kind)] = (unsupported[String(rj.kind)] || 0) + 1; continue; }
  if (!series[key]) series[key] = { key: key, kind: String(rj.kind), rj: rj, lat: rj.lat, lon: rj.lon, rule: rule, refs: [], ids: [] };
  series[key].ids.push(r.id);
  series[key].refs.push(String(r.ev_cutoff || r.matures_at || r.created_at || '').slice(0, 10));
}
let list = Object.keys(series).map((k) => series[k]);
if (ONLY) { const pats = ONLY.split(','); list = list.filter((s) => pats.some((p) => s.key.indexOf(p) !== -1)); }
list = list.slice(0, MAX_SERIES);
console.log('=== E1 源侧快照重建（主口径）===');
console.log('系列数（按系列键归集）: ' + Object.keys(series).length + '，本轮取 ' + list.length + (ONLY ? '（--only ' + ONLY + '）' : '') + '；不支持 kind: ' + JSON.stringify(unsupported));

(async () => {
const snapshots = {}; const fails = {}; let okN = 0;
for (const s of list) {
  const refRaw = s.refs.slice().sort().pop();          // 该系列最新 cutoff/matures 参考
  const todayStr = new Date().toISOString().slice(0, 10);
  const ref = refRaw > todayStr ? todayStr : refRaw;   // 夹到「今天」（matures_at 可能在未来；API 的 end_date 上限=今天/近今）
  const refDate = new Date(ref + 'T00:00:00Z');
  let url = null;
  const fmt = (d) => d.toISOString().slice(0, 10);
  const endD = new Date(refDate.getTime() - 86400000);
  const startD = new Date(endD.getTime() - DAYS_BACK * 86400000);
  const rj = s.rj || {};
  if (s.rule.window === 'seasonal') {
    const y0 = refDate.getUTCFullYear() - 10, y1 = refDate.getUTCFullYear() - 1;
    const mm = String(refDate.getUTCMonth() + 1).padStart(2, '0');
    url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + s.lat + '&longitude=' + s.lon + '&start_date=' + y0 + '-' + mm + '-01&end_date=' + y1 + '-' + mm + '-30&daily=' + s.rule.variable + '&timezone=auto';
  } else if (s.rule.api === 'dbnomics') {
    url = 'https://api.db.nomics.world/v22/series/' + encodeURIComponent(rj.provider) + '/' + encodeURIComponent(rj.dataset) + '/' + encodeURIComponent(rj.series) + '?observations=1';
  } else if (s.rule.api === 'frankfurter') {
    url = 'https://api.frankfurter.app/' + fmt(startD) + '..' + fmt(endD) + '?from=' + encodeURIComponent(rj.base) + '&to=' + encodeURIComponent(rj.quote);
  } else if (s.rule.api === 'wikimedia') {
    url = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/' + (rj.project || 'en.wikipedia') + '/all-access/all-agents/' + encodeURIComponent(rj.article) + '/daily/' + fmt(startD).replace(/-/g, '') + '00/' + fmt(endD).replace(/-/g, '') + '00';
  } else if (s.rule.api === 'npm7') {
    url = 'https://api.npmjs.org/downloads/range/' + fmt(startD) + ':' + fmt(endD) + '/' + encodeURIComponent(rj.package);
  } else if (s.rule.api === 'github') {
    url = 'https://api.github.com/repos/' + rj.repo + '/stats/commit_activity';
  } else if (s.rule.api === 'template') {
    url = buildTemplateUrl(rj.url_template || rj.url, fmt(startD), fmt(endD), rj);
  } else {
    if (s.rule.api === 'air') url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + s.lat + '&longitude=' + s.lon + '&hourly=' + s.rule.variable + '&timezone=GMT&start_date=' + fmt(startD) + '&end_date=' + fmt(endD);
    else url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + s.lat + '&longitude=' + s.lon + '&daily=' + s.rule.variable + '&timezone=auto&start_date=' + fmt(startD) + '&end_date=' + fmt(endD);
  }
  try {
    await sleep(250);                                    // 全局限速：突发连发会被上游丢连接（wikimedia 实测）
    const j = (s.rule.api === 'template' && s.rule.parser === 'csv_gml') ? await jgetText(url) : await jget(url);
    const days = [];
    if (s.rule.api === 'template') {
      const parsed = (TPL_PARSERS[s.rule.parser] || (() => []))(j, rj);
      for (const x of parsed) days.push(x);
    } else if (s.rule.api === 'air') {
      const t = (j.hourly && j.hourly.time) || []; const v = (j.hourly && j.hourly[s.rule.variable]) || [];
      const byDay = {};
      for (let i = 0; i < t.length; i++) { const d = String(t[i]).slice(0, 10); if (v[i] === null || v[i] === undefined) continue; (byDay[d] = byDay[d] || []).push(v[i]); }
      for (const d of Object.keys(byDay).sort()) days.push({ date: d, value: byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length, n_hours: byDay[d].length });
    } else if (s.rule.api === 'dbnomics') {
      const doc = j && j.series && j.series.docs && j.series.docs[0];
      const periods = (doc && doc.period) || []; const values = (doc && doc.value) || [];
      for (let i = 0; i < periods.length; i++) {
        const p = String(periods[i]); if (values[i] === null || values[i] === undefined) continue;
        const date = /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : /^\d{4}-\d{2}$/.test(p) ? p + '-01' : /^\d{4}$/.test(p) ? p + '-01-01' : null;
        if (date) days.push({ date: date, value: values[i], period: p });
      }
    } else if (s.rule.api === 'frankfurter') {
      const rates = j.rates || {};
      for (const d of Object.keys(rates).sort()) { const v = rates[d] && rates[d][rj.quote]; if (v !== null && v !== undefined) days.push({ date: d, value: v }); }
    } else if (s.rule.api === 'wikimedia') {
      const items = j.items || [];
      for (const it of items) { const ts = String(it.timestamp || ''); if (ts.length < 8) continue; const date = ts.slice(0, 4) + '-' + ts.slice(4, 6) + '-' + ts.slice(6, 8); days.push({ date: date, value: it.views }); }
    } else if (s.rule.api === 'npm7') {
      const dl = (j.downloads || []).filter((x) => x && x.downloads !== undefined);
      for (let i = 6; i < dl.length; i++) { let s7 = 0; for (let k = i - 6; k <= i; k++) s7 += Number(dl[k].downloads) || 0; days.push({ date: dl[i].day, value: s7, window_days: 7 }); }
    } else if (s.rule.api === 'github') {
      const weeks = Array.isArray(j) ? j : [];
      for (const w of weeks) { if (!w || w.week === undefined) continue; days.push({ date: new Date(w.week * 1000).toISOString().slice(0, 10), value: w.total }); }
    } else {
      const t = (j.daily && j.daily.time) || []; const v = (j.daily && j.daily[s.rule.variable]) || [];
      for (let i = 0; i < t.length; i++) if (v[i] !== null && v[i] !== undefined) days.push({ date: String(t[i]).slice(0, 10), value: v[i] });
    }
    // 季节性窗：只保留 cutoff 所在月的历史同日（前 10 年同月 ≈300 日；照 baseRateNote 实文）
    if (s.rule.window === 'seasonal') {
      const mm = String(refDate.getUTCMonth() + 1).padStart(2, '0');
      const kept = days.filter((d) => d.date.slice(5, 7) === mm);
      days.length = 0; for (const d of kept) days.push(d);
    }
    snapshots[s.key] = { kind: s.kind, key_fields: (s.key.split('|').slice(1).join('|') || ('lat=' + s.lat + ',lon=' + s.lon)), variable: s.rule.variable || null,
      window: s.rule.window, window_note: s.rule.note, ref_cutoff: ref, days: days, source_url: url, fetched_at: new Date().toISOString(), question_ids: s.ids };
    okN++;
    console.log('  ✓ ' + s.key + ' → ' + days.length + ' 期（' + s.rule.window + '）');
  } catch (e) { fails[s.key] = String(e && e.message || e).slice(0, 120); console.log('  ✗ ' + s.key + ' → ' + fails[s.key]); }
}

const out = { script: 'p1b/scripts/dna-s-source-snapshot.cjs', purpose: 'E1 主口径：源数据侧快照重建（快照与 k1/n1/k2/n2 保复现）',
  rule_source: '12-PREREG-E1-DNA加列S维-v1.md §1（窗口主口径）', unsupported_kinds: unsupported, series_total: Object.keys(series).length,
  series_fetched: okN, series_failed: fails, snapshots: snapshots, generated_at: new Date().toISOString() };
fs.mkdirSync(OUT_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const f = path.join(OUT_DIR, 'dna-s-source-snapshots-' + today + '.json');
if (MERGE && fs.existsSync(f)) {                        // 补拉模式：并入当日既有快照（不清空已成功系列）
  try {
    const prev = JSON.parse(fs.readFileSync(f, 'utf8'));
    const merged = Object.assign({}, prev.snapshots, snapshots);
    out.snapshots = merged;
    out.series_total = Math.max(out.series_total, prev.series_total || 0);
    out.merge_note = '本轮 --merge：新增/覆盖 ' + Object.keys(snapshots).length + ' 系列，合并后共 ' + Object.keys(merged).length;
  } catch (e) { /* 读取失败则退化为整体重写 */ }
}
fs.writeFileSync(f, JSON.stringify(out, null, 1), 'utf8');
console.log('快照 -> ' + f + '（成功 ' + okN + ' / ' + list.length + '；失败 ' + Object.keys(fails).length + '）');
})().catch((e) => { console.error('FATAL ' + ((e && e.stack) || e)); process.exit(1); });
