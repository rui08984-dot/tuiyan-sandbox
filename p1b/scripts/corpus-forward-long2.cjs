'use strict';
/*
 * corpus-forward-long2.cjs —— #11 长 horizon 第二来源（≥2 域，摆脱 oct_forward 单批）
 * 背景：G2 ③「长 horizon(>30d) ≥10 且必须 realtime」现状 21 条全部来自 oct_forward 单批
 *   （AQ PM10 10 / Binance 6 / Wikimedia 5）——一个批次决定长 horizon 结论。
 * 本批：另开 3 域前瞻题，horizon 全 >30 天，真值锚=已注册 resolver kind（corpus-resolve.cjs），
 *   来源与 oct_forward 不重叠：USGS 水文 / NOAA GML 大气 CO2 / NCEI GHCN 气温。
 * 口径：cutoff=落库时点（前瞻/realtime）；基率=cutoff 前 400 天历史现算；baseRateNote 显式带样本量 n。
 * 写库契约（批次1）：g2_regime='R4' + maturesAt 显式 + public_exposure=0 + checklistHash='v3'。
 * 幂等：statement 前缀查重；阈值由 seed(源|标的|目标日) 稳定挑选 → 重跑恒定。
 * 用法：node scripts/corpus-forward-long2.cjs [--confirm] [--only=usgs|co2|ghcn]
 */
const { db } = require('../src/deps');
const { insertPrediction, l0Gate, ensurePredictionsTable, deriveMaturesAt } = require('../src/db/predictionsStore');
const path = require('path');
const fs = require('fs');

const CONFIRM = process.argv.includes('--confirm');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
const LO = 0.15, HI = 0.85, FETCH_MS = 30000, HIST_DAYS = 400, HMIN = 31;
const UA = 'corpus-long2/1.0 (research; +node)';
const now08 = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00';
const RUN_AT = now08();
const TODAY = RUN_AT.slice(0, 10);
const TARGETS = ['2026-10-20', '2026-11-03', '2026-11-17'];
const pct = (x) => (x * 100).toFixed(1) + '%';
const plusDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const QT = [0.5, 0.6, 0.4, 0.7, 0.3];
function quantile(a, p) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function seedOf(s) { let h = 7; const t = String(s); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return Math.abs(h); }
function pickTh(hist, key) {
  const ok = [];
  for (const q of QT) {
    const th = quantile(hist, q);
    if (th === null) continue;
    const hit = hist.filter((x) => x >= th).length / hist.length;
    if (hit <= LO || hit >= HI) continue;
    ok.push({ th: th, hit: hit, q: q, d: Math.abs(hit - 0.5) });
  }
  if (!ok.length) return null;
  ok.sort((x, y) => x.d - y.d);
  return ok[seedOf(key) % ok.length];
}
// 取数：照 corpus-resolve.cjs L406 getJsonRetry 的退避契约（可重试=429/fetch failed/abort；退避 1.5/3/4.5s；n=4）
async function getJson(url, headers) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json, */*' }, headers || {}) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function getJsonRetry(url, headers, tries) {
  const n = tries || 4; let last = null;
  for (let a = 0; a < n; a++) {
    try { return await getJson(url, headers); }
    catch (e) {
      last = e; const m = String((e && e.message) || '');
      const retriable = m.indexOf('429') !== -1 || m.indexOf('fetch failed') !== -1 || m.indexOf('abort') !== -1;
      if (!retriable || a === n - 1) throw e;
      await new Promise((s) => setTimeout(s, 1500 * (a + 1)));
    }
  }
  throw last;
}
async function getText(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
  try { const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
const MINUS1 = plusDays(TODAY, -1);
const HIST_FROM = plusDays(TODAY, -HIST_DAYS);
// ── 域 A：USGS NWIS 日流量（水文；gid 77 corpus:river）──
const USGS = [
  { site: '01646500', name: '波托马克河' },
  { site: '09380000', name: '科罗拉多河 Lees Ferry' },
];
async function buildUsgs() {
  const out = [];
  for (const s of USGS) {
    const h = await getJsonRetry('https://waterservices.usgs.gov/nwis/dv/?format=json&sites=' + s.site + '&parameterCd=00060&startDT=' + HIST_FROM + '&endDT=' + MINUS1);
    const ts = h && h.value && h.value.timeSeries && h.value.timeSeries[0];
    const hist = ts ? ts.values[0].value.map((x) => Number(x.value)).filter((x) => isFinite(x)) : [];
    if (hist.length < 30) { console.log('[skip] USGS ' + s.site + ' hist=' + hist.length); continue; }
    for (const d of TARGETS) {
      const b = pickTh(hist, 'usgs|' + s.site + '|' + d);
      if (!b) { console.log('[skip] USGS ' + s.site + ' ' + d + ' 无带内阈值'); continue; }
      const th = Math.round(b.th);
      const hit = hist.filter((x) => x >= th).length / hist.length;
      if (hit <= LO || hit >= HI) continue;
      const n = hist.length;
      out.push({
        domain: 'usgs', gid: 77, layer: 'L3', engine: 'usgs_nwis_daily_discharge_baserate_forward',
        slug: 'corpus:long2-usgs-' + s.site + '-' + d.replace(/-/g, ''),
        statement: '【forward】USGS ' + s.name + '（' + s.site + '） ' + d + ' 日流量 >= ' + th + ' ft³/s（cutoff=' + RUN_AT + '，落库即前瞻，早于事件日 ' + daysBetween(TODAY, d) + ' 天；真值锚=USGS NWIS dv 00060。前瞻批次，真值未发生）',
        prob: Number(hit.toFixed(4)),
        baseRateNote: '前瞻·USGS ' + s.name + '：cutoff 前 ' + n + ' 个日流量中 >= ' + th + ' 占 ' + pct(hit) + '（n=' + n + (n < 100 ? '，薄样本' : '') + '，分位 q=' + b.q + '；USGS NWIS dv 实抓，pre-cutoff 窗）',
        resolve: { kind: 'usgs_nwis_daily_discharge', url_template: 'https://waterservices.usgs.gov/nwis/dv/?format=json&sites=' + s.site + '&parameterCd=00060&startDT={date}&endDT={date}', site: s.site, date: d, threshold: th, cmp: '>=', field: 'value.timeSeries[0].values[0].value[] 中 dateTime 前缀==date 的 .value（ft³/s）' },
        meta: { phase: 'forward', dom: 'hydrology', site: s.site, name: s.name, date: d, threshold: th, cutoff: RUN_AT },
      });
    }
  }
  return out;
}
// ── 域 B：NOAA GML 冒纳罗亚 CO2 日均（大气；gid 78 corpus:co2）──
const CO2_URL = 'https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.csv';
async function buildCo2() {
  const t = await getText(CO2_URL);
  const rows = t.split('\n').filter((x) => x && x.charAt(0) !== '#').map((x) => x.split(','))
    .filter((c) => c.length >= 5 && c[3] !== '' && c[4] !== '')
    .map((c) => ({ d: c[0] + '-' + ('0' + c[1]).slice(-2) + '-' + ('0' + c[2]).slice(-2), v: Number(c[4]) }))
    .filter((x) => isFinite(x.v) && x.d >= HIST_FROM && x.d <= MINUS1);
  const hist = rows.map((x) => x.v);
  if (hist.length < 30) { console.log('[skip] CO2 hist=' + hist.length); return []; }
  const out = [];
  for (const d of TARGETS) {
    const b = pickTh(hist, 'co2|mlo|' + d);
    if (!b) { console.log('[skip] CO2 ' + d + ' 无带内阈值'); continue; }
    const th = Number(b.th.toFixed(2));
    const hit = hist.filter((x) => x >= th).length / hist.length;
    if (hit <= LO || hit >= HI) continue;
    const n = hist.length;
    out.push({
      domain: 'co2', gid: 78, layer: 'L3', engine: 'noaa_gml_mlo_co2_daily_baserate_forward',
      slug: 'corpus:long2-co2-mlo-' + d.replace(/-/g, ''),
      statement: '【forward】NOAA GML 冒纳罗亚站 ' + d + ' 日 CO2 干空气摩尔分数 >= ' + th + ' ppm（cutoff=' + RUN_AT + '，落库即前瞻，早于事件日 ' + daysBetween(TODAY, d) + ' 天；真值锚=NOAA GML co2_daily_mlo.csv 第 5 列。前瞻批次，真值未发生）',
      prob: Number(hit.toFixed(4)),
      baseRateNote: '前瞻·MLO CO2：cutoff 前 ' + n + ' 个日均中 >= ' + th + ' 占 ' + pct(hit) + '（n=' + n + (n < 100 ? '，薄样本' : '') + '，分位 q=' + b.q + '；NOAA GML 实抓，pre-cutoff 窗）',
      resolve: { kind: 'noaa_gml_co2_daily', url: CO2_URL, date: d, threshold: th, cmp: '>=', field: 'CSV 中 year,month,day == date 的行第 5 列（ppm）' },
      meta: { phase: 'forward', dom: 'atmos', station: 'MLO', date: d, threshold: th, cutoff: RUN_AT },
    });
  }
  return out;
}
// ── 域 C：NCEI GHCN 日最高气温（气象；gid 75 corpus:ghcn2）──
const GHCN = [{ station: 'USW00094728', name: '纽约中央公园' }];
const ghcnTmpl = (st) => 'https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=' + st + '&startDate={date}&endDate={date}&dataTypes=TMAX&format=json&units=standard';
async function buildGhcn() {
  const out = [];
  for (const s of GHCN) {
    const url = 'https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=' + s.station + '&startDate=' + HIST_FROM + '&endDate=' + MINUS1 + '&dataTypes=TMAX&format=json&units=standard';
    let j; try { j = await getJsonRetry(url); } catch (e) { console.log('[skip] GHCN ' + s.station + ' ' + e.message); continue; }
    const hist = (Array.isArray(j) ? j : []).map((x) => Number(x.TMAX)).filter((x) => isFinite(x));
    if (hist.length < 30) { console.log('[skip] GHCN ' + s.station + ' hist=' + hist.length); continue; }
    for (const d of TARGETS) {
      const b = pickTh(hist, 'ghcn|' + s.station + '|' + d);
      if (!b) { console.log('[skip] GHCN ' + s.station + ' ' + d + ' 无带内阈值'); continue; }
      const th = Math.round(b.th);
      const hit = hist.filter((x) => x >= th).length / hist.length;
      if (hit <= LO || hit >= HI) continue;
      const n = hist.length;
      out.push({
        domain: 'ghcn', gid: 75, layer: 'L3', engine: 'ghcn_daily_tmax_baserate_forward',
        slug: 'corpus:long2-ghcn-' + s.station + '-' + d.replace(/-/g, ''),
        statement: '【forward】NCEI GHCN ' + s.name + '（' + s.station + '） ' + d + ' 日最高气温 >= ' + th + ' °F（cutoff=' + RUN_AT + '，落库即前瞻，早于事件日 ' + daysBetween(TODAY, d) + ' 天；真值锚=NCEI daily-summaries TMAX。前瞻批次，真值未发生）',
        prob: Number(hit.toFixed(4)),
        baseRateNote: '前瞻·NCEI GHCN ' + s.name + '：cutoff 前 ' + n + ' 天日最高气温中 >= ' + th + ' 占 ' + pct(hit) + '（n=' + n + (n < 100 ? '，薄样本' : '') + '，分位 q=' + b.q + '；NCEI daily-summaries 实抓，pre-cutoff 窗）',
        resolve: { kind: 'ghcn_daily_tmax', url_template: ghcnTmpl(s.station), station: s.station, date: d, threshold: th, cmp: '>=', field: 'body[0].TMAX（°F，units=standard）' },
        meta: { phase: 'forward', dom: 'weather', station: s.station, name: s.name, date: d, threshold: th, cutoff: RUN_AT },
      });
    }
  }
  return out;
}
async function main() {
  db.init();
  const conn = db.getConnection();
  ensurePredictionsTable(conn);
  const questions = [];
  const want = (k) => !ONLY || ONLY === k;
  if (want('usgs')) questions.push.apply(questions, await buildUsgs());
  if (want('co2')) questions.push.apply(questions, await buildCo2());
  if (want('ghcn')) questions.push.apply(questions, await buildGhcn());
  const byDom = {};
  questions.forEach((q) => { byDom[q.domain] = (byDom[q.domain] || 0) + 1; });
  const hors = questions.map((q) => daysBetween(TODAY, q.resolve.date));
  console.log('[plan] run_at=' + RUN_AT + ' targets=' + JSON.stringify(TARGETS) + ' questions=' + questions.length + ' by_dom=' + JSON.stringify(byDom));
  console.log('[plan] horizon(days)=' + JSON.stringify(hors) + ' 最短=' + (hors.length ? Math.min.apply(null, hors) : 0) + ' 全部>' + HMIN + '=' + (hors.length > 0 && hors.every((x) => x > HMIN)));
  console.log('[plan] cutoff ' + TODAY + ' 早于全部事件日=' + (questions.length > 0 && questions.every((q) => TODAY < q.resolve.date)));
  for (const q of questions) console.log('  [' + q.domain + '] ' + q.slug + ' date=' + q.resolve.date + ' h=' + daysBetween(TODAY, q.resolve.date) + 'd th=' + q.resolve.threshold + ' prob=' + q.prob + ' | ' + q.baseRateNote);
  let ins = 0, dup = 0;
  const ids = [];
  for (const q of questions) {
    const prefix = '【' + q.slug + '】';
    const statement = prefix + q.statement;
    const exists = conn.prepare('SELECT id FROM predictions WHERE statement LIKE ? LIMIT 1').get(prefix + '%');
    if (exists) { dup++; console.log('[dup] ' + q.slug + ' -> id=' + exists.id); continue; }
    if (!CONFIRM) { ins++; continue; }
    const snap = { resolve: q.resolve, baseRateNote: q.baseRateNote, meta: q.meta, slug: q.slug, phase: 'forward', kind: 'long2_forward' };
    const row = insertPrediction({
      gameId: q.gid, day: null, sourceType: '预测卡', statement: statement, prob: q.prob,
      layer: q.layer, engine: q.engine, publicExposure: 0, checklistHash: 'v3', gate: 'descriptive',
      g2Regime: 'R4', maturesAt: deriveMaturesAt(q.resolve, [snap]), evidence: [snap],
    });
    ids.push(row.id); ins++;
    console.log('inserted id=' + row.id + ' ' + q.slug + ' h=' + daysBetween(TODAY, q.resolve.date) + 'd');
  }
  console.log('[summary] ' + JSON.stringify({ confirm: CONFIRM, questions: questions.length, written: ins, duplicate: dup, by_dom: byDom, ids: ids }));
  if (!CONFIRM) console.log('DRY-RUN：未写库。加 --confirm 执行。');
  else {
    console.log('[verify] integrity=' + conn.prepare('PRAGMA integrity_check').get().integrity_check);
    const v = conn.prepare("SELECT COUNT(*) n FROM predictions WHERE checklist_hash='v3'").get().n;
    const ok = conn.prepare("SELECT COUNT(*) n FROM predictions WHERE checklist_hash='v3' AND g2_regime='R4' AND matures_at IS NOT NULL AND matures_at<>'' AND public_exposure=0").get().n;
    console.log('[verify] v3 行=' + v + ' 其中四契约齐=' + ok);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'sim', 'out', 'corpus-forward-long2.rows.json'), JSON.stringify(questions, null, 1), 'utf8');
  db.closeCurrent();
}
main().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });