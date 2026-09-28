'use strict';
/**
 * p1b/test/binance-kline-close.test.cjs —— 日 K 线「未收盘不得当真值」回归锁（2026-09-28）
 *
 * 病象：币安日 K 线在**每天 8 小时**里用半日价格写了真值。
 *   根因链（三段，缺一不可）：
 *     ① `corpus-resolve.cjs:524` `futureDay(d) = String(d) >= shToday()`，而 `shToday()`（:486）
 *        取 **Asia/Shanghai**；K 线是 **UTC 日**语义。北京时间 00:00–07:59（＝UTC 16:00–23:59）
 *        时上海日期比 UTC 大 1 ⇒ `D >= D+1` 不成立 ⇒ 预筛放行。
 *     ② 放行后 `corpus-resolve.cjs:186` 直接取 `j[0][4]`（close）——此刻该 UTC 日**还没走完**。
 *     ③ 于是「当日那根还在长的 K 线」的现价，被当成收盘价写进不可变账本。
 *   ★守护进程 `corpus-resolve-daemon.cjs:190` 的 `preScreen` 是**同一个错**（同样拿上海 `today()` 卡 UTC 源）。
 *
 * ★**为什么不能只把 `today()` 换成 UTC 就算完**（本题的修法判据）：
 *   换时钟只是把 8 小时窗口挪到 UTC 00:00–07:59，预筛仍是「按日历猜」，而真值是在
 *   **resolver 里**写的——预筛是省 API 调用的启发式，不是正确性保证。正确性必须落在
 *   「取 close 之前先证明这根 K 线已收盘」这一步，且判据取自**数据自报的收盘时刻**。
 *
 * ★**「该 K 线时长 ≥ 24 小时」是错判据**（本轮实测 Binance 约定）：日 K 的
 *   `closeTime = openTime + 24h − 1ms` ⇒ 已收盘的 K 线时长是 **86399999ms**，
 *   拿它去比 `≥ 86400000` 会把**每一根**已收盘 K 线都判成未收盘 ⇒ 全线饿死。
 *   故本测试与实现一律走 `closeTime <= now`。
 *
 * 测的是**活路径**：`evalRow`（daemon:349）优先用 `BASE[k]`＝从 `corpus-resolve.cjs`
 *   抽取出来的 resolver，B3 同名分支只是抽取失败时的兜底、被遮蔽。两处都测、都修。
 *   取数用 `__GETJSON_CACHE` 注入假 K 线（照 daemon `loadBase` 的同一套抽取手法），**零网络**。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'p1b', 'scripts', 'corpus-resolve.cjs');

/** 造一根 Binance 日 K 线：字段序照 /api/v3/klines（[0]=openTime, [4]=close, [6]=closeTime）。 */
function kline(openMs, closeMs, close) {
  return [openMs, '1.0', '2.0', '0.5', String(close), '10', closeMs, '1.0', 5, '0', '0', '0'];
}
/** 某 UTC 日 00:00 的毫秒时间戳。 */
function utcMidnight(isoDay) { return Date.parse(isoDay + 'T00:00:00Z'); }
/** 一个「必定已过去」的题面日（让 futureDay 预筛放行，把变量收敛到 K 线本身）。 */
function pastDay() { return new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10); }

/** 照 daemon `loadBase` 的同一套手法从 corpus-resolve.cjs 抽 RESOLVERS，并注入假取数。 */
function loadLiveResolvers(getJsonStub) {
  const req = createRequire(path.join(ROOT, 'p1b', 'scripts', 'corpus-resolve-daemon.cjs'));
  const src = fs.readFileSync(SRC, 'utf8');
  const i = src.indexOf('//RESOLVE-B2');
  assert.ok(i > 0, 'corpus-resolve.cjs 缺 //RESOLVE-B2 锚点（daemon 抽取会失败，本测试的前提失效）');
  const mod = { exports: {} };
  let body = src.slice(0, i);
  const hook = 'async function getJson(url, headers) {';
  assert.ok(body.indexOf(hook) !== -1, 'corpus-resolve.cjs 缺 getJson 定义（注入点失效）');
  body = body.replace(hook, hook + ' if (typeof __GETJSON_CACHE === "function") { return __GETJSON_CACHE(url, headers); }');
  body += '\nmodule.exports = { RESOLVERS: RESOLVERS };';
  new Function('module', 'exports', 'require', '__dirname', '__GETJSON_CACHE', body)(mod, mod.exports, req, __dirname, getJsonStub);
  return mod.exports.RESOLVERS;
}

