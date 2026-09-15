import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const tsx = readFileSync(new URL('./TermDrawer.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/ui.css', import.meta.url), 'utf8');

test('TermDrawer 契约齐备', () => {
  assert.ok(tsx.includes('export function TermDrawer'), '缺导出');
  assert.ok(tsx.includes('TERMS'), '未消费术语表全量');
  assert.ok(tsx.includes('role="dialog"'), '缺 dialog 语义');
  assert.ok(tsx.includes('onKeyDown') && tsx.includes('Escape'), '缺 Esc 关闭');
});

test('TermDrawer 可搜（术语/人话/口径三字段）', () => {
  assert.ok(tsx.includes('t.term + t.plain + t.definition + t.basis'), '搜索未覆盖全字段');
});

test('抽屉样式已注册且触控达标', () => {
  assert.ok(css.includes('.ui-drawer'), '缺 .ui-drawer 样式');
  assert.ok(css.includes('.ui-drawer-backdrop'), '缺遮罩样式');
  const closeBlock = css.slice(css.indexOf('.ui-drawer-close {'));
  const closeRule = closeBlock.slice(0, closeBlock.indexOf('}'));
  assert.ok(/min-width:\s*44px/.test(closeRule), '关闭按钮未达 44px 触控');
  assert.ok(/min-height:\s*44px/.test(closeRule), '关闭按钮未达 44px 触控');
});
