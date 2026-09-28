/**
 * 归档环闸（2026-09-28 · T9）
 *
 * 【为什么这道闸要紧】
 * 单题页最容易出的两类错，两类都**不会让页面崩**，只让它说错话：
 *   ① 把「当时没给数」渲染成 0 —— 0 是"测了是 0"，空是"没测"。混同即编造。
 *   ② 把真值口径被排除的行当普通行显示 —— 那条真值取自事件发生**之前**的预报，
 *      和事后观测长得一模一样，不标出来就等于把两种东西当同一种。
 * 所以本闸锁的不是"页面存在"，是**它不许说错的那几句话**。
 *
 * 锁的事：
 *   ① 六段齐全且顺序固定（题面 → 你的数 → 引擎的数 → 真值 → 判分 → 现在的看法）
 *   ② ★真值口径排除：警示块全页最重、排在最前，且带可核对的指纹与冻结计数
 *   ③ ★null 不渲染成 0（三个 null 分支：你的数 / 基率 / 真值）
 *   ④ ★n<30 降对比 +「只能记方向」，且差值句**不给方向性结论词**
 *   ⑤ ambiguous ⇒ 不判分；不给总分、不说"准不准"
 *   ⑥ ★375 硬约束：单列、不横向滚动（全文件无 nowrap、长文本一律可断行）
 *   ⑦ ★禁词：页面源码与样式零命中
 *   ⑧ ★只读零写：本页不含任何 POST/PUT/DELETE
 *   ⑨ 路由接线 + 五个未使用 import 已清（tsc 曾报 5 条 TS6133）
 *  ⑩ 入口页给的是**真 id**（不许给聚合行编 id）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'pages', 'QuestionPage.tsx'), 'utf8');
const css = readFileSync(join(dir, 'styles', 'question.css'), 'utf8');
const app = readFileSync(join(dir, 'App.tsx'), 'utf8');
const whereoff = readFileSync(join(dir, 'pages', 'WhereOffPage.tsx'), 'utf8');

/* 把页面的纯函数**真代码**取出来直接调（esbuild 转译，零新依赖——它已随 vite 在盘上）。
 * 为什么非做不可：源码断言测不出"函数算错了"，只测得出"函数被写了"。
 * 这里不手抄实现——手抄的那份通过，不等于页面在跑的那份通过。 */
const require_ = createRequire(import.meta.url);
let _mod = null;
function loadPct() {
  if (_mod) return _mod.pct;
  const esbuild = require_(join(dir, '..', 'node_modules', 'esbuild'));
  const code = esbuild.transformSync(page, { loader: 'tsx', format: 'cjs', target: 'es2020' }).code;
  const mod = { exports: {} };
  // 运行期依赖全部打桩：本闸只用它的纯导出，不渲染任何 React
  const stub = `const React={createElement:()=>null,Fragment:'F'};
    const Link='L',useParams=()=>({}),useState=()=>[null,()=>{}],useEffect=()=>{};
    const Wait='W',IconAlert='A',IconArrow='R',kindLabel=(k)=>({label:k});`;
  new Function('module', 'exports', 'require', stub + '\n' + code.replace(/^"use strict";/, ''))(
    mod, mod.exports, () => ({}));
  _mod = mod.exports;
  return _mod.pct;
}

test('① 六段齐全且顺序固定（次序是契约，不是排版偏好）', () => {
  const m = /export const STAGES = \[([^\]]+)\]/.exec(page);
  assert.ok(m, '未导出 STAGES 顺序常量');
  const stages = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(stages, ['题面', '你的数', '引擎的数', '真值', '判分', '现在的看法'],
    '六段的名字或顺序变了——一道题的一生是有先后的，顺序即语义');
  // 六段各自都要有可被测试定位的锚点
  for (let i = 0; i < 6; i++) {
    assert.ok(page.includes('data-testid="q-st-' + i + '"'), '第 ' + i + ' 段缺 data-testid');
  }
  assert.ok(page.includes('className="qline"'), '须是竖排时间线（ol.qline），不是卡片网格');
});

