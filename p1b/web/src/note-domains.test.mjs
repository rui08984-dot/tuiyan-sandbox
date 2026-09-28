/**
 * 「其中 N 条是人手写的」在**界面上**看得见（2026-09-28 · 洞一前端半）
 *
 * 病象：后端已经把账本按域分组了（`GET /api/predictions/domains`，real/lab/external/unknown
 *   四域互斥），可「记一笔」页的回执一个字都不提这件事。⇒ 外部题和那批 CLI 批量灌入的
 *   语料题在未落定清单、校准读数里同栏分不开，回执也不说 ⇒ 用户刚记下的那条落在哪一栏、
 *   「其中 N 条是人手写的」里的 N 到底是几，界面上**一个字都看不到**。
 *
 * 与本页其余闸同款：NotePage.tsx 含 JSX，禁新依赖 ⇒ 本闸是**源码级**的
 * （照 note-form.test.mjs / note-answer.test.mjs 的既有形态，不引 jsdom/Testing Library）。
 *
 * 本闸锁四件事：
 *   ① 回执里确实有一句带**两个数**（总数 + 人手写的条数）的话——只给一个数会被读成"账本就这么多"
 *   ② 那句话明说"一条都没删"（筛掉了 N 条不能被误读成数据没了 N 条）
 *   ③ 域判定**不在前端重算**：读的是后端那个端点，前端不拿 game_type 自己猜
 *   ④ 取不到读数时**不写 0**：整块不渲染（"没查到"与"真的是 0 条"必须长得不一样）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'pages', 'NotePage.tsx'), 'utf8');

test('① 回执里有一句「账本共 N 条，其中 M 条是人手写的」（两个数并排）', () => {
  assert.ok(page.includes('/api/predictions/domains'), '回执要读后端那个域披露端点');
  assert.ok(page.includes('note-domains'), '缺域披露那一块的 testid（前端道要能定位）');
  assert.ok(/账本共\s*<b>\{domains\.total\}<\/b>\s*条题/.test(page), '必须报出**总数**（只报人手写的条数会被读成"账本就这么多"）');
  assert.ok(/<b>\{domains\.handWritten\}<\/b>\s*条是人手写的/.test(page), '必须报出「其中 N 条是人手写的」这个 N');
  assert.ok(/domains\.total\s*-\s*domains\.handWritten/.test(page), '必须同时报出"其余多少条"（N 的补数）');
});

test('② 明说一条都没删（筛掉了 N 条不能被误读成数据没了 N 条）', () => {
  assert.ok(/一条都没删/.test(page), '回执要有一句"其余那些一条都没删"');
});

test('③ 域判定不在前端重算：读后端读数，不拿 game_type 自己猜', () => {
  // 前端只允许出现 by_scope.external 这一个后端字段名；不许出现自己判域的痕迹
  assert.ok(page.includes('j.by_scope.external'), '人手写的条数取自后端 by_scope.external');
  assert.equal(/source\s*===\s*['"]external['"]/.test(page), false,
    '不许在前端按 source 判域（口径会与后端 classifyGame 分叉，而分叉正是这个洞本身）');
  assert.equal(/game_type\s*===\s*['"]external['"]/.test(page), false, '同上：不许按 game_type 判域');
  // 判据是一次 HTTP 取回，不是自己遍历账本
  assert.ok(/fetch\('\/api\/predictions\/domains'\)/.test(page), '域读数必须来自那个只读端点');
});

test('④ 取不到读数时不写 0：整块不渲染（"没查到" ≠ "真的是 0 条"）', () => {
  assert.ok(/typeof j\.total\s*===\s*'number'/.test(page), '读数形状要校验后才进 state');
  assert.ok(/domains\s*\?\s*\(/.test(page), '那一块必须以 domains 为条件渲染（null 时整块不出现）');
  // 绝不能有"取不到就当 0"的兜底
  assert.equal(/total\s*\|\|\s*0/.test(page), false, '不许用 0 顶替"没查到"');
  assert.equal(/handWritten\s*\|\|\s*0/.test(page), false, '不许用 0 顶替"没查到"');
  assert.ok(/\.catch\(\(\)\s*=>\s*setDomains\(null\)\)/.test(page), '取读数失败必须落 null（且不牵连回执）');
});

test('⑤ 纪律：全文禁那个字（披露纪律），本页只讲已经记下的读数', () => {
  // 去掉注释与字符串字面量之外不该出现；这里只查**新增那句人话**里没有禁词
  const seg = page.slice(page.indexOf('note-domains') - 200, page.indexOf('note-domains') + 400);
  assert.equal(/预测/.test(seg), false, '披露句里出现禁词');
});
