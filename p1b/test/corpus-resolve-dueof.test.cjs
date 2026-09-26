'use strict';
/**
 * p1b/test/corpus-resolve-dueof.test.cjs —— 到期口径回归锁（2026-09-27）
 *
 * 病象：`corpus-resolve-daemon.cjs` 的 `dueOf()` 认 `r.week_end`（github）/ `r.date` / `r.end`（npm），
 *   但**不认**另外三个 kind 各自证据里真实存在的日期字段 ⇒ 这些题一律落 `undatable`
 *   ⇒ **daemon 永不选中它们 ⇒ 明明有 resolver 也永不结算**（静默饿死，无任何告警）。
 *
 * 实测（2026-09-27 修前）：undatable 53 条，其中
 *   oddsapi_h2h 20（英超赔率题，10 场已开赛）／crossref_week_total 6／nvd_cve_week_count 5
 *   —— 三者 resolver 全部存在（corpus-resolve.cjs），纯粹是 dueOf 认不出字段。修后 53→22。
 *
 * ★到期口径不是自拟，是从 resolver 自身的门反推：
 *   crossref/nvd 两支同款 `const end = plusDays(r.week_start, 6); if (end >= shToday()) return pending`
 *   ⇒ 窗口末日＝week_start+6，数据自 **week_start+7** 起可取。
 *   赔率题真值端点 `/v4/sports/<lg>/scores/?daysFrom=3` 是 3 日滚动窗 ⇒ 开赛日次日起仍可取。
 *
 * 本测试**直测纯函数 dueOf**（不起子进程）：daemon 已加 `require.main === module` 守卫，
 *   require 它不再触发 main() 的日志追加写（同族缺陷：require 写盘打红 e2-combo-precheck）。
 *
 * 断言用**真账本**里的真实题（缺陷本质就是「真实题推不出到期」，合成夹具会把 bug 藏起来）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const DB = path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db');
const D = require(path.join(ROOT, 'p1b', 'scripts', 'corpus-resolve-daemon.cjs'));

const readResolve = (kinds) => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const ph = kinds.map(() => '?').join(',');
    return db.prepare(
      "SELECT id, json_extract(evidence_json,'$[0]') e FROM predictions " +
      'WHERE resolved_at IS NULL AND json_extract(evidence_json,\'$[0].resolve.kind\') IN (' + ph + ')'
    ).all(...kinds).map((r) => ({ id: r.id, e0: JSON.parse(r.e) }));
  } finally { db.close(); }
};

test('① require 本件零副作用（不起子进程、不写盘、不打网）', () => {
  assert.equal(typeof D.dueOf, 'function', 'dueOf 须可直测（已导出）');
  assert.equal(typeof D.distribute, 'function', 'distribute 须可直测（已导出）');
});

test('② ★三 kind 不再落 undatable（修前 31 条饿死）', () => {
  for (const kind of ['oddsapi_h2h', 'crossref_week_total', 'nvd_cve_week_count']) {
    const rows = readResolve([kind]);
    assert.ok(rows.length > 0, '须有真实 ' + kind + ' 题');
    for (const r of rows) {
      const d = D.dueOf(r.e0);
      assert.ok(d && d.due, '★' + kind + ' id=' + r.id + ' 推不出到期（src=' + (d && d.src) + '）');
    }
  }
});

test('③ 周窗计数：due ≡ week_start+7（对齐 resolver 的门）', () => {
  for (const kind of ['crossref_week_total', 'nvd_cve_week_count']) {
    for (const r of readResolve([kind])) {
      const ws = r.e0.resolve.week_start;
      const d = D.dueOf(r.e0);
      assert.equal(d.src, 'week_start+7d', kind + ' id=' + r.id + ' 来源标记');
      assert.equal(d.due, D.addDays(ws, 7), 'due 须 = week_start+7（早一天就会在窗口未走完时取数）');
    }
  }
});

test('④ 赔率题：due ≡ 开赛日次日（对齐 scores 端点 3 日滚动窗）', () => {
  for (const r of readResolve(['oddsapi_h2h'])) {
    const cu = r.e0.resolve.commence_utc;
    const d = D.dueOf(r.e0);
    assert.equal(d.src, 'commence_utc+1d', 'id=' + r.id + ' 来源标记');
    assert.equal(d.due, D.addDays(String(cu).slice(0, 10), 1), 'due 须 = 开赛日次日');
  }
});

test('⑤ ★不得把未到期/无字段的题误判为已到期（防过度放行）', () => {
  // 无任何日期字段 ⇒ 仍须落 undatable（**不猜**，是本文件最该守住的那条）
  assert.equal(D.dueOf({ resolve: { kind: 'delphi_fluview_ili', epiweek: '202639' } }).due, null,
    'MMWR epiweek 无日历登记 ⇒ 不得凭记忆折算日期');
  // 已有分支不受影响（回归护栏）
  assert.equal(D.dueOf({ resolve: { kind: 'x', date: '2026-09-27' } }).src, 'resolve.date');
  assert.equal(D.dueOf({ resolve: { kind: 'github_weekly_commits', week_end: '2026-09-20' } }).due, '2026-09-21');
  assert.equal(D.dueOf({ meta: '{"expectDate":"2026-10-01"}', resolve: { kind: 'y' } }).src, 'meta.expectDate');
});

// ══ 2026-09-27 追加：inferIssue 回推分支（彩票期号被日历锚「甩在身后」）══
test('⑥ ★inferIssue 必须能向前**也能向后**推（锚会前进，旧期号会被甩在身后）', () => {
  // 病象：原实现只有 `while (code < target)` 前推。锚每次结算都从官方列表刷新、会前进，
  //   一旦锚越过某题期号，该题 `< target` 恒不成立 ⇒ 返回 null ⇒ undatable ⇒ 永久不结算、无告警。
  //   实测：cwl 内置锚 2026105@09-10，09-24 刷新到 2026111@09-24 ⇒ 期号 2026110 的 id 821/833 被甩在身后。
  //
  // ★本测试**刻意不依赖活库**：初版写成「去账��里捞落在锚后的题」，结果修复一落地、
  //   那两题被结算掉，测试立刻转红——这正是本项目明令的「活库前提类测试」反模式
  //   （纪律：活库前提类测试改条件式）。改为直接测纯函数 `inferIssue`，输入自包含、永不腐坏。
  const SSQ_DOW = [0, 2, 4];                       // 周日/二/四（照脚本 CALS.cwl.dows）
  const anchor = { latestCode: '2026111', latestDate: '2026-09-24', dows: SSQ_DOW };

  // 回推（本缺陷的核心）：锚 2026111@09-24，期号 2026110 应回推到上一个开奖日 09-22（周二）
  assert.equal(D.inferIssue('2026110', anchor), '2026-09-22', '★回推：2026110 应为 2026-09-22');
  // 前推（原有能力不得被本次修复破坏）：期号 2026112 应推到 09-27（周日）
  assert.equal(D.inferIssue('2026112', anchor), '2026-09-27', '前推：2026112 应为 2026-09-27');
  // 锚自身
  assert.equal(D.inferIssue('2026111', anchor), '2026-09-24', '锚期号应等于锚日');
  // 多步回推：连续 3 期都要能退。★注意 SSQ 是**每周二/四/日**，期号与日历日**不是 1:1**
  //   （锚 2026111@09-24 周四 ⇒ 2026110=09-22 周二、2026109=09-20 周日、2026108=09-17 周四…）
  assert.equal(D.inferIssue('2026108', anchor), '2026-09-17', '回推 3 期：2026108 应为 2026-09-17（周四）');
  assert.equal(D.inferIssue('2026107', anchor), '2026-09-15', '回推 4 期：2026107 应为 2026-09-15（周二）');
  // 回推结果必须**落在正确的星期几**上（防止 prevDraw 走偏）
  for (const [issue, want] of [['2026108', '2026-09-17'], ['2026107', '2026-09-15'], ['2026110', '2026-09-22']]) {
    const got = D.inferIssue(issue, anchor);
    assert.ok(SSQ_DOW.includes(new Date(got + 'T00:00:00Z').getUTCDay()),
      '回推结果 ' + got + ' 必须是开奖日（周��/四/日）');
    assert.equal(got, want);
  }
  // dlt 同样适用（周一/三/六）
  const dlt = { latestCode: '26106', latestDate: '2026-09-16', dows: [1, 3, 6] };
  assert.equal(D.inferIssue('26105', dlt), '2026-09-14', 'dlt 回推：26105 应为 2026-09-14（周一）');
  assert.equal(D.inferIssue('26107', dlt), '2026-09-19', 'dlt 前推：26107 应为 2026-09-19（周六）');
});

test('⑦ 回推不得越界（期号长度不符仍返回 null，禁瞎猜）', () => {
  const cal = { latestCode: '2026111', latestDate: '2026-09-24', dows: [0, 2, 4] };
  assert.equal(D.dueOf({ resolve: { kind: 'cwl_ssq_red_contains', issue: '26104' } }).due, null,
    '期号长度不符 ⇒ 仍须 null（不同彩票不可互推）');
  assert.equal(D.dueOf({ resolve: { kind: 'cwl_ssq_red_contains' } }).due, null, '缺 issue ⇒ null');
});
