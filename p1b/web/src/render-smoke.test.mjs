/* 渲染冒烟闸（2026-09-27 八轮第三改 · 因一次真实回归而加）
 *
 * 病象：删除 MiniGauge 时把同区块的 `import { DeviationBar }` 一并删掉，
 *   TypeScript 与 `node --test` 全绿（源码断言测不出「引用了未导入的标识符」），
 *   **页面运行时白屏报 "DeviationBar is not defined"**——由浏览器截图才发现。
 *   ⇒ 缺的正是这一类闸：**被引用但未定义/未导入** 的符号。
 *
 * 本闸做静态解析级检查（不真跑 React）：
 *   ① 本目录每个 .tsx 里，JSX 使用的组件名必须在同文件 import 或本地定义；
 *   ② 全 src 每条**相对** import：模块文件必须存在，且被具名 import 的名字必须真的被它导出。
 * 覆盖不到运行时逻辑，但正好能挡住"删代码连带删 import"这一类。
 *
 * ★2026-09-30 改口径（死页源码已删净这一新事实）：
 *   ② 原锚在 `charts/index.ts` 这个 barrel 上——它只被 8 个死页引用，死页删净后它自己
 *   就成了纯死代码并随之删除。按老口径继续读它＝每次必红 ENOENT：一条永远红的死断言
 *   等于没有闸，还会把别的真红淹没在噪声里。
 *   ★**要挡的那类病没变**（引用了不存在的东西），只是锚点从「某一个 barrel 的 11 条」
 *   换成「活源码的整张 import 图」：覆盖面严格变大，且新增原 ② 没有的一类——
 *   **模块文件被删、import 却留着**（现在连仍活着的 components/ui/index.tsx 也一起管）。
 *   ① 不需要改口径：它 walk 全 src 的 .tsx，死页只是让文件数变少，判定逻辑不依赖它们存在。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(root);

function walk(dir, out = [], re = /\.tsx$/) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out, re);
    else if (re.test(f)) out.push(p);
  }
  return out;
}

const files = walk(srcRoot);
const code = new Map(files.map((p) => [p, readFileSync(p, 'utf8')]));
// ② 的遍历面：.ts + .tsx（.d.ts 只有 /// 引用指令，不参与）
const srcFiles = walk(srcRoot, [], /\.(ts|tsx)$/).filter((p) => !/\.d\.ts$/.test(p));

test('① 每个 .tsx 的 JSX 组件名都已导入或本地定义', () => {
  const bad = [];
  for (const [p, text] of code) {
    // 本地定义/导出的组件：function X / const X = / export function X / export const X
    const local = new Set();
    for (const m of text.matchAll(/(?:export\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/g)) local.add(m[1]);
    // ★本地 interface / type 定义（Draft、RepJson…）：它们只作为**泛型参数**出现
    //   （useState<Draft>），不是 JSX 组件，但正则会把 <Draft> 当组件看待。
    for (const m of text.matchAll(/(?:interface|type)\s+([A-Z][A-Za-z0-9_]*)/g)) local.add(m[1]);
    // ★import 的名字（默认值）
    for (const m of text.matchAll(/import\s+(?:type\s+)?([A-Za-z0-9_]+)\s*(?:,|from)/g)) local.add(m[1]);
    // ★花括号导入：**必须排除 `import type {...}`** —— 纯类型名（BotcScript/AuditSummary
    //   这类接口名）编译后不存在于运行时，也永远不会出现在 JSX 里当组件用；
    //   误算作"已导入"会让真缺失漏网，也会让本闸误报。
    for (const m of text.matchAll(/import\s+(?!type\s)\{([^}]+)\}\s*from/g)) {
      for (const part of m[1].split(',')) {
        const nm = part.trim().split(/\s+as\s+/).pop().trim();
        if (nm) local.add(nm);
      }
    }
    // ★同时记下「哪些是纯类型」——它们在 JSX 里出现即为误用，从待查集合剔除
    const typeOnly = new Set();
    for (const m of text.matchAll(/import\s+type\s+\{([^}]+)\}\s*from/g)) {
      for (const part of m[1].split(',')) {
        const nm = part.trim().split(/\s+as\s+/).pop().trim();
        if (nm) typeOnly.add(nm);
      }
    }
    // JSX 里用到的 <Capitalized …>
    // ★排除 TS 泛型与类型断言：<HTMLCanvasElement>、<AnyPredicate>、<SomeProps> 都不是组件
    const used = new Set();
    for (const m of text.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) {
      const nm = m[1];
      if (/^(HTML|SVG|MathML|Record|Partial|Readonly)/.test(nm)) continue;
      if (/(Element|Event|Node|Predicate|IntrinsicAttributes|Props|State|Ref|Params|Config|Options|Keys|Type)$/.test(nm)) continue;
      if (nm.length <= 2) continue;   // 泛型参数 <T> <K>
      used.add(nm);
    }
    for (const u of used) {
      if (typeOnly.has(u)) continue;
      if (!local.has(u)) bad.push(p.replace(srcRoot, '.') + ' → <' + u + '> 未导入也未定义');
    }
  }
  assert.deepEqual(bad, [], 'JSX 引用了未导入/未定义的组件：\n' + bad.join('\n'));
});

/* ── ② 的解析工具（2026-09-30 随口径改写一并落盘）───────────────────────── */

