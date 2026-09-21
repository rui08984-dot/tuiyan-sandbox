'use strict';
/**
 * p1b/test/corpus-thicken-publishdays.test.cjs —— 生成器「非发布日」缺陷回归锁（2026-09-21）
 *
 * 背景（登记缺陷 `corpus-thicken.cjs:372`）：
 *   生成器用 `targetDates = [today+3, today+5, today+7]` 直接出题，**未过滤非发布日**
 *   ⇒ 会生成「该日源根本不发布」的题 ⇒ 永久 pending（与 frankfurter 19 条被预筛拦死同根）。
 *   实测：09-21（周一）⇒ 目标日 09-24(四)/09-26(**六**)/09-28(一)，周六那条即不可解题。
 *
 * 覆盖：
 *   ① 静态锁：frankfurter recipe 声明 publishDays=[1..5]（ECB 每工作日）
 *   ② 行为锁：用脚本同款过滤逻辑，对一组已知日期验证「周六被剔除、工作日保留」
 *   ③ ★上限前置锁：源码中「判上限」必须出现在「rc.build 调用」之前（防止白跑网络）
 *   ④ 零回归锁：未声明 publishDays 的 recipe 不得受影响（过滤只对声明者生效）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'p1b/scripts/corpus-thicken.cjs');

/** 与脚本同款的日期工具（复制语义，非复制实现——脚本内是局部函数） */
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();

test('① 静态锁：frankfurter 声明 publishDays=[1..5]（ECB 每工作日发布）', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const m = src.match(/domain:\s*'frankfurter'[\s\S]{0,200}?publishDays:\s*\[([^\]]+)\]/);
  assert.ok(m, 'frankfurter recipe 应声明 publishDays');
  const days = m[1].split(',').map((x) => Number(x.trim())).sort();
  assert.deepEqual(days, [1, 2, 3, 4, 5], 'ECB 发布日应为周一~周五（实测 ' + JSON.stringify(days) + '）');
  assert.ok(days.indexOf(0) === -1 && days.indexOf(6) === -1, '不得含周日/周六');
});

test('② 行为锁：周六被剔除、工作日保留（09-21 周一起算）', () => {
  const targetDates = [addDays('2026-09-21', 3), addDays('2026-09-21', 5), addDays('2026-09-21', 7)];
  assert.deepEqual(targetDates, ['2026-09-24', '2026-09-26', '2026-09-28'], '前置：三个目标日应如实测');
  assert.equal(dow('2026-09-26'), 6, '★前置：09-26 确为周六（这条就是缺陷要拦的）');

  const fx = [1, 2, 3, 4, 5];
  const kept = targetDates.filter((td) => fx.indexOf(dow(td)) !== -1);
  assert.deepEqual(kept, ['2026-09-24', '2026-09-28'], '周六应被剔除，两个工作日保留');
  assert.ok(kept.indexOf('2026-09-26') === -1, '★周六不得出现在过滤结果里');
});

test('③ ★上限前置锁：判上限须在 rc.build 之前（防白跑网络）', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const iCap = src.indexOf('if (haveN >= DOMAIN_CAP)');
  const iBuild = src.indexOf('await rc.build(td)');
  assert.ok(iCap > 0 && iBuild > 0, '两处代码都应存在');
  assert.ok(iCap < iBuild, '★判上限（L' + iCap + '）必须在调用 build（L' + iBuild + '）之前——否则已满的域会白跑一轮网络（实测 12.5s→0.0s）');
});

test('④ 零回归锁：过滤只对声明 publishDays 的 recipe 生效', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  // 过滤表达式须带 rc.publishDays 条件（三元的判据位）
  assert.ok(/rc\.publishDays\s*\?/.test(src), '过滤须以 rc.publishDays 为条件（未声明者走原路径）');
  // 统计声明数：只应有 1 个 recipe 声明（frankfurter）
  const decls = (src.match(/publishDays:\s*\[/g) || []).length;
  assert.equal(decls, 1, '当前应只有 frankfurter 一个域声明 publishDays（实测 ' + decls + '）——新增时须同时核该域发布节奏并给证据');
});