/** 被测题面：阈值定成一个绝不可能被 close 满足的值，便于断言 outcome 的方向不是关键。 */
function spec(day) {
  return { kind: 'binance_daily_close', symbol: 'BTCUSDT', date: day, cmp: '>=', threshold: 1e12,
    url_template: 'https://data-api.binance.vision/api/v3/klines?symbol={symbol}&interval=1d&startTime={start_ms}&endTime={end_ms}', start_ms: utcMidnight(day), end_ms: utcMidnight(day) + 86400000 };
}

test('① 活路径（corpus-resolve.cjs）：未收盘的当日 K 线必须落 pending，不得写出真值', async () => {
  const day = pastDay();
  // 关键：这根 K 线**还没收盘**（closeTime 在未来 10 分钟），但题面日已过去 ⇒ 预筛必然放行。
  const open = utcMidnight(day);
  const unclosed = kline(open, Date.now() + 10 * 60000, 12345);
  const R = loadLiveResolvers(async () => [unclosed]);
  const out = await R.binance_daily_close(spec(day));
  assert.ok(out.pending, '未收盘 K 线必须 pending（实得 outcome=' + JSON.stringify(out.outcome)
    + ' note=' + JSON.stringify(out.note) + '）——半日价格被当收盘价写进账本了');
  assert.equal(out.outcome, undefined, 'pending 结果不得带 outcome');
  assert.ok(/未收盘/.test(out.pending), 'pending 理由须点明「未收盘」（实得：' + out.pending + '）');
});

test('② 兜底路径（daemon B3 同一口径）：未收盘的当日 K 线同样落 pending', () => {
  const D = require('../scripts/corpus-resolve-daemon.cjs');
  assert.equal(typeof D.judgeBinanceKlines, 'function', 'daemon 须导出 judgeBinanceKlines 供直测');
  const day = pastDay();
  const open = utcMidnight(day);
  const unclosed = kline(open, Date.now() + 10 * 60000, 12345);
  const out = D.judgeBinanceKlines(spec(day), [unclosed]);
  assert.ok(out.pending, 'B3 兜底路径同样必须 pending（实得 ' + JSON.stringify(out) + '）');
  assert.ok(/未收盘/.test(out.pending), '理由须点明「未收盘」（实得：' + out.pending + '）');
});

test('③ 已收盘的 K 线照常出真值（防过度拦截：不是把整类题打死）', async () => {
  const day = pastDay();
  const open = utcMidnight(day);
  const closed = kline(open, open + 86400000 - 1, 95000);   // closeTime = open+24h−1ms（实测 Binance 约定）
  const R = loadLiveResolvers(async () => [closed]);
  const out = await R.binance_daily_close(spec(day));
  assert.ok(!out.pending, '已收盘 K 线不该被拦（实得 pending：' + out.pending + '）');
  assert.equal(out.outcome, 'false', 'close=95000 < 阈值 1e12 ⇒ outcome 应为 false');
  assert.ok(/close=95000/.test(out.note), 'note 仍须带真值读数：' + out.note);
});

test('④ 纯门函数：判据取自数据自报的 closeTime，与任何时区无关', () => {
  const K = require('../src/evidence/klineClosed');
  const open = utcMidnight('2026-09-27');
  const T = open + 12 * 3600000;                 // 该 UTC 日正午 12 点
  assert.equal(K.klineClosed(kline(open, open + 86400000 - 1, 1), T), false, '当日 12 点看当日 K 线：未收盘（closeTime 在该 UTC 日 24:00）');
  assert.equal(K.klineClosed(kline(open, open + 86400000 - 1, 1), T + 86400000), true, '次日 12 点看前一日 K 线：已收盘');
  // ★回归本题的错判据：已收盘 K 线的时长是 86399999ms，**不是** 24h。
  assert.equal(K.klineSpanMs(kline(open, open + 86400000 - 1, 1)), 86399999, 'Binance 日 K 时长实测＝24h−1ms（故「≥24h」是错判据）');
  // closeTime 畸形时退回「日 K 在该 UTC 日 24:00 收口」的可证判据，不是瞎猜：
  const bad = [open, '1', '2', '0.5', '1', '1', 'not-a-number', '0', 1, '0', '0', '0'];
  assert.equal(K.klineClosed(bad, T), false, 'closeTime 畸形 + 仍是当日 ⇒ 判未收盘（当日 24:00 才收口）');
  assert.equal(K.klineClosed(bad, T + 86400000), true, 'closeTime 畸形 + 已是次日 ⇒ 判已收盘（可证，非猜测）');
  // 连开仓时间都读不出（连哪一天都无从判断）⇒ 这才是真猜不出来，宁缺毋滥判未收盘。
  assert.equal(K.klineClosed(['x', '1', '2', '0.5', '1', '1', 'y', '0', 1, '0', '0', '0'], T + 86400000), false,
    '连 openTime 都不可解析时必须判未收盘，不许放行');
});
