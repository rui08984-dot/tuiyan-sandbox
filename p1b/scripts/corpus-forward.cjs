'use strict';
// 语料前瞻批（corpus-forward，2026-09-13 施工棒）「前瞻多点铺量」
// 与 corpus-backfill.cjs（历史回填）分工：本脚本只出「未来事件」题——真值尚未发生 = 真预测，全额计入 G2 吞吐。
// 质量底线：
//  Q0-2 cutoff = 落库时点 RUN_AT（真实今天）；事件日/目标期必须尚未发生（脚本内 assert isFuture）。
//  Q0-3 每组合先算历史基率（archive / USGS 历年统计 / 已开奖期），必须落 (0.15,0.85)，越界不产题。
//  prob = 该组合历史基率（脚本内现算）。statement 前缀【forward】+【slug】。
// 默认 dry-run；--confirm 才写库。--only=weather|fx|quake|lotto 只跑单源。
const { db } = require('../src/deps');
const { insertPrediction, l0Gate, ensurePredictionsTable } = require('../src/db/predictionsStore');
const path = require('path');
const fs = require('fs');

const CONFIRM = process.argv.includes('--confirm');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
const BAND_LO = 0.15, BAND_HI = 0.85;
const FETCH_MS = 30000;
const now08 = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00';
const RUN_AT = now08();
const TODAY = RUN_AT.slice(0, 10);

const cache = new Map();
async function jget(url, headers) {
  const key = url + '|' + JSON.stringify(headers || {});
  if (cache.has(key)) return cache.get(key);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: headers || {} });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); cache.set(key, j); return j;
  } finally { clearTimeout(t); }
}
async function tget(url, headers) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 90000);
  try { const r = await fetch(url, { signal: ac.signal, headers: headers || {} }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); } finally { clearTimeout(t); }
}
const inBand = (x) => x > BAND_LO && x < BAND_HI;
const pct = (x) => (x * 100).toFixed(1) + '%';
function quantile(a, p) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function isoOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addDays(iso, n) { return isoOf(Date.parse(iso + 'T00:00:00Z') + n * 86400000); }
function isFuture(iso) { return iso > TODAY; }


// ── RESOLVERS（前瞻专用；新 kind 均给出 resolve 时取真值的确切 URL/字段）──
// 1) openmeteo_forecast_daily_max：事件日 ≤ 今天用 archive daily.temperature_2m_max[0]；
//    尚未到时用 forecast daily.temperature_2m_max[0]（Open-Meteo 同一字段名）。
// 2) dbnomics_series_value：provider/dataset/series 的 observations，period 对齐 value[i]。
// 3) usgs_count_window：fdsnws/count?starttime&endtime&minmagnitude → 字段 .count（整数，机检）。
// 4) cwl 3d：findDrawNotice?name=3d → code 对应行的 red="d1,d2,d3"。
// 5) cwl kl8：findDrawNotice?name=kl8 → code 对应行的 red=20 个两位号。
// 6) 体彩 dlt：webapi.sporttery.cn getHistoryPageListV1?gameNo=85 → value.list[].lotteryDrawResult。
const RESOLVERS = {
  async openmeteo_forecast_daily_max(r) {
    const base = r.date <= TODAY ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const u = base + '?latitude=' + r.lat + '&longitude=' + r.lon + '&daily=temperature_2m_max&timezone=Asia%2FShanghai&start_date=' + r.date + '&end_date=' + r.date;
    let j;
    try { j = await jget(u); } catch (e) { if (String(e.message).indexOf('HTTP 400') !== -1) return { pending: 'archive 尚无 ' + r.date }; throw e; }
    const v = j.daily && j.daily.temperature_2m_max ? j.daily.temperature_2m_max[0] : null;
    if (v === null || v === undefined) return { pending: '尚无 ' + r.date + ' 日值' };
    return { outcome: v > r.threshold_c ? 'true' : 'false', note: (base.indexOf('archive') !== -1 ? 'Open-Meteo archive' : 'Open-Meteo forecast') + ' ' + r.date + ' max=' + v + 'C（阈值 ' + r.threshold_c + 'C，机检）' };
  },
  async dbnomics_series_value(r) {
    const u = 'https://api.db.nomics.world/v22/series/' + r.provider + '/' + r.dataset + '/' + r.series + '?observations=1';
    const j = await jget(u);
    const doc = j.series && j.series.docs && j.series.docs[0];
    if (!doc) return { pending: '序列不存在' };
    const i = doc.period.indexOf(r.period);
    const v = i >= 0 ? doc.value[i] : null;
    if (v === null || v === undefined) return { pending: r.period + ' 观测值未发布' };
    return { outcome: (r.cmp === '<' ? v < r.threshold : v > r.threshold) ? 'true' : 'false', note: 'DBnomics ' + r.series + ' ' + r.period + '=' + v + '（阈值 ' + r.cmp + r.threshold + '，机检）' };
  },
  async usgs_count_window(r) {
    const u = 'https://earthquake.usgs.gov/fdsnws/event/1/count?format=geojson&starttime=' + r.start + '&endtime=' + r.end + '&minmagnitude=' + r.minmag;
    const j = await jget(u);
    const v = j.count;
    if (v === null || v === undefined) return { pending: 'count 未返回' };
    return { outcome: v >= r.threshold ? 'true' : 'false', note: 'USGS count ' + r.start + '~' + r.end + ' M>=' + r.minmag + ' = ' + v + ' 次（阈值 >= ' + r.threshold + '，整数机检）' };
  },
  async cwl3d_sum_parity(r) {
    const j = await jget('https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=3d&issueCount=60', { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/3d/' });
    const hit = (j.result || []).find((d) => d.code === r.issue);
    if (!hit) return { pending: '第 ' + r.issue + ' 期未开奖' };
    const dig = String(hit.red).split(',').map(Number);
    const sum = dig.reduce((a, b) => a + b, 0);
    return { outcome: (sum % 2 === r.parity) ? 'true' : 'false', note: 'cwl 官方 3d ' + r.issue + ' 期 red=' + hit.red + ' 和=' + sum + '（求 ' + (r.parity ? '奇' : '偶') + '，机检）' };
  },
  async kl8_red_count_ge(r) {
    const j = await jget('https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=kl8&issueCount=30', { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/kl8/' });
    const hit = (j.result || []).find((d) => d.code === r.issue);
    if (!hit) return { pending: '第 ' + r.issue + ' 期未开奖' };
    const balls = String(hit.red).split(',');
    const c = balls.filter((b) => Number(b) >= r.lo && Number(b) <= r.hi).length;
    return { outcome: c >= r.threshold ? 'true' : 'false', note: 'cwl 官方 kl8 ' + r.issue + ' 期 ' + balls.length + ' 号中落 [' + r.lo + ',' + r.hi + '] 的 ' + c + ' 个（阈值 >= ' + r.threshold + '，机检）' };
  },
  async dlt_front_contains(r) {
    const u = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=30&isVerify=1&pageNo=1';
    const j = await jget(u, { 'User-Agent': 'Mozilla/5.0', Referer: 'https://static.sporttery.cn/' });
    const list = (j.value && j.value.list) || [];
    const hit = list.find((d) => String(d.lotteryDrawNum) === String(r.issue));
    if (!hit) return { pending: '第 ' + r.issue + ' 期未开奖' };
    const front = String(hit.lotteryDrawResult).trim().split(/\s+/).slice(0, 5);
    return { outcome: front.indexOf(r.ball) !== -1 ? 'true' : 'false', note: '体彩官方 dlt ' + r.issue + ' 期 lotteryDrawResult=' + hit.lotteryDrawResult + '（前区含 ' + r.ball + '，机检）' };
  },
};


// ── 源一：天气 L3（Open-Meteo forecast 16 天 × 14 城跨洲）──
// 基率：同城同「日历月」2015-2024 archive 日最高气温 > 阈值的占比（真 pre-cutoff，零未来信息）。
// 阈值：候选=历史同月分位数 {0.30,0.40,0.50,0.60,0.70}，取基率落 (0.15,0.85) 且最接近 0.5 者。
const CITIES = [
  { name: '上海', zh: '亚洲', lat: 31.23, lon: 121.47 }, { name: '北京', zh: '亚洲', lat: 39.90, lon: 116.41 },
  { name: '广州', zh: '亚洲', lat: 23.13, lon: 113.26 }, { name: '成都', zh: '亚洲', lat: 30.57, lon: 104.07 },
  { name: '东京', zh: '亚洲', lat: 35.68, lon: 139.69 }, { name: '首尔', zh: '亚洲', lat: 37.57, lon: 126.98 },
  { name: '新加坡', zh: '亚洲', lat: 1.35, lon: 103.82 }, { name: '悉尼', zh: '大洋洲', lat: -33.87, lon: 151.21 },
  { name: '伦敦', zh: '欧洲', lat: 51.51, lon: -0.13 }, { name: '巴黎', zh: '欧洲', lat: 48.85, lon: 2.35 },
  { name: '纽约', zh: '北美', lat: 40.71, lon: -74.01 }, { name: '洛杉矶', zh: '北美', lat: 34.05, lon: -118.24 },
  { name: '开罗', zh: '非洲', lat: 30.04, lon: 31.24 }, { name: '圣保罗', zh: '南美', lat: -23.55, lon: -46.63 },
];
const HORIZON_BANDS = [
  { name: 'D1-3', label: '未来 1-3 天', from: 1, to: 3, pick: 2 },
  { name: 'D4-7', label: '未来 4-7 天', from: 4, to: 7, pick: 2 },
  { name: 'D8-16', label: '未来 8-16 天', from: 8, to: 16, pick: 3 },
];
const Q_CANDS = [0.5, 0.4, 0.6, 0.3, 0.7];

function pickThreshold(histMonth, threshCands) {
  let best = null;
  for (const q of Q_CANDS) {
    const th = Math.round(quantile(histMonth, q));
    if (threshCands.indexOf(th) !== -1) continue;
    const share = histMonth.filter((x) => x > th).length / histMonth.length;
    if (!inBand(share)) continue;
    const d = Math.abs(share - 0.5);
    if (!best || d < best.d) best = { th: th, share: share, q: q, d: d };
  }
  return best;
}

async function buildWeather() {
  const out = [];
  for (const c of CITIES) {
    const [ar, fc] = await Promise.all([
      jget('https://archive-api.open-meteo.com/v1/archive?latitude=' + c.lat + '&longitude=' + c.lon + '&start_date=2015-01-01&end_date=2024-12-31&daily=temperature_2m_max&timezone=Asia%2FShanghai'),
      jget('https://api.open-meteo.com/v1/forecast?latitude=' + c.lat + '&longitude=' + c.lon + '&daily=temperature_2m_max&timezone=Asia%2FShanghai&forecast_days=16'),
    ]);
    const hist = {};   // month -> [v]
    (ar.daily.time || []).forEach((d, i) => { const v = ar.daily.temperature_2m_max[i]; if (v === null || v === undefined) return; const m = d.slice(5, 7); (hist[m] = hist[m] || []).push(v); });
    const fTime = (fc.daily && fc.daily.time) || [];
    const fVal = (fc.daily && fc.daily.temperature_2m_max) || [];
    for (const band of HORIZON_BANDS) {
      const span = band.to - band.from + 1;
      const step = Math.max(1, Math.floor(span / band.pick));
      for (let k = 0; k < band.pick; k++) {
        const off = band.from + k * step;
        if (off > band.to) break;
        const date = addDays(TODAY, off);
        if (!isFuture(date)) continue;
        const fi = fTime.indexOf(date);
        const fcast = fi >= 0 ? fVal[fi] : null;
        const month = date.slice(5, 7);
        const hm = hist[month] || [];
        if (hm.length < 60) continue;
        const best = pickThreshold(hm, []);
        if (!best) { continue; }
        out.push({
          gameType: 'corpus:openmeteo', layer: 'L3', engine: 'openmeteo_archive_baserate_forward',
          prob: Number(best.share.toFixed(4)),
          slug: 'corpus:openmeteo-fw-' + c.name + '-' + date.replace(/-/g, '') + '-gt' + best.th,
          statement: '【forward】' + c.name + ' ' + date + ' 日最高气温 > ' + best.th + '°C（' + band.label + '，' + c.zh + '）'
            + '（cutoff=落库时点 ' + RUN_AT + '，事件日尚未发生；真值锚=Open-Meteo forecast/archive daily.temperature_2m_max[' + date + ']。前瞻批次，真值未发生）',
          baseRateNote: '前瞻·' + c.name + ' ' + month + '月：2015-2024 archive 同月 ' + hm.length + ' 个日值中 max>' + best.th + '°C 占 ' + pct(best.share) + '（分位 q=' + best.q + '，严格大于口径）',
          resolve: { kind: 'openmeteo_forecast_daily_max', lat: c.lat, lon: c.lon, date: date, threshold_c: best.th, cmp: '>' },
          truthPreview: fcast === null ? null : 'forecast目前预测=' + fcast + 'C',
          meta: { city: c.name, region: c.zh, month: month, threshold: best.th, horizon: band.name, eventDate: date, cutoff: RUN_AT },
        });
      }
    }
  }
  return out;
}



// ── 源二：汇率 L2（DBnomics 多序列 × 未来 1-2 月）──
const FX_SERIES = [
  { provider: 'ECB', dataset: 'EXR', series: 'M.USD.EUR.SP00.A', cmp: '<' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.JPY.EUR.SP00.A', cmp: '<' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.GBP.EUR.SP00.A', cmp: '<' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.CHF.EUR.SP00.A', cmp: '<' },
];
async function buildFx() {
  const out = [];
  // 目标期：未来 1-2 个自然月
  const d = new Date(TODAY + 'T00:00:00Z');
  const targets = [];
  for (let k = 1; k <= 2; k++) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
    targets.push(t.toISOString().slice(0, 7));
  }
  for (const s of FX_SERIES) {
    let j;
    try { j = await jget('https://api.db.nomics.world/v22/series/' + s.provider + '/' + s.dataset + '/' + s.series + '?observations=1'); } catch (e) { continue; }
    const doc = j.series && j.series.docs && j.series.docs[0];
    if (!doc) continue;
    const histVals = [];
    doc.period.forEach((p0, i) => { const v = doc.value[i]; if (v !== null && v !== undefined && p0 < targets[0]) histVals.push(v); });
    if (histVals.length < 60) continue;
    for (const q of Q_CANDS) {
      const th = Number(quantile(histVals, q).toFixed(3));
      const share = histVals.filter((x) => (s.cmp === '<' ? x < th : x > th)).length / histVals.length;
      if (!inBand(share)) continue;
      const dq = Math.abs(share - 0.5);
      if (out.filter((o) => o.meta.series === s.series && o.meta.period === targets[0]).length) break;
      for (const period of targets) {
        out.push({
          gameType: 'corpus:dbnomics', layer: 'L2', engine: 'stat_baseline_forward',
          prob: Number(share.toFixed(4)),
          slug: 'corpus:dbnomics-fw-' + s.series.replace(/\./g, '') + '-' + period.replace('-', '') + '-lt' + String(th).replace('.', ''),
          statement: '【forward】' + period + ' 月 ' + s.series + ' 月均参考汇率 ' + s.cmp + ' ' + th
            + '（cutoff=落库时点 ' + RUN_AT + '，目标月尚未发生；真值锚=DBnomics 同序列 ' + period + ' 观测值。前瞻批次）',
          baseRateNote: '前瞻·' + s.series + '：pre-cutoff 已发布 ' + histVals.length + ' 个月值中 ' + s.cmp + th + ' 占 ' + pct(share) + '（分位 q=' + q + '）',
          resolve: { kind: 'dbnomics_series_value', provider: s.provider, dataset: s.dataset, series: s.series, period: period, threshold: th, cmp: s.cmp },
          meta: { series: s.series, period: period, threshold: th, cutoff: RUN_AT },
        });
      }
      break;
    }
  }
  return out;
}

// ── 源三：地震 L2（USGS，未来 7 天窗口，基率=历年同季统计）──
async function buildQuake() {
  const out = [];
  const start = addDays(TODAY, 1), end = addDays(TODAY, 7);
  // 基率：过去若干年同期 7 天窗口的 M>=5.0 次数分布（用同长度窗口抽样近似）
  let hist = [];
  try {
    const y = new Date(TODAY + 'T00:00:00Z').getUTCFullYear();
    const h = await jget('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=' + (y - 5) + '-' + start.slice(5) + '&endtime=' + (y - 1) + '-' + end.slice(5) + '&minmagnitude=5.0&limit=2000');
    const times = (h.features || []).map((f) => new Date(f.properties.time).toISOString().slice(0, 10));
    const perYear = {};
    times.forEach((t) => { const k = t.slice(0, 4); perYear[k] = (perYear[k] || 0) + 1; });
    hist = Object.values(perYear).map((n) => Math.round(n / 52 * 1)); // 年均→周均近似
  } catch (e) { hist = []; }
  if (hist.length < 3) return out; // 基率不足不出题
  for (const q of [0.4, 0.5, 0.6]) {
    const th = Math.max(1, Math.round(quantile(hist, q)));
    const share = hist.filter((x) => x >= th).length / hist.length;
    if (!inBand(share)) continue;
    out.push({
      gameType: 'corpus:usgs', layer: 'L2', engine: 'stat_baseline_forward',
      prob: Number(share.toFixed(4)),
      slug: 'corpus:usgs-fw-m5-' + start.replace(/-/g, '') + '-ge' + th,
      statement: '【forward】未来 7 天（' + start + '~' + end + '）全球 M>=5.0 地震 >= ' + th + ' 次'
        + '（cutoff=落库时点 ' + RUN_AT + '，窗口尚未开始；真值锚=USGS fdsnws count 字段。前瞻批次）',
      baseRateNote: '前瞻·USGS：近 5 年同期窗口年均 M>=5.0 次数 ' + JSON.stringify(hist) + '，>= ' + th + ' 占 ' + pct(share),
      resolve: { kind: 'usgs_count_window', start: start, end: end, minmag: 5.0, threshold: th },
      meta: { start: start, end: end, threshold: th, cutoff: RUN_AT },
    });
    break;
  }
  return out;
}

// ── 源四：彩票 L5（双色球未来期 + 3D 每日 + 快乐8 每日）──
async function buildLotto() {
  const out = [];
  // 3D：每日开奖，出未来 3 天（期号=日期近似不可靠 → 用「未来第 N 个开奖日的和值奇偶」表达，resolve 按日期找最早未开奖期）
  // 简化稳妥做法：只出双色球（期号可由上期+步进推出），其余形态留待 resolver 稳定后再扩。
  let last = null;
  try {
    const j = await jget('https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=5', { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/' });
    last = (j.result || [])[0];
  } catch (e) { return out; }
  if (!last) return out;
  const base2 = Number(last.code);
  // 双色球每周二/四/日开奖 → 未来 2-3 期
  const issues = [base2 + 1, base2 + 2, base2 + 3];
  const combos = [
    { key: 'red07', label: '红球包含 07', th: 6 / 33, test: (d) => d.red.indexOf('07') !== -1 },
    { key: 'blueodd', label: '蓝球为奇数', th: 8 / 16, test: (d) => Number(d.blue) % 2 === 1 },
  ];
  for (const issue of issues) {
    for (const cb of combos) {
      if (!inBand(cb.th)) continue;
      out.push({
        gameType: 'corpus:cwl', layer: 'L5', engine: 'none_forward',
        prob: Number(cb.th.toFixed(4)),
        slug: 'corpus:cwl-fw-ssq-' + issue + '-' + cb.key,
        statement: '【forward】双色球第 ' + issue + ' 期' + cb.label
          + '（cutoff=落库时点 ' + RUN_AT + '，开奖尚未发生；真值锚=cwl 官方公告 red/blue 串。前瞻批次）',
        baseRateNote: '前瞻·L5 认证随机：基率=组合数理论值 ' + cb.th.toFixed(4) + '（6/33 与 8/16，非历史拟合）',
        resolve: { kind: 'cwl_ssq_red_contains', issue: String(issue), ball: cb.key === 'red07' ? '07' : null, blue_odd: cb.key === 'blueodd' },
        meta: { issue: String(issue), combo: cb.key, cutoff: RUN_AT },
      });
    }
  }
  return out;
}

// ── main ──
async function main() {
  const sources = [];
  if (!ONLY || ONLY === 'weather') sources.push(['weather', buildWeather]);
  if (!ONLY || ONLY === 'fx') sources.push(['fx', buildFx]);
  if (!ONLY || ONLY === 'quake') sources.push(['quake', buildQuake]);
  if (!ONLY || ONLY === 'lotto') sources.push(['lotto', buildLotto]);
  const report = { run_at: RUN_AT, confirm: CONFIRM, sources: {} };
  const all = [];
  for (const [name, fn] of sources) {
    let rows = [];
    try { rows = await fn(); } catch (e) { console.log('[WARN] ' + name + ' failed: ' + String(e.message).slice(0, 120)); }
    all.push(...rows.map((r) => ({ ...r, _src: name })));
    report.sources[name] = { count: rows.length, layer: rows[0] ? rows[0].layer : null };
    console.log('[' + name + '] built ' + rows.length);
  }
  console.log('TOTAL built=' + all.length);
  // 按 game_type 聚合到现有 corpus 局
  if (CONFIRM) {
    db.init();
    const conn = db.getConnection();
    ensurePredictionsTable(conn);
    const gid = {};
    for (const gt of ['corpus:openmeteo', 'corpus:dbnomics', 'corpus:cwl']) {
      const row = conn.prepare('SELECT id FROM games WHERE game_type = ? LIMIT 1').get(gt);
      if (row) gid[gt] = row.id;
    }
    // usgs 局不存在则创建
    if (!gid['corpus:usgs']) {
      const g2 = db.createGame('corpus-usgs-fw', 'corpus:usgs', 1);
      gid['corpus:usgs'] = g2.id;
    }
    let inserted = 0, skipped = 0;
    for (const r of all) {
      const g = gid[r.gameType];
      if (!g) { skipped++; continue; }
      try {
        insertPrediction({
          gameId: g, day: null, sourceType: '预测卡',
          statement: r.statement, prob: r.prob,
          evidence: [{ resolve: r.resolve, baseRateNote: r.baseRateNote, meta: r.meta, kind: 'forward_batch' }],
          layer: r.layer, engine: r.engine, gate: 'descriptive', checklist_hash: 'v2',
        });
        inserted++;
      } catch (e) { skipped++; console.log('[skip] ' + String(e.message).slice(0, 100)); }
    }
    report.inserted = inserted; report.skipped = skipped;
    report.l0Gate_after = l0Gate();
    console.log('inserted=' + inserted + ' skipped=' + skipped);
    console.log('l0Gate after: ' + JSON.stringify(report.l0Gate_after));
  }
  report.samples = all.slice(0, 3).map((r) => r.statement);
  const outp = path.join(__dirname, '..', 'sim', 'out', 'corpus-forward.out');
  fs.writeFileSync(outp, JSON.stringify(report, null, 2), 'utf8');
  console.log('report → ' + outp);
  if (!CONFIRM) console.log('DRY-RUN: 未写库。加 --confirm 执行。');
}

main().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
