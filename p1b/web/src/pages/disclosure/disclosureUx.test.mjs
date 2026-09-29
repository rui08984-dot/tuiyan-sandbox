import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// P0-U7/U8 页面化（2026-09-16）：源码级断言（沿 intakeUx/auditTerms 先例，零 DOM 依赖）
//
// ★2026-09-30 重锚：本文件原先读的 CalendarPage / CalibrationReportPage **源码已删除**
//   （本轮同批删除的共 5 个披露死页：git diff --stat HEAD 见 ArenaPage / BayesLensPage /
//   CalendarPage / CalibrationReportPage / CompilerPage，合计 −1293 行）。
//   顶层 readFileSync 会在模块加载期 ENOENT ⇒ 整个文件一个用例都跑不到（实测：
//   node --test 本文件 → fail 1，卡在 :6 的 CalendarPage.tsx）。
//   ★为什么必须重锚而不是删用例：App.tsx:20-23 留的旧理由是「删源码会让『禁词扫描』与
//     『可达性』两道闸失去扫描目标」。这个前提已随删除作废，可两道闸本身还得留。
//   ⇒ 扫描面与断言对象改指**接管它们的活页**：披露数据落在 WhereOffPage
//     （八轮五页看板的合并体，见其文件头 :1-25），同目录的活页是 NegativeResultsPage。
//   ★方向只有一条：不减断言、不放宽阈值、不改断言对象之外的任何东西；
//     只把「断言某个死页面存在」换成「断言它接管的活页、以及旧路径重定向仍在」。
const wo = readFileSync(new URL('../WhereOffPage.tsx', import.meta.url), 'utf8'); // 披露落地页（合并体）
const neg = readFileSync(new URL('./NegativeResultsPage.tsx', import.meta.url), 'utf8'); // 同目录活页
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

test('披露落地页：接披露端点、标题不越权、缺件有可见兜底', () => {
  /* 闸的意图（自 2026-09-22 二轮起未变）：**披露数据必须真的接在活页上**，
   * 且**取不到时必须说人话**（原「披露件暂缺（n/a）。生成命令：node …」——
   * 用户看到脚本名以为页面报错）。闸的意图不变：**缺件必须有可见兜底，且不得编数**。
   *
   * ★断言对象从 CalendarPage 改成 WhereOffPage + NegativeResultsPage：
   *   日历页已删，而它接手的两个端点都还挂着——calibration 在合并体上（wo 的主数据源），
   *   negative-results 在同目录的活页上。★日历那部分内容**没有**并进合并体，
   *   这件事 App.tsx:27-30 已如实记账（「要真并进去属另立项」），
   *   所以这里**不去断言一段仓里已不存在的文案**（实测全仓 grep：`待验证队列` 只剩
   *   App.tsx:28 那句记账注释，`/api/disclosure/calendar` 活页零引用）——
   *   硬断言它等于逼着人把死页复活，那是拿测试造事实。
   *   书签不断由下面第 3 道闸管：旧路径 → 实挂落地页 → 落地页挂宽档。
   */
  assert.ok(wo.includes('/api/disclosure/calibration'), '落地页缺披露端点');
  assert.ok(neg.includes('/api/disclosure/negative-results'), '负结果页缺披露端点');

  // 标题不得越权：合并体的 h1 陈述的是「偏在哪儿」，不是「你准不准」
  assert.ok(wo.includes('<h1>我在哪儿偏了</h1>'), '落地页标题不是「我在哪儿偏了」（口径越权或被改）');
  assert.ok(wo.includes('这一页不给你总分'), '缺口径声明（只披露不裁决）');

  assert.ok(neg.includes('这项数据还没准备好'), '缺缺件兜底文案');
});

