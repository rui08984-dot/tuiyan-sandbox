/* 渲染冒烟闸（2026-09-27 八轮第三改 · 因一次真实回归而加）
 *
 * 病象：删除 MiniGauge 时把同区块的 `import { DeviationBar }` 一并删掉，
 *   TypeScript 与 `node --test` 全绿（源码断言测不出「引用了未导入的标识符」），
 *   **页面运行时白屏报 "DeviationBar is not defined"**——由浏览器截图才发现。
 *   ⇒ 缺的正是这一类闸：**被引用但未定义/未导入** 的符号。
 *
 * 本闸做静态解析级检查（不真跑 React）：
 *   ① 本目录每个 .tsx 里，JSX 使用的组件名必须在同文件 import 或本地定义；
 *   ② charts/index.ts 导出的名字必须在对应文件里确实存在。
 * 覆盖不到运行时逻辑，但正好能挡住"删代码连带删 import"这一类。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(root);

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f)) out.push(p);
  }
  return out;
}

const files = walk(srcRoot);
const code = new Map(files.map((p) => [p, readFileSync(p, 'utf8')]));

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

test('② charts/index.ts 的导出名在各源文件里确实存在', () => {
  const idx = readFileSync(join(srcRoot, 'charts', 'index.ts'), 'utf8');
  const bad = [];
  // ★逐行匹配：`[^}]+` 在整篇 matchAll 下会**跨行**吞进下一条 export，
  //   把 m[2] 污染成 "ChartFrame" 之外的串（实测 11 条全被判为"源文件缺失"）。
  //   index.ts 的 export 都是单行形式，逐行即可覆盖，且不会跨行误配。
  const re = /export\s+\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g;
  for (const line of idx.split('\n')) {
    const m = re.exec(line);
    if (!m) continue;
    // index.ts 的 specifier 不带扩展名（'./ChartFrame'），而盘上是 ChartFrame.tsx
    const base = join(srcRoot, 'charts', m[2]);
    const file = ['.tsx', '.ts'].map((e) => base + e).find((f) => { try { readFileSync(f); return true; } catch { return false; } });
    let src;
    try { src = readFileSync(file ?? base, 'utf8'); } catch { bad.push('源文件缺失：' + m[2]); continue; }
    for (const part of m[1].split(',')) {
      const nm = part.trim().split(/\s+as\s+/)[0].trim();
      // ★用正则**字面量**而非 new RegExp('...\s...'): 字符串字面量里的 \s \b 会被
      //   当作真实字符（实测 'export\s+...ChartFrame\b' 永不匹配）。这里动态拼名字，
      //   故用 escape + 显式字符类，不依赖字符串里的反斜杠转义。
      const esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const found = new RegExp('export[ \\t]+(function|const|class)[ \\t]+' + esc + '(?![A-Za-z0-9_])').test(src);
      if (nm && !found) {
        bad.push(m[2] + ' 未导出 ' + nm);
      }
    }
  }
  assert.deepEqual(bad, [], 'charts 导出了不存在的名字：\n' + bad.join('\n'));
});
