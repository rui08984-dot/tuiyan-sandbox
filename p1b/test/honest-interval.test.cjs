'use strict';
/**
 * p1b/test/honest-interval.test.cjs —— 「诚实区间」只读端点 GET /api/baseline/:kind 测试。
 *
 * 本轮产品形态：**要么给一个数、要么明说给不了并给出保证覆盖的区间**，不假装精确。
 * 本文件锁的是这条纪律本身：
 *   ① 三态分明：n≥30 给区间／0<n<30 只记方向／n=0 账本里一道都没有。
 *      ★后两者的 `reason` 必须是**两句不同的话**——混成一句就是骗人。
 *   ② n<30 时**两个出口都拿不到点估计**（point_estimate 恒 null；
 *      「这是基率不是判断」不是给得出去的理由）。
 *   ③ 区间口径**逐字取自 l2_baseline**，本端点不自己算（与引擎读数逐位比对锁死）。
 *   ④ n≥300 的夹具：严格出口（不给点）时区间仍盖住真值。
 *   ⑤ 只读零写；排除掉的行**如实计数**（不许静默吞题）。
 *
 * 铁律：DB=:memory:；零网络；不起真端口（app.inject）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const { l2Baseline, MIN_N } = require('../src/engines/l2_baseline');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-honest-' + process.pid + '.json');
let app = null;
let gid = null;
const J = (r) => r.json();

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '诚实区间夹具局', type: 'werewolf', player_count: 6 } });
  gid = J(g).game.id;
});
test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

/** 造一类 kind 的夹具行：hit 条真发生、miss 条没发生。`o.tautology` / `o.forecast` 控制排除口径。 */
function seed(kind, hit, miss, o) {
  const opt = o || {};
  const conn = db.getConnection();
  const ev = JSON.stringify([{ resolve: { kind: kind } }]);
  const insert = conn.prepare(
    'INSERT INTO predictions (game_id, source_type, statement, evidence_json, checklist_hash, g2_regime, layer,'
    + ' created_at, matures_at, resolved_at, outcome, tautology)'
    + ' VALUES (?,?,?,?,\'v2\',\'R4\',\'L2\',?,?,?,?,?)');
  const tx = conn.transaction(() => {
    for (let i = 0; i < hit; i++) {
      insert.run(gid, '预测卡', kind + ' 夹具-发生' + i, ev, '2026-01-01 00:00:00',
        opt.forecast ? '2026-06-01' : '2026-01-02', opt.forecast ? '2026-05-01' : '2026-01-03',
        'true', opt.tautology ? 1 : 0);
    }
    for (let i = 0; i < miss; i++) {
      insert.run(gid, '预测卡', kind + ' 夹具-没发生' + i, ev, '2026-01-01 00:00:00',
        opt.forecast ? '2026-06-01' : '2026-01-02', opt.forecast ? '2026-05-01' : '2026-01-03',
        'false', opt.tautology ? 1 : 0);
    }
  });
  tx();
  return { hit: hit, miss: miss };
}

/** 未结算的同类行（结算不成立 ⇒ 不进分母） */
function seedUnsettled(kind, rows) {
  const conn = db.getConnection();
  const ev = JSON.stringify([{ resolve: { kind: kind } }]);
  const insert = conn.prepare(
    'INSERT INTO predictions (game_id, source_type, statement, evidence_json, checklist_hash, g2_regime, layer,'
    + ' created_at, matures_at, outcome) VALUES (?,?,?,?,\'v2\',\'R4\',\'L2\',\'2026-01-01 00:00:00\',\'2026-12-01\',NULL)');
  const tx = conn.transaction(() => { for (let i = 0; i < rows; i++) insert.run(gid, '预测卡', kind + ' 未结算' + i, ev); });
  tx();
}

const get = async (kind) => J(await app.inject({ method: 'GET', url: '/api/baseline/' + encodeURIComponent(kind) }));

