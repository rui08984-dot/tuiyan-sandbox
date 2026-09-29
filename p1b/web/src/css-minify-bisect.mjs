/**
 * css-minify-bisect.mjs —— 定位 Vite 构建里那条 CSS minify 警告的确切来源（2026-09-29）
 *
 * 症状：每次 `vite build` 都打两条
 *   [WARNING] Expected identifier but found whitespace [css-syntax-error]
 *       <stdin>:3560  --eyebrow-size: 10px;
 *   [WARNING] Unexpected "10px" [css-syntax-error]
 * 定位难点：单独压缩每个 .css 都 CLEAN；朴素 `cat *.css` 拼接也 CLEAN。
 *   ⇒ 说明它只在 Vite 自己的拼接/压缩管线上出现。
 *
 * 本脚本：按 **main.tsx 的 import 顺序**做累积拼接 + 二分，找出第一个引入警告的文件。
 * 只读，不写任何项目文件。
 *
 * 用法：cd p1b/web/src && node css-minify-bisect.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const SRC = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require(resolve(SRC, '..', 'node_modules', 'esbuild'));

// main.tsx 的 import 顺序就是 Vite 的拼接顺序
const mainSrc = readFileSync(join(SRC, 'main.tsx'), 'utf8');
const 序 = [];
const re = /import\s+['"]\.\/styles\/([^'"]+\.css)['"]/g;
let m;
while ((m = re.exec(mainSrc)) !== null) 序.push(m[1]);
for (const n of readdirSync(join(SRC, 'styles'))) {
  if (n.endsWith('.css') && !序.includes(n)) 序.push(n);
}

const 报 = (css) => {
  try {
    esbuild.transformSync(css, { loader: 'css', minify: true });
    return null;
  } catch (e) {
    const x = (e.errors || [])[0];
    return x ? x.location.line + ': ' + x.text : 'err';
  }
};

console.log('按拼接顺序累积：');
let acc = '';
let 首个 = null;
for (const n of 序) {
  acc += '\n' + readFileSync(join(SRC, 'styles', n), 'utf8');
  const r = 报(acc);
  if (r && !首个) { 首个 = { n, r }; console.log('  ✖ 引入警告的是：' + n + '  → ' + r); break; }
  console.log('  ✓ ' + n);
}
if (!首个) console.log('\n按 main.tsx 顺序累积到全部文件也没警告 ⇒ 触发条件不在拼接顺序上。');
else {
  console.log('\n二分 ' + 首个.n + ' 内部，找出最小触发片段：');
  const lines = readFileSync(join(SRC, 'styles', 首个.n), 'utf8').split('\n');
  // 先看单独压它
  console.log('  单独压 ' + 首个.n + ' → ' + (报(readFileSync(join(SRC, 'styles', 首个.n), 'utf8')) || 'CLEAN'));
  // 逐行加，找第一行使其变红
  let cum = '';
  for (let i = 0; i < lines.length; i++) {
    cum += lines[i] + '\n';
    if (报(cum)) {
      console.log('  ★ 第 ' + (i + 1) + ' 行开始报错：' + JSON.stringify(lines[i]));
      console.log('    上下文：');
      for (let k = Math.max(0, i - 3); k <= Math.min(lines.length - 1, i + 2); k++) {
        console.log('      ' + (k + 1) + ' | ' + lines[k]);
      }
      break;
    }
  }
}