test('★② 真值口径排除：警示块全页最重、排在时间线之前、且可核对', () => {
  assert.ok(page.includes('本题真值口径被排除统计'), '警示标题缺失（这是全页最要紧的一句）');
  assert.ok(page.includes('data-testid="q-flag"'), '警示块须可被测试定位');
  assert.ok(page.includes('role="alert"'), '警示须能被读屏软件播报');
  // 判据与可复核指纹：禁静默丢
  assert.ok(page.includes('truth_basis.rule'), '须展示判定口径（凭什么被排除）');
  assert.ok(page.includes('fingerprint_sha256'), '须展示排除集指纹（可复核）');
  assert.ok(page.includes('n_excluded_at_freeze'), '须展示冻结时的排除计数');
  // ★排位：警示块必须在 <ol className="qline"> 之前（排在时间线之后就"不显著"了）
  assert.ok(page.indexOf('data-testid="q-flag"') < page.indexOf('className="qline"'),
    '★警示块必须排在时间线之前——排在后面等于没标');
  // 真值那一段也要带标记（脱离首屏滚到真值时仍看得见）
  assert.ok(page.includes('口径被排除，不计入读数'), '真值节点须自带排除标记');
  // ★不隐藏：被排除的行照常展示题面与真值
  assert.ok(/d\.truth_basis\.excluded \? \(/.test(page), '排除标记必须是条件渲染，不是整页替换');
  assert.ok(page.includes('{d.statement}'), '题面无条件渲染（排除口径不等于藏起这道题）');
});

test('★③ null 一律不渲染成 0（0 是"测了是 0"，空是"没测"）', () => {
  // 你的数
  assert.ok(page.includes("d.assigned_prob === null ? ("), '你的数须判 null 分支');
  assert.ok(page.includes('当时没给数'), 'null 须说"当时没给数"');
  assert.ok(page.includes('这不是 0'), '须明说"不是 0"');
  // 基率
  assert.ok(page.includes('!d.base_rate ? ('), '基率须判 null 分支');
  assert.ok(page.includes('这道题没有基率读数'), 'null 基率须如实说明');
  assert.ok(page.includes('不是 0%，是'), '须明说"不是 0%"');
  // 真值
  assert.ok(page.includes("d.outcome ? TRUTH_WORD[d.outcome] : '还没揭晓'"),
    '★真值未结算须显示「还没揭晓」，不得落进 TRUTH_WORD 兜底成某个结果');
  /* ★pct 直接跑真函数（esbuild 转译后 import，NotePage 的 verdictText 同款做法）：
     只有源码断言不够——把 null 写成 0% 完全可以发生在模板里而不碰这个函数。 */
  const pct = loadPct();
  assert.equal(pct(null), '—', '★pct(null) 必须是「—」');
  assert.equal(pct(undefined), '—', '★pct(undefined) 必须是「—」');
  assert.equal(pct(0), '0.0%', 'pct(0) 必须是 0.0%——0 是"测了是 0"，它有权显示成 0');
  assert.equal(pct(0.4502), '45.0%', 'pct 须按百分比一位小数');
});

test('★④ n<30：降对比 +「只能记方向」，且差值句不给方向性结论词', () => {
  assert.ok(page.includes('is-thin'), '薄样本须有降对比的 class（隐藏＝像没算过，标红＝被当基线）');
  assert.ok(page.includes('只能记方向'), '须含「只能记方向」（与后端/编译器门面同一句式）');
  // 差值句：两态都要判（基率缺失 → 无差值；样本不足 → 有限定语）
  const g = page.slice(page.indexOf('export function gapLine'), page.indexOf('export function gapLine') + 900);
  assert.ok(/yours === null \|\| !br/.test(g), 'gapLine 须先判「没有可比对象」（基率缺失时不编差值）');
  assert.ok(/br\.enough \? '' :/.test(g), 'gapLine 须判基率样本是否够（enough 决定限定语给不给）');
  // ★样本不足时限定语必须和差值在同一条里——隔一段写，读者只会读到差值
  assert.ok(/br\.enough \? ''[\s\S]{0,240}只能记方向/.test(g),
    '★样本不足时限定语必须和差值在同一条里——隔一段写，读者只会读到差值');
  // ★两个分支都要挂：差 0.00 同样可能是 n=16 的巧合，漏掉这一支＝给"最像结论的读数"免了标注
  const branches = [...g.matchAll(/return\s+`([^`]*)`/g)].map((m) => m[1]);
  assert.ok(branches.length >= 2, '差值句须有「几乎一样」与「高低」两个分支，实得 ' + branches.length);
  assert.ok(branches.every((b) => b.includes('${tail}')), '★两个分支都必须拼上 tail（薄样本限定语）');
  // ★方向性结论词：两个分支都不许出现"乐观/保守/更准/更靠谱"
  for (const b of branches) {
    assert.equal(/乐观|保守|更准|更靠谱|高估|低估/.test(b), false,
      '★样本不足的文案不得出现方向性结论词——那是拿噪音当结论：' + b);
  }
  assert.ok(g.includes("'高'") && g.includes("'低'"), '差值句须说方向（高/低）');
});

test('⑤ ambiguous 不判分；不给总分、不说"准不准"', () => {
  // ★只取 nowView 的函数体：往后多切会把下一个函数一并吞进来，误报
  const v = page.slice(page.indexOf('export function nowView'), page.indexOf('/** 真值节点的状态类'));
  assert.ok(v.includes("=== 'ambiguous'"), 'nowView 须单独判 ambiguous');
  assert.ok(/ambiguous[\s\S]{0,220}不判分/.test(v), '★ambiguous 必须明说不判分');
  assert.ok(v.includes('=== null'), '未结算须单独判（不与 ambiguous 混）');

  /* ★裁决词禁令，逐条**字符串字面量**判（不要整段正则剥——跨语句的贪婪匹配会吃掉隔壁整句）。
     规则：一条话里若出现裁决词，同一条里必须同时出现免责标记。
     「不给这种话」这类**免责句**里提到"准不准"是允许的，禁的是**断言**。 */
  const NEG = ['不给', '不构成', '不是', '只是猜测', '下裁决'];
  const VERDICT = ['总分', '准不准', '打分', '评分', '准确率', '评级', '得分'];
  const claims = [...v.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const bad = claims.filter(
    (s) => VERDICT.some((w) => s.includes(w)) && !NEG.some((n) => s.includes(n)),
  );
  assert.deepEqual(bad, [], '「现在的看法」断言了裁决：\n' + bad.join('\n'));

  // 页面里那句自陈也要在
  assert.ok(page.includes('本页不给总分'), '须显式声明不给总分');
});

test('★⑥ 375 硬约束：单列 + 不横向滚动', () => {
  // ★先剥注释：纪律注释里会**提到**这些词（"任何 nowrap 都会…"），
  //   不剥就会把"我们禁止它"的那句话判成"我们用了它"。
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // ① 全文件无 nowrap（任何一处 nowrap 在 375 上都会顶出横向滚动条）
  assert.equal(/nowrap/.test(rules), false, '★样式规则里不得出现 nowrap——375 上必然横向滚动');
  // ② 长文本可断行（题面 / 判词 / 注记 / 机器 id）
  assert.ok(rules.includes('overflow-wrap: anywhere'), '长文本须可断行');
  assert.ok(page.includes('q-statement'), '题面有独立 class（可被样式锁定断行）');
  assert.ok(page.includes('q-verdict-text'), '判词有独立 class（判词是整页最长的文本）');
  // ③ 窄屏单列
  assert.ok(/@media \(max-width: 480px\)/.test(rules), '须有 480 断点（375 落在其内）');
  // ④ 轨道绝对定位（不占布局宽度）
  assert.ok(/\.qline-node::before[\s\S]{0,160}position:\s*absolute/.test(rules),
    '时间线轨道须绝对定位——参与布局会在窄屏把内容挤窄');
  // ⑤ 容器不撑破：轨道内缩
  assert.ok(/@media \(max-width: 480px\)[\s\S]*?padding-left/.test(rules), '窄屏须收窄轨道内衬');
  // ⑥ 全站没有本页引入的横向滚动容器
  assert.equal(/\.qpage[^{]*\{[^}]*overflow-x:\s*auto/.test(rules), false, '本页不得引入横向滚动容器');
});

test('★⑦ 禁词：页面源码与样式零命中', () => {
  for (const [name, text] of [['QuestionPage.tsx', page], ['question.css', css]]) {
    const n = (text.match(/预测/g) || []).length;
    assert.equal(n, 0, name + ' 出现禁词 ' + n + ' 次');
  }
});

test('★⑧ 只读零写：本页不含任何写请求', () => {
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of ["method: 'POST'", "method: 'PUT'", "method: 'DELETE'", "method: 'PATCH'"]) {
    assert.equal(code.includes(m), false, '单题页不得发写请求: ' + m);
  }
  assert.equal(/fetch\(\s*'[^']*'[\s\S]{0,80}?,\s*\{/.test(code), false,
    '★不得给 fetch 传第二参数（method/body）——只读端点不需要');
});

test('⑨ 路由接线 + 五个未使用 import 已清', () => {
  assert.ok(app.includes("from './pages/QuestionPage'"), '未导入 QuestionPage');
  assert.ok(/<Route path="\/question\/:id" element=\{<QuestionPage \/>\}/.test(app), '未注册 /question/:id');
  // ★tsc 曾报的 5 条 TS6133：逐个锁死"不许回来"
  for (const dead of ['OverviewPage', 'AuditPage', 'IntakePage', 'CalendarPage', 'CompilerPage']) {
    assert.equal(new RegExp("import\\s+[A-Za-z]*\\s*\\{?\\s*" + dead).test(app), false,
      dead + ' 的 import 回来了（组件早已不渲染，tsc 会再报 TS6133）');
  }
  // ★但旧路径的 Route 必须还在（删 import ≠ 删路由，删路由会破书签）
  for (const p of ['/overview', '/audit', '/intake', '/calendar', '/compiler']) {
    assert.ok(app.includes('path="' + p + '"'), '旧路径 ' + p + ' 消失（书签会断）');
  }
});

test('⑩ ★入口页给的是真 id：不给聚合行编 id', () => {
  assert.ok(whereoff.includes("'/api/disclosure/resolve-queue'"), '须从后端取真实题 id');
  assert.ok(whereoff.includes("to={'/question/' + row.id}"), '链接须用后端给的 row.id');
  assert.ok(whereoff.includes('data-testid="wo-questions"'), '单题入口段须可被测试定位');
  // ★偏流条/习惯/薄格三处是 layer×domain 聚合，数据里没有题目 id ⇒ 不得挂 /question 链接
  const bias = whereoff.slice(whereoff.indexOf('const points'), whereoff.indexOf('const points') + 700);
  assert.equal(/\/question\//.test(bias), false,
    '★偏流条的数据是聚合格（无题目 id），挂 /question 链接就是编 id');
  const habits = whereoff.slice(whereoff.indexOf('const habits'), whereoff.indexOf('const habits') + 800);
  assert.equal(/\/question\//.test(habits), false, '★习惯聚合（无题目 id），不得挂 /question 链接');
  // 禁词同样覆盖这一页
  assert.equal((whereoff.match(/预测/g) || []).length, 0, 'WhereOffPage 出现禁词');
});
