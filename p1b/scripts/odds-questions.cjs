#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/odds-questions.cjs —— 英超 1X2 赔率题出题器（首版 · 2026-09-17）
 *
 * 依据：`docs/specs/第二期广域普查-体育赔率接入草案-20260917.md`（首版赛制＝**英超 1X2**；用户 2026-09-17 拍板「**赔率题落库**」）
 *   ＋ 蓝图附录 A2「体育赔率＝金矿」：市场提前发布的概率定价＝ previous_dayN 信号在体育域的等价物。
 * 数据面：`p1b/sim/out/odds-snapshots-<league>.jsonl`（append-only 快照 —— **历史端点 401 ⇒ 快照即唯一可回溯记录**）
 *   ＋ 真值锚 resolver kind **`oddsapi_h2h`**（`/v4/sports/<league>/scores` 实测 HTTP 200，免费层可用）。
 *
 * 纪律（照 `corpus-thicken.cjs` 先例逐条）：
 *   · **Q0-2 cutoff 干净**：①`snapshot_utc < commence_utc`（市场价在开赛**前**发布）②**只对未来场次出题**（`commence_utc > now`）——
 *     禁止「赛后补题」（那会让账本行在已知结果的前提下建立）。
 *   · **Q0-3 基带**：入选概率须落 **(0.15, 0.85)**（照项目既有带；1X2 的平局价天然被筛掉）。
 *   · **真值锚**：每题带 `resolve{kind:'oddsapi_h2h'}`，且该 kind **有现役 resolver**（本批已加，否则题永远不结）。
 *   · **零翻转**：只 **INSERT**，不改任何既有行；**幂等**＝canonical key（resolve 规范化 JSON）＋库内查重。
 *   · **写库须 `--confirm`**；**dry-run 为默认**；★写入**单事务**（容器局＋全部 INSERT 同进同退，出错 ROLLBACK 不留半批）。
 *   · ★**非空守卫**：快照 0 批次 ⇒ **硬失败 exit 2**（safe-mutation 铁律 5：「我没观测到」≠「不存在」）。
 *
 * 首版形态（实施选择，已在收据声明）：**每场 1 题＝「主队获胜」二值题**；三路口径（主/平/客）与逐家原始赔率
 *   **全部留档在 evidence.marketPrice** 与快照文件里 ⇒ 日后扩平局/客胜题**不必重取**。
 * 用法：node p1b/scripts/odds-questions.cjs [--confirm] [--max 24] [--cap 100] [--league soccer_epl] [--db <path>] [--snapshots <file>] [--report-dir <dir>]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const CONFIRM = process.argv.indexOf('--confirm') !== -1;
const LEAGUE = arg('league', 'soccer_epl');
const SNAPSHOTS = arg('snapshots', path.join(ROOT, 'p1b', 'sim', 'out', 'odds-snapshots-' + LEAGUE + '.jsonl'));
const DB_ARG = arg('db', null);
const MAX_PER_RUN = Number(arg('max', '24'));
const REPORT_DIR = arg('report-dir', path.join(ROOT, '.scratch', 'backtest'));   // ★报告目录可注入（测试须写 tmp，禁覆盖仓库产物）
const CAP = Number(arg('cap', '100'));   // 首版上限（取自草案 §3 的配额讨论：≈100 题量级）
const LO = 0.15, HI = 0.85;
const KIND = 'oddsapi_h2h';

// ── 纯函数区（可 require，零副作用；**1X2 判定规则单一实现**，resolver 亦 require 本函数）──
/** 1X2 判定（单一实现）：主队胜/负 ⇒ 二值；`pick` 缺省为主胜。平局（含点球前的常规时间平局）⇒ 主胜为 false。 */
function h2hOutcome(homeScore, awayScore, pick) {
  const h = Number(homeScore), a = Number(awayScore);
  if (!isFinite(h) || !isFinite(a)) return null;
  const homeWin = h > a;
  if (!pick || pick === 'home') return { outcome: homeWin ? 'true' : 'false', detail: h + '-' + a };
  if (pick === 'away') return { outcome: (!homeWin && h !== a) ? 'true' : 'false', detail: h + '-' + a };
  if (pick === 'draw') return { outcome: (h === a) ? 'true' : 'false', detail: h + '-' + a };
  return null;
}
/** canonical key（**不猜字段名**：resolve 键排序后规范化 JSON，剔掉易变字段）——照 corpus-thicken 先例。 */
function canonKey(r) {
  if (!r || typeof r !== 'object') return null;
  const drop = new Set(['url', 'field', 'note', 'cutoff']);
  const keys = Object.keys(r).filter((k) => !drop.has(k)).sort();
  const norm = {};
  for (const k of keys) norm[k] = r[k];
  return JSON.stringify(norm);
}
const inBand = (x) => typeof x === 'number' && isFinite(x) && x > LO && x < HI;

