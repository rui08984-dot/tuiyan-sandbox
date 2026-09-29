/**
 * css-loss-audit.mjs —— 源样式表里有的选择器，产物里有没有（2026-09-29）
 *
 * ★为什么要有它：`vite build` 每次都打一条 CSS minify 警告，位置落在
 *   `--eyebrow-size` 声明附近。根因至今未定位（单独压每个 .css 都 CLEAN、
 *   按 main.tsx 顺序拼全部 18 个再压也 CLEAN，只有 Vite 自己的管线会报）。
 *
 *   但「为什么报」不如「报的时候有没有丢东西」要紧 ——
 *   2026-09-29 已经因为同一类问题（死页面 tree-shaking）丢过整份 charts.css。
 *   本脚本直接对答案：**把源里的选择器逐个拿去产物里查，列出丢失的。**
 *
 * 只读，不写任何项目文件。
 * 用法：cd p1b/web/src && node css-loss-audit.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const STYLES = join(SRC, 'styles');
const DIST = join(SRC, '..', 'dist', 'assets');

let 产物;
try {
  产物 = readdirSync(DIST).filter((n) => n.endsWith('.css')).map((n) => readFileSync(join(DIST, n), 'utf8')).join('\n');
} catch {
  console.log('未找到 dist 产物 —— 先跑一次 vite build');
  process.exit(0);
}
// 产物里 minify 会把 `.a .b` 压成 `.a .b`（保留空格），但会去掉换行/多余空格。
// 归一化：只保留「选择器里用到的名字」，避免格式差异造成假阳性。
const 归一 = (s) => s.replace(/\s+/g, ' ');

const 选择器集 = (css) => {
  const 剥注释 = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const 出 = new Set();
  // 取每个 { 之前的最后一段作为选择器
  for (const m of 剥注释.matchAll(/([^{}]+)\{/g)) {
    for (const sel of m[1].split(',')) {
      const t = sel.trim();
      if (!t || t.startsWith('@') || t.startsWith(':root')) continue;
      // 只取类选择器（这个项目样式以类为主）
      for (const c of t.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) 出.add(c[1]);
    }
  }
  return 出;
};

const 源选择器 = new Map(); // 类 → 定义它的文件
for (const n of readdirSync(STYLES)) {
  if (!n.endsWith('.css')) continue;
  const css = readFileSync(join(STYLES, n), 'utf8');
  for (const c of 选择器集(css)) if (!源选择器.has(c)) 源选择器.set(c, n);
}

const 产物文本 = 归一(产物);
const 丢的 = [...源选择器].filter(([c]) => !产物文本.includes('.' + c));

console.log('源样式表里的类选择器：' + 源选择器.size + ' 个');
console.log('产物 CSS 里查不到的：' + 丢的.length + ' 个\n');
const 按文件 = new Map();
for (const [c, f] of 丢的) {
  if (!按文件.has(f)) 按文件.set(f, []);
  按文件.get(f).push(c);
}
for (const [f, cs] of [...按文件].sort((a, b) => b[1].length - a[1].length)) {
  console.log('  ' + f + ' —— ' + cs.length + ' 个: ' + cs.slice(0, 12).join(', ') + (cs.length > 12 ? ' …' : ''));
}
if (!丢的.length) console.log('  （零丢失）');

console.log('\n判读：');
console.log('  · 丢的类若**被活组件用** ⇒ 真实生产缺陷（styles-reachability.test.mjs ① 会硬失败）。');
console.log('  · 丢的类若只被死页面用 ⇒ 死重量被正确摇掉，活页无感。');
