import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(new URL('./x', import.meta.url)));
const read = (f) => readFileSync(join(dir, f), 'utf8');
const all = ['ChartFrame.tsx', 'Gauge.tsx', 'ErrorBar.tsx', 'HeatGrid.tsx', 'Bars.tsx', 'LineChart.tsx', 'Controls.tsx']
  .map((f) => read(f)).join('\n');
const css = readFileSync(join(dirname(dir), 'styles', 'charts.css'), 'utf8');
const fmt = readFileSync(join(dirname(dir), 'lib', 'format.ts'), 'utf8');

test('图表层不引任何图表库（守零依赖铁律）', () => {
  assert.equal(/from\s+['"](recharts|d3|victory|plotly|nivo|chart\.js)/.test(all), false, '引入了图表库');
});

test('扇形必带数值文字 + 堆叠条替代（accessibility=C 兜底）', () => {
  const g = read('Gauge.tsx');
  assert.ok(g.includes('gauge-num'), '扇形缺数值文字');
  assert.ok(g.includes('asBar') && g.includes('gauge-bar'), '扇形缺条形替代视图');
  assert.ok(g.includes('aria-label'), '扇形缺 aria-label');
});

test('热力表有三条兜底：数值图例 + 斜纹 + 每格数值（accessibility=B）', () => {
  const h = read('HeatGrid.tsx');
  assert.ok(h.includes('heat-legend-bar'), '缺数值颜色图例');
  assert.ok(h.includes('is-thin') && css.includes('.heat-cell.is-thin') && /repeating-linear-gradient/.test(css), '薄格缺斜纹图案兜底');
  assert.ok(h.includes('heat-num'), '格上缺直接数值');
});

test('稀疏格不当 0：无数据格与 0 分格分开画', () => {
  const h = read('HeatGrid.tsx');
  assert.ok(h.includes('is-nodata'), '缺无数据格分支');
  assert.ok(h.includes('无数据'), '缺无数据文案（不得暗示该格测得 0）');
});

test('区间缺失不画须且留空态文字', () => {
  const e = read('ErrorBar.tsx');
  assert.ok(e.includes('hasCi'), '缺 CI 存在性判定');
  assert.ok(e.includes('n<30 不出 CI'), '缺空态文案');
  assert.ok(e.includes('样本不足'), '缺点估计空态文案');
});

test('折线空值断线，不跨 null 连线', () => {
  const l = read('LineChart.tsx');
  // 2026-09-22 五轮：折线改单调三次平滑后，null 处理从「pen 标记」改为「切连续段」。
  // 闸的**意图**不变——空值处必须断开、不得跨越连线。故断言新的结构不变量：
  //   · 遇 null 时把当前段收进 segs 并重置（而不是继续往同一条 path 追加）
  //   · 每段独立生成 path（segs.map），段与段之间不会有连接指令
  assert.ok(l.includes('if (y === null)'), 'null 未做分支处理');
  assert.ok(/segs\.push\(cur\)[\s\S]*cur = \[\]/.test(l), 'null 处未切断线段（会跨空值连线）');
  assert.ok(l.includes('segs.map('), '各连续段未独立建 path');
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

test('格式化真源的契约文案不得漂移（与 dist 测试同向）', () => {
  assert.ok(fmt.includes("'样本不足'"), 'tri/pct 空态文案被改');
  assert.ok(fmt.includes("'n<30 不出 CI'"), 'CI 空态文案被改');
  assert.ok(fmt.includes('n<30 仅方向'), '薄格口径文案被改');
});

test('空值绝不当 0 绘制（hasNum 判定存在于真源）', () => {
  assert.ok(fmt.includes('export function hasNum'), '缺 hasNum');
});

/* ══ 2026-09-27 八轮第四改 · 标本带（SpecimenStrip）══
 * 病象：29 个「层×域」格被拆成 6 张**等质**卡片 ⇒ 独立 critic 判
 *   「连 L4 都没数据和 L1 拿到一模一样的盒子 ⇒ 同样的盒子 = 同样的确定性」，
 *   恰是本产品最要防的误读（读不出"哪 10 格够、哪 19 格不够"）。
 * 本闸锁三条纪律：
 *   ① 三态用**形状**（实心 / 斜纹 / 虚线框）而非仅颜色 ⇒ 黑白打印与色觉障碍免读；
 *   ② 薄格必须显示破折号"—"，**绝不显示 0**（0 是"测了是 0"，薄格是"没测够"）；
 *   ③ 空位/被筛掉的格**保留占位**不删除（防"筛完数据就消失了"的错觉）。 */
const stripSrc = read('SpecimenStrip.tsx');
const stripCss = readFileSync(join(dir, '..', 'styles', 'charts.css'), 'utf8');

test('标本带①：三态用形状区分（实心/斜纹/虚线框），非仅颜色', () => {
  assert.ok(stripSrc.includes('is-ok'), '缺够格（实心）态');
  assert.ok(stripSrc.includes('is-thin'), '缺薄格（斜纹）态');
  assert.ok(stripCss.includes('.strip-cell.is-ok'), '实心态无样式');
  assert.ok(stripCss.includes('.strip-cell.is-thin'), '斜纹态无样式');
  assert.ok(stripCss.includes('border-style: dashed'), '薄格须用虚线框（与斜纹叠加＝两道非颜色信号）');
});

test('标本带②：薄格显示「—」，绝不显示 0', () => {
  assert.ok(stripSrc.includes('strip-cell-dash'), '薄格须有破折号元素');
  assert.ok(stripSrc.includes('—'), '破折号字面量缺失');
  // 不允许把 n 直接印在薄格上当作"读数 0"
  assert.equal(/is-thin[\s\S]{0,200}\{c\.n\}/.test(stripSrc), false,
    '薄格不得把 n 当读数印出（n<30 是"没测够"不是"测了是 0"）');
});

test('标本带③：aria 完整说明，且明确区分「未测」与「0」', () => {
  assert.ok(stripSrc.includes('aria-label'), '缺 aria-label');
  assert.ok(stripSrc.includes('不是「数据为 0」') || stripSrc.includes('「未测」'),
    'aria/说明须点明「未测」与「数据为 0」不是一回事');
});

/* 标本带纪律④：筛选只改对比度，不改格数。
 * 病象（★本轮我自己犯的）：接 URL 筛选时把 filtered 数组整个传给带子，
 *   于是 29 格 → 7 格，被筛掉的 22 格**从页面上消失**——而带子的说明里
 *   明明写着「筛不掉的格保留占位不删除」。用户会把「筛掉了 22 格」
 *   误读成「数据没了 22 格」，恰是本产品最要防的那类误读。
 * 本闸锁两处：带子支持 dimmed 态；页面传的是**全量**格而非 filtered。 */
test('标本带④：筛选只降对比度，不减少格数', () => {
  assert.ok(stripSrc.includes('dimmed'), '带子须支持 dimmed（被排除但仍占位）');
  assert.ok(stripCss.includes('.strip-cell.is-dimmed'), '缺 dimmed 降对比样式');
  const ov = readFileSync(join(dir, '..', 'pages', 'audit', 'OverviewPage.tsx'), 'utf8');
  assert.ok(/cells=\{cells\.map/.test(ov), '★页面须传**全量** cells（不是 filtered），否则格数会随筛选变少');
  assert.ok(ov.includes('dimmed: !filtered.includes(c)'), '须用 dimmed 标记被排除的格');
});
