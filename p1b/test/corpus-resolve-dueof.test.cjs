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

// ══ 2026-09-27 追加：契约覆盖断言（取代 v1 方案的 ③④「例外名单 + baseline_n」）══
/**
 * 病象：`dueOf()` 与契约 `g2-contract-frozen-r4.json` 的 `date_derivations` 是**两份互不相关的表**——
 *   一份是手写分支，一条 kind 一条 kind 猜出来的；一份是 sha 锁的登记。**两者之间没有任何断言。**
 *   ⇒ 契约新增一个 kind（换了 `source_key` / 换了粒度）而 `dueOf` 没跟上 ⇒ 该 kind 静默落 `undatable`
 *   ⇒ daemon 永不选中 ⇒ **明明有 resolver 也永不结算，无任何告警**。
 *   09-27 实测正是这个病：契约 22 个 kind，`dueOf` 只覆盖 14 个（缺 8 个 kind / 86 条全量行）。
 *
 * 修法：断言「契约每一组要么 `dueOf` 推得出、要么在 `dueBranches.js` 显式登记未实现+原因」。
 *   ★为什么**不用例外名单**：名单登记的是「今天哪几个没实现」，而要抓的是「明天多了哪个没实现」
 *   ——手抄快照登记不了增量；契约覆盖断言登记的是**契约本身**，契约是活的。
 *   ★为什么**不写任何数字、不建 baseline_n、不做单调性**：三样都是对活库读数的快照断言，
 *   会随结算自然漂移 ⇒ 漂移即转红 ⇒ 要人回来改数字 ⇒ 改着改着就没人看了（Goodhart）。
 *   本断言只锁**不变量**：「契约登记过的每个 kind，dueOf 要么能推、要么有人签字认领缺口」。
 *
 * ★**取题用全量行**（不分已解未解、与 g2-regime 无关）。理由有二：
 *   ① 账本**只增不删** ⇒ 「全部行」是稳定口径；而按 `resolved_at IS NULL` 取会随结算缩水，
 *      同一条分支在结算当天就换了一批题来测，测的其实是账本状态不是分支；
 *   ② **已解行推不出 due 同样是真缺陷**（实测 8 kind 的 86 条里 64 条已解、22 条未解）
 *      ——「已结掉了所以不必管」是错的，那 64 条正是当初饿死的那批。
 *   ★v1 方案引本文件 `:95-97`（⑥ 里那段「活库前提类测试反模式」注释）当禁令依据是**误引**：
 *      那条禁的是「前提是会消失的活库状态」；今天实测两谓词完全等价
 *      （`corpus%` 集内 `outcome IS NULL` == `resolved_at IS NULL`，两向零分歧），
 *      且本断言压根不碰账本——取题来自契约文件，纯合成夹具。
 */
const B = require(path.join(ROOT, 'p1b', 'src', 'evidence', 'dueBranches'));

/** 每个 `source_key` 至少一个**合法**的合成取值（测试夹具，非口径；不写死任何到期日的期望值）。 */
const SYNTH = {
  period: '2026-09',            // YYYY-MM
  month: '2026-09',             // YYYY-MM
  year: '2026',                 // YYYY（契约 rule：次年 12-31）
  end: '2026-09-10',            // YYYY-MM-DD
  week_end: '2026-09-20',       // YYYY-MM-DD
  week_start: '2026-09-07',     // YYYY-MM-DD（周窗计数：+7）
  epiweek: '202639',            // YYYYWW（MMWR）
  week: '2026W37',              // YYYYWNN（BOM 周末序号）
};

/** 按契约 `source_key` 造一份合成证据（**不碰活库**，输入自包含、永不腐坏）。 */
function synthResolve(kind, sourceKey) {
  const r = { kind: kind };
  if (sourceKey === 'issue') {
    // 同为 issue/draw 组但期号位数不同：cwl 是 YYYYNNN、dlt 是 YYNNN（`inferIssue` 按位数分派，不可互推）
    r.issue = /^dlt/.test(String(kind)) ? '26104' : '2026105';
  } else {
    assert.ok(SYNTH[sourceKey], '★契约新增了 source_key=`' + sourceKey + '`（kind=' + kind
      + '）——本测试的合成夹具还没有它的合法取值。**这正是本告警要报的增量**：请补 SYNTH 取值并确认 dueOf 是否需要新分支');
    r[sourceKey] = SYNTH[sourceKey];
  }
  return { resolve: r };
}

