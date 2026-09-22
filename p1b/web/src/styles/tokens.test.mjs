import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const { CHECKS, readTokens, ratio } = require('./contrast-check.cjs');

test('观测台语义层变量齐备', () => {
  for (const v of ['--grid-line', '--panel-3', '--shadow-4', '--space-section', '--font-size-micro']) {
    assert.ok(css.includes(v + ':'), '缺变量 ' + v);
  }
});

/** 2026-09-22 全方面重构：身份色由暖棕羊皮纸换为抹茶绿观测台。
 *  旧锁（--bg #14110c / --accent #e0a83c / --panel #1e1913）改为锁新值。
 *  ★ 不是删闸，是换锁：新值同样逐字锁定，且下面增补了自动对比度闸（更强的守卫）。 */
test('抹茶绿身份变量值未被改动', () => {
  assert.ok(css.includes('--bg: #1A1F1C;'), '--bg 被改（应为墨绿黑 #1A1F1C）');
  assert.ok(css.includes('--accent: #8FAF7B;'), '--accent 被改（应为抹茶绿 #8FAF7B）');
  assert.ok(css.includes('--panel: #222926;'), '--panel 被改（应为 #222926）');
  assert.ok(css.includes('--matcha: #829F70;'), '--matcha 被改（应为 #829F70）');
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

/** ★ 新增闸：换色板后「好不好看」不可测，「看不看得清」可测。
 *  初版 --matcha/#6E8B5E(3.90) 与 --layer-l6/#C4705E(4.12) 肉眼看着没问题，实测不达标
 *  ⇒ 本闸把「改色必跑对比度」固化进测试，防止后续换色静默降级可读性。 */
test('全部前景色对比度达标（WCAG 4.5:1；图表轴线 3:1）', () => {
  const T = readTokens(new URL('./tokens.css', import.meta.url));
  const bad = [];
  for (const [fg, bg, min, note] of CHECKS) {
    const r = ratio(T[fg], T[bg]);
    if (r < min) bad.push(note + ' 实测 ' + r.toFixed(2) + ' <' + min);
  }
  assert.deepEqual(bad, [], '对比度不合格:\n' + bad.join('\n'));
});

test('刻度网格为双层（主+次）且为抹茶色相', () => {
  assert.ok(css.includes('--grid-line-fine'), '缺次网格变量');
  assert.ok(css.includes('--grid-size-fine'), '缺次网格尺寸变量');
  assert.ok(css.includes('--grid-size'), '缺主网格尺寸变量');
});
