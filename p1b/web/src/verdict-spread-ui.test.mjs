/**
 * 判词离散度闸（2026-09-28 · T10）
 *
 * 【病象：一张没有时间轴的图，被人读成了一条时间线】
 *   「同一道题换个问法，答案从 98% 摆到 45%」这件事**极易被画成折线**，
 *   而折线自带一个读者无法反驳的暗示：信念在随时间更新。
 *   可这批读数**根本没有时间轴**——实测 decouple9 批次全部 verdicts 行
 *   created_at 逐位相同（一次性批量写入）；另一类多读数题（pid=91 跨 20 个 run_id
 *   的 70 行）的 predictions.created_at 与 resolved_at 同秒，
 *   即重复读数全部产生于**真值已知之后**，中间没有任何"信息到达"事件。
 *   ⇒ 把横截面画成折线 = 用绘图手法暗示一个不存在的认知过程。
 *
 * 本闸锁的正是这几点：
 *   ① ★同屏两句话：横截面不是时间序列 / 测的是重测信度不是准头
 *      ——且**不许折叠**：折进 <details> 等于没写
 *   ② ★永不画折线（本节零 <svg>、零 polyline、零按 x=时间 排序的连线）
 *   ③ ★设计 9 路 ≠ 实测条数：row_count 实测 {7:1, 8:3, 9:1, 10:35}，
 *      写死「9 路」当成本题的条数就是撒谎
 *   ④ sd 为 null（n<2）时显式「—」，不补 0
 *   ⑤ 摆动幅度用「个百分点」不用「%」（0.94 是差值，不是水平）
 *   ⑥ 缺件 / 本题不在覆盖内 —— 两态分开说，且不拿别的题的数字顶
 *   ⑦ 375 单列不横滚
 *   ⑧ 禁词零命中（含后端 discipline 数组原文照登的那几行）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'pages', 'QuestionPage.tsx'), 'utf8');
const css = readFileSync(join(dir, 'styles', 'question.css'), 'utf8');
/* 后端 discipline 数组原文（p1b/sim/out/verdict-spread-20260922.json）——
   前端照登它，所以**它自己**也得过禁词闸。 */
const spreadFile = readFileSync(
  join(dir, '..', '..', 'sim', 'out', 'verdict-spread-20260922.json'), 'utf8');

/** 只取本节源码（从 qsp 容器到「现在的看法」节点之前），避免扫到别处的同名符号。
 *  再剥掉注释——纪律注释里会**提到**被禁的写法（"绝不用 <svg> 折线"），
 *  不剥就会把"我们禁止它"的那句话判成"我们用了它"。 */
const secRaw = page.slice(page.indexOf("className=\"qsp\""), page.indexOf('/* ⑥ 现在的看法 */'));
const sec = secRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

test('① ★同屏两句话，且不许折叠', () => {
  assert.ok(page.includes('这是单时刻横截面'), '缺「单时刻横截面」口径句');
  assert.ok(page.includes('不是时间序列'), '缺「不是时间序列」口径句');
  assert.ok(page.includes('重测信度'), '缺「重测信度」口径句');
  assert.ok(page.includes('不是判断的准头'), '缺「不是准头」口径句（它测什么、**不**测什么都要写）');
  // ★口径块必须在 qsp 容器之内、且位置靠前（紧跟标题，读者先看见它再看图）
  assert.ok(page.includes('data-testid="q-spread-rule"'), '口径块须可被测试定位');
  const secOpen = page.indexOf('data-testid="q-spread"');     // <section> 开口
  const ruleIdx = page.indexOf('data-testid="q-spread-rule"');
  const secEnd = page.indexOf('/* ⑥ 现在的看法 */');
  assert.ok(ruleIdx > secOpen, '★口径块必须在离散度这一节内（不能挪到页脚或别处）');
  assert.ok(ruleIdx < secEnd, '★口径块不得越出这一节');
  // ★不得折进 details/summary——折起来读者看不到，等于没写
  const ruleBlock = secRaw.slice(ruleIdx - secOpen, ruleIdx - secOpen + 900);
  assert.equal(/<details|<summary/.test(ruleBlock), false,
    '★口径块不得折进 details/summary——它必须常驻可见');
});

test('★② 永不画折线：本节零 svg / 零 polyline / 零连线', () => {
  assert.equal(/<svg|polyline|<path|<line\b/.test(sec), false,
    '★本节不得出现 svg/折线——横截面连成线就是凭空造一条时间轴');
  // 唯一允许的图形元素是"点"，且位置来自 values 里的概率值（不是来自时间/序号）
  assert.ok(sec.includes("style={{ left: (val * 100).toFixed(2) + '%' }}"),
    '点的横坐标必须由概率值决定（val×100%），不得由序号或时间决定');
  assert.ok(sec.includes('qsp-dot'), '点阵须有独立 class');
  assert.equal(/(时间|时刻|timestamp|created_at)[\s\S]{0,80}(sort|order)/.test(sec), false,
    '本节不得按时间排序——没有时间轴');
});

test('★③ 设计 9 路 ≠ 实测条数：两个数必须分开出现', () => {
  assert.ok(page.includes('const SPREAD_DESIGN_ROUTES = 9'), '设计路数须显式声明为常量');
  assert.ok(sec.includes('q.row_count'), '★必须显示**本题实测**的 row_count');
  assert.ok(sec.includes('SPREAD_DESIGN_ROUTES'), '设计路数须与实测条数同屏出现');
  // 两者之间要有"差多少"的说明，而不是含糊地只说 9
  assert.ok(sec.includes('重跑副本'), '条数不等于 9 时须说明多出来的是什么（重跑副本）');
});

