/**
 * p1b/web/src/pages/habit-rank-wiring.test.mjs —— 「你在哪类事上偏」抽出组件后的**接线锁**（2026-09-30）
 *
 * 【为什么这道闸与后端那道是两件事，分开守】
 *   p1b/test/habit-rank.test.cjs 守的是**算得对不对**（金样 + 五条判据 + n<30 纪律）。
 *   本道守的是**是不是只有一份**：病象是那段归并只活在一个 React 组件里，
 *   页面算一遍、后端算一遍，两份各自演化 ⇒ 同一个"你老犯什么毛病"对不上号。
 *   数值对但有两份实现，仍然是坏的 —— 那是下一次改口径时最容易出的事。
 *
 * 【锁住的东西】
 *   ① 前置：页面源码非空（防空集假通过）
 *   ② ★组件里**不许**再有第二份归并实现（逐条列出会露馅的源码特征）
 *   ③ 页面确实 import 并调用了共享模块；那段"为什么这么排"也取自同一处
 *   ④ ★前后端跑的是**同一个物理文件**（解析 import 路径，与后端 require 的路径比对）
 *   ⑤ 抽取前的既有纪律一条不破（禁词 / 薄格三句 / 聚合行不得挂题目链接）
 *   ⑥ ★dev 也要能跑：vite dev 的 fs.allow 放宽到 p1b 包根
 *      ——生产构建不报错、只有 dev 会 403 的那种坏，不锁住下次改配置就又踩一遍
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, '..', '..');          // p1b/web
const P1B = resolve(WEB, '..');                  // p1b
const PAGE = join(here, 'WhereOffPage.tsx');
const VITE = join(WEB, 'vite.config.ts');
const MOD = join(P1B, 'src', 'disclosure', 'habitRank.mjs');

// 页面里那句 import 的字面量（与源码里写的相对路径一一对应）
const IMPORT_REL = '../../../src/disclosure/habitRank.mjs';

// ── ① 前置 ───────────────────────────────────────────────────────────────────
test('① 前置：被锁的三个文件都在，且页面非空（防空集假通过）', () => {
  for (const p of [PAGE, VITE, MOD]) assert.ok(existsSync(p), '缺文件：' + p);
  const page = readFileSync(PAGE, 'utf8');
  assert.ok(page.length > 1000, '★页面源码过短（读到了空壳？）实测 ' + page.length + ' 字符');
  assert.ok(page.includes('habits'), '★页面里连 habits 都没有了（抽取时把渲染也删了？）');
});

// ── ② ★同一个口径不许留两份 ──────────────────────────────────────────────────
test('② ★组件里不许再有第二份归并实现（逐条列出会露馅的特征）', () => {
  const page = readFileSync(PAGE, 'utf8');
  const 露馅 = [
    ['by[c.domain]', '按域建桶的那一行'],
    ['b.ok += 1', '累加够样本格数'],
    ['b.d += c.delta_vs_half', '累加偏差'],
    ['Object.entries(by)', '把桶摊成数组'],
    ['b.d / b.ok', '★除以格数的那一步'],
    ['Math.abs(b.delta) - Math.abs(a.delta)', '按 |偏差| 降序'],
    ['conclusion_allowed) { b.ok', '够样本格才累加'],
    ['n: 0, ok: 0, d: 0, cnt: 0', '桶的初值'],
  ];
  const 还在 = 露馅.filter(([片段]) => page.includes(片段)).map(([, 说明]) => 说明);
  assert.deepEqual(还在, [],
    '★组件里还留着第二份归并实现（' + 还在.join('；') + '）——口径必须只有一份');

  // 反向也钉一下：确实接上了，不是"删干净了事"
  assert.ok(page.includes("from '" + IMPORT_REL + "'"), '★未 import 共享模块');
  assert.match(page, /import\s*\{[^}]*\brankHabits\b[^}]*\}\s*from\s*'([^']+)'/,
    '★import 里没有 rankHabits');
  assert.match(page, /useMemo\(\(\)\s*=>\s*rankHabits\(cells\),\s*\[cells\]\)/,
    '★habits 没有走共享函数（可能只是把 import 摆着好看）');
});

// ── ③ 那句"为什么这么排"也取自同一处，不许页面自己再写死一句 ────────────────
test('③ 页面那段说明句取自共享模块（计算一处、解释一处）', () => {
  const page = readFileSync(PAGE, 'utf8');
  const m = /import\s*\{([^}]*)\}\s*from\s*'([^']*habitRank\.mjs)'/.exec(page);
  assert.ok(m, '★找不到共享模块的 import');
  assert.match(m[1], /\bHABIT_RANK_BASIS\b/, '★没 import HABIT_RANK_BASIS');

  // 页面渲染的那句确实来自 page_note，不是组件里另写的一句
  const mod = readFileSync(MOD, 'utf8');
  const pm = /page_note:\s*'([^']*)'/.exec(mod);
  assert.ok(pm, '★共享模块里没有 page_note（页面那句就断了来源）');
  assert.ok(pm[1].length > 10, '★page_note 太短，像是占位');
  assert.ok(page.includes('HABIT_RANK_BASIS.page_note'), '★页面没有渲染 HABIT_RANK_BASIS.page_note');
  // 组件里不许还留着原来那句硬写的说明（否则就有两个真相）
  assert.equal(page.includes('按「相对无信息线的平均偏差」排。只有样本够的格参与'),
    false, '★组件里还留着硬写的旧说明句（应取自 page_note）');
  // page_note 里必须把最容易搞错的那一处说出来
  assert.match(pm[1], /不参与排序、只记方向/, '★page_note 没说清薄格不参与排序');
});

// ── ④ ★前后端跑的是同一个物理文件 ───────────────────────────────────────────
test('④ ★前端 import 与后端 require 解析到同一个文件', () => {
  const 前端解析 = resolve(here, IMPORT_REL);
  assert.ok(existsSync(前端解析), '★前端的相对路径解析不到文件：' + 前端解析);
  // 后端端点里写的是 '../disclosure/habitRank.mjs'，相对 p1b/src/routes/
  const 后端解析 = resolve(P1B, 'src', 'routes', '..', 'disclosure', 'habitRank.mjs');
  assert.equal(前端解析, 后端解析, '★前后端解析到的不是同一个文件：\n  前端 ' + 前端解析 + '\n  后端 ' + 后端解析);
  const route = readFileSync(join(P1B, 'src', 'routes', 'disclosure.js'), 'utf8');
  assert.ok(route.includes("require('../disclosure/habitRank.mjs')"),
    '★端点没 require 共享模块（它自己算了一份？）');
  assert.match(route, /app\.get\('\/api\/disclosure\/habits'/, '★缺 /api/disclosure/habits 端点');
});

// ── ⑤ 抽取前的既有纪律一条不破 ───────────────────────────────────────────────
test('⑤ 既有纪律不破：禁词零命中、薄格三句仍在、聚合行不挂题目链接', () => {
  const page = readFileSync(PAGE, 'utf8');
  assert.equal((page.match(/预测/g) || []).length, 0, 'WhereOffPage 出现禁词');

  // 薄格那三句是别的闸在钉的（charts / disclosureUx / firstRun），抽取不许把它们带走
  for (const [串, 说明] of [
    ['只记方向，不下结论的格', '薄格单列一栏'],
    ['样本不足 30', 'n<30 门限明文'],
    ['不给误差值', '薄格不给误差值'],
  ]) {
    assert.ok(page.includes(串), '★抽取把「' + 说明 + '」带走了：' + 串);
  }

  // 偏流条/习惯/薄格三处都是 layer×domain 聚合，数据里没有题目 id ⇒ 不得挂 /question 链接
  // （沿用 question-timeline ⑩ 的那道；抽取正好动了 habits 那一段，这里再钉一次）
  const at = page.indexOf('const habits');
  assert.ok(at > 0, '★找不到 const habits');
  const habits段 = page.slice(at, at + 800);
  assert.equal(habits段.length, 800, '★habits 段不足 800 字（比对照样被截短了）');
  assert.equal(/\/question\//.test(habits段), false, '★习惯聚合（无题目 id）不得挂 /question 链接');

  // 渲染路径没被抽空：榜仍是逐行渲染的，且那两句「报大了/报小了」与「N 条题 · K 格够样本」还在
  assert.ok(page.includes('habits.map('), '★habits 不再逐行渲染（榜被抽空了？）');
  for (const 串 of ['报小了', '报大了', '条题 · ', '格够样本']) {
    assert.ok(page.includes(串), '★榜上的读法变了：' + 串);
  }
});

// ── ⑥ ★dev 也要能跑：vite dev 的 fs.allow ───────────────────────────────────
test('⑥ ★vite dev 的可读范围覆盖 p1b 包根（否则这条 import 在 dev 下 403）', () => {
  const vite = readFileSync(VITE, 'utf8');
  assert.match(vite, /fs:\s*\{[^}]*allow\s*:/, '★vite.config.ts 没配 server.fs.allow');
  // 配置取的是 p1b 包根（web 的上一级），不能是某个更窄的路径
  assert.match(vite, /new URL\('\.\.',\s*import\.meta\.url\)/,
    '★fs.allow 不是按"web 的上一级"（p1b 包根）算的 —— 覆盖不到共享模块');
  // 实测这条 import 落在 p1b 包根之内
  const 前端解析 = resolve(here, IMPORT_REL);
  assert.ok(前端解析.startsWith(resolve(WEB, '..') + '\\') || 前端解析.startsWith(resolve(WEB, '..') + '/'),
    '★共享模块不在 p1b 包根内：' + 前端解析);
});
