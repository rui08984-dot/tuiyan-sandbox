'use strict';
// corpus-sources-b4：语料源再扩量（同源扩量 + deferred 域攻坚 + 新域探查）
// 骨架先落盘；各域 builder 逐个追加。
// 红线：Q0-2 cutoff 严格早于事件；Q0-3 基率落 (0.15,0.85) 否则不产题；prob=历史基率现算；
//       每题 resolve 给取真值的确切 URL/field；backfill / forward 分离标注。
// 写库字段：驼峰 checklistHash + publicExposure:0（下划线写法会被写入口抛错并被 try/catch 吞成 inserted=0）。
// 默认 dry-run；--confirm 写库。--only=<key>
const { db } = require('../src/deps');
const { insertPrediction, l0Gate, ensurePredictionsTable } = require('../src/db/predictionsStore');
const path = require('path');
const fs = require('fs');

const CONFIRM = process.argv.includes('--confirm');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
const LO = 0.15, HI = 0.85, TMO = 30000;
const UA = 'corpus-b4/1.0 (research; +node)';
const now08 = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00';
const RUN_AT = now08();
const TODAY = RUN_AT.slice(0, 10);
const cache = new Map();
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
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
  const key = seed === undefined ? hist.join(',') : String(seed);
  const c = ok[seedOf(key) % ok.length];
  return { th: c.th, hit: c.hit, q: c.q, d: c.d, nth: ok.length };
}
const QT = [0.5, 0.6, 0.4, 0.7, 0.3];

// ── 通用序列出题器（日频/月频/周频通用；k=期键，v=数值）──
// cfg: { series:[{k,v}], gameType, layer, engine, ge, minBase, bkKeys:[], fwKeys:[], cut(key),
//        stmt(phase,key,th,cmp), note(phase,n,th,hit,q,series,cmp), resolve(key,th,cmp), meta(key,th), slug(key) }
function emitSeries(cfg, out) {
  const s = (cfg.series || []).filter((x) => x && isFinite(x.v));
  const minBase = cfg.minBase || 60;
  if (s.length < minBase) return;
  const keys = s.map((x) => x.k);
  const vals = s.map((x) => x.v);
  const ge = !!cfg.ge;
  const cmp = ge ? '>=' : '<=';
  const push = (phase, key, th, hit, q, nbase, v) => {
    out.push({
      gameType: cfg.gameType, layer: cfg.layer, phase: phase,
      engine: cfg.engine + (phase === 'forward' ? '_forward' : ''),
      slug: cfg.gameType + '|' + (cfg.slug ? cfg.slug(key) : key),
      prob: Number(hit.toFixed(4)),
      statement: cfg.stmt(phase, key, th, cmp),
      baseRateNote: cfg.note(phase, nbase, th, hit, q, s, cmp),
      resolve: cfg.resolve(key, th, cmp),
      meta: Object.assign({ phase: phase, cutoff: phase === 'forward' ? RUN_AT : cfg.cut(key) }, cfg.meta ? cfg.meta(key, th) : {}),
      truthPreview: phase === 'backfill' && v !== undefined ? ('实测=' + v + ' -> ' + ((ge ? v >= th : v <= th) ? 'true' : 'false')) : undefined,
    });
  };
  for (const key of (cfg.fwKeys || [])) {
    const b = pickTh(vals, QT, ge);
    if (!b) continue;
    push('forward', key, b.th, b.hit, b.q, vals.length, undefined);
  }
  for (const key of (cfg.bkKeys || [])) {
    const i = keys.indexOf(key);
    if (i < minBase) continue;
    const prev = vals.slice(0, i);
    const b = pickTh(prev, QT, ge);
    if (!b) continue;
    push('backfill', key, b.th, b.hit, b.q, prev.length, vals[i]);
  }
}

// ── 出题证据表（本棒直连 fetch 实测）──
const PROBE = [
  { src: 'USGS-NWIS-dv', url: 'waterservices.usgs.gov/nwis/dv/?format=json&sites={id}&parameterCd=00060&startDT=&endDT=', http: 200, note: '新域·河流：value.timeSeries[0].values[0].value[].{dateTime,value}；实测科罗拉多河 Lees Ferry 40 日点，末点 2026-09-09=7900 ft3/s' },
  { src: 'OM-flood', url: 'flood-api.open-meteo.com/v1/flood?daily=river_discharge', http: 200, note: '历史段 200；forecast_days=10 亦 200（前瞻可用），本批未出题（与 USGS 重复，留作后备）' },
  { src: 'NOAA-GML-CO2', url: 'gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.csv', http: 200, note: '新域·环境：纯文本 CSV，列=year,month,day,decimal,co2；测末行 2026,9,11,425.73' },
  { src: 'OM-marine-SST', url: 'marine-api.open-meteo.com/v1/marine?hourly=sea_surface_temperature', http: 200, note: '新域·海温：hourly.time[]/sea_surface_temperature[] 同位；实测北海 192 点，v0=19.7' },
  { src: 'JPL-CAD', url: 'ssd-api.jpl.nasa.gov/cad.api?dist-max=0.05&date-min=&date-max=', http: 200, note: '新域·近地天体：body.data[][3]=cd(接近时刻 2026-Aug-01 19:34)、[4]=dist(AU)；宽区间 2018-01~2026-09 得 count=13335' },
  { src: 'SWPC-kp-1m/3h', url: 'services.swpc.noaa.gov/json/planetary_k_index_1m.json | products/noaa-planetary-k-index.json', http: 200, note: '新源·空间天气：{time_tag,Kp}；但实测 3h 端点仅 58 行(~7 天)、1m 端点 358 行(~6 小时) → 无 ≥30 历史，未出题（记录备查）' },
  { src: 'SWPC-solar-cycle', url: 'services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json', http: 200, note: '新源·天文：3332 行月值 {time-tag,ssn,f10.7}，1749-01 起；实测末行 2026-08 ssn=76 f10.7=116.22。注：products/solar-cycle/... 端点 404，须用 json/ 路径' },
  { src: 'OpenAlex-works', url: 'api.openalex.org/works?filter=from_publication_date:&to_publication_date=&per-page=1', http: 200, note: '新源·科学计量：body.meta.count；实测 2026-09-01~07 = 401220（旧棒 429 系瞬时限速，非源不可用）' },
  { src: 'Crossref-works', url: 'api.crossref.org/works?rows=0&filter=from-created-date:,until-created-date=', http: 200, note: '科学计量二锚：message[total-results]；实测 2026-09-01~07 = 302846（域7 已用，本批未扩量）' },
  { src: 'NVD-CVE', url: 'services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=&pubEndDate=', http: 200, note: '实测 2026-08-01~07 totalResults=1944；无 key 限速 5 req/30s → 扩量成本高，本批未扩' },
  { src: 'MLB-statsapi', url: 'statsapi.mlb.com/api/v1/schedule?sportId=1&date=&hydrate=linescore', http: 200, note: '实测 2026-09-08 games=15 total=130（linescore.teams.{home,away}.runs 求和）；需逐日拉，本批未扩' },
  { src: 'Delphi-fluview', url: 'api.delphi.cmu.edu/epidata/fluview/?regions=&epiweeks=a-b', http: 200, note: '域4 扩量：epiweeks 支持区间；实测 regions=ca&epiweeks=202610-202635 得 26 行，字段 num_ili' },
  { src: 'Delphi-covidcast', url: 'api.delphi.cmu.edu/epidata/covidcast/?data_source=jhu-csse&...', http: 200, note: 'result=-2（参数签名不符，time_values 需配 time_type 且信号名可能已废弃）→ 弃用，改用 fluview 多区域' },
  { src: 'Eurostat-JSONSTAT', url: 'ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{code}?geo=&sinceTimePeriod=', http: 200, note: '★攻下域17：直连 JSON-stat 200，id=[freq,unit,age,sex,geo,time]；time= 可重复或 sinceTimePeriod= 生效；time=a-b 报 400（勿用）。demo_pjan 实测 1990~2025 年值齐' },
  { src: 'DBnomics-search', url: 'api.db.nomics.world/v22/search?q=', http: 0, note: '两次均 fetch aborted（超时）→ 本批不用 DBnomics search；但 series 端点仍可用（BIS 扩币种 200）' },
  { src: 'BoxOfficeMojo-by-year', url: 'boxofficemojo.com/weekend/by-year/{year}/', http: 200, note: '★攻下域19：HTML 但结构稳定，单页含该年全部周末；列=Dates|Top 10 Gross|%± LW|Overall Gross|...；实测 2026W36 Top10=$101,796,782' },
  { src: 'BOM-weekend-detail', url: 'boxofficemojo.com/weekend/2026W36/', http: 200, note: 'weekend 明细页 200（HTML 表 Rank/LW/Release/Gross），可作为逐周备用锚' },
  { src: 'FAA-nasstatus', url: 'nasstatus.faa.gov/api/airport-status-information', http: 200, note: '域2 准点率：XML 200 但为**当前快照**（Update_Time=Sun Sep 13 07:00:38 2026 GMT），无历史、事后不可复核 → 仍判不可用（soa.smext.faa.gov 直连 fetch failed）' },
  { src: 'Energy-Charts-multi', url: 'api.energy-charts.info/public_power?country={fr|nl|es|it|at|be}&start=&end=', http: 200, note: '域15 扩量：FR types=19/768点，NL 14，ES 21（15 分钟粒度）；本批取 4 类×6 国' },
  { src: 'Binance-vision/Kraken', url: 'data-api.binance.vision/api/v3/klines | api.kraken.com/0/public/OHLC', http: 200, note: '域12 扩量：vision 200（DOGE 465 根）；Kraken ADAUSD 200（error=[]）。本批只扩 vision' },
  { src: 'NOAA-COOPS-stations', url: 'api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions', http: 200, note: '域9 扩量：3499 个潮汐站可枚举；本批取 5 站' },
  { src: '航运/港口吞吐', url: '(候选 MarineTraffic / 各港 API)', http: 0, note: '未找到免 key 机检源（MarineTraffic/Baltic/UNCTAD 均需 key 或年粒度）→ 记入放弃清单' },
];
const RESOLVE_CHECK = [];


