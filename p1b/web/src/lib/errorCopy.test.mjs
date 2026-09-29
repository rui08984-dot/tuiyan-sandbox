/**
 * errorCopy.test.mjs —— 「文案映射来自 exitMap.cjs，不另写一份」的机械锁（SPEC-error-ux · M1）
 *
 * 【为什么这个文件是本模块的**主**测试，而不是附属的】
 *   `errorCopy.ts` 在浏览器里跑，**不能** import `p1b/mcp/exitMap.cjs`——
 *   实测两条都撞墙：tsc 报 TS7016；vite 产物在 import 时抛 `path.join is not a function`
 *   （exitMap → toolTable → cli/commands 顶层跑 `path.join(__dirname, …)`，浏览器里 path 是空对象）。
 *   于是「数据源单一」不能靠 import 维持，只能靠**本文件把两边对在一起**：
 *   这里在 Node 里 import **真的** exitMap，遍历整个码空间，断言——
 *     ① 每个码都有中文文案 ＋ hint ＋ 下一步，一个都不许空；
 *     ② exitMap 能产出的每个 gate 都有**自己**的句子（不许悄悄落到兜底）；
 *     ③ `hint` 是 exitMap 那句**原样透传**，不是本文件另写一遍；
 *     ④ exit 3 的三条铁律：isError 仍是 false、标了别重试、文案不含「重试就能好」。
 *
 *   ⇒ 有人改了 exitMap 的分类却忘了 errorCopy，本文件报红。这就是「单一数据源」的落地形态。
 *
 * 只读，不写任何文件，不起服务，不碰数据库。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeHttp } from './errorCopy.ts';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { copyForMapped, gateCopy, ERROR_UNKNOWN_TITLE } from './errorCopy.ts';

const dir = dirname(fileURLToPath(import.meta.url));
// ★在 Node 里 require 真 exitMap —— 浏览器不能做这件事，测试里可以，也**必须**可以，
//   否则这份锁就退化成「照着自己抄的表检查自己抄的表」。
const require = createRequire(import.meta.url);
const exitMap = require(join(dir, '..', '..', '..', 'mcp', 'exitMap.cjs'));

/** 遍历整个码空间：0–9（含未登记的 5–9）、被信号杀的 null、exit 2 的两种来源。 */
function 全码空间() {
  const 案 = [];
  for (let code = 0; code <= 9; code++) {
    案.push({ toolName: 'p1b_doctor_board', exit: code, stderr: '' });
  }
  // exit 2 的两种读法：带确认标记 ⇒ 闸在工作；不带 ⇒ 用法错
  案.push({ toolName: 'p1b_gate_anchor', exit: 2, stderr: '确认执行请加 --确认\n将要执行：anchor-gate.cjs --a' });
  案.push({ toolName: 'p1b_gate_anchor', exit: 2, stderr: '✗ 缺位置参数：<path>' });
  案.push({ toolName: 'p1b_gate_anchor', exit: null, stderr: '', signal: 'SIGTERM' });
  return 案;
}

const 码空间 = 全码空间();

test('① ★逐码覆盖：每个退出码都有中文文案 ＋ hint ＋ 下一步，一个都不许空', () => {
  for (const r of 码空间) {
    const c = copyForMapped(exitMap.mapExit(r));
    const 标 = 'exit=' + r.exit + (r.stderr ? ' stderr=' + JSON.stringify(r.stderr.slice(0, 6)) : '');
    for (const 键 of ['title', 'next', 'hint']) {
      assert.equal(typeof c[键], 'string', 标 + ' 的 ' + 键 + ' 不是字符串');
      assert.ok(c[键].trim().length > 0, 标 + ' 的 ' + 键 + ' 是空白——空白等于没改');
    }
    // 禁词：铁律①，全项目口径
    assert.equal(/预测/.test(c.title + c.next + c.hint), false, 标 + ' 文案含禁词「预测」');
  }
});

test('② ★数据源唯一：exitMap 能产出的每个 gate 都有自己那句，不许落到兜底', () => {
  const 门 = new Map();
  for (const r of 码空间) {
    const m = exitMap.mapExit(r);
    const g = (m.structuredContent.verdict && m.structuredContent.verdict.gate)
      || (m.isError === false ? 'OK' : '(无)');
    门.set(g, (门.get(g) || 0) + 1);
  }
  // 先证明这把锁**有对象**：真扫出了多个不同 gate（恒真的锁等于没有锁）
  assert.ok(门.size >= 5, '★扫出的 gate 太少，本文件可能已失效（退化成恒真）。实际：' + JSON.stringify([...门]));

  for (const g of 门.keys()) {
    if (g === '(无)') continue;                 // exitMap 没给任何裁决 ⇒ 本就该落兜底
    const c = gateCopy(g);
    assert.ok(c.title.trim().length > 0, 'gate ' + g + ' 没有文案');
    // ★CHILD_EXIT 是 exitMap 自己就定义成「未登记的码」的兜底支，它的句子与兜底同义，
    //   属刻意设计；其余每一个 gate 都必须有**专属**句子，否则就是悄悄漏了新 gate。
    if (g === 'CHILD_EXIT') continue;
    assert.notEqual(c.title, ERROR_UNKNOWN_TITLE,
      '★gate ' + g + ' 落到了兜底文案——exitMap 新增了裁决而 errorCopy 没跟上');
  }
});

