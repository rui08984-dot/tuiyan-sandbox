// ==== part p1 ====
'use strict';
// corpus-resolve-daemon.cjs — 到期自动 resolve 调度（2026-09-13 调度棒）
// 用法：node p1b/scripts/corpus-resolve-daemon.cjs --once [--due-only] [--confirm] [--db=<path>]
//      node p1b/scripts/corpus-resolve-daemon.cjs --loop --interval=60 [--due-only] [--confirm] [--db=<path>]
//      --db=<path>：指向副本（safe-mutation「先副本后生产」）；不传=默认生产库，实际路径恒入日志
// 安全四则：①不改 corpus-resolve.cjs（运行时抽取其 RESOLVERS；抽取失败退回 spawn 原脚本）
//          ②网络失败跳过不写 ③账本不可变（resolvePrediction 拒改已 resolve）④默认 dry-run，--confirm 才写库
// 日志：追加 p1b/sim/out/resolve-daemon.log（含时间戳与本轮 resolved/pending/fail 计数）
const fs = require('fs'), path = require('path'), cp = require('child_process');
const args = process.argv.slice(2);
const has = (f) => args.indexOf(f) !== -1;
const val = (f, d) => { const a = args.filter((x) => x.indexOf(f + '=') === 0)[0]; return a ? a.slice(f.length + 1) : d; };
const LOOP = has('--loop');
const CONFIRM = has('--confirm');
const DUE_ONLY = has('--due-only');
const INTERVAL_MIN = Math.max(1, Number(val('--interval', 60)) || 60);
const ROOT = path.join(__dirname, '..', '..');
const LOG = path.join(ROOT, 'p1b', 'sim', 'out', 'resolve-daemon.log');
const RESOLVE_SRC = path.join(__dirname, 'corpus-resolve.cjs');
function ts() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00'; }
function today() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 10); }
function log(line) {
  const l = '[' + ts() + '] ' + line;
  console.log(l);
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, l + '\n', 'utf8'); } catch (e) { console.error('LOG-FAIL ' + e.message); }
}

// ==== part p2 ====

// ── 日历锚：期号→开奖日（cwl 周二/四/日；dlt 周一/三/六）。启动时用官方列表刷新最新期/日 ──
const SSQ_DOW = [0, 2, 4], DLT_DOW = [1, 3, 6];
const CALS = {
  cwl: { latestCode: '2026105', latestDate: '2026-09-10', dows: SSQ_DOW },
  dlt: { latestCode: '26104', latestDate: '2026-09-12', dows: DLT_DOW },
};
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dow(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); }
function nextDraw(iso, dows) { let d = addDays(iso, 1), g = 0; while (dows.indexOf(dow(d)) === -1 && g++ < 10) d = addDays(d, 1); return d; }
/** 从 cal.latestCode/latestDate 按期号节奏推进到 issue，返回开奖日；期号长度不符或回推失败返回 null */
function inferIssue(issue, cal) {
  const target = String(issue);
  let code = String(cal.latestCode), date = cal.latestDate, g = 0;
  if (target.length !== code.length) return null;
  while (Number(code) < Number(target) && g++ < 400) { date = nextDraw(date, cal.dows); code = String(Number(code) + 1); }
  return code === target ? date : null;
}
function monthEndPlusOne(ym) { const y = Number(String(ym).slice(0, 4)), mo = Number(String(ym).slice(5, 7)); return mo === 12 ? (y + 1) + '-01-01' : y + '-' + String(mo + 1).padStart(2, '0') + '-01'; }
/** 到期时间（证据优先、期号推断兜底）；返回 {due, src}，推断不出 due=null/src='undatable' */
function dueOf(e0) {
  const r = (e0 && e0.resolve) || {};
  let m = {}; try { m = JSON.parse(e0.meta || '{}'); } catch (e) { m = {}; }
  const k = String(r.kind || '');
  if (m.expectDate) return { due: m.expectDate, src: 'meta.expectDate' };
  if (m.eventDate) return { due: m.eventDate, src: 'meta.eventDate' };
  if (r.date) return { due: r.date, src: 'resolve.date' };
  if (r.period) return { due: monthEndPlusOne(r.period), src: 'period+1mo' };
  if (r.month) return { due: monthEndPlusOne(r.month), src: 'month+1mo' };
  if (m.expectMonth) return { due: m.expectMonth + '-01', src: 'meta.expectMonth' };
  if (r.week_end && k === 'github_weekly_commits') return { due: addDays(r.week_end, 1), src: 'week_end+1d' };
  if (r.end && k === 'npm_downloads_window') return { due: addDays(r.end, 1), src: 'end+1d' };
  if (k.indexOf('cwl') === 0 && r.issue) return { due: inferIssue(r.issue, CALS.cwl), src: 'infer:ssq' };
  if (k === 'dlt_draw_result' && r.issue) return { due: inferIssue(r.issue, CALS.dlt), src: 'infer:dlt' };
  return { due: null, src: 'undatable' };
}