test('落地页：接披露端点、薄格标注、限定语块、Term 渐进披露', () => {
  assert.ok(wo.includes('/api/disclosure/calibration'), '缺端点');

  // 薄格标注（原断言的字面量「n<30 仅方向」随死页删除，仓内已无此串——实测 grep 零命中）。
  // ★换成合并体上**读者真能看见的三句**：薄格单列一栏 / n<30 写明 / 薄格不给误差值。
  //   比原来的一条更具体，不是放宽。
  assert.ok(wo.includes('只记方向，不下结论的格'), '缺薄格单列一栏');
  assert.ok(wo.includes('样本不足 30'), '缺 n<30 门限的明文标注');
  assert.ok(wo.includes('不给误差值'), '薄格不给误差值这条纪律丢了');

  // 限定语块：合并体从同一个后端字段取，负结果页恒挂三条
  assert.ok(wo.includes('限定语块'), '缺限定语块');
  assert.ok(neg.includes('限定语块'), '负结果页缺限定语块');

  // Term 渐进披露 + 贝叶斯术语 id
  assert.ok(neg.includes('<Term'), '未接 Term');
  assert.ok(neg.includes('bayesPrior') && neg.includes('posteriorAgg'), '贝叶斯术语 id 未用');
});

test('披露数据：旧路径重定向到**实挂**落地页，且落地页挂宽档', () => {
  /* 闸的意图（自 2026-09-22 二轮起未变）：**这些数据必须有落地页且有宽档**。
   *
   * ★为什么断言对象从「CalendarPage / OverviewPage 两个组件名」改成「旧路径 → 实挂落地页 → 落地页宽档」：
   *   2026-09-27 八轮把五页看板合并成 /where-off，五页的 import **刻意删掉**了
   *   （组件再不被渲染，tsc 报 TS6133，见 App.tsx:19-29 的留痕注释）。
   *   ⇒ 改写的是断言的**写法**，不是它的**松紧**：下面的每一条都比原断言更具体
   *     （原断言只查两个名字在不在；改写后逐条查「五条旧路径各自重定向到谁 /
   *       落地页是不是真组件实挂 / 落地页容器档是不是宽档」）。
   *
   * ★2026-09-30：死页源码已删之后，**这道闸成了唯一还证明「书签不断」的东西**——
   *   前两道断言活页的诚实性，这道断言旧路径仍然落得到、且落得宽。逐条原文照旧，未改。
   */
  assert.ok(app.includes("'/calendar'"), '缺日历路由');
  assert.ok(app.includes("'/overview'"), '缺总览路由');
  assert.ok(app.includes("'/calibration'") && app.includes('Navigate to="/overview"'), '旧校准路径未重定向到总览');

  // ① 落地页必须**实挂**（挂真组件），不是重定向到自己 / 落到 *
  assert.ok(/<Route path="\/where-off" element=\{<WhereOffPage \/>\} \/>/.test(app), '落地页 /where-off 未实挂 WhereOffPage');

  // ② 八轮接手的四条披露旧路径，各自重定向到落地页（书签不断，且都落得到）
  for (const legacy of ['/overview', '/audit', '/calendar', '/compiler']) {
    assert.ok(
      new RegExp(`<Route path="${legacy}" element=\\{<Navigate to="/where-off" replace \\/>\\} />`).test(app),
      legacy + ' 未重定向到落地页 /where-off',
    );
  }

  // ③ 宽档：落地页容器必须是 content--wide。合并前这四页都是宽档（1280），
  //    合并后容器一度退回 .content 的 720px —— 闸就是防这个的（见 App.tsx containerClass 注释）。
  assert.ok(app.includes('content--wide'), '缺宽档');
  assert.ok(
    /if \(path === '\/where-off'\) return 'content content--wide';/.test(app),
    '落地页 /where-off 未挂宽档（披露数据页被缩回阅读宽 720）',
  );
});

test('禁词黑名单：披露活页与 App 不含「预测」字样', () => {
  /* ★扫描面随死页删除而搬家（见文件头）。剥注释的写法沿用仓内现成范式
   *   verdict-spread-ui.test.mjs:43：纪律注释里会**提到**被禁的写法，
   *   不剥就会把「我们禁止它」那句话判成「我们用了它」。
   *   （实测 WhereOffPage / NegativeResultsPage / App 三个文件全文「预测」命中数均为 0。） */
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [name, src] of [['WhereOffPage', strip(wo)], ['NegativeResultsPage', strip(neg)], ['App', strip(app)]]) {
    assert.ok(src.indexOf('预测') === -1, name + ' 出现禁词「预测」');
  }
});