/* ══════════ ① n=0：账本里一道这种题都没有 ══════════ */
test('① n=0：state=no_rows，区间与点估计全 null，reason 说「一道都没有」', async () => {
  const b = await get('dlt_draw_result');
  assert.equal(b.ok, true);
  assert.equal(b.kind, 'dlt_draw_result');
  assert.equal(b.state, 'no_rows');
  assert.equal(b.n, 0);
  assert.equal(b.enough, false);
  assert.equal(b.interval, null, '没有样本 ⇒ 没有区间');
  assert.equal(b.point_estimate, null, '没有样本 ⇒ 没有点估计');
  assert.equal(b.coverage_guarantee, null, '没有区间 ⇒ 就没有覆盖保证可说（不编一条出来）');
  assert.ok(b.reason.includes('账本里一道这种题都没有'), 'reason 必须说清是「一道都没有」：' + b.reason);
});

/* ══════════ ② 0<n<30：只记方向，两个出口都拿不到点估计 ══════════ */
test('② 0<n<30：state=too_thin，区间与点估计**都**不给，reason 说「只能记方向」', async () => {
  seed('cwl_ssq_blue_odd', 3, 9); // n=12，k=3
  const b = await get('cwl_ssq_blue_odd');
  assert.equal(b.state, 'too_thin');
  assert.equal(b.n, 12);
  assert.equal(b.enough, false);
  assert.equal(b.interval, null, 'n<30 不给区间（l2_baseline 的地基纪律）');
  assert.equal(b.point_estimate, null, '★n<30 不给点估计——「这是基率不是判断」不构成给得出去的理由');
  assert.equal(b.coverage_guarantee, null, '没有区间 ⇒ 没有覆盖保证');
  assert.ok(b.reason.includes('不足 ' + MIN_N), 'reason 要点明不足 30：' + b.reason);
  assert.ok(b.reason.includes('只能记方向'), 'reason 必须是「只能记方向」：' + b.reason);
});

test('★②b n=0 与 0<n<30 的 reason 是**两句不同的话**（不许说成同一句）', async () => {
  const none = await get('dlt_draw_result');
  const thin = await get('cwl_ssq_blue_odd');
  assert.notEqual(none.reason, thin.reason, '两态的 reason 必须不同');
  assert.equal(thin.reason.includes('一道这种题都没有'), false,
    '薄样本那句里不许出现「一道都没有」——那是另一件事');
  assert.equal(none.reason.includes('只能记方向'), false,
    '「一道都没有」那句话里不许混进「只能记方向」——账本上根本没这一类，不存在方向可记');
});

/* ══════════ ③ n≥300：严格出口的区间必须盖住真值 ══════════ */
test('③ n≥300：state=enough，给区间也允许给点估计，且区间盖住真值', async () => {
  seed('binance_daily_close', 37, 283); // n=320，k=37
  const b = await get('binance_daily_close');
  assert.equal(b.state, 'enough');
  assert.equal(b.n, 320);
  assert.equal(b.enough, true);
  assert.ok(Array.isArray(b.interval) && b.interval.length === 2, '区间是 [lo,hi]');
  const truth = 37 / 320;
  assert.ok(b.interval[0] <= truth && truth <= b.interval[1],
    '严格出口的区间必须盖住真值 ' + truth + '，实得 ' + JSON.stringify(b.interval));
  assert.equal(b.point_estimate, truth, '点估计 = k/n');
  assert.ok(typeof b.coverage_guarantee === 'string' && b.coverage_guarantee.length > 0,
    '给了区间就必须说清它的覆盖保证是什么');
  assert.ok(b.coverage_guarantee.includes('95%'), '覆盖保证须写明置信水平：' + b.coverage_guarantee);
});