test('③ ★hint 是 exitMap 那句原样透传，不另写一遍', () => {
  let 验过 = 0;
  for (const r of 码空间) {
    const m = exitMap.mapExit(r);
    const 原 = m.structuredContent.hint;
    if (typeof 原 !== 'string' || 原.trim() === '') continue;
    验过++;
    assert.equal(copyForMapped(m).hint, 原,
      '★hint 必须原样透传 exitMap 的那句（数据源在它那儿），不许在这里重写');
  }
  assert.ok(验过 >= 6, '★只验到 ' + 验过 + ' 条 hint——样本太少，本条断言可能形同虚设');
});

test('③b exitMap 没给 hint 时也不许空白（兜底必须说清自己是兜底）', () => {
  const c = copyForMapped(exitMap.mapExit({ toolName: 'p1b_doctor_board', exit: 0, stderr: '' }));
  assert.ok(c.hint.trim().length > 0, '成功通道没有 hint 时也要给一句');
  assert.match(c.hint, /没有给出更多说明/, '兜底必须说清「后端没这么说」，否则会被读成后端真这么说的');
});

test('④ ★★exit 3：门禁码走成功通道，文案不许把它说成「坏了」', () => {
  const m = exitMap.mapExit({ toolName: 'p1b_gate_anchor', exit: 3, stderr: '' });
  assert.equal(m.isError, false, '前置事实：exit 3 在 exitMap 里就是 isError:false');
  const c = copyForMapped(m);
  assert.equal(c.isError, false, '★errorCopy 不许把 isError 覆写成 true——抹平它等于删掉结论');
  assert.equal(c.doNotRetry, true, '★do_not_retry 必须照实带出来');
  // spec 点名的那一句，逐段验
  assert.match(c.title, /门禁给出了结论/);
  assert.match(c.title, /不是程序坏了/);
  assert.match(c.title, /别重试/);
  assert.match(c.next, /重试.*算错|别重试|照门禁说的处理/);
  // ★不许出现「重试一下就好」这类把裁决说成故障的措辞
  assert.equal(/重试.{0,4}(就好|即可|可能|也许)/.test(c.title + c.next), false,
    '★不许把门禁裁决说成「重试一下就好」：' + c.title);
});

test('④b exit 2 两种来源文案不同（闸在工作 ≠ 用法错）', () => {
  const 闸 = copyForMapped(exitMap.mapExit({ toolName: 'p1b_gate_anchor', exit: 2, stderr: '确认执行请加\n将要执行：x' }));
  const 错 = copyForMapped(exitMap.mapExit({ toolName: 'p1b_gate_anchor', exit: 2, stderr: '✗ 缺位置参数' }));
  assert.notEqual(闸.title, 错.title, '★两个都是 2，但语义相反，文案不许一样');
  assert.match(闸.title, /已被拦下，什么都没执行/);
  assert.match(闸.next, /--确认/);
  assert.equal(闸.isError, false, '确认闸拦下时子进程一次都没起 ⇒ 不是失败');
  assert.equal(错.isError, true, '用法错才是错误');
});

test('⑤ 反向锁：喂一个码表里没有的裁决 ⇒ 是兜底文案，不是空白', () => {
  const c = copyForMapped({ isError: true, structuredContent: { verdict: { gate: 'SOME_FUTURE_GATE' } } });
  assert.equal(c.title, '后端报错了。这不是你操作的问题。');
  assert.ok(c.next.trim().length > 0);
  assert.ok(c.hint.trim().length > 0);
  // 连结构都没有（后端没给结构化结果）也照样不许空白
  const 空 = copyForMapped(null);
  for (const k of ['title', 'next', 'hint']) assert.ok(空[k].trim().length > 0, 'null 输入的 ' + k + ' 空白');
  assert.equal(空.isError, true, '拿不到结构化结果时按错误处理，不许假装没事');
});

