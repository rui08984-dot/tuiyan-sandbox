'use strict';
// 语料前瞻二轮（corpus-forward-b2，2026-09-13 施工棒）「10/11 月前瞻铺量」
// 背景：一轮 corpus-forward.cjs 出 112 条（9 月 98 + DBnomics 2026-10/11 各 4 + 双色球 6），
//       10/11 月各仅 4 条，远不够 G2「月 resolve>=30 连续 2 月」。本轮只补 2026-10 / 2026-11。
// 与一轮同风格：零 LLM、基率现算、必须落 (0.15,0.85)（越界不产题）、默认 dry-run、--confirm 才写库。
// 源①：DBnomics 月频（ECB EXR 汇率 12 序列 + ECB IRS 长端利率 8 序列）
//       × 目标月 {2026-10, 2026-11} × 每期 2 阈值 = 80 条。日历月锚定，零赛程假设。
// 源②：彩票（期号=全局计数器，可精确外推，不依赖星期/赛程）
//       双色球 9 期 × 3 组合 / 大乐透 12 期 × 3 组合。
// 真值锚（写进 evidence[0].resolve，由 scripts/corpus-resolve.cjs 机械回填，零 LLM）：
//   dbnomics_series_value / cwl_ssq_blue_odd / cwl_ssq_red_contains —— 既有 kind，直接复用。
//   dlt_draw_result —— 本轮新增 kind（corpus-resolve.cjs 需同步注册，见文件尾 NOTES）。
// 用法：node scripts/corpus-forward-b2.cjs [--confirm] [--only=dbnomics|lotto]
//       [--target-months=2026-10,2026-11] [--thresh-per=2]
const { db } = require('../src/deps');
const { insertPrediction, l0Gate, ensurePredictionsTable } = require('../src/db/predictionsStore');
const path = require('path');
const fs = require('fs');

const CONFIRM = process.argv.includes('--confirm');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
const TMONTHS = (process.argv.find((a) => a.startsWith('--target-months=')) || '').slice(16);
const THRESH_PER = Number((process.argv.find((a) => a.startsWith('--thresh-per=')) || '').slice(13)) || 2;
const BAND_LO = 0.15, BAND_HI = 0.85;
const FETCH_MS = 30000;
const now08 = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00';
const RUN_AT = now08();
const TODAY = RUN_AT.slice(0, 10);
const UA = { 'User-Agent': 'Mozilla/5.0' };

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
const inBand = (x) => x > BAND_LO && x < BAND_HI;
const pct = (x) => (x * 100).toFixed(1) + '%';
function quantile(a, p) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function isoOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addDays(iso, n) { return isoOf(Date.parse(iso + 'T00:00:00Z') + n * 86400000); }
function addMonths(ym, n) { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1; return new Date(Date.UTC(y, m + n, 1)).toISOString().slice(0, 7); }
const digitsFor = (v) => (v >= 1000 ? 1 : v >= 100 ? 2 : v >= 10 ? 3 : v >= 1 ? 4 : 5);
const isFuture = (iso) => iso > TODAY;
function C(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); }

