#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/odds-snapshot.cjs —— 体育赔率·前瞻快照采集（2026-09-17）
 *
 * 依据：`docs/specs/第二期广域普查-体育赔率接入草案-20260917.md`
 *   §5② 实测结论＝**免费层未开放历史端点（HTTP 401）⇒ 只能前瞻出题（今日起攒样本）**；
 *   蓝图附录 A2「体育赔率＝金矿」：市场提前发布的概率定价＝ previous_dayN 信号在体育域的等价物 ⇒ 第二路信号臂。
 * 为什么「现在就得采」：**历史端点不可用 ⇒ 快照本身就是唯一可回溯的记录**（过期不补）。
 *
 * 做什么（**零账本写／零 LLM**；只读外部 API ＋ append-only 落 sim/out）：
 *   · 取指定联赛的**未开赛**场次 h2h（1X2）赔率 ⇒ 逐场记录：开赛时刻、对阵、**各博彩公司原始赔率**、
 *     去水后的共识概率（三类：等权均值／中位数／最佳价，**原始赔率一并留档**以便日后换去水法而不必重取）。
 *   · 每次采集 append 到 `p1b/sim/out/odds-snapshots-<league>.jsonl`（一行一快照批，含 `snapshot_utc`＝cutoff 锚）。
 *   · 配额头（remaining/used）随批记录 ⇒ 配额可审计。
 * 配额纪律（用户授权「你自己看着办」后定）：免费层 500 req/月 ⇒ **降频每 3 日一次快照**（≈10 req/日 ⇒ 月 ≈300）。
 *   本脚本内置冷却闸：距上次快照 <2 日 ⇒ **跳过并退出码 3**（除非 `--force`，且如实标注 force）。
 * 用法：
 *   node p1b/scripts/odds-snapshot.cjs [--league soccer_epl] [--regions eu] [--force] [--dry]
 *   env：ODDS_CONFIG 覆盖配置路径（默认 p1a-terminal/config/odds.json，gitignored）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const CFG = process.env.ODDS_CONFIG || path.join(ROOT, 'p1a-terminal', 'config', 'odds.json');
const LEAGUE = arg('league', 'soccer_epl');
const REGIONS = arg('regions', 'eu');
const FORCE = process.argv.indexOf('--force') !== -1;
const DRY = process.argv.indexOf('--dry') !== -1;
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const COOLDOWN_H = 48;
const mask = (s) => (s && s.length > 6 ? s.slice(0, 3) + '***' + s.slice(-2) : '(缺)');

// ── 纯函数区（可 require，零副作用） ─────────────────────────────────────────
/** 去水（multiplicative）：三路隐含概率归一（1/odd 后除以和）。 */
function devig(prices) { const inv = prices.map((o) => 1 / o); const s = inv.reduce((a, b) => a + b, 0); return inv.map((x) => x / s); }
/** 共识三口径：等权均值／中位数／最佳价（各取其最有利的一条赔率）。 */
function consensus(bookmakers, homeTeam, awayTeam) {
  const rows = [];
  for (const b of bookmakers) {
    const m = (b.markets || []).find((x) => x.key === 'h2h'); if (!m) continue;
    const p = { home: null, draw: null, away: null };
    for (const o of m.outcomes) { if (o.name === homeTeam) p.home = o.price; else if (o.name === awayTeam) p.away = o.price; else p.draw = o.price; }
    if (p.home && p.draw && p.away) rows.push({ book: b.key, prices: p, probs: devig([p.home, p.draw, p.away]) });
  }
  if (!rows.length) return null;
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const norm = (v) => { const s = v.reduce((a, b) => a + b, 0); return s > 0 ? v.map((x) => x / s) : v; };
  const meanV = [mean(rows.map((r) => r.probs[0])), mean(rows.map((r) => r.probs[1])), mean(rows.map((r) => r.probs[2]))];
  // ★ 逐路中位数**天然不保证和为 1**（各列中位数不同源）⇒ 归一后再作为概率向量（原值一并留档，便于日后换口径）
  const medRaw = [med(rows.map((r) => r.probs[0])), med(rows.map((r) => r.probs[1])), med(rows.map((r) => r.probs[2]))];
  return {
    n_books: rows.length,
    probs_mean: meanV,                       // 每家各自去水后取均值 ⇒ 和恒为 1
    probs_median: norm(medRaw),              // 归一后的中位数共识
    probs_median_raw: medRaw,                // 未归一中位数（留档；其和 ≠ 1 属正常）
    prices_best: [Math.max.apply(null, rows.map((r) => r.prices.home)), Math.max.apply(null, rows.map((r) => r.prices.draw)), Math.max.apply(null, rows.map((r) => r.prices.away))],
    books: rows,
  };
}

