import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 样式表可达性闸（2026-09-29 立）
 *
 * ★为什么有这条：2026-09-29 修过一个真实的用户可见缺陷 ——
 *   `styles/charts.css` **只**被 `components/charts/ChartFrame.tsx:10` 引入，
 *   而 ChartFrame 唯一的使用者是 `pages/audit/OverviewPage.tsx`（8 个「死页面」之一，路由被重定向）。
 *   ⇒ Vite 的 tree-shaking 判定该样式表不可达，**整份 shake 出生产产物**。
 *   后果不是「少了几条没人用的规则」：`components/ui/index.tsx` 也用 `.chart-eyebrow`，
 *   而 components/ui 被 App.tsx 与 QuestionPage.tsx（活页）引用
 *   ⇒ 活页上的 eyebrow 小标签在生产环境**字号/字距/颜色全丢**。
 *
 * 缺陷能活下来的原因：所有前端测试都是 `readFileSync` 源码扫描，**没有一条检查产物**。
 *
 * ★这条闸锁的是「样式表能不能从入口走到」，不是「某个类有没有被用」。
 * 走不到就是走不到 —— 哪怕它自己没被任何活页引用，那也是「死样式」，
 * 该在评审里被看见，而不是安静地被摇掉。
 */

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(WEB, 'src');
const STYLES = join(SRC, 'styles');
const ENTRY = join(SRC, 'main.tsx');

const 读 = (p) => readFileSync(p, 'utf8');

/** 从一个文件里抽出它 import 的所有相对路径（.css / .ts / .tsx，含 @import） */
function 直接依赖(file) {
  const 源码 = 读(file);
  const 出 = [];
  const re = /(?:^|\n)\s*(?:import\s+(?:[^'"]*?\s+from\s+)?|@import\s+)(['"])(\.[^'"]+)\1/g;
  let m;
  while ((m = re.exec(源码)) !== null) {
    const base = resolve(dirname(file), m[2]);
    // 解析省略扩展名 / 目录 index
    for (const 候选 of [base, base + '.css', base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
      try {
        if (statSync(候选).isFile()) { 出.push(候选); break; }
      } catch { /* 继续试下一个 */ }
    }
  }
  return 出;
}

test('① 走不到入口的样式表，若其类被活组件使用 ⇒ 硬失败（生产环境会缺样式）', () => {
  // 从入口做可达性遍历（穿透 .css 与 .ts/.tsx 两类边）
  const 见到 = new Set();
  const 队列 = [ENTRY];
  while (队列.length) {
    const f = 队列.pop();
    if (见到.has(f)) continue;
    见到.add(f);
    for (const d of 直接依赖(f)) 队列.push(d);
  }

  const 全部样式表 = readdirSync(STYLES).filter((n) => n.endsWith('.css')).map((n) => join(STYLES, n));
  const 走不到 = 全部样式表.filter((f) => !见到.has(f));
  if (!走不到.length) return;

  // 活组件集合：从 App.tsx 一路 import 到的 .tsx（不含 .css）
  const 活的 = new Set([join(SRC, 'App.tsx')]);
  const q2 = [join(SRC, 'App.tsx')];
  while (q2.length) {
    const f = q2.pop();
    if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
    if (活的.has(f)) continue;
    活的.add(f);
    for (const d of 直接依赖(f)) if (d.endsWith('.ts') || d.endsWith('.tsx')) q2.push(d);
  }
  const 活源码 = [...活的].map((f) => { try { return 读(f); } catch { return ''; } }).join('\n');

  // 逐张走不到的样式表：它的类有没有出现在活组件源码里
  const 真缺陷 = [];
  const 死样式 = [];
  for (const f of 走不到) {
    // 先剥掉注释与 @import 行 —— 否则 `styles/intake.css` 这种**文件路径**里的
    // `.css` 会被当成类名（我踩过：它报「活组件在用 1 个类：css」）。
    const css = 读(f)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .filter((l) => !/^\s*@import/.test(l))
      .join('\n');
    const 类 = [...new Set((css.match(/\.[a-z][a-z0-9_-]{2,}/g) || []).map((s) => s.slice(1)))];
    const 被活用 = 类.filter((c) => 活源码.includes(c));
    if (被活用.length) 真缺陷.push(`${relative(WEB, f)} —— 活组件在用 ${被活用.length} 个类：${被活用.slice(0, 4).join(', ')}`);
    else 死样式.push(relative(WEB, f));
  }

  assert.deepEqual(真缺陷, [],
    '这些样式表走不到 main.tsx，但它们的类被**活组件**使用 ⇒ tree-shaking 会把它们摇出生产产物，' +
    '活页上就是「样式全丢」：\n  ' + 真缺陷.join('\n  ') +
    '\n★修法：挂到 main.tsx（全局入口），不要靠某个可能死掉的组件 import。' +
    '★死页面会连累生产构建 —— charts.css 在 2026-09-29 就是这么丢的。');

  // 走不到但没有活组件用它的类 = 纯死样式（多半是被测试当设计令牌 lint 目标留着的）
  // 这类**不判失败**，但要让它们显形，不能静默堆着。
  if (死样式.length) {
    console.log('  [提示] 走不到入口但当前无活组件使用的样式表（死样式，勿静默堆着）：\n    ' + 死样式.join('\n    '));
  }
});

test('② 从入口走得到的样式表，其定义的类必须出现在产物里（产物侧不变式）', () => {
  // dist 未构建时跳过（产物不入库，clone 下来第一次跑会没有）
  const distDir = join(WEB, 'dist', 'assets');
  let css;
  try {
    css = readdirSync(distDir).filter((n) => n.endsWith('.css'))
      .map((n) => readFileSync(join(distDir, n), 'utf8')).join('\n')
      .replace(/\s+/g, ' ');
  } catch {
    return;
  }

  // 活组件源码里出现的 className
  // ★不要把 App.tsx 预置进 活的 —— 下面第一行就是「已访问就 continue」，
  //   预置等于让种子文件自己的依赖永远不被遍历（我第一版就这么写的，
  //   结果 ② 抓不到 charts.css，而 ① 能抓到，因为 ① 的种子不在已访问集里）。
  const 活的 = new Set();
  const q = [join(SRC, 'App.tsx')];
  const 读 = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
  while (q.length) {
    const f = q.pop();
    if (!/\.tsx?$/.test(f) || 活的.has(f)) continue;
    活的.add(f);
    for (const d of 直接依赖(f)) if (/\.tsx?$/.test(d)) q.push(d);
  }
  const 源码 = [...活的].map(读).join('\n');

  const 用的类 = new Set();
  for (const m of 源码.matchAll(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    for (const grp of [m[1], m[2], m[3]]) {
      if (!grp) continue;
      for (const c of grp.split(/[\s${}]+/)) {
        const t = c.trim();
        if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(t)) 用的类.add(t);
      }
    }
  }

  // ★判据收窄到唯一精确的不变式：
  //   **「从 main.tsx 走得到的样式表」里定义的类，必须出现在产物里。**
  //   —— 这才是 tree-shaking 失败模式的准确形状（源有定义、那张表也走得到、产物却没有）。
  //   ★不要去查「活组件 className 里的类」：组件可能用 JS 钩子类、或样式写在别处
  //   （第 ② 版就这么写，结果把 26 个 hb-* / is-wide 之类误报成缺失）。宁可漏报不误报。
  const 走得到的 = new Set();
  const q2 = [ENTRY];
  while (q2.length) {
    const f = q2.pop();
    if (走得到的.has(f)) continue;
    走得到的.add(f);
    for (const d of 直接依赖(f)) q2.push(d);
  }

  const 该出现 = new Set();
  for (const n of readdirSync(STYLES)) {
    const p = join(STYLES, n);
    if (!n.endsWith('.css') || !走得到的.has(p)) continue;   // 走不到的表本就不该出现在产物里
    const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of src.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) 该出现.add(m[1]);
  }

  const 缺 = [...该出现].filter((c) => !css.includes('.' + c));
  assert.deepEqual(缺, [],
    '这些类定义在**从 main.tsx 走得到**的样式表里，活页也在用，但产物 CSS 里查不到：\n  ' +
    缺.join('\n  ') + '\n★走得到的表却没进产物 ⇒ 有东西把可达性判错了。');
});