// ==== part p3 ====

const FETCH_MS = 30000;
const UA_DEFAULT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
let getJson = async function getJson(url, headers) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: Object.assign({ 'User-Agent': UA_DEFAULT, Accept: 'application/json, text/plain, */*' }, headers || {}) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
};
const dateOf = (s) => String(s || '').slice(0, 10);
const isFuture = (d) => !!d && dateOf(d) > today();
function cmpOk(v, cmp, thr) {
  const a = Number(v), b = Number(thr);
  if (!isFinite(a) || !isFinite(b)) return null;
  if (cmp === '>=') return a >= b; if (cmp === '<=') return a <= b;
  if (cmp === '>') return a > b; if (cmp === '<') return a < b;
  return null;
}
// ── 复用现有 resolve 能力：只读抽取 corpus-resolve.cjs 的 RESOLVERS（不改该文件）──
// 注入 __GETJSON_CACHE 钩子：同 URL 在同一轮内只打一次网（cwl/dlt 同题多注、反爬源限速友好）。
let BASE = null, LOAD_MODE = '', ROUND_CACHE = null, roundApiHits = 0;
function cachedGet(url, headers) {
  if (!ROUND_CACHE) return getJson(url, headers);
  const key = url + '|' + JSON.stringify(headers || {});
  if (ROUND_CACHE.has(key)) return ROUND_CACHE.get(key);
  roundApiHits++;
  const p = getJson(url, headers);
  ROUND_CACHE.set(key, p);
  p.catch(() => { if (ROUND_CACHE.get(key) === p) ROUND_CACHE.delete(key); });   // 失败不入缓存，便于重试
  return p;
}
function loadBase() {
  try {
    const src = fs.readFileSync(RESOLVE_SRC, 'utf8');
    const i = src.indexOf('//RESOLVE-B2');   // 锚点：位于 main() 之前，切掉 main 与其 I/O
    if (i < 0) throw new Error('anchor //RESOLVE-B2 missing');
    const mod = { exports: {} };
    let body = src.slice(0, i);
    const hook = 'async function getJson(url, headers) {';
    if (body.indexOf(hook) === -1) throw new Error('getJson definition not found');
    body = body.replace(hook, hook + ' if (typeof __GETJSON_CACHE === "function") { return __GETJSON_CACHE(url, headers); }');
    body += '\nmodule.exports = { RESOLVERS: RESOLVERS, getJson: getJson };';
    new Function('module', 'exports', 'require', '__dirname', '__GETJSON_CACHE', body)(mod, mod.exports, require, __dirname, cachedGet);
    if (!mod.exports.RESOLVERS || typeof mod.exports.getJson !== 'function') throw new Error('extracted shape invalid');
    BASE = mod.exports.RESOLVERS; LOAD_MODE = 'inline-extract(' + Object.keys(BASE).length + ' kinds)';
  } catch (e) { BASE = null; LOAD_MODE = 'spawn-fallback: ' + e.message; }
  return LOAD_MODE;
}

// ==== part p9 ====

// ── 取数稳健层：瞬时失败重试（最终失败仍按现役口径跳过不写，重试只为降噪）──
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = /HTTP (400|403|404|429|5\d\d)|fetch failed|abort|socket hang up|ETIMEDOUT/i;
async function fetchRetry(fn, tries, tag) {
  const n = Math.max(1, tries || 3); let last = null;
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch (e) {
      last = e; const m = String((e && e.message) || '');
      if (i + 1 < n && RETRYABLE.test(m)) { await SLEEP(1000 + i * 2000 + Math.floor(Math.random() * 500)); continue; }
      throw e;
    }
  }
  throw last;
}
/** 并发池：并发数可控，用于对反爬源（cwl/dlt/wikimedia/github/air-quality）限速 */
async function pool(items, limit, fn) {
  const q = items.slice(); const n = Math.max(1, limit || 4);
  await Promise.all(Array.from({ length: n }, async () => { for (;;) { const it = q.shift(); if (!it) return; await fn(it); } }));
}

// ==== part p10 ====

