/**
 * dead-page-reachability.audit.mjs —— 死页面连累生产构建的审计（2026-09-29）
 *
 * ★起因：2026-09-29 修过一个真实的用户可见缺陷 ——
 *   `styles/charts.css` 只被 components/charts/ChartFrame.tsx 引入，而 ChartFrame 唯一的
 *   使用者是 pages/audit/OverviewPage.tsx（8 个「死页面」之一，路由被 <Navigate> 重定向）
 *   ⇒ Vite tree-shaking 判定不可达，整份样式表被摇出生产产物
 *   ⇒ 活页上的 eyebrow 小标签在生产环境字号/字距/颜色全丢。
 *
 * ★本脚本把那一例变成一次**普查**：列出所有「只经死页面可达」的模块 ——
 *   它们全都是同一类的潜在生产缺陷（tree-shaking 摇掉、产物里查不到）。
 *
 * 只读，不写任何文件。
 * 用法：cd p1b/web/src && node dead-page-reachability.audit.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

const 解析 = (base) => {
  for (const c of [base, base + '.ts', base + '.tsx', base + '.css', join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try { if (statSync(c).isFile()) return c; } catch { /* 下一个 */ }
  }
  return null;
};

const 依赖 = (f) => {
  const s = readFileSync(f, 'utf8');
  const out = [];
  // ★必须同时匹配 `import … from` / `@import` / **`export … from`**（再导出）。
  //   漏了 export 会让 barrel 文件（components/ui/index.ts）的下游全部误判成「走不到」——
  //   我第一版就栽在这：lib/format.ts 被报成不可达，而它明明被活页用。
  const re = /(?:^|\n)\s*(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+(?:[^'"]*?\s+from\s+)?|@import\s+)(['"])(\.[^'"]+)\1/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const r = 解析(resolve(dirname(f), m[2]));
    if (r) out.push(r);
  }
  return out;
};

const app = join(SRC, 'App.tsx');
const appSrc = readFileSync(app, 'utf8');

// 路由行：element 是 <Navigate …> ⇒ 该路径只做重定向，组件根本不渲染 ⇒ 死路径
const 死路径 = [];
const 活组件 = new Set();
for (const line of appSrc.split('\n')) {
  const pm = line.match(/<Route\s+path="([^"]+)"\s+element=\{<(\w+)/);
  if (!pm) continue;
  if (line.includes('<Navigate')) 死路径.push(pm[1]);
  else 活组件.add(pm[2]);
}

// 活组件名 → 它的源文件
const 活页文件 = new Set();
for (const d of 依赖(app)) {
  const stem = d.replace(/\\/g, '/').split('/').pop().replace(/\.tsx?$/, '');
  if (活组件.has(stem)) 活页文件.add(d);
}

// 从入口 + 所有活页做可达性遍历
const 见到 = new Set();
const 队列 = [join(SRC, 'main.tsx'), ...活页文件];
while (队列.length) {
  const f = 队列.pop();
  if (见到.has(f)) continue;
  见到.add(f);
  for (const d of 依赖(f)) 队列.push(d);
}

const 全部 = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const st = statSync(p);
    if (st.isDirectory()) { if (!/node_modules|dist/.test(n)) walk(p); }
    else if (/\.(tsx?|css)$/.test(n)) 全部.push(p);
  }
})(SRC);

const 走不到 = 全部.filter((f) => !见到.has(f));

console.log('死路径（element 是 <Navigate>，组件不渲染）:');
console.log('  ' + 死路径.join('  '));
console.log('\n活页组件（本次遍历的根）:');
console.log('  ' + [...活组件].join('  '));
console.log('\n★从「入口 + 活页」走不到的模块：' + 走不到.length + ' 个');
for (const f of 走不到) console.log('  ' + relative(SRC, f));
console.log('\n判读：');
console.log('  · 若某文件的类/导出被**活组件**用到 ⇒ 生产构建会缺它（真实缺陷，');
console.log('    styles-reachability.test.mjs ① 已在跑的时候硬失败）。');
console.log('  · 若只是死页面自己用 ⇒ 是死重量，会随死页面一起被摇掉，');
console.log('    不影响活页，但会静默堆着。');
