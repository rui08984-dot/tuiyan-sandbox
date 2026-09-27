/**
 * 修正文案闸（2026-08-28 · T1 / 模块 M7）
 *
 * 病象：后端 409 文案写「如需纠错请另开修正记录」，但**全库 grep `amend` 零命中**
 *   —— 没有任何修正接口。等于叫用户走一条不存在的路，比不说更糟。
 * 处置：本轮不碰「账本不可变」这条铁律（做修正功能会牵动「修正记录算不算进统计」），
 *   改为**如实说明现状**：不可改正是账本可信的原因，且目前没有修正入口。
 * 本闸锁死：不得再出现指向那条不存在的路的措辞。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('① 后端 409 不再指向不存在的修正入口', () => {
  const src = read('p1b/src/routes/predictions.js');
  // ★只查**面向用户的文案**（httpError 的第二个参数），不扫注释：
  //   注释里说明「原文案是死胡同」是必要留痕，不该被当成残留误报。
  const msgs = [...src.matchAll(/httpError\(\s*\d+\s*,\s*([\s\S]*?)\);/g)].map((m) => m[1]).join('\n');
  assert.equal(/另开/.test(msgs), false,
    '409 文案不得再指向不存在的修正入口（无 amend 接口）——那是死胡同');
  assert.ok(msgs.includes('修正入口'), '须如实说明「目前没有修正入口」');
  assert.ok(msgs.includes('不可改') || msgs.includes('不可变'),
    '须保留「账本不可改/不可变」这个前提（它正是账本可信的原因）');
});

test('② 前端 409 提示同样不得指向死胡同', () => {
  const src = read('p1b/web/src/pages/ResolvePage.tsx');
  const msgs = [...src.matchAll(/say\(\s*'[a-z]+'\s*,\s*('[\s\S]*?')\s*\)/g)].map((m) => m[1]).join('\n');
  assert.equal(/另开/.test(msgs), false, '前端提示不得再教用户走不存在的路');
  assert.ok(msgs.includes('没有修正入口'), '须如实说明没有修正入口');
});

test('③ ★不得顺手加一个「假修正」入口（真做须另立项）', () => {
  // 假入口 = 界面上出现「修正」按钮但没有后端支撑。做修正功能要牵动校准统计口径，
  // 属另立项范围；本轮只如实说明，不提供点不动或有误导的按钮。
  const files = ['p1b/web/src/pages/ResolvePage.tsx', 'p1b/web/src/pages/WhereOffPage.tsx'];
  for (const f of files) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.equal(/修正记录|amend/i.test(code), false,
      f + ' 出现修正入口相关代码——真做须另立项（涉及修正记录是否计入统计）');
  }
});