// ── 数据可得性预筛（省 API 调用 + 避免拿 400/404 白打网）──
// 只对「物理上此刻不可能有真值」的情形提前判 pending，判据全部写在注释里，可随源行为调整。
function preScreen(r) {
  const k = String(r.kind || ''), t = today();
  const d10 = (x) => dateOf(x);
  if (k === 'openmeteo_daily_max' || k === 'openmeteo_forecast_daily_max') {
    if (d10(r.date) > addDays(t, 15)) return '事件日 ' + r.date + ' 超出 Open-Meteo 15 日预报窗口（archive 未入库）';
  }
  if (k === 'binance_daily_close') { if (d10(r.date) >= t) return 'UTC 日 ' + r.date + ' 尚未收盘'; }
  if (k === 'wikimedia_pageviews') { if (d10(r.date) >= t) return 'Wikimedia ' + r.date + ' 数据 T+1 才发布'; }
  if (k === 'github_weekly_commits') { if (d10(r.week_end) >= t) return 'GitHub 周 ' + r.week_start + '~' + r.week_end + ' 尚未结束（stats 亦需 T+1）'; }
  if (k === 'frankfurter_rate') { if (d10(r.date) > t) return 'ECB 参考汇率发布日 ' + r.date + ' 未到'; }
  if (k === 'frankfurter_rate_range') { if (d10(r.date_plus7) > t) return 'ECB 发布窗口 ' + r.date + '~' + r.date_plus7 + ' 尚未走完（接口对未来区间 404）'; }
  if (k === 'openmeteo_air_pm10_daily_mean') { if (d10(r.date) >= t) return '空气质量 ' + r.date + ' 小时序列未出齐（需 T+1）'; }
  if (k === 'dbnomics_bis_monthly_mean') { if (String(r.month) >= t.slice(0, 7)) return 'BIS ' + r.month + ' 月值未发布（BIS 滞后约 1 个月，实测最新 2025-07）'; }
  if (k === 'npm_downloads_window') { if (d10(r.end) >= t) return 'npm ' + r.package + ' 窗口 ' + r.start + '~' + r.end + ' 未走完（接口对未来区间 400）'; }
  return null;
}

// ==== part p4a ====