test('③b 区间与点估计**逐字取自 l2_baseline**（本端点不自己算区间）', async () => {
  const b = await get('binance_daily_close');
  const history = new Array(37).fill(true).concat(new Array(283).fill(false));
  const eng = l2Baseline({ history: history });
  assert.equal(eng.ok, true);
  assert.deepEqual(b.interval, eng.ci, 'interval 必须与引擎 ci 逐位相同');
  assert.equal(b.point_estimate, eng.p, 'point_estimate 必须与引擎 p 逐位相同');
  assert.equal(b.n, eng.n, 'n 由引擎从序列里数出来');
  assert.equal(b.method, eng.method, 'method 与引擎一致');
  assert.equal(b.engine_note, eng.note, '引擎原话照登，不加工');
});

/* ══════════ ④ 准入线边界：n=30 给、n=29 不给 ══════════ */
test('④ 准入线边界：n=30 给区间，n=29 不给（照 l2_baseline 的 MIN_N，不另设阈值）', async () => {
  seed('ghcn_daily_tmax', 3, 27);      // n=30
  seed('nvd_cve_week_count', 2, 27);  // n=29
  const at = await get('ghcn_daily_tmax');
  const below = await get('nvd_cve_week_count');
  assert.equal(at.n, 30); assert.equal(at.state, 'enough');
  assert.ok(at.interval, 'n=30 恰好过线 ⇒ 给区间');
  assert.equal(below.n, 29); assert.equal(below.state, 'too_thin');
  assert.equal(below.interval, null);
  assert.equal(below.point_estimate, null);
});

/* ══════════ ⑤ 排除口径：重言题与真值口径缺陷行剔出分子分母，但**如实计数** ══════════ */
test('⑤ 排除项剔出分母且如实计数（不静默吞题）', async () => {
  seed('frankfurter_rate', 1, 1, { tautology: true });                 // 2 条重言
  seed('openmeteo_forecast_daily_max', 4, 4, { forecast: true });      // 8 条真值口径缺陷
  seedUnsettled('crossref_week_total', 5);                             // 5 条没结算

  const t = await get('frankfurter_rate');
  assert.equal(t.n, 0, '重言题不进基率分母（恒定结果对频率无信息量）');
  assert.equal(t.counts.rows_total, 2);
  assert.equal(t.counts.excluded_tautology, 2, '剔了多少要报出来');

  const f = await get('openmeteo_forecast_daily_max');
  assert.equal(f.n, 0, '真值取自事件发生之前的预报值 ⇒ 不进基率分母');
  assert.equal(f.counts.excluded_truth_basis, 8, '剔除计数须与 rows_total 对得上');

  const u = await get('crossref_week_total');
  assert.equal(u.counts.rows_total, 5);
  assert.equal(u.counts.settled, 0, '还没揭晓的题不算「已经有过答案」');
  assert.equal(u.n, 0);
});

/* ══════════ ⑥ 只读零写 ══════════ */
test('⑥ 只读零写：连查多次，账本一行都不变', async () => {
  const conn = db.getConnection();
  const snap = () => conn.prepare('SELECT COUNT(*) n, SUM(COALESCE(tautology,0)) t FROM predictions').get();
  const before = snap();
  for (const k of ['binance_daily_close', 'cwl_ssq_blue_odd', 'dlt_draw_result']) await get(k);
  assert.deepEqual(snap(), before, '端点零写');
});

/* ══════════ ⑦ 口径与禁词 ══════════ */
test('⑦ 面向用户的说明句禁出现「预测」二字', async () => {
  for (const k of ['binance_daily_close', 'cwl_ssq_blue_odd', 'dlt_draw_result']) {
    const b = await get(k);
    for (const field of ['reason', 'coverage_guarantee', 'note']) {
      const v = b[field];
      if (typeof v !== 'string') continue;
      assert.equal(v.includes('预测'), false, k + '.' + field + ' 出现禁词：' + v);
    }
    for (const s of b.discipline || []) {
      assert.equal(String(s).includes('预测'), false, 'discipline 出现禁词：' + s);
    }
  }
});

test('⑧ kind 缺/空白 ⇒ 400（不许默默按「全部」处理）', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/baseline/%20' });
  assert.equal(r.statusCode, 400);
  assert.ok(/kind/.test(J(r).error), '要说清缺的是 kind');
});
