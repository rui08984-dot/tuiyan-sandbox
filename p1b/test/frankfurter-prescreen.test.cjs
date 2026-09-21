'use strict';
/**
 * p1b/test/frankfurter-prescreen.test.cjs —— frankfurter 预筛＋参数门两处缺陷的回归锁（2026-09-21）
 *
 * 被锁的两处修复（均在 `p1b/scripts/corpus-resolve-daemon.cjs`，修前＝git HEAD abf17e2 版本）：
 *   ① preScreen 的 frankfurter_rate_range 分支（源码 part p10）
 *      修前判据＝「窗口终点 date+7 已过」⇒ 过度保守：09-16 起、09-23 止的窗口在 09-21 被拦，
 *      但题面判据是「rates 键中 >= date 的最早一日」，只要**窗口内首个 ECB 发布日**已过即可判。
 *      实测：`2026-09-16..2026-09-23` ⇒ HTTP 200；`2026-09-23..2026-09-30` ⇒ HTTP 404（**起点**在未来）。
 *      修后＝「窗口内首个工作日（ECB 发布日节奏，周末顺延）≤ 今天」。
 *   ② paramGuard 的 frankfurter 分支（源码 part p7）
 *      修前直接查 r.base/r.quote ⇒ 账本里**旧字段名 from/to** 的题（实测 12 条，id 1957-1968）
 *      被当「base/quote 缺失」拦死；而 resolver（corpus-resolve.cjs:205-206）自己会归一化 from/to → base/quote，
 *      且安全门跑在归一化**之前** ⇒ 误拦。修后＝门内先做**同样的**归一化再检查。
 *
 * 取数方式（两函数均未 export，且**绝不可 require 本脚本**——文件尾 `main()` 自执行，会连生产库＋打网）：
 *   读源码 → 截到 `// ==== part p6a ====`（main/DB/网络全在切点之后）→ 把 `today()` 换成注入基准日 →
 *   用 new Function 取出 preScreen/paramGuard/firstWorkday。先例：l6-experiment-exclusion.test.cjs ⑤ 读源码接线锁。
 *
 * 跨日铁律：所有断言以**注入基准日**（BASE）为参照，不读系统今天；断言写死的是基准日与 fixture 的相对关系。
 * 本文件零网络、零库写入。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DAEMON = path.join(ROOT, 'p1b', 'scripts', 'corpus-resolve-daemon.cjs');

// ── 源码抽取锚（与 daemon 的段落注释严格一致；改了锚＝测试立刻炸，防「测试静默测空气」）──
const CUT = '// ==== part p6a ====';
const TODAY_DEF = "function today() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 10); }";

/** 从 daemon 源码抽出 preScreen/paramGuard/firstWorkday，today() 注入为 base（跨日可控） */
function extract(base) {
  const src = fs.readFileSync(DAEMON, 'utf8');
  const i = src.indexOf(CUT);
  assert.ok(i > 0, 'daemon 源码未找到切点 ' + CUT + '（段落结构变了？抽取锁失效）');
  assert.ok(src.indexOf(TODAY_DEF) >= 0, 'daemon 源码未找到 today() 定义原文（抽取锁失效，勿静默降级）');
  // 切掉 main()/DB/网络：这些全在 part p6a 之后
  let body = src.slice(0, i);
  body = body.replace(TODAY_DEF, 'function today() { return __TODAY(); }');
  // firstWorkday 是缺陷①修复时新增的：修前源码没有它。用 typeof 探测（对未声明变量安全），
  // 缺位时置 null ⇒ 让相关用例以**可读的断言失败**红掉，而非整文件加载崩溃（红得清楚、指向明确）。
  body += '\nmodule.exports = { preScreen: preScreen, paramGuard: paramGuard, firstWorkday: (typeof firstWorkday === "function") ? firstWorkday : null };';
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__TODAY', body)(
    mod, mod.exports, require, path.dirname(DAEMON), () => base
  );
  assert.equal(typeof mod.exports.preScreen, 'function', 'preScreen 抽取失败');
  assert.equal(typeof mod.exports.paramGuard, 'function', 'paramGuard 抽取失败');
  return mod.exports;
}

