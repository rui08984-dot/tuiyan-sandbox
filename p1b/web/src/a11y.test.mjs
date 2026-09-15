import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const stylesDir = dirname(fileURLToPath(new URL('./styles/x', import.meta.url)));
const css = readdirSync(stylesDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(stylesDir, f), 'utf8'))
  .join('\n');

test('全局 focus 环未被移除', () => {
  assert.ok(css.includes('focus-visible'), '缺 focus-visible 规则');
});

test('尊重 prefers-reduced-motion', () => {
  assert.ok(css.includes('prefers-reduced-motion'), '缺 reduced-motion 处理');
});

test('关键断点齐备（1024 / 768 / 375）', () => {
  assert.ok(css.includes('1023px'), '缺 1024 断点');
  assert.ok(css.includes('767px'), '缺 768 断点');
  assert.ok(css.includes('374px'), '缺 375 断点');
});

test('令牌层声明四档断点', () => {
  for (const bp of ['--breakpoint-sm: 375px', '--breakpoint-md: 768px', '--breakpoint-lg: 1024px', '--breakpoint-xl: 1440px']) {
    assert.ok(css.includes(bp), '缺 ' + bp);
  }
});