async function main() {
  if (!fs.existsSync(CFG)) { console.error('未配置：' + CFG + '（{"api_key":"..."}）'); process.exit(2); }
  let cfg = null; try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (e) { cfg = null; }
  const key = cfg && (cfg.api_key || cfg.key); if (!key) { console.error('配置缺 api_key'); process.exit(2); }
  const BASE = cfg.base_url || 'https://api.the-odds-api.com/v4';
  const OUT = path.join(OUT_DIR, 'odds-snapshots-' + LEAGUE + '.jsonl');

  // 冷却闸（配额纪律）
  let last = null;
  if (fs.existsSync(OUT)) {
    const ls = fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean);
    if (ls.length) { try { last = JSON.parse(ls[ls.length - 1]).snapshot_utc; } catch (e) { last = null; } }
  }
  if (last && !FORCE) {
    const hrs = (Date.now() - Date.parse(last)) / 3600000;
    if (hrs < COOLDOWN_H) { console.log('冷却中：上次快照 ' + last + '（' + hrs.toFixed(1) + 'h 前 < ' + COOLDOWN_H + 'h）⇒ 跳过（配额纪律；--force 可强制）'); process.exit(3); }
  }

  const url = BASE + '/sports/' + LEAGUE + '/odds/?apiKey=' + encodeURIComponent(key) + '&regions=' + REGIONS + '&markets=h2h&oddsFormat=decimal';
  const res = await fetch(url);
  const heads = {}; for (const k of ['x-requests-remaining', 'x-requests-used', 'x-requests-last']) { const v = res.headers.get(k); if (v !== null) heads[k] = v; }
  if (!res.ok) { console.error('HTTP ' + res.status + '：' + (await res.text()).slice(0, 200)); process.exit(4); }
  const games = await res.json();
  const snapshot_utc = new Date().toISOString();
  const matches = [];
  for (const g of games || []) {
    const c = consensus(g.bookmakers || [], g.home_team, g.away_team);
    if (!c) continue;
    matches.push({ id: g.id, commence_utc: g.commence_time, home: g.home_team, away: g.away_team, consensus: c });
  }
  const rec = {
    schema: 'odds-snapshot.v1', snapshot_utc: snapshot_utc, league: LEAGUE, regions: REGIONS, market: 'h2h',
    forced: FORCE, n_matches: matches.length, quota_headers: heads, key_masked: mask(key),
    cutoff_note: 'cutoff 锚＝snapshot_utc（本快照为该时刻市场定价）；**历史端点不可用 ⇒ 本行是唯一记录，禁删**',
    matches: matches,
  };
  console.log('=== 赔率前瞻快照（' + LEAGUE + '）===');
  console.log('  snapshot_utc=' + snapshot_utc + '｜未开赛场次 ' + matches.length + '｜配额 ' + JSON.stringify(heads));
  for (const m of matches.slice(0, 5)) console.log('   ' + m.commence_utc.slice(0, 16) + ' ' + m.home + ' vs ' + m.away
    + '  P(主/平/客)=' + m.consensus.probs_median.map((x) => x.toFixed(3)).join('/') + '（' + m.consensus.n_books + ' 家）');
  if (DRY) { console.log('（--dry：不落盘）'); return; }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(OUT, JSON.stringify(rec) + '\n', 'utf8');
  console.log('append -> ' + OUT);
}

module.exports = { devig, consensus, main };
// ★ require 安全（照项目范式）：主流程只在 CLI 直跑时执行；require 本件只取纯函数，不读配置、不发请求、不写盘。
if (require.main === module) { main().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); }); }
