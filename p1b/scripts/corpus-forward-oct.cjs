'use strict';
// corpus-forward-oct：2026-10 单月 realtime 补量（目标 >=35 条）
// 背景：G2 指标3「月 resolve>=30 连续 2 月」按 resolved_at 月份计。实测（2026-09-13 探库）：
//   库内已 resolve 602 条全落 2026-09；2026-10 仅 43 条 pending，其中 engine=stat_baseline_forward
//   实际写的是 none_forward（40 条）+ bis 3 条；而 corpus-resolve.cjs 的 RESOLVERS 只认
//   openmeteo_daily_max / dbnomics_series_value / cwl_* / dlt_draw_result / openmeteo_forecast_daily_max
//   —— b3 铺的 pm10/binance/wiki/gh/npm/fx kind 无 resolver，天然不会 resolve。
// 本棒：日频源铺 2026-10 题 —— AQ PM10 / Binance 日线 / npm 7日窗 / Wikimedia 日浏览 / GitHub 周提交
//   + 彩票期号续推（唯一已被现役 resolver 支持的日频真值锚）。
// 红线：Q0-2 cutoff 早于事件；Q0-3 基率落 (0.15,0.85) 否则不产题；prob=历史基率现算；statement 前缀【forward】；
//   每题带 resolve 参数（kind/url/field）供 corpus-resolve 机械回填；不产历史回填题（不计入 G2 realtime）。
// 幂等：slug 唯一键 + 库内 (game_id, slug) 查重；阈值由 seed(源|标的|目标日) 稳定哈希挑选 → 重跑恒定。
// 用法：node scripts/corpus-forward-oct.cjs [--confirm] [--only=aq|crypto|npm|wiki|gh|lotto]
const { db } = require('../src/deps');
const { insertPrediction, l0Gate, ensurePredictionsTable, deriveMaturesAt } = require('../src/db/predictionsStore');
const path = require('path');
const fs = require('fs');

