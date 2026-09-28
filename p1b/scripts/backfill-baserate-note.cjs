'use strict';
/*
 * backfill-baserate-note.cjs —— G2 R4 池内缺失 evidence.baseRateNote 的补齐器（additive，只加 key）
 * 口径：与生成批同源反推 —— 重取主源，按生成脚本体口径重算 pre-cutoff 基率：
 *   生成批 = corpus-ingest.cjs / corpus-ingest-b2.cjs / corpus-backfill.cjs
 *   - openmeteo_daily_max   : 回填=2015-2023 同月日值；前瞻=2015-2024 全部 9 月日（corpus-ingest-b2 同 URL/窗）
 *   - dbnomics_series_value : pre = 已发布月值 p < period；行内注记若写「截至 YYYY-MM」则收紧到该月（严格遵守 cutoff）
 *   - cwl_ssq_*             : pre = findDrawNotice(issueCount=30) 中该期之前已开奖期（corpus-backfill 同窗）；
 *                             前瞻期超出 30 期窗 ⇒ 按组合数学（corpus-ingest.cjs 同口径）
 * 纪律：①只取 cutoff 严格之前样本；②n<100 显式写「样本不足 n=」；③只 ADD baseRateNote，其余键逐字不动。
 * 用法：node p1b/scripts/backfill-baserate-note.cjs [--confirm] [--only=<kind>] [--report=<json>] [--db=<db>]
 *   注：--report/--db 支持 `--x=v` 与 `--x v` 两种写法（v1 只认 `=`，曾致首轮 --report 落空）。
 *        默认 dry-run（零写入）；--confirm 才在事务内 UPDATE。
 */
