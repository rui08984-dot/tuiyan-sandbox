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
