import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(new URL('./x', import.meta.url)));
const srcDir = join(dir, '..');
const read = (f) => readFileSync(join(dir, f), 'utf8');

/* ══ 2026-09-30 口径修正：死页面源码已删，本文件跟着改口径
 *
 * 事实（工作区 `git status` 实测）：八轮收口把 8 个死页面的源码删了，它们私带的
 * 图表组件与工具一并没了——`charts/` 下现在只剩 BiasStrip / ErrorBar / scale 三个
 * 源文件，`lib/format.ts` 也已删除。本文件原版在**顶层**逐个 readFileSync 七个组件
 * 加 lib/format.ts，其中六个组件加 format.ts 已不存在 ⇒ 顶层 ENOENT ⇒
 * 17 条用例一条都跑不起来。
 *
 * 改法（不削闸门强度，只换瞄准对象）：
 *   ① 顶层改为**按目录枚举** charts/ 活着的源码，而不是点名一份必然过期的清单。
 *      将来新加的图表自动纳入零依赖与硬编码 hex 两道扫描 ⇒ 比原「7 项点名」更严。
 *   ② 每条「某组件有某性质」的断言，改成钉**该纪律在活代码里的落点**。
 *   ③ 确实已无活实现的那几条（标本带①②③、标本带④的组件侧），不假装它们还有实现方，
 *      改为登记在「死图表模块不许回来」那道闸里——哪天有人把它们加回来，本文件当场
 *      红，那时才谈得上把对应纪律重新武装。旧**页面**的红则改按新事实断言：
 *      源码没了，但旧路径必须仍在重定向、且最终落在活页面上。 */
const chartFiles = readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).sort();
const all = chartFiles.map((f) => read(f)).join('\n');
const css = readFileSync(join(srcDir, 'styles', 'charts.css'), 'utf8');
const whereoff = readFileSync(join(srcDir, 'pages', 'WhereOffPage.tsx'), 'utf8');
const app = readFileSync(join(srcDir, 'App.tsx'), 'utf8');
const terms = readFileSync(join(srcDir, 'lib', 'terms.ts'), 'utf8');

/* 路由解析：/calibration → /overview → /where-off 是两跳，
 * 只看第一跳会误判「指向了空白页」。这里跟着 Navigate 链走到真正渲染的组件，
 * 并对成环设防。 */
const resolveRoute = (p, seen = new Set()) => {
  const live = app.match(
    new RegExp('<Route path="' + p + '" element=\\{<([A-Za-z]+) \\/>\\} \\/>'));
  if (live) return live[1];
  const nav = app.match(
    new RegExp('<Route path="' + p + '" element=\\{<Navigate to="([^"]+)" replace \\/>\\} \\/>'));
  if (!nav) return null;
  if (seen.has(p)) return null;
  seen.add(p);
  return resolveRoute(nav[1], seen);
};