// 目标月：默认「未来 1-2 个自然月」（今天 2026-09-13 → 2026-10 / 2026-11）
function targetMonths() {
  if (TMONTHS) return TMONTHS.split(',').map((s) => s.trim()).filter(Boolean);
  return [addMonths(TODAY.slice(0, 7), 1), addMonths(TODAY.slice(0, 7), 2)];
}
const Q_CANDS = [0.5, 0.4, 0.6, 0.3, 0.7];
// ── 源①：DBnomics 月频（ECB EXR 汇率 / ECB IRS 长端利率）──
// 为什么用月频：目标月 2026-10 / 2026-11 是「尚未发生的日历月」，真值锚=该月观测值，月内任意日 resolve
//   （现行 G2 按 resolved_at 月份计数 → 天然落 10/11 月，且零赛程/天气假设）。
// 基率：该序列 pre-cutoff 已发布的全部月值中「< 阈值」的占比，阈值取历史分位数 {0.5,0.4,0.6,0.3,0.7}，
//   取落 (0.15,0.85) 且最接近 0.5 的前 THRESH_PER 个（不同阈值 = 不同题，全部现算）。
const DB_SERIES = [
  { provider: 'ECB', dataset: 'EXR', series: 'M.USD.EUR.SP00.A', label: '美元' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.JPY.EUR.SP00.A', label: '日元' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.GBP.EUR.SP00.A', label: '英镑' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.CHF.EUR.SP00.A', label: '瑞郎' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.CNY.EUR.SP00.A', label: '人民币' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.AUD.EUR.SP00.A', label: '澳元' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.CAD.EUR.SP00.A', label: '加元' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.SEK.EUR.SP00.A', label: '瑞典克朗' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.NOK.EUR.SP00.A', label: '挪威克朗' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.KRW.EUR.SP00.A', label: '韩元' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.SGD.EUR.SP00.A', label: '新加坡元' },
  { provider: 'ECB', dataset: 'EXR', series: 'M.MXN.EUR.SP00.A', label: '墨西哥比索' },
  { provider: 'ECB', dataset: 'IRS', series: 'M.DE.L.L40.CI.0000.EUR.N.Z', label: '德国 10Y 国债收益率' },
  { provider: 'ECB', dataset: 'IRS', series: 'M.FR.L.L40.CI.0000.EUR.N.Z', label: '法国 10Y 国债收益率' },
  { provider: 'ECB', dataset: 'IRS', series: 'M.IT.L.L40.CI.0000.EUR.N.Z', label: '意大利 10Y 国债收益率' },
  { provider: 'ECB', dataset: 'IRS', series: 'M.ES.L.L40.CI.0000.EUR.N.Z', label: '西班牙 10Y 国债收益率' },
  { provider: 'ECB', dataset: 'IRS', series: 'M.NL.L.L40.CI.0000.EUR.N.Z', label: '荷兰 10Y 国债收益率' },
  { provider: 'ECB', dataset: 'IRS', series: 'M.BE.L.L40.CI.0000.EUR.N.Z', label: '比利时 10Y 国债收益率' },
  { provider: 'ECB', dataset: 'IRS', series: 'M.AT.L.L40.CI.0000.EUR.N.Z', label: '奥地利 10Y 国债收益率' },
  { provider: 'ECB', dataset: 'IRS', series: 'M.PT.L.L40.CI.0000.EUR.N.Z', label: '葡萄牙 10Y 国债收益率' },
];

