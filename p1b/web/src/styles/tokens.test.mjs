import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

test('观测台语义层变量齐备', () => {
  for (const v of ['--grid-line', '--panel-3', '--shadow-4', '--space-section', '--font-size-micro']) {
    assert.ok(css.includes(v + ':'), '缺变量 ' + v);
  }
});

test('既有身份变量值未被改动', () => {
  assert.ok(css.includes('--bg: #14110c;'), '--bg 被改');
  assert.ok(css.includes('--accent: #e0a83c;'), '--accent 被改');
  assert.ok(css.includes('--panel: #1e1913;'), '--panel 被改');
});

test('L1-L6 层色六色全在', () => {
  for (const v of ['--layer-l1', '--layer-l2', '--layer-l3', '--layer-l4', '--layer-l5', '--layer-l6']) {
    assert.ok(css.includes(v + ':'), '缺 ' + v);
  }
});

test('观测台底纹类已注册且尊重 reduced-motion', () => {
  assert.ok(css.includes('.app-surface'), '缺 .app-surface');
  assert.ok(css.includes('prefers-reduced-motion'), '缺 reduced-motion');
});
