import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./styles/ui.css', import.meta.url), 'utf8');
const p1b4 = readFileSync(new URL('./styles/p1b4.css', import.meta.url), 'utf8');
const manage = readFileSync(new URL('./pages/ManagePage.tsx', import.meta.url), 'utf8');
/* ★2026-09-30 口径修正：**死页面源码已删**。本文件原来读的两份文件已不在盘上——
 *   pages/audit/AuditPage.tsx（审计页）与 styles/intake.css（死页专属样式），
 *   随 2026-09-30 删死页源码那一轮一起删的（连同 pages/intake/IntakePage.tsx）。
 *   原写法在**模块加载期**就 ENOENT ⇒ 整文件 10 个用例全灭（不是"某条红"，是"一条不跑"）：
 *   实测 `node --test src/layoutUx.test.mjs` → tests 1 / pass 0 / fail 1，报 ENOENT intake.css。
 * 下面这两条读的是**活锚点**：
 *   noteCss  —— 现接题页 /note 的样式（NotePage.tsx:37 import 它）。/intake 早就是重定向
 *              （App.tsx:190 → /note），intake.css 随死页消失后无处可指。
 *   negative —— NegativeResultsPage.tsx，披露面**唯一**还活着的 `.ui-skeleton` 消费方
 *              （NegativeResultsPage.tsx:125；全 src 只此一处）。 */
const noteCss = readFileSync(new URL('./styles/note.css', import.meta.url), 'utf8');
const negative = readFileSync(new URL('./pages/disclosure/NegativeResultsPage.tsx', import.meta.url), 'utf8');

// ── 容器改宽 ──
test('接题页与对局页已改宽到 1280（与审计页同档）', () => {
  assert.ok(/path === '\/intake' \|\| path === '\/manage'/.test(app), '接题/对局未归入 wide');
  assert.ok(/path === '\/audit'\) return 'content content--wide'/.test(app), '审计页 wide 被改');
});

test('设置页仍为表单宽 720（单列易读，不该跟着改宽）', () => {
  assert.ok(/path === '\/settings'\) return 'content content--form'/.test(app), '设置页宽度被误改');
});