async function buildDbnomics() {
  const out = [];
  const targets = targetMonths();
  for (const s of DB_SERIES) {
    let doc = null;
    try {
      const j = await jget('https://api.db.nomics.world/v22/series/' + s.provider + '/' + s.dataset + '/' + s.series + '?observations=1');
      doc = j.series && j.series.docs && j.series.docs[0];
    } catch (e) { console.log('[WARN] dbnomics ' + s.series + ' ' + String(e.message).slice(0, 60)); continue; }
    if (!doc || !doc.period || !doc.value) continue;
    const hist = [];
    doc.period.forEach((p, i) => { const v = doc.value[i]; if (v === null || v === undefined) return; if (p < targets[0]) hist.push(v); });
    if (hist.length < 60) { console.log('[WARN] dbnomics ' + s.series + ' 历史月值不足 ' + hist.length); continue; }
    const lastObs = doc.period.filter((p, i) => doc.value[i] !== null && doc.value[i] !== undefined).slice(-1)[0];
    const cands = [];
    for (const q of Q_CANDS) {
      const raw = quantile(hist, q);
      const th = Number(raw.toFixed(digitsFor(raw)));
      const share = hist.filter((x) => x < th).length / hist.length;  // 严格小于口径
      if (!inBand(share)) continue;
      if (cands.some((c) => c.th === th)) continue;
      cands.push({ q: q, th: th, share: share, d: Math.abs(share - 0.5) });
    }
    cands.sort((a, b) => a.d - b.d);
    const use = cands.slice(0, THRESH_PER);
    if (!use.length) { console.log('[WARN] dbnomics ' + s.series + ' 无落 (0.15,0.85) 阈值'); continue; }
    for (const c of use) {
      for (const period of targets) {
        if (period <= TODAY.slice(0, 7)) continue;   // 目标月必须在未来
        out.push({
          gameType: 'corpus:dbnomics', layer: 'L2', engine: 'stat_baseline_forward',
          prob: Number(c.share.toFixed(4)),
          slug: 'corpus:dbnomics-b2-' + s.series.replace(/\./g, '') + '-' + period.replace('-', '') + '-lt' + String(c.th).replace('.', ''),
          statement: '【forward】' + period + ' ' + s.label + '（' + s.series + '）月均值 < ' + c.th
            + '（cutoff=落库时点 ' + RUN_AT + '，目标月 ' + period + ' 尚未发生，月内观测发布即 resolve；真值锚=DBnomics ' + s.provider + '/' + s.dataset + ' 同序列该月观测值。前瞻二轮）',
          baseRateNote: '前瞻·' + s.series + '：pre-cutoff 已发布 ' + hist.length + ' 个月值（' + doc.period[0] + '~' + lastObs + '）中 < ' + c.th + ' 占 ' + pct(c.share) + '（历史分位 q=' + c.q + '，严格小于口径）',
          resolve: { kind: 'dbnomics_series_value', provider: s.provider, dataset: s.dataset, series: s.series, period: period, threshold: c.th, cmp: '<' },
          meta: { series: s.series, dataset: s.dataset, period: period, threshold: c.th, month: period, cutoff: RUN_AT },
        });
      }
    }
  }
  return out;
}
// ── 源②：彩票（期号=年内全局计数器，可精确外推；已实证 2025 国庆断档）──
// 实证（2026-09-13 探针，cwl 官方 dayStart/dayEnd 查询）：
//   3D 2025245..2025263 = 2025-09-25..09-30 每日 1 期 → 2025264 = 2025-10-05（10-01~10-04 国庆停售跳号）；
//   3D 2026044=2026-02-13 → 2026045=2026-02-24（春节停售，2-14~2-23 跳号）；
//   SSQ 2025113=2025-09-30 → 2025114=2025-10-05（同断档），2026019=2026-02-12 → 2026020=2026-02-24。
//  ⇒ 期号是「年内开奖序号」不是「年内天数」，故未来期号 = 上期号 + k 可精确外推（无星期/赛程假设），
//     唯一前提：不在长假断档跨越处逼近；本轮只取紧邻未来的 12~14 期（2026-09-13 之后），风险=0。
// 【预期开奖日历】只用于标注「预期 resolve 月」，不参与期号外推（期号=年内序，恒等于后续第 k 次开奖）。
// 日程实证（2026-09-13 探针，cwl 官方 dayStart/dayEnd）：双色球 周日/周二/周四；大乐透 周六/周三/周一。
// 断档：实证 2025 年 2025113=09-30 → 2025114=10-05（10-01~10-04 国庆停售跳号）。
// ⚠ 2026 年国庆停售期官方公告尚未发布（2025 年公告发布于 2025-09-24），此处按 2025 口径假定沿用，标注为「预期」。
const SSQ_DOW = [0, 2, 4];   // 日/二/四
const DLT_DOW = [1, 3, 6];   // 一/三/六
const HOLIDAY_GAP = [['2026-10-01', '2026-10-04'], ['2027-02-06', '2027-02-15']];
function expectedDrawDates(fromIso, dows, n) {
  const ans = []; let d = fromIso; let guard = 0;
  const inGap = (iso) => HOLIDAY_GAP.some((g) => iso >= g[0] && iso <= g[1]);
  while (ans.length < n && guard++ < 500) {
    d = addDays(d, 1);
    if (dows.indexOf(new Date(d + 'T00:00:00Z').getUTCDay()) === -1) continue;
    if (inGap(d)) continue;
    ans.push(d);
  }
  return ans;
}

// 基率：组合数精确值（L5 认证随机，非历史拟合），脚本内枚举/组合公式现算，必须落 (0.15,0.85)。
function* combos(n, k, start) {
  const s = start === undefined ? 1 : start;
  if (k === 0) { yield []; return; }
  for (let i = s; i <= n - k + 1; i++) {
    for (const rest of combos(n, k - 1, i + 1)) yield [i, ...rest];
  }
}
// 双色球：红 33 选 6 + 蓝 16 选 1
function ssqCombos() {
  const out = [];
  out.push({ key: 'red07', label: '红球含 07', prob: C(32, 5) / C(33, 6), resolve: { kind: 'cwl_ssq_red_contains', ball: '07' }, note: '红球含 07：C(32,5)/C(33,6)' });
  out.push({ key: 'blueodd', label: '蓝球为奇数', prob: 8 / 16, resolve: { kind: 'cwl_ssq_blue_odd' }, note: '蓝球奇数：8/16' });
  return out;
}
// 大乐透：前区 35 选 5 + 后区 12 选 2
function dltCombos() {
  const total = C(35, 5) * C(12, 2);
  const backHit = C(11, 1) * C(35, 5);          // 后区含指定号 01
  let maxLe29 = 0, size3 = 0;
  for (const c of combos(35, 5)) { if (c[4] <= 29) maxLe29++; size3++; }
  const frontMaxGe30 = 1 - maxLe29 / size3;
  return { total: total, combos: [
    { key: 'back01', label: '后区含 01', prob: backHit / total, resolve: { back_ball: '01' }, note: '后区含 01：C(11,1)*C(35,5)/[C(35,5)*C(12,2)]=11/66' },
    { key: 'fmax30', label: '前区最大号 >= 30', prob: frontMaxGe30, resolve: { front_max_ge: 30 }, note: '前区最大号>=30：1-C(29,5)/C(35,5)（枚举 ' + size3 + ' 组合现算）' },
  ] };
}