// ── 基准日：不写死「今天」，只写死 fixture 与基准日的相对关系 ──
// BASE=2026-09-21（周一）。下列 fixture 日期相对 BASE 的角色：
//   09-16/17/18（周三/四/五）＝过去的工作日；09-20（周日）＝过去的周日；09-23（周三）＝未来工作日。
const BASE = '2026-09-21';
const { preScreen, paramGuard, firstWorkday } = extract(BASE);

/** 与账本实测同形的 base/quote 代 spec（id 939：09-16..09-23） */
const SPEC_BQ = { kind: 'frankfurter_rate_range', base: 'USD', quote: 'CNY', date: '2026-09-16', date_plus7: '2026-09-23', threshold: 7.1076, cmp: '>=' };
/** 与账本实测同形的 from/to 代 spec（id 1957 逐字：**无 date_plus7**） */
const SPEC_FT = { kind: 'frankfurter_rate_range', from: 'USD', to: 'CNY', date: '2026-09-18', threshold: 6.7394, cmp: '<=' };

test('① 预筛放行：date=2026-09-16/17/18（首个发布日已过）⇒ 不拦', () => {
  for (const d of ['2026-09-16', '2026-09-17', '2026-09-18']) {
    const spec = Object.assign({}, SPEC_BQ, { date: d, date_plus7: '2026-09-23' });
    assert.equal(preScreen(spec), null, d + ' 首个发布日（含当日在内的最近工作日）已过 BASE=' + BASE + ' ⇒ 应放行');
  }
  // 修前（git HEAD abf17e2）此处返回「…尚未走完（接口对未来区间 404）」⇒ 本断言即回归锁
});

test('② 预筛放行：date=2026-09-20（周日）⇒ 顺延到 09-21 周一，不拦', () => {
  assert.equal(typeof firstWorkday, 'function',
    'firstWorkday 缺失（缺陷①修复被回退？该函数是修后新增的判据核心）');
  // 账本同形实测行：id 1965-1968 的 from/to spec，date=2026-09-20，**无 date_plus7**
  const spec = { kind: 'frankfurter_rate_range', from: 'USD', to: 'CNY', date: '2026-09-20', threshold: 6.7394, cmp: '<=' };
  assert.equal(firstWorkday('2026-09-20'), '2026-09-21', '09-20 是周日，首个工作日应顺延到 09-21（周一）');
  assert.equal(preScreen(spec), null, '顺延后的首个工作日 09-21 恰为 BASE ⇒ 不算未来 ⇒ 应放行');
  // ★边界语义：判据是 `fp > t`（严格大于）⇒ 首个发布日**恰为今天**放行（ECB 当日已发布）；
  //   若改成 >=，本用例与 12 条旧题（date 落在周末者）会一起被误拦。
  assert.equal(preScreen(Object.assign({}, spec, { date: '2026-09-21' })), null,
    '09-21 是周一（工作日）⇒ 首个发布日＝当日＝BASE，严格大于不成立 ⇒ 放行');
  // 反向对照（证明不是无条件放行）：未来工作日的窗口仍须拦
  assert.notEqual(preScreen(Object.assign({}, spec, { date: '2026-09-22' })), null,
    '反向对照：09-22（周二，未来工作日）⇒ 首个发布日 > BASE ⇒ 仍须拦');
  // 周末顺延的另一个方向：周六 → 顺延两个工作日到未来 ⇒ 拦
  assert.equal(firstWorkday('2026-09-19'), '2026-09-21', '09-19（周六）⇒ 顺延到 09-21');
  assert.equal(firstWorkday('2026-09-26'), '2026-09-28', '09-26（周六）⇒ 顺延跨周末到 09-28（周一）');
  assert.notEqual(preScreen(Object.assign({}, spec, { date: '2026-09-26' })), null,
    '09-26（周六）顺延到 09-28 > BASE ⇒ 须拦');
});