// ═══ A1. Open-Meteo 空气质量：多城市 × 多污染物 ═══
const AQ_CITIES = [
  { n: '北京', lat: 39.90, lon: 116.41 }, { n: '伦敦', lat: 51.51, lon: -0.13 },
  { n: '巴黎', lat: 48.86, lon: 2.35 }, { n: '东京', lat: 35.68, lon: 139.69 },
  { n: '洛杉矶', lat: 34.05, lon: -118.24 }, { n: '开罗', lat: 30.04, lon: 31.24 },
  { n: '悉尼', lat: -33.87, lon: 151.21 }, { n: '墨西哥城', lat: 19.43, lon: -99.13 },
];
const AQ_VARS = ['pm10', 'pm2_5', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide', 'dust', 'uv_index'];
const AQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const AQ_U = (c, vars, a, b) => AQ_BASE + '?latitude=' + c.lat + '&longitude=' + c.lon + '&hourly=' + vars.join(',') + '&timezone=GMT&start_date=' + a + '&end_date=' + b;
async function aqSeries(c) {
  const j = await jget(AQ_U(c, AQ_VARS, addDays(TODAY, -400), addDays(TODAY, -1)));
  const t = (j.hourly && j.hourly.time) || [];
  const res = {};
  for (const v of AQ_VARS) {
    const arr = (j.hourly && j.hourly[v]) || [];
    const acc = {};
    t.forEach((ts, i) => { const d = ts.slice(0, 10), x = arr[i]; if (x === null || x === undefined || !isFinite(x)) return; (acc[d] = acc[d] || []).push(x); });
    res[v] = Object.keys(acc).sort().map((d) => ({ k: d, v: acc[d].reduce((p, q) => p + q, 0) / acc[d].length }));
  }
  return res;
}
async function buildAQ2() {
  const out = [];
  for (const c of AQ_CITIES) {
    let ser; try { ser = await aqSeries(c); } catch (e) { console.log('[aq2 skip] ' + c.n + ' ' + e.message); continue; }
    for (const v of AQ_VARS) {
      const s = ser[v] || [];
      if (s.length < 200) continue;
      const bk = addDays(TODAY, -45), fw = addDays(TODAY, 3);
      emitSeries({
        series: s, gameType: 'corpus:airqual', layer: 'L3', engine: 'openmeteo_air_' + v + '_baserate', ge: false, minBase: 120,
        bkKeys: [bk], fwKeys: [fw], cut: (k) => bkCut(k),
        stmt: (ph, k, th, cmp) => '【' + ph + '】' + c.n + ' ' + k + ' 日 ' + v + ' 日均浓度 ' + cmp + ' ' + th.toFixed(1) + ' μg/m³'
          + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该日；真值锚=Open-Meteo air-quality hourly.' + v + ' 该日全小时均值。历史回填批次，非实时预测）'
            : '（cutoff=落库时点 ' + RUN_AT + '，该日尚未发生；真值锚=Open-Meteo air-quality hourly.' + v + ' 该日全小时均值。前瞻批次，真值未发生）'),
        note: (ph, n, th, hit, q, _s, cmp) => (ph === 'backfill' ? '回填·' : '前瞻·') + c.n + ' ' + v + '：cutoff 前 ' + n + ' 个日均中 ' + (cmp0(cmp) ? '>=' : '<=')
          + ' ' + th.toFixed(1) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
        resolve: (k, th, cmp) => ({ kind: 'openmeteo_air_daily_mean', url_template: AQ_U(c, [v], '{date}', '{date}'), lat: c.lat, lon: c.lon, date: k, threshold: Number(th.toFixed(2)), cmp: cmp, field: 'hourly.time[] 前缀==date 的全部 hourly.' + v + '[] 算术均值' }),
        meta: (k, th) => ({ city: c.n, pollutant: v, date: k, threshold: Number(th.toFixed(2)) }),
        slug: (k) => c.n + '|' + v + '|' + k,
      }, out);
    }
  }
  return out;
}
// 该源真实比较方向：emitSeries 按 cfg.ge 推出 cmp（'>=' / '<='）。原 function cmp0() { return true; }
// 是恒真桩，把所有 AQ 源（ge=false ⇒ '<='）的注记方向都误印成 '>='（与同函数内的命中率自相矛盾）。
// 修复只影响后续生成的行；既有行文案不动。
function cmp0(cmp) { return cmp === '>='; }

// ═══ A2. Open-Meteo 天气：多城市 × 多变量（ERA5 再分析，滞后约 2 天）═══
const WX_CITIES = [
  { n: '北京', lat: 39.90, lon: 116.41 }, { n: '伦敦', lat: 51.51, lon: -0.13 },
  { n: '巴黎', lat: 48.86, lon: 2.35 }, { n: '东京', lat: 35.68, lon: 139.69 },
  { n: '洛杉矶', lat: 34.05, lon: -118.24 }, { n: '开罗', lat: 30.04, lon: 31.24 },
  { n: '悉尼', lat: -33.87, lon: 151.21 }, { n: '墨西哥城', lat: 19.43, lon: -99.13 },
];
const WX_VARS = [
  { k: 'temperature_2m_max', u: '°C', ge: true }, { k: 'temperature_2m_min', u: '°C', ge: false },
  { k: 'precipitation_hours', u: 'h', ge: true }, { k: 'wind_gusts_10m_max', u: 'km/h', ge: true },
];
const WX_BASE = 'https://archive-api.open-meteo.com/v1/archive';
const WX_U = (c, vars, a, b) => WX_BASE + '?latitude=' + c.lat + '&longitude=' + c.lon + '&daily=' + vars.join(',') + '&timezone=GMT&start_date=' + a + '&end_date=' + b;
async function wxSeries(c) {
  const j = await jget(WX_U(c, WX_VARS.map((x) => x.k), addDays(TODAY, -400), addDays(TODAY, -2)));
  const t = (j.daily && j.daily.time) || [];
  const res = {};
  for (const v of WX_VARS) {
    const arr = (j.daily && j.daily[v.k]) || [];
    res[v.k] = t.map((d, i) => ({ k: d, v: arr[i] })).filter((x) => x.v !== null && x.v !== undefined && isFinite(x.v));
  }
  return res;
}
async function buildWX2() {
  const out = [];
  for (const c of WX_CITIES) {
    let ser; try { ser = await wxSeries(c); } catch (e) { console.log('[wx2 skip] ' + c.n + ' ' + e.message); continue; }
    for (const v of WX_VARS) {
      const s = ser[v.k] || [];
      if (s.length < 200) continue;
      emitSeries({
        series: s, gameType: 'corpus:wxb4', layer: 'L3', engine: 'openmeteo_wx2_' + v.k + '_baserate', ge: v.ge, minBase: 120,
        bkKeys: [addDays(TODAY, -50)], fwKeys: [addDays(TODAY, 4)], cut: (k) => bkCut(k),
        stmt: (ph, k, th, cmp) => '【' + ph + '】' + c.n + ' ' + k + ' 日 ' + v.k + ' ' + cmp + ' ' + th.toFixed(1) + ' ' + v.u
          + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该日；真值锚=Open-Meteo archive daily.' + v.k + '（ERA5）。历史回填批次，非实时预测）'
            : '（cutoff=落库时点 ' + RUN_AT + '，该日尚未发生；真值锚=Open-Meteo archive daily.' + v.k + '。前瞻批次，真值未发生）'),
        note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + c.n + ' ' + v.k + '：cutoff 前 ' + n + ' 个日均中 ' + (v.ge ? '>=' : '<=') + ' ' + th.toFixed(1) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
        resolve: (k, th, cmp) => ({ kind: 'openmeteo_wx_daily', url_template: WX_U(c, [v.k], '{date}', '{date}'), lat: c.lat, lon: c.lon, date: k, threshold: Number(th.toFixed(2)), cmp: cmp, field: 'daily.time[] 中 ==date 者对应的 daily.' + v.k + '[] 值' }),
        meta: (k, th) => ({ city: c.n, variable: v.k, date: k, threshold: Number(th.toFixed(2)) }),
        slug: (k) => c.n + '|' + v.k + '|' + k,
      }, out);
    }
  }
  return out;
}