/**
 * 从快照批中挑候选题（纯函数）。
 * @param {Array} batches 快照批（每批 {snapshot_utc, league, matches:[{id, commence_utc, home, away, consensus}]}）
 * @param {{nowIso:string, league:string, pick?:string}} opts
 * @returns {{cands:Array, skipped:Object}} 候选＝可就地入库的题对象；skipped 为逐因计数（如实披露）
 */
function pickQuestions(batches, opts) {
  const o = opts || {};
  const now = String(o.nowIso || new Date().toISOString());
  const league = o.league || LEAGUE;
  const pick = o.pick || 'home';
  const cands = []; const skipped = { past_kickoff: 0, snapshot_after_kickoff: 0, no_consensus: 0, out_of_band: 0, dup_in_batch: 0 };
  const seen = new Set();
  for (const b of (batches || [])) {
    const snap = String(b && b.snapshot_utc || '');
    if (!snap || (b.league && b.league !== league)) continue;
    for (const m of (b.matches || [])) {
      const cm = String(m && m.commence_utc || '');
      if (!cm || cm <= now) { skipped.past_kickoff++; continue; }          // Q0-2②：只对未来场次出题
      if (!(snap < cm)) { skipped.snapshot_after_kickoff++; continue; }     // Q0-2①：市场价须在开赛前
      const c = m.consensus || {};
      const ps = Array.isArray(c.probs_mean) ? c.probs_mean : null;
      const idx = pick === 'home' ? 0 : (pick === 'draw' ? 1 : 2);
      const p = ps ? Number(ps[idx]) : NaN;
      if (!ps || !isFinite(p)) { skipped.no_consensus++; continue; }
      if (!inBand(p)) { skipped.out_of_band++; continue; }                  // Q0-3 基带
      const resolve = { kind: KIND, league: league, match_id: String(m.id), commence_utc: cm, pick: pick, snapshot_utc: snap };
      const ck = canonKey(resolve);
      if (seen.has(ck)) { skipped.dup_in_batch++; continue; }
      seen.add(ck);
      const leadH = (Date.parse(cm) - Date.parse(snap)) / 3600000;
      const home = String(m.home || ''), away = String(m.away || '');
      const label = pick === 'home' ? '主队获胜' : (pick === 'away' ? '客队获胜' : '两队战平');
      cands.push({
        canon: ck, prob: p, resolve: resolve, lead_hours: Number(leadH.toFixed(2)), home: home, away: away,
        statement: '【forward】英超 ' + home + ' vs ' + away + '（' + String(cm).slice(0, 10) + ' 开赛）' + label,
        marketPrice: {
          league: league, match_id: String(m.id), snapshot_utc: snap, lead_hours: Number(leadH.toFixed(2)),
          devig: 'multiplicative', n_books: c.n_books === undefined ? null : c.n_books,
          p_home: ps ? Number(ps[0]) : null, p_draw: ps ? Number(ps[1]) : null, p_away: ps ? Number(ps[2]) : null,
          p_pick: p, pick: pick, prices_best: c.prices_best || null, source: 'the-odds-api v4 /v4/odds (h2h)',
          snapshot_file: path.basename(SNAPSHOTS), note: '三路口径与逐家原始赔率见 snapshot_file（append-only 留档）',
        },
        matures_at: String(cm).slice(0, 10),
      });
    }
  }
  cands.sort((a, b) => (a.resolve.commence_utc < b.resolve.commence_utc ? -1 : 1));   // 早开赛者优先
  return { cands: cands, skipped: skipped };
}
/** 读快照 jsonl（每行一批）。 */
function loadBatches(file) {
  const txt = fs.readFileSync(file, 'utf8');
  return txt.split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}

