'use strict';
// 语料库首批落库（corpus 棒 2026-09-12）：Top3 非对局题源 → 三条合成局 + 4 条 predictions。
// 语义=审计器记账（gate=descriptive，checklist_hash=v2），不进任何校准宣称；resolve 留未填，
// 由 scripts/corpus-resolve.cjs 机械回填。默认 dry-run；--confirm 才写库。
// 用法：node scripts/corpus-ingest.cjs [--confirm]
const { db } = require('../src/deps');
const { insertPrediction, l0Gate, ensurePredictionsTable } = require('../src/db/predictionsStore');

const CONFIRM = process.argv.includes('--confirm');
const now08 = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00';
const INGEST_AT = now08();

const GAMES = [
  { gameType: 'corpus:openmeteo', name: '语料库·Open-Meteo 天气（合成局·非对局）' },
  { gameType: 'corpus:dbnomics', name: '语料库·DBnomics 经济序列（合成局·非对局）' },
  { gameType: 'corpus:cwl', name: '语料库·福彩双色球（合成局·非对局）' },
];
const QUESTIONS = [
  {
    gameType: 'corpus:openmeteo',
    statement: '上海 2026-09-14 日最高气温 >35°C（判据冻结 cutoff=' + INGEST_AT + '；真值锚=Open-Meteo archive daily.temperature_2m_max[2026-09-14]）',
    layer: 'L3', engine: 'aci', prob: 0.01,
    baseRateNote: '气候基率：上海 2015-09..2024-09 共 300 个 9 月日，max>35°C 仅 3 日（Open-Meteo archive 实抓）',
    resolve: { kind: 'openmeteo_daily_max', lat: 31.23, lon: 121.47, date: '2026-09-14', threshold_c: 35, cmp: '>' },
    live: 'forecast',
  },
  {
    gameType: 'corpus:dbnomics',
    statement: '2026-09 月 USD/EUR 月均参考汇率（ECB/EXR/M.USD.EUR.SP00.A）<1.15（判据冻结 cutoff=2026-09-01T00:00+08:00；真值锚=DBnomics 同序列 2026-09 观测值）',
    layer: 'L2', engine: 'stat_baseline', prob: 0.4502,
    baseRateNote: '历史占比：月值 <1.15 共 149/331（截至 2026-07，pre-cutoff 已发布口径；2026-08 月值发布于月后未计入）',
    resolve: { kind: 'dbnomics_series_value', provider: 'ECB', dataset: 'EXR', series: 'M.USD.EUR.SP00.A', period: '2026-09', threshold: 1.15, cmp: '<' },
    refTail: { '2026-06': 1.1518, '2026-07': 1.1417, '2026-08': 1.1593 },
  },
  {
    gameType: 'corpus:cwl',
    statement: '双色球第 2026106 期红球含 07（判据冻结 cutoff=2026-09-13T21:15+08:00 开奖前；真值锚=cwl findDrawNotice code=2026106 red 数组）',
    layer: 'L5', engine: 'none', prob: 0.1818,
    baseRateNote: '组合数学：P(red 含 07)=1-C(32,6)/C(33,6)=6/33=0.1818；快照核 2026106 未开奖（最新=2026105@2026-09-10）',
    resolve: { kind: 'cwl_ssq_red_contains', issue: '2026106', ball: '07' },
  },
  {
    gameType: 'corpus:cwl',
    statement: '双色球第 2026106 期蓝球为奇数（判据冻结 cutoff=2026-09-13T21:15+08:00 开奖前；真值锚=cwl findDrawNotice code=2026106 blue 字段）',
    layer: 'L5', engine: 'none', prob: 0.5,
    baseRateNote: '组合数学：P(blue 奇数)=8/16=0.5',
    resolve: { kind: 'cwl_ssq_blue_odd', issue: '2026106' },
  },
];
const SLUGS = ['corpus:openmeteo-sh20260914-max35', 'corpus:dbnomics-usdeur-202609-lt115', 'corpus:cwl-2026106-red07', 'corpus:cwl-2026106-blueodd'];

async function fetchForecast() {
  const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=31.23&longitude=121.47&daily=temperature_2m_max&timezone=Asia%2FShanghai&forecast_days=3');
  const j = await res.json();
  const i = j.daily.time.indexOf('2026-09-14');
  return { endpoint: 'api.open-meteo.com/v1/forecast', date: '2026-09-14', temperature_2m_max_c: j.daily.temperature_2m_max[i], fetched_at: INGEST_AT };
}

function evidenceFor(q, i, live) {
  const snap = { kind: 'cutoff_snapshot', slug: SLUGS[i], ingested_at: INGEST_AT, note: q.baseRateNote, resolve: q.resolve };
  if (q.refTail) snap.reference_tail = q.refTail;
  if (live) snap.forecast = live;
  return [snap];
}

async function main() {
  db.init();
  const conn = db.getConnection();
  ensurePredictionsTable(conn);
  const before = l0Gate();
  console.log('l0Gate before:', JSON.stringify(before));
  const gameIds = {};
  for (const g of GAMES) {
    const row = conn.prepare('SELECT id FROM games WHERE game_type = ?').get(g.gameType);
    if (row) { gameIds[g.gameType] = row.id; console.log('game exists:', g.gameType, 'id=' + row.id); }
    else if (CONFIRM) {
      const created = db.createGame(g.name, g.gameType, 1);
      gameIds[g.gameType] = created.id;
      console.log('game created:', g.gameType, 'id=' + created.id);
    } else gameIds[g.gameType] = -1;
  }
  let inserted = 0, skipped = 0;
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const gid = gameIds[q.gameType];
    const statement = '【' + SLUGS[i] + '】' + q.statement;
    const dup = gid > 0 ? conn.prepare("SELECT id FROM predictions WHERE game_id = ? AND statement LIKE ?").get(gid, '【' + SLUGS[i] + '】%') : null;
    if (dup) { skipped++; console.log('skip dup: id=' + dup.id, SLUGS[i]); continue; }
    const live = q.live === 'forecast' ? await fetchForecast() : null;
    const ev = evidenceFor(q, i, live);
    if (CONFIRM) {
      const row = insertPrediction({ gameId: gid, day: 0, sourceType: '预测卡', statement, prob: q.prob, layer: q.layer, engine: q.engine, publicExposure: 0, checklistHash: 'v2', gate: 'descriptive', evidence: ev });
      console.log('inserted: prediction id=' + row.id, '| layer=' + q.layer, '| prob=' + q.prob, '| slug=' + SLUGS[i]);
    } else {
      console.log('[dry] would insert:', SLUGS[i], '| layer=' + q.layer, '| prob=' + q.prob, '| game=' + q.gameType, live ? '| forecast=' + live.temperature_2m_max_c + 'C' : '');
    }
    inserted++;
  }
  const after = l0Gate();
  console.log('l0Gate after:', JSON.stringify(after));
  console.log('summary: inserted=' + inserted, 'skipped=' + skipped, 'confirm=' + CONFIRM);
  if (!CONFIRM) console.log('DRY-RUN：未写库。加 --confirm 执行真实落库。');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

