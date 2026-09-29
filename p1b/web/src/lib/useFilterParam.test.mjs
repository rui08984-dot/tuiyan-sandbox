/* useFilterParam 闸（2026-09-27 八轮第四改 · 2026-09-30 按「死页面源码已删」修口径）
 *
 * 病象：筛选状态全在 useState 里 ⇒ 切页丢、刷新丢、前进后退丢、链接分享不出去。
 * 独立侦察称之为「筛选状态是页内孤岛」，并指出它与顶栏 9 项导航**打架**
 * （两套都像导航、互不沟通）。
 * 本闸锁三条交互承诺（纯静态检查 hook 源码与接线，零 React 运行）：
 *   ① 状态来源是 URL query，不是组件内存；
 *   ② 空值时**删除** query 而不是留 layer= 这种脏串；
 *   ③ 写入用 replace:false —— 否则浏览器后退键失效，等于没做 URL 化。
 *
 * ── 2026-09-30 口径修正（新事实，不是把闸门放松）────────────────────────────
 * `lib/useFilterParam.ts` 与它唯一的使用者 `pages/audit/OverviewPage.tsx`
 * **双双已随死页面删除**。依据：普查文
 * docs/specs/2026-09-29-死页面连累生产构建-普查.md:32 把 `lib/useFilterParam.ts`
 * 列为「只被 charts/* 与死页面引用」的 26 个「走不到」模块之一。
 *
 * 修口径前实测（不是推断）：
 *   cd p1b/web/src/lib && node --test useFilterParam.test.mjs
 *   → ENOENT: ...lib/useFilterParam.ts @ :18  ⇒ **0 个用例执行**
 *   即闸门不是「红」，是**整文件根本没跑**（:19 的死页面读取连报错机会都没有）。
 *
 * ★修法（不许削弱闸门强度的前提下）：
 *   ①②③④ 的断言体**一字未删**，降级为「**复活则必咬**」的分支断言 ——
 *   模块一旦重新出现，三条承诺 + 接线要求立刻全量生效，且不接受「只接一处」。
 *   同时新增四条**无条件硬断言**，把「别偷偷长回来 / 别把重定向弄丢」钉死：
 *     ⓪  死模块与死页面不得复活（删除这件事本身要被闸门锁住）；
 *     ⓪b 已删除的模块不得被任何**源文件** import —— 孤儿双向禁止：
 *        模块不在 ⇒ 必须零引用；模块回来 ⇒ 必须有人接（见 ④）；
 *     ⓪c 旧书签的重定向路由仍在。删的是组件源码，不是路由（普查文结论三③：
 *        「App.tsx:183-201 那 11 条重定向路由必须留着，旧书签会 404」）；
 *     ⓪d 重定向的**落点不能悬空**：/where-off 必须实挂 WhereOffPage。
 *
 * ★登记的待办事实（**不是通过项**，也**不许被当成「闸门已覆盖」**）：
 *   「URL 化筛选纪律」当前**无活载体**。实测 `grep -rn useSearchParams
 *   p1b/web/src --include=*.ts --include=*.tsx` **零命中**；接手页
 *   WhereOffPage.tsx 的三处筛选全是内存内数组 .filter（:207 / :226 / :232），
 *   没有 URL 化筛选 UI。所以 ①②③ 今天守的是**一条暂无载体的纪律**：
 *   它们不再是「筛选不许是页内孤岛」的运行时保证，而是「**谁把 URL 化筛选接回来，
 *   就必须按这三条实现**」的接入口契约。接线要求由 ④ 兜住。
 *   ★谁给活页接上第一处 URL 化筛选，必须回来改本文件的落点并把这件事写进
 *     expansion-freeze 的页计数旁，而不是让纪律悄悄继续无载体。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));   // …/web/src/lib
const SRC = join(dir, '..');                           // …/web/src
const HOOK路径 = join(dir, 'useFilterParam.ts');
const 死页面路径 = join(SRC, 'pages', 'audit', 'OverviewPage.tsx');

// ★旧口径的 :18 是无条件 readFileSync，文件一没就整文件 ENOENT。
//   改成存在性判断：模块在 ⇒ 断言照旧全量生效；模块不在 ⇒ 由 ⓪/⓪b/⓪c 接管。
const hook = existsSync(HOOK路径) ? readFileSync(HOOK路径, 'utf8') : null;
const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');

/** 递归列出 web/src 下全部 .ts/.tsx 源文件（本闸扫「源文件」，不扫 .mjs 测试，
 *  否则本文件自身的字符串会把自己算成引用者）。 */