// ── 主流程（只在 CLI 直跑；require 不写盘、不读库） ───────────────────────────
function main() {
  const deps = require(path.join(ROOT, 'p1b/src/deps'));
  if (DB_ARG) deps.db.init(DB_ARG);
  const conn = deps.db.getConnection();
  const { insertPrediction } = require(path.join(ROOT, 'p1b/src/db/predictionsStore'));

  const batches = loadBatches(SNAPSHOTS);
  // ★非空守卫（safe-mutation 铁律 5）：「我没观测到」≠「不存在」——快照文件读不到批次时**硬失败**，
  //   禁静默报「候选 0」（那会被误读成「题都已建」）。
  if (!batches.length) { console.error('!! 快照文件 0 批次（' + SNAPSHOTS + '）⇒ 硬失败（不猜、不写）'); process.exit(2); }
  const nowIso = new Date().toISOString();
  const { cands, skipped } = pickQuestions(batches, { nowIso: nowIso, league: LEAGUE });
  // 幂等：载入库内既有 canonical key（本 kind 全部）
  const exist = new Set();
  for (const row of conn.prepare('SELECT evidence_json FROM predictions WHERE evidence_json LIKE ?').all('%"kind":"' + KIND + '"%')) {
    try { const r = JSON.parse(row.evidence_json)[0].resolve; const ck = canonKey(r); if (ck) exist.add(ck); } catch (e) { /* ignore */ }
  }
  const kindN = conn.prepare('SELECT COUNT(*) c FROM predictions WHERE evidence_json LIKE ?').get('%"kind":"' + KIND + '"%').c;
  const picked = [];
  for (const c of cands) {
    if (picked.length >= MAX_PER_RUN || kindN + picked.length >= CAP) break;
    if (exist.has(c.canon)) continue;
    exist.add(c.canon);
    picked.push(c);
  }
  const report = { run_at: nowIso, league: LEAGUE, snapshots: SNAPSHOTS, snapshots_batches: batches.length, confirm: CONFIRM,
    dry_run: !CONFIRM, now: nowIso, candidates: cands.length, skipped: skipped, existing_kind_rows: kindN, cap: CAP, max_per_run: MAX_PER_RUN,
    picked: picked.map((c) => ({ canon: c.canon, statement: c.statement, prob: c.prob, lead_hours: c.lead_hours, matures_at: c.matures_at })),
    inserted: 0, errors: [] };

  if (CONFIRM) {
    // ★单事务（safe-mutation 第 3 步）：容器局 ＋ 全部 INSERT 同进同退；失败即 ROLLBACK（不留半批）。
    conn.exec('BEGIN');
    // 语料容器局（照 corpus:<domain> 先例；player_count=1 合成局、source='corpus' 均 NOT NULL）
    let g = conn.prepare('SELECT id FROM games WHERE game_type = ?').get('corpus:oddsapi');
    let gid = g ? g.id : null;
    if (!gid) {
      const info = conn.prepare('INSERT INTO games (game_type, name, player_count, created_at, source) VALUES (?,?,?,?,?)')
        .run('corpus:oddsapi', '语料库·oddsapi（合成局·非对局）', 1, nowIso, 'corpus');
      gid = Number(info.lastInsertRowid);
    }
    for (const c of picked) {
      try {
        const ev = [{
          resolve: c.resolve,
          marketPrice: c.marketPrice,
          meta: { phase: 'forward', cutoff: c.resolve.snapshot_utc, odds: true, version: 'EPL-1X2-v1', pick: c.resolve.pick },
          phase: 'forward', kind: KIND,
        }];
        insertPrediction({
          gameId: gid, day: 1, sourceType: '预测卡', statement: c.statement,
          prob: c.prob, evidence: ev, layer: 'L2', maturesAt: c.matures_at, g2Regime: 'R4',
        });
        report.inserted++;
      } catch (e) { report.errors.push(c.canon + ': ' + e.message); }
    }
    if (report.errors.length) { try { conn.exec('ROLLBACK'); } catch (e2) { /* ignore */ } report.rolled_back = true; report.inserted = 0; console.error('!! 写入出现 ' + report.errors.length + ' 处错误 ⇒ 已 ROLLBACK（整批不落）'); }
    else { conn.exec('COMMIT'); report.committed = true; }
  }
  const p = path.join(REPORT_DIR, 'odds-questions-report-' + nowIso.slice(0, 10) + '.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(report, null, 1), 'utf8');
  console.log('=== 赔率题出题器（' + LEAGUE + ' · 首版 ' + KIND + '）===');
  console.log('  快照批 ' + batches.length + '｜候选 ' + cands.length + '（跳过 ' + JSON.stringify(skipped) + '）');
  console.log('  库内既有本 kind ' + kindN + ' 题｜本次选中 ' + picked.length + '（cap ' + CAP + '／每次 ' + MAX_PER_RUN + '）');
  for (const c of picked.slice(0, 5)) console.log('   · ' + c.statement + '｜p=' + c.prob.toFixed(4) + '｜前置 ' + c.lead_hours + 'h');
  if (picked.length > 5) console.log('   · …（共 ' + picked.length + '）');
  console.log(CONFIRM ? ('  ✔ 已写入 ' + report.inserted + ' 行' + (report.errors.length ? ('，错误 ' + report.errors.length) : '')) : '  DRY-RUN：未写库。加 --confirm 执行。');
  console.log('  报告 -> ' + p);
  if (deps.db.closeCurrent) deps.db.closeCurrent();
}
module.exports = { h2hOutcome, canonKey, inBand, pickQuestions, loadBatches, LO, HI, KIND };
if (require.main === module) { main(); }
