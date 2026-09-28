/**
 * 「诚实区间」页面纪律闸（2026-09-29）
 *
 * 病象（本轮要根治的那一个）：问一句「某件事会不会发生」，系统就得**假装精确**——
 * 要么给一个没人有根据的数，要么什么都不给。
 * 修法不是「让数更好看」，是**把选择权交回用户**：
 *   · 端点要么给区间，要么明说给不了（n<30 两个出口都不给数）；
 *   · 页面上「要不要一个数」由用户自己点，默认「严格」。
 *
 * 本闸锁六件事（源码级断言，沿 kind-label / disclosureUx 先例，零 DOM 依赖、零新依赖）：
 *   ① 两个出口都在，默认严格；
 *   ② 严格出口给 ErrorBar 传 `value={null}`（只画区间、不画点）；
 *      给基率出口才传点估计——两个出口读的是**同一个** `point_estimate` 字段，
 *      所以 n<30 时它们**同时**拿不到数（不许给基率出口开小灶）。
 *   ③ 给基率那一屏**必须**有「这个数是历史基率，不是任何人的判断」这句标注；
 *   ④ 取不到的东西显示「取不到」，**不许**显示 0 / 0%（占位数闸）；
 *   ⑤ 三态（够／薄／一道都没有）在界面上是**三句不同的话**；
 *   ⑥ 禁词：页面与注释全文不出现那两个字。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'BaselinePage.tsx'), 'utf8');
const app = readFileSync(join(dir, '..', '..', 'App.tsx'), 'utf8');

test('① 两个出口都在，且默认「严格」', () => {
  assert.ok(page.includes('严格'), '缺「严格」出口');
  assert.ok(page.includes('给基率'), '缺「给基率」出口');
  // 默认值：useState 的初参必须是严格档，不能是给基率档
  const m = /useState<Exit>\(([^)]*)\)/.exec(page);
  assert.ok(m, '找不到出口档位的 useState');
  assert.equal(m[1].trim(), "'strict'", '默认出口必须是「严格」而不是「给基率」：' + m[1]);
  assert.ok(page.includes('/api/baseline/'), '未接诚实区间端点');
});

test('★② 严格出口传 value={null}；给基率出口才传点估计；两者读同一个字段', () => {
  // 只取 ErrorBar 上的 value —— <select>/<option> 上的 value 不算数（它们是选择器，不是读数）
  const bars = [...page.matchAll(/<ErrorBar[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(bars.length, 2, '恰好两个出口各一个 ErrorBar，实得 ' + bars.length);
  const shown = bars.map((b) => {
    const m = /value=\{([^}]*)\}/.exec(b);
    return m ? m[1].trim() : '(没有 value 入参)';
  });
  assert.deepEqual(shown, ['null', 'd.point_estimate'],
    '严格出口必须是 value={null}（只画区间不画点），给基率出口只准是端点的 point_estimate：' + JSON.stringify(shown));
  // ★不许有「薄样本也给个数」的第二条路（比如再读一个 fallback 字段）
  assert.equal(/point_estimate\s*\|\||point_estimate\s*\?\?/.test(page), false,
    '点估计不许有兜底分支——n<30 时它必须就是拿不到');
  // 两个出口都必须带上区间（否则「严格」就没有区间可显示）
  for (const b of bars) {
    assert.ok(/ciLo=\{/.test(b) && /ciHi=\{/.test(b), 'ErrorBar 必须带 ciLo/ciHi');
  }
});

test('★②c n<30 时**两个出口都拿不到点估计**（锁的是接线，不是措辞）', () => {
  // 出口分支的条件必须同时含两件事：①当前是不是「严格」档 ②点估计取不取得到。
  //   缺 ② 的话，"给基率"档在 n<30 时仍会去找那个 null 之外的数——
  //   而端点已经把它置 null，页面再兜一层才是绕过纪律。
  const cond = /\{([^}]*)\? \(\s*<ErrorBar/.exec(page);
  assert.ok(cond, '找不到出口分支的条件表达式');
  assert.ok(/exit === 'strict'/.test(cond[1]), '条件必须含「严格档」这一半：' + cond[1]);
  assert.ok(/hasPoint|point_estimate === null/.test(cond[1]),
    '条件必须含「点估计取不到」这一半（否则给基率档在 n<30 时还能给数）：' + cond[1]);
  // hasPoint 只能由端点那**一个**字段决定，不许掺进别的来源
  assert.ok(/const hasPoint = !!d && d\.point_estimate !== null;/.test(page),
    'hasPoint 只能看端点的 point_estimate 一个字段');
});

test('★③ 给基率那一屏必须标注「历史基率，不是任何人的判断」', () => {
  assert.ok(page.includes('这个数是历史基率'), '缺「这个数是历史基率」标注');
  assert.ok(page.includes('不是任何人的判断'), '缺「不是任何人的判断」标注');
  // 该标注必须与点估计**同一屏**（不是折叠、不是详情）
  const at = page.indexOf('这个数是历史基率');
  const fold = page.indexOf('<details');
  assert.ok(fold === -1 || at < fold, '标注不许藏在 <details> 里（同一屏必须看得见）');
});

test('★④ 取不到的东西显示「取不到」，不许显示 0 / 占位数', () => {
  assert.ok(page.includes('取不到'), '缺「取不到」文案');
  // 区间缺失那一支不得把 null 渲染成 0
  assert.equal(/interval[?!]?\[0\]|lo \?\? 0|hi \?\? 0|\?\? 0\)/.test(page), false,
    '区间端点不许用 0 兜底（0 会被读成"测了是 0"）');
  // 三个状态值都要有独立的空态分支
  for (const s of ['enough', 'too_thin', 'no_rows']) {
    assert.ok(page.includes(s), '页面未处理状态 ' + s);
  }
});

test('★⑤ 三态在界面上是三句不同的话（不许说成同一句）', () => {
  const thin = page.match(/'too_thin'[^\n]*/g) || [];
  const none = page.match(/'no_rows'[^\n]*/g) || [];
  assert.ok(thin.length >= 1 && none.length >= 1, '两态都要有独立分支');
  assert.ok(page.includes('一道这种题都没有'), 'n=0 那句必须是「账本里一道这种题都没有」');
  assert.ok(page.includes('只能记方向'), '薄样本那句必须是「只能记方向」');
  // 两句都别混进对方的意思
  assert.equal(/一道这种题都没有[^'"\n]*只能记方向/.test(page), false, '「一道都没有」那句里混进了「只能记方向」');
  assert.equal(/只能记方向[^'"\n]*一道这种题都没有/.test(page), false, '「只能记方向」那句里混进了「一道都没有」');
});

test('⑥ 禁词：页面与 App 不含那两个字', () => {
  for (const [name, src] of [['BaselinePage', page], ['App', app]]) {
    assert.equal(src.indexOf('预测'), -1, name + ' 出现禁词');
  }
});

test('⑦ 页面有实挂路由（不是只写了组件没人渲染）', () => {
  assert.ok(/import BaselinePage from/.test(app), 'App 未导入 BaselinePage');
  assert.ok(/<Route path="\/baseline" element=\{<BaselinePage \/>\} \/>/.test(app), '/baseline 未实挂 BaselinePage');
});
