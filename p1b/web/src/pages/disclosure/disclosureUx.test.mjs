import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// P0-U7/U8 页面化（2026-09-16）：源码级断言（沿 intakeUx/auditTerms 先例，零 DOM 依赖）
const cal = readFileSync(new URL('./CalendarPage.tsx', import.meta.url), 'utf8');
const rep = readFileSync(new URL('./CalibrationReportPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

test('日历页：接披露端点、标题用「待验证队列」、缺件有兜底', () => {
  assert.ok(cal.includes('/api/disclosure/calendar'), '缺端点');
  assert.ok(cal.includes('待验证队列'), '缺标题');
  // 2026-09-22 二轮：缺件兜底改人话（原「披露件暂缺（n/a）。生成命令：node …」——
  // 用户看到脚本名以为页面报错）。闸的意图不变：**缺件必须有可见兜底，且不得编数**。
  assert.ok(cal.includes('这项数据还没准备好'), '缺缺件兜底文案');
  assert.ok(cal.includes('只披露不裁决'), '缺口径声明');
});

test('校准报告页：接披露端点、薄格标注、限定语块、Term 渐进披露', () => {
  assert.ok(rep.includes('/api/disclosure/calibration'), '缺端点');
  assert.ok(rep.includes('n<30 仅方向'), '缺薄格标注');
  assert.ok(rep.includes('限定语块'), '缺限定语块');
  assert.ok(rep.includes('<Term'), '未接 Term');
  assert.ok(rep.includes('bayesPrior') && rep.includes('posteriorAgg'), '贝叶斯术语 id 未用');
});

test('披露数据：旧路径重定向到**实挂**落地页，且落地页挂宽档', () => {
  /* 闸的意图（自 2026-09-22 二轮起未变）：**这些数据必须有落地页且有宽档**。
   *
   * ★为什么断言对象从「CalendarPage / OverviewPage 两个组件名」改成「旧路径 → 实挂落地页 → 落地页宽档」：
   *   2026-09-27 八轮把五页看板合并成 /where-off，五页的 import **刻意删掉**了
   *   （组件再不被渲染，tsc 报 TS6133，见 App.tsx:19-29 的留痕注释），
   *   源码**保留不删**——因为本文件第 4 道禁词闸就是拿它们当扫描目标，删了就失去扫描面。
   *   于是「组件名出现在 App.tsx」这条断言在八轮之后**永远不可能成立**，
   *   而它锁的意图（数据有落地页、落地页是宽档）**依然完全成立且必须继续成立**。
   *   ⇒ 改写的是断言的**写法**，不是它的**松紧**：下面的每一条都比原断言更具体
   *     （原断言只查两个名字在不在；改写后逐条查「五条旧路径各自重定向到谁 /
   *       落地页是不是真组件实挂 / 落地页容器档是不是宽档」）。
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

test('禁词黑名单：两页源码与 App 不含「预测」字样', () => {
  for (const [name, src] of [['CalendarPage', cal], ['CalibrationReportPage', rep], ['App', app]]) {
    assert.ok(src.indexOf('预测') === -1, name + ' 出现禁词「预测」');
  }
});
