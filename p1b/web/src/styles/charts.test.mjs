import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(new URL('./charts.css', import.meta.url)));
const css = readFileSync(join(dir, 'charts.css'), 'utf8');

/* ══ 2026-09-30 口径修正：Gauge 随死页面源码一起删了，本文件跟着改瞄准
 *
 * 事实（工作区 `git status` 实测）：八轮收口删掉了 8 个死页面的源码，
 * `charts/Gauge.tsx` 随之删除。本文件原版在**顶层** readFileSync 它
 * ⇒ 顶层 ENOENT ⇒ 两条用例一条都跑不起来（实测整文件 'test failed'）。
 *
 * 改法（不削闸门强度，只换瞄准对象）：
 *   ① 顶层改为**按目录枚举** charts/ 活着的组件，而不是点名一份必然过期的清单；
 *      将来新加的图表自动纳入下面「尺寸由组件 props 控制」那道扫描。
 *   ② 原闸「Gauge 支持 140px+ 尺寸（props 控制，不是 CSS）」守的纪律没消失：
 *      图形尺寸必须由**组件 props** 决定，不许在 CSS 里写死画布。
 *      活落点是 ErrorBar（width 默认 240）与 ForestPlot（width 默认 260）。
 *   ③ CSS 侧四条断言（标题类名、换行、padding、间距、三断点）逐字保留，一条没动。 */
const chartsDir = join(dirname(dir), 'charts');
const chartFiles = readdirSync(chartsDir).filter((f) => /\.tsx$/.test(f)).sort();
const read = (f) => readFileSync(join(chartsDir, f), 'utf8');
const all = chartFiles.map((f) => read(f)).join('\n');

test('克制设计原则验证', () => {
  // 主标题用 h3 语义标签
  assert.ok(css.includes('.chart-title {'), 'ChartTitle 存在');

  // 尺寸由组件 props 控制，不是 CSS（★活落点＝ErrorBar／ForestPlot 的 width props）
  //   先钉住「确实扫到了东西」：目录被整删时下面两条会空跑却仍报绿
  assert.ok(chartFiles.length > 0, 'charts/ 枚举为空 ⇒ 尺寸 props 检查已空跑，失去意义');
  const sized = chartFiles.filter((f) => /\b(width|size)\s*=\s*\d{3}\b/.test(read(f)));
  assert.ok(sized.length > 0, '活图表组件里没有一个带 ≥100px 的尺寸 props 默认值');
  const e = read('ErrorBar.tsx');
  assert.ok(/width\s*=\s*240/.test(e), '误差须缺 240px 的尺寸 props 默认值');
  // 且该 props 真的流进画布几何 —— 声明了却不用，等于尺寸其实由别处决定
  assert.ok(/const w = width;/.test(e) && /<svg width=\{w\} height=\{h\}/.test(e),
    '误差须的 width props 没收进画布几何（尺寸仍由别处决定）');

  // 文字换行控制
  assert.ok(css.includes('word-break: break-word') || css.includes('overflow-wrap: anywhere'), '允许长词换行');

  // 统一间距规范
  assert.ok(css.includes('padding: 24px'), 'Card padding 足够大');
  assert.ok(css.includes('margin-top: 12px') || css.includes('gap: 12px'), 'Section margin 充足');
});

test('响应式断点齐备', () => {
  assert.ok(css.includes('@media (max-width: 1023px)'), '1024 断点');
  assert.ok(css.includes('@media (max-width: 767px)'), '768 断点');
  assert.ok(css.includes('@media (max-width: 374px)'), '375 断点');
});
