import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const tsx = readFileSync(new URL('./Term.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/ui.css', import.meta.url), 'utf8');

test('Term 组件契约齐备', () => {
  assert.ok(tsx.includes('export function Term'), '缺 export function Term');
  assert.ok(tsx.includes('aria-expanded'), '缺 aria-expanded（可访问性）');
  assert.ok(tsx.includes('aria-describedby'), '缺 aria-describedby');
  assert.ok(tsx.includes('onKeyDown'), '缺键盘可达');
  assert.ok(tsx.includes('getTerm'), '未接术语表真源');
});

test('Term 支持 hover/点击/键盘三条触发路径', () => {
  assert.ok(tsx.includes('onMouseEnter'), '缺 hover 触发');
  assert.ok(tsx.includes('onClick'), '缺点击触发（触屏）');
  assert.ok(tsx.includes('onFocus'), '缺键盘 focus 触发');
});

test('Term 样式已注册且无装饰性发光', () => {
  assert.ok(css.includes('.ui-term'), '缺 .ui-term 样式');
  assert.ok(css.includes('.ui-term-pop'), '缺浮层样式');
  const popBlock = css.slice(css.indexOf('.ui-term-pop {'));
  const popRule = popBlock.slice(0, popBlock.indexOf('}'));
  assert.ok(!/box-shadow:\s*0\s+0\s+\d+px/.test(popRule), '禁装饰性发光（0 0 Npx 扩散阴影）');
});