test('③ 预筛拦截：date=2026-09-23（首个发布日未来）⇒ 拦', () => {
  const spec = Object.assign({}, SPEC_BQ, { date: '2026-09-23', date_plus7: '2026-09-30' });
  const out = preScreen(spec);
  assert.notEqual(out, null, '09-23（周三，未来工作日）⇒ 首个发布日未到 ⇒ 必须拦（不得打网拿 404）');
  assert.ok(/首个发布日 2026-09-23 未到/.test(out), '拦截理由须点名未到的首个发布日，实得：' + out);
  // 无 date_plus7 的 from/to 旧题同样拦（修前用 date_plus7 判 ⇒ dateOf(undefined)='' ⇒ 静默放行）
  const ft = { kind: 'frankfurter_rate_range', from: 'USD', to: 'JPY', date: '2026-09-23', threshold: 159.09, cmp: '<=' };
  assert.notEqual(preScreen(ft), null, 'from/to 代无 date_plus7 的未来题也须拦（判据用 r.date，非 r.date_plus7）');
});

test('④ ★参数门放行：resolve 用 from/to 形态（无 base/quote）⇒ 放行（本次修复核心，修前会拦）', () => {
  const spec = { kind: 'frankfurter_rate_range', from: 'USD', to: 'CNY', date: '2026-09-18', threshold: 6.7394, cmp: '<=' };
  const out = paramGuard(spec);
  assert.equal(out, null, 'from/to 是账本旧代字段名，resolver 自己会归一化 ⇒ 门不该拦，实得：' + out);
  // 修前（git HEAD abf17e2）返回 'base/quote 缺失' ⇒ 12 条 id 1957-1968 被误拦，本断言即回归锁
  // 归一化副作用（门的注释承诺）：门后 r.base/r.quote 就位，解析器与标签读到的字段与取数地址一致
  assert.equal(spec.base, 'USD', '归一化副作用：r.base 应就位（下游 B3 兜底路径同样受益）');
  assert.equal(spec.quote, 'CNY', '归一化副作用：r.quote 应就位');
});

test('⑤ 参数门放行：base/quote 形态（向后兼容）⇒ 放行', () => {
  assert.equal(paramGuard(SPEC_BQ), null, 'base/quote 新代 spec 照常放行');
  assert.equal(paramGuard({ kind: 'frankfurter_rate', base: 'USD', quote: 'CNY', date: '2026-09-18', threshold: 7.0, cmp: '>=' }), null,
    'frankfurter_rate（单日）同分支，须一并放行');
  // 归一化不得覆盖已有 base/quote（from/to 仅在缺位时兜底）
  const both = { kind: 'frankfurter_rate_range', base: 'EUR', quote: 'GBP', from: 'USD', to: 'JPY', threshold: 1, cmp: '>=' };
  assert.equal(paramGuard(both), null);
  assert.equal(both.base, 'EUR', 'base 已存在 ⇒ from 不得覆盖');
  assert.equal(both.quote, 'GBP', 'quote 已存在 ⇒ to 不得覆盖');
  // 反向对照：两代字段都缺 ⇒ 仍须拦（不得因修复而放松成「无条件放行」）
  const none = { kind: 'frankfurter_rate_range', date: '2026-09-18', threshold: 1, cmp: '>=' };
  assert.notEqual(paramGuard(none), null, 'base/quote/from/to 全缺 ⇒ 仍须拦');
});

test('⑥ ★回归锁：paramGuard 的 frankfurter 分支必须包含归一化代码（防被改回）', () => {
  const src = fs.readFileSync(DAEMON, 'utf8');
  const START = "if (k === 'frankfurter_rate' || k === 'frankfurter_rate_range') {";
  const END = 'if (B3[k]) {';
  const a = src.indexOf(START), b = src.indexOf(END, a);
  assert.ok(a >= 0, '未找到 paramGuard 的 frankfurter 分支起点（分支被改名/删除？回归锁失效）');
  assert.ok(b > a, '未找到分支终点锚 ' + END + '（结构变了？）');
  const branch = src.slice(a, b);
  // 去注释后断言：防「归一化只写在注释里」的假修复
  const code = branch.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(/if\s*\(\s*!r\.base\s*&&\s*r\.from\s*\)\s*r\.base\s*=\s*r\.from\s*;/.test(code),
    '归一化 r.base = r.from 缺失（缺陷②被改回 ⇒ from/to 旧题会再被误拦 12 条）\n分支代码：\n' + code);
  assert.ok(/if\s*\(\s*!r\.quote\s*&&\s*r\.to\s*\)\s*r\.quote\s*=\s*r\.to\s*;/.test(code),
    '归一化 r.quote = r.to 缺失（同上）\n分支代码：\n' + code);
  // 且必须仍在「先归一化、后检查」的顺序（归一化写在缺失检查之后＝等于没修）
  const iNorm = code.search(/r\.base\s*=\s*r\.from/);
  const iCheck = code.indexOf('if (!r.base || !r.quote)');
  assert.ok(iCheck > iNorm, '归一化必须发生在「base/quote 缺失」检查**之前**（否则 from/to 仍被拦）');
});

test('⑦ 预筛锁：frankfurter_rate_range 判据必须是「首个工作日 vs 今天」，不得回退成 date_plus7', () => {
  const src = fs.readFileSync(DAEMON, 'utf8');
  const START = "if (k === 'frankfurter_rate_range') {";
  const a = src.indexOf(START);
  assert.ok(a >= 0, '未找到预筛的 frankfurter_rate_range 分支');
  const branch = src.slice(a, a + 600);
  assert.ok(/firstWorkday\s*\(\s*r\.date\s*\)/.test(branch), '预筛须用 firstWorkday(r.date) 算首个发布日（缺陷①被改回）');
  const code = branch.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // ★锁的是**判据表达式**本身：`fp > t` 中不得出现 date_plus7。
  //   修前病根＝`if (d10(r.date_plus7) > t) …`；修后 date_plus7 只允许出现在报错文案里（(r.date_plus7 || '')），
  //   故不能整段禁词，而要逐条判定「做判断的 if 条件」里没有它。
  const conds = code.match(/if\s*\([^)]*\)/g) || [];
  const dec = conds.filter((c) => /fp\s*>/.test(c));
  assert.equal(dec.length, 1, '应恰好有一条以首个发布日 fp 做比较的判据，实得 ' + JSON.stringify(dec));
  assert.ok(dec[0].indexOf('date_plus7') === -1, '预筛判据不得再依赖 r.date_plus7（修前病根；且 12 条旧题无此字段）：' + dec[0]);
  // 反向对照：锁必须真能咬住修前写法（把修前病根代码喂进来，断言应失败）
  const prefixBad = "if (k === 'frankfurter_rate_range') { if (d10(r.date_plus7) > t) return 'x'; }";
  const badConds = (prefixBad.replace(/\/\/[^\n]*/g, '').match(/if\s*\([^)]*\)/g) || []);
  assert.equal(badConds.some((c) => /fp\s*>/.test(c)), false,
    '对照：修前写法不含 fp 判据 ⇒ 上面 dec.length===1 的断言在修前必然失败（锁有效）');
});

test('⑧ ★跨日可证：换一个注入基准日，判定随之翻转（证明基准日真被注入、测试不读系统今天）', () => {
  // 同一个 fixture（date=09-16，周三），只把基准日从 09-21 挪到 09-15（周二）：
  // 09-16 > 09-15 ⇒ 首个发布日变成「未来」⇒ 判定必须由「放行」翻转为「拦」。
  // 若基准日注入失效（真去读系统今天），本断言在 09-16 之后的任何一天都会失败 ⇒ 跨日铁律可证。
  const past = extract('2026-09-15');
  const spec = { kind: 'frankfurter_rate_range', base: 'USD', quote: 'CNY', date: '2026-09-16', date_plus7: '2026-09-23', threshold: 7.1076, cmp: '>=' };
  assert.equal(preScreen(spec), null, '对照：BASE=09-21 时 09-16 放行');
  const out = past.preScreen(spec);
  assert.notEqual(out, null, 'BASE=09-15 时 09-16 应被拦（证明基准日确实注入生效）');
  assert.ok(/首个发布日 2026-09-16 未到/.test(out), '拦截理由应点名 09-16，实得：' + out);
  // 参数门与基准日无关（它只看字段形态）：两代 spec 在任一日都应放行
  assert.equal(past.paramGuard(spec), null, 'base/quote 形态在 BASE=09-15 亦放行');
  assert.equal(past.paramGuard({ kind: 'frankfurter_rate_range', from: 'USD', to: 'CNY', date: '2026-09-18', threshold: 1, cmp: '<=' }), null,
    'from/to 形态在 BASE=09-15 亦放行');
});