const fs = require('fs');
const Database = require('E:/music player/p1a-terminal/node_modules/better-sqlite3');
const DB_PATH = 'E:/music player/p1a-terminal/data/p1a.db';
const CONFIRM = process.argv.includes('--confirm');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
function arg(name) {
  const eq = process.argv.find((a) => a.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : null;
}
const REPORT = arg('report');
const DBP = arg('db') || DB_PATH;
const UA = 'corpus-brn-backfill/1.0 (research; +node)';
const KINDS = ['openmeteo_daily_max', 'dbnomics_series_value', 'cwl_ssq_red_contains', 'cwl_ssq_blue_odd'];
const pct = (x) => (x * 100).toFixed(1);
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
async function jget(url, h) {
  let last = null;
  for (let a = 0; a < 3; a++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, h || {}) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; if (a < 2) await sleep(1500); }
    finally { clearTimeout(t); }
  }
  throw last;
}
const cmpHit = (v, cmp, th) => cmp === '>=' ? v >= th : (cmp === '>' ? v > th : (cmp === '<=' ? v <= th : v < th));
const OM_CITY = { '31.23,121.47': '上海', '39.9,116.41': '北京', '23.13,113.26': '广州', '30.57,104.07': '成都' };
const OM_U = (lat, lon, a, b) => 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat + '&longitude=' + lon + '&start_date=' + a + '&end_date=' + b + '&daily=temperature_2m_max&timezone=Asia%2FShanghai';
const DB_U = 'https://api.db.nomics.world/v22/series/ECB/EXR/M.USD.EUR.SP00.A?observations=1';
const CWL_U = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30';
const CWL_H = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/' };
const omCache = new Map();
async function omSeries(lat, lon) {
  const k = lat + ',' + lon;
  if (!omCache.has(k)) {
    const j = await jget(OM_U(lat, lon, '2015-01-01', '2024-12-31'));
    const out = [];
    (j.daily.time || []).forEach((d, i) => { const v = j.daily.temperature_2m_max[i]; if (v !== null && v !== undefined && isFinite(v)) out.push({ d: d, v: v }); });
    omCache.set(k, out);
  }
  return omCache.get(k);
}
let dbnCache = null;
async function dbnObs() {
  if (!dbnCache) {
    const j = await jget(DB_U);
    const doc = j.series.docs[0];
    dbnCache = doc.period.map((p, i) => ({ p: p, v: doc.value[i] })).filter((x) => x.v !== null && x.v !== undefined && isFinite(x.v));
  }
  return dbnCache;
}
let cwlCache = null;
async function cwlDraws() {
  if (!cwlCache) { const j = await jget(CWL_U, CWL_H); cwlCache = (j.result || []).slice().sort((a, b) => (a.code < b.code ? -1 : 1)); }
  return cwlCache;
}
const smallN = (n) => (n !== null && n !== undefined && n < 100) ? ('样本不足 n=' + n + '；') : '';
async function noteOpenmeteo(resolve, isBF) {
  const ser = await omSeries(resolve.lat, resolve.lon);
  const city = OM_CITY[resolve.lat + ',' + resolve.lon] || (resolve.lat + ',' + resolve.lon);
  const mm = String(resolve.date).slice(5, 7);
  const th = Number(resolve.threshold_c), cmp = resolve.cmp || '>';
  const pre = isBF ? ser.filter((x) => x.d.slice(0, 4) < '2024' && x.d.slice(5, 7) === mm)
                   : ser.filter((x) => x.d.slice(5, 7) === '09');
  const n = pre.length;
  if (!n) return { note: '样本不足 n=0（Open-Meteo archive 重取为空，无法反推基率）', n: 0, hit: null };
  const hit = pre.filter((x) => cmpHit(x.v, cmp, th)).length / n;
  const head = isBF
    ? ('历史回填·' + city + ' ' + mm + '月：2015-2023 同月共 ' + n + ' 个历史日值（pre-cutoff 窗，同批阈值=同月中位数），max' + cmp + th + '°C ')
    : ('气候基率：' + city + ' 2015-2024 共 ' + n + ' 个 9 月日，max' + cmp + th + '°C ');
  return { note: head + '占 ' + pct(hit) + '%（' + smallN(n) + 'Open-Meteo archive 实抓，严格' + (cmp === '>' ? '大于' : '比较') + '口径）', n: n, hit: hit };
}
async function noteDbnomics(resolve, isBF, storedNote) {
  const obs = await dbnObs();
  const period = String(resolve.period), th = Number(resolve.threshold), cmp = resolve.cmp || '<';
  const cap = /截至\s*(\d{4}-\d{2})/.exec(String(storedNote || ''));
  let pre = obs.filter((x) => x.p < period);
  if (cap && cap[1] < period) pre = pre.filter((x) => x.p <= cap[1]);
  const n = pre.length;
  if (!n) return { note: '样本不足 n=0（DBnomics 重取为空，无法反推基率）', n: 0, hit: null };
  const hit = pre.filter((x) => cmpHit(x.v, cmp, th)).length / n;
  const head = isBF
    ? ('历史回填·USD/EUR ' + period + '：cutoff 前已发布 ' + n + ' 个月值中 ' + cmp + th + ' ')
    : ('前瞻·' + resolve.series + '：pre-cutoff 已发布 ' + n + ' 个月值中 ' + cmp + th + ' ');
  return { note: head + '占 ' + pct(hit) + '%（' + smallN(n) + 'DBnomics ECB/EXR 实抓，pre-cutoff 已发布口径）', n: n, hit: hit, capped: cap ? cap[1] : null };
}
async function noteCwl(kind, resolve) {
  const draws = await cwlDraws();
  const issue = String(resolve.issue);
  const idx = draws.findIndex((d) => d.code === issue);
  const isRed = kind === 'cwl_ssq_red_contains';
  if (idx < 0) {
    return { note: isRed
      ? ('前瞻·L5 认证随机：基率=组合数理论值 0.1818（1-C(32,6)/C(33,6)=6/33，' + issue + ' 快照未开奖，非历史拟合）')
      : ('前瞻·L5 认证随机：基率=组合数理论值 0.5000（8/16，' + issue + ' 快照未开奖，非历史拟合）'),
      n: null, hit: isRed ? 6 / 33 : 0.5, basis: 'combinatorial' };
  }
  const pre = draws.slice(0, idx); const n = pre.length;
  if (isRed) {
    const ball = String(resolve.ball);
    const hit = pre.filter((x) => String(x.red).split(',').indexOf(ball) !== -1).length / n;
    return { note: '历史回填·双色球 red 含 ' + ball + '：cutoff 前 ' + n + ' 期中命中 ' + pct(hit) + '%（' + smallN(n) + 'cwl 官方公告实抓，pre-cutoff 窗）', n: n, hit: hit };
  }
  const hit = pre.filter((x) => Number(x.blue) % 2 === 1).length / n;
  return { note: '历史回填·双色球 blue 奇数：cutoff 前 ' + n + ' 期中占 ' + pct(hit) + '%（' + smallN(n) + 'cwl 官方公告实抓，pre-cutoff 窗）', n: n, hit: hit };
}
async function main() {
  const db = new Database(DBP);
  const targets = [];
  for (const kind of KINDS) {
    if (ONLY && ONLY !== kind) continue;
    const rows = db.prepare(
      "SELECT p.id, p.created_at, p.statement, p.evidence_json, e.key AS ek, " +
      "json_extract(e.value,'$.note') AS stored_note, " +
      "COALESCE(json_extract(e.value,'$.cutoff'), p.created_at) AS cutoff, " +
      "json_extract(e.value,'$.resolve') AS resolve_json " +
      "FROM predictions p, json_each(p.evidence_json) e " +
      "WHERE p.g2_regime='R4' AND json_extract(e.value,'$.resolve.kind')=? AND json_extract(e.value,'$.baseRateNote') IS NULL"
    ).all(kind);
    rows.forEach((r) => targets.push({ kind: kind, r: r }));
  }
  console.log('[target] 拟补注记行数=' + targets.length + ' (confirm=' + CONFIRM + ')');
  const report = { generated_at: new Date().toISOString(), db: DBP, confirm: CONFIRM, script: 'p1b/scripts/backfill-baserate-note.cjs', rows: [] };
  const updates = [];
  for (const t of targets) {
    const kind = t.kind, r = t.r;
    const resolve = JSON.parse(r.resolve_json);
    const isBF = String(r.statement || '').indexOf('【backfill】') >= 0;
    let m;
    if (kind === 'openmeteo_daily_max') m = await noteOpenmeteo(resolve, isBF);
    else if (kind === 'dbnomics_series_value') m = await noteDbnomics(resolve, isBF, r.stored_note);
    else m = await noteCwl(kind, resolve);
    const ev = JSON.parse(r.evidence_json);
    if (JSON.stringify(ev) !== r.evidence_json) throw new Error('JSON round-trip 非字节等值 id=' + r.id);
    if (!ev[r.ek] || !ev[r.ek].resolve || ev[r.ek].resolve.kind !== kind) throw new Error('resolve 元素错位 id=' + r.id);
    ev[r.ek].baseRateNote = m.note;
    const next = JSON.stringify(ev);
    const back = JSON.parse(next); delete back[r.ek].baseRateNote;
    if (JSON.stringify(back) !== r.evidence_json) throw new Error('非纯 add 变更 id=' + r.id);
    const sp = (/([0-9]+(?:\.[0-9]+)?)\s*%/.exec(String(r.stored_note || '')) || [])[1] || null;
    const agree = sp === null ? null : (sp === pct(m.hit));
    updates.push({ id: r.id, next: next });
    report.rows.push({ id: r.id, kind: kind, cutoff: r.cutoff, backfill: isBF, n: m.n, hit: m.hit === null ? null : Number(m.hit.toFixed(4)), pct_recomputed: m.hit === null ? null : pct(m.hit), stored_pct: sp, agree: agree, basis: m.basis || null, capped: m.capped || null, note: m.note, before_note: r.stored_note });
  }
  const byKind = {};
  report.rows.forEach((x) => {
    const g = byKind[x.kind] = byKind[x.kind] || { n: 0, agree: 0, disagree: 0, noStored: 0, smallN: 0 };
    g.n++;
    if (x.agree === true) g.agree++; else if (x.agree === false) g.disagree++; else g.noStored++;
    if (x.n !== null && x.n < 100) g.smallN++;
  });
  report.by_kind = byKind;
  console.log('[reconcile] ' + JSON.stringify(byKind));
  for (const kind of Object.keys(byKind)) {
    const rs = report.rows.filter((x) => x.kind === kind);
    console.log('--- ' + kind + ' n=' + rs.length + ' (抽样 3) ---');
    rs.slice(0, 3).forEach((x) => {
      console.log('  id=' + x.id + ' cutoff=' + x.cutoff + ' n=' + x.n + ' hit=' + (x.hit === null ? 'n/a' : x.hit) + ' 重算=' + x.pct_recomputed + '% 存注记=' + x.stored_pct + '% agree=' + x.agree + (x.capped ? ' cap=' + x.capped : ''));
      console.log('    before: ' + String(x.before_note).slice(0, 130));
      console.log('    after : ' + x.note);
    });
  }
  const dis = report.rows.filter((x) => x.agree === false);
  console.log('[reconcile] 与存量注记不一致=' + dis.length + (dis.length ? ' ids=' + dis.map((x) => x.id).join(',') : ''));
  if (REPORT) { fs.writeFileSync(REPORT, JSON.stringify(report, null, 1)); console.log('[report] -> ' + REPORT); }
  if (!CONFIRM) { console.log('DRY-RUN：未写库。加 --confirm 执行。'); db.close(); return; }
  // 收口 A（2026-09-28）：`AND outcome IS NULL` 原子守卫。
  // evidence_json 装着 resolve 真值 spec ⇒ 已落定行的判定依据不可被回填改写。
  // 条件与赋值同在一条 SQL 里，靠 SQLite 单语句原子性挡掉「选题→写回」之间的并发落定。
  // 本脚本只 ADD baseRateNote（上面已逐行验过纯 add 变更），但纯加也不许加到已落定行上。
  const upd = db.prepare('UPDATE predictions SET evidence_json=? WHERE id=? AND outcome IS NULL');
  let blocked = 0;
  const tx = db.transaction((us) => { for (const u of us) { if (upd.run(u.next, u.id).changes === 0) blocked++; } });
  tx(updates);
  console.log('[write] UPDATEd rows=' + (updates.length - blocked) + ' | 守卫拒改(已落定):' + blocked);
  const left = db.prepare("SELECT COUNT(DISTINCT p.id) n FROM predictions p, json_each(p.evidence_json) e WHERE p.g2_regime='R4' AND json_extract(e.value,'$.resolve.kind') IN ('openmeteo_daily_max','dbnomics_series_value','cwl_ssq_red_contains','cwl_ssq_blue_odd') AND json_extract(e.value,'$.baseRateNote') IS NULL").get().n;
  console.log('[verify] 池内缺 baseRateNote 剩余=' + left);
  console.log('[verify] integrity_check=' + db.prepare('PRAGMA integrity_check').get().integrity_check);
  db.close();
}
main().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });