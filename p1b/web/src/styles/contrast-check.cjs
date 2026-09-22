'use strict';
/**
 * 抹茶绿观测台 · 对比度核验（2026-09-22 全方面重构新增）
 *
 * 为什么要有这个脚本：换色板最大的风险不是"好不好看"，是"看不看得清"。
 * 初版 --matcha #6E8B5E(3.90) 与 --layer-l6 #C4705E(4.12) 肉眼看着"挺好"，
 * 实测 vs --panel 均 <4.5:1 ⇒ 不合格。改色必须跑本脚本，不凭肉眼。
 *
 * 用法：node p1b/web/src/styles/contrast-check.cjs   （退出码 0=全过，1=有不合格）
 * 亦可被测试 require（导出 ratio/lum/PALETTE/CHECKS）。
 */
const fs = require('fs');
const path = require('path');

/** WCAG 相对亮度 */
function lum(hex) {
  const c = String(hex).replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 对比度 */
function ratio(a, b) {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 从 tokens.css 实际解析变量值——保证测的是真实文件，不是抄一份常量 */
function readTokens(file) {
  const css = fs.readFileSync(file, 'utf8');
  const out = {};
  const re = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  let m;
  while ((m = re.exec(css)) !== null) out[m[1]] = m[2];
  return out;
}

/** 待核验清单：[变量名, 底色变量名, 最低比值, 说明] */
const CHECKS = [
  ['text', 'bg', 4.5, '主文字 vs 背景'],
  ['text', 'panel', 4.5, '主文字 vs 面板'],
  ['muted', 'bg', 4.5, '次要文字 vs 背景'],
  ['muted', 'panel', 4.5, '次要文字 vs 面板'],
  ['accent', 'bg', 4.5, '强调色 vs 背景'],
  ['accent', 'panel', 4.5, '强调色 vs 面板'],
  ['matcha', 'bg', 4.5, '次强调 vs 背景'],
  ['matcha', 'panel', 4.5, '次强调 vs 面板'],
  ['ok', 'panel', 4.5, '语义-正常 vs 面板'],
  ['warn', 'panel', 4.5, '语义-警示 vs 面板'],
  ['danger', 'panel', 4.5, '语义-危险 vs 面板'],
  ['info', 'panel', 4.5, '语义-信息 vs 面板'],
  ['layer-l1', 'panel', 4.5, 'L1 层色 vs 面板'],
  ['layer-l2', 'panel', 4.5, 'L2 层色 vs 面板'],
  ['layer-l3', 'panel', 4.5, 'L3 层色 vs 面板'],
  ['layer-l4', 'panel', 4.5, 'L4 层色 vs 面板'],
  ['layer-l5', 'panel', 4.5, 'L5 层色 vs 面板'],
  ['layer-l6', 'panel', 4.5, 'L6 层色 vs 面板'],
  ['chart-axis', 'bg', 3.0, '图表轴线 vs 背景（数据线门槛 3:1）'],
];

function main() {
  const file = path.join(__dirname, 'tokens.css');
  const T = readTokens(file);
  const missing = CHECKS.flatMap(([fg, bg]) => (T[fg] && T[bg] ? [] : [fg + '/' + bg]));
  if (missing.length) {
    console.error('tokens.css 缺变量: ' + missing.join(', '));
    process.exit(1);
  }
  let bad = 0;
  for (const [fg, bg, min, note] of CHECKS) {
    const r = ratio(T[fg], T[bg]);
    const ok = r >= min;
    if (!ok) bad++;
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + r.toFixed(2).padStart(6) + '  ≥' + min + '  ' + note + '  (' + fg + ' ' + T[fg] + ' vs ' + bg + ' ' + T[bg] + ')');
  }
  console.log('\n合计 ' + CHECKS.length + ' 项，不合格 ' + bad + ' 项');
  process.exit(bad ? 1 : 0);
}

module.exports = { lum, ratio, readTokens, CHECKS };

if (require.main === module) main();
