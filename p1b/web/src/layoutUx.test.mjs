import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./styles/ui.css', import.meta.url), 'utf8');
const intakeCss = readFileSync(new URL('./styles/intake.css', import.meta.url), 'utf8');
const p1b4 = readFileSync(new URL('./styles/p1b4.css', import.meta.url), 'utf8');
const audit = readFileSync(new URL('./pages/audit/AuditPage.tsx', import.meta.url), 'utf8');
const manage = readFileSync(new URL('./pages/ManagePage.tsx', import.meta.url), 'utf8');

// ── 容器改宽 ──
test('接题页与对局页已改宽到 1280（与审计页同档）', () => {
  assert.ok(/path === '\/intake' \|\| path === '\/manage'/.test(app), '接题/对局未归入 wide');
  assert.ok(/path === '\/audit'\) return 'content content--wide'/.test(app), '审计页 wide 被改');
});

test('设置页仍为表单宽 720（单列易读，不该跟着改宽）', () => {
  assert.ok(/path === '\/settings'\) return 'content content--form'/.test(app), '设置页宽度被误改');
});

test('接题页宽屏＝主区自适应＋固定侧栏，窄屏回落单列', () => {
  assert.ok(/grid-template-columns: minmax\(0, 1fr\) 360px/.test(intakeCss), '缺固定侧栏布局');
  assert.ok(/@media \(max-width: 1023px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/.test(intakeCss), '缺窄屏回落');
});

test('宽屏侧栏吸顶（填表时结果始终可见）', () => {
  assert.ok(/@media \(min-width: 1024px\)[\s\S]*?position: sticky/.test(intakeCss), '侧栏未吸顶');
});

test('对局列表改横排多列（利用新增宽度）', () => {
  assert.ok(/repeat\(auto-fill, minmax\(300px, 1fr\)\)/.test(p1b4), '列表未改多列');
});

// ── 交互感 ──
test('可交互元素统一过渡（禁 0ms 瞬变）', () => {
  assert.ok(/transition: border-color 160ms ease/.test(ui), '缺统一过渡');
});

test('有按下反馈（触屏可感知）', () => {
  assert.ok(/:active/.test(ui) && /translateY\(1px\)/.test(ui), '缺按下反馈');
});

test('加载骨架已实现且不跳动（CLS）', () => {
  assert.ok(ui.includes('.ui-skeleton'), '缺骨架样式');
  assert.ok(ui.includes('ui-shimmer'), '缺骨架动画');
  assert.ok(audit.includes('ui-skeleton'), '审计页未使用骨架');
  assert.ok(audit.includes('kpi-skeleton'), '缺骨架容器 testId');
});

test('空态给下一步动作（不只描述）', () => {
  assert.ok(manage.includes('＋ 现在开一局'), '对局空态缺动作按钮');
  assert.ok(manage.includes('manage-empty'), '缺空态 testId');
});

test('卡片悬浮有反馈但不越 Ornate 红线（禁发光）', () => {
  assert.ok(/\.ui-stat:hover, \.ui-section:hover \{ border-color/.test(ui), '缺悬浮反馈');
  const shimmer = ui.slice(ui.indexOf('.ui-skeleton'));
  assert.ok(!/box-shadow:\s*0\s+0\s+\d+px\s+rgba/.test(shimmer), '出现装饰性发光');
});
