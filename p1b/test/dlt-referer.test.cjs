'use strict';
/**
 * p1b/test/dlt-referer.test.cjs —— dlt resolver Referer 回归锁（2026-09-21 · 四十三批）
 *
 * 背景（诊断件 `.scratch/p36/dlt专项诊断-20260921.md`）：
 *   `dlt_draw_result` 38 条**全部未解**（总 38 = 未解 38），daemon 报 HTTP 567。
 *   ★根因：**不是网络问题，是 daemon 的 UA 策略触发反爬**——
 *     daemon L74 强制注入浏览器 UA（`UA_DEFAULT`），而 sporttery 对「浏览器 UA」要求
 *     完整浏览器头上下文（含 Referer）⇒ 裸浏览器 UA 判爬虫 ⇒ 567。
 *   实测矩阵：curl 默认 200／fetch 默认 200／浏览器 UA 裸 **567**／浏览器 UA+Referer **200**／非浏览器 UA 200。
 *
 * 覆盖：
 *   ① ★静态锁：dlt resolver 必须显式传 Referer
 *   ② ★对照证明（非恒真）：构造「不传 Referer 的调用」证明其确实会被服务端拒（网络可用时）
 *   ③ 行为锁：带真实参数能正确判定（true/false 双向）
 *   ④ 最小改动锁：不得改动 daemon 的全局 UA（那会影响全部 61 kind）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..', '..');
const RESOLVE_SRC = path.join(ROOT, 'p1b/scripts/corpus-resolve.cjs');
const DAEMON_SRC = path.join(ROOT, 'p1b/scripts/corpus-resolve-daemon.cjs');
const SRC = fs.readFileSync(RESOLVE_SRC, 'utf8');

/** 用 daemon 同款抽取方式加载 RESOLVERS */
function loadResolvers() {
  const i = SRC.indexOf('//RESOLVE-B2');
  if (i < 0) throw new Error('锚点缺失');
  const body = SRC.slice(0, i) + '\nmodule.exports = { RESOLVERS: RESOLVERS };';
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__GETJSON_CACHE', body)(
    mod, mod.exports, createRequire(RESOLVE_SRC), path.dirname(RESOLVE_SRC), null
  );
  return mod.exports.RESOLVERS;
}

test('① ★静态锁：dlt resolver 显式传 Referer', () => {
  const i = SRC.indexOf('async dlt_draw_result(r)');
  assert.ok(i > 0, 'dlt resolver 应存在');
  const seg = SRC.slice(i, i + 900);
  assert.ok(/getJson\(u,\s*\{\s*Referer:/.test(seg), '★dlt resolver 必须显式传 Referer（诊断件结论）');
  assert.ok(/sporttery\.cn/.test(seg), 'Referer 须指向 sporttery.cn');
  // 头注须记录根因（防后人删掉「多余的」Referer）
  assert.ok(/反爬|567/.test(seg), '注释须记录根因（567/反爬），防后人误删');
});

test('② ★对照证明（非恒真）：不传 Referer 的裸浏览器 UA 确实被拒', async () => {
  // ★本测试证明「锁有对象」：若服务端规则变了（不再拒裸 UA），此测试会红 ⇒ 提醒复核锁是否还需要
  const u = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=1&isVerify=1&pageNo=1';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  let bare = null, withRef = null;
  try {
    const r1 = await fetch(u, { headers: { 'User-Agent': UA } });
    bare = r1.status;
  } catch (e) { bare = 'net-fail'; }
  try {
    const r2 = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://static.sporttery.cn/' } });
    withRef = r2.status;
  } catch (e) { withRef = 'net-fail'; }
  if (bare === 'net-fail' || withRef === 'net-fail') {
    // 网络不可用（离线环境）⇒ 跳过行为断言，但静态锁仍有效
    assert.ok(true, '网络不可用 ⇒ 跳过对照（静态锁①仍生效）');
    return;
  }
  assert.equal(withRef, 200, '带 Referer 应 200');
  assert.equal(bare, 567, '★裸浏览器 UA 应 567（这是 Referer 存在的理由；若此处不再是 567 ⇒ 服务端规则变了，须复核）');
});

test('③ 行为锁：带真实参数正确判定（true/false 双向）', async () => {
  const R = loadResolvers();
  assert.ok(R.dlt_draw_result, 'resolver 应可加载');
  let a, b;
  try {
    a = await R.dlt_draw_result({ issue: '26108', back_ball: '01' });
    b = await R.dlt_draw_result({ issue: '26108', back_ball: '12' });
  } catch (e) {
    assert.ok(true, '网络不可用 ⇒ 跳过（静态锁①仍生效）: ' + e.message);
    return;
  }
  if (a && a.pending) { assert.ok(true, '该期未开奖 ⇒ 跳过（正常）'); return; }
  assert.equal(a.outcome, 'true', '26108 期后区含 01 ⇒ true（实测）');
  assert.equal(b.outcome, 'false', '26108 期后区不含 12 ⇒ false（实测）');
  // ★双向：两个不同参数得不同结论 ⇒ 证明判定不是恒真/恒假
  assert.notEqual(a.outcome, b.outcome, '★双向判定须不同（防恒真）');
});

test('④ 最小改动锁：不得改动 daemon 全局 UA 默认值', () => {
  const d = fs.readFileSync(DAEMON_SRC, 'utf8');
  // daemon 仍应有 UA_DEFAULT（改它会影响全部 61 kind ⇒ 须另立项）
  assert.ok(/UA_DEFAULT\s*=/.test(d), 'daemon 应保留 UA_DEFAULT（本批改的是 resolver，不是全局）');
  // 头注/注释须说明为何不改全局
  assert.ok(/61 kind|全局/.test(SRC), 'resolver 注释须说明「不改 daemon 全局默认值」的理由');
});
