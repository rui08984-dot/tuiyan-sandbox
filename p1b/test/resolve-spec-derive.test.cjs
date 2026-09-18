'use strict';
/**
 * p1b/test/resolve-spec-derive.test.cjs —— 「两代 spec 混存」派生层守卫（2026-09-18）
 *
 * 不变量：**同一 kind 的旧形态与出题器新形态，必须派生出/直通到同一取数地址**；
 *         新形态缺 URL 时**不得静默走到空 URL**（那是 §88 缺陷二的根因）。
 *
 * 事故背景（本条即回归锁）：账本里同一 kind 存了**两代 spec**（新形态缺 `url_template`，个别字段还改名），
 * 而解析器一律读 `url_template || r.url` ⇒ 新形态一路走到网络层才失败（`fetch('')` 抛
 * "Failed to parse URL"），**每日复跑再 fail 一次、永久不可结**。实测受影响 6 kind 共 **31 条**
 * （`frankfurter_rate_range` 12／`kraken_daily_close` 6／`npm_downloads_window` 4／
 *  `mlb_schedule_daily_total_runs` 3／`crossref_week_total` 3／`nvd_cve_week_count` 3）。
 *
 * 检测口径：走与 daemon **相同的抽取路径**（`//RESOLVE-B2` 锚点 + `createRequire` 定向到 p1b/scripts），
 *          取 `specUrl`／`windowDays` 做**纯字符串断言**（**零网络**）。
 *          ★派生 URL 的**真能取数**由一次性实取验证（见收据），本测试只锁「地址正确」。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'p1b', 'scripts', 'corpus-resolve.cjs');

function loadDerive() {
  const src = fs.readFileSync(SRC, 'utf8');
  const i = src.indexOf('//RESOLVE-B2');
  if (i < 0) throw new Error('抽取锚点 //RESOLVE-B2 缺失 ⇒ 硬失败（禁降级）');
  const body = src.slice(0, i) + '\nmodule.exports = { RESOLVERS: RESOLVERS, specUrl: specUrl, windowDays: windowDays };';
  const mod = { exports: {} };
  const req = createRequire(SRC);                       // require 基准＝p1b/scripts（与 daemon 同）
  new Function('module', 'exports', 'require', '__dirname', '__GETJSON_CACHE', body)(mod, mod.exports, req, path.dirname(SRC), null);
  if (typeof mod.exports.specUrl !== 'function') throw new Error('specUrl 未在抽取段内（须位于 //RESOLVE-B2 之上）');
  return mod.exports;
}
const D = loadDerive();

test('① 六族新形态 ⇒ 派生出正确取数地址（地址字面量锁定）', () => {
  const cases = [
    [{ kind: 'kraken_daily_close', pair: 'XBTUSD', date: '2026-09-08' },
      'https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440&since=1788739200000'],
    [{ kind: 'frankfurter_rate_range', from: 'USD', to: 'CNY', date: '2026-09-08' },
      'https://api.frankfurter.app/2026-09-08..2026-09-15?from=USD&to=CNY'],
    [{ kind: 'npm_downloads_window', pkg: 'react', date: '2026-09-08' },
      'https://api.npmjs.org/downloads/range/2026-09-08:2026-09-08/react'],
    [{ kind: 'mlb_schedule_daily_total_runs', date: '2026-09-08' },
      'https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2026-09-08&endDate=2026-09-08'],
    [{ kind: 'crossref_week_total', week_start: '2026-08-23', week_end: '2026-08-29' },
      'https://api.crossref.org/works?filter=from-created-date:2026-08-23,until-created-date:2026-08-29&rows=0'],
    [{ kind: 'nvd_cve_week_count', week_start: '2026-08-09', week_end: '2026-08-15' },
      'https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=2026-08-09T00:00:00.000&pubEndDate=2026-08-15T23:59:59.999&resultsPerPage=1'],
  ];
  for (const [spec, want] of cases) {
    assert.equal(D.specUrl(spec), want, spec.kind + ' 派生地址不符');
  }
});

test('② 旧形态**直通**（对既有行为零影响）', () => {
  const tpl = 'https://api.crossref.org/works?filter=from-created-date:{date},until-created-date:{date_plus6}&rows=0';
  assert.equal(D.specUrl({ kind: 'crossref_week_total', url_template: tpl, week_start: '2026-08-23' }), tpl, '旧形态须原样返回');
  assert.equal(D.specUrl({ kind: 'anything', url: 'https://x/y' }), 'https://x/y', 'url 字段同样直通');
  // 有 URL 时**即便 kind 在派生表里**也不得改写
  assert.equal(D.specUrl({ kind: 'kraken_daily_close', url_template: 'https://custom', pair: 'XBTUSD', date: '2026-09-08' }), 'https://custom');
});

test('③ 未登记 kind 且无 URL ⇒ 返回空串（**显式**，不再静默空 URL 到网络层）', () => {
  assert.equal(D.specUrl({ kind: 'no_such_kind_xyz' }), '', '未登记 ⇒ 空串（调用方照旧失败，但可判可查）');
});

test('④ windowDays：旧 7 天窗口 vs 新单日（npm 守卫口径）', () => {
  assert.equal(D.windowDays({ start: '2026-09-16', end: '2026-09-22' }), 7, '旧形态 7 天窗口');
  assert.equal(D.windowDays({ date: '2026-09-18' }), 1, '新形态单日 ⇒ 1（若仍按 7 天要求则永不结算）');
  assert.equal(D.windowDays({ start: '2026-09-01', end: '2026-09-01' }), 1, '同日边界');
});

test('⑤ 派生不依赖网络（本测试零网络的可证性）', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  // 只取**派生块本身**（URL_DERIVE … windowDays 结束），不波及相邻 helper（否则会圈进 getJsonRetry 的 fetch）
  const a = src.indexOf('const URL_DERIVE');
  const b = src.indexOf('function cmpOk');
  assert.ok(a > 0 && b > a, '派生块定位失败（源码结构变了 ⇒ 硬失败）');
  const deriveSeg = src.slice(a, b);
  assert.ok(deriveSeg.includes('function specUrl'), '派生块须含 specUrl');
  assert.ok(deriveSeg.includes('function windowDays'), '派生块须含 windowDays');
  assert.ok(!/\bfetch\s*\(/.test(deriveSeg), '派生段不得含 fetch');
  assert.ok(!/\bawait\b/.test(deriveSeg), '派生段不得含 await（须为纯函数）');
});
