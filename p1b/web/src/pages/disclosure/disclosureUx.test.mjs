import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// P0-U7/U8 页面化（2026-09-16）：源码级断言（沿 intakeUx/auditTerms 先例，零 DOM 依赖）
const cal = readFileSync(new URL('./CalendarPage.tsx', import.meta.url), 'utf8');
const rep = readFileSync(new URL('./CalibrationReportPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

test('日历页：接披露端点、标题用「待验证队列」、缺件 n/a 兜底', () => {
  assert.ok(cal.includes('/api/disclosure/calendar'), '缺端点');
  assert.ok(cal.includes('待验证队列'), '缺标题');
  assert.ok(cal.includes('披露件暂缺'), '缺 n/a 兜底');
  assert.ok(cal.includes('只披露不裁决'), '缺口径声明');
});

test('校准报告页：接披露端点、薄格标注、限定语块、Term 渐进披露', () => {
  assert.ok(rep.includes('/api/disclosure/calibration'), '缺端点');
  assert.ok(rep.includes('n<30 仅方向'), '缺薄格标注');
  assert.ok(rep.includes('限定语块'), '缺限定语块');
  assert.ok(rep.includes('<Term'), '未接 Term');
  assert.ok(rep.includes('bayesPrior') && rep.includes('posteriorAgg'), '贝叶斯术语 id 未用');
});

test('两页宽度档＝content--wide（表格页）＋路由与导航已挂', () => {
  assert.ok(app.includes("'/calendar'") && app.includes("'/calibration'"), '缺路由/宽度档');
  assert.ok(app.includes('content--wide'), '缺宽档');
  assert.ok(app.includes('CalendarPage') && app.includes('CalibrationReportPage'), '缺页面挂载');
});

test('禁词黑名单：两页源码与 App 不含「预测」字样', () => {
  for (const [name, src] of [['CalendarPage', cal], ['CalibrationReportPage', rep], ['App', app]]) {
    assert.ok(src.indexOf('预测') === -1, name + ' 出现禁词「预测」');
  }
});
