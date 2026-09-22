import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * 动效层纪律闸（2026-09-22 三轮「运行中的仪器」）
 *
 * 这套动效守四条既有红线，本文件把其中易回归的几条钉住：
 *   ① 禁装饰性发光（三处既有闸已覆盖，这里再确认动效层自己没引入）
 *   ② 必须真的支持 prefers-reduced-motion（且强制到终态，不是只缩时长）
 *   ③ Canvas 背景必须有显式宽高（缺了会取 canvas 固有 300×150，粒子挤在左上角）
 *   ④ 关键帧只碰 transform/opacity/filter（不碰 width/height/top/left ⇒ 不触发重排）
 */
const dir = dirname(fileURLToPath(new URL('./motion.css', import.meta.url)));   // …/src/styles
const css = readFileSync(join(dir, 'motion.css'), 'utf8');
const fieldTsx = readFileSync(join(dir, '..', 'components', 'CanvasField.tsx'), 'utf8');

test('动效层不引入装饰性发光（守既有红线）', () => {
  assert.equal(/box-shadow:\s*0\s+0\s+\d+px/.test(css), false, 'motion.css 出现 0 0 Npx 发光');
  assert.equal(/text-shadow:/.test(css), false, 'motion.css 出现文字阴影（投影字须用实色副本）');
});

test('prefers-reduced-motion 强制终态（不是只缩短时长）', () => {
  const i = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(i > 0, '缺 prefers-reduced-motion 块');
  const block = css.slice(i);
  assert.ok(/animation:\s*none\s*!important/.test(block), 'reduce 下未关掉动画');
  assert.ok(/opacity:\s*1\s*!important/.test(block), 'reduce 下未锁可见性（入场动画初始态是 opacity:0）');
  assert.ok(/transform:\s*none\s*!important/.test(block), 'reduce 下未清位移');
});

test('Canvas 背景有显式宽高（否则取 300×150 固有尺寸）', () => {
  const i = css.indexOf('.field-bg {');
  const block = css.slice(i, css.indexOf('}', i));
  assert.ok(/width:\s*100%/.test(block), '.field-bg 缺 width: 100%（canvas 会退化为默认 300×150）');
  assert.ok(/height:\s*100%/.test(block), '.field-bg 缺 height: 100%');
});

test('CanvasField 在 reduced-motion 下完全不启动 rAF（不只是变快）', () => {
  assert.ok(fieldTsx.includes('prefers-reduced-motion'), '组件未检测系统偏好');
  // 去掉注释再定位：注释里也会出现 requestAnimationFrame 字样，直接 indexOf 会误判
  const code = fieldTsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const mqIdx = code.indexOf('mq.matches');
  // 首个**真实调用**（注释已剥离）
  const rafIdx = code.search(/requestAnimationFrame\(/);
  assert.ok(mqIdx > 0, '未检测 mq.matches');
  assert.ok(rafIdx > 0, '未找到 rAF 调用');
  assert.ok(mqIdx < rafIdx, '未在启动 rAF 前短路（reduced-motion 下仍会跑动画）');
});

test('CanvasField 有低功耗措施（标签页隐藏停帧 + DPR 上限）', () => {
  assert.ok(fieldTsx.includes('visibilitychange'), '缺标签页隐藏停帧');
  assert.ok(/Math\.min\(2,\s*window\.devicePixelRatio/.test(fieldTsx), '缺 DPR 上限（4K 屏会烧 GPU）');
});

test('关键帧不碰布局属性（只动 transform/opacity/filter）', () => {
  // 精确切出每个 @keyframes 的块：从 @keyframes 起到**配对的**大括号结束。
  // （早先版本按 lastIndexOf('}') 切，会把后续普通规则吞进来，导致误报）
  const offenders = [];
  const re = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const name = m[1];
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(re.lastIndex, i - 1);
    const bad = body.match(/\b(width|height|top|left|right|bottom|margin|padding)\s*:/g);
    if (bad) offenders.push(name + ' → ' + [...new Set(bad)].join(', '));
  }
  assert.deepEqual(offenders, [], '关键帧动了布局属性（会触发重排）：\n' + offenders.join('\n'));
});