test('接题页（/intake 现重定向到 /note）宽屏多列、窄屏回落单列', () => {
  /* ★2026-09-30 口径修正。原断言读 styles/intake.css 里那套
   *   「主区 minmax(0,1fr) ＋ 固定 360px 侧栏、1023px 以下回落单列」——
   *   `.intake-grid`/`.intake-side` 是**死页专属**形制，随 IntakePage.tsx 一起删了。
   *   实测：`1fr) 360px` 在全 src 的 CSS 里**零命中**，这套宽屏双列已无任何活载体。
   * 闸的意图（宽屏并排不挤压、窄屏收敛成单列）**依然成立**，载体换成了现接题页 /note。
   * ⇒ 按纪律改成断言活锚点，不是放宽：/intake 仍重定向到 /note（书签不断）＋ /note 实挂
   *   ＋ 现接题样式里**每一条多列都要配一条窄屏回落**（原 :24 那半条原样搬过来，只换了文件）。
   *   断言条数 2 → 5，覆盖面只升不降。 */
  assert.ok(/<Route path="\/intake" element=\{<Navigate to="\/note" replace \/>\} \/>/.test(app),
    '/intake 旧路径须仍重定向到 /note（书签不断）');
  assert.ok(/<Route path="\/note" element=\{<NotePage \/>\} \/>/.test(app),
    '/note 须实挂 NotePage：/intake 的重定向终点落空＝书签还是断');

  // 宽屏并排（现接题页：回执「标签/值」两列、算数「两个数」并排）
  assert.ok(/\.note-receipt-list \{ display: grid; grid-template-columns: 64px 1fr;/.test(noteCss), '回执区缺宽档两列');
  assert.ok(/\.note-nums \{ display: grid; grid-template-columns: 1fr 1fr;/.test(noteCss), '算数区未并排');
  // 窄屏回落单列（每条多列都必须有配对的 collapse，否则宽屏内容挤成竖排）
  assert.ok(/@media \(max-width: 375px\)[\s\S]*?\.note-receipt-list \{ grid-template-columns: 1fr;/.test(noteCss), '回执区缺窄屏回落');
  assert.ok(/@media \(max-width: 480px\)[\s\S]*?\.note-nums \{ grid-template-columns: 1fr;/.test(noteCss), '算数区缺窄屏回落');
});

test('接题面是单列 720（结果紧随其后，不设侧栏）——/intake 重定向仍不断', () => {
  /* ★2026-09-30 口径修正。**如实记账：这一条的原断言已无法保留原形。**
   *   原断言锁 `.intake-side` 在 min-width:1024px 下的 `position: sticky`——
   *   那是死页 IntakePage.tsx / intake.css 独有的结构，全仓零活载体
   *   （实测 `1fr) 360px` 在所有 CSS 里 0 命中；note.css 内亦无 360px）。
   *   现接题页 /note 的形制是**单列 720**：一页只做两件事——写下题面、选一个答案来源，
   *   系统回建议（.note-advice）就跟在表单下面（note.css:6 max-width:720px），
   *   「填表时结果始终可见」在单列里由"从上到下"天然满足，不再需要吸顶。
   *   删断言=削弱闸门，所以按纪律翻成对**新事实**的断言：
   *     ① /intake 仍重定向到 /note（死页删掉后，唯一还在承重的就是这个）；
   *     ② 现接题样式真的还是单列 720（形制没被悄悄改掉）；
   *     ③ 活样式里不得复现已删死页那套 360px 固定侧栏（防"半复活"迁移）。
   *   ★要真给某个活页做双列吸顶，属产品侧决定，须改产品源码，不在本文件授权内。 */
  assert.ok(/<Route path="\/intake" element=\{<Navigate to="\/note" replace \/>\} \/>/.test(app),
    '/intake 旧路径须仍重定向到 /note（书签不断）');
  assert.ok(/\.note \{ max-width: 720px; \}/.test(noteCss), '现接题页不再是单列表单宽');
  assert.ok(!noteCss.includes('360px'),
    '活样式里复现了已删死页的 360px 固定侧栏（迁移做了一半：样式回来、组件没回来）');
});

test('对局列表改横排多列（利用新增宽度）', () => {
  assert.ok(/repeat\(auto-fill, minmax\(300px, 1fr\)\)/.test(p1b4), '列表未改多列');
});

// ── 交互感 ──
test('可交互元素统一过渡（禁 0ms 瞬变）', () => {
  assert.ok(/transition: border-color 160ms ease/.test(ui), '缺统一过渡');
});

test('有按下反馈（触屏可感知）', () => {
  assert.ok(/:active/.test(ui) && /translateY\(1px\)/.test(ui), '缺按下反馈');
});

test('加载骨架已实现且不跳动（CLS）', () => {
  assert.ok(ui.includes('.ui-skeleton'), '缺骨架样式');
  assert.ok(ui.includes('ui-shimmer'), '缺骨架动画');
  /* ★2026-09-30 口径修正。原 :47 查 AuditPage.tsx 用了 `ui-skeleton`、
   *   原 :48 查它的 `kpi-skeleton` 容器 testId——两者都随死页删除而消失。
   *   实测（改写前跑的）：全 src grep `kpi-skeleton`，**唯一命中就是本文件这条断言自己**，
   *   活代码零命中；活着的骨架消费方只剩 NegativeResultsPage.tsx:125 一处。
   *   ⇒ :47 改指那个活消费点。
   *   :48 原来锁的"骨架容器带 data-testid"**在活代码里已无载体**：唯一带 testId 的骨架
   *     跟死页一起没了。这里**没有等价物可搬**——凭空断言 testId 存在=必红，
   *     给负结果页骨架 div 补 testId=改产品源码（不在本文件授权内）。
   *     如实记账：把测试名里真正要防的东西（**占位不跳动 / CLS**）落回 CSS 机制判据——
   *     骨架必须自带 min-height 占位（ui.css:226）。这比原来那条更贴近测试名本身。 */
  assert.ok(negative.includes('className="ui-skeleton"'), '披露页（现唯一活着的骨架消费方）未使用骨架');

  const skelBlock = ui.slice(ui.indexOf('.ui-skeleton {'), ui.indexOf('@keyframes ui-shimmer'));
  assert.ok(/min-height: \d+px/.test(skelBlock), '骨架未占位（占位塌了＝CLS 跳动）');
});

test('空态给下一步动作（不只描述）', () => {
  assert.ok(manage.includes('＋ 现在开一局'), '对局空态缺动作按钮');
  assert.ok(manage.includes('manage-empty'), '缺空态 testId');
});

test('卡片悬浮有反馈但不越 Ornate 红线（禁发光）', () => {
  assert.ok(/\.ui-stat:hover, \.ui-section:hover \{ border-color/.test(ui), '缺悬浮反馈');
  const shimmer = ui.slice(ui.indexOf('.ui-skeleton'));
  assert.ok(!/box-shadow:\s*0\s+0\s+\d+px\s+rgba/.test(shimmer), '出现装饰性发光');
});