// 注释会骗人：App.tsx 注释里就写着「五页（Overview/Audit/Intake/Calendar/Compiler）
//   的 **import 已删**」，不剥注释就会把这段散文当 import 语句扫进来。
//   ★`//` 只在后面不含引号时才当注释切，避免把 'https://…' 里的双斜杠误伤。
function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`\\])\/\/[^\n'"]*/g, '$1');
}

// 带 from 的子句（import 与 export … from 都算：re-export 同样会白屏）。
//   ★子句必须**行内闭合**：花括号块（可跨行）单走一支，其余（`import Foo from`、
//   `export const X = …`）用不含 \n 的惰性匹配。早先版本用 `[\s\S]*?` 一把抓，
//   会从 `export const IconChart = ({ size, value … })` 一路惰性吞到 40 行后
//   `export { Term } from './Term'` 的 from 上，把 IconChart 的**形参**当成了 import 名单。
const CLAUSE_RE = /(?:^|\n)[ \t]*(?:import|export)\s+(?:type\s+)?(?:(\{[^}]*\})|([^\n]*?))\s*from\s*['"]([^'"]+)['"]/g;
// 纯副作用 import：import './styles/charts.css'
const SIDE_RE = /(?:^|\n)[ \t]*import\s*['"]([^'"]+)['"]/g;

// specifier 不带扩展名（'./ErrorBar'），盘上是 ErrorBar.tsx —— 按 Vite 的解析口径试一遍
const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.css', '.json',
  '/index.ts', '/index.tsx', '/index.js'];

function resolveModule(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const e of RESOLVE_EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

// 一个模块对外真正导出的名字（原始名，即 `as` 左侧）
function exportedNames(src) {
  const names = new Set();
  if (/(?:^|\n)\s*export\s+default\b/.test(src)) names.add('default');
  // export [type] { a, b as c } —— 本地列表与 re-export 列表都算导出
  for (const m of src.matchAll(/(?:^|\n)\s*export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const nm = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (nm) names.add(nm);
    }
  }
  // export [declare] [abstract] [async] function|const|let|var|class|interface|type|enum NAME
  //   ★interface/type 必须收：import { BiasStrip, type BiasPoint } 里的 BiasPoint
  //   是 `export interface`，只认 function/const/class 会把它误判成"未导出"。
  for (const m of src.matchAll(
    /(?:^|\n)\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    names.add(m[1]);
  }
  return names;
}

// 从 import 子句里取出「要向目标模块索取的原始名」
function requestedNames(clause) {
  const out = [];
  for (const m of clause.matchAll(/\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      // 句内 type 标记：{ BiasStrip, type BiasPoint }
      const nm = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(nm)) out.push(nm);
    }
  }
  // 默认导入：import Foo from / import type Foo from
  //   ★namespace（`* as api`）落在 else，只校验文件存在、不校验名字。
  const head = clause.replace(/\{[^}]*\}/g, '').trim();
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(head)) out.push('default');
  return out;
}

test('② 每条相对 import 都能在目标模块里找到对应 export（锚点＝活源码整张 import 图）', () => {
  const bad = [];
  for (const p of srcFiles) {
    const rel = p.replace(srcRoot, '.');
    const text = stripComments(readFileSync(p, 'utf8'));
    const missing = (spec) => bad.push(rel + ' → import ' + JSON.stringify(spec) + ' 找不到模块文件');
    for (const m of text.matchAll(CLAUSE_RE)) {
      const clause = m[1] ?? m[2] ?? '';
      const spec = m[3];
      if (!spec.startsWith('.')) continue;            // 裸包名（react…）不归本闸管
      const target = resolveModule(p, spec);
      if (!target) { missing(spec); continue; }
      if (/\.(json|css)$/.test(target)) continue;      // 资源模块没有具名 export 可言
      const names = exportedNames(readFileSync(target, 'utf8'));
      for (const nm of requestedNames(clause)) {
        if (!names.has(nm)) bad.push(rel + ' → ' + JSON.stringify(spec) + ' 未导出 ' + nm);
      }
    }
    for (const m of text.matchAll(SIDE_RE)) {
      if (m[1].startsWith('.') && !resolveModule(p, m[1])) missing(m[1]);
    }
  }
  assert.deepEqual(bad, [], 'import 指向不存在的模块或未导出的名字：\n' + bad.join('\n'));
});
