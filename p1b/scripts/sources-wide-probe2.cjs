#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/sources-wide-probe2.cjs —— 第二期广域普查（P0-任务 9 · 2026-09-16）
 *
 * 依据：蓝图附录 A2（用户点名「金融/体育/各领域实时 API」）＋推进计划任务 9。
 * 做什么：候选源**可达性实测**（零 key 直测；要 key 的标申请路径）＋三问预检草案＋「有信号优先」排序。
 * 纪律：只读网络探测（每源一次 GET，超时上限）；零 LLM；零写库；不落任何 token。
 * 产出：p1b/sim/out/sources-wide-probe2.out（人读）＋ .jsonl（每源一行结构化）
 * 用法：node p1b/scripts/sources-wide-probe2.cjs [--timeout 12000] [--out-dir <dir>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const TIMEOUT = Number(arg('timeout', 12000));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));

/** 候选源清单（照蓝图 A2；key 列＝免 key 直测可行性；信号评级＝代理初评，待用户拍板） */
const SOURCES = [
  { id: 'fred', name: 'FRED（美联储经济数据）', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10', key: 'no', domain: '金融', signal: 'A（月度/日度宏观，基率厚）', resolver: '半天（CSV 直读）', note: 'fredgraph.csv 免 key 通道；正式 API 需 key' },
  { id: 'ecb', name: 'ECB（欧央行 SDW）', url: 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=jsondata&lastNObservations=1', key: 'no', domain: '金融', signal: 'A（汇率，dbnomics 已覆盖一半）', resolver: '半天', note: 'SDMX-JSON' },
  { id: 'coingecko', name: 'CoinGecko', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', key: 'no', domain: '金融', signal: 'A（加密 24h，天天有事件）', resolver: '半天', note: '免费层限速' },
  { id: 'alphavantage', name: 'Alpha Vantage', url: 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=demo', key: 'free-key', domain: '金融', signal: 'B（股票分钟级）', resolver: '1 天（含 key 管理）', note: 'demo key 可用；正式需免费 key' },
  { id: 'twelvedata', name: 'Twelve Data', url: 'https://api.twelvedata.com/time_series?symbol=AAPL&interval=1day&outputsize=1', key: 'key', domain: '金融', signal: 'B', resolver: '1 天', note: '无 key 预期 401/403' },
  { id: 'polygon', name: 'Polygon.io', url: 'https://api.polygon.io/v2/aggs/ticker/AAPL/prev', key: 'key', domain: '金融', signal: 'B', resolver: '1 天', note: '无 key 预期 401' },
  { id: 'oddsapi', name: 'The Odds API（体育赔率·金矿单列）', url: 'https://api.the-odds-api.com/v4/sports/', key: 'key', domain: '体育', signal: 'A+（市场概率定价＝previous_dayN 在体育域的等价物）', resolver: '1–1.5 天', note: '免费层 500 req/月；赔率可回溯性待实测' },
  { id: 'footballdata', name: 'football-data.org', url: 'https://api.football-data.org/v4/competitions', key: 'key', domain: '体育', signal: 'B+（赛程/比分；无赔率）', resolver: '1 天', note: '无 token 预期 403' },
  { id: 'nba', name: 'NBA stats（nba_api 底层）', url: 'https://stats.nba.com/stats/leaguedashteamstats?LeagueID=00&Season=2024-25&PerMode=PerGame', key: 'no?', domain: '体育', signal: 'B（需 UA/头，易 403）', resolver: '1–2 天（反爬）', note: '需浏览器级头；nba_api 为 python 包' },
  { id: 'openaq', name: 'OpenAQ', url: 'https://api.openaq.org/v3/locations?limit=1', key: 'key', domain: '环境', signal: 'A（空气质量，本域已有 openmeteo）', resolver: '1 天', note: 'v3 起需 key' },
  { id: 'usgs', name: 'USGS 地震', url: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=1&orderby=time', key: 'no', domain: '环境', signal: 'B+（事件型，曾空局需修）', resolver: '1 天', note: '免 key' },
  { id: 'swpc', name: 'NOAA SWPC 太阳活动', url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', key: 'no', domain: '航天', signal: 'A（官方存档，already 2 题在账）', resolver: '半天', note: '免 key' },
  { id: 'gdelt', name: 'GDELT', url: 'https://api.gdeltproject.org/api/v2/doc/doc?query=earthquake&mode=artlist&maxrecords=1&format=json', key: 'no', domain: '新闻', signal: 'C+（文本面，计数型可判定）', resolver: '1–2 天', note: '限速 5 秒/次' },
];

async function probe(s) {
  const t0 = Date.now();
  try {
    const res = await fetch(s.url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sandbox-probe2/1.0)' } });
    const body = await res.text();
    let shape = null;
    try { const j = JSON.parse(body); shape = Array.isArray(j) ? 'array[' + j.length + ']' : 'object{' + Object.keys(j).slice(0, 6).join(',') + '}'; } catch (e) { shape = 'text/' + (res.headers.get('content-type') || '').split(';')[0]; }
    return { status: res.status, ok: res.ok, ms: Date.now() - t0, shape: shape, head: body.slice(0, 160).replace(/\s+/g, ' '), key_required: res.status === 401 || res.status === 403 };
  } catch (e) {
    return { status: null, ok: false, ms: Date.now() - t0, shape: null, head: String(e && e.message || e).slice(0, 160), key_required: null };
  }
}

(async () => {
  const rows = [];
  console.log('=== 第二期广域普查（sources-wide-probe2）===');
  console.log('候选源 ' + SOURCES.length + ' 个；超时 ' + TIMEOUT + 'ms；零 key 直测');
  console.log('');
  for (const s of SOURCES) {
    const r = await probe(s);
    const verdict = r.ok ? (s.key === 'no' ? '可达·免key' : '可达') : (r.key_required ? '要 key（申请路径见 note）' : '不可达/受限');
    const row = Object.assign({}, s, { probe: r, verdict: verdict });
    rows.push(row);
    console.log('[' + s.id.padEnd(13) + '] ' + String(r.status === null ? 'ERR' : r.status).padEnd(4) + ' ' + String(r.ms + 'ms').padEnd(8) + ' ' + verdict + ' ｜ ' + s.signal + ' ｜ resolver≈' + s.resolver);
  }
  console.log('');
  console.log('三问预检（每源：可判定？cutoff 干净？基率合理？）——代理初评，**落库与否交用户拍板**：');
  for (const s of SOURCES) console.log('  - ' + s.id + '：可判定=待评估 ｜ cutoff=待评估 ｜ 基率=待评估（有信号优先；体育赔率单列优先）');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT_DIR, 'sources-wide-probe2.jsonl'), jsonl, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'sources-wide-probe2.out'),
    rows.map((r) => '[' + r.id + '] status=' + r.probe.status + ' ok=' + r.probe.ok + ' ms=' + r.probe.ms + ' verdict=' + r.verdict + ' signal=' + r.signal + ' resolver=' + r.resolver + ' note=' + r.note).join('\n') + '\n', 'utf8');
  console.log('');
  console.log('jsonl -> ' + path.join(OUT_DIR, 'sources-wide-probe2.jsonl'));
  console.log('out   -> ' + path.join(OUT_DIR, 'sources-wide-probe2.out'));
  console.log('（零 LLM／零写库；key 一律不入盘；勘察结论待用户拍板后才谈落库）');
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