// ── b3 系列真值锚（1/3）：PM10 / Binance / Wikimedia（真值口径对照 corpus-backfill resolve.field）──
const B3 = {
  async openmeteo_air_pm10_daily_mean(r) {
    const u = (r.url_template || '').replace('{date}', r.date).replace('{date}', r.date);
    const j = await fetchRetry(() => cachedGet(u), 3, 'air');
    const t = (j.hourly && j.hourly.time) || [], h = (j.hourly && j.hourly.pm10) || [];
    const vals = [];
    for (let i = 0; i < t.length; i++) { if (String(t[i]).slice(0, 10) !== r.date) continue; const v = Number(h[i]); if (isFinite(v)) vals.push(v); }
    if (vals.length < 12) return { pending: 'Open-Meteo air ' + r.date + ' PM10 小时值不足（' + vals.length + '）' };
    const mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    const ok = cmpOk(mean, r.cmp, r.threshold);
    if (ok === null) return { pending: 'PM10 cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'Open-Meteo air ' + r.date + ' PM10 日均=' + mean + ' μg/m³（阈值 ' + r.cmp + r.threshold + '，n=' + vals.length + ' 小时，机检）' };
  },
  async binance_daily_close(r) {
    let u = r.url_template || 'https://data-api.binance.vision/api/v3/klines?symbol={symbol}&interval=1d&limit=1000&startTime={start_ms}&endTime={end_ms}';
    u = u.replace('{symbol}', r.symbol).replace('{start_ms}', r.start_ms).replace('{end_ms}', r.end_ms);
    const j = await fetchRetry(() => cachedGet(u), 3, 'binance');
    const k = Array.isArray(j) ? j[0] : null;
    if (!k) return { pending: 'Binance ' + r.date + ' 无 K 线（UTC 日尚未收盘）' };
    const close = Number(k[4]), day = dateOf(new Date(Number(k[0])).toISOString());
    if (day !== r.date) return { pending: 'Binance ' + r.symbol + ' 首根 K 线为 ' + day + '，非 ' + r.date + '（该 UTC 日未收盘）' };
    const ok = cmpOk(close, r.cmp, r.threshold);
    if (ok === null) return { pending: 'binance cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'Binance ' + r.symbol + ' ' + r.date + ' close=' + close + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async wikimedia_pageviews(r) {
    // 实测：Wikimedia 只认紧凑 YYYYMMDD，写 ISO 会 400；且该站有 UA 反爬（连续快打会 429）
    const dc = String(r.date).replace(/-/g, '');
    const u = (r.url_template || '').replace('{date}00', dc + '00').replace('{date}', dc);
    const j = await fetchRetry(() => cachedGet(u), 3, 'wikimedia');
    const it = (j.items || []).filter((x) => String(x.timestamp).slice(0, 8) === dc)[0];
    if (!it) return { pending: 'Wikimedia ' + r.article + ' ' + r.date + ' 无页面浏览量记录（该日数据未发布）' };
    const ok = cmpOk(it.views, r.cmp, r.threshold);
    if (ok === null) return { pending: 'wikimedia cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'Wikimedia ' + r.article + ' ' + r.date + ' views=' + it.views + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
};

// ==== part p4b ====

Object.assign(B3, {
  async github_weekly_commits(r) {
    const u = r.url || ('https://api.github.com/repos/' + r.repo + '/stats/commit_activity');
    const j = await fetchRetry(() => cachedGet(u, { 'User-Agent': 'corpus-resolve-daemon', Accept: 'application/vnd.github+json' }), 2, 'github');
    const arr = Array.isArray(j) ? j : null;
    if (!arr || !arr.length) return { pending: 'GitHub ' + r.repo + ' commit_activity 空（API 统计缓存未就绪）' };
    const want = Math.floor(Date.parse(r.week_start + 'T00:00:00Z') / 1000);
    const it = arr.filter((w) => Number(w.week) === want)[0];
    if (!it) {
      const mx = Math.max.apply(null, arr.map((w) => Number(w.week) || 0));
      if (mx < want) return { pending: 'GitHub ' + r.repo + ' 周 ' + r.week_start + ' 统计未就绪（最新周 ' + dateOf(new Date(mx * 1000).toISOString()) + '）' };
      return { pending: 'GitHub ' + r.repo + ' 周 ' + r.week_start + ' 不在 commit_activity 窗口' };
    }
    const ok = cmpOk(it.total, r.cmp, r.threshold);
    if (ok === null) return { pending: 'github cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'GitHub ' + r.repo + ' 周 ' + r.week_start + '~' + r.week_end + ' 提交数=' + it.total + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async frankfurter_rate(r) {
    const u = (r.url_template || 'https://api.frankfurter.app/{date}?from={base}&to={quote}').replace('{date}', r.date).replace('{base}', r.base).replace('{quote}', r.quote);
    const j = await fetchRetry(() => cachedGet(u), 2, 'frankfurter');
    const rate = j && j.rates ? j.rates[r.quote] : null;
    if (rate === null || rate === undefined) return { pending: 'Frankfurter ' + r.base + '/' + r.quote + ' ' + r.date + ' 无参考汇率（非 ECB 发布日/该日未到）' };
    const ok = cmpOk(rate, r.cmp, r.threshold);
    if (ok === null) return { pending: 'frankfurter cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'Frankfurter ECB ' + r.base + '/' + r.quote + ' ' + dateOf(j.date) + '=' + rate + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async frankfurter_rate_range(r) {
    const u = (r.url_template || 'https://api.frankfurter.app/{date}..{date_plus7}?from={base}&to={quote}').replace('{date}', r.date).replace('{date_plus7}', r.date_plus7).replace('{base}', r.base).replace('{quote}', r.quote);
    const j = await fetchRetry(() => cachedGet(u), 2, 'frankfurter');
    const keys = Object.keys((j && j.rates) || {}).filter((d) => d >= r.date && d <= r.date_plus7).sort();
    if (!keys.length) return { pending: 'Frankfurter ' + r.base + '/' + r.quote + ' ' + r.date + '~' + r.date_plus7 + ' 暂无发布日' };
    const d0 = keys[0], rate = j.rates[d0][r.quote];
    if (rate === null || rate === undefined) return { pending: 'Frankfurter ' + r.base + '/' + r.quote + ' ' + d0 + ' 无 ' + r.quote };
    const ok = cmpOk(rate, r.cmp, r.threshold);
    if (ok === null) return { pending: 'frankfurter cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'Frankfurter ECB ' + r.base + '/' + r.quote + ' 当周首个发布日 ' + d0 + '=' + rate + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
});
// ==== part p4c ====

Object.assign(B3, {
  async npm_downloads_window(r) {
    const want = Math.round((Date.parse(r.end + 'T00:00:00Z') - Date.parse(r.start + 'T00:00:00Z')) / 86400000) + 1;
    if (r.end < today()) {
      const u = (r.url_template || 'https://api.npmjs.org/downloads/range/{start}:{end}/{package}').replace('{start}', r.start).replace('{end}', r.end).replace('{package}', r.package);
      const j = await fetchRetry(() => cachedGet(u), 2, 'npm');
      const dl = j && j.downloads;
      if (!Array.isArray(dl)) return { pending: 'npm ' + r.package + ' 无下载数据（' + JSON.stringify(j).slice(0, 120) + '）' };
      const win = dl.filter((d) => d.day >= r.start && d.day <= r.end);
      if (win.length < want) return { pending: 'npm ' + r.package + ' ' + r.start + '~' + r.end + ' 窗口未满（' + win.length + '/' + want + ' 天）' };
      const sum = win.reduce((a, b) => a + Number(b.downloads || 0), 0);
      const ok = cmpOk(sum, r.cmp, r.threshold);
      if (ok === null) return { pending: 'npm cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
      return { outcome: ok ? 'true' : 'false', note: 'npm ' + r.package + ' ' + r.start + '~' + r.end + ' 下载量=' + sum + '（阈值 ' + r.cmp + r.threshold + '，' + want + ' 日满窗，机检）' };
    }
    // 窗口含未来日：npm range 接口对 end>今天 直接 400（实测 error: end date > start date），
    // 只有窗口结束后才可解析，故此处按 pending 跳过，不写库。
    return { pending: 'npm ' + r.package + ' ' + r.start + '~' + r.end + ' 窗口含未来日（接口对未结束窗口返回 400）' };
  },
  async dbnomics_bis_monthly_mean(r) {
    const u = r.url_template || ('https://api.db.nomics.world/v22/series/BIS/WS_EER/' + r.series + '?observations=1');
    const j = await fetchRetry(() => cachedGet(u), 2, 'dbnomics');
    const doc = j && j.series && j.series.docs && j.series.docs[0];
    if (!doc) return { pending: 'DBnomics ' + r.series + ' 序列不存在' };
    const per = doc.period || [], val = doc.value || [];
    const vals = [];
    for (let i = 0; i < per.length; i++) { if (String(per[i]).slice(0, 7) !== r.month) continue; const v = Number(val[i]); if (isFinite(v)) vals.push(v); }
    if (!vals.length) return { pending: 'DBnomics BIS ' + r.series + ' ' + r.month + ' 月值未发布（最新 ' + String(per.slice(-1)[0] || '').slice(0, 10) + '）' };
    const mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000;
    const ok = cmpOk(mean, r.cmp, r.threshold);
    if (ok === null) return { pending: 'BIS cmp/threshold 异常（' + r.cmp + r.threshold + '）' };
    return { outcome: ok ? 'true' : 'false', note: 'DBnomics BIS ' + r.series + ' ' + r.month + ' 月均值=' + mean + '（阈值 ' + r.cmp + r.threshold + '，n=' + vals.length + ' 日值，非数字观测已剔除，机检）' };
  },
});
// ==== part p5 ====

const CWL_PATH = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30';
const DLT_PATH = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=60&isVerify=1&pageNo=1';
async function refreshCals() {
  try {
    const j = await fetchRetry(() => getJson(CWL_PATH), 3, 'cwl');
    const list = (j.result || []).slice().sort((a, b) => Number(b.code) - Number(a.code));
    if (list[0] && list[0].code) { CALS.cwl.latestCode = String(list[0].code); CALS.cwl.latestDate = dateOf(list[0].date); }
  } catch (e) { log('WARN cwl 日历刷新失败（沿用内置锚 ' + CALS.cwl.latestCode + '@' + CALS.cwl.latestDate + '）: ' + e.message); }
  try {
    const j = await fetchRetry(() => getJson(DLT_PATH), 3, 'dlt');
    const list = ((j.value && j.value.list) || []).slice().sort((a, b) => Number(b.lotteryDrawNum) - Number(a.lotteryDrawNum));
    if (list[0] && list[0].lotteryDrawNum) { CALS.dlt.latestCode = String(list[0].lotteryDrawNum); CALS.dlt.latestDate = dateOf(list[0].lotteryDrawTime); }
  } catch (e) { log('WARN dlt 日历刷新失败（沿用内置锚 ' + CALS.dlt.latestCode + '@' + CALS.dlt.latestDate + '）: ' + e.message); }
  log('日历锚刷新：ssq ' + CALS.cwl.latestCode + '@' + CALS.cwl.latestDate + ' | dlt ' + CALS.dlt.latestCode + '@' + CALS.dlt.latestDate);
}
async function evalRow(r) {
  const k = String(r.kind || '');
  const pre = preScreen(r);
  if (pre) return { pending: pre, prescreened: true };
  if (BASE && typeof BASE[k] === 'function') return await BASE[k](r);
  if (typeof B3[k] === 'function') return await B3[k](r);
  return { unsupported: '无对应 resolver（kind=' + k + '，corpus-resolve 与 daemon 均无）' };
}

// ==== part p7 ====

// ── 参数安全门（护栏）：resolve 参数与 resolver 口径不符的题一律跳过不写 ──
// 起因（实测）：corpus-resolve 的 cwl_ssq_red_contains 在 resolve.ball=null 时会把 null 当成
// 『红球不含该号』直接判 false 落库（openmeteo 的 cmp 字段同样被硬编码忽略）。宁可 pending 也不写脏账。
function paramGuard(r) {
  const k = String(r.kind || '');
  const num = (x) => x !== undefined && x !== null && x !== '' && isFinite(Number(x));
  const ok = (allowed) => !r.cmp || allowed.indexOf(r.cmp) !== -1;
  const thr = (f) => (num(r[f]) ? null : f + ' 缺失/非法=' + JSON.stringify(r[f]));
  if (k === 'cwl_ssq_red_contains') return (typeof r.ball === 'string' && /^\d{2}$/.test(r.ball)) ? null : 'cwl_ssq_red_contains 缺合法 ball（实测=' + JSON.stringify(r.ball) + '）';
  if (k === 'cwl_ssq_blue_odd' || k === 'cwl_ssq_blue_odd_forward') return r.ball ? 'cwl_ssq_blue_odd 带多余 ball=' + r.ball : null;
  if (k === 'dbnomics_series_value') { const a = thr('threshold'); if (a) return a; return ok(['<']) ? null : 'cmp=' + r.cmp + ' 与提取器硬编码 < 不符'; }
  if (k === 'openmeteo_daily_max') { const a = thr('threshold_c'); if (a) return a; return ok(['>']) ? null : 'cmp=' + r.cmp + ' 与提取器硬编码 > 不符'; }
  if (k === 'openmeteo_forecast_daily_max') { const a = thr('threshold_c'); if (a) return a; return ok(['>']) ? null : 'cmp=' + r.cmp + ' 与提取器硬编码 > 不符'; }
  if (k === 'dlt_draw_result') {
    const b = r.back_ball !== undefined && r.back_ball !== null, f = r.front_max_ge !== undefined && r.front_max_ge !== null;
    return b === f ? 'dlt_draw_result 需恰好一个 back_ball/front_max_ge（实测 back=' + JSON.stringify(r.back_ball) + ' front=' + JSON.stringify(r.front_max_ge) + '）' : null;
  }
  if (k === 'frankfurter_rate' || k === 'frankfurter_rate_range') { const a = thr('threshold'); if (a) return a; if (!r.base || !r.quote) return 'base/quote 缺失'; return ok(['>=', '<=', '>', '<']) ? null : 'cmp 非法=' + r.cmp; }
  if (B3[k]) { const a = thr('threshold'); if (a) return a; return ok(['>=', '<=', '>', '<']) ? null : 'cmp 非法=' + r.cmp; }
  return null;
}

// ==== part p6a ====

// ── 一轮：查 corpus 未解题 → 到期过滤 → 参数安全门 → 预筛 → 按 resolve 参数去重 ──
const { db } = require('../src/deps');
const { resolvePrediction } = require('../src/db/predictionsStore');
const sigOf = (r) => String(r.kind) + '|' + JSON.stringify(r);
async function roundRun() {
  const t0 = Date.now();
  ROUND_CACHE = new Map(); roundApiHits = 0;   // 每轮独立：同 URL 只打一次网
  const conn = db.getConnection();
  const rows = conn.prepare('SELECT p.id, p.evidence_json FROM predictions p JOIN games g ON g.id = p.game_id WHERE g.game_type LIKE ? AND p.outcome IS NULL ORDER BY p.id').all('corpus%');
  const R = { total: rows.length, due: 0, notdue: 0, undatable: 0, guarded: 0, guardSamples: [], pre: 0, prescreened: 0, resolved: 0, pending: 0, fail: 0, refused: 0, refusedRace: 0, refusedPre: 0, skip: 0, unsupported: 0, unsupportedKinds: {}, failKinds: {}, netCalls: 0, deduped: 0, groups: 0, wouldWrite: 0 };
  const groups = new Map();
  for (const row of rows) {
    let ev = []; try { ev = JSON.parse(row.evidence_json || '[]'); } catch (e) { ev = []; }
    const r = ev[0] && ev[0].resolve;
    if (!r || !r.kind) { R.skip++; log('  skip id=' + row.id + '（无 resolve 参数，不机械回填）'); continue; }
    const d = dueOf(ev[0]);
    if (!d || !d.due) { R.undatable++; continue; }
    if (DUE_ONLY && isFuture(d.due)) { R.notdue++; continue; }
    const bad = paramGuard(r);
    if (bad !== null) { R.guarded++; if (R.guardSamples.length < 6) R.guardSamples.push(bad + ' @id' + row.id); continue; }
    R.due++;
    const s = sigOf(r);
    let g = groups.get(s);
    if (!g) { g = { r: r, due: d.due, src: d.src, ids: [], pre: null }; groups.set(s, g); } else { R.deduped++; }
    g.ids.push(row.id);
  }
  for (const [, g] of groups) { const p = preScreen(g.r); if (p) { g.pre = p; R.pre++; } }
  if (R.guarded) log('参数安全门：跳过 ' + R.guarded + ' 条口径不符题（不写脏账）— ' + R.guardSamples.join(' / '));
  R.groups = groups.size;
  return { R: R, groups: groups, t0: t0 };
}

// ==== part p6b ====

async function execRound(ctx) {
  const { R, groups } = ctx;
  const conn = db.getConnection();
  const SLOW = { wikimedia_pageviews: 1, openmeteo_air_pm10_daily_mean: 1, frankfurter_rate: 1, frankfurter_rate_range: 1, github_weekly_commits: 1, binance_daily_close: 1, dlt_draw_result: 1, cwl_ssq_red_contains: 1, cwl_ssq_blue_odd: 1, cwl_ssq_blue_odd_forward: 1 };
  const fast = [], slow = [];
  for (const [, g] of groups) { if (g.pre) continue; (SLOW[g.r.kind] ? slow : fast).push(g); }
  const doOne = async (g) => { try { g.out = await evalRow(g.r); } catch (e) { g.out = { error: e.message }; } };
  await pool(fast, 6, doOne);
  await pool(slow, 1, async (g) => { await doOne(g); await SLEEP(1500); });
  // 二遍补打：只重试「取数失败」的组（网络偶发），成功/待到期不再打
  const retry = [...groups.values()].filter((g) => !g.pre && g.out && g.out.error && /HTTP (429|5\d\d)|fetch failed|abort/i.test(String(g.out.error)));
  if (retry.length) {
    log('二遍补打 ' + retry.length + ' 组（首遍网络失败，缓 8s 后重试一次）');
    await SLEEP(8000);
    await pool(retry, 2, doOne);
  }
  for (const [, g] of groups) {
    const out = g.out;
    if (g.pre) { R.pending += g.ids.length; R.prescreened += g.ids.length; log('  pending(预筛) kind=' + g.r.kind + ' x' + g.ids.length + ' due=' + g.due + ' — ' + g.pre); continue; }
    if (!out) { R.fail += g.ids.length; log('  no-result kind=' + g.r.kind + ' x' + g.ids.length); continue; }
    if (out.unsupported) { R.unsupported += g.ids.length; const q = 'unsupported:' + g.r.kind; R.unsupportedKinds[q] = (R.unsupportedKinds[q] || 0) + g.ids.length; log('  unsupported kind=' + g.r.kind + ' x' + g.ids.length + ' — ' + out.unsupported); continue; }
    if (out.error) { R.fail += g.ids.length; const q = 'fetch-fail:' + g.r.kind + ':' + out.error; R.failKinds[q] = (R.failKinds[q] || 0) + g.ids.length; log('  fetch-fail kind=' + g.r.kind + ' x' + g.ids.length + ' — ' + out.error + '（跳过不写）'); continue; }
    if (out.pending) { R.pending += g.ids.length; log('  pending kind=' + g.r.kind + ' x' + g.ids.length + ' due=' + g.due + ' — ' + out.pending); continue; }
    if (out.outcome !== 'true' && out.outcome !== 'false') { R.fail += g.ids.length; log('  bad-outcome kind=' + g.r.kind + ' x' + g.ids.length + ' raw=' + JSON.stringify(out).slice(0, 160)); continue; }
    if (!CONFIRM) { R.wouldWrite += g.ids.length; log('  [dry] would resolve kind=' + g.r.kind + ' x' + g.ids.length + ' due=' + g.due + ' -> ' + out.outcome + ' | ' + out.note); continue; }
    for (const id of g.ids) {
      const res = resolvePrediction(id, out.outcome, out.note);
      if (res.ok) { R.resolved++; log('  resolved id=' + id + ' kind=' + g.r.kind + ' -> ' + out.outcome + ' | ' + out.note); continue; }
      const now = conn.prepare('SELECT outcome, resolve_note FROM predictions WHERE id = ?').get(id) || {};
      if (now.outcome === out.outcome) { R.refusedRace++; log('  refused(concurrent) id=' + id + ' ' + res.reason + '｜库中已=' + now.outcome + '，与本轮结论一致'); }
      else { R.refusedPre++; R.refused++; log('  refused(ledger-immutable) id=' + id + ' ' + res.reason + '｜库中=' + now.outcome + '（' + String(now.resolve_note || '').slice(0, 60) + '），本轮算出=' + out.outcome + ' → 不改，仅记差异'); }
    }
  }
}

// ==== part p8a ====

// ── 到期时间分布报表（按天 + 按月）──
function distribute() {
  const conn = db.getConnection();
  const rows = conn.prepare('SELECT p.id, p.evidence_json FROM predictions p JOIN games g ON g.id = p.game_id WHERE g.game_type LIKE ? AND p.outcome IS NULL ORDER BY p.id').all('corpus%');
  const byDay = {}, byMonth = {}, bySrc = {}, byKind = {};
  let undatable = 0; const undKinds = {};
  for (const row of rows) {
    let ev = []; try { ev = JSON.parse(row.evidence_json || '[]'); } catch (e) { ev = []; }
    const e0 = ev[0] || {}, r = e0.resolve || {};
    const d = dueOf(e0);
    if (!d || !d.due) { undatable++; undKinds[String(r.kind)] = (undKinds[String(r.kind)] || 0) + 1; continue; }
    byDay[d.due] = (byDay[d.due] || 0) + 1;
    byMonth[d.due.slice(0, 7)] = (byMonth[d.due.slice(0, 7)] || 0) + 1;
    bySrc[d.src] = (bySrc[d.src] || 0) + 1;
    byKind[String(r.kind)] = (byKind[String(r.kind)] || 0) + 1;
  }
  return { rows: rows.length, byDay: byDay, byMonth: byMonth, bySrc: bySrc, byKind: byKind, undatable: undatable, undKinds: undKinds };
}

// ==== part p8b ====

// ── CLI 子命令：--report-due（只读，打印到期分布并落盘 JSON）──
async function reportDue() {
  const d = distribute();
  console.log('未解题总数=' + d.rows + '（可定到期 ' + (d.rows - d.undatable) + ' / 无法定到期 ' + d.undatable + '）');
  console.log('\n[按日]');
  Object.keys(d.byDay).sort().forEach((k) => console.log('  ' + k + '  ' + String(d.byDay[k]).padStart(3) + ' 条'));
  console.log('\n[按月]');
  Object.keys(d.byMonth).sort().forEach((k) => console.log('  ' + k + '  ' + String(d.byMonth[k]).padStart(3) + ' 条'));
  console.log('\n[到期日来源] ' + JSON.stringify(d.bySrc));
  console.log('[按 kind] ' + JSON.stringify(d.byKind));
  console.log('[无法定到期] ' + d.undatable + ' ' + JSON.stringify(d.undKinds));
  const p = path.join(ROOT, 'p1b', 'sim', 'out', 'resolve-daemon.due.json');
  fs.writeFileSync(p, JSON.stringify({ generated_at: ts(), today: today(), ...d }, null, 1), 'utf8');
  console.log('\n已落盘 ' + p);
}

// ==== part p6c ====

async function main() {
  // ★ 2026-09-17 加：`--db=<path>` 指向副本（safe-mutation 第 2 步「先副本后生产」的硬需求；
  //   旧版无此参数 ⇒ 「副本演练」计划落空、`--confirm` 直接打在生产（留痕已记教训）。
  //   不传 ⇒ 默认生产库；**无论如何都把实际库路径打出来**（防静默打生产）。
  // ★★ 2026-09-17 事故与更正（如实）：首版写 `val('db', null)` ⇒ **永不匹配**（本文件的 val() 约定是
  //   **字段名含 '--'**，照 `val('--interval', 60)`）⇒ `--db=<副本>` 被静默忽略、183 行 resolved 打进了生产库
  //   （副本演练计划落空）。已改为 `val('--db', null)`，并以「日志打印实际库路径」＋真跑副本核验。
  const DB_ARG = val('--db', null);
  // ★★ 加固（防「参数被静默忽略 ⇒ 误打生产」再现）：命令行里出现了 --db 形式却解析不出路径 ⇒ **硬失败**。
  if (DB_ARG === null && args.some((x) => x.indexOf('--db') === 0)) {
    console.error('!! 检测到 --db 形式参数但未能解析（本脚本约定：`--db=<path>`，等号形式）⇒ 硬失败，绝不静默落默认库');
    console.error('   args=' + JSON.stringify(args));
    process.exit(2);
  }
  const initDb = () => { db.init(DB_ARG === null ? undefined : DB_ARG); log('db=' + (DB_ARG || db.DEFAULT_DB_PATH)); };
  if (args.indexOf('--report-due') !== -1) { initDb(); return await reportDue(); }
  log('=== corpus-resolve-daemon start | mode=' + (LOOP ? 'loop' : 'once') + ' interval=' + INTERVAL_MIN + 'min due-only=' + DUE_ONLY + ' confirm=' + CONFIRM + (CONFIRM ? '' : '（DRY-RUN，不写库）'));
  const lm = loadBase();
  if (!BASE) log('WARN 未能内联复用 corpus-resolve 的 RESOLVERS（' + lm + '）：仅 daemon 内置的 b3 系列 kind 可解，其余记 unsupported');
  else log('复用 corpus-resolve RESOLVERS 成功：' + lm);
  initDb();
  await refreshCals();
  let n = 0;
  for (;;) {
    n++;
    const ctx = await roundRun();
    await execRound(ctx);
    const R = ctx.R; R.netCalls = roundApiHits;
    log('round#' + n + ' 用时 ' + ((Date.now() - ctx.t0) / 1000).toFixed(1) + 's | 未解总数=' + R.total + ' 到期选中=' + R.due + ' 唯一真值请求=' + R.groups + '（台账重复合并 ' + R.deduped + '） | resolved=' + R.resolved + ' pending=' + R.pending + '（含预筛 ' + R.prescreened + '） fail=' + R.fail + ' refused=' + R.refused + '／同结论并发=' + R.refusedRace + ' 口径护栏=' + R.guarded + ' unsupported=' + R.unsupported + ' 未到期跳过=' + R.notdue + ' 无法定到期=' + R.undatable + ' wouldWrite=' + R.wouldWrite + ' 实打网=' + R.netCalls);
    if (Object.keys(R.unsupportedKinds).length) log('  unsupported 明细 ' + JSON.stringify(R.unsupportedKinds));
    if (Object.keys(R.failKinds).length) log('  取数失败明细 ' + JSON.stringify(R.failKinds));
    if (!LOOP) break;
    log('sleep ' + INTERVAL_MIN + ' 分钟 ...');
    await new Promise((r) => setTimeout(r, INTERVAL_MIN * 60000));
  }
}
main().catch((e) => { log('FATAL ' + ((e && e.stack) ? e.stack : (e && e.message))); process.exit(1); });

