'use strict';
// 语料库第二批落库（2026-09-12 · 主会话亲笔）：Open-Meteo 四城市×四日 L3 16 条 + DBnomics L2 2 条。
// 阈值口径=resolver 现支持方向（openmeteo '>'，dbnomics '<'）；prob=严格比较口径的气候基率
// （2015-2024 九月日值 / 序列已发布月值，脚本内现算不留漂移）；快照含预报值与 resolve 参数。
// 默认 dry-run；--confirm 才写库。复用第一批三局（corpus:openmeteo/corpus:dbnomics，source 已='corpus'）。
const { db } = require('../src/deps');
const { insertPrediction, l0Gate, ensurePredictionsTable, deriveMaturesAt } = require('../src/db/predictionsStore');

const CONFIRM = process.argv.includes('--confirm');
const now08 = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00';
const INGEST_AT = now08();
const DATES = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16'];
const CITIES = [
  { name: '上海', lat: 31.23, lon: 121.47, th: 30 },
  { name: '北京', lat: 39.9, lon: 116.41, th: 28 },
  { name: '广州', lat: 23.13, lon: 113.26, th: 32 },
  { name: '成都', lat: 30.57, lon: 104.07, th: 25 },
];
const FX = [
  { slug: 'corpus:dbnomics-usdeur-202610-lt115', series: 'M.USD.EUR.SP00.A', period: '2026-10', threshold: 1.15,
    statement: '2026-10 月 USD/EUR 月均参考汇率（ECB/EXR/M.USD.EUR.SP00.A）<1.15' },
  { slug: 'corpus:dbnomics-usdeur-202610-lt110', series: 'M.USD.EUR.SP00.A', period: '2026-10', threshold: 1.10,
    statement: '2026-10 月 USD/EUR 月均参考汇率（ECB/EXR/M.USD.EUR.SP00.A）<1.10' },
];
async function jget(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); }
}
async function main() {
  db.init();
  const conn = db.getConnection();
  ensurePredictionsTable(conn);
  const before = l0Gate();
  console.log('l0Gate before:', JSON.stringify(before));
  const games = {};
  for (const gt of ['corpus:openmeteo', 'corpus:dbnomics']) {
    const row = conn.prepare('SELECT id FROM games WHERE game_type = ?').get(gt);
    if (!row) throw new Error('第一批局缺失: ' + gt);
    games[gt] = row.id;
  }
  const QUESTIONS = [];
  // ── 天气 16 条：气候基率严格 '>' 现算 + 预报快照 ──
  for (const c of CITIES) {
    const a = await jget('https://archive-api.open-meteo.com/v1/archive?latitude=' + c.lat + '&longitude=' + c.lon + '&start_date=2015-09-01&end_date=2024-09-30&daily=temperature_2m_max&timezone=Asia%2FShanghai');
    const sept = [];
    a.daily.time.forEach((d, i) => { if (d.slice(5, 7) === '09' && a.daily.temperature_2m_max[i] !== null) sept.push(a.daily.temperature_2m_max[i]); });
    const share = sept.filter((x) => x > c.th).length / sept.length;
    if (share <= 0.03 || share >= 0.97) throw new Error(c.name + ' 阈值 ' + c.th + ' 基率越界: ' + share);
    const f = await jget('https://api.open-meteo.com/v1/forecast?latitude=' + c.lat + '&longitude=' + c.lon + '&daily=temperature_2m_max&timezone=Asia%2FShanghai&forecast_days=6');
    for (const date of DATES) {
      const i = f.daily.time.indexOf(date);
      if (i < 0) throw new Error(c.name + ' 预报缺 ' + date);
      QUESTIONS.push({
        gameType: 'corpus:openmeteo', layer: 'L3', engine: 'aci', prob: Number(share.toFixed(4)),
        slug: 'corpus:openmeteo-' + c.name + date.slice(5).replace('-', '') + '-gt' + c.th,
        statement: c.name + ' ' + date + ' 日最高气温 >' + c.th + '°C（判据冻结 cutoff=' + INGEST_AT + '；真值锚=Open-Meteo archive daily.temperature_2m_max[' + date + ']）',
        baseRateNote: '气候基率：' + c.name + ' 2015-2024 共 ' + sept.length + ' 个 9 月日，max>' + c.th + '°C 占 ' + (share * 100).toFixed(1) + '%（Open-Meteo archive 实抓，严格大于口径）',
        resolve: { kind: 'openmeteo_daily_max', lat: c.lat, lon: c.lon, date, threshold_c: c.th, cmp: '>' },
        forecast: { date, temperature_2m_max_c: f.daily.temperature_2m_max[i], fetched_at: INGEST_AT, endpoint: 'api.open-meteo.com/v1/forecast' },
      });
    }
  }
  // ── 汇率 2 条：基率=已发布月值占比（严格 '<'），cutoff=落库时点 ──
  for (const q of FX) {
    const j = await jget('https://api.db.nomics.world/v22/series/ECB/EXR/' + q.series + '?observations=1');
    const doc = j.series.docs[0];
    const hist = [];
    doc.period.forEach((p, i) => { if (doc.value[i] !== null && doc.value[i] !== undefined && p < q.period) hist.push(doc.value[i]); });
    const share = hist.filter((v) => v < q.threshold).length / hist.length;
    if (share <= 0.03 || share >= 0.97) throw new Error(q.series + ' 阈值 ' + q.threshold + ' 基率越界: ' + share);
    const tail = {};
    doc.period.forEach((p, i) => { if (doc.value[i] !== null && i >= doc.period.length - 4) tail[p] = doc.value[i]; });
    QUESTIONS.push({
      gameType: 'corpus:dbnomics', layer: 'L2', engine: 'stat_baseline', prob: Number(share.toFixed(4)),
      slug: q.slug,
      statement: q.statement + '（判据冻结 cutoff=' + INGEST_AT + '，早于决定性时点；真值锚=DBnomics 同序列 ' + q.period + ' 观测值）',
      baseRateNote: '历史占比：' + q.series + ' 已发布 ' + hist.length + ' 个月值中 <' + q.threshold + ' 占 ' + (share * 100).toFixed(1) + '%（pre-cutoff 已发布口径）；近月=' + JSON.stringify(tail),
      resolve: { kind: 'dbnomics_series_value', provider: 'ECB', dataset: 'EXR', series: q.series, period: q.period, threshold: q.threshold, cmp: '<' },
    });
  }
  console.log('题目表：' + QUESTIONS.length + ' 条（L3×16 + L2×2）');
  let inserted = 0, skipped = 0;
  for (const q of QUESTIONS) {
    const gid = games[q.gameType];
    const dup = conn.prepare('SELECT id FROM predictions WHERE game_id = ? AND statement LIKE ?').get(gid, '【' + q.slug + '】%');
    if (dup) { skipped++; console.log('skip dup: id=' + dup.id, q.slug); continue; }
    const statement = '【' + q.slug + '】' + q.statement;
    const snap = { kind: 'cutoff_snapshot', slug: q.slug, ingested_at: INGEST_AT, note: q.baseRateNote, resolve: q.resolve };
    if (q.forecast) snap.forecast = q.forecast;
    if (CONFIRM) {
      const row = insertPrediction({ gameId: gid, day: 0, sourceType: '预测卡', statement, prob: q.prob, g2Regime: 'R4', maturesAt: deriveMaturesAt(q.resolve, [{ meta: q.meta }, snap]), layer: q.layer, engine: q.engine, publicExposure: 0, checklistHash: 'v2', gate: 'descriptive', evidence: [snap] });
      console.log('inserted: id=' + row.id, q.slug, '| prob=' + q.prob);
    } else {
      console.log('[dry] would insert:', q.slug, '| prob=' + q.prob, '| layer=' + q.layer);
    }
    inserted++;
  }
  const after = l0Gate();
  console.log('l0Gate after:', JSON.stringify(after));
  console.log('summary: total=' + inserted, 'skipped=' + skipped, 'confirm=' + CONFIRM);
  if (!CONFIRM) console.log('DRY-RUN：未写库。加 --confirm 执行真实落库。');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