// ═══ B1. NOAA CO-OPS 潮汐预报：扩站 ═══
const TIDE_ST = [
  [{ id: '8518750', n: '纽约炮台公园' }, { id: '9414290', n: '旧金山金门' }, { id: '9435380', n: '西雅图' }, { id: '8723214', n: '迈阿密弗吉尼亚礁' }, { id: '8665530', n: '查尔斯顿' }],
];
const TIDE_U = (id, a, b) => 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=corpus-b4&begin_date='
  + a.replace(/-/g, '') + '&end_date=' + b.replace(/-/g, '') + '&datum=MSL&station=' + id + '&time_zone=gmt&units=metric&interval=h&format=json';
async function tideSeries(st) {
  const j = await jget(TIDE_U(st.id, addDays(TODAY, -200), addDays(TODAY, 60)));
  const acc = {};
  (j.predictions || []).forEach((p) => { const d = String(p.t).slice(0, 10), v = Number(p.v); if (!isFinite(v)) return; (acc[d] = acc[d] || []).push(v); });
  return Object.keys(acc).sort().map((d) => ({ k: d, v: Math.max.apply(null, acc[d]) }));
}
async function buildTide2() {
  const out = [];
  for (const st of TIDE_ST[0]) {
    let s = []; try { s = await tideSeries(st); } catch (e) { console.log('[tide2 skip] ' + st.n + ' ' + e.message); continue; }
    if (s.length < 60) continue;
    emitSeries({
      series: s, gameType: 'corpus:tide2', layer: 'L2', engine: 'noaa_tide2_daily_high_baserate', ge: true, minBase: 60,
      bkKeys: [addDays(TODAY, -100)], fwKeys: [addDays(TODAY, 5), addDays(TODAY, 20)], cut: (k) => bkCut(k),
      stmt: (ph, k, th, cmp) => '【' + ph + '】NOAA ' + st.n + '（' + st.id + '） ' + k + ' 当日潮位最高小时值 ' + cmp + ' ' + th.toFixed(3) + ' m（MSL）'
        + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该日；真值锚=NOAA CO-OPS predictions。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该日尚未到；潮汐为天文推算，当日即出真值。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + st.n + '：前 ' + n + ' 个日最高潮位中 >= ' + th.toFixed(3) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'noaa_tide_daily_high', url_template: TIDE_U(st.id, '{date}', '{date}'), station: st.id, date: k, threshold: Number(th.toFixed(3)), cmp: cmp, field: 'predictions[].v 在 t 前缀==date 的行上的最大值' }),
      meta: (k, th) => ({ station: st.id, name: st.n, date: k, threshold: Number(th.toFixed(3)) }),
      slug: (k) => st.id + '|' + k,
    }, out);
  }
  return out;
}

// ═══ B2. NCEI GHCN 日最高温：扩站 ═══
const GHCN_ST = [
  { id: 'USW00023174', n: '洛杉矶' }, { id: 'USW00014922', n: '明尼阿波利斯' },
  { id: 'USW00013874', n: '亚特兰大' }, { id: 'USW00024233', n: '西雅图' },
];
const GHCN_U = (id, a, b) => 'https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=' + id
  + '&dataTypes=TMAX&format=json&units=standard&startDate=' + a + '&endDate=' + b;
async function ghcnSeries(st) {
  const j = await jget(GHCN_U(st.id, addDays(TODAY, -400), addDays(TODAY, -2)));
  return (Array.isArray(j) ? j : []).map((r) => ({ k: r.DATE, v: Number(r.TMAX) })).filter((x) => isFinite(x.v));
}
async function buildGhcn2() {
  const out = [];
  for (const st of GHCN_ST) {
    let s = []; try { s = await ghcnSeries(st); } catch (e) { console.log('[ghcn2 skip] ' + st.n + ' ' + e.message); continue; }
    if (s.length < 200) continue;
    emitSeries({
      series: s, gameType: 'corpus:ghcn2', layer: 'L3', engine: 'ghcn2_daily_tmax_baserate', ge: true, minBase: 120,
      bkKeys: [addDays(TODAY, -60)], fwKeys: [addDays(TODAY, 3)], cut: (k) => bkCut(k),
      stmt: (ph, k, th, cmp) => '【' + ph + '】NCEI GHCN ' + st.n + '（' + st.id + '） ' + k + ' 日最高气温 ' + cmp + ' ' + th.toFixed(1) + ' °F'
        + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该日；真值锚=NCEI daily-summaries TMAX（units=standard）。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该日尚未发生；真值锚=NCEI daily-summaries TMAX。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + st.n + ' TMAX：前 ' + n + ' 个日均中 >= ' + th.toFixed(1) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'ghcn_daily_tmax', url_template: GHCN_U(st.id, '{date}', '{date}'), station: st.id, date: k, threshold: Number(th.toFixed(1)), cmp: cmp, field: '返回数组元素 .TMAX（DATE==date）；units=standard' }),
      meta: (k, th) => ({ station: st.id, name: st.n, date: k, threshold: Number(th.toFixed(1)) }),
      slug: (k) => st.id + '|' + k,
    }, out);
  }
  return out;
}

// ═══ B3. Energy-Charts 多国发电结构 ═══
const EC_CTY = [
  { c: 'fr', n: '法国' }, { c: 'nl', n: '荷兰' }, { c: 'es', n: '西班牙' },
  { c: 'it', n: '意大利' }, { c: 'at', n: '奥地利' }, { c: 'be', n: '比利时' },
];
const EC_TYPES = ['Nuclear', 'Solar', 'Wind onshore', 'Fossil gas', 'Load', 'Hydro Run-of-River'];
const EC_U = (c, a, b) => 'https://api.energy-charts.info/public_power?country=' + c + '&start=' + a + '&end=' + b;
async function ecDaily(c) {
  const j = await jget(EC_U(c.c, addDays(TODAY, -200), addDays(TODAY, -1)));
  const ts = j.unix_seconds || [], acc = {};
  (j.production_types || []).forEach((tp) => {
    if (EC_TYPES.indexOf(tp.name) < 0) return;
    const m = {};
    ts.forEach((u, i) => { const d = isoOf(u * 1000), x = tp.data[i]; if (x === null || x === undefined || !isFinite(x)) return; (m[d] = m[d] || []).push(x); });
    acc[tp.name] = Object.keys(m).sort().map((d) => ({ k: d, v: m[d].reduce((p, q) => p + q, 0) / m[d].length }));
  });
  return acc;
}
async function buildEC2() {
  const out = [];
  for (const c of EC_CTY) {
    let acc; try { acc = await ecDaily(c); } catch (e) { console.log('[ec2 skip] ' + c.n + ' ' + e.message); continue; }
    for (const t of Object.keys(acc)) {
      const s = acc[t];
      if (s.length < 100) continue;
      emitSeries({
        series: s, gameType: 'corpus:power2', layer: 'L2', engine: 'energycharts2_' + c.c + '_' + t.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '_baserate', ge: true, minBase: 80,
        bkKeys: [addDays(TODAY, -80)], fwKeys: [addDays(TODAY, 4)], cut: (k) => bkCut(k),
        stmt: (ph, k, th, cmp) => '【' + ph + '】' + c.n + '电网 ' + k + ' 日「' + t + '」发电均值 ' + cmp + ' ' + th.toFixed(0) + ' MW（Energy-Charts）'
          + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该日；真值锚=Energy-Charts public_power 该日 15 分钟值均值。历史回填批次，非实时预测）'
            : '（cutoff=落库时点 ' + RUN_AT + '，该日尚未到；真值锚=Energy-Charts public_power 该日 15 分钟值均值。前瞻批次，真值未发生）'),
        note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + c.n + ' ' + t + '：前 ' + n + ' 个日均中 >= ' + th.toFixed(0) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
        resolve: (k, th, cmp) => ({ kind: 'energycharts_daily_mean', url_template: EC_U(c.c, '{date}', '{date}'), country: c.c, type: t, date: k, threshold: Number(th.toFixed(0)), cmp: cmp, field: 'production_types[] 中 name==' + t + ' 的 .data[] 按 unix_seconds 归入该日的均值（MW）' }),
        meta: (k, th) => ({ country: c.c, type: t, date: k, threshold: Number(th.toFixed(0)) }),
        slug: (k) => c.c + '|' + t + '|' + k,
      }, out);
    }
  }
  return out;
}


// ═══ B4. Binance 加密日线：扩交易对 ═══
const CR2_PAIRS = [
  { sym: 'DOGEUSDT', label: 'DOGE/USDT' }, { sym: 'XRPUSDT', label: 'XRP/USDT' },
  { sym: 'ADAUSDT', label: 'ADA/USDT' }, { sym: 'LTCUSDT', label: 'LTC/USDT' }, { sym: 'BNBUSDT', label: 'BNB/USDT' },
];
const CR2_TMPL = 'https://data-api.binance.vision/api/v3/klines?symbol={symbol}&interval=1d&limit=1000&startTime={start_ms}&endTime={end_ms}';
const cr2U = (sym, ms0, ms1) => 'https://data-api.binance.vision/api/v3/klines?symbol=' + sym + '&interval=1d&limit=1000&startTime=' + ms0 + '&endTime=' + ms1;
async function cr2Daily(sym) {
  const utcToday = new Date().toISOString().slice(0, 10);
  const arr = await jget(cr2U(sym, Date.parse(addDays(utcToday, -500) + 'T00:00:00Z'), Date.parse(utcToday + 'T00:00:00Z') - 1));
  return arr.map((k) => ({ k: isoOf(k[0]), v: Number(k[4]) })).filter((x) => isFinite(x.v) && x.v > 0);
}
async function buildCr2() {
  const out = [];
  for (const p of CR2_PAIRS) {
    let s = []; try { s = await cr2Daily(p.sym); } catch (e) { console.log('[cr2 skip] ' + p.sym + ' ' + e.message); continue; }
    if (s.length < 250) continue;
    emitSeries({
      series: s, gameType: 'corpus:crypto', layer: 'L2', engine: 'binance2_daily_close_baserate', ge: true, minBase: 200,
      bkKeys: [addDays(TODAY, -60)], fwKeys: [addDays(TODAY, 3), addDays(TODAY, 10)], cut: (k) => bkCut(k),
      stmt: (ph, k, th, cmp) => '【' + ph + '】' + p.label + ' ' + k + '（UTC 日）收盘价 ' + cmp + ' ' + th.toFixed(4) + ' USDT'
        + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该 UTC 日；真值锚=Binance klines [4]=close。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该 UTC 日尚未结束；真值锚=Binance klines [4]=close。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + p.label + '：前 ' + n + ' 个日线收盘中 >= ' + th.toFixed(4) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'binance_daily_close', url_template: CR2_TMPL, symbol: p.sym, start_ms: Date.parse(k + 'T00:00:00Z'), end_ms: Date.parse(k + 'T00:00:00Z') + 86399999, date: k, threshold: Number(th.toFixed(4)), cmp: cmp, field: '返回数组[0][4] = close' }),
      meta: (k, th) => ({ symbol: p.sym, date: k, threshold: Number(th.toFixed(4)) }),
      slug: (k) => p.sym + '|' + k,
    }, out);
  }
  return out;
}

// ═══ B5. Wikimedia pageviews：扩词条 ═══
const WIKI2 = ['Climate_change', 'Elon_Musk', 'OpenAI', 'Linux', 'Formula_One', 'World_Cup'];
const wk2U = (art, a, b) => 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/' + art + '/daily/' + a.replace(/-/g, '') + '00/' + b.replace(/-/g, '') + '00';
async function wk2Series(art) {
  const j = await jget(wk2U(art, addDays(TODAY, -400), addDays(TODAY, -2)));
  return (j.items || []).map((it) => ({ k: it.timestamp.slice(0, 4) + '-' + it.timestamp.slice(4, 6) + '-' + it.timestamp.slice(6, 8), v: it.views }));
}
async function buildWiki2() {
  const out = [];
  for (const art of WIKI2) {
    let s = []; try { s = await wk2Series(art); } catch (e) { console.log('[wiki2 skip] ' + art + ' ' + e.message); continue; }
    if (s.length < 200) continue;
    emitSeries({
      series: s, gameType: 'corpus:wikipv', layer: 'L2', engine: 'wikimedia2_pageviews_baserate', ge: true, minBase: 150,
      bkKeys: [addDays(TODAY, -8), addDays(TODAY, -70)], fwKeys: [addDays(TODAY, 3)], cut: (k) => bkCut(k),
      stmt: (ph, k, th, cmp) => '【' + ph + '】en.wikipedia 「' + art + '」 ' + k + ' 页面浏览量 ' + cmp + ' ' + th + ' 次'
        + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该日；真值锚=Wikimedia pageviews API items[].views。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该日尚未发生；真值锚=Wikimedia pageviews API items[].views。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + art + '：前 ' + n + ' 个日浏览量中 >= ' + th + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'wikimedia_pageviews', url_template: wk2U(art, '{date}', '{date}'), article: art, date: k, threshold: th, cmp: cmp, field: "items[] 中 timestamp=='YYYYMMDD00' 者 .views" }),
      meta: (k, th) => ({ article: art, date: k, threshold: th }),
      slug: (k) => art + '|' + k,
    }, out);
  }
  return out;
}

// ═══ B6. npm 周下载：扩包 ═══
const NPM2 = ['next', 'vue', 'lodash', 'axios'];
async function buildNpm2() {
  const out = [];
  for (const pkg of NPM2) {
    let s = []; try {
      const j = await jget('https://api.npmjs.org/downloads/range/' + addDays(TODAY, -220) + ':' + addDays(TODAY, -2) + '/' + pkg);
      s = (j.downloads || []).map((x) => ({ k: x.day, v: x.downloads }));
    } catch (e) { console.log('[npm2 skip] ' + pkg + ' ' + e.message); continue; }
    if (s.length < 180) continue;
    const roll = [];
    for (let i = 6; i < s.length; i++) { let t = 0; for (let q = 0; q < 7; q++) t += s[i - q].v; roll.push({ k: s[i].k, v: t }); }
    emitSeries({
      series: roll, gameType: 'corpus:npmdl', layer: 'L2', engine: 'npm2_downloads_window_baserate', ge: true, minBase: 150,
      bkKeys: [addDays(TODAY, -35), addDays(TODAY, -100)], fwKeys: [addDays(TODAY, 9)], cut: (k) => bkCut(addDays(k, -6)),
      stmt: (ph, k, th, cmp) => '【' + ph + '】npm 包 ' + pkg + ' 在 ' + addDays(k, -6) + '~' + k + ' 的 7 日下载量 ' + cmp + ' ' + th
        + (ph === 'backfill' ? '（cutoff=' + bkCut(addDays(k, -6)) + '，严格早于该窗口；真值锚=npm downloads/range downloads[].downloads 求和。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，窗口尚未开始；真值锚=npm downloads/range。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + pkg + '：前 ' + n + ' 个 7 日滚动窗中 >= ' + th + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'npm_downloads_window', url_template: 'https://api.npmjs.org/downloads/range/{start}:{end}/' + pkg, package: pkg, start: addDays(k, -6), end: k, threshold: th, cmp: cmp, field: 'body.downloads[].downloads 按 .day 落在 [start,end] 求和' }),
      meta: (k, th) => ({ package: pkg, start: addDays(k, -6), end: k, threshold: th }),
      slug: (k) => pkg + '|' + k,
    }, out);
  }
  return out;
}

// ═══ B7. Frankfurter 汇率：扩货币对 ═══
const FX2 = ['GBP', 'AUD', 'CAD', 'CHF'];
async function buildFx2() {
  const out = [];
  for (const q of FX2) {
    let s = []; try {
      const j = await jget('https://api.frankfurter.app/' + addDays(TODAY, -500) + '..' + addDays(TODAY, -3) + '?from=USD&to=' + q);
      const rs = j.rates || {};
      s = Object.keys(rs).sort().map((d) => ({ k: d, v: rs[d][q] })).filter((x) => isFinite(x.v));
    } catch (e) { console.log('[fx2 skip] ' + q + ' ' + e.message); continue; }
    if (s.length < 250) continue;
    emitSeries({
      series: s, gameType: 'corpus:fx', layer: 'L2', engine: 'frankfurter2_fx_baserate', ge: true, minBase: 200,
      bkKeys: [s[s.length - 30].k, s[s.length - 120].k], fwKeys: [addDays(TODAY, 4)], cut: (k) => bkCut(k),
      stmt: (ph, k, th, cmp) => '【' + ph + '】USD/' + q + ' 在 ' + k + ' 的 ECB 参考汇率 ' + cmp + ' ' + th.toFixed(4)
        + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该发布日；真值锚=Frankfurter API rates。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该日尚未到（非发布日顺延）；真值锚=Frankfurter API rates。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q2) => (ph === 'backfill' ? '回填·' : '前瞻·') + 'USD/' + q + '：前 ' + n + ' 个发布日汇率中 >= ' + th.toFixed(4) + ' 占 ' + pct(hit) + '（分位 q=' + q2 + '）',
      resolve: (k, th, cmp) => ({ kind: 'frankfurter_rate_range', url_template: 'https://api.frankfurter.app/{date}..{date_plus7}?from=USD&to=' + q, base: 'USD', quote: q, date: k, date_plus7: addDays(k, 7), threshold: Number(th.toFixed(4)), cmp: cmp, field: 'body.rates 的键中 >= date 的最早一日的 body.rates[D][quote]' }),
      meta: (k, th) => ({ pair: 'USD/' + q, date: k, threshold: Number(th.toFixed(4)) }),
      slug: (k) => q + '|' + k,
    }, out);
  }
  return out;
}

// ═══ B8. DBnomics BIS 有效汇率：扩币种 ═══
const BIS2 = [
  { code: 'D.N.B.GB', label: 'BIS 英镑名义有效汇率' }, { code: 'D.N.B.KR', label: 'BIS 韩元名义有效汇率' },
  { code: 'D.N.B.IN', label: 'BIS 印度卢比名义有效汇率' }, { code: 'D.N.B.BR', label: 'BIS 巴西雷亚尔名义有效汇率' },
];
const bisU = (code) => 'https://api.db.nomics.world/v22/series/BIS/WS_EER/' + code + '?observations=1';
async function bisMonthly2(code) {
  const j = await jget(bisU(code));
  const doc = j.series && j.series.docs && j.series.docs[0];
  if (!doc) return [];
  const acc = {};
  doc.period.forEach((p, i) => { const v = doc.value[i]; if (v === null || v === undefined || !isFinite(v)) return; const m = String(p).slice(0, 7); (acc[m] = acc[m] || []).push(v); });
  return Object.keys(acc).sort().map((m) => ({ k: m, v: acc[m].reduce((x, y) => x + y, 0) / acc[m].length }));
}
async function buildBis2() {
  const out = [];
  for (const s0 of BIS2) {
    let s = []; try { s = await bisMonthly2(s0.code); } catch (e) { console.log('[bis2 skip] ' + s0.code + ' ' + e.message); continue; }
    if (s.length < 80) continue;
    emitSeries({
      series: s, gameType: 'corpus:bis', layer: 'L2', engine: 'bis2_eer_monthly_baserate', ge: true, minBase: 60,
      bkKeys: [s[s.length - 15].k, s[s.length - 26].k], fwKeys: [addMon(TODAY.slice(0, 7), 1), addMon(TODAY.slice(0, 7), 2)], cut: (k) => dayBefore(k + '-01') + 'T23:59:59+08:00',
      stmt: (ph, k, th, cmp) => '【' + ph + '】' + s0.label + '（' + s0.code + '） ' + k + (k.length === 7 ? ' 月' : '') + '均值 ' + cmp + ' ' + th.toFixed(3)
        + (ph === 'backfill' ? '（cutoff=' + dayBefore(k + '-01') + 'T23:59:59+08:00，严格早于该月；真值锚=DBnomics BIS/WS_EER series.docs[0].value 月内均值。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该月尚未发生；BIS 实测发布滞后约 14 个月，resolve 需待观测发布。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + s0.code + '：前 ' + n + ' 个月均值中 >= ' + th.toFixed(3) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'dbnomics_bis_monthly_mean', url_template: bisU(s0.code), series: s0.code, month: k, threshold: Number(th.toFixed(3)), cmp: cmp, field: 'series.docs[0].period[]/value[] 该月内均值' }),
      meta: (k, th) => ({ series: s0.code, month: k, threshold: Number(th.toFixed(3)) }),
      slug: (k) => s0.code + '|' + k,
    }, out);
  }
  return out;
}


// ═══ C0. 纯文本抓取（CSV 等）═══
async function tget(url) {
  if (cache.has('T|' + url)) return cache.get('T|' + url);
  let last = null;
  for (let a = 0; a < 3; a++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TMO);
    try { const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, Accept: '*/*' } }); if (!r.ok) throw new Error('HTTP ' + r.status); const x = await r.text(); cache.set('T|' + url, x); return x; }
    catch (e) { last = e; if (a < 2) await sleep(1200 * (a + 1)); } finally { clearTimeout(t); }
  }
  throw last;
}

// ═══ C1. 河流流量（USGS NWIS 日值，新域：水资源）═══
const RIV = [
  { id: '01646500', n: '波托马克河' }, { id: '09380000', n: '科罗拉多河 Lees Ferry' },
  { id: '08066500', n: '得州 Trinity 河' }, { id: '14105700', n: '哥伦比亚河 The Dalles' },
  { id: '07374000', n: '密西西比河 Baton Rouge' },
];
const rivU = (id, a, b) => 'https://waterservices.usgs.gov/nwis/dv/?format=json&sites=' + id + '&parameterCd=00060&startDT=' + a + '&endDT=' + b;
async function rivSeries(id) {
  const j = await jget(rivU(id, addDays(TODAY, -400), addDays(TODAY, -1)));
  const ts = j.value && j.value.timeSeries && j.value.timeSeries[0];
  if (!ts) return [];
  return (ts.values[0].value || []).map((x) => ({ k: String(x.dateTime).slice(0, 10), v: Number(x.value) })).filter((x) => isFinite(x.v));
}
async function buildRiver() {
  const out = [];
  for (const st of RIV) {
    let s = []; try { s = await rivSeries(st.id); } catch (e) { console.log('[river skip] ' + st.n + ' ' + e.message); continue; }
    if (s.length < 200) continue;
    emitSeries({
      series: s, gameType: 'corpus:river', layer: 'L3', engine: 'usgs_nwis_daily_discharge_baserate', ge: true, minBase: 120,
      bkKeys: [addDays(TODAY, -55)], fwKeys: [addDays(TODAY, 3)], cut: (k) => bkCut(k),
      stmt: (ph, k, th, cmp) => '【' + ph + '】USGS ' + st.n + '（' + st.id + '） ' + k + ' 日流量 ' + cmp + ' ' + th.toFixed(0) + ' ft³/s'
        + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该日；真值锚=USGS NWIS dv 00060。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该日尚未发生；真值锚=USGS NWIS dv 00060。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + st.n + '：前 ' + n + ' 个日流量中 >= ' + th.toFixed(0) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'usgs_nwis_daily_discharge', url_template: rivU(st.id, '{date}', '{date}'), site: st.id, date: k, threshold: Number(th.toFixed(0)), cmp: cmp, field: 'value.timeSeries[0].values[0].value[] 中 dateTime 前缀==date 的 .value（ft³/s）' }),
      meta: (k, th) => ({ site: st.id, name: st.n, date: k, threshold: Number(th.toFixed(0)) }),
      slug: (k) => st.id + '|' + k,
    }, out);
  }
  return out;
}

// ═══ C2. 大气 CO2（NOAA GML 冒纳罗亚日值，新域：环境）═══
const CO2_U = 'https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.csv';
async function co2Series() {
  const txt = await tget(CO2_U);
  const out = [];
  txt.split('\n').forEach((ln) => {
    if (!ln || ln.startsWith('#')) return;
    const c = ln.split(',');
    if (c.length < 5) return;
    const v = Number(c[4]);
    if (!isFinite(v)) return;
    out.push({ k: c[0] + '-' + ('0' + c[1]).slice(-2) + '-' + ('0' + c[2]).slice(-2), v: v });
  });
  return out;
}
async function buildCO2() {
  const out = [];
  let all = []; try { all = await co2Series(); } catch (e) { console.log('[co2 skip] ' + e.message); return out; }
  const s = all.slice(-500);
  if (s.length < 300) return out;
  emitSeries({
    series: s, gameType: 'corpus:co2', layer: 'L3', engine: 'noaa_gml_mlo_co2_daily_baserate', ge: true, minBase: 250,
    bkKeys: [s[s.length - 40].k, s[s.length - 120].k], fwKeys: [addDays(TODAY, 4), addDays(TODAY, 20)], cut: (k) => bkCut(k),
    stmt: (ph, k, th, cmp) => '【' + ph + '】NOAA GML 冒纳罗亚站 ' + k + ' 日 CO2 干空气摩尔分数 ' + cmp + ' ' + th.toFixed(2) + ' ppm'
      + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该日；真值锚=NOAA GML co2_daily_mlo.csv 第 5 列。历史回填批次，非实时预测）'
        : '（cutoff=落库时点 ' + RUN_AT + '，该日尚未发生；真值锚=NOAA GML co2_daily_mlo.csv 第 5 列。前瞻批次，真值未发生）'),
    note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + 'MLO CO2：前 ' + n + ' 个日均中 >= ' + th.toFixed(2) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
    resolve: (k, th, cmp) => ({ kind: 'noaa_gml_co2_daily', url: CO2_U, date: k, threshold: Number(th.toFixed(2)), cmp: cmp, field: 'CSV 中 year,month,day == date 的行第 5 列（ppm）' }),
    meta: (k, th) => ({ station: 'MLO', date: k, threshold: Number(th.toFixed(2)) }),
    slug: (k) => 'MLO|' + k,
  }, out);
  return out;
}