async function buildLotto() {
  const out = [];
  // 双色球（福彩）：上期号可取，向未来推 SSQ_N 期
  let ssqLast = null;
  try {
    const j = await jget('https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=3', UA);
    ssqLast = (j.result || [])[0];
  } catch (e) { console.log('[WARN] ssq last fetch: ' + String(e.message).slice(0, 60)); }
  if (ssqLast) {
    const base = Number(ssqLast.code);
    const ssqDates = expectedDrawDates(String(ssqLast.date).slice(0, 10), SSQ_DOW, SSQ_N);
    for (const cb of ssqCombos()) {
      if (!inBand(cb.prob)) { console.log('[WARN] ssq ' + cb.key + ' 基率越界 ' + cb.prob); continue; }
      for (let k = 1; k <= SSQ_N; k++) {
        const issue = String(base + k);
        const expect = ssqDates[k - 1] || null;
        out.push({
          gameType: 'corpus:cwl', layer: 'L5', engine: 'none_forward',
          prob: Number(cb.prob.toFixed(6)),
          slug: 'corpus:cwl-b2-ssq-' + issue + '-' + cb.key,
          statement: '【forward】双色球第 ' + issue + ' 期' + cb.label
            + '（cutoff=落库时点 ' + RUN_AT + '，该期尚未开奖；期号=上期 ' + ssqLast.code + '+' + k
            + ' 年内序递推；预期开奖日 ' + expect + '（周日/二/四口径，仅供标月）；真值锚=cwl 官方公告 red/blue 串。前瞻二轮）',
          baseRateNote: '前瞻·L5 认证随机：基率=' + cb.prob.toFixed(6) + '（' + cb.note + '，组合数精确值非历史拟合）',
          resolve: Object.assign({ issue: issue }, cb.resolve),
          meta: { lottery: 'ssq', issue: issue, combo: cb.key, expectDate: expect, expectMonth: expect ? expect.slice(0, 7) : null, cutoff: RUN_AT },
        });
      }
    }
  }
  // 大乐透（体彩）：上期号可取，向未来推 DLT_N 期
  let dltLast = null;
  try {
    const j = await jget('https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=3&isVerify=1&pageNo=1', { 'User-Agent': 'Mozilla/5.0', Referer: 'https://static.sporttery.cn/' });
    dltLast = ((j.value && j.value.list) || [])[0];
  } catch (e) { console.log('[WARN] dlt last fetch: ' + String(e.message).slice(0, 60)); }
  if (dltLast) {
    const base = Number(dltLast.lotteryDrawNum);
    const dltDates = expectedDrawDates(String(dltLast.lotteryDrawTime).slice(0, 10), DLT_DOW, DLT_N);
    const dc = dltCombos();
    for (const cb of dc.combos) {
      if (!inBand(cb.prob)) { console.log('[WARN] dlt ' + cb.key + ' 基率越界 ' + cb.prob); continue; }
      for (let k = 1; k <= DLT_N; k++) {
        const issue = String(base + k);
        const expect = dltDates[k - 1] || null;
        out.push({
          gameType: 'corpus:dlt', layer: 'L5', engine: 'none_forward',
          prob: Number(cb.prob.toFixed(6)),
          slug: 'corpus:dlt-b2-' + issue + '-' + cb.key,
          statement: '【forward】大乐透第 ' + issue + ' 期' + cb.label
            + '（cutoff=落库时点 ' + RUN_AT + '，该期尚未开奖；期号=上期 ' + dltLast.lotteryDrawNum + '+' + k
            + ' 年内序递推；预期开奖日 ' + expect + '（周一/三/六口径，仅供标月）；真值锚=体彩官方 lotteryDrawResult。前瞻二轮）',
          baseRateNote: '前瞻·L5 认证随机：基率=' + cb.prob.toFixed(6) + '（' + cb.note + '，组合数精确值非历史拟合）',
          resolve: Object.assign({ kind: 'dlt_draw_result', issue: issue }, cb.resolve),
          meta: { lottery: 'dlt', issue: issue, combo: cb.key, expectDate: expect, expectMonth: expect ? expect.slice(0, 7) : null, cutoff: RUN_AT },
        });
      }
    }
  }
  return out;
}
// ── 期数配置（紧邻未来，避开长假断档风险）──
const SSQ_N = 12;   // 双色球未来 12 期（约 4 周）
const DLT_N = 16;   // 大乐透未来 16 期（约 5 周）

