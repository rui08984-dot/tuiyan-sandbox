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
const DAYS_BACK = Number(arg('days-back', 420));
const TIMEOUT = Number(arg('timeout', 25000));

/** kind → 取数规则（窗口类型 / API / 变量）；未列入者本轮不支持（如实登记） */
function ruleFor(kind, urlTemplate) {
  const m = urlTemplate ? /(?:daily|hourly)=([a-z0-9_]+)/i.exec(urlTemplate) : null;
  const varFromTpl = m ? m[1] : null;
  if (kind === 'openmeteo_daily_max' || kind === 'openmeteo_forecast_daily_max') return { api: 'archive', variable: 'temperature_2m_max', window: 'seasonal', note: '同月历史日（前 10 年）' };
  if (kind === 'openmeteo_wx_daily') return { api: 'archive', variable: varFromTpl || 'temperature_2m_max', window: 'trailing', note: 'cutoff 前最近 N 日' };
  if (/^openmeteo_forecast_daily_/.test(kind)) return { api: 'archive', variable: varFromTpl || kind.replace('openmeteo_forecast_daily_', ''), window: 'trailing', note: 'cutoff 前最近 N 日' };
  if (/^openmeteo_air_/.test(kind)) return { api: 'air', variable: varFromTpl || (/pm2_5/.test(kind) ? 'pm2_5' : /pm10/.test(kind) ? 'pm10' : /ozone/.test(kind) ? 'ozone' : 'pm10'), window: 'trailing', note: 'cutoff 前最近 N 日（小时→日均）' };
  return null;
}

async function jget(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; e1-snapshot/1.0)' } });
      if (!res.ok) { let body = ''; try { body = (await res.text()).slice(0, 200).replace(/\s+/g, ' '); } catch (e) { body = ''; } throw new Error('HTTP ' + res.status + ' ' + body); }
      return await res.json();
    } catch (e) { if (attempt === 1) throw e; await new Promise((r) => setTimeout(r, 800)); }
  }
}

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
  const rule = ruleFor(String(rj.kind), rj.url_template);
  if (!rule) { unsupported[String(rj.kind)] = (unsupported[String(rj.kind)] || 0) + 1; continue; }
  const key = [rj.kind, rj.lat, rj.lon].join('|');
  if (!series[key]) series[key] = { key: key, kind: String(rj.kind), lat: rj.lat, lon: rj.lon, rule: rule, refs: [], ids: [] };
  series[key].ids.push(r.id);
  series[key].refs.push(String(r.ev_cutoff || r.matures_at || r.created_at || '').slice(0, 10));
}
const list = Object.keys(series).map((k) => series[k]).slice(0, MAX_SERIES);
console.log('=== E1 源侧快照重建（主口径）===');
console.log('系列数（kind×lat×lon）: ' + Object.keys(series).length + '，本轮取前 ' + list.length + '；不支持 kind: ' + JSON.stringify(unsupported));

(async () => {
const snapshots = {}; const fails = {}; let okN = 0;
for (const s of list) {
  const refRaw = s.refs.slice().sort().pop();          // 该系列最新 cutoff/matures 参考
  const todayStr = new Date().toISOString().slice(0, 10);
  const ref = refRaw > todayStr ? todayStr : refRaw;   // 夹到「今天」（matures_at 可能在未来；API 的 end_date 上限=今天/近今）
  const refDate = new Date(ref + 'T00:00:00Z');
  let url = null;
  if (s.rule.window === 'seasonal') {
    const y0 = refDate.getUTCFullYear() - 10, y1 = refDate.getUTCFullYear() - 1;
    const mm = String(refDate.getUTCMonth() + 1).padStart(2, '0');
    url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + s.lat + '&longitude=' + s.lon + '&start_date=' + y0 + '-' + mm + '-01&end_date=' + y1 + '-' + mm + '-30&daily=' + s.rule.variable + '&timezone=auto';
  } else {
    const end = new Date(refDate.getTime() - 86400000);
    const start = new Date(end.getTime() - DAYS_BACK * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    if (s.rule.api === 'air') url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + s.lat + '&longitude=' + s.lon + '&hourly=' + s.rule.variable + '&timezone=GMT&start_date=' + fmt(start) + '&end_date=' + fmt(end);
    else url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + s.lat + '&longitude=' + s.lon + '&daily=' + s.rule.variable + '&timezone=auto&start_date=' + fmt(start) + '&end_date=' + fmt(end);
  }
  try {
    const j = await jget(url);
    const days = [];
    if (s.rule.api === 'air') {
      const t = (j.hourly && j.hourly.time) || []; const v = (j.hourly && j.hourly[s.rule.variable]) || [];
      const byDay = {};
      for (let i = 0; i < t.length; i++) { const d = String(t[i]).slice(0, 10); if (v[i] === null || v[i] === undefined) continue; (byDay[d] = byDay[d] || []).push(v[i]); }
      for (const d of Object.keys(byDay).sort()) days.push({ date: d, value: byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length, n_hours: byDay[d].length });
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
    snapshots[s.key] = { kind: s.kind, lat: s.lat, lon: s.lon, variable: s.rule.variable, window: s.rule.window, window_note: s.rule.note,
      ref_cutoff: ref, days: days, source_url: url, fetched_at: new Date().toISOString(), question_ids: s.ids };
    okN++;
    console.log('  ✓ ' + s.key + ' → ' + days.length + ' 日（' + s.rule.window + '）');
  } catch (e) { fails[s.key] = String(e && e.message || e).slice(0, 120); console.log('  ✗ ' + s.key + ' → ' + fails[s.key]); }
}

const out = { script: 'p1b/scripts/dna-s-source-snapshot.cjs', purpose: 'E1 主口径：源数据侧快照重建（快照与 k1/n1/k2/n2 保复现）',
  rule_source: '12-PREREG-E1-DNA加列S维-v1.md §1（窗口主口径）', unsupported_kinds: unsupported, series_total: Object.keys(series).length,
  series_fetched: okN, series_failed: fails, snapshots: snapshots, generated_at: new Date().toISOString() };
fs.mkdirSync(OUT_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const f = path.join(OUT_DIR, 'dna-s-source-snapshots-' + today + '.json');
fs.writeFileSync(f, JSON.stringify(out, null, 1), 'utf8');
console.log('快照 -> ' + f + '（成功 ' + okN + ' / ' + list.length + '；失败 ' + Object.keys(fails).length + '）');
})().catch((e) => { console.error('FATAL ' + ((e && e.stack) || e)); process.exit(1); });