const CONFIRM = process.argv.includes('--confirm');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
const LO = 0.15, HI = 0.85, TMO = 30000;
const UA = 'corpus-oct/1.0 (research; +node)';
const now08 = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00';
const RUN_AT = now08();
const TODAY = RUN_AT.slice(0, 10);
const cache = new Map();
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
async function jget(url, h, tries) {
  const k = url + '|' + JSON.stringify(h || {});
  if (cache.has(k)) return cache.get(k);
  const n = tries || 3; let last = null;
  for (let a = 0; a < n; a++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TMO);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json, */*' }, h || {}) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('NON-JSON len=' + txt.length); }
      cache.set(k, j); return j;
    } catch (e) { last = e; if (a < n - 1) await sleep(1200 * (a + 1)); }
    finally { clearTimeout(t); }
  }
  throw last;
}
const inBand = (x) => x > LO && x < HI;
const pct = (x) => (x * 100).toFixed(1) + '%';
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, n) => isoOf(Date.parse(iso + 'T00:00:00Z') + n * 86400000);
const dayBefore = (iso) => addDays(iso, -1);
const bkCut = (iso) => dayBefore(iso) + 'T23:59:59+08:00';
function quantile(a, p) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function seedOf(s) { let h = 7; const t = String(s); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return Math.abs(h); }
// 阈值挑选：候选分位 -> 基率必须落 (0.15,0.85)；ROT 轮换索引由 seed(源|标的|目标日) 稳定哈希决定（重跑恒定）
function pickTh(hist, cands, ge, seed) {
  const ok = [];
  for (const q of cands) {
    const th = quantile(hist, q);
    if (th === null) continue;
    const hit = hist.filter((x) => (ge ? x >= th : x <= th)).length / hist.length;
    if (!inBand(hit)) continue;
    ok.push({ th: th, hit: hit, q: q, d: Math.abs(hit - 0.5) });
  }
  if (!ok.length) return null;
  ok.sort((a, b) => a.d - b.d);
  const c = ok[seedOf(seed) % ok.length];
  return { th: c.th, hit: c.hit, q: c.q, nth: ok.length };
}
const QT = [0.5, 0.6, 0.4, 0.7, 0.3];

// ── 2026-10 目标日集合（日频源：只取 10 月内、且严格晚于今日）──
const OCT = '2026-10';
const OCT_DAYS = (function () { const a = []; for (let d = 1; d <= 31; d++) { const iso = OCT + '-' + String(d).padStart(2, '0'); if (iso > TODAY && iso <= OCT + '-30') a.push(iso); } return a; })();
// 均匀取 n 个目标日（首/中/尾都覆盖，保证 resolve 日期在 10 月内分散）
function spread(days, n) { if (days.length <= n) return days.slice(); const out = []; for (let i = 0; i < n; i++) out.push(days[Math.floor(i * (days.length - 1) / (n - 1))]); return Array.from(new Set(out)); }

// ── 源一：Open-Meteo 空气质量 PM10（日频；真值锚同 b3 kind=openmeteo_air_pm10_daily_mean）──
// 实测（2026-09-13）：air-quality 对未来日期返回 HTTP 400 "start_date is out of allowed range ... to 2026-09-18"
//   → 这是「日期超出该 API 允许窗口」的预期 pending 信号；10 月时窗口自然推进到 10 月，届时即可 resolve。
const AQ_CITIES = [
  { name: '上海', lat: 31.23, lon: 121.47 }, { name: '柏林', lat: 52.52, lon: 13.41 },
  { name: '纽约', lat: 40.71, lon: -74.01 }, { name: '新德里', lat: 28.61, lon: 77.21 },
  { name: '圣保罗', lat: -23.55, lon: -46.63 },
];
const AQ_URL = (c, a, b) => 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + c.lat + '&longitude=' + c.lon
  + '&hourly=pm10&timezone=GMT&start_date=' + a + '&end_date=' + b;
async function aqDailyMeans(c) {
  const j = await jget(AQ_URL(c, addDays(TODAY, -365), dayBefore(TODAY)));
  const hs = (j.hourly && j.hourly.time) || [], vs = (j.hourly && j.hourly.pm10) || [];
  const acc = {};
  hs.forEach((t, i) => { const d = t.slice(0, 10), v = vs[i]; if (v === null || v === undefined || !isFinite(v)) return; (acc[d] = acc[d] || []).push(v); });
  return Object.keys(acc).sort().map((d) => ({ d: d, m: acc[d].reduce((x, y) => x + y, 0) / acc[d].length, n: acc[d].length }));
}
async function buildAQ() {
  const out = [];
  for (const c of AQ_CITIES) {
    let series = [];
    try { series = await aqDailyMeans(c); } catch (e) { console.log('[WARN] aq ' + c.name + ' ' + String(e.message).slice(0, 70)); continue; }
    if (series.length < 200) continue;
    const base = series.map((x) => x.m);
    for (const date of spread(OCT_DAYS, 3)) {
      const b = pickTh(base, QT, false, 'aq|' + c.name + '|' + date);
      if (!b) continue;
      const cut = RUN_AT;   // cutoff=落库时点（与现役 b3 forward 口径一致）；仍严格早于 10 月事件日
      out.push({
        gameType: 'corpus:airqual', layer: 'L3', engine: 'openmeteo_air_pm10_baserate_forward', phase: 'forward',
        prob: Number(b.hit.toFixed(4)),
        slug: 'corpus:airqual-oct-' + c.lat + '-' + date,
        statement: '【forward】' + c.name + ' ' + date + ' 日 PM10 日均浓度 <= ' + b.th.toFixed(1) + ' μg/m³'
          + '（cutoff=' + cut + '，严格早于事件日；真值锚=Open-Meteo air-quality hourly.pm10 该日全小时均值。10 月 realtime 补量批，真值未发生）',
        baseRateNote: '前瞻·' + c.name + '：cutoff 前 ' + base.length + ' 个 PM10 日均（' + series[0].d + '~' + series.slice(-1)[0].d + '）中 <= ' + b.th.toFixed(1) + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff 现算）',
        resolve: { kind: 'openmeteo_air_pm10_daily_mean', url_template: AQ_URL(c, '{date}', '{date}'), lat: c.lat, lon: c.lon, date: date, threshold: Number(b.th.toFixed(1)), cmp: '<=', field: 'hourly.time[] 前缀==date 的全部 hourly.pm10[] 算术均值' },
        meta: { city: c.name, date: date, threshold: Number(b.th.toFixed(1)), cutoff: cut, phase: 'forward', month: OCT },
      });
    }
  }
  return out;
}

// ── 源二：Binance 日线（日频；真值锚 kind=binance_daily_close，daemon 内置 resolver）──
// 实测（2026-09-13）：对未来 10 月日期返回 HTTP 200 + 空数组 [] → 明确 pending（非报错）。
const CR_PAIRS = [{ sym: 'BTCUSDT', label: 'BTC/USDT' }, { sym: 'ETHUSDT', label: 'ETH/USDT' }, { sym: 'SOLUSDT', label: 'SOL/USDT' }];
const CR_TMPL = 'https://data-api.binance.vision/api/v3/klines?symbol={symbol}&interval=1d&limit=1000&startTime={start_ms}&endTime={end_ms}';
const crKl = (sym, ms0, ms1) => 'https://data-api.binance.vision/api/v3/klines?symbol=' + sym + '&interval=1d&limit=1000&startTime=' + ms0 + '&endTime=' + ms1;
// 窗口末端固定为「今日 00:00 UTC」：避免未收盘日线使序列漂移 → 阈值漂移 → 重跑非幂等（b3 实测教训）
async function crDaily(sym) {
  const utcToday = new Date().toISOString().slice(0, 10);
  const arr = await jget(crKl(sym, Date.parse(addDays(utcToday, -900) + 'T00:00:00Z'), Date.parse(utcToday + 'T00:00:00Z') - 1));
  return arr.map((k) => ({ d: isoOf(k[0]), c: Number(k[4]) })).filter((x) => isFinite(x.c) && x.c > 0);
}
const crResolve = (sym, date, th) => ({
  kind: 'binance_daily_close', url_template: CR_TMPL, symbol: sym,
  start_ms: Date.parse(date + 'T00:00:00Z'), end_ms: Date.parse(date + 'T00:00:00Z') + 86399999,
  date: date, threshold: Number(th.toFixed(2)), cmp: '>=', field: '返回数组[0][4] = close',
});
async function buildCrypto() {
  const out = [];
  for (const p of CR_PAIRS) {
    let series = [];
    try { series = await crDaily(p.sym); } catch (e) { console.log('[WARN] crypto ' + p.sym + ' ' + String(e.message).slice(0, 70)); continue; }
    if (series.length < 250) continue;
    const closes = series.map((x) => x.c);
    for (const date of spread(OCT_DAYS, 3)) {
      const b = pickTh(closes, QT, true, 'cr|' + p.sym + '|' + date);
      if (!b) continue;
      out.push({
        gameType: 'corpus:crypto', layer: 'L2', engine: 'binance_daily_close_baserate_forward', phase: 'forward',
        prob: Number(b.hit.toFixed(4)),
        slug: 'corpus:crypto-oct-' + p.sym + '-' + date,
        statement: '【forward】' + p.label + ' ' + date + '（UTC 日）收盘价 >= ' + b.th.toFixed(2) + ' USDT'
          + '（cutoff=落库时点 ' + RUN_AT + '，严格早于该 UTC 日（10 月）；真值锚=Binance klines [4]=close。10 月 realtime 补量批，真值未发生）',
        baseRateNote: '前瞻·' + p.label + '：cutoff 前 ' + closes.length + ' 个日线收盘（' + series[0].d + '~' + series.slice(-1)[0].d + '）中 >= ' + b.th.toFixed(2) + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff 现算）',
        resolve: crResolve(p.sym, date, b.th),
        meta: { symbol: p.sym, date: date, threshold: Number(b.th.toFixed(2)), cutoff: RUN_AT, phase: 'forward', month: OCT },
      });
    }
  }
  return out;
}

// ── 源三：npm 7 日下载窗（日频滚动；真值锚 kind=npm_downloads_window，daemon 内置 resolver）──
// 实测（2026-09-13）：对未来窗口返回 HTTP 400 "end date > start date" → pending 信号。
// 窗口设计：end 落在 10 月内且 end+1 已过（daemon due = end+1d）→ resolve 日期落 10 月。
const NPM_PKGS = [{ pkg: 'react', label: 'react' }, { pkg: 'typescript', label: 'typescript' }, { pkg: 'vite', label: 'vite' }];
async function npmDaily(pkg, a, b) {
  const j = await jget('https://api.npmjs.org/downloads/range/' + a + ':' + b + '/' + pkg);
  return (j.downloads || []).map((x) => ({ d: x.day, v: x.downloads }));
}
async function buildNpm() {
  const out = [];
  // 7 日窗末端最早 = 今日+8（保证窗口整段在未来），最晚 = 10 月末；取 3 个分散末端
  const ends = spread(OCT_DAYS.filter((d) => d >= addDays(TODAY, 8)), 3);
  for (const p of NPM_PKGS) {
    let s = [];
    try { s = await npmDaily(p.pkg, addDays(TODAY, -200), dayBefore(TODAY)); } catch (e) { console.log('[WARN] npm ' + p.pkg + ' ' + String(e.message).slice(0, 70)); continue; }
    if (s.length < 150) continue;
    const roll = [];
    for (let i = 6; i < s.length; i++) { let t = 0; for (let k = 0; k < 7; k++) t += s[i - k].v; roll.push({ d: s[i].d, v: t }); }
    if (roll.length < 140) continue;
    const rv = roll.map((x) => x.v);
    for (const end of ends) {
      const start = addDays(end, -6);
      const b = pickTh(rv, QT, true, 'npm|' + p.pkg + '|' + end);
      if (!b) continue;
      out.push({
        gameType: 'corpus:npmdl', layer: 'L2', engine: 'npm_downloads_baserate_forward', phase: 'forward',
        prob: Number(b.hit.toFixed(4)),
        slug: 'corpus:npmdl-oct-' + p.pkg + '-' + end,
        statement: '【forward】npm 包 ' + p.label + ' 在 ' + start + '~' + end + ' 的 7 日下载量 >= ' + b.th
          + '（cutoff=落库时点 ' + RUN_AT + '，严格早于该窗口（10 月）；真值锚=npm downloads/range downloads[].downloads 求和。10 月 realtime 补量批，真值未发生）',
        baseRateNote: '前瞻·' + p.label + '：cutoff 前 ' + roll.length + ' 个 7 日滚动窗（' + roll[0].d + '~' + roll.slice(-1)[0].d + '）中 >= ' + b.th + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff 现算）',
        resolve: { kind: 'npm_downloads_window', url_template: 'https://api.npmjs.org/downloads/range/{start}:{end}/' + p.pkg, package: p.pkg, start: start, end: end, threshold: b.th, cmp: '>=', field: 'body.downloads[].downloads 求和（按 .day 落在 [start,end]）' },
        meta: { package: p.pkg, start: start, end: end, threshold: b.th, cutoff: RUN_AT, phase: 'forward', month: OCT },
      });
    }
  }
  return out;
}

// ── 源四：Wikimedia 日浏览量（日频；真值锚 kind=wikimedia_pageviews，daemon 内置 resolver）──
// 实测（2026-09-13）：未来日期 404 "Not Found" → pending 信号（daemon due=date>=today 亦判 pending）。
const WIKI_ART = ['Bitcoin', 'Artificial_intelligence', 'ChatGPT', 'Taylor_Swift', 'Ethereum'];
const ymd = (iso) => iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10);
const WIKI_URL = (art, a, b) => 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/'
  + art + '/daily/' + ymd(a) + '00/' + ymd(b) + '00';
async function wikiDaily(art, from, to) {
  const j = await jget(WIKI_URL(art, from, to));
  const m = {};
  (j.items || []).forEach((it) => { m[it.timestamp.slice(0, 8)] = it.views; });
  return m;
}
async function buildWiki() {
  const out = [];
  for (const art of WIKI_ART) {
    let d = {};
    try { d = await wikiDaily(art, addDays(TODAY, -400), dayBefore(TODAY)); } catch (e) { console.log('[WARN] wiki ' + art + ' ' + String(e.message).slice(0, 70)); continue; }
    const keys = Object.keys(d).sort();
    const vals = keys.map((k) => d[k]);
    if (vals.length < 200) continue;
    for (const date of spread(OCT_DAYS, 2)) {
      const b = pickTh(vals, QT, true, 'wiki|' + art + '|' + date);
      if (!b) continue;
      out.push({
        gameType: 'corpus:wikipv', layer: 'L2', engine: 'wikimedia_pageviews_baserate_forward', phase: 'forward',
        prob: Number(b.hit.toFixed(4)),
        slug: 'corpus:wikipv-oct-' + art + '-' + date,
        statement: '【forward】en.wikipedia 「' + art + '」 ' + date + ' 页面浏览量 >= ' + b.th + ' 次'
          + '（cutoff=落库时点 ' + RUN_AT + '，严格早于该日（10 月）；真值锚=Wikimedia pageviews API items[].views。10 月 realtime 补量批，真值未发生）',
        baseRateNote: '前瞻·' + art + '：cutoff 前 ' + vals.length + ' 个日浏览量（' + keys[0].slice(0, 4) + '-' + keys[0].slice(4, 6) + '-' + keys[0].slice(6, 8) + '~' + dayBefore(TODAY) + '）中 >= ' + b.th + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff 现算）',
        resolve: { kind: 'wikimedia_pageviews', url_template: WIKI_URL(art, '{date}', '{date}'), article: art, date: date, threshold: b.th, cmp: '>=', field: "items[] 中 timestamp=='YYYYMMDD00' 者 .views" },
        meta: { article: art, date: date, threshold: b.th, cutoff: RUN_AT, phase: 'forward', month: OCT },
      });
    }
  }
  return out;
}

// ── 源五：GitHub 周提交（周频；真值锚 kind=github_weekly_commits，daemon 内置 resolver）──
// 实测（2026-09-13）：stats/commit_activity 52 周，末周起点 2026-09-06。10 月各周（周日 UTC 起）可精确推。
const GH_REPOS = [{ full: 'nodejs/node', label: 'nodejs/node' }, { full: 'microsoft/vscode', label: 'microsoft/vscode' }, { full: 'facebook/react', label: 'facebook/react' }];
async function ghWeeks(full) {
  const j = await jget('https://api.github.com/repos/' + full + '/stats/commit_activity', { Accept: 'application/vnd.github+json' });
  if (!Array.isArray(j)) return [];
  return j.filter((w) => w && w.week).map((w) => ({ w: w.week, iso: isoOf(w.week * 1000), total: w.total }));
}
async function buildGh() {
  const out = [];
  // 10 月内的周起点：周日 UTC，且 week_end(=start+6) 亦在 10 月内 → resolve 落 10 月
  const octWeeks = [];
  for (const d of OCT_DAYS) { if (new Date(d + 'T00:00:00Z').getUTCDay() === 0 && addDays(d, 6) <= OCT + '-30') octWeeks.push(d); }
  for (const r of GH_REPOS) {
    let ws = [];
    try { ws = await ghWeeks(r.full); } catch (e) { console.log('[WARN] gh ' + r.full + ' ' + String(e.message).slice(0, 70)); continue; }
    if (ws.length < 40) continue;
    const totals = ws.map((x) => x.total);
    for (const start of octWeeks.slice(0, 2)) {
      const end = addDays(start, 6);
      const b = pickTh(totals, QT, true, 'gh|' + r.full + '|' + start);
      if (!b) continue;
      out.push({
        gameType: 'corpus:ghcommit', layer: 'L2', engine: 'github_weekly_commits_baserate_forward', phase: 'forward',
        prob: Number(b.hit.toFixed(4)),
        slug: 'corpus:ghcommit-oct-' + r.full.replace('/', '-') + '-' + start,
        statement: '【forward】GitHub ' + r.label + ' 默认分支 ' + start + '~' + end + ' 一周提交数 >= ' + b.th
          + '（cutoff=落库时点 ' + RUN_AT + '，严格早于该周起点（10 月）；真值锚=GitHub stats/commit_activity [].total。10 月 realtime 补量批，真值未发生）',
        baseRateNote: '前瞻·' + r.label + '：cutoff 前 ' + totals.length + ' 个完整周提交数中 >= ' + b.th + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff 现算）',
        resolve: { kind: 'github_weekly_commits', url: 'https://api.github.com/repos/' + r.full + '/stats/commit_activity', repo: r.full, week_start: start, week_end: end, threshold: b.th, cmp: '>=', field: 'weeks[] 中 ISO 日期 == week_start 那项的 .total' },
        meta: { repo: r.full, week_start: start, week_end: end, threshold: b.th, cutoff: RUN_AT, phase: 'forward', month: OCT },
      });
    }
  }
  return out;
}

// ── 源六：彩票（每日/每周多期开奖；期号=年内开奖序号，可精确外推）──
// 为什么彩票是 10 月补量的主力：现役 corpus-resolve.cjs 与 daemon 都已注册 cwl_ssq_red_contains /
//   cwl_ssq_blue_odd / dlt_draw_result 三个 kind（b3 那批新源 kind 只在 daemon 内置），
//   且期号外推无需赛程假设（实证：2025 国庆 2025113=09-30 → 2025114=10-05 断档跳号）。
const SSQ_DOW = [0, 2, 4];  // 日/二/四
const DLT_DOW = [1, 3, 6];  // 一/三/六
const HOLIDAY_GAP = [['2026-10-01', '2026-10-04'], ['2027-02-06', '2027-02-15']];
function expectedDrawDates(fromIso, dows, n) {
  const ans = []; let d = fromIso; let guard = 0;
  const inGap = (iso) => HOLIDAY_GAP.some((g) => iso >= g[0] && iso <= g[1]);
  while (ans.length < n && guard++ < 500) {
    d = addDays(d, 1);
    if (dows.indexOf(new Date(d + 'T00:00:00Z').getUTCDay()) === -1) continue;
    if (inGap(d)) continue;
    ans.push(d);
  }
  return ans;
}
function C(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); }
const SSQ_COMBOS = [
  { key: 'red07', label: '红球含 07', prob: C(32, 5) / C(33, 6), resolve: { kind: 'cwl_ssq_red_contains', ball: '07' }, note: 'C(32,5)/C(33,6)' },
  { key: 'blueodd', label: '蓝球为奇数', prob: 8 / 16, resolve: { kind: 'cwl_ssq_blue_odd' }, note: '8/16' },
];
const DLT_COMBOS = (function () {
  const total = C(35, 5) * C(12, 2);
  return [
    { key: 'back01', label: '后区含 01', prob: C(11, 1) * C(35, 5) / total, resolve: { kind: 'dlt_draw_result', back_ball: '01' }, note: 'C(11,1)*C(35,5)/[C(35,5)*C(12,2)]=11/66' },
    { key: 'fmax30', label: '前区最大号 >= 30', prob: 1 - C(29, 5) / C(35, 5), resolve: { kind: 'dlt_draw_result', front_max_ge: 30 }, note: '1-C(29,5)/C(35,5)=' + (1 - C(29, 5) / C(35, 5)).toFixed(4) },
  ];
})();
const N_OCT_DRAWS = 8;
async function buildLotto() {
  const out = [];
  // 双色球（福彩）
  let ssqLast = null;
  try {
    const j = await jget('https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30',
      { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/' });
    ssqLast = (j.result || [])[0] || null;
  } catch (e) { console.log('[WARN] ssq last ' + String(e.message).slice(0, 70)); }
  if (ssqLast) {
    const base = Number(ssqLast.code);
    const dates = expectedDrawDates(String(ssqLast.date).slice(0, 10), SSQ_DOW, 60);
    const octIdx = [];
    dates.forEach((d, i) => { if (d >= OCT + '-01' && d <= OCT + '-30') octIdx.push(i); });
    const keep = [];
    for (const i of octIdx) { if (keep.length >= N_OCT_DRAWS) break;
      if (EXIST.has(canonKey({ kind: 'cwl_ssq_red_contains', issue: String(base + i + 1) }))) continue;
      keep.push(i); }
    for (const cb of SSQ_COMBOS) {
      if (!inBand(cb.prob)) { console.log('[WARN] ssq ' + cb.key + ' 基率越界'); continue; }
      for (const i of keep) {
        const issue = String(base + i + 1), expect = dates[i];
        out.push({
          gameType: 'corpus:cwl', layer: 'L5', engine: 'none_forward', phase: 'forward',
          prob: Number(cb.prob.toFixed(6)),
          slug: 'corpus:cwl-oct-ssq-' + issue + '-' + cb.key,
          statement: '【forward】双色球第 ' + issue + ' 期' + cb.label
            + '（cutoff=落库时点 ' + RUN_AT + '，该期尚未开奖；期号=上期 ' + ssqLast.code + '+' + (i + 1)
            + ' 年内序递推；预期开奖日 ' + expect + '（周日/二/四口径，仅供标月）；真值锚=cwl 官方公告 red/blue 串。10 月 realtime 补量批）',
          baseRateNote: '前瞻·L5 认证随机：基率=' + cb.prob.toFixed(6) + '（' + cb.note + '，组合数精确值非历史拟合）',
          resolve: Object.assign({ issue: issue }, cb.resolve),
          meta: { lottery: 'ssq', issue: issue, combo: cb.key, expectDate: expect, month: OCT, cutoff: RUN_AT, phase: 'forward' },
        });
      }
    }
  }
  // 大乐透（体彩）
  let dltLast = null;
  try {
    const j = await jget('https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=60&isVerify=1&pageNo=1',
      { 'User-Agent': 'Mozilla/5.0', Referer: 'https://static.sporttery.cn/' });
    dltLast = (((j.value || {}).list) || [])[0] || null;
  } catch (e) { console.log('[WARN] dlt last ' + String(e.message).slice(0, 70)); }
  if (dltLast) {
    const base = Number(dltLast.lotteryDrawNum);
    const dates = expectedDrawDates(String(dltLast.lotteryDrawTime).slice(0, 10), DLT_DOW, 60);
    const octIdx = [];
    dates.forEach((d, i) => { if (d >= OCT + '-01' && d <= OCT + '-30') octIdx.push(i); });
    const keep = [];
    for (const i of octIdx) { if (keep.length >= N_OCT_DRAWS) break;
      if (EXIST.has(canonKey({ kind: 'dlt_draw_result', issue: String(base + i + 1), back_ball: '01' }))) continue;
      keep.push(i); }
    for (const cb of DLT_COMBOS) {
      if (!inBand(cb.prob)) { console.log('[WARN] dlt ' + cb.key + ' 基率越界'); continue; }
      for (const i of keep) {
        const issue = String(base + i + 1), expect = dates[i];
        out.push({
          gameType: 'corpus:dlt', layer: 'L5', engine: 'none_forward', phase: 'forward',
          prob: Number(cb.prob.toFixed(6)),
          slug: 'corpus:dlt-oct-' + issue + '-' + cb.key,
          statement: '【forward】大乐透第 ' + issue + ' 期' + cb.label
            + '（cutoff=落库时点 ' + RUN_AT + '，该期尚未开奖；期号=上期 ' + dltLast.lotteryDrawNum + '+' + (i + 1)
            + ' 年内序递推；预期开奖日 ' + expect + '（周一/三/六口径，仅供标月）；真值锚=体彩官方 lotteryDrawResult。10 月 realtime 补量批）',
          baseRateNote: '前瞻·L5 认证随机：基率=' + cb.prob.toFixed(6) + '（' + cb.note + '，组合数精确值非历史拟合）',
          resolve: Object.assign({ issue: issue }, cb.resolve),
          meta: { lottery: 'dlt', issue: issue, combo: cb.key, expectDate: expect, month: OCT, cutoff: RUN_AT, phase: 'forward' },
        });
      }
    }
  }
  return out;
}

// ── 主流程：dry-run 默认，--confirm 写库；幂等 = 同局 + 归一化 statement（抹掉 cutoff 时点）──
const SRC = {
  aq: ['corpus:airqual', 'Open-Meteo PM10 日频', buildAQ],
  crypto: ['corpus:crypto', 'Binance 日线', buildCrypto],
  npm: ['corpus:npmdl', 'npm 7日下载窗', buildNpm],
  wiki: ['corpus:wikipv', 'Wikimedia 日浏览', buildWiki],
  gh: ['corpus:ghcommit', 'GitHub 周提交', buildGh],
  lotto: ['corpus:cwl', '彩票（双色球+大乐透）', buildLotto],
};
// ── 幂等键：语义 canonical key（比 statement 归一化更稳，可跨批去重）──
// 从 evidence[0].resolve 反解「源|标的|目标期」三元组；已存在则本批不产（重跑/跨批均不重复入库）。
const EXIST = new Set();
function canonKey(r) {
  if (!r) return null;
  const k = r.kind;
  if (k === 'cwl_ssq_red_contains') return 'cwl|ssq|' + r.issue + '|red07';
  if (k === 'cwl_ssq_blue_odd') return 'cwl|ssq|' + r.issue + '|blueodd';
  if (k === 'dlt_draw_result') return 'dlt|' + r.issue + '|' + (r.back_ball ? 'back' + r.back_ball : 'fmax' + r.front_max_ge);
  if (k === 'openmeteo_air_pm10_daily_mean') return 'aq|' + r.lat + '|' + r.lon + '|' + r.date;
  if (k === 'binance_daily_close') return 'crypto|' + r.symbol + '|' + r.date;
  if (k === 'npm_downloads_window') return 'npm|' + r.package + '|' + r.end;
  if (k === 'wikimedia_pageviews') return 'wiki|' + r.article + '|' + r.date;
  if (k === 'github_weekly_commits') return 'gh|' + r.repo + '|' + r.week_start;
  return null;
}
function loadExist(conn) {
  let n = 0;
  conn.prepare("SELECT p.evidence_json FROM predictions p JOIN games g ON g.id = p.game_id WHERE g.game_type LIKE 'corpus%'").all()
    .forEach((x) => { let ev = []; try { ev = JSON.parse(x.evidence_json || '[]'); } catch (e) { ev = []; }
      const ck = canonKey(ev[0] && ev[0].resolve); if (ck) { EXIST.add(ck); n++; } });
  return n;
}

// resolve 日期（用于分布统计）：日频源取 meta.date / week_start / expectDate
function resolveDate(r) {
  const m = r.meta || {};
  if (m.expectDate) return m.expectDate;
  if (m.date) return m.date;
  if (m.week_start) return m.week_start;
  if (m.end) return addDays(m.end, 1);
  return null;
}
const report0 = { run_at: RUN_AT, today: TODAY, target_month: OCT, confirm: CONFIRM, sources: {} };
async function main() {
  const keys = ONLY ? [ONLY] : Object.keys(SRC);
  db.init();
  const preConn = db.getConnection();
  try { ensurePredictionsTable(preConn); } catch (e) {}
  report0.existing_canon_keys = loadExist(preConn);
  const all = [];
  const report = report0;
  for (const k of keys) {
    const [gt, label, fn] = SRC[k];
    if (!fn) { report.sources[k] = { error: 'unknown source' }; continue; }
    let rows = [];
    try { rows = await fn(); } catch (e) { rows = []; report.sources[k] = { error: String(e.message).slice(0, 200) }; console.log('[WARN] ' + k + ' ' + e.message); }
    const probs = rows.map((r) => r.prob);
    const days = rows.map(resolveDate).filter(Boolean).sort();
    report.sources[k] = {
      label: label, game_type: gt, total: rows.length,
      prob_min: probs.length ? Number(Math.min.apply(null, probs).toFixed(4)) : null,
      prob_max: probs.length ? Number(Math.max.apply(null, probs).toFixed(4)) : null,
      band_ok: probs.every((p) => inBand(p)),
      resolve_date_first: days[0] || null, resolve_date_last: days[days.length - 1] || null,
      sample: rows.slice(0, 1).map((r) => r.statement),
    };
    all.push.apply(all, rows);
    console.log('[' + k + '] total=' + rows.length + (probs.length ? ' prob=' + report.sources[k].prob_min + '~' + report.sources[k].prob_max : ''));
  }
  // 唯一 slug 去重（同批内）
  const seen = new Set(); const uniq = [];
  let intraDup = 0;
  for (const r of all) { if (seen.has(r.slug)) { intraDup++; continue; } seen.add(r.slug); uniq.push(r); }
  report.total = uniq.length; report.intra_dupes = intraDup;
  report.prob_min = uniq.length ? Number(Math.min.apply(null, uniq.map((r) => r.prob)).toFixed(4)) : null;
  report.prob_max = uniq.length ? Number(Math.max.apply(null, uniq.map((r) => r.prob)).toFixed(4)) : null;
  report.band_violations = uniq.filter((r) => !inBand(r.prob)).map((r) => r.statement);
  report.by_game_type = {};
  for (const r of uniq) report.by_game_type[r.gameType] = (report.by_game_type[r.gameType] || 0) + 1;
  // resolve 日期分布：按日 + 按周（ISO 周一为周起点）
  const byDay = {}, byWeek = {};
  for (const r of uniq) { const d = resolveDate(r); if (!d) continue; byDay[d] = (byDay[d] || 0) + 1;
    const wd = new Date(d + 'T00:00:00Z'); const mon = addDays(d, -((wd.getUTCDay() + 6) % 7));
    byWeek[mon] = (byWeek[mon] || 0) + 1; }
  report.resolve_by_day = Object.keys(byDay).sort().map((d) => ({ date: d, n: byDay[d] }));
  report.resolve_by_week = Object.keys(byWeek).sort().map((w) => ({ week_start: w, n: byWeek[w] }));
  report.resolve_month_check = Object.keys(byDay).every((d) => d.slice(0, 7) === OCT);
  report.samples = uniq.slice(0, 2).map((r) => ({ statement: r.statement, prob: r.prob, resolve: r.resolve, baseRateNote: r.baseRateNote }));
  console.log('TOTAL=' + report.total + ' bandViolations=' + report.band_violations.length + ' allInOct=' + report.resolve_month_check);
  if (CONFIRM) {
    db.init();
    const conn = db.getConnection();
    ensurePredictionsTable(conn);
    // 局映射：按本批实际产出的 gameType 建（彩票源产出 corpus:cwl 与 corpus:dlt 两类）
    const gid = {};
    const gts = Array.from(new Set(uniq.map((r) => r.gameType)));
    for (const gt of gts) {
      const row = conn.prepare('SELECT id FROM games WHERE game_type = ? ORDER BY id LIMIT 1').get(gt);
      if (row) { gid[gt] = row.id; continue; }
      const g = db.createGame('corpus-oct-' + gt.replace(/[^a-z0-9]/gi, '-'), gt, 1);
      gid[gt] = g.id;
    }
    report.games_used = gid;
    const norm = (s) => String(s).replace(/cutoff=[^）]*/g, 'cutoff=X');
    const existing = new Set(EXIST);
    conn.prepare('SELECT p.statement, p.evidence_json FROM predictions p JOIN games g ON g.id = p.game_id WHERE g.game_type LIKE ?').all('corpus%')
      .forEach((x) => { let ev = []; try { ev = JSON.parse(x.evidence_json || '[]'); } catch (e) { ev = []; }
        const ck = canonKey(ev[0] && ev[0].resolve); if (ck) existing.add(ck);
        existing.add('S||' + norm(x.statement)); });
    let ins = 0, skip = 0, dupe = 0;
    for (const r of uniq) {
      if (!inBand(r.prob)) { skip++; continue; }
      const g = gid[r.gameType];
      if (!g) { skip++; continue; }
      const ck = canonKey(r.resolve);
      if ((ck && existing.has(ck)) || existing.has('S||' + norm(r.statement))) { dupe++; continue; }
      try {
        insertPrediction({
          gameId: g, day: null, sourceType: '预测卡', statement: r.statement, prob: r.prob, g2Regime: 'R4', maturesAt: deriveMaturesAt(r.resolve, [{ meta: r.meta }]),
          evidence: [{ resolve: r.resolve, baseRateNote: r.baseRateNote, meta: r.meta, slug: r.slug, phase: 'forward', kind: 'oct_forward' }],
          layer: r.layer, engine: r.engine, gate: 'descriptive', checklistHash: 'v2', publicExposure: 0,
        });
        if (ck) existing.add(ck);
        existing.add('S||' + norm(r.statement));
        ins++;
      } catch (e) { skip++; console.log('[skip] ' + String(e.message).slice(0, 120)); }
    }
    report.inserted = ins; report.skipped = skip; report.duplicate_skipped = dupe; report.l0Gate_after = l0Gate();
    console.log('inserted=' + ins + ' skipped=' + skip + ' duplicate_skipped=' + dupe);
  }
  // ── 本棒全批权威统计：从库反查 evidence.kind='oct_forward'（不受本轮 dedup 影响）──
  try {
    const c2 = db.getConnection();
    const brow = c2.prepare("SELECT p.id, p.statement, p.assigned_prob, p.layer, p.engine, p.evidence_json, g.game_type FROM predictions p JOIN games g ON g.id = p.game_id WHERE p.evidence_json LIKE '%oct_forward%'").all();
    const bd = {}, bw = {}, bl = {}, bg2 = {};
    let bmin = 1, bmax = 0;
    for (const r of brow) {
      let ev = []; try { ev = JSON.parse(r.evidence_json || '[]'); } catch (e) { ev = []; }
      const rv = (ev[0] && ev[0].resolve) || {}; const mt = (ev[0] && ev[0].meta) || {};
      const d = mt.expectDate || rv.date || rv.week_start || (rv.end ? addDays(rv.end, 1) : null);
      if (d) { bd[d] = (bd[d] || 0) + 1;
        const wd = new Date(d + 'T00:00:00Z'); const mon = addDays(d, -((wd.getUTCDay() + 6) % 7));
        bw[mon] = (bw[mon] || 0) + 1; }
      bl[r.layer] = (bl[r.layer] || 0) + 1;
      bg2[r.game_type] = (bg2[r.game_type] || 0) + 1;
      const pv = Number(r.assigned_prob); if (pv < bmin) bmin = pv; if (pv > bmax) bmax = pv;
    }
    report.db_batch = {
      rows: brow.length, prob_min: brow.length ? bmin : null, prob_max: brow.length ? bmax : null,
      in_band: brow.every((r) => inBand(Number(r.assigned_prob))),
      all_forward_prefix: brow.every((r) => String(r.statement).startsWith('【forward】')),
      no_backfill_prefix: brow.every((r) => String(r.statement).indexOf('【backfill】') === -1),
      by_layer: bl, by_game_type: bg2,
      engine_counts: (function () { const o = {}; for (const r of brow) o[r.engine] = (o[r.engine] || 0) + 1; return o; })(),
      resolve_by_day: Object.keys(bd).sort().map((d) => ({ date: d, n: bd[d] })),
      resolve_by_week: Object.keys(bw).sort().map((w) => ({ week_start: w, n: bw[w] })),
      resolve_month_check: Object.keys(bd).every((d) => d.slice(0, 7) === OCT),
    };
  } catch (e) { report.db_batch = { error: String(e.message).slice(0, 150) }; }
  const outDir = path.join(__dirname, '..', 'sim', 'out');
  fs.writeFileSync(path.join(outDir, 'corpus-forward-oct.rows.json'), JSON.stringify(uniq, null, 1), 'utf8');
  const outp = path.join(outDir, 'corpus-forward-oct.out');
  fs.writeFileSync(outp, JSON.stringify(report, null, 2), 'utf8');
  console.log('report -> ' + outp);
  if (!CONFIRM) console.log('DRY-RUN: 未写库。加 --confirm 执行。');
}
main().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });