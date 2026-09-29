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

test('② 产物里存在「活组件在用」的类（抽样：chart-eyebrow）', () => {
  // 只在有 dist 时查（构建产物不入库，clone 下来第一次跑会没有）
  const distDir = join(WEB, 'dist', 'assets');
  let css;
  try {
    css = readdirSync(distDir).filter((n) => n.endsWith('.css'))
      .map((n) => readFileSync(join(distDir, n), 'utf8')).join('\n');
  } catch {
    return; // 未构建 ⇒ 跳过，不算失败
  }
  assert.ok(!css || !/sourceMappingURL/.test(css), '产物不该带 source map 引用（会暴露源码路径）');
  for (const cls of ['chart-eyebrow', 'chart-legend', 'chart-swatch']) {
    assert.ok(css.includes('.' + cls),
      `产物 CSS 里没有 .${cls} —— 该类被 components/ui 使用，而 components/ui 被 App.tsx 与 ` +
      `QuestionPage.tsx（活页）引用。★这正是 2026-09-29 修掉的那个 tree-shaking 缺陷的回归锁。`);
  }
});
