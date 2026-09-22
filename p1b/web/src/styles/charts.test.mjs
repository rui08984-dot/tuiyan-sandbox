import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(new URL('./charts.css', import.meta.url)));
const css = readFileSync(join(dir, 'charts.css'), 'utf8');
const gaugePath = join(dirname(dir), 'charts', 'Gauge.tsx');
const tsxContent = readFileSync(gaugePath, 'utf8');

test('克制设计原则验证', () => {
  // 主标题用 h3 语义标签
  assert.ok(css.includes('.chart-title {'), 'ChartTitle 存在');
  
  // Gauge 组件支持大尺寸通过 props 控制（不是 CSS）
  assert.ok(tsxContent.includes('size = 140') || tsxContent.includes('size={size}'), 'Gauge 支持 140px+ 尺寸');
  
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