test('图表层不引任何图表库（守零依赖铁律）', () => {
  // 目录被整删时这道闸会空跑（正则扫空串恒为 false）⇒ 先钉住「确实扫到了东西」
  assert.ok(chartFiles.length > 0, 'charts/ 枚举为空 ⇒ 零依赖检查已空跑，失去意义');
  assert.equal(/from\s+['"](recharts|d3|victory|plotly|nivo|chart\.js)/.test(all), false, '引入了图表库');
});

test('数值必以文字呈现，不许只画不说（accessibility=C 兜底的活落点）', () => {
  // ★原闸打在 Gauge.tsx 上（gauge-num / asBar+gauge-bar / aria-label）。
  //   扇形随死页面删除、产品里已无扇形图；同一纪律的活落点是误差须与偏流条：
  //   图形之外必须另有一份可读文字，读不出来时写空态、不得被图形替掉。
  const e = read('ErrorBar.tsx');
  assert.ok(e.includes('errbar-value'), '误差须缺「文字读出」容器（读数只在图形里＝只画不说）');
  assert.ok(/tv === null \? '样本不足'/.test(e), '点估计空态不得被图形替掉');
  assert.ok(e.includes('role="img"') && e.includes('aria-label'), '误差须缺 role=img / aria-label');
  const b = read('BiasStrip.tsx');
  assert.ok(b.includes('aria-label'), '偏流条缺 aria-label');
  assert.ok(b.includes('bias-axis-labels') && b.includes('无信息线 0.25'),
    '偏流条缺轴标文字（没有轴标的「长短」读不出含义）');
});

test('薄格与够格靠**形状**区分，不是只靠颜色（accessibility 的活落点）', () => {
  // ★原闸①打在 SpecimenStrip.tsx、③的第二条打在 HeatGrid.tsx（数值图例＋斜纹）。
  //   两者皆随死页面删除。同一纪律的活落点是偏流条：够格＝实心条，薄格＝空心
  // ＋虚线描边（fill:none 与 stroke-dasharray 两道非颜色信号），黑白打印与色觉
  //   障碍仍可读；图例里也必须带同一个记号，否则读者学不会两态的区别。
  const b = read('BiasStrip.tsx');
  assert.ok(b.includes('bias-thin') && b.includes('bias-bar'), '偏流条缺两态记号');
  const t = css.indexOf('.bias-thin {');
  assert.ok(t > 0, 'charts.css 缺 .bias-thin 规则');
  const thinRule = css.slice(t, t + 200);
  assert.ok(thinRule.includes('fill: none'), '薄格须空心（实心＝与够格同形）');
  assert.ok(/stroke-dasharray/.test(thinRule), '薄格须用虚线描边（与空心叠加＝第二道非颜色信号）');
  assert.ok(css.includes('.bias-key i.is-thin'), '图例里缺薄格记号');
});

test('稀疏格不当 0：薄格栏只给 n 与破折号，不给任何误差值', () => {
  // ★原闸②打在 SpecimenStrip.tsx 的 is-nodata 分支上。活落点是 WhereOffPage 的
  //   「只记方向，不下结论」栏：薄格是**还没测够**，与「测了是 0」必须不可混同。
  const s0 = whereoff.indexOf('<ul className="thin-strip"');
  assert.ok(s0 > 0, '★活页面「只记方向」栏消失（薄格会无处安放）');
  const thinBlock = whereoff.slice(s0, whereoff.indexOf('</ul>', s0));
  assert.ok(thinBlock.includes('thin-cell is-unmeasured'), '薄格须与够格视觉分开');
  assert.ok(thinBlock.includes('thin-dash') && thinBlock.includes('—'), '薄格须有破折号元素');
  // 「样本太少但还是算了个数」正是本产品最要防的误导 ⇒ 栏里不得出现任何读数
  assert.equal(/delta|brier|toFixed|point_estimate/.test(thinBlock), false,
    '★薄格栏不得印出任何误差/读数值');
  assert.ok(whereoff.includes('不给误差值'), '薄格栏的说明文案被删（得说清为什么不给数）');
});

test('区间缺失不画须且留空态文字', () => {
  const e = read('ErrorBar.tsx');
  assert.ok(e.includes('hasCi'), '缺 CI 存在性判定');
  assert.ok(e.includes('n<30 不出 CI'), '缺空态文案');
  assert.ok(e.includes('样本不足'), '缺点估计空态文案');
});

test('折线空值断线，不跨 null 连线（活落点＝比例尺里的 polylinePoints）', () => {
  // ★原闸打在已删除的 LineChart.tsx 上（遇 null 收段、每段独立 path）。
  //   这条纪律的**实现**活在 charts/scale.ts 的 polylinePoints：空值只进 gaps、
  //   绝不作为坐标点输出，调用方据此断开。
  //   如实记账：polylinePoints 目前**没有调用方**（全库只有它自己的定义），
  //   所以这道闸守的是那个实现，不是某张已渲染的折线图——不许把它当成「折线图已测过」。
  const s = read('scale.ts');
  const fn = s.slice(s.indexOf('export function polylinePoints'));
  assert.ok(fn.includes('gaps'), '缺 gaps 出口（调用方无从知道该在哪断开）');
  assert.ok(/v === null \|\| !Number\.isFinite\(v\)\) \{ gaps\.push\(i\); continue; \}/.test(fn),
    '空值必须只记进 gaps 并跳过，绝不能作为坐标点输出（否则会跨空值连线）');
  assert.ok(/return \{ d: pts\.join\(' '\), gaps \}/.test(fn),
    '返回结构被改（调用方按 { d, gaps } 解构）');
});

test('图表色值全取 CSS 变量，组件不硬编码 hex', () => {
  const hardHex = all.match(/(fill|stroke|background)\s*[:=]\s*["']#[0-9a-fA-F]{3,6}/g) ?? [];
  assert.deepEqual(hardHex, [], '组件里出现硬编码 hex: ' + hardHex.join(', '));
});

test('图表层禁装饰性发光', () => {
  assert.equal(/box-shadow:\s*0\s+0\s+\d+px/.test(css), false, 'charts.css 出现发光');
});

test('图表层响应式三断点齐备 + 触控放大', () => {
  assert.ok(css.includes('1023px') && css.includes('767px') && css.includes('374px'), '缺断点');
  assert.ok(/@media \(max-width: 767px\)[\s\S]*min-height: 44px/.test(css), '窄屏未放大触控目标');
});

test('空态口径文案不得漂移（真源随死代码删除，改钉活着的两处）', () => {
  // ★原闸断言 lib/format.ts 里的三句口径文案。该文件已删：「样本不足」「n<30 不出 CI」
  //   活到了 ErrorBar 与术语表；「n<30 仅方向」的字面量全库零命中，它的活版是
  //   WhereOffPage 上那句「只记方向，不下结论」——钉的是**在用的那句**，不是旧字面量。
  const e = read('ErrorBar.tsx');
  assert.ok(e.includes("'样本不足'"), '点估计空态文案被改');
  assert.ok(e.includes('n<30 不出 CI'), 'CI 空态文案被改');
  assert.ok(terms.includes("caveat: 'n<30 不出 CI'"), '术语表的 CI 口径文案被改');
  assert.ok(whereoff.includes('只记方向，不下结论'), '薄格口径文案被改（活页面上的那句）');
});

test('空值绝不当 0 绘制（判定在比例尺真源里）', () => {
  // ★原闸断言 lib/format.ts 有 `export function hasNum`。该文件已删、hasNum 全库
  //   零命中。同一纪律的活真源是 charts/scale.ts 的 norm()：null/undefined/非有限
  //   一律返回 null（源码原话「宁可空态，不画假点」），调用方据此走空态分支。
  const s = read('scale.ts');
  assert.ok(s.includes('export function norm'), '比例尺真源缺 norm');
  assert.ok(/export function norm\([\s\S]*?v === null \|\| v === undefined \|\| !Number\.isFinite\(v\)\) return null;/.test(s),
    'norm 缺空值守卫（null 当 0 会画出假点）');
  // 且误差须必须真的走这个守卫，而不是自己在外面糊一个 0
  const e = read('ErrorBar.tsx');
  assert.ok(e.includes("from './scale'") && e.includes('norm('), '误差须未走比例尺真源');
  assert.ok(/tv === null \?/.test(e), '误差须未按 norm 的 null 走空态');
});

test('aria 完整说明，且明确区分「未测」与「0」', () => {
  // ★原闸③打在 SpecimenStrip.tsx 上。活落点是 BiasStrip：aria 与图注都必须点明
  //   断线＝没测够，不是偏差 0——这是「没测够」与「偏差是 0」唯一可靠的文字区别。
  const b = read('BiasStrip.tsx');
  assert.ok(b.includes('aria-label'), '缺 aria-label');
  assert.ok(b.includes('不是「偏差是 0」'),
    'aria 须点明「没测够」与「偏差是 0」不是一回事');
  assert.ok(b.includes('断线方块，不是 0'), '图注须点明薄格是断线方块、不是 0');
});

/* 标本带纪律④：筛选不许让格子从页面上消失。
 * 病象（★本轮我自己犯的）：接 URL 筛选时把 filtered 数组整个传给带子，
 *   于是 29 格 → 7 格，被筛掉的 22 格**从页面上消失**——而带子的说明里
 *   明明写着「筛不掉的格保留占位不删除」。用户会把「筛掉了 22 格」
 *   误读成「数据没了 22 格」，恰是本产品最要防的那类误读。 */
test('偏流条喂的是全量：筛选只许剔「算不出偏差」的格，不许剔薄格', () => {
  // ★原闸打在 SpecimenStrip.tsx（dimmed 态）＋已删除的 pages/audit/OverviewPage.tsx
  //   （`cells={cells.map` 与 `dimmed: !filtered.includes(c)`）。两处实现方都没了，
  //   但纪律没消失：它落在 WhereOffPage 喂 BiasStrip 的那处筛选上。
  //   活版形态变了——不再是「降对比度」，而是「薄格根本不进筛选，于是断线方块
  //   一直画在图上」。这是更强的保证：薄格**不可能**被筛掉，因为它压根不在筛掉的集合里。
  const start = whereoff.indexOf('const points');
  assert.ok(start > 0, '★活页面喂偏流条的那处计算消失');
  const pts = whereoff.slice(start, whereoff.indexOf('/** 老犯的毛病'));
  assert.ok(/delta_vs_half !== null/.test(pts), '只许剔「算不出偏差」的格');
  assert.equal(/conclusion_allowed/.test(pts), false,
    '★不得按 conclusion_allowed 剔格——那会把薄格从带子上删掉，读者看不到「这里没测够」');
  assert.ok(/<BiasStrip[^>]*points=\{points\}/.test(whereoff),
    'BiasStrip 未直接吃全量 points（中间又过了一道筛选？）');
});

test('★死页面的旧路径仍在重定向，且最终落在活页面上', () => {
  // 原第④条闸读的是已删除的 pages/audit/OverviewPage.tsx。改按新事实断言：
  // 源码没了，但**旧路径必须仍在、必须仍重定向到某个真在渲染的活页面**——
  // 否则删源码就等于给旧书签开了一扇空白页。
  for (const p of ['/overview', '/audit', '/intake', '/calendar', '/compiler',
    '/calibration', '/bayes-lens', '/arena']) {
    const page = resolveRoute(p);
    assert.ok(page, '旧路径 ' + p + ' 断了（既不渲染活页面也不再重定向）——源码已删，这等于空白页');
    assert.ok(app.includes("from './pages/" + page + "'"),
      '旧路径 ' + p + ' 指向的 ' + page + ' 没有被 App.tsx 导入（重定向落点本身是死的）');
  }
});

/* 死图表模块不许悄悄回来。
 * 上面的闸门里，标本带①②③ 与第④条的组件侧全部改钉到了 BiasStrip / ErrorBar /
 * 刻度 之上；模块一回来，那些「组件侧有实现方」的假设就会失真。所以在这里把
 * 名单钉死：回来一个，本文件当场红，附言要求先把对应纪律补回来再放行。 */
test('★死图表模块不许悄悄回来（回来时对应纪律要重新武装）', () => {
  for (const f of ['ChartFrame.tsx', 'Gauge.tsx', 'HeatGrid.tsx', 'Bars.tsx', 'LineChart.tsx',
    'Controls.tsx', 'SpecimenStrip.tsx', 'DeviationBar.tsx', 'ReadoutCard.tsx', 'Waffle.tsx', 'index.ts']) {
    assert.equal(existsSync(join(dir, f)), false,
      f + ' 回来了——本文件关于它的那几条闸（扇形文字/热力表三兜底/折线断线/标本带四条）已随之退役，'
      + '必须先把纪律补回来再放行');
  }
  assert.equal(existsSync(join(srcDir, 'lib', 'format.ts')), false,
    'lib/format.ts 回来了——本文件的空态口径与 hasNum 两条闸已改钉别处，先确认为什么需要它');
  // 反向：活着的必须真的活着，否则上面大半闸门会因目录空转而空跑
  for (const f of ['BiasStrip.tsx', 'ErrorBar.tsx', 'scale.ts']) {
    assert.ok(existsSync(join(dir, f)), f + ' 不在了——本文件大半闸门失去扫描对象');
  }
});

/* BiasStrip 偏流条闸（八轮第六改）
 * 病象：旧形态是「六张等质读数卡」——critic 判「连 L4 都没数据和 L1 拿到一样的盒子
 *   ⇒ 同样的盒子 = 同样的确定性」，恰是本产品最要防的误读。
 * 本闸锁两条：
 *   ① 薄格（n<30）必须画成**断线空心方块**且不画竖线——画了竖线等于宣称
 *     "这里有偏差"，而"没测够"与"偏差是 0"必须视觉上不可混同。
 *   ② 纵轴以无信息线为零轴、向上=说大了/向下=说小了，且上下界参考线必须在。 */
test('偏流条①：薄格画断线方块，不画竖线（没测够≠偏差是0）', () => {
  const bias = read('BiasStrip.tsx');
  assert.ok(bias.includes('is-unmeasured') || bias.includes('bias-thin'), '缺薄格样式引用');
  assert.ok(bias.includes('p.n < 30'), '须以 n<30 判薄格');
  assert.ok(bias.includes('bias-thin'), '薄格须用 bias-thin（空心方块）');
  // 薄格分支里不能出现画 bar 的调用
  const thinBranch = bias.slice(bias.indexOf('thin ?'), bias.indexOf('thin ?') + 400);
  assert.equal(/bias-bar/.test(thinBranch), false, '薄格分支不得画 bias-bar（那是"有偏差"的记号）');
  assert.ok(/断线|没测够|不是「?偏差/.test(bias), '须在图注里点明断线=没测够，不是 0');
});

test('偏流条②：以无信息线为零轴，且有上下界参考线', () => {
  const bias = read('BiasStrip.tsx');
  const css = readFileSync(join(srcDir, 'styles', 'charts.css'), 'utf8');
  assert.ok(bias.includes('bias-axis'), '须画零轴');
  assert.ok(bias.includes('bias-bound'), '须画上下界参考线（否则"长短"无意义）');
  assert.ok(css.includes('.bias-axis'), '零轴缺样式');
  assert.ok(css.includes('.bias-bound'), '参考线缺样式');
  assert.ok(/is-over/.test(bias) && /is-under/.test(bias), '须区分"说大了"与"说小了"两种方向');
});
