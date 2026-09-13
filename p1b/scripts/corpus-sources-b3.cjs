'use strict';
// corpus-sources-b3：二轮源普查 + 同源双出题（同一新源同批出 backfill + forward）
// 新源：Open-Meteo 空气质量 PM10 / Binance 加密日线 / Wikimedia pageviews / GitHub 周提交
//      / Frankfurter 汇率 / npm 周下载 / DBnomics BIS 有效汇率
// 红线：Q0-2 cutoff 严格早于事件；Q0-3 基率落 (0.15,0.85) 否则不产题；prob=历史基率现算；
//       每题 resolve 给取真值的确切 URL/字段。默认 dry-run；--confirm 写库。
//       --only=aq|crypto|wiki|gh|fx|npm|bis
const { db } = require('../src/deps');
const { insertPrediction, l0Gate, ensurePredictionsTable } = require('../src/db/predictionsStore');
const path = require('path');
const fs = require('fs');

const CONFIRM = process.argv.includes('--confirm');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
const LO = 0.15, HI = 0.85, TMO = 30000;
const UA = 'corpus-b3/1.0 (research; +node)';
const now08 = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00';
const RUN_AT = now08();
const TODAY = RUN_AT.slice(0, 10);
const cache = new Map();

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
// 实测教训：air-quality / wikimedia / frankfurter 在连发请求下会偶发 403/400/HTML 反爬页；
// 单发（间隔 ≥1s）恒 200。故带 3 次重试 + 退避 + 非 JSON 视为可重试错误。
async function jget(url, h, tries) {
  const k = url + '|' + JSON.stringify(h || {});
  if (cache.has(k)) return cache.get(k);
  const n = tries || 3;
  let last = null;
  for (let a = 0; a < n; a++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TMO);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json, text/csv, */*' }, h || {}) });
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
function addMon(ym, n) { const d = new Date(ym + '-01T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 7); }
function quantile(a, p) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
// 阈值挑选：候选分位 → 基率必须落 (0.15,0.85)，否则该候选作废。
// ROT 轮换：把落带候选按 |hit-0.5| 升序排列，逐次调用取下一个（round-robin），
// 使同源多题基率分散在 0.30~0.70 而非全部卡 0.50（防「常数 0.5 基率游戏」）。
// seed 由「源+标的+目标期」稳定哈希决定 → 同一次普查重跑阈值恒定（幂等可复现）
function seedOf(s) { let h = 7; const t = String(s); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return Math.abs(h); }
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
  // 轮换索引由「样本序列内容」哈希决定（未显式给 seed 时）→ 与调用顺序无关，重跑恒定
  const key = seed === undefined ? hist.join(',') : String(seed);
  const c = ok[seedOf(key) % ok.length];
  return { th: c.th, hit: c.hit, q: c.q, d: c.d, nth: ok.length };
}
const QT = [0.5, 0.6, 0.4, 0.7, 0.3];


// ── 实测证据表（本棒 2026-09-13 直连 fetch 实测；HTTP 码为记录值）──
const PROBE = [
  { src: 'AQ-om-pm10', url: 'air-quality-api.open-meteo.com/v1/air-quality?...&hourly=pm10&start_date=&end_date=', http: 200, note: '实测 365 天 9024 小时点全非空；旧棒 HTTP 400 系参数写法问题，非源不可用' },
  { src: 'AQ-cams', url: '...&domains=cams_global', http: 200, note: '亦可用' },
  { src: 'Binance-vision', url: 'data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000', http: 200, note: '1000 根日线，[0]=UTC 日开，[4]=close' },
  { src: 'Binance/CoinGecko/Coinbase/Kraken/OKX', url: 'api.binance.com / api.coingecko.com / api.coinbase.com / api.kraken.com / okx.com', http: 0, note: '全部 fetch failed（本机网络层），唯一可用通道=data-api.binance.vision' },
  { src: 'Wikimedia-pageviews', url: 'wikimedia.org/api/rest_v1/metrics/pageviews/per-article/...', http: 200, note: 'items[].{timestamp,views}；实测 365 天窗口 55071B' },
  { src: 'GitHub-stats', url: 'api.github.com/repos/{owner}/{repo}/stats/commit_activity', http: 200, note: '52 周 [{week,total,days[7]}]；core 限速 60/h 无 token（rate_limit 实测 remaining=46）' },
  { src: 'Frankfurter', url: 'api.frankfurter.app/{date}?from=USD&to=CNY', http: 200, note: 'body.rates.CNY；区间 {a}..{b} 亦可用（1972 天窗口 55KB）；未来窗口 404=pending' },
  { src: 'npm-downloads', url: 'api.npmjs.org/downloads/range/{a}:{b}/{pkg}', http: 200, note: 'downloads[].{day,downloads}；366 天窗口 15KB' },
  { src: 'DBnomics-BIS', url: 'api.db.nomics.world/v22/series/BIS/WS_EER/{code}?observations=1', http: 200, note: 'D.N.B.US 10681 个日点；period/value 同位；value 含 "NA" 字符串须过滤；数据末点实测 2025-07（滞后约 14 月）' },
  { src: 'DBnomics-IMF', url: 'api.db.nomics.world/v22/series/IMF/WEO:2024-10', http: 200, note: '8624 序列（年度 WEO，含预测值）→ 本批未采用以避免用预测当历史' },
  { src: 'DBnomics-ECB-EXR', url: 'api.db.nomics.world/v22/series/ECB/EXR/D.USD.EUR.SP00.A', http: 200, note: '日频 7148 点（现役脚本用月频系列）' },
  { src: 'stooq.com/pl CSV', url: 'stooq.com/q/d/l/?s=aapl.us&i=d', http: 200, note: '返回 HTML 反爬页（非 CSV）→ 不可用，弃用' },
  { src: 'Yahoo-Finance', url: 'query1/query2.finance.yahoo.com/v8/finance/chart/AAPL', http: 403, note: '拒绝' },
  { src: 'pypistats / arxiv-export', url: 'pypistats.org/api/..., export.arxiv.org/api/query', http: 429, note: '限速' },
  { src: 'OpenAQ-v3', url: 'api.openaq.org/v3/parameters', http: 401, note: '需 X-API-Key → 弃用' },
  { src: 'CryptoCompare', url: 'min-api.cryptocompare.com/data/price', http: 401, note: '需 API key → 弃用' },
  { src: 'SEC-EDGAR', url: 'data.sec.gov/api/xbrl/companyconcept/...', http: 0, note: 'fetch failed（本机）' },
  { src: 'GitHub-stargazers', url: 'api.github.com/repos/x/y/stargazers', http: 401, note: '需认证 → 弃用（改用 stats/commit_activity 免认证）' },
  { src: 'WorldBank', url: 'api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD', http: 200, note: '可用（本批未出题：年度值粒度粗、基率易压 0/1）' },
  { src: 'USGS-count', url: 'earthquake.usgs.gov/fdsnws/event/1/count?...', http: 200, note: 'count 整数（现役 forward 脚本已用）' },
  { src: 'OM-flood', url: 'flood-api.open-meteo.com/v1/flood?daily=river_discharge', http: 200, note: 'river_discharge；历史段可查、未来段常有 null → 本批未出题' },
];
// resolve 取真值实测（每源抽 1 条 backfill 按 resolve 还原真值；AQ/WIKI 多次连发会 403/400 限速，间隔 ≥5s 恒 200）
const RESOLVE_CHECK = [
  { src: 'corpus:airqual', http: 200, got: '日均=21.76 (n=24h)', threshold: '<=43', outcome: 'true', note: '上海 2026-08-04' },
  { src: 'corpus:crypto', http: 200, got: 'close=63043.56', threshold: '>=82615.22', outcome: 'false', note: 'BTCUSDT 2026-08-14 UTC' },
  { src: 'corpus:wikipv', http: 200, got: 'views=4995', threshold: '>=6141', outcome: 'false', note: 'Bitcoin 2026-09-08' },
  { src: 'corpus:ghcommit', http: 200, got: 'total=121', threshold: '>=53', outcome: 'true', note: 'nodejs/node 2026-08-30 周' },
  { src: 'corpus:fx', http: 200, got: 'rates.CNY=6.7413', threshold: '>=7.1264', outcome: 'false', note: 'USD/CNY 2026-08-14；前瞻区间端点对未来窗口返回 404（=正确的 pending）' },
  { src: 'corpus:npmdl', http: 200, got: 'sum=114596558', threshold: '>=131023645', outcome: 'false', note: 'react 2026-08-08~14' },
  { src: 'corpus:bis', http: 200, got: '月均=105.228', threshold: '>=87.568', outcome: 'true', note: 'D.N.B.US 2024-11（"NA" 已过滤）' },
];


// ── 源一：Open-Meteo 空气质量 PM10（新源；旧棒报 HTTP 400 → 实测 hourly=pm10 200 OK）──
// 真值锚：https://air-quality-api.open-meteo.com/v1/air-quality?latitude=&longitude=&hourly=pm10&timezone=GMT&start_date=&end_date=
//        → body.hourly.time[] 与 body.hourly.pm10[] 同位；取该 date 前缀全部小时(24)的算术均值（μg/m³）。
const AQ_CITIES = [
  { name: '上海', lat: 31.23, lon: 121.47, zh: '亚洲' },
  { name: '柏林', lat: 52.52, lon: 13.41, zh: '欧洲' },
  { name: '纽约', lat: 40.71, lon: -74.01, zh: '北美' },
  { name: '新德里', lat: 28.61, lon: 77.21, zh: '亚洲' },
  { name: '圣保罗', lat: -23.55, lon: -46.63, zh: '南美' },
];
const AQ_URL = (c, a, b) => 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + c.lat + '&longitude=' + c.lon
  + '&hourly=pm10&timezone=GMT&start_date=' + a + '&end_date=' + b;
async function aqDailyMeans(c) {
  const j = await jget(AQ_URL(c, addDays(TODAY, -365), TODAY));
  const hs = (j.hourly && j.hourly.time) || [], vs = (j.hourly && j.hourly.pm10) || [];
  const acc = {};
  hs.forEach((t, i) => { const d = t.slice(0, 10), v = vs[i]; if (v === null || v === undefined || !isFinite(v)) return; (acc[d] = acc[d] || []).push(v); });
  return Object.keys(acc).sort().map((d) => ({ d: d, m: acc[d].reduce((x, y) => x + y, 0) / acc[d].length, n: acc[d].length }));
}


function aqBackfill(series, c, out) {
  for (const off of [40, 80]) {
    const date = addDays(TODAY, -off);
    const rec = series.find((x) => x.d === date);
    if (!rec) continue;
    const base = series.filter((x) => x.d < date).map((x) => x.m);
    if (base.length < 120) continue;
    const b = pickTh(base, QT, false);
    if (!b) continue;
    const cut = bkCut(date);
    out.push({
      gameType: 'corpus:airqual', layer: 'L3', engine: 'openmeteo_air_pm10_baserate', phase: 'backfill',
      prob: Number(b.hit.toFixed(4)),
      statement: '【backfill】' + c.name + ' ' + date + ' 日 PM10 日均浓度 <= ' + b.th.toFixed(1) + ' μg/m³'
        + '（cutoff=' + cut + '，严格早于事件日；真值锚=Open-Meteo air-quality hourly.pm10 该日全小时均值。历史回填批次，非实时预测）',
      baseRateNote: '回填·' + c.name + '：cutoff 前 ' + base.length + ' 个 PM10 日均中 <= ' + b.th.toFixed(1) + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '）',
      resolve: { kind: 'openmeteo_air_pm10_daily_mean', url_template: AQ_URL(c, '{date}', '{date}'), lat: c.lat, lon: c.lon, date: date, threshold: Number(b.th.toFixed(1)), cmp: '<=', field: 'hourly.time[] 前缀==date 的全部 hourly.pm10[] 算术均值' },
      truthPreview: '实测日均=' + rec.m.toFixed(2) + '（' + rec.n + ' 小时）→ ' + (rec.m <= b.th ? 'true' : 'false'),
      meta: { city: c.name, region: c.zh, date: date, threshold: Number(b.th.toFixed(1)), cutoff: cut, phase: 'backfill' },
    });
  }
}
async function buildAQ() {
  const out = [];
  for (const c of AQ_CITIES) {
    let series = [];
    try { series = await aqDailyMeans(c); } catch (e) { continue; }
    if (series.length < 200) continue;
    aqBackfill(series, c, out);
    const base = series.filter((x) => x.d < TODAY).map((x) => x.m);
    for (const off of [2, 3]) {
      const date = addDays(TODAY, off);
      const b = pickTh(base, QT, false);
      if (!b) continue;
      out.push({
        gameType: 'corpus:airqual', layer: 'L3', engine: 'openmeteo_air_pm10_baserate_forward', phase: 'forward',
        prob: Number(b.hit.toFixed(4)),
        statement: '【forward】' + c.name + ' ' + date + ' 日 PM10 日均浓度 <= ' + b.th.toFixed(1) + ' μg/m³'
          + '（cutoff=落库时点 ' + RUN_AT + '，事件日尚未发生；真值锚=Open-Meteo air-quality hourly.pm10 该日全小时均值。前瞻批次，真值未发生）',
        baseRateNote: '前瞻·' + c.name + '：过去 365 天（' + series[0].d + '~' + series.slice(-1)[0].d + '）' + base.length + ' 个 PM10 日均中 <= ' + b.th.toFixed(1) + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff）',
        resolve: { kind: 'openmeteo_air_pm10_daily_mean', url_template: AQ_URL(c, '{date}', '{date}'), lat: c.lat, lon: c.lon, date: date, threshold: Number(b.th.toFixed(1)), cmp: '<=', field: 'hourly.time[] 前缀==date 的全部 hourly.pm10[] 算术均值' },
        meta: { city: c.name, region: c.zh, date: date, threshold: Number(b.th.toFixed(1)), cutoff: RUN_AT, phase: 'forward' },
      });
    }
  }
  return out;
}


// ── 源二：Binance 加密日线（api.binance.com 本机 fetch failed → data-api.binance.vision 实测 200）──
// 真值锚：https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=<ms>&endTime=<ms>&limit=1000
//        → 每根 [openTime, open, high, low, close, ...]，[0]=UTC 日开，[4]=close。resolve 用 start_ms/end_ms 直接填模板。
const CR_PAIRS = [
  { sym: 'BTCUSDT', label: 'BTC/USDT' },
  { sym: 'ETHUSDT', label: 'ETH/USDT' },
  { sym: 'SOLUSDT', label: 'SOL/USDT' },
];
const CR_TMPL = 'https://data-api.binance.vision/api/v3/klines?symbol={symbol}&interval=1d&limit=1000&startTime={start_ms}&endTime={end_ms}';
const crKl = (sym, ms0, ms1) => 'https://data-api.binance.vision/api/v3/klines?symbol=' + sym + '&interval=1d&limit=1000&startTime=' + ms0 + '&endTime=' + ms1;
// 窗口末端固定为「今日 00:00 UTC」（不用 Date.now()）：否则当日未完结的最后一根日线时有时无，
// 导致 closes 数组变动 → 阈值随之漂移 → 重跑非幂等（实测重跑多插 4 条）。
async function crDaily(sym) {
  // 只用「UTC 日已完整结束」的日线：末根未收盘（close≈实时价）会逐次微变 → 序列哈希变动 → 阈值漂移 → 重跑非幂等。
  const utcToday = new Date().toISOString().slice(0, 10);
  const arr = await jget(crKl(sym, Date.parse(addDays(utcToday, -900) + 'T00:00:00Z'), Date.parse(utcToday + 'T00:00:00Z') - 1));
  return arr.map((k) => ({ d: isoOf(k[0]), c: Number(k[4]) })).filter((x) => isFinite(x.c) && x.c > 0);
}
const crResolve = (p, date, th) => ({
  kind: 'binance_daily_close', url_template: CR_TMPL, symbol: p.sym,
  start_ms: Date.parse(date + 'T00:00:00Z'), end_ms: Date.parse(date + 'T00:00:00Z') + 86399999,
  date: date, threshold: Number(th.toFixed(2)), cmp: '>=', field: '返回数组[0][4] = close',
});


function crBackfill(series, p, out) {
  for (const off of [30, 200]) {
    const date = addDays(TODAY, -off);
    const rec = series.find((x) => x.d === date);
    if (!rec) continue;
    const base = series.filter((x) => x.d < date).map((x) => x.c);
    if (base.length < 200) continue;
    const b = pickTh(base, QT, true);
    if (!b) continue;
    out.push({
      gameType: 'corpus:crypto', layer: 'L2', engine: 'binance_daily_close_baserate', phase: 'backfill',
      prob: Number(b.hit.toFixed(4)),
      statement: '【backfill】' + p.label + ' ' + date + '（UTC 日）收盘价 >= ' + b.th.toFixed(2) + ' USDT'
        + '（cutoff=' + bkCut(date) + '，严格早于该 UTC 日；真值锚=Binance klines [4]=close。历史回填批次，非实时预测）',
      baseRateNote: '回填·' + p.label + '：cutoff 前 ' + base.length + ' 个日线收盘中 >= ' + b.th.toFixed(2) + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '）',
      resolve: crResolve(p, date, b.th),
      truthPreview: '实测收盘=' + rec.c + ' → ' + (rec.c >= b.th ? 'true' : 'false'),
      meta: { symbol: p.sym, date: date, threshold: Number(b.th.toFixed(2)), cutoff: bkCut(date), phase: 'backfill' },
    });
  }
}
async function buildCrypto() {
  const out = [];
  for (const p of CR_PAIRS) {
    let series = [];
    try { series = await crDaily(p.sym); } catch (e) { continue; }
    if (series.length < 250) continue;
    crBackfill(series, p, out);
    const closes = series.map((x) => x.c);
    const lastD = series[series.length - 1].d;
    for (const off of [2, 8]) {
      const date = addDays(TODAY, off);
      const b = pickTh(closes, QT, true);
      if (!b) continue;
      out.push({
        gameType: 'corpus:crypto', layer: 'L2', engine: 'binance_daily_close_baserate_forward', phase: 'forward',
        prob: Number(b.hit.toFixed(4)),
        statement: '【forward】' + p.label + ' ' + date + '（UTC 日）收盘价 >= ' + b.th.toFixed(2) + ' USDT'
          + '（cutoff=落库时点 ' + RUN_AT + '，该 UTC 日尚未结束；真值锚=Binance klines [4]=close。前瞻批次，真值未发生）',
        baseRateNote: '前瞻·' + p.label + '：近 ' + series.length + ' 个 UTC 日线（' + series[0].d + '~' + lastD + '）收盘价 >= ' + b.th.toFixed(2) + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff）',
        resolve: crResolve(p, date, b.th),
        meta: { symbol: p.sym, date: date, threshold: Number(b.th.toFixed(2)), cutoff: RUN_AT, phase: 'forward' },
      });
    }
  }
  return out;
}


// ── 源三：Wikimedia pageviews（新源，实测 200）──
// 真值锚：https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/{ART}/daily/{YYYYMMDD}00/{YYYYMMDD}00
//        → body.items[].timestamp='YYYYMMDD00' 与 .views（整数）。
const WIKI_ART = ['Bitcoin', 'Artificial_intelligence', 'ChatGPT', 'Taylor_Swift', 'Ethereum'];
const WIKI_URL = (art, a, b) => 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/'
  + art + '/daily/' + a.replace(/-/g, '') + '00/' + b.replace(/-/g, '') + '00';
const ymd = (iso) => iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10);
async function wikiDaily(art, from, to) {
  const j = await jget(WIKI_URL(art, from, to));
  const m = {};
  (j.items || []).forEach((it) => { m[it.timestamp.slice(0, 8)] = it.views; });
  return m;
}
const wikiResolve = (art, date, th) => ({ kind: 'wikimedia_pageviews', url_template: WIKI_URL(art, '{date}', '{date}'), article: art, date: date, threshold: th, cmp: '>=', field: "items[] 中 timestamp=='YYYYMMDD00' 者 .views" });


function wikiBackfill(d, art, out) {
  for (const off of [5, 30, 60]) {
    const date = addDays(TODAY, -off), key = ymd(date);
    const v = d[key];
    if (v === undefined) continue;
    const prev = Object.keys(d).filter((k) => k < key).sort().map((k) => d[k]);
    if (prev.length < 150) continue;
    const b = pickTh(prev, QT, true);
    if (!b) continue;
    out.push({
      gameType: 'corpus:wikipv', layer: 'L2', engine: 'wikimedia_pageviews_baserate', phase: 'backfill',
      prob: Number(b.hit.toFixed(4)),
      statement: '【backfill】en.wikipedia 「' + art + '」 ' + date + ' 页面浏览量 >= ' + b.th + ' 次'
        + '（cutoff=' + bkCut(date) + '，严格早于该日；真值锚=Wikimedia pageviews API items[].views。历史回填批次，非实时预测）',
      baseRateNote: '回填·' + art + '：cutoff 前 ' + prev.length + ' 个日浏览量中 >= ' + b.th + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '）',
      resolve: wikiResolve(art, date, b.th),
      truthPreview: '实测 views=' + v + ' → ' + (v >= b.th ? 'true' : 'false'),
      meta: { article: art, date: date, threshold: b.th, cutoff: bkCut(date), phase: 'backfill' },
    });
  }
}


async function buildWiki() {
  const out = [];
  for (const art of WIKI_ART) {
    let d = {};
    try { d = await wikiDaily(art, addDays(TODAY, -400), addDays(TODAY, -3)); } catch (e) { continue; }
    const vals = Object.keys(d).sort().map((k) => d[k]);
    if (vals.length < 200) continue;
    wikiBackfill(d, art, out);
    for (const off of [3, 10]) {
      const date = addDays(TODAY, off);
      const b = pickTh(vals, QT, true);
      if (!b) continue;
      out.push({
        gameType: 'corpus:wikipv', layer: 'L2', engine: 'wikimedia_pageviews_baserate_forward', phase: 'forward',
        prob: Number(b.hit.toFixed(4)),
        statement: '【forward】en.wikipedia 「' + art + '」 ' + date + ' 页面浏览量 >= ' + b.th + ' 次'
          + '（cutoff=落库时点 ' + RUN_AT + '，该日尚未发生；真值锚=Wikimedia pageviews API items[].views。前瞻批次，真值未发生）',
        baseRateNote: '前瞻·' + art + '：过去 400 天（截至 ' + addDays(TODAY, -3) + '）' + vals.length + ' 个日浏览量中 >= ' + b.th + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff）',
        resolve: wikiResolve(art, date, b.th),
        meta: { article: art, date: date, threshold: b.th, cutoff: RUN_AT, phase: 'forward' },
      });
    }
  }
  return out;
}


// ── 源四：GitHub repo 周提交数（新源，实测 200；core 限速 60/h 无 token）──
// 真值锚：https://api.github.com/repos/{owner}/{repo}/stats/commit_activity
//        → [{total, week(Unix 秒, 该周周日 UTC 00:00), days[7]}]，total=该周 7 天提交数（默认分支）。
const GH_REPOS = [
  { full: 'nodejs/node', label: 'nodejs/node' },
  { full: 'microsoft/vscode', label: 'microsoft/vscode' },
  { full: 'facebook/react', label: 'facebook/react' },
];
async function ghWeeks(full) {
  const j = await jget('https://api.github.com/repos/' + full + '/stats/commit_activity', { Accept: 'application/vnd.github+json' });
  if (!Array.isArray(j)) return [];
  return j.filter((w) => w && w.week).map((w) => ({ w: w.week, iso: isoOf(w.week * 1000), total: w.total }));
}
function ghBackfill(ws, r, out) {
  for (const k of [2, 3]) {
    const rec = ws[ws.length - k];
    if (!rec) continue;
    const prev = ws.slice(0, ws.length - k + 1).map((x) => x.total);
    if (prev.length < 30) continue;
    const b = pickTh(prev, QT, true);
    if (!b) continue;
    const end = addDays(rec.iso, 6);
    out.push({
      gameType: 'corpus:ghcommit', layer: 'L2', engine: 'github_weekly_commits_baserate', phase: 'backfill',
      prob: Number(b.hit.toFixed(4)),
      statement: '【backfill】GitHub ' + r.label + ' 默认分支 ' + rec.iso + '~' + end + ' 一周提交数 >= ' + b.th
        + '（cutoff=' + bkCut(rec.iso) + '，严格早于该周起点；真值锚=GitHub stats/commit_activity [].total。历史回填批次，非实时预测）',
      baseRateNote: '回填·' + r.label + '：cutoff 前 ' + prev.length + ' 个完整周提交数中 >= ' + b.th + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '）',
      resolve: { kind: 'github_weekly_commits', url: 'https://api.github.com/repos/' + r.full + '/stats/commit_activity', repo: r.full, week_start: rec.iso, week_end: end, threshold: b.th, cmp: '>=', field: 'weeks[] 中 new Date(week*1000) 的 ISO 日期 == week_start 那项的 .total' },
      truthPreview: '实测周提交=' + rec.total + ' → ' + (rec.total >= b.th ? 'true' : 'false'),
      meta: { repo: r.full, week_start: rec.iso, threshold: b.th, cutoff: bkCut(rec.iso), phase: 'backfill' },
    });
  }
}


async function buildGh() {
  const out = [];
  for (const r of GH_REPOS) {
    let ws = [];
    try { ws = await ghWeeks(r.full); } catch (e) { continue; }
    if (ws.length < 40) continue;
    const totals = ws.map((x) => x.total);
    ghBackfill(ws, r, out);
    // 前瞻：起始日必须严格晚于今天（GitHub 周从周日 UTC 起；今日恰为周起点时再顺延一周）
    let nextStart = addDays(ws[ws.length - 1].iso, 7);
    while (!(nextStart > TODAY)) nextStart = addDays(nextStart, 7);
    const nxt = pickTh(totals, QT, true);
    if (nxt) out.push({
      gameType: 'corpus:ghcommit', layer: 'L2', engine: 'github_weekly_commits_baserate_forward', phase: 'forward',
      prob: Number(nxt.hit.toFixed(4)),
      statement: '【forward】GitHub ' + r.label + ' 默认分支 ' + nextStart + '~' + addDays(nextStart, 6) + ' 一周提交数 >= ' + nxt.th
        + '（cutoff=落库时点 ' + RUN_AT + '，该周尚未开始；真值锚=GitHub stats/commit_activity [].total。前瞻批次，真值未发生）',
      baseRateNote: '前瞻·' + r.label + '：近 ' + totals.length + ' 个完整周提交数中 >= ' + nxt.th + ' 占 ' + pct(nxt.hit) + '（分位 q=' + nxt.q + '，pre-cutoff）',
      resolve: { kind: 'github_weekly_commits', url: 'https://api.github.com/repos/' + r.full + '/stats/commit_activity', repo: r.full, week_start: nextStart, week_end: addDays(nextStart, 6), threshold: nxt.th, cmp: '>=', field: 'weeks[] 中 ISO 日期 == week_start 那项的 .total' },
      meta: { repo: r.full, week_start: nextStart, threshold: nxt.th, cutoff: RUN_AT, phase: 'forward' },
    });
  }
  return out;
}


// ── 源五：Frankfurter 汇率（ECB 数据，实测 200，无需 key）──
// 真值锚：https://api.frankfurter.app/{YYYY-MM-DD}?from=USD&to=CNY → body.rates.CNY（工作日发布）
const FX_PAIRS = [
  { from: 'USD', to: 'CNY', label: 'USD/CNY' },
  { from: 'USD', to: 'JPY', label: 'USD/JPY' },
  { from: 'USD', to: 'EUR', label: 'USD/EUR' },
];
const FX_URL = (a, b, f, t) => 'https://api.frankfurter.app/' + a + '..' + b + '?from=' + f + '&to=' + t;
// 前瞻 resolve 用「目标日起 7 天窗口」：Frankfurter 对未发布日会回退到最近已发布日，
// 故必须按 body.rates 的键里 >= 目标日的最早一日取真值（自动跳过周末/节假日）。
const FX_TMPL_FW = 'https://api.frankfurter.app/{date}..{date_plus7}?from={base}&to={quote}';
const fxResolveFw = (p, date, th) => ({
  kind: 'frankfurter_rate_range', url_template: FX_TMPL_FW, base: p.from, quote: p.to, date: date,
  date_plus7: addDays(date, 7), threshold: Number(th.toFixed(4)), cmp: '>=',
  field: 'body.rates 的键中 >= date 的最早一日的 body.rates[D][quote]',
});
async function fxSeries(f, t) {
  const j = await jget(FX_URL(addDays(TODAY, -500), addDays(TODAY, -3), f, t));
  const rs = j.rates || {};
  return Object.keys(rs).sort().map((d) => ({ d: d, v: rs[d][t] })).filter((x) => isFinite(x.v));
}
async function buildFx() {
  const out = [];
  for (const p of FX_PAIRS) {
    let s = [];
    try { s = await fxSeries(p.from, p.to); } catch (e) { continue; }
    if (s.length < 250) continue;
    const vals = s.map((x) => x.v);
    for (const off of [3, 10]) {
      const date = addDays(TODAY, off);
      const b = pickTh(vals, QT, true);
      if (!b) continue;
      out.push({
        gameType: 'corpus:fx', layer: 'L2', engine: 'frankfurter_fx_baserate_forward', phase: 'forward',
        prob: Number(b.hit.toFixed(4)),
        statement: '【forward】' + p.label + ' 在 ' + date + ' 当周首个 ECB 发布日的参考汇率 >= ' + b.th.toFixed(4)
          + '（cutoff=落库时点 ' + RUN_AT + '，该日尚未到（非发布日顺延至下一发布日）；真值锚=Frankfurter API rates。前瞻批次，真值未发生）',
        baseRateNote: '前瞻·' + p.label + '：近 ' + s.length + ' 个发布日（' + s[0].d + '~' + s.slice(-1)[0].d + '）汇率 >= ' + b.th.toFixed(4) + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff）',
        resolve: fxResolveFw(p, date, b.th),
        meta: { pair: p.label, date: date, threshold: Number(b.th.toFixed(4)), cutoff: RUN_AT, phase: 'forward' },
      });
    }
    for (const off of [30, 120]) {
      const want = addDays(TODAY, -off);
      const cands = s.map((x) => x.d).filter((d) => d <= want);
      const lastD = cands[cands.length - 1];
      const rec = lastD ? s.find((x) => x.d === lastD) : null;
      if (!rec) continue;
      const prev = s.filter((x) => x.d < rec.d).map((x) => x.v);
      if (prev.length < 150) continue;
      const b = pickTh(prev, QT, true);
      if (!b) continue;
      out.push({
        gameType: 'corpus:fx', layer: 'L2', engine: 'frankfurter_fx_baserate', phase: 'backfill',
        prob: Number(b.hit.toFixed(4)),
        statement: '【backfill】' + p.label + ' 在 ' + rec.d + ' 的 ECB 参考汇率 >= ' + b.th.toFixed(4)
          + '（cutoff=' + bkCut(rec.d) + '，严格早于该发布日；真值锚=Frankfurter API rates。历史回填批次，非实时预测）',
        baseRateNote: '回填·' + p.label + '：cutoff 前 ' + prev.length + ' 个发布日汇率中 >= ' + b.th.toFixed(4) + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '）',
        resolve: { kind: 'frankfurter_rate', url_template: 'https://api.frankfurter.app/{date}?from=' + p.from + '&to=' + p.to, base: p.from, quote: p.to, date: rec.d, threshold: Number(b.th.toFixed(4)), cmp: '>=', field: 'body.rates[date][quote]' },
        truthPreview: '实测=' + rec.v + ' → ' + (rec.v >= b.th ? 'true' : 'false'),
        meta: { pair: p.label, date: rec.d, threshold: Number(b.th.toFixed(4)), cutoff: bkCut(rec.d), phase: 'backfill' },
      });
    }
  }
  return out;
}


// ── 源六：npm 包周下载量（新源，实测 200，无需 key）──
// 真值锚：https://api.npmjs.org/downloads/range/{YYYY-MM-DD}:{YYYY-MM-DD}/{pkg} → body.downloads[].{day,downloads}
const NPM_PKGS = [
  { pkg: 'react', label: 'react' },
  { pkg: 'typescript', label: 'typescript' },
  { pkg: 'vite', label: 'vite' },
];
async function npmDaily(pkg, a, b) {
  const j = await jget('https://api.npmjs.org/downloads/range/' + a + ':' + b + '/' + pkg);
  return (j.downloads || []).map((x) => ({ d: x.day, v: x.downloads }));
}
async function buildNpm() {
  const out = [];
  for (const p of NPM_PKGS) {
    let s = [];
    try { s = await npmDaily(p.pkg, addDays(TODAY, -200), addDays(TODAY, -2)); } catch (e) { continue; }
    if (s.length < 150) continue;
    const vals = s.map((x) => x.v);
    // 用 7 日滚动和做「周下载量」题（降噪；单日抖动太大）
    const roll = [];
    for (let i = 6; i < s.length; i++) { let t = 0; for (let k = 0; k < 7; k++) t += s[i - k].v; roll.push({ d: s[i].d, v: t }); }
    if (roll.length < 140) continue;
    const rv = roll.map((x) => x.v);
    for (const off of [9, 16]) {   // 未来 7 日窗口：需再等 7 天满窗 → 取 +9（今日+2~+8）
      const winStart = addDays(TODAY, off - 6), winEnd = addDays(TODAY, off);
      const b = pickTh(rv, QT, true);
      if (!b) continue;
      out.push({
        gameType: 'corpus:npmdl', layer: 'L2', engine: 'npm_downloads_baserate_forward', phase: 'forward',
        prob: Number(b.hit.toFixed(4)),
        statement: '【forward】npm 包 ' + p.label + ' 在 ' + winStart + '~' + winEnd + ' 的 7 日下载量 >= ' + b.th
          + '（cutoff=落库时点 ' + RUN_AT + '，窗口尚未开始；真值锚=npm downloads/range downloads[].downloads 求和。前瞻批次，真值未发生）',
        baseRateNote: '前瞻·' + p.label + '：近 ' + roll.length + ' 个 7 日滚动窗（' + roll[0].d + '~' + roll.slice(-1)[0].d + '）中 >= ' + b.th + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff）',
        resolve: { kind: 'npm_downloads_window', url_template: 'https://api.npmjs.org/downloads/range/{start}:{end}/' + p.pkg, package: p.pkg, start: winStart, end: winEnd, threshold: b.th, cmp: '>=', field: 'body.downloads[].downloads 求和（按 .day 落在 [start,end]）' },
        meta: { package: p.pkg, start: winStart, end: winEnd, threshold: b.th, cutoff: RUN_AT, phase: 'forward' },
      });
    }
    for (const off of [30, 90]) {
      const winEnd = addDays(TODAY, -off), winStart = addDays(winEnd, -6);
      const prev = roll.filter((x) => x.d < winStart).map((x) => x.v);
      if (prev.length < 120) continue;
      const b = pickTh(prev, QT, true);
      if (!b) continue;
      const after = roll.filter((x) => x.d >= winEnd);
      const hit = after.find((x) => x.d === addDays(winStart, 6));
      if (!hit) continue;
      out.push({
        gameType: 'corpus:npmdl', layer: 'L2', engine: 'npm_downloads_baserate', phase: 'backfill',
        prob: Number(b.hit.toFixed(4)),
        statement: '【backfill】npm 包 ' + p.label + ' 在 ' + winStart + '~' + winEnd + ' 的 7 日下载量 >= ' + b.th
          + '（cutoff=' + bkCut(winStart) + '，严格早于该窗口；真值锚=npm downloads/range。历史回填批次，非实时预测）',
        baseRateNote: '回填·' + p.label + '：cutoff 前 ' + prev.length + ' 个 7 日滚动窗中 >= ' + b.th + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '）',
        resolve: { kind: 'npm_downloads_window', url_template: 'https://api.npmjs.org/downloads/range/{start}:{end}/' + p.pkg, package: p.pkg, start: winStart, end: winEnd, threshold: b.th, cmp: '>=', field: 'body.downloads[].downloads 求和（按 .day 落在 [start,end]）' },
        truthPreview: '实测 7 日=' + hit.v + ' → ' + (hit.v >= b.th ? 'true' : 'false'),
        meta: { package: p.pkg, start: winStart, end: winEnd, threshold: b.th, cutoff: bkCut(winStart), phase: 'backfill' },
      });
    }
  }
  return out;
}


// ── 源七：DBnomics / BIS 有效汇率（任务书第 6 条「试 BIS/IMF 数据集」实测：BIS WS_EER 200）──
// 真值锚：https://api.db.nomics.world/v22/series/BIS/WS_EER/{SERIES_CODE}?observations=1
//        → body.series.docs[0].period[]='YYYY-MM-DD' 与 .value[] 同位；按月取该月全部日值的算术均值（field=series.docs[0] 月内均值）。
//        实测序列码：D.N.B.US / D.N.B.CN / D.N.B.JP（BIS 名义有效汇率，日频 2010=100，数据末点实测 2025-07）
//        IMF WEO:2024-10 亦 200（8624 序列），但为年度预测值，本批不改用。
const BIS_SERIES = [
  { code: 'D.N.B.US', label: 'BIS 美元名义有效汇率' },
  { code: 'D.N.B.CN', label: 'BIS 人民币名义有效汇率' },
  { code: 'D.N.B.JP', label: 'BIS 日元名义有效汇率' },
];
const BIS_URL = (code) => 'https://api.db.nomics.world/v22/series/BIS/WS_EER/' + code + '?observations=1';
async function bisMonthly(code) {
  const j = await jget(BIS_URL(code));
  const doc = j.series && j.series.docs && j.series.docs[0];
  if (!doc) return [];
  const acc = {};
  doc.period.forEach((p, i) => { const v = doc.value[i]; if (v === null || v === undefined || !isFinite(v)) return; const m = String(p).slice(0, 7); (acc[m] = acc[m] || []).push(v); });
  return Object.keys(acc).sort().map((m) => ({ m: m, v: acc[m].reduce((x, y) => x + y, 0) / acc[m].length, n: acc[m].length }));
}
const bisResolve = (code, month, th) => ({ kind: 'dbnomics_bis_monthly_mean', url_template: BIS_URL(code), series: code, month: month, threshold: Number(th.toFixed(3)), cmp: '>=', field: 'series.docs[0].period[]/value[] 该月内均值' });


function bisBackfill(series, s, out) {
  const have = series.map((x) => x.m);
  // 只取「观测已发布且完整」的整月：BIS WS_EER 实测滞后约 14 个月 → 取倒数第 15 / 26 个自然月
  const picks = [have[have.length - 15], have[have.length - 26]].filter(Boolean);
  for (const month of picks) {
    const rec = series.find((x) => x.m === month);
    if (!rec) continue;
    const prev = series.filter((x) => x.m < month).map((x) => x.v);
    if (prev.length < 60) continue;
    const b = pickTh(prev, QT, true);
    if (!b) continue;
    const cut = dayBefore(month + '-01') + 'T23:59:59+08:00';
    out.push({
      gameType: 'corpus:bis', layer: 'L2', engine: 'bis_eer_monthly_baserate', phase: 'backfill',
      prob: Number(b.hit.toFixed(4)),
      statement: '【backfill】' + s.label + '（' + s.code + '） ' + month + ' 月均值 >= ' + b.th.toFixed(3)
        + '（cutoff=' + cut + '，严格早于该月；真值锚=DBnomics BIS/WS_EER series.docs[0].value 月内均值。历史回填批次，非实时预测）',
      baseRateNote: '回填·' + s.code + '：cutoff 前 ' + prev.length + ' 个月均值中 >= ' + b.th.toFixed(3) + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '）',
      resolve: bisResolve(s.code, month, b.th),
      truthPreview: '实测月均=' + rec.v.toFixed(3) + '（' + rec.n + ' 日）→ ' + (rec.v >= b.th ? 'true' : 'false'),
      meta: { series: s.code, month: month, threshold: Number(b.th.toFixed(3)), cutoff: cut, phase: 'backfill' },
    });
  }
}


function bisForward(series, s, out) {
  const have = series.map((x) => x.m);
  const lastM = have[have.length - 1];
  const all = series.map((x) => x.v);
  const b = pickTh(all, QT, true);
  if (!b) return;
  const cur = TODAY.slice(0, 7);
  const nxt = [addMon(cur, 1), addMon(cur, 2)];   // 未来自然月（事件尚未发生）
  for (const month of nxt) {
    out.push({
      gameType: 'corpus:bis', layer: 'L2', engine: 'bis_eer_monthly_baserate_forward', phase: 'forward',
      prob: Number(b.hit.toFixed(4)),
      statement: '【forward】' + s.label + '（' + s.code + '） ' + month + ' 月均值 >= ' + b.th.toFixed(3)
        + '（cutoff=落库时点 ' + RUN_AT + '，该月尚未发生；真值锚=DBnomics BIS/WS_EER series.docs[0].value 月内均值。'
        + '注意 BIS 实测发布滞后约 14 个月（已发布至 ' + lastM + '），resolve 需待该月完整观测发布。前瞻批次，真值未发生）',
      baseRateNote: '前瞻·' + s.code + '：已发布 ' + all.length + ' 个月均值（' + have[0] + '~' + lastM + '）中 >= ' + b.th.toFixed(3) + ' 占 ' + pct(b.hit) + '（分位 q=' + b.q + '，pre-cutoff）',
      resolve: bisResolve(s.code, month, b.th),
      meta: { series: s.code, month: month, threshold: Number(b.th.toFixed(3)), cutoff: RUN_AT, phase: 'forward', pub_lag_months: 14 },
    });
  }
}
async function buildBis() {
  const out = [];
  for (const s of BIS_SERIES) {
    let series = [];
    try { series = await bisMonthly(s.code); } catch (e) { continue; }
    if (series.length < 80) continue;
    bisBackfill(series, s, out);
    bisForward(series, s, out);
  }
  return out;
}


// ── 主流程：同源双出题 + 落库 ──
const SRC = {
  aq: ['corpus:airqual', 'Open-Meteo 空气质量 PM10', buildAQ],
  crypto: ['corpus:crypto', 'Binance 加密日线', buildCrypto],
  wiki: ['corpus:wikipv', 'Wikimedia pageviews', buildWiki],
  gh: ['corpus:ghcommit', 'GitHub 周提交', buildGh],
  fx: ['corpus:fx', 'Frankfurter 汇率', buildFx],
  npm: ['corpus:npmdl', 'npm 周下载', buildNpm],
  bis: ['corpus:bis', 'DBnomics BIS 有效汇率', buildBis],
};
async function main() {
  const keys = ONLY ? [ONLY] : Object.keys(SRC);
  const all = [];
  const report = { run_at: RUN_AT, confirm: CONFIRM, probe: PROBE, resolve_check_evidence: RESOLVE_CHECK, sources: {} };
  for (const k of keys) {
    const [gt, label, fn] = SRC[k];
    if (!fn) { report.sources[k] = { error: 'unknown source' }; continue; }
    let rows = [];
    try { rows = await fn(); } catch (e) { rows = []; report.sources[k] = { error: String(e.message).slice(0, 160) }; console.log('[WARN] ' + k + ' ' + e.message); }
    const fw = rows.filter((r) => r.phase === 'forward'), bf = rows.filter((r) => r.phase === 'backfill');
    const probs = rows.map((r) => r.prob);
    report.sources[k] = {
      label: label, game_type: gt, total: rows.length, backfill: bf.length, forward: fw.length,
      prob_min: probs.length ? Number(Math.min.apply(null, probs).toFixed(4)) : null,
      prob_max: probs.length ? Number(Math.max.apply(null, probs).toFixed(4)) : null,
      band_ok: probs.every((p) => inBand(p)),
      samples_backfill: bf.slice(0, 1).map((r) => r.statement),
      samples_forward: fw.slice(0, 1).map((r) => r.statement),
      resolve_examples: rows.slice(0, 2).map((r) => ({ kind: r.resolve.kind, url: r.resolve.url_template || r.resolve.url, field: r.resolve.field || null })),
    };
    all.push.apply(all, rows);
    console.log('[' + k + '] total=' + rows.length + ' backfill=' + bf.length + ' forward=' + fw.length);
  }
  report.total = all.length;
  report.backfill_total = all.filter((r) => r.phase === 'backfill').length;
  report.forward_total = all.filter((r) => r.phase === 'forward').length;
  report.band_violations = all.filter((r) => !inBand(r.prob)).map((r) => r.statement);
  report.slug_dupes = (function () { const s = {}, d = []; all.forEach((r) => { if (s[r.slug || r.statement]) d.push(r.statement); s[r.slug || r.statement] = 1; }); return d; })();
  console.log('TOTAL=' + report.total + ' backfill=' + report.backfill_total + ' forward=' + report.forward_total + ' bandViolations=' + report.band_violations.length);
  if (CONFIRM) {
    db.init();
    const conn = db.getConnection();
    ensurePredictionsTable(conn);
    const gid = {};
    for (const k of keys) {
      const gt = SRC[k][0];
      const row = conn.prepare('SELECT id FROM games WHERE game_type = ? LIMIT 1').get(gt);
      if (row) { gid[gt] = row.id; continue; }
      const g = db.createGame('corpus-' + k + '-b3', gt, 1);
      gid[gt] = g.id;
    }
    let ins = 0, skip = 0, dupe = 0;
    // 幂等键 = 同局 + 归一化 statement（抹掉 cutoff 时点，同一目标题重跑不重复落卡）
    const norm = (s) => String(s).replace(/cutoff=[^）]*/g, 'cutoff=X');
    const existing = new Set();
    conn.prepare('SELECT game_id, statement FROM predictions').all().forEach((x) => existing.add(x.game_id + '||' + norm(x.statement)));
    for (const r of all) {
      if (!inBand(r.prob)) { skip++; continue; }
      const g = gid[r.gameType];
      if (!g) { skip++; continue; }
      if (existing.has(g + '||' + norm(r.statement))) { dupe++; continue; }
      try {
        insertPrediction({
          gameId: g, day: null, sourceType: '预测卡', statement: r.statement, prob: r.prob,
          evidence: [{ resolve: r.resolve, baseRateNote: r.baseRateNote, meta: r.meta, slug: r.slug, phase: r.phase, kind: 'b3_' + r.phase }],
          layer: r.layer, engine: r.engine, gate: 'descriptive', checklistHash: 'v2', publicExposure: 0,
        });
        ins++;
      } catch (e) { skip++; console.log('[skip] ' + String(e.message).slice(0, 110)); }
    }
    report.inserted = ins; report.skipped = skip; report.duplicate_skipped = dupe; report.l0Gate_after = l0Gate();
    console.log('inserted=' + ins + ' skipped=' + skip + ' duplicate_skipped=' + dupe);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'sim', 'out', 'corpus-sources-b3.rows.json'), JSON.stringify(all, null, 1), 'utf8');
  const outp = path.join(__dirname, '..', 'sim', 'out', 'corpus-sources-b3.out');
  fs.writeFileSync(outp, JSON.stringify(report, null, 2), 'utf8');
  console.log('report → ' + outp);
  if (!CONFIRM) console.log('DRY-RUN: 未写库。加 --confirm 执行。');
}
main().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });

