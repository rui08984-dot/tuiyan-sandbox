import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * 顶栏防溢出闸（2026-09-22 视觉验收发现 → 固化）
 *
 * 背景：顶栏 11 项导航在 360px 视口把整页撑到 468px，页面出现横向滚动。
 * 根因是 `.appbar-inner` 的 flex 规则只写在 `@media (min-width: 900px)` 里——
 * 窄屏下它是无样式块级元素，宽度完全由内容决定，于是溢出父容器。
 *
 * 本闸钉住两条不变量（改导航项数或断点都可能复发）：
 *   ① `.appbar-inner` 在任何断点都必须可收缩（有 min-width: 0，且不在媒体查询内才定义的宽度）
 *   ② `.appbar-nav` 必须自带横向滚动兜底（overflow-x: auto），窄屏下才不靠压缩触控面积硬挤
 */
const here = dirname(fileURLToPath(new URL('./p1b6.css', import.meta.url)));
const css = readFileSync(join(here, 'p1b6.css'), 'utf8');

/** 取某个选择器的第一条顶层规则体（不进入 @media） */
function baseRuleBody(src, selector) {
  const re = new RegExp('(^|\\n)' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = src.match(re);
  return m ? m[2] : null;
}

test('顶栏内层在所有断点可收缩（min-width:0 在断点外定义）', () => {
  const body = baseRuleBody(css, '.appbar-inner');
  assert.ok(body !== null, '.appbar-inner 缺基础规则（曾只在 ≥900px 内定义，窄屏溢出）');
  assert.ok(/min-width:\s*0/.test(body), '.appbar-inner 缺 min-width: 0（会被内容撑宽）');
  assert.ok(/flex:\s*1 1 auto|width:\s*100%/.test(body), '.appbar-inner 缺可伸缩宽度声明');
});

test('顶栏导航自带横向滚动兜底（保住 44px 触控目标）', () => {
  const body = baseRuleBody(css, '.appbar-nav');
  assert.ok(body !== null, '.appbar-nav 缺基础规则');
  assert.ok(/overflow-x:\s*auto/.test(body), '.appbar-nav 缺 overflow-x: auto（窄屏会撑破整页）');
  assert.ok(/min-width:\s*0/.test(body), '.appbar-nav 缺 min-width: 0（flex 子项不会收缩到内容以下）');
});

test('顶栏容器不锁死宽度（100vw 含滚动条宽，会反向引入溢出）', () => {
  const body = baseRuleBody(css, '.appbar');
  assert.ok(body !== null, '.appbar 缺基础规则');
  assert.equal(/max-width:\s*100vw/.test(body), false, '.appbar 用了 100vw（桌面端含滚动条宽 ⇒ 反向溢出）');
});
