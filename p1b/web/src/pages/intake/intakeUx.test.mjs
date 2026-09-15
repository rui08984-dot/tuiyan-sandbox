import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const intake = readFileSync(new URL('./IntakePage.tsx', import.meta.url), 'utf8');
const term = readFileSync(new URL('../../components/ui/Term.tsx', import.meta.url), 'utf8');
const steps = readFileSync(new URL('../../components/NewGameWizardSteps.tsx', import.meta.url), 'utf8');

// ── 接题页：22 问卡片化 ──
test('六层问答改卡片网格（不再长条下排）', () => {
  assert.ok(intake.includes('intake-layer-grid'), '缺卡片网格容器');
  assert.ok(intake.includes('intake-layer-toggle'), '缺折叠开关');
  assert.ok(intake.includes('openLayers'), '缺折叠状态');
});

test('每层显示已勾选进度（n/total）', () => {
  assert.ok(intake.includes('{picked}/{total}'), '缺进度计数');
  assert.ok(intake.includes('is-full'), '缺全勾满状态');
});

test('勾选整行可点（触控友好，非仅小方框）', () => {
  assert.ok(intake.includes('intake-check-row'), '缺整行勾选样式');
});

test('★ 决策序已显式说明（治反直觉：为什么 L5 打头）', () => {
  assert.ok(intake.includes('DECISION_ORDER_NOTE'), '缺决策序说明常量');
  assert.ok(intake.includes('按特殊性倒序排查'), '未说明特殊性倒序');
  assert.ok(intake.includes('L5→L6→L1→L3→L2'), '未写出后端决策序');
});

test('高级参数默认收起（不再占第一屏）', () => {
  assert.ok(intake.includes('intake-advanced'), '缺高级区');
  assert.ok(intake.includes('真值锚参数（可选'), '高级区未改人话');
});

// ── 术语：人话在前，专业原句不删 ──
test('22 问已改人话且保留判据原句', () => {
  assert.ok(intake.includes('plain:'), '缺人话字段');
  assert.ok(intake.includes('formal:'), '缺判据原句字段');
  assert.ok(intake.includes('<Term id="layer" plain={q.plain} formal={q.formal} />'), '问句未接 Term+formal');
});

test('Term 组件支持 formal（判据原句）且不删专业表述', () => {
  assert.ok(term.includes('formal'), 'Term 未支持 formal');
  assert.ok(term.includes('ui-term-pop-formal'), 'formal 未渲染');
  assert.ok(term.includes('hasPop'), '缺无术语条目时的兜底');
});

test('已消除中英混杂文案', () => {
  assert.ok(!intake.includes('resolve_spec（真值锚参数'), 'resolve_spec 中英混杂仍在');
  assert.ok(!intake.includes('题面（statement'), 'statement 中英混杂仍在');
  assert.ok(!intake.includes('reason=<b>'), 'reason= 原键仍糊在表面');
});

// ── 创建局：反直觉四点 ──
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