/** 逐 kind 探 `dueOf` 能否从契约声明的 source_key 推出一个 YYYY-MM-DD（**只判「有没有」，不判「是哪个」**）。 */
function derivable(kind) {
  const srcKey = String((B.DATE_DERIVATIONS[kind] || {}).source_key || '');
  const d = D.dueOf(synthResolve(kind, srcKey));
  return !!(d && typeof d.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.due));
}

/** 逐组体检：返回 { covered, excused, bare }（bare = 既推不出、也没登记 ⇒ 该报红的）。 */
function coverage() {
  const covered = [], excused = [], bare = [];
  for (const group of B.PAIRS) {
    const reason = String((B.UNIMPLEMENTED || {})[group] || '').trim();
    for (const kind of B.DERIV_BY_PAIR[group]) {
      if (derivable(kind)) covered.push(group + ' → ' + kind);
      else if (reason) excused.push(group + ' → ' + kind + '（已登记未实现：' + reason.slice(0, 40) + '…）');
      else bare.push(group + ' → ' + kind);
    }
  }
  return { covered, excused, bare };
}

test('⑧ ★契约覆盖：date_derivations 的每一组，要么 dueOf 推得出、要么显式登记未实现+原因', () => {
  // 登记表自身的形状（不变量，不是数字）
  assert.ok(B.PAIRS.length > 0, '契约里没有 date_derivations——分组表空了，检测器可能失效，须复核');
  for (const g of Object.keys(B.UNIMPLEMENTED || {})) {
    assert.ok(B.PAIRS.indexOf(g) !== -1, '未实现登记里有契约已不存在的组：' + g + '（契约换了请同步删登记）');
    assert.ok(String(B.UNIMPLEMENTED[g]).trim().length > 0, '未实现登记「' + g + '」必须写原因，不许空串充数');
  }
  const cov = coverage();
  assert.deepEqual(cov.bare, [],
    '★契约登记了这些 kind，但 dueOf 推不出到期、且未在 dueBranches.UNIMPLEMENTED 登记原因：\n  ' + cov.bare.join('\n  ')
    + '\n——它们会静默落 undatable ⇒ daemon 永不选中 ⇒ 永不结算且无告警。修法二选一：'
    + '① 在 dueOf 补该 source_key 分支；② 在 dueBranches.UNIMPLEMENTED 登记该组 + 写明原因。'
    + '\n已覆盖 ' + cov.covered.length + ' 个 · 已登记豁免 ' + cov.excused.length + ' 个');
});

test('⑧-对照 · 检测器不是恒真/恒假断言（防空跑绿）', () => {
  // ① 探针不是恒真：契约外 kind ＋ 契约外字段 ⇒ dueOf 必推不出
  const d = D.dueOf({ resolve: { kind: '__definitely_not_a_kind__', some_unknown_source_key: '2026-01-01' } });
  assert.equal(d && d.due, null, '不认识的字段不得推出到期——若推得出，探针恒真、⑧ 是摆设');
  // ② ★探针不是恒假（防**空洞地绿**）：若 derivable() 恒返回 false，⑧ 会靠「登记项全体豁免」一路绿下去，
  //    那才是真事故。必须证明「至少有一个契约 kind 探得出」。
  const cov = coverage();
  assert.ok(cov.covered.length > 0,
    '★没有任何契约 kind 能探出到期 ⇒ 探针恒假，⑧ 现在的绿是空洞的（检查 SYNTH 取值 / dueOf 是否整体崩了）');
  assert.equal(cov.covered.length + cov.excused.length + cov.bare.length,
    Object.keys(B.DATE_DERIVATIONS).length, '三类必须恰好瓜分契约全部 kind（漏算即检测器有洞）');
  // ③ 新增 source_key 缺夹具时必须**抛错**而不是静默通过（新增 source_key 是本告警的核心增量）
  assert.throws(() => synthResolve('x', 'brand_new_source_key'), /契约新增了 source_key/,
    '新增 source_key 缺合成夹具时须响亮报错，禁静默');
});