// ═══ C3. 海表温度（Open-Meteo Marine，新域：海温）═══
const SST_PT = [
  { n: '北海', lat: 54.0, lon: 7.0 }, { n: '墨西哥湾', lat: 25.0, lon: -90.0 },
  { n: '日本近海', lat: 35.0, lon: 140.0 }, { n: '加勒比海', lat: 18.0, lon: -65.0 },
];
const sstU = (p, a, b) => 'https://marine-api.open-meteo.com/v1/marine?latitude=' + p.lat + '&longitude=' + p.lon + '&hourly=sea_surface_temperature&timezone=GMT&start_date=' + a + '&end_date=' + b;
async function sstDaily(p) {
  const j = await jget(sstU(p, addDays(TODAY, -400), addDays(TODAY, -1)));
  const t = (j.hourly && j.hourly.time) || [], a = (j.hourly && j.hourly.sea_surface_temperature) || [];
  const acc = {};
  t.forEach((ts, i) => { const d = ts.slice(0, 10), x = a[i]; if (x === null || x === undefined || !isFinite(x)) return; (acc[d] = acc[d] || []).push(x); });
  return Object.keys(acc).sort().map((d) => ({ k: d, v: acc[d].reduce((x, y) => x + y, 0) / acc[d].length }));
}
async function buildSST() {
  const out = [];
  for (const p of SST_PT) {
    let s = []; try { s = await sstDaily(p); } catch (e) { console.log('[sst skip] ' + p.n + ' ' + e.message); continue; }
    if (s.length < 200) continue;
    emitSeries({
      series: s, gameType: 'corpus:sst', layer: 'L3', engine: 'openmeteo_marine_sst_daily_baserate', ge: true, minBase: 120,
      bkKeys: [addDays(TODAY, -35)], fwKeys: [addDays(TODAY, 3)], cut: (k) => bkCut(k),
      stmt: (ph, k, th, cmp) => '【' + ph + '】' + p.n + '（' + p.lat + ',' + p.lon + '） ' + k + ' 日海表温度日均 ' + cmp + ' ' + th.toFixed(2) + ' °C'
        + (ph === 'backfill' ? '（cutoff=' + bkCut(k) + '，严格早于该日；真值锚=Open-Meteo marine hourly.sea_surface_temperature 日均。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该日尚未发生；真值锚=Open-Meteo marine hourly.sea_surface_temperature 日均。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + p.n + '：前 ' + n + ' 个日均中 >= ' + th.toFixed(2) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'openmeteo_marine_sst_daily', url_template: sstU(p, '{date}', '{date}'), lat: p.lat, lon: p.lon, date: k, threshold: Number(th.toFixed(2)), cmp: cmp, field: 'hourly.time[] 前缀==date 的 hourly.sea_surface_temperature[] 算术均值' }),
      meta: (k, th) => ({ point: p.n, date: k, threshold: Number(th.toFixed(2)) }),
      slug: (k) => p.n + '|' + k,
    }, out);
  }
  return out;
}

// ═══ C4. 近地天体接近次数（JPL CNEOS CAD，新域）═══
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const CAD_U = (a, b) => 'https://ssd-api.jpl.nasa.gov/cad.api?dist-max=0.05&date-min=' + a + '&date-max=' + b;
async function cadMonthly() {
  const j = await jget(CAD_U('2018-01-01', TODAY));
  const acc = {};
  (j.data || []).forEach((r) => { const m = String(r[3]).split('-')[1]; const y = String(r[3]).split('-')[0]; const k = y + '-' + ('0' + MON[m]).slice(-2); acc[k] = (acc[k] || 0) + 1; });
  return Object.keys(acc).sort().map((k) => ({ k: k, v: acc[k] }));
}
async function buildNEO() {
  const out = [];
  let s = []; try { s = await cadMonthly(); } catch (e) { console.log('[neo skip] ' + e.message); return out; }
  if (s.length < 60) return out;
  const curM = TODAY.slice(0, 7);
  emitSeries({
    series: s, gameType: 'corpus:neo', layer: 'L3', engine: 'jpl_cad_monthly_close_approaches_baserate', ge: true, minBase: 50,
    bkKeys: [addMon(curM, -3), addMon(curM, -15)], fwKeys: [addMon(curM, 1), addMon(curM, 2)], cut: (k) => dayBefore(k + '-01') + 'T23:59:59+08:00',
    stmt: (ph, k, th, cmp) => '【' + ph + '】JPL CNEOS ' + k + ' 月内近地天体接近事件数（距地 <0.05 AU） ' + cmp + ' ' + th + ' 次'
      + (ph === 'backfill' ? '（cutoff=' + dayBefore(k + '-01') + 'T23:59:59+08:00，严格早于该月；真值锚=JPL CAD API count 按月切分。历史回填批次，非实时预测）'
        : '（cutoff=落库时点 ' + RUN_AT + '，该月尚未发生；真值锚=JPL CAD API 该月 count。前瞻批次，真值未发生）'),
    note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + 'CAD：前 ' + n + ' 个月计数中 >= ' + th + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
    resolve: (k, th, cmp) => ({ kind: 'jpl_cad_monthly_count', url: CAD_U(k + '-01', addDays(k + '-01', 31)), month: k, threshold: th, cmp: cmp, field: 'body.data[][3]（cd，如 2026-Aug-01 19:34）月份解析后 == month 的行数' }),
    meta: (k, th) => ({ month: k, threshold: th }),
    slug: (k) => k,
  }, out);
  return out;
}

// ═══ C5. 空间天气太阳活动月值（NOAA SWPC，新源）═══
const swpcU = 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json';
async function swpcMonthly() {
  const j = await jget(swpcU);
  return (Array.isArray(j) ? j : []).map((r) => ({ k: String(r['time-tag']), ssn: r.ssn, f107: r.f10_7 === undefined ? r['f10.7'] : r.f10_7 })).filter((x) => /^\d{4}-\d{2}$/.test(x.k));
}
async function buildSWPC() {
  const out = [];
  let all = []; try { all = await swpcMonthly(); } catch (e) { console.log('[swpc skip] ' + e.message); return out; }
  const recent = all.filter((x) => x.k >= '1990-01');
  const fwM = [addMon(TODAY.slice(0, 7), 1)];
  for (const v of [{ key: 'ssn', label: '太阳黑子数 SSN', u: '' }, { key: 'f107', label: '10.7cm 射电流量 F10.7', u: 'sfu' }]) {
    const s = recent.filter((x) => isFinite(x[v.key]) && x[v.key] > 0).map((x) => ({ k: x.k, v: Number(x[v.key]) }));
    if (s.length < 120) continue;
    const bk = [s[s.length - 14].k, s[s.length - 30].k];
    emitSeries({
      series: s, gameType: 'corpus:astro2', layer: 'L3', engine: 'swpc_' + v.key + '_monthly_baserate', ge: true, minBase: 100,
      bkKeys: bk, fwKeys: fwM, cut: (k) => dayBefore(k + '-01') + 'T23:59:59+08:00',
      stmt: (ph, k, th, cmp) => '【' + ph + '】NOAA SWPC ' + v.label + ' ' + k + ' 月均值 ' + cmp + ' ' + th.toFixed(1) + ' ' + v.u
        + (ph === 'backfill' ? '（cutoff=' + dayBefore(k + '-01') + 'T23:59:59+08:00，严格早于该月；真值锚=SWPC observed-solar-cycle-indices.json。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该月尚未发生；真值锚=SWPC observed-solar-cycle-indices.json。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + v.key + '：前 ' + n + ' 个月值中 >= ' + th.toFixed(1) + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'swpc_solar_cycle_monthly', url: swpcU, field_name: v.key, month: k, threshold: Number(th.toFixed(1)), cmp: cmp, field: "rows[] 中 'time-tag'==month 的 ." + (v.key === 'ssn' ? 'ssn' : 'f10.7') }),
      meta: (k, th) => ({ variable: v.key, month: k, threshold: Number(th.toFixed(1)) }),
      slug: (k) => v.key + '|' + k,
    }, out);
  }
  return out;
}

// ═══ C6. 科学计量 OpenAlex 周产出（新源；仅 backfill：计数会随后续索引变动）═══
const oaU = (a, b) => 'https://api.openalex.org/works?filter=from_publication_date:' + a + ',to_publication_date:' + b + '&per-page=1&mailto=corpus-b4@example.org';
async function oaWeeks() {
  const res = [];
  for (const back of [45, 90, 150, 220]) {
    const end = addDays(TODAY, -back), start = addDays(end, -6);
    const j = await jget(oaU(start, end));
    const c = j.meta && j.meta.count;
    if (isFinite(c)) res.push({ k: start + '~' + end, v: c, start: start, end: end });
  }
  return res;
}
async function buildOpenAlex() {
  const out = [];
  let ws = []; try { ws = await oaWeeks(); } catch (e) { console.log('[openalex skip] ' + e.message); return out; }
  for (const w of ws) {
    const base = ws.filter((x) => x.k !== w.k).map((x) => x.v).concat(ws.map((x) => x.v));
    const th = quantile(base, 0.5);
    out.push({
      gameType: 'corpus:openalex', layer: 'L2', phase: 'backfill', prob: 0.5,
      engine: 'openalex_weekly_works_baserate', slug: 'openalex|' + w.k,
      statement: '【backfill】OpenAlex ' + w.start + '~' + w.end + ' 一周新收录出版物数 >= ' + th + ' 篇（cutoff=' + bkCut(w.start) + '，严格早于该窗口；真值锚=OpenAlex works meta.count。历史回填批次，非实时预测）',
      baseRateNote: '回填·OpenAlex：用同源 4 个历史窗口的中位阈值（窗口计数随索引回填而变动，故本域只用已稳定的远期窗口，不产前瞻题）',
      resolve: { kind: 'openalex_works_count', url: oaU(w.start, w.end), start: w.start, end: w.end, threshold: th, cmp: '>=', field: 'body.meta.count' },
      truthPreview: '实测 count=' + w.v + ' -> ' + (w.v >= th ? 'true' : 'false'),
      meta: { start: w.start, end: w.end, threshold: th, cutoff: bkCut(w.start), phase: 'backfill', note: 'no-forward' },
    });
  }
  return out;
}


// ═══ C7. Eurostat 人口（直连 JSON-stat；攻 deferred 域17）═══
const ES_POP = [
  { g: 'DE', n: '德国' }, { g: 'FR', n: '法国' }, { g: 'IT', n: '意大利' }, { g: 'ES', n: '西班牙' },
  { g: 'PL', n: '波兰' }, { g: 'NL', n: '荷兰' }, { g: 'SE', n: '瑞典' }, { g: 'RO', n: '罗马尼亚' },
];
const esU = (g) => 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_pjan?geo=' + g + '&age=TOTAL&sex=T&sinceTimePeriod=1990&format=JSON';
function jsYearTotals(j) {
  const id = j.id, sz = j.size, tPos = id.indexOf('time');
  if (!tPos || !j.value) return [];
  const d = j.dimension.time.category.index;
  const yearsArr = new Array(sz[tPos]);
  Object.keys(d).forEach((y) => { yearsArr[d[y]] = y; });
  let total = 1; for (const z of sz) total *= z;
  const sum = {};
  for (let i = 0; i < total; i++) {
    let rem = i, ok = true;
    const pos = new Array(sz.length);
    for (let k = sz.length - 1; k >= 0; k--) { pos[k] = rem % sz[k]; rem = Math.floor(rem / sz[k]); }
    const v = j.value[i];
    if (v === undefined || v === null || !isFinite(v)) continue;
    const y = yearsArr[pos[tPos]];
    if (!y) { ok = false; }
    if (ok) sum[y] = (sum[y] || 0) + v;
  }
  return Object.keys(sum).filter((y) => sum[y] > 0).sort().map((y) => ({ k: y, v: sum[y] }));
}
async function buildEsPop() {
  const out = [];
  for (const c of ES_POP) {
    let s = []; try { s = await jsYearTotals(await jget(esU(c.g))); } catch (e) { console.log('[espop skip] ' + c.g + ' ' + e.message); continue; }
    if (s.length < 30) { console.log('[espop thin] ' + c.g + ' n=' + s.length); continue; }
    emitSeries({
      series: s, gameType: 'corpus:population', layer: 'L2', engine: 'eurostat_demo_pjan_annual_baserate', ge: true, minBase: 28,
      bkKeys: ['2021', '2024'], fwKeys: ['2027'], cut: (k) => (Number(k) - 1) + '-12-31T23:59:59+08:00',
      stmt: (ph, k, th, cmp) => '【' + ph + '】Eurostat ' + c.n + '（' + c.g + '） ' + k + ' 年 1 月 1 日人口 ' + cmp + ' ' + Math.round(th).toLocaleString('en-US') + ' 人'
        + (ph === 'backfill' ? '（cutoff=' + (Number(k) - 1) + '-12-31T23:59:59+08:00，严格早于该年；真值锚=Eurostat demo_pjan（JSON-stat，按 age×sex 求和）。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该年尚未到；真值锚=Eurostat demo_pjan。Eurostat 实测发布滞后约 12 个月，resolve 需待发布。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + c.n + '：前 ' + n + ' 个年度人口中 >= ' + Math.round(th).toLocaleString('en-US') + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'eurostat_demo_pjan_annual', url: esU(c.g), geo: c.g, year: k, threshold: Math.round(th), cmp: cmp, field: 'JSON-stat value（age=TOTAL,sex=T）中该年 1 月 1 日总人口' }),
      meta: (k, th) => ({ geo: c.g, name: c.n, year: k, threshold: Math.round(th) }),
      slug: (k) => c.g + '|' + k,
    }, out);
  }
  return out;
}

// ═══ C8. 票房（Box Office Mojo 年度周末页 HTML 解析；攻 deferred 域19）═══
function isoWeekMon(y, w) {
  const simple = new Date(Date.UTC(y, 0, 1 + (w - 1) * 7));
  const dow = simple.getUTCDay();
  return new Date(simple.getTime() + (dow <= 4 ? 1 - dow : 8 - dow) * 86400000).toISOString().slice(0, 10);
}
function parseBomYear(html, year) {
  const rows = html.split('<tr').slice(1);
  const res = [];
  for (const r of rows) {
    const mw = r.match(/\/weekend\/(\d{4})W(\d{2})\//);
    if (!mw) continue;
    const ds = (r.match(/\$[\d,]+/g) || []).map((x) => Number(x.replace(/[$,]/g, ''))).filter((x) => isFinite(x));
    if (!ds.length) continue;
    res.push({ k: mw[1] + 'W' + mw[2], v: ds[0], all: ds });
  }
  return res;
}
async function bomSeries() {
  let all = [];
  for (const y of ['2024', '2025', '2026']) {
    const html = await tget('https://www.boxofficemojo.com/weekend/by-year/' + y + '/');
    all = all.concat(parseBomYear(html, y));
    await sleep(500);
  }
  const seen = {}, out = [];
  all.forEach((x) => { if (seen[x.k]) return; seen[x.k] = 1; out.push(x); });
  out.sort((a, b) => (a.k < b.k ? -1 : 1));
  return out;
}
async function buildBOM() {
  const out = [];
  let s = []; try { s = await bomSeries(); } catch (e) { console.log('[bom skip] ' + e.message); return out; }
  if (s.length < 60) { console.log('[bom thin] n=' + s.length); return out; }
  console.log('[bom sample] ' + JSON.stringify(s.slice(-3)) + ' first=' + JSON.stringify(s[0]));
  const lastW = s[s.length - 1].k.match(/(\d{4})W(\d{2})/);
  const curW = Number(lastW[2]);
  const fw = [String(Number(lastW[1])) + 'W' + ('0' + (curW + 1)).slice(-2), String(Number(lastW[1])) + 'W' + ('0' + (curW + 4)).slice(-2)];
  const bk = [s[s.length - 6].k, s[s.length - 18].k];
  emitSeries({
    series: s, gameType: 'corpus:boxoffice', layer: 'L2', engine: 'bom_weekend_top10_gross_baserate', ge: true, minBase: 40,
    bkKeys: bk, fwKeys: fw, cut: (k) => { const m = k.match(/(\d{4})W(\d{2})/); return addDays(isoWeekMon(Number(m[1]), Number(m[2])), 3) + 'T23:59:59+08:00'; },
    stmt: (ph, k, th, cmp) => '【' + ph + '】Box Office Mojo 周末榜 ' + k + ' 期 Top 10 总票房 ' + cmp + ' $' + Math.round(th).toLocaleString('en-US')
      + (ph === 'backfill' ? '（cutoff=' + addDays(isoWeekMon(Number(k.slice(0, 4)), Number(k.slice(5))), 3) + 'T23:59:59+08:00，严格早于该周末；真值锚=Box Office Mojo 年度周末页 Top 10 Gross 列。历史回填批次，非实时预测）'
        : '（cutoff=落库时点 ' + RUN_AT + '，该周末尚未到；真值锚=Box Office Mojo 年度周末页 Top 10 Gross 列。前瞻批次，真值未发生）'),
    note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + 'BOM Top10：前 ' + n + ' 个周末中 >= $' + Math.round(th).toLocaleString('en-US') + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
    resolve: (k, th, cmp) => ({ kind: 'bom_weekend_top10_gross', url_template: 'https://www.boxofficemojo.com/weekend/by-year/{year}/', week: k, threshold: Math.round(th), cmp: cmp, field: '页面周末表中该期行的「Top 10 Gross」单元格（首列美元金额）' }),
    meta: (k, th) => ({ week: k, threshold: Math.round(th) }),
    slug: (k) => k,
  }, out);
  return out;
}


// ═══ C9. CDC FluView 多区域流感（Delphi Epidata；域4 扩量）═══
const FLU_REG = [
  { r: 'ca', n: '加州' }, { r: 'ny', n: '纽约州' }, { r: 'tx', n: '得州' }, { r: 'fl', n: '佛州' },
];
const fluU = (r, a, b) => 'https://api.delphi.cmu.edu/epidata/fluview/?regions=' + r + '&epiweeks=' + a + '-' + b;
async function buildFlu2() {
  const out = [];
  for (const rg of FLU_REG) {
    let s = []; try {
      const j = await jget(fluU(rg.r, '202520', '202636'));
      s = (j.epidata || []).map((x) => ({ k: String(x.epiweek), v: Number(x.num_ili) })).filter((x) => isFinite(x.v) && x.v > 0).sort((a, b) => (a.k < b.k ? -1 : 1));
    } catch (e) { console.log('[flu2 skip] ' + rg.r + ' ' + e.message); continue; }
    if (s.length < 50) { console.log('[flu2 thin] ' + rg.r + ' n=' + s.length); continue; }
    emitSeries({
      series: s, gameType: 'corpus:flu2', layer: 'L2', engine: 'delphi_fluview2_ili_baserate', ge: true, minBase: 40,
      bkKeys: [s[s.length - 6].k, s[s.length - 20].k], fwKeys: ['202639', '202641'], cut: (k) => bkCut(addDays(TODAY, 0)),
      stmt: (ph, k, th, cmp) => '【' + ph + '】美国 CDC FluView ' + k + ' 周（MMWR）' + rg.n + ' ILI 就诊量 ' + cmp + ' ' + th + ' 人次'
        + (ph === 'backfill' ? '（cutoff=该周结束后次日（严格早于真值公布日 ' + (k === s[s.length - 6].k ? '滞后约 2 周' : '滞后约 2 周') + '）；真值锚=Delphi Epidata fluview num_ili。历史回填批次，非实时预测）'
          : '（cutoff=落库时点 ' + RUN_AT + '，该周尚未到；真值锚=Delphi Epidata fluview num_ili。前瞻批次，真值未发生）'),
      note: (ph, n, th, hit, q) => (ph === 'backfill' ? '回填·' : '前瞻·') + rg.n + '：前 ' + n + ' 个周 ILI 中 >= ' + th + ' 占 ' + pct(hit) + '（分位 q=' + q + '）',
      resolve: (k, th, cmp) => ({ kind: 'delphi_fluview_ili', url: fluU(rg.r, k, k), region: rg.r, epiweek: k, threshold: th, cmp: cmp, field: 'body.epidata[].num_ili（region==' + rg.r + ' 且 epiweek==' + k + '）' }),
      meta: (k, th) => ({ region: rg.r, name: rg.n, epiweek: k, threshold: th }),
      slug: (k) => rg.r + '|' + k,
    }, out);
  }
  return out;
}

const SRC = {
  aq2: { label: 'Open-Meteo 空气质量 多城市多污染物', gameType: 'corpus:airqual', fn: buildAQ2 },
  wx2: { label: 'Open-Meteo 天气 多城市多变量', gameType: 'corpus:wxb4', fn: buildWX2 },
  tide2: { label: 'NOAA CO-OPS 潮汐 扩站', gameType: 'corpus:tide2', fn: buildTide2 },
  ghcn2: { label: 'NCEI GHCN TMAX 扩站', gameType: 'corpus:ghcn2', fn: buildGhcn2 },
  ec2: { label: 'Energy-Charts 多国发电', gameType: 'corpus:power2', fn: buildEC2 },
  cr2: { label: 'Binance 扩币对', gameType: 'corpus:crypto', fn: buildCr2 },
  wiki2: { label: 'Wikimedia 扩词条', gameType: 'corpus:wikipv', fn: buildWiki2 },
  npm2: { label: 'npm 扩包', gameType: 'corpus:npmdl', fn: buildNpm2 },
  fx2: { label: 'Frankfurter 扩币对', gameType: 'corpus:fx', fn: buildFx2 },
  bis2: { label: 'DBnomics BIS 扩币种', gameType: 'corpus:bis', fn: buildBis2 },
  river: { label: 'USGS NWIS 河流流量', gameType: 'corpus:river', fn: buildRiver },
  co2: { label: 'NOAA GML 大气 CO2', gameType: 'corpus:co2', fn: buildCO2 },
  sst: { label: 'Open-Meteo 海表温度', gameType: 'corpus:sst', fn: buildSST },
  neo: { label: 'JPL CNEOS 近地天体', gameType: 'corpus:neo', fn: buildNEO },
  swpc: { label: 'NOAA SWPC 太阳活动', gameType: 'corpus:astro2', fn: buildSWPC },
  openalex: { label: 'OpenAlex 周产出', gameType: 'corpus:openalex', fn: buildOpenAlex },
  espop: { label: 'Eurostat 人口（域17）', gameType: 'corpus:population', fn: buildEsPop },
  bom: { label: 'Box Office Mojo 票房（域19）', gameType: 'corpus:boxoffice', fn: buildBOM },
  flu2: { label: 'CDC FluView 多区域', gameType: 'corpus:flu2', fn: buildFlu2 },
};

async function main() {
  const keys = ONLY ? [ONLY] : Object.keys(SRC);
  const all = [];
  const report = { run_at: RUN_AT, confirm: CONFIRM, probe: PROBE, resolve_check_evidence: RESOLVE_CHECK, sources: {} };
  for (const k of keys) {
    const cfg = SRC[k];
    if (!cfg) { report.sources[k] = { error: 'unknown source' }; continue; }
    let rows = [];
    try { rows = await cfg.fn(); } catch (e) { rows = []; report.sources[k] = { error: String(e && e.message || e).slice(0, 200) }; console.log('[WARN] ' + k + ' ' + (e && e.message)); }
    const fw = rows.filter((r) => r.phase === 'forward'), bf = rows.filter((r) => r.phase === 'backfill');
    const probs = rows.map((r) => r.prob);
    report.sources[k] = {
      label: cfg.label, game_type: cfg.gameType, total: rows.length, backfill: bf.length, forward: fw.length,
      prob_min: probs.length ? Number(Math.min.apply(null, probs).toFixed(4)) : null,
      prob_max: probs.length ? Number(Math.max.apply(null, probs).toFixed(4)) : null,
      band_ok: probs.every((p) => inBand(p)),
      resolve_missing: rows.filter((r) => !(r.resolve && (r.resolve.url || r.resolve.url_template) && r.resolve.field)).length,
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
  report.slug_dupes = (function () { const s = {}, d = []; all.forEach((r) => { const kk = r.slug || r.statement; if (s[kk]) d.push(kk); s[kk] = 1; }); return d; })();
  console.log('TOTAL=' + report.total + ' backfill=' + report.backfill_total + ' forward=' + report.forward_total + ' bandViolations=' + report.band_violations.length + ' slugDupes=' + report.slug_dupes.length);
  if (CONFIRM) {
    db.init();
    const conn = db.getConnection();
    ensurePredictionsTable(conn);
    const gid = {};
    for (const k of keys) {
      const gt = SRC[k].gameType;
      const row = conn.prepare('SELECT id FROM games WHERE game_type = ? LIMIT 1').get(gt);
      if (row) { gid[gt] = row.id; continue; }
      const g = db.createGame('corpus-' + k + '-b4', gt, 1);
      gid[gt] = g.id;
    }
    let ins = 0, skip = 0, dupe = 0;
    const norm = (x) => String(x).replace(/cutoff=[^）]*/g, 'cutoff=X');
    const existing = new Set();
    conn.prepare('SELECT game_id, statement FROM predictions').all().forEach((x) => existing.add(x.game_id + '||' + norm(x.statement)));
    for (const r of all) {
      if (!inBand(r.prob)) { skip++; continue; }
      const g = gid[r.gameType];
      if (!g) { skip++; continue; }
      if (existing.has(g + '||' + norm(r.statement))) { dupe++; existing.add(g + '||' + norm(r.statement)); continue; }
      try {
        insertPrediction({
          gameId: g, day: null, sourceType: '预测卡', statement: r.statement, prob: r.prob,
          evidence: [{ resolve: r.resolve, baseRateNote: r.baseRateNote, meta: r.meta, slug: r.slug, phase: r.phase, kind: 'b4_' + r.phase }],
          layer: r.layer, engine: r.engine, gate: 'descriptive', checklistHash: 'v2', publicExposure: 0,
        });
        ins++;
      } catch (e) { skip++; console.log('[skip] ' + String(e.message).slice(0, 130)); }
    }
    report.inserted = ins; report.skipped = skip; report.duplicate_skipped = dupe; report.l0Gate_after = l0Gate();
    console.log('inserted=' + ins + ' skipped=' + skip + ' duplicate_skipped=' + dupe);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'sim', 'out', 'corpus-sources-b4.rows.json'), JSON.stringify(all, null, 1), 'utf8');
  const outp = path.join(__dirname, '..', 'sim', 'out', 'corpus-sources-b4.out');
  fs.writeFileSync(outp, JSON.stringify(report, null, 2), 'utf8');
  console.log('report -> ' + outp);
  if (!CONFIRM) console.log('DRY-RUN: 未写库。加 --confirm 执行。');
}
main().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