function 源文件(目录) {
  const out = [];
  for (const e of readdirSync(目录, { withFileTypes: true })) {
    if (/node_modules|^dist$/.test(e.name)) continue;
    const p = join(目录, e.name);
    if (e.isDirectory()) out.push(...源文件(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 谁提到了 useFilterParam 这个标识符（导入方 + 残留调用方）。
 *  ★排除模块自身：文件里出现自己的函数名是自指，不构成「有人 import 它」。 */
const 引用者 = 源文件(SRC)
  .filter((f) => resolve(f) !== resolve(HOOK路径))
  .filter((f) => /\buseFilterParam\b/.test(readFileSync(f, 'utf8')))
  .map((f) => ({ 名: relative(SRC, f).replace(/\\/g, '/'), 源: readFileSync(f, 'utf8') }));

test('⓪ 死模块与死页面已删，且不得复活', () => {
  assert.equal(existsSync(HOOK路径), false,
    `lib/useFilterParam.ts 不得复活 —— 它只被死页面用，留着就是「走不到的死重量」`
    + `（普查文 2026-09-29-死页面连累生产构建-普查.md:32）。`
    + `若确有活页要 URL 化筛选，请新起一个**有活消费者**的模块并同步改本文件。`);
  assert.equal(existsSync(死页面路径), false,
    'pages/audit/OverviewPage.tsx 不得复活 —— /overview 与 /audit 都是 <Navigate> 重定向，组件不渲染。');
});

test('⓪b 已删除的模块不得被任何源文件 import（孤儿双向禁止）', () => {
  assert.deepEqual(引用者.map((r) => r.名), [],
    '没有任何源文件可以引用已删除的 useFilterParam —— 那会让 tsc 构建直接断，'
    + `当前命中：${JSON.stringify(引用者.map((r) => r.名))}`);
});

test('⓪c 旧书签的重定向路由仍在（删的是组件，不是路由）', () => {
  assert.match(app, /<Route\s+path="\/overview"\s+element=\{<Navigate\s+to="\/where-off"/,
    '/overview 必须仍重定向到 /where-off —— 删了它，八轮的旧书签会 404。');
  assert.match(app, /<Route\s+path="\/audit"\s+element=\{<Navigate\s+to="\/where-off"/,
    '/audit 必须仍重定向到 /where-off —— OverviewPage 的另一个入口。');
  // 反向：不得把这两个路径改回挂死组件（那就是复活死页面）
  assert.doesNotMatch(app, /path="\/overview"\s+element=\{<(?!Navigate)/,
    '/overview 不得改挂任何实组件。');
  assert.doesNotMatch(app, /path="\/audit"\s+element=\{<(?!Navigate)/,
    '/audit 不得改挂任何实组件。');
  assert.doesNotMatch(app, /element=\{<OverviewPage|element=\{<AuditPage/,
    'App.tsx 不得再引用已删除的 OverviewPage / AuditPage 组件。');
});

test('⓪d 重定向的落点不得悬空', () => {
  assert.match(app, /<Route\s+path="\/where-off"\s+element=\{<WhereOffPage\s*\/>\}/,
    '/where-off 必须实挂 WhereOffPage —— 上面两条重定向的落点不能悬空。');
  assert.equal(existsSync(join(SRC, 'pages', 'WhereOffPage.tsx')), true,
    'WhereOffPage.tsx 必须存在。');
});

test('① 状态来源是 URL query 而非 useState（复活即必咬）', () => {
  if (hook === null) return; // 模块不在 ⇒ 由 ⓪ 断言「它不该在」
  assert.ok(hook.includes('useSearchParams'), 'hook 须用 useSearchParams');
  assert.ok(hook.includes('params.get(key)'), '须从 query 读值');
  assert.equal(/useState<string\[\]>\(\[\]\)/.test(hook), false, 'hook 内不得回退到裸 useState');
});

test('② 空值删 query，不留脏串（复活即必咬）', () => {
  if (hook === null) return;
  assert.ok(hook.includes('p.delete(key)'), '空值须 delete 而非 set 空串');
  assert.equal(/p\.set\(key,\s*val\.join\(','\)\);[\s\S]{0,40}else\s*p\.set\(key,\s*''\)/.test(hook), false,
    '不得 set 空字符串（会留 layer= 这种脏 query）');
});

test('③ 写入不用 replace（否则后退键失效）（复活即必咬）', () => {
  if (hook === null) return;
  assert.ok(hook.includes('replace: false'), 'setParams 必须 replace:false，否则浏览器后退无效');
  assert.equal(/replace:\s*true/.test(hook), false, '不得用 replace:true——那会让「后退」回不到上一步筛选');
});

test('④ 接线：不再是页内孤岛（复活即必咬，断言体未弱化）', () => {
  if (hook === null) return;
  // ★口径迁移：OverviewPage 已是死页面且被 ⓪ 锁死不得复活，
  //   故「接线」重锚为「**任一活源文件**真的用它把筛选塞进 URL」。
  //   三处具体承诺（layer / domain / flag）**照原样全部保留**，不接受只接一处：
  //   少接一处就是「筛选状态又变回页内孤岛」，与本闸原始意图相反。
  assert.ok(引用者.length > 0,
    'useFilterParam.ts 复活却无人 import —— 那就是死重量，⓪ 的删除才是正解。'
    + '要么接上活页，要么把它一起删掉。');
  const 合体 = 引用者.map((r) => r.源).join('\n');
  assert.ok(合体.includes('useFilterParam'), '活源文件须用 useFilterParam');
  assert.ok(合体.includes("useFilterParam('layer')"), '层筛选须入 URL');
  assert.ok(合体.includes("useFilterParam('domain')"), '域筛选须入 URL');
  assert.ok(合体.includes('useFlagParam'), '「只看样本够」须入 URL');
  // ★顺带把 ⓪b 的另一半在复活情形下也钉住：模块在 ⇒ 不得同时有人 import 已死的旧路径
  assert.equal(引用者.some((r) => /from\s+['"][^'"]*useFilterParam['"]/.test(r.源)), true,
    '必须有活源文件以 import 形式引入 useFilterParam（不是注释、不是字符串残留）。');
});
