/**
 * 揭晓分流闸（2026-09-28 · T6 / 模块 M3 后端半）
 *
 * 病象：旧「待落定」页把到期未解的题列成一队、让人**全部手填**，
 *   但守护进程已在自动结算（实测一轮：到期 21 → 自动结 2 / pending 12 / fail 7）。
 *   ⇒ 那页是**倒退设计**。本件把「到期未解」按能不能自动揭晓分三类。
 *
 * 三条不可让步的纪律：
 *   ① 三类**互斥且完备**——每个到期未解的题必属其一，不许有"四不像"
 *   ② **stuck 不给可点按钮**——点了没反应比不给更糟，用户会以为是 bug
 *   ③ 只读：端点不改账本任何一列（揭晓仍由守护进程与 resolve 接口写）
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RC = require(path.join(ROOT, 'src', 'evidence', 'revealClass.js'));
const route = require('node:fs').readFileSync(path.join(ROOT, 'src', 'routes', 'disclosure.js'), 'utf8');

test('① 三类互斥且完备：每个 kind 恰属其一', () => {
  for (const [kind, spec] of Object.entries(RC.REVEAL_CLASS)) {
    assert.ok(['ok', 'human', 'stuck'].includes(spec.c),
      kind + ' 的类必须是 ok/human/stuck 之一，实得 ' + spec.c);
    assert.ok(spec.note && spec.note.length > 4, kind + ' 必须有**人话理由**（说清为什么）');
  }
});

test('①b 未登记的 kind 保守落到 human（宁可问一句，不给错按钮）', () => {
  const c = RC.classifyReveal('some_never_seen_kind');
  assert.equal(c.c, 'human', '未登记的须保守处理');
  assert.ok(c.note, '须有说明');
});

test('② stuck 类必须写明「代码无法解决」或「窗口已过」', () => {
  // 给了假按钮却不说为什么，是最伤的一种
  for (const [kind, spec] of Object.entries(RC.REVEAL_CLASS)) {
    if (spec.c !== 'stuck') continue;
    assert.ok(/无法解决|永久|过期|已过|封禁/.test(spec.note),
      kind + ' 的 stuck 理由须说清「不可解」而不是只说「没查到」：' + spec.note);
  }
});

test('★③ 端点只读：不得写账本', () => {
  const i = route.indexOf('/api/disclosure/resolve-queue');
  assert.ok(i > 0, '端点须存在');
  const block = route.slice(i, i + 2200);
  assert.equal(/INSERT|UPDATE|DELETE/i.test(block), false, '本端点只读，不得有写库语句');
  assert.ok(block.includes('resolved_at IS NULL') || block.includes('resolved_at IS NOT NULL'),
    '须按是否已结算分流');
});

test('④ 端点自带纪律声明（前端要据此写文案）', () => {
  const i = route.indexOf('/api/disclosure/resolve-queue');
  const block = route.slice(i, i + 2600);
  assert.ok(block.includes('discipline'), '须返回 discipline 声明块');
  assert.ok(/不给可点按钮|不给.*按钮/.test(block), '须声明「stuck 不给假按钮」');
});