test('⑥ ★本模块不许自己 import 那份 Node 数据源（实测会白屏，故由本文件锁）', () => {
  const src = readFileSync(join(dir, 'errorCopy.ts'), 'utf8');
  assert.equal(/from\s+['"][^'"]*mcp\/exitMap/.test(src), false,
    '★errorCopy.ts 不许 import p1b/mcp/exitMap.cjs：tsc 会 TS7016，vite 产物 import 即抛 path.join');
  assert.equal(/\brequire\s*\(/.test(src), false, '浏览器模块里不许出现 require');
  assert.equal(/预测/.test(src), false, '禁词：全文不得出现「预测」');
});

// ══════════════════════════════════════════════════════════════════
// ★describeHttp：HTTP 状态码 → 人话（2026-09-29 接线时补）
//   这段的重要性：★在此之前 errorCopy.ts 零调用＝死代码，用户看不到任何一条文案。
//   接在 api.ts 的抛错处（唯一收口）⇒ 一处改动全部页面的 e.message 受益。
// ══════════════════════════════════════════════════════════════════

test('⑦ 逐状态码都有文案 ＋ 下一步，一个都不许空', () => {
  for (const s of [0, 400, 401, 403, 404, 409, 413, 429, 500]) {
    const c = describeHttp(s, '后端原话');
    assert.ok(c.title && c.title.length > 4, s + ' 缺一句话结论');
    assert.ok(c.next && c.next.length > 4, s + ' 缺下一步（★没有下一步时写清「没有」，不留空让人猜）');
    assert.ok(c.hint && c.hint.length > 0, s + ' hint 不得为空');
  }
});

test('⑦b ★「连不上」与「服务器答错了」必须是两句话', () => {
  // 混成一句 ⇒ 用户会去刷新一个根本连不上的页面，而那永远刷不好
  assert.notEqual(describeHttp(0, 'x').title, describeHttp(500, 'x').title);
  assert.match(describeHttp(0, 'x').title, /连不上/);
  assert.match(describeHttp(500, 'x').title, /后端报错/);
});

test('⑦c ★409 不能说成「程序坏了」——账本不可变是硬边界不是故障', () => {
  const c = describeHttp(409, 'x');
  assert.match(c.title + c.next + c.hint, /账本/, '409 必须说清挡它的是「账本不可变」这条硬边界');
  // ★断言「不许说成程序坏了」，而不是「不许出现故障二字」——
  //   正确的说法恰恰是「不是故障」，按字面禁词会把正确文案一起判红（第一版就踩了）。
  assert.ok(!/程序坏|服务异常|内部错误|出错/.test(c.title),
    '409 是有意挡下的，不该说成程序故障：' + c.title);
  assert.equal(c.doNotRetry, true, '409 不该诱导用户原地重试');
});

test('⑦d 500 明确说「不是你操作的问题」', () => {
  assert.match(describeHttp(500, 'x').title, /不是[你你]*操作的问题|这不是你/);
});

test('⑦e 后端原话按 hint 原样透传，不由本文件另写一遍（同纪律③）', () => {
  const raw = 'visitor_id 格式非法（只允许字母数字与 _ - . :，≤64 字符）';
  assert.equal(describeHttp(400, raw).hint, raw);
  assert.equal(describeHttp(400, '  ' + raw + '  ').hint, raw, '首尾空白要裁掉');
});

test('⑦f ★后端没说话时，兜底必须说清自己是兜底', () => {
  const c = describeHttp(400, '');
  assert.match(c.hint, /没有给出更多说明/, '空 hint 会被读成后端真就这么讲');
  assert.match(c.hint, /兜底|没有给出/, '兜底必须自报家门');
});

test('⑦g 反向锁：码表里没有的状态码 ⇒ 兜底文案，不是空白', () => {
  for (const s of [418, 599, -1, 9999]) {
    const c = describeHttp(s, 'x');
    assert.ok(c.title && c.title.length > 0, s + ' 不得空白');
    assert.ok(c.next && c.next.length > 0, s + ' 不得空白');
  }
});

test('⑦h ★反向锁：把整张表清空 ⇒ 本段必须红（证明它不是空跑绿灯）', () => {
  // 变异自证：表被废掉时，所有状态码都会落进同一个兜底 ⇒ 标题去重后只剩 1 条。
  // ★不用「逐个与 9999 比」那种写法：未知码按设计就回落到 spec 0，
  //   所以 0 与 9999 本来就相等，拿它们互相比是自证失败（第一版就踩了）。
  const CODES = [0, 400, 401, 403, 404, 409, 413, 429, 500];
  const titles = new Set(CODES.map((s) => describeHttp(s, 'z').title));
  assert.equal(titles.size, CODES.length,
    '★9 个状态码只产出 ' + titles.size + ' 种文案 ⇒ 表里有条目在走兜底（变异后该红的样子）');
  const nexts = new Set(CODES.map((s) => describeHttp(s, 'z').next));
  assert.equal(nexts.size, CODES.length,
    '★9 个状态码只产出 ' + nexts.size + ' 种下一步 ⇒ 同样有条目在走兜底');
});