test('④ sd 为 null（n<2）时显式「—」，不补 0', () => {
  assert.ok(sec.includes('v.sd === null'), '须判 sd 为 null 的情形');
  assert.ok(sec.includes('算不出'), 'null sd 须明说"算不出"');
  assert.ok(sec.includes("v.n < 2 ? '—'"), 'n<2 时摆动幅度须显示「—」');
  // 证据：真件里 sd 确实出现过 null
  assert.ok(/"sd":\s*null/.test(spreadFile), '披露件里存在 sd=null 的行（前提变了本闸要重写）');
});

test('⑤ 摆动幅度用「个百分点」，不用「%」冒充水平', () => {
  const fn = page.slice(page.indexOf('export function spreadWords'), page.indexOf('export function spreadWords') + 400);
  assert.ok(fn.includes('个百分点'), '须用「个百分点」');
  assert.equal(/`\$\{[^}]*\}%`/.test(fn), false, '★不得把差值渲染成「94%」——那是水平不是差值');
  assert.ok(fn.includes('null') || fn.includes('undefined'), 'null 须返回「—」');
});

test('⑥ 缺件与"本题不在覆盖内"必须分开，且不拿别的题顶', () => {
  assert.ok(page.includes("'missing'") && page.includes("'notin'"), '两态须分开存在');
  assert.ok(sec.includes('data-testid="q-spread-missing"'), '缺件态须可定位');
  assert.ok(sec.includes('data-testid="q-spread-notin"'), '不在覆盖内须可定位');
  assert.ok(sec.includes('不拿别的题的数字来顶'), '须明说不用别的题顶替');
  assert.ok(page.includes('qs.find((q) => q.pid === Number(id))'),
    '★必须按 pid 精确挑本题那一行');
  // 取不到就不画：notin/missing 态下不得有点阵
  const notinSeg = sec.slice(sec.indexOf("sp.s === 'notin'"), sec.indexOf("sp.s === 'ok'"));
  assert.equal(/qsp-axis/.test(notinSeg), false, '取不到本题时不得画点阵');
});

test('⑦ 375 单列、不横滚（点阵在窄屏仍可读）', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/nowrap/.test(rules), false, '★不得出现 nowrap');
  // 点阵行：桌面两列（名 + 轴），读数另起一行；窄屏进一步收窄
  assert.ok(/\.qsp-row[\s\S]{0,200}grid-template-columns/.test(rules), '点阵行须用 grid（可换行）');
  assert.ok(/\.qsp-rd[\s\S]{0,400}overflow-wrap:\s*anywhere/.test(rules), '读数行须可断行');
  assert.ok(/@media \(max-width: 480px\)[\s\S]*?\.qsp-row/.test(rules), '窄屏须单独处理点阵行');
  assert.equal(/\.qsp[^{]*\{[^}]*overflow-x:\s*auto/.test(rules), false, '本节不得引入横向滚动容器');
  // 读数各项须有可见分隔（10.5px 等宽字下靠空格会连读成一串）
  assert.ok(rules.includes("content: ' · '"), '读数各项须用可见分隔符隔开');
  // 顶栏是 sticky：锚点跳转时须让开，否则口径句会被压在头下
  assert.ok(/scroll-margin-top/.test(rules), '须设 scroll-margin-top 让开 sticky 顶栏');
});

test('⑧ 禁词：页面、样式、以及照登的 discipline 原文，全部零命中', () => {
  for (const [name, text] of [['QuestionPage.tsx', page], ['question.css', css],
    ['verdict-spread discipline', spreadFile]]) {
    const n = (text.match(/预测/g) || []).length;
    assert.equal(n, 0, name + ' 出现禁词 ' + n + ' 次');
  }
  // 纪律数组是**照登**的（口径单一真源，前端不另编）——锁住"照登"这件事本身
  assert.ok(sec.includes('sp.meta.discipline'), '★须原文照登后端 discipline 数组');
  assert.ok(sec.includes('q-spread-discipline'), '照登块须可被测试定位');
});

test('⑨ 端点不按 id 过滤：前端自挑，且只在有判词时才拉', () => {
  assert.ok(page.includes("fetch('/api/disclosure/verdict-spread')"), '须调只读端点');
  // ★省流：没有判词 ⇒ 构造上不可能有重复读数 ⇒ 不该白拉 33KB
  assert.ok(page.includes('d.verdict_count === 0'), '须以 verdict_count 为门槛决定是否拉取');
  const eff = page.slice(page.indexOf('fetch(\'/api/disclosure/verdict-spread\')') - 700,
    page.indexOf('fetch(\'/api/disclosure/verdict-spread\')'));
  assert.ok(eff.includes("if (!d || d.verdict_count === 0) return;"), '拉取前须提前返回');
  // 只读：不得给 fetch 传第二参数
  assert.equal(/verdict-spread'[\s\S]{0,80}?,\s*\{/.test(page), false, '★不得给该 fetch 传写参数');
});

test('⑩ ★界面文本里不得残留 markdown 星号（** 在 JSX 里是原样显示的）', () => {
  /* 病象（本轮真发生）：口径块里写了「所以下面**不画折线**」，
     React 把 ** 当普通字符渲染，读者在屏上直接看到两个星号。
     剥掉注释再查——注释里写 **bold** 说明是正常的。 */
  const code = page
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const bad = [...code.matchAll(/[^\n]*\*\*[^\n]*/g)].map((m) => m[0].trim());
  assert.deepEqual(bad, [], '这些行会被原样渲染到屏上（要强调请用 <b>）：\n' + bad.join('\n'));
});
