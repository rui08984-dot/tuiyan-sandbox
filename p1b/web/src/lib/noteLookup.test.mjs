/**
 * 题源无历史闸（2026-09-28 · 缺陷三：选了账本里没有历史记录的题源，界面永远停在「在数…」）
 *
 * 【病象：两件不同的事被说成一件】
 *   后端 lookup 端点有**三种**返回形状（p1b/src/routes/disclosure.js）：
 *     ① 无 kind      → mode:'catalog'
 *     ② 账本有历史   → known:true  + base_rate:{n,hit,rate,enough,note}
 *     ③ 账本没这道题 → known:false + reason + hint，**根本没有 base_rate 这个键**
 *   而页面只读 `.base_rate`，从不看 `known`。落到 ③ 时：
 *     setAdvice({layer: undefined, engine: undefined, n: undefined}) —— 这是个
 *     **truthy 对象** ⇒ 面板照渲染：左数「—」、左注永远停在「在数…」、
 *     层名「—」、复选框 0 个，结论句还说「还没有同类已结算的题」。
 *   ⇒ 真相是「账本里一个这种题都没有」，界面说的是「有、但还没结算」。
 *     两件不同的事。后端把原话（reason/hint）放在响应里，页面从来没读过。
 *
 * 【实测可达面（本闸生成时只读盘上数据数过）】
 *   下拉可选 27 个 kind，「其他（尚未翻译的来源）」组为空；其中**恰好 1 个**
 *   （cwl_ssq_blue_odd_forward）在账本里一行都没有 ⇒ known:false 必现。
 *   数字不大，但命中即必现——没有"偶尔"，是选中就错。
 *
 * 【怎么验：禁新依赖（不许 jsdom / Testing Library）】
 *   判定抽成纯函数 lib/noteLookup.ts，组件只负责渲染；
 *   ①～⑥ 真 import 纯函数跑行为，⑦ 文本扫描只证明它**插上了**（插线是插线，行为是行为）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLookup, UNKNOWN_KIND_LINE, NO_SETTLED_LINE } from './noteLookup.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, '..', 'pages', 'NotePage.tsx'), 'utf8');
const lib = readFileSync(join(dir, 'noteLookup.ts'), 'utf8');
/* 接线扫描一律扫**去注释后**的源码：注释里要写清"旧代码曾经是 setAdvice({...})"，
   不去注释的话这闸会拿自己的说明文当罪证（同 note-form.test.mjs 的做法）。 */
const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 后端 ② 号形状（真形状，取自 p1b/src/routes/disclosure.js 的 lookup 分支） */
const KNOWN = {
  mode: 'lookup', kind: 'openmeteo_daily_max', known: true,
  base_rate: { n: 34, hit: 9, rate: 9 / 34, enough: true, note: '同类已结算 34 条，真发生 9 条（26.5%）' },
  suggestion: { layer: 'L2', engine: 'stat_baseline' },
  evidence: { total_n: 41, resolved_n: 34 },
};
/** 后端 ③ 号形状：known:false，**没有 base_rate 键** */
const UNKNOWN = {
  mode: 'lookup', kind: 'cwl_ssq_blue_odd_forward', known: false,
  reason: '账本历史中无此 kind 的题 ⇒ 无法给出参考（本门面只据历史推断，不编）',
  hint: '若这是新 kind：请先在接题页手工填写 checklist（新 kind 无历史可依，须人工判定）。',
};

test('★① known:false ⇒ base 为 null，且带上后端原话（不得凭空造层）', () => {
  const l = readLookup(UNKNOWN);
  assert.equal(l.known, false, '必须认出这是"账本里没有这类题"');
  assert.equal(l.base, null, '★没有 base_rate 就不许有 base（null 才是"没有"）');
  assert.equal(l.layer, undefined, '不得凭空给一个层（层名 — + 判据 0 个 = 编了一个不存在的层）');
  assert.equal(l.engine, undefined, '不得凭空给引擎');
  assert.equal(l.totalN, undefined, '不得凭空给样本量');
  assert.equal(l.reason, UNKNOWN.reason, 'reason 须是后端原文（前端不该自己编一套说法）');
  assert.equal(l.hint, UNKNOWN.hint, 'hint 须是后端原文');
});

test('★② 组件据此必须**整体不渲染**面板：advice 只能是 null，不能是全 undefined 的对象', () => {
  // 那个 truthy 空对象就是病根：它让 `{advice ? … : null}` 走进"有建议"分支
  const l = readLookup(UNKNOWN);
  const advice = l.known ? { layer: l.layer, engine: l.engine, n: l.totalN } : null;
  assert.equal(advice, null, 'known=false 时 advice 必须是 null（空对象是 truthy，正是旧病根）');
});