// ── main ──
async function main() {
  const sources = [];
  if (!ONLY || ONLY === 'dbnomics') sources.push(['dbnomics', buildDbnomics]);
  if (!ONLY || ONLY === 'lotto') sources.push(['lotto', buildLotto]);
  const report = { run_at: RUN_AT, confirm: CONFIRM, band: [BAND_LO, BAND_HI], target_months: targetMonths(), thresh_per: THRESH_PER, sources: {} };
  const all = [];
  for (const [name, fn] of sources) {
    let rows = [];
    try { rows = await fn(); } catch (e) { console.log('[WARN] ' + name + ' failed: ' + String(e.message).slice(0, 160)); }
    all.push(...rows.map((r) => Object.assign({}, r, { _src: name })));
    report.sources[name] = { count: rows.length, layer: rows[0] ? rows[0].layer : null };
    console.log('[' + name + '] built ' + rows.length);
  }
  console.log('TOTAL built=' + all.length);
  // 基率带外加一道硬门：越界不产题
  const bandBad = all.filter((r) => !inBand(r.prob));
  if (bandBad.length) report.band_violations = bandBad.map((r) => r.slug);
  const rows = all.filter((r) => inBand(r.prob));
  report.built_in_band = rows.length;
  // resolve 月份预期分布
  const dist = {};
  for (const r of rows) {
    const mk = r.resolve.period || r.meta.expectMonth || (r.meta.lottery ? r.meta.lottery + '-month-unknown' : 'unknown');
    dist[mk] = (dist[mk] || 0) + 1;
  }
  report.resolve_target_dist = dist;

  db.init();
  const conn = db.getConnection();
  ensurePredictionsTable(conn);
  const gid = {};
  for (const gt of ['corpus:dbnomics', 'corpus:cwl']) {
    const row = conn.prepare('SELECT id FROM games WHERE game_type = ? LIMIT 1').get(gt);
    if (row) gid[gt] = row.id;
  }
  if (CONFIRM && !gid['corpus:dlt']) {
    const g = db.createGame('corpus-dlt-fw-b2', 'corpus:dlt', 1);
    gid['corpus:dlt'] = g.id;
    report.created_game = { game_type: 'corpus:dlt', id: g.id };
  }
  report.games = gid;
  if (CONFIRM) {
    let inserted = 0, skipped = 0;
    for (const r of rows) {
      const g = gid[r.gameType];
      if (!g) { skipped++; console.log('[skip] no game for ' + r.gameType); continue; }
      try {
        insertPrediction({
          gameId: g, day: null, sourceType: '预测卡',
          statement: r.statement, prob: r.prob,
          evidence: [{ resolve: r.resolve, baseRateNote: r.baseRateNote, meta: r.meta, kind: 'forward_batch_b2', slug: r.slug }],
          layer: r.layer, engine: r.engine, gate: 'descriptive', checklist_hash: 'v2',
        });
        inserted++;
      } catch (e) { skipped++; console.log('[skip] ' + String(e.message).slice(0, 120)); }
    }
    report.inserted = inserted; report.skipped = skipped;
    report.l0Gate_after = l0Gate();
    console.log('inserted=' + inserted + ' skipped=' + skipped);
    console.log('l0Gate after: ' + JSON.stringify(report.l0Gate_after));
  } else {
    console.log('DRY-RUN: 未写库。加 --confirm 执行。');
  }
  report.samples = rows.slice(0, 2).map((r) => r.statement);
  report.samples_dlt = rows.filter((r) => r.gameType === 'corpus:dlt').slice(0, 1).map((r) => r.statement);
  const dir = path.join(__dirname, '..', 'sim', 'out');
  // 明细报告（二轮专属，不覆盖一轮）
  const detail = path.join(dir, 'corpus-forward-b2.out');
  fs.writeFileSync(detail, JSON.stringify(report, null, 2), 'utf8');
  console.log('report → ' + detail);
  // 指名交付路径：corpus-forward.out。一轮报告先归档（仅在尚未归档时），再写二轮报告。
  const named = path.join(dir, 'corpus-forward.out');
  const arch = path.join(dir, 'corpus-forward.round1.out');
  if (fs.existsSync(named) && !fs.existsSync(arch)) { fs.copyFileSync(named, arch); report.round1_archived_to = 'corpus-forward.round1.out'; }
  fs.writeFileSync(named, JSON.stringify(report, null, 2), 'utf8');
  console.log('report → ' + named);
}

main().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });