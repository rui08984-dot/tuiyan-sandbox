'use strict';
// 语料历史回填批（corpus-backfill，2026-09-12 施工棒）：用「历史已发生」数据灌一批立即可 resolve 的带真值题。
// 与 corpus-ingest-b2.cjs（面向未来）分工：本脚本只做 backfill，三源=天气 L3 / 汇率 L2 / 彩票 L5。
// 质量底线：
//  Q0-2 cutoff 严格早于事件（天气=事件前一日 23:59:59+08；汇率=目标月上一月月末；彩票=开奖前一日 23:59:59+08），
//        并在 statement 里写明；禁止拿「今天」当 cutoff 去问历史事件。
//  Q0-3 每个（源×组合）先算历史基率，基率必须落在 (0.15, 0.85)，越界则该组合不产出题。
//  prob = 该组合的历史基率（脚本内现算，严格比较口径），不拍脑袋。
//  statement 统一前缀【backfill】，evidence[0].note 写明「历史回填批次，非实时预测」。
// 默认 dry-run；--confirm 才写库。--only=weather|fx|cwl 只跑单源。
const { db } = require('../src/deps');
const { insertPrediction, l0Gate, ensurePredictionsTable } = require('../src/db/predictionsStore');
const path = require('path');
const fs = require('fs');

const CONFIRM = process.argv.includes('--confirm');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
const BAND_LO = 0.15, BAND_HI = 0.85;   // Q0-3 恒定结果拒收门槛（比 b2 的 0.03/0.97 更严）
const FETCH_MS = 30000;

const now08 = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00';
const RUN_AT = now08();

const cache = new Map();
async function jget(url, headers) {
  const key = url + '|' + JSON.stringify(headers || {});
  if (cache.has(key)) return cache.get(key);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: headers || {} });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    cache.set(key, j); return j;
  } finally { clearTimeout(t); }
}
function inBand(x) { return x > BAND_LO && x < BAND_HI; }
function quantile(a, p) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function isoOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
function dayBefore(iso) { return isoOf(Date.parse(iso + 'T00:00:00Z') - 86400000); }
function cutoffOf(iso) { return dayBefore(iso) + 'T23:59:59+08:00'; }
function lastDayOfPrevMonth(ym) { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return isoOf(Date.UTC(y, m - 1, 1) - 86400000); }

// ── RESOLVERS：与现役 corpus-resolve.cjs 完全一致（只读复制，禁改原脚本）──
async function cwlEval(r, predicate, what) {
  const u = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30';
  const j = await jget(u, { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/' });
  const hit = (j.result || []).find((d) => d.code === r.issue);
  if (!hit) return { pending: '第 ' + r.issue + ' 期未开奖' };
  const ok = predicate(hit);
  return { outcome: ok ? 'true' : 'false', note: 'cwl 官方 ' + r.issue + ' 期 red=' + hit.red + ' blue=' + hit.blue + '（' + what + '，机检）' };
}
const RESOLVERS = {
  async openmeteo_daily_max(r) {
    const u = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + r.lat + '&longitude=' + r.lon
      + '&start_date=' + r.date + '&end_date=' + r.date + '&daily=temperature_2m_max&timezone=Asia%2FShanghai';
    let j;
    try { j = await jget(u); } catch (e) { if (String(e.message).indexOf('HTTP 400') !== -1) return { pending: 'archive 尚无 ' + r.date }; throw e; }
    const v = j.daily && j.daily.temperature_2m_max ? j.daily.temperature_2m_max[0] : null;
    if (v === null || v === undefined) return { pending: 'archive 尚无 ' + r.date + ' 日值' };
    return { outcome: v > r.threshold_c ? 'true' : 'false', note: 'Open-Meteo archive ' + r.date + ' max=' + v + 'C（阈值 ' + r.threshold_c + 'C，机检）' };
  },
  async dbnomics_series_value(r) {
    const u = 'https://api.db.nomics.world/v22/series/' + r.provider + '/' + r.dataset + '/' + r.series + '?observations=1';
    const j = await jget(u);
    const doc = j.series && j.series.docs && j.series.docs[0];
    if (!doc) return { pending: '序列不存在' };
    const i = doc.period.indexOf(r.period);
    const v = i >= 0 ? doc.value[i] : null;
    if (v === null || v === undefined) return { pending: r.period + ' 观测值未发布' };
    return { outcome: v < r.threshold ? 'true' : 'false', note: 'DBnomics ' + r.series + ' ' + r.period + '=' + v + '（阈值 ' + r.threshold + '，机检）' };
  },
  async cwl_ssq_red_contains(r) { return cwlEval(r, (d) => d.red.split(',').indexOf(r.ball) !== -1, 'red 含 ' + r.ball); },
  async cwl_ssq_blue_odd(r) { return cwlEval(r, (d) => Number(d.blue) % 2 === 1, 'blue 为奇数'); },
};

// ── 源一：天气 L3（Open-Meteo archive 2015-01-01~2024-12-31）──
// 口径：事件日取 2024 年该月日期（真值已发生）；基率=该城市该月 2015-2023（pre-cutoff）日值严格大于阈值占比。
// 阈值=历史中位 → 天然 ~0.5，配合 Q0-3 (0.15,0.85) 门槛逐组合验收，越界不出题。
const CITIES = [
  { name: '上海', lat: 31.23, lon: 121.47 },
  { name: '北京', lat: 39.9, lon: 116.41 },
  { name: '广州', lat: 23.13, lon: 113.26 },
  { name: '成都', lat: 30.57, lon: 104.07 },
];
const MONTHS = ['01', '03', '05', '07', '09', '11'];
const DAYS_PER_MONTH = 4;   // 4 城×6 月×4 天 = 96 条

async function buildWeather(archive) {
  const out = [];
  for (const c of CITIES) {
    const a = archive[c.name];
    const byMonth = {};
    a.daily.time.forEach((d, i) => {
      const v = a.daily.temperature_2m_max[i];
      if (v === null || v === undefined) return;
      const m = d.slice(5, 7);
      if (MONTHS.indexOf(m) === -1) return;
      byMonth[m] = byMonth[m] || { pre: [], ev: [] };
      if (d.slice(0, 4) < '2024') byMonth[m].pre.push(v);
      else byMonth[m].ev.push({ d: d, v: v });
    });
    for (const m of MONTHS) {
      if (!byMonth[m] || !byMonth[m].ev.length) continue;
      const pre = byMonth[m].pre;
      const th = Math.round(quantile(pre, 0.5));
      const share = pre.filter((x) => x > th).length / pre.length;
      if (!inBand(share)) { console.log('  [Q0-3 拒收] ' + c.name + ' ' + m + '月 阈值 ' + th + ' 基率 ' + share.toFixed(3) + ' 越界'); continue; }
      const evDays = byMonth[m].ev;
      const step = Math.max(1, Math.floor(evDays.length / DAYS_PER_MONTH));
      for (let i = 0; i < DAYS_PER_MONTH; i++) {
        const e = evDays[i * step];
        if (!e) continue;
        out.push({
          gameType: 'corpus:openmeteo', layer: 'L3', engine: 'openmeteo_archive_baserate',
          prob: Number(share.toFixed(4)),
          slug: 'corpus:openmeteo-bf-' + c.name + '-' + e.d.replace(/-/g, '') + '-gt' + th,
          statement: '【backfill】' + c.name + ' ' + e.d + ' 日最高气温 > ' + th + '°C'
            + '（cutoff=' + cutoffOf(e.d) + '，严格早于事件日；真值锚=Open-Meteo archive daily.temperature_2m_max[' + e.d + ']。历史回填批次，非实时预测）',
          baseRateNote: '历史回填·' + c.name + ' ' + m + '月：2015-2023 共 ' + pre.length + ' 个历史日值（pre-cutoff 窗），'
            + 'max>' + th + '°C 占 ' + (share * 100).toFixed(1) + '%（Open-Meteo archive 实抓，严格大于口径）',
          resolve: { kind: 'openmeteo_daily_max', lat: c.lat, lon: c.lon, date: e.d, threshold_c: th, cmp: '>' },
          truthPreview: e.v,
          meta: { city: c.name, month: m, threshold: th, eventDate: e.d, cutoff: cutoffOf(e.d) },
        });
      }
    }
  }
  return out;
}

// ── 源二：汇率 L2（DBnomics ECB/EXR/M.USD.EUR.SP00.A）──
// 口径：目标月=2024-2025 抽样；cutoff=目标月上月末 23:59:59+08；基率=cutoff 前已发布月值中 <阈值 占比。
const FX_SERIES = 'M.USD.EUR.SP00.A';
const FX_TARGETS = ['2024-03', '2024-06', '2024-09', '2024-12', '2025-03', '2025-06', '2025-09', '2025-12'];
const FX_THRESHOLDS = [1.08, 1.10, 1.12, 1.15];

async function buildFx() {
  const j = await jget('https://api.db.nomics.world/v22/series/ECB/EXR/' + FX_SERIES + '?observations=1');
  const doc = j.series.docs[0];
  const series = [];
  doc.period.forEach((p, i) => { if (doc.value[i] !== null && doc.value[i] !== undefined) series.push({ p: p, v: doc.value[i] }); });
  const out = [];
  for (const period of FX_TARGETS) {
    const pre = series.filter((x) => x.p < period);
    const actual = series.find((x) => x.p === period);
    if (!actual) { console.log('  [skip] ' + period + ' 无观测值'); continue; }
    for (const threshold of FX_THRESHOLDS) {
      const share = pre.filter((x) => x.v < threshold).length / pre.length;
      if (!inBand(share)) { console.log('  [Q0-3 拒收] ' + period + ' 阈值 ' + threshold + ' 基率 ' + share.toFixed(3) + ' 越界'); continue; }
      out.push({
        gameType: 'corpus:dbnomics', layer: 'L2', engine: 'dbnomics_climatology_baserate',
        prob: Number(share.toFixed(4)),
        slug: 'corpus:dbnomics-bf-' + period.replace('-', '') + '-lt' + String(threshold).replace('.', ''),
        statement: '【backfill】' + period + ' 月 USD/EUR 月均参考汇率（ECB/EXR/' + FX_SERIES + '）< ' + threshold
          + '（cutoff=' + lastDayOfPrevMonth(period) + 'T23:59:59+08:00，严格早于目标月；真值锚=DBnomics 同序列 ' + period + ' 观测值。历史回填批次，非实时预测）',
        baseRateNote: '历史回填·USD/EUR ' + period + '：cutoff 前已发布 ' + pre.length + ' 个月值中 '
          + '<' + threshold + ' 占 ' + (share * 100).toFixed(1) + '%（DBnomics ECB/EXR 实抓，pre-cutoff 严格小于口径）',
        resolve: { kind: 'dbnomics_series_value', provider: 'ECB', dataset: 'EXR', series: FX_SERIES, period: period, threshold: threshold, cmp: '<' },
        truthPreview: actual.v,
        meta: { period: period, threshold: threshold, cutoff: lastDayOfPrevMonth(period) + 'T23:59:59+08:00' },
      });
    }
  }
  return out;
}

// ── 源三：彩票 L5（cwl 双色球）──
// 硬事实（实测）：findDrawNotice?issueCount=30 只返回最近 30 期（2026076~2026105），
//   → 可 resolve 的期号必须落在此窗口内，否则 resolver 取不到真值（pending）。事件期只取窗口内已开奖期。
// 基率=pre-cutoff 实测（该期之前已开奖期里命中占比，零未来信息）；cutoff=开奖日前一日 23:59:59+08。
const CWL_URL = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30';
const CWL_HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/' };
const CWL_BALLS = ['07', '16', '23'];
const CWL_PER_BALL = 6;

async function buildCwl() {
  const j = await jget(CWL_URL, CWL_HEADERS);
  const draws = (j.result || []).slice().sort((a, b) => (a.code < b.code ? -1 : 1));
  if (!draws.length) throw new Error('cwl 返回空');
  const out = [];
  for (const ball of CWL_BALLS) {
    for (let k = 1; k <= CWL_PER_BALL; k++) {
      const idx = draws.length - 1 - k * 2;
      if (idx < 0) continue;
      const d = draws[idx];
      const pre = draws.slice(0, idx);
      if (pre.length < 5) continue;
      const share = pre.filter((x) => x.red.split(',').indexOf(ball) !== -1).length / pre.length;
      if (!inBand(share)) { console.log('  [Q0-3 拒收] red 含 ' + ball + ' 期 ' + d.code + ' 基率 ' + share.toFixed(3) + ' 越界'); continue; }
      const dstr = (d.date || '').slice(0, 10);
      out.push({
        gameType: 'corpus:cwl', layer: 'L5', engine: 'cwl_empirical_baserate',
        prob: Number(share.toFixed(4)),
        slug: 'corpus:cwl-bf-ssq-' + d.code + '-red' + ball,
        statement: '【backfill】双色球第 ' + d.code + ' 期红球包含号码 ' + ball
          + '（cutoff=' + cutoffOf(dstr) + '，严格早于开奖日；真值锚=cwl 官方开奖公告 ' + d.code + ' 期 red 串。历史回填批次，非实时预测）',
        baseRateNote: '历史回填·双色球 red 含 ' + ball + '：cutoff 前 ' + pre.length + ' 期中命中 '
          + (share * 100).toFixed(1) + '%（cwl 官方公告实抓，pre-cutoff 窗）',
        resolve: { kind: 'cwl_ssq_red_contains', issue: d.code, ball: ball },
        truthPreview: d.red,
        meta: { issue: d.code, ball: ball, drawDate: dstr, cutoff: cutoffOf(dstr) },
      });
    }
  }
  for (let k = 1; k <= 8; k++) {
    const idx = draws.length - 1 - k * 2;
    if (idx < 0) continue;
    const d = draws[idx];
    const pre = draws.slice(0, idx);
    if (pre.length < 5) continue;
    const share = pre.filter((x) => Number(x.blue) % 2 === 1).length / pre.length;
    if (!inBand(share)) { console.log('  [Q0-3 拒收] blue 奇 ' + d.code + ' 基率 ' + share.toFixed(3) + ' 越界'); continue; }
    const dstr = (d.date || '').slice(0, 10);
    out.push({
      gameType: 'corpus:cwl', layer: 'L5', engine: 'cwl_empirical_baserate',
      prob: Number(share.toFixed(4)),
      slug: 'corpus:cwl-bf-ssq-' + d.code + '-blueodd',
      statement: '【backfill】双色球第 ' + d.code + ' 期蓝球为奇数'
        + '（cutoff=' + cutoffOf(dstr) + '，严格早于开奖日；真值锚=cwl 官方开奖公告 ' + d.code + ' 期 blue。历史回填批次，非实时预测）',
      baseRateNote: '历史回填·双色球 blue 奇数：cutoff 前 ' + pre.length + ' 期中占 ' + (share * 100).toFixed(1) + '%（cwl 官方公告实抓，pre-cutoff 窗）',
      resolve: { kind: 'cwl_ssq_blue_odd', issue: d.code },
      truthPreview: d.blue,
      meta: { issue: d.code, drawDate: dstr, cutoff: cutoffOf(dstr) },
    });
  }
  return out;
}

// ── main ──
async function main() {
  db.init();
  const conn = db.getConnection();
  ensurePredictionsTable(conn);
  const before = l0Gate();
  console.log('l0Gate before:', JSON.stringify(before));

  const games = {};
  for (const gt of ['corpus:openmeteo', 'corpus:dbnomics', 'corpus:cwl']) {
    const row = conn.prepare('SELECT id FROM games WHERE game_type = ?').get(gt);
    if (!row) throw new Error('语料局缺失: ' + gt);
    games[gt] = row.id;
  }
  console.log('复用局:', JSON.stringify(games));

  const want = (s) => !ONLY || ONLY === s;
  const QUESTIONS = [];
  const stats = {};

  if (want('weather')) {
    console.log('── 源一 天气 L3 ──');
    const archive = {};
    for (const c of CITIES) {
      archive[c.name] = await jget('https://archive-api.open-meteo.com/v1/archive?latitude=' + c.lat + '&longitude=' + c.lon
        + '&start_date=2015-01-01&end_date=2024-12-31&daily=temperature_2m_max&timezone=Asia%2FShanghai');
    }
    stats.weather = await buildWeather(archive);
    QUESTIONS.push.apply(QUESTIONS, stats.weather);
    console.log('天气产出 ' + stats.weather.length + ' 条');
  }
  if (want('fx')) {
    console.log('── 源二 汇率 L2 ──');
    stats.fx = await buildFx();
    QUESTIONS.push.apply(QUESTIONS, stats.fx);
    console.log('汇率产出 ' + stats.fx.length + ' 条');
  }
  if (want('cwl')) {
    console.log('── 源三 彩票 L5 ──');
    stats.cwl = await buildCwl();
    QUESTIONS.push.apply(QUESTIONS, stats.cwl);
    console.log('彩票产出 ' + stats.cwl.length + ' 条');
  }

  const range = (arr) => arr.length ? { n: arr.length, min: Math.min.apply(null, arr.map((q) => q.prob)), max: Math.max.apply(null, arr.map((q) => q.prob)) } : { n: 0 };
  const report = {
    run_at: RUN_AT, confirm: CONFIRM,
    sources: {
      weather: { layer: 'L3', count: (stats.weather || []).length, prob: range(stats.weather || []) },
      fx: { layer: 'L2', count: (stats.fx || []).length, prob: range(stats.fx || []) },
      cwl: { layer: 'L5', count: (stats.cwl || []).length, prob: range(stats.cwl || []) },
    },
  };
  console.log('题目表合计：' + QUESTIONS.length + ' 条');

  let inserted = 0, skipped = 0;
  for (const q of QUESTIONS) {
    const gid = games[q.gameType];
    const dup = conn.prepare('SELECT id FROM predictions WHERE game_id = ? AND statement LIKE ?').get(gid, '【' + q.slug + '】%');
    if (dup) { skipped++; console.log('skip dup: id=' + dup.id, q.slug); continue; }
    const statement = '【' + q.slug + '】' + q.statement;
    const snap = {
      kind: 'backfill_snapshot',
      slug: q.slug,
      batch: 'corpus-backfill-2026-09-12',
      note: '历史回填批次，非实时预测；' + q.baseRateNote,
      backfill: true,
      cutoff: q.meta.cutoff,
      prob_source: 'combo base rate (pre-cutoff, computed in-script)',
      resolve: q.resolve,
      truth_preview: q.truthPreview,
      ingested_at: RUN_AT,
    };
    if (CONFIRM) {
      const row = insertPrediction({ gameId: gid, day: 0, sourceType: '预测卡', statement: statement, prob: q.prob, layer: q.layer, engine: q.engine, publicExposure: 0, checklistHash: 'bf1', gate: 'descriptive', evidence: [snap] });
      console.log('inserted: id=' + row.id, q.slug, '| prob=' + q.prob);
    } else {
      console.log('[dry] would insert:', q.slug, '| prob=' + q.prob, '| layer=' + q.layer);
    }
    inserted++;
  }

  // ── 可 resolve 性验证（用现役 corpus-resolve.cjs 的 RESOLVERS 逻辑）──
  let resolved = 0, pending = 0, failed = 0;
  const verifyRows = [];
  for (const q of QUESTIONS) {
    const r = q.resolve;
    let out;
    try { out = await RESOLVERS[r.kind](r); } catch (e) { out = { error: e.message }; }
    if (out && out.pending) { pending++; verifyRows.push({ slug: q.slug, status: 'pending', why: out.pending }); continue; }
    if (out && out.error) { failed++; verifyRows.push({ slug: q.slug, status: 'fail', why: out.error }); continue; }
    resolved++;
    verifyRows.push({ slug: q.slug, status: 'resolved', outcome: out.outcome, note: out.note, prob: q.prob, layer: q.layer });
  }
  report.verify = { resolved: resolved, pending: pending, failed: failed, total: QUESTIONS.length };
  report.inserted = inserted; report.skipped = skipped;

  const outDir = path.join(__dirname, '..', 'sim', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  report.samples = {};
  for (const k of ['weather', 'fx', 'cwl']) if (stats[k] && stats[k].length) report.samples[k] = stats[k].slice(0, 2).map((q) => q.statement);
  report.verify_rows_sample = verifyRows.slice(0, 3);
  report.l0_before = before;
  report.l0_after = CONFIRM ? l0Gate() : null;
  fs.writeFileSync(path.join(outDir, 'corpus-backfill.out'), JSON.stringify(report, null, 2), 'utf8');

  console.log('── verify（现役 RESOLVERS 逻辑）── resolved=' + resolved + ' pending=' + pending + ' failed=' + failed);
  if (pending) console.log('  pending 样例: ' + JSON.stringify(verifyRows.filter((v) => v.status === 'pending').slice(0, 3)));
  console.log('l0Gate after:', JSON.stringify(CONFIRM ? report.l0_after : before));
  console.log('summary: total=' + inserted, 'skipped=' + skipped, 'confirm=' + CONFIRM);
  console.log('report → p1b/sim/out/corpus-backfill.out');
  if (!CONFIRM) console.log('DRY-RUN：未写库。加 --confirm 执行真实落库。');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
