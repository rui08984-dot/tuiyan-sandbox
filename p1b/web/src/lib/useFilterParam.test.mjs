/* useFilterParam 闸（2026-09-27 八轮第四改）
 *
 * 病象：筛选状态全在 useState 里 ⇒ 切页丢、刷新丢、前进后退丢、链接分享不出去。
 * 独立侦察称之为「筛选状态是页内孤岛」，并指出它与顶栏 9 项导航**打架**
 * （两套都像导航、互不沟通）。
 * 本闸锁三条交互承诺（纯静态检查 hook 源码与接线，零 React 运行）：
 *   ① 状态来源是 URL query，不是组件内存；
 *   ② 空值时**删除** query 而不是留 layer= 这种脏串；
 *   ③ 写入用 replace:false —— 否则浏览器后退键失效，等于没做 URL 化。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const hook = readFileSync(join(dir, 'useFilterParam.ts'), 'utf8');
const ov = readFileSync(join(dir, '..', 'pages', 'audit', 'OverviewPage.tsx'), 'utf8');

test('① 状态来源是 URL query 而非 useState', () => {
  assert.ok(hook.includes('useSearchParams'), 'hook 须用 useSearchParams');
  assert.ok(hook.includes('params.get(key)'), '须从 query 读值');
  assert.equal(/useState<string\[\]>\(\[\]\)/.test(hook), false, 'hook 内不得回退到裸 useState');
});

test('② 空值删 query，不留脏串', () => {
  assert.ok(hook.includes('p.delete(key)'), '空值须 delete 而非 set 空串');
  assert.equal(/p\.set\(key,\s*val\.join\(','\)\);[\s\S]{0,40}else\s*p\.set\(key,\s*''\)/.test(hook), false,
    '不得 set 空字符串（会留 layer= 这种脏 query）');
});

test('③ 写入不用 replace（否则后退键失效）', () => {
  assert.ok(hook.includes('replace: false'), 'setParams 必须 replace:false，否则浏览器后退无效');
  assert.equal(/replace:\s*true/.test(hook), false, '不得用 replace:true——那会让「后退」回不到上一步筛选');
});

test('④ 观测台已接线（不再是页内孤岛）', () => {
  assert.ok(ov.includes('useFilterParam'), 'OverviewPage 须用 useFilterParam');
  assert.ok(ov.includes("useFilterParam('layer')"), '层筛选须入 URL');
  assert.ok(ov.includes("useFilterParam('domain')"), '域筛选须入 URL');
  assert.ok(ov.includes('useFlagParam'), '「只看样本够」须入 URL');
});
