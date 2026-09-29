/**
 * 接题纪律闸 —— ★2026-09-30 口径修正：**死页源码已删**
 *
 * 【为什么要改，而不是删掉这个文件】
 *   旧版第 5 行是 `readFileSync(new URL('./IntakePage.tsx', ...))`。
 *   `pages/intake/IntakePage.tsx` 已随死页清理删除（该目录下现在只剩本文件），
 *   ⇒ 那一行在**模块加载期**就抛，后面 12 条用例一条都跑不到。
 *   ★那属于「用删测试绕过问题」的同一类事故，所以测试保留、口径重写。
 *
 * 【新事实（三条，都可执行，不是叙述）】
 *   1. 死页源码不在盘上。/intake 是**重定向**路径（App.tsx:190），组件永不渲染。
 *   2. 书签真正依赖的从来不是那份死文件，而是**重定向终点有没有一个真在渲染的页**
 *      —— 终点落空，书签照样断。终点是 /note（App.tsx:189 实挂 <NotePage />）。
 *   3. 接题纪律里**没有跟着死页一起消失**的那部分，搬到了两个**活**地方：
 *        · 六层判据的机器契约 → lib/noteChecklist.ts（NotePage:53 经它装配）
 *        · 人话 / 术语纪律     → 活页 NotePage.tsx 上的 <Term> 调用点
 *      旧文件里对着死页的 8 条断言：有活宿主的改指宿主；
 *      没有活宿主的（卡片网格 / 每层 n-of-total 进度 / 整行可点 / 高级区折叠）
 *      **不假装它还在** —— 改为**反向**断言：那些专属标记不得作为半截迁移
 *      残留成孤儿 DOM / 类名。（反向断言比正向更严：正向只能证明「页面里有」，
 *      反向同时挡住「标记留下了、页面没了」这种更难发现的半截状态。）
 *
 * 【与兄弟闸的重叠，出处写明，免得下一个人以为缺闸或以为重复】
 *   · /intake 重定向链 + App.tsx 不得再引用死页   → note-form.test.mjs ④
 *   · 五个死页 import 不得回来 + 旧路径不得删      → question-timeline.test.mjs ⑨
 *   · DECISION_ORDER / 三态 / 逐层问数（函数级）   → lib/noteChecklist.test.mjs ①②③④⑤
 *   · LAYER_Q 逐层条数 / 人只答两件事 / 默认已勾   → note-form.test.mjs ①②③
 *   本文件保的是上面**没人管**的那几件：死文件不得复活、活组件不得残留孤儿标记、
 *   Term 的 formal 能力、以及建局向导那四条反直觉设计。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..');
const DEAD_PAGE = join(HERE, 'IntakePage.tsx');
const LIVE_PAGE_FILE = join(SRC, 'pages', 'NotePage.tsx');

const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const page = readFileSync(LIVE_PAGE_FILE, 'utf8');
const checklist = readFileSync(join(SRC, 'lib', 'noteChecklist.ts'), 'utf8');
const term = readFileSync(join(SRC, 'components', 'ui', 'Term.tsx'), 'utf8');
const steps = readFileSync(join(SRC, 'components', 'NewGameWizardSteps.tsx'), 'utf8');

// ── 新事实一：死页已删，且不会被无声地放回来 ──
test('★ 死页源码已删，不得复活（复活＝重新制造永不可达的死重量）', () => {
  assert.equal(existsSync(DEAD_PAGE), false,
    'pages/intake/IntakePage.tsx 回来了：/intake 是重定向路径、组件永不渲染，'
    + '留着的唯一效果是重新堆起死重量并骗过按文件名做的静态扫描');
});

test('★ 死页的专属标记不得残留在任何活组件里（防半截迁移成孤儿 DOM / 类名）', () => {
  // 这几个名字连同卡片网格 / n-of-total 进度 / 整行可点 / 高级区折叠一起，
  // 已随死页整体下线（活页 NotePage 改走「人只答两件事」的减负版）。
  // ★留着的风险不是「少了个样式」，是**标记在、页面没了**：
  //   那正是 dead-page-reachability.audit.mjs 记的那一类生产缺陷的同形——代码还在、渲染路径没了。
  // ★这 8 个 = 旧版那 4 条对着死页的断言里出现过的**全部**专属标记，逐条对号入座，
  //   一个都没漏：旧 :11-13（网格/开关/折叠状态）、旧 :17-18（进度计数）、
  //   旧 :22（整行可点）、旧 :26（决策序说明）、旧 :32（高级区）。
  const 标记 = [
    'intake-layer-grid',     // 六层卡片网格容器        ← 旧 :11
    'intake-layer-toggle',   // 折叠开关                ← 旧 :12
    'openLayers',            // 折叠状态                ← 旧 :13
    '{picked}/{total}',      // 每层「已勾 n/总」进度    ← 旧 :17
    'is-full',               // 全勾满状态              ← 旧 :18
    'intake-check-row',      // 整行可点的勾选行         ← 旧 :22
    'DECISION_ORDER_NOTE',   // 决策序的人话说明常量     ← 旧 :26
    'intake-advanced',       // 高级参数区              ← 旧 :32
  ];
  const 残留 = [];
  (function walk(dir) {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) {
        if (!/node_modules|dist/.test(n)) walk(p);
      } else if (/\.tsx?$/.test(n)) {
        const s = readFileSync(p, 'utf8');
        for (const m of 标记) if (s.includes(m)) 残留.push(relative(SRC, p).replace(/\\/g, '/') + ' → ' + m);
      }
    }
  })(SRC);
  assert.deepEqual(残留, [], '死页标记残留在活源码里：' + 残留.join('; '));
});

// ── 新事实二：书签靠的是重定向终点，不是那份死文件 ──
test('★ /intake 书签重定向仍在，且终点是盘上真有的活页', () => {
  assert.ok(/<Route path="\/intake" element=\{<Navigate to="\/note" replace\s*\/>\}/.test(app),
    '/intake 须仍重定向到 /note（旧路径消失＝书签断）');
  assert.ok(/<Route path="\/note" element=\{<NotePage\s*\/>\}/.test(app),
    '/note 须实挂 NotePage：重定向终点落空＝书签照样断');
  // ★这一条是比 note-form.test.mjs ④ 更靠后的一道：那边查的是 App.tsx 里的**字符串**，
  //   终点文件被删时字符串照样通过，编译却会炸 ⇒ 终点必须在盘上。
  assert.equal(existsSync(LIVE_PAGE_FILE), true,
    '重定向终点 pages/NotePage.tsx 不在盘上：/intake 会指向一个不存在的页');
});

// ── 决策序契约：搬到了 lib/noteChecklist.ts，仍与后端逐字对齐 ──
test('★ 六层决策序 L5→L6→L1→L3→L2 仍在活模块里，与后端 intake.js 逐字对齐', () => {
  assert.ok(/DECISION_ORDER[^=\n]*=\s*\[\s*'L5',\s*'L6',\s*'L1',\s*'L3',\s*'L2'/.test(checklist),
    '决策序与后端 DECISION_ORDER 不一致（判层顺序变了，后端会落到不同的层）');
});

// ── 术语：人话在前，专业原句不删 ──
test('★ 真值锚仍用人话解释（人话在前，不只丢一个术语 id）', () => {
  assert.ok(page.includes("from '../components/ui'"), '活页未导入 ui');
  assert.ok(/<Term id="truthAnchor"\s+plain="/.test(page),
    '真值锚这一栏须带人话解释：光给术语 id 会让人只剩一个看不懂的词');
});

test('Term 组件支持 formal（判据原句）且不删专业表述', () => {
  assert.ok(term.includes('formal'), 'Term 未支持 formal');
  assert.ok(term.includes('ui-term-pop-formal'), 'formal 未渲染');
  assert.ok(term.includes('hasPop'), '缺无术语条目时的兜底');
});

test('已消除中英混杂文案（活页口径：旧版这条对着已删的死页，已转到真在渲染的记一笔页）', () => {
  assert.ok(!page.includes('resolve_spec（真值锚参数'), 'resolve_spec 中英混杂仍在');
  assert.ok(!page.includes('题面（statement'), 'statement 中英混杂仍在');
  assert.ok(!page.includes('reason=<b>'), 'reason= 原键仍糊在表面');
});

// ── 创建局：反直觉四点（NewGameWizardSteps 是活组件，原样保留）──
test('常用人数快捷键', () => {
  assert.ok(steps.includes('QUICK_COUNTS'), '缺人数快捷键');
  assert.ok(steps.includes('count-chip'), '缺快捷键样式类');
});

test('局名实时校验（不等点下一步）', () => {
  assert.ok(steps.includes('nameEmpty'), '缺实时判空');
  assert.ok(steps.includes('is-warn'), '缺实时告警样式');
});

test('人数改动即时预告席位数', () => {
  assert.ok(steps.includes('将建 {p.count} 个席位'), '缺席位预告');
});

test('席位支持批量粘贴并统计已填', () => {
  assert.ok(steps.includes('pasteMany'), '缺批量粘贴');
  assert.ok(steps.includes('已填真名'), '缺已填统计');
});