test('③ known:true ⇒ 正常投影 base_rate 与建议（不许被新分支误伤）', () => {
  const l = readLookup(KNOWN);
  assert.equal(l.known, true);
  assert.deepEqual(l.base, KNOWN.base_rate, 'base_rate 须原样带过来');
  assert.equal(l.layer, 'L2');
  assert.equal(l.engine, 'stat_baseline');
  assert.equal(l.totalN, 41);
});

test('④ base_rate 缺失或畸形 ⇒ base=null 但 known 仍为 true（不许把"读不出数"说成"没有这类题"）', () => {
  const noBr = readLookup({ mode: 'lookup', kind: 'x', known: true, suggestion: { layer: 'L1' }, evidence: { total_n: 2 } });
  assert.equal(noBr.known, true, '账本明明有这道题（有 suggestion/evidence），不得报成没有');
  assert.equal(noBr.base, null, '读不出频率就是 null（与 rate=0 严格区分）');
  const bad = readLookup({ mode: 'lookup', kind: 'x', known: true, base_rate: { n: '不是数' } });
  assert.equal(bad.known, true);
  assert.equal(bad.base, null, '畸形 base_rate 不得变成 NaN 混进界面');
});

test('★⑤ 坏响应不得被当成 known:true（HTTP 非 2xx 时 r.json() 给的是 null）', () => {
  for (const bad of [null, undefined, '', 0, [], 'oops']) {
    const l = readLookup(bad);
    assert.equal(l.known, false, JSON.stringify(bad) + ' 不得被当成有历史');
    assert.equal(l.base, null);
  }
  // 没有 known 键的老响应（字段缺失）也按"不敢说它有"处理
  assert.equal(readLookup({ mode: 'lookup', kind: 'x', base_rate: { n: 5, hit: 1, rate: 0.2, enough: false } }).known, false,
    'known 不为 true 就是不认（宁可少说，不可乱说）');
});

test('★⑥ 两句文案必须不同：账本里没有这类题 ≠ 有但还没结算', () => {
  assert.ok(UNKNOWN_KIND_LINE && String(UNKNOWN_KIND_LINE).trim(), '不得空白');
  assert.ok(NO_SETTLED_LINE && String(NO_SETTLED_LINE).trim(), '不得空白');
  assert.notEqual(UNKNOWN_KIND_LINE, NO_SETTLED_LINE, '★两句话一样＝还是把两件事说成一件');
  // 判据：没有这类题时不该出现"结算"字样（那正是在说另一件事）
  assert.equal(/结算/.test(UNKNOWN_KIND_LINE), false, '「账本里没有这类题」不该提结算：' + UNKNOWN_KIND_LINE);
  // 诚实线：两句话都不得含结论词（样本都没有，不许谈乐观/保守）
  for (const s of [UNKNOWN_KIND_LINE, NO_SETTLED_LINE]) {
    assert.equal(/乐观|保守/.test(s), false, '不得出现结论词：' + s);
  }
});

test('★⑦ 接线：NotePage 真读了 known/reason/hint，且不再无条件 setAdvice', () => {
  // ★文本扫描只证明"插上了"，不证明行为——行为在 ①～⑥。
  assert.ok(/import\s*\{[^}]*readLookup[^}]*\}\s*from\s*'\.\.\/lib\/noteLookup'/.test(code),
    'NotePage 未 import readLookup（纯函数对、页面不接＝白修）');
  assert.equal(/setAdvice\(/.test(code), false,
    'setAdvice 必须退休：它是无条件 set 的，"全 undefined 的 truthy 对象"就是从那儿来的');
  assert.ok(/lookup\s*&&\s*lookup\.known/.test(code), 'advice 必须由 lookup.known 把关（否则空对象又回来了）');
  assert.ok(/lookup\s*&&\s*!lookup\.known/.test(code), '必须有 known=false 的独立分支（显示后端给的理由）');
  assert.ok(/\{lookup\.reason\}/.test(code), '必须把后端的 reason 原文显示出来（它一直在响应里没人读）');
  // 结论句也要能说这两件事
  assert.ok(/UNKNOWN_KIND_LINE/.test(code), 'verdictText 须用 UNKNOWN_KIND_LINE（不得自己另编一句）');
  assert.ok(/if \(!known\)/.test(code), 'verdictText 须判 known 分支');
});

test('⑧ 禁词：纯函数与两句文案都不许夹带「预测」', () => {
  const all = lib + UNKNOWN_KIND_LINE + NO_SETTLED_LINE;
  assert.equal((all.match(/预测/g) || []).length, 0, '不得含禁词');
});
