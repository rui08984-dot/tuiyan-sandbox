/**
 * 记一笔页·判据清单契约闸（2026-09-28 · 步骤 A）
 *
 * 【病象：提交必 400，而界面从不报错的另一半】
 *   后端 `intake.js` 的决策树（`DECISION_ORDER=['L5','L6','L1','L3','L2']`）
 *   **逐层都要** checklist（`intake.js:296-302`）：
 *     缺键 → `layerGreen` 返回 null → 直接 400；
 *     给了但长度不对 → `intake.js:191` 直接 400。
 *   而 `NotePage.buildChecklist` 旧版只发三问 + **系统建议的那一层**，
 *   其余四层**连键都没有** ⇒ 每一道题都在第 1 步就被拒。
 *
 * 【为什么不能拿 false 顶上——这是本闸的核心】
 *   三态归一 `normTri`（`intake.js:174`）认 boolean 与 `'unknown'`。
 *   那四层用户**根本没被问到**（界面上没有它们的判据，见 `note-form.test.mjs` ①），
 *   所以：
 *     · 发 `false` ＝ **替用户编造「不满足」**——它会让这道题在决策树里
 *       被判成"不是这层"，而用户从没表过态；
 *     · 发 `'unknown'` ＝ 如实说"没问"。`layerGreen` 里
 *       `'unknown' !== true` ⇒ 判非全绿（`intake.js:186-192` 注释原文：
 *       「'unknown' 视作非全绿」），既不编造、也不阻断。
 *   两者在"最终落到哪一层"上结果相同，在**账本是否诚实**上完全不同。
 *
 * 【禁词】全文禁「预测」二字（界面与注释同罪，见 wait-state/noteWait 的 ⑧ 条）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildChecklist, QUESTION_COUNT, DECISION_ORDER, UNASKED, REQUIRED_KEYS, GATE_KEYS,
} from './noteChecklist.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, '..', 'pages', 'NotePage.tsx'), 'utf8');

/**
 * 后端判据的**行为复刻**（p1b/src/routes/intake.js:174-200）。
 * 为什么要复刻而不是只比数组长度：闸要证明的是"这份清单后端收得下"，
 * 只比长度是代理判据——长度对了、值类型错了照样 400。
 * 复刻只取三件事：三态归一 / 数组长度不符抛 400 / 'unknown' 不算全绿。
 */
const TRUE_WORDS = ['yes', 'y', 'true', '是', '1'];
const FALSE_WORDS = ['no', 'n', 'false', '否', '0'];
const UNKNOWN_WORDS = ['unknown', '未知', 'n/a', 'na'];
function normTri(name, v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && (v === 0 || v === 1)) return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (TRUE_WORDS.indexOf(s) !== -1) return true;
    if (FALSE_WORDS.indexOf(s) !== -1) return false;
    if (UNKNOWN_WORDS.indexOf(s) !== -1) return 'unknown';
  }
  throw new Error(name + ' 非法三态: ' + JSON.stringify(v));
}
/** 复刻 intake.js:187 layerGreen。null=没给（调用方据此 400），true/false=全绿否 */
function layerGreen(layer, v) {
  const n = QUESTION_COUNT[layer];
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    if (v.length !== n) throw new Error('checklist.' + layer + ' 需要 ' + n + ' 个，收到 ' + v.length);
    return v.every((x, i) => normTri('checklist.' + layer + '[' + i + ']', x) === true);
  }
  throw new Error('checklist.' + layer + ' 形状非法');
}
/** 复刻 intake.js:294-305 决策树：逐层必填 → 首个全绿；皆非全绿 ⇒ 'unknown' */
function computeLayer(checklist) {
  const greens = {};
  for (const L of DECISION_ORDER) {
    const g = layerGreen(L, checklist[L]);
    if (g === null) throw new Error('checklist.' + L + ' 必填');
    greens[L] = g;
  }
  for (const L of DECISION_ORDER) if (greens[L]) return L;
  return 'unknown';
}

test('① 逐层问数必须与后端 QUESTION_COUNT 字字相等（差一个就 400）', () => {
  // 与 p1b/src/routes/intake.js:62 逐字对齐
  assert.deepEqual(QUESTION_COUNT, { L5: 3, L6: 4, L1: 4, L3: 4, L2: 4, L4: 3 });
  // 决策树顺序也与后端 intake.js:60 一致（顺序决定"最特殊优先"的落层）
  assert.deepEqual(DECISION_ORDER, ['L5', 'L6', 'L1', 'L3', 'L2']);
});

test('★①甲 复刻后端判据：旧形状（只发三问+建议层）必被拒；新形状收得下', () => {
  // ★旧形状 = NotePage.buildChecklist 改动前逐字复刻（NotePage.tsx:155-176 旧实现）
  const old = (layer) => {
    const c = { Q0_1: true, Q0_2: true, Q0_3: true };
    c[layer] = Array.from({ length: QUESTION_COUNT[layer] }, () => true);
    return c;
  };
  assert.throws(() => computeLayer(old('L2')), /checklist\.L5 必填/,
    '旧形状过不了后端第 1 步（这就是"提交必 400"的原样复现）');
  assert.throws(() => computeLayer(old(null)), /必填/,
    '★无建议层时更糟：连一道都发不出去');
  // 拿 false 顶上——不报错，但把"没问"记成了"用户说不满足"
  const withFalse = buildChecklist({ layer: 'L2' });
  for (const L of DECISION_ORDER) if (L !== 'L2') withFalse[L] = Array(QUESTION_COUNT[L]).fill(false);
  assert.equal(computeLayer(withFalse), 'L2', 'false 也能过（所以"能不能过"不是判据）');
  // 本闸要的形状：既过、又不编造
  assert.equal(computeLayer(buildChecklist({ layer: 'L2' })), 'L2');
  // 用户把建议层全取消 ⇒ 落 'unknown'（清单 v3 出口 7，如实）
  assert.equal(computeLayer(buildChecklist({ layer: 'L2', off: ['0', '1', '2', '3'] })), 'unknown');
  // 无建议层（账本里一道这种题都没有）⇒ 也落 unknown，且不抛
  assert.equal(computeLayer(buildChecklist({ layer: null })), 'unknown');
});

test('★② 未被问到的那几层必须发 unknown，绝不发 false', () => {
  const c = buildChecklist({ layer: 'L2' });
  for (const L of DECISION_ORDER) {
    if (L === 'L2') continue;
    assert.deepEqual(c[L], Array(QUESTION_COUNT[L]).fill(UNASKED),
      L + ' 用户没被问到它 ⇒ 必须如实发 unknown；发 false 等于替用户编造「不满足」');
    assert.equal(c[L].includes(false), false, L + ' 不许发 false（编造）');
  }
  assert.equal(UNASKED, 'unknown', '三态字面量必须与 normTri 的 UNKNOWN_WORDS 对得上');
});

test('★③ 建议层发用户真实勾选：默认「是」，取消的那几条发 false', () => {
  const all = buildChecklist({ layer: 'L5' });
  assert.deepEqual(all.L5, [true, true, true], '默认三条全勾＝是（intake.js:191 的 every===true 才算全绿）');
  // 取消第 1 条（序号从 0 起，与界面上 over[layer] 存的一致）
  const off = buildChecklist({ layer: 'L5', off: ['1'] });
  assert.deepEqual(off.L5, [true, false, true], '用户取消的那条必须是 false，不能悄悄改回 true');
  // 全部取消 ⇒ 该层非全绿（后端会落到下一层或 unknown），这是用户的判断不是故障
  assert.deepEqual(buildChecklist({ layer: 'L5', off: ['0', '1', '2'] }).L5, [false, false, false]);
});

test('★④ 五层键一个都不能少（缺键 = layerGreen(null) = 400）', () => {
  // 建议层正常
  const ok = buildChecklist({ layer: 'L3' });
  for (const k of REQUIRED_KEYS) assert.ok(k in ok, '缺 checklist.' + k + '：后端会 400');
  // ★账本里一道这种题都没有（lookup.known=false ⇒ layer 为空）时也一样要发全
  const none = buildChecklist({ layer: null });
  for (const k of REQUIRED_KEYS) assert.ok(k in none, '无建议层时缺 checklist.' + k + '：后端会 400');
  for (const L of DECISION_ORDER) {
    assert.deepEqual(none[L], Array(QUESTION_COUNT[L]).fill(UNASKED),
      '无建议层 ⇒ 五层全是「没问」；此时后端算出来是 unknown（清单 v3 出口 7），这是诚实结果');
  }
  // 三问恒在（拒收门）
  for (const g of GATE_KEYS) assert.equal(none[g], true, '拒收门三问缺 ' + g);
});

test('⑤ 长度逐层对得上（穷举所有建议层，含 L4 与非法层名）', () => {
  for (const L of Object.keys(QUESTION_COUNT)) {
    const c = buildChecklist({ layer: L });
    for (const D of DECISION_ORDER) {
      assert.equal(Array.isArray(c[D]), true, D + ' 必须是数组（object 形式会被 400）');
      assert.equal(c[D].length, QUESTION_COUNT[D], D + ' 长度须为 ' + QUESTION_COUNT[D]);
    }
  }
  // 非法/空层名不许被当成"某一层"（否则会把别人的判据当成用户的）
  const bogus = buildChecklist({ layer: 'L9' });
  for (const D of DECISION_ORDER) {
    assert.deepEqual(bogus[D], Array(QUESTION_COUNT[D]).fill(UNASKED), '未知层名 L9 不得冒充任一层');
  }
  // L4 不在决策树里 ⇒ 不发（后端 layerGreen('L4', undefined) 返回 null ⇒ 不设 secondary）
  assert.equal('L4' in buildChecklist({ layer: 'L4' }), false, 'L4 是后置叠加层且本页无其判据，不该发');
});

test('★⑥ 接线：NotePage 的清单走这个纯函数（纯函数对、页面不接＝白修）', () => {
  assert.ok(/import\s*\{[^}]*\bbuildChecklist\b[^}]*\}\s*from\s*'\.\.\/lib\/noteChecklist'/.test(page),
    'NotePage 未 import buildChecklist');
  // 旧实现那个"只填建议层、其余连键都没有"的形状不许还在
  assert.equal(/Q0_1:\s*true,\s*Q0_2:\s*true,\s*Q0_3:\s*true,?\s*\n?\s*\};/.test(page), false,
    'NotePage 里不许再有"只发三问就收工"的旧清单拼装');
  // 调用点须把建议层与用户勾选一并递进去（漏 off ⇒ 用户的异议被悄悄改回"是"）
  const call = /buildChecklist\(\{([\s\S]{0,300}?)\}\)/.exec(page);
  assert.ok(call, 'NotePage 须调用 buildChecklist({...})');
  assert.ok(/\blayer\b/.test(call[1]), '调用点须递建议层');
  assert.ok(/\boff\b/.test(call[1]), '调用点须递用户取消勾选的序号');
});

test('★⑧ 跨语言锁：这份清单必须与后端端到端锁里那份**逐字相同**', () => {
  /* 端到端锁（p1b/test/external-intake-ledger.test.cjs 里的 FRONTEND_CHECKLIST_L2）
     把本函数在「建议层 = L2、全不取消」时产出的东西**原样**灌进真端点。
     两边各断言一次同一个字面量 ⇒ 任一边漂移，另一边立刻红。
     ★禁在本文件里把它"简化"成好读的形状：那份字面量就是线上真实 payload。 */
  const expected = {
    Q0_1: true, Q0_2: true, Q0_3: true,
    L5: ['unknown', 'unknown', 'unknown'],
    L6: ['unknown', 'unknown', 'unknown', 'unknown'],
    L1: ['unknown', 'unknown', 'unknown', 'unknown'],
    L3: ['unknown', 'unknown', 'unknown', 'unknown'],
    L2: [true, true, true, true],
  };
  assert.deepEqual(buildChecklist({ layer: 'L2', off: [] }), expected,
    '与后端端到端锁那份 payload 不一致了——那份测试会跟着红');
});

test('⑨ 文案与注释不许夹带禁词', () => {
  const src = readFileSync(join(dir, 'noteChecklist.ts'), 'utf8');
  assert.equal((src.match(/预测/g) || []).length, 0, '本闸文件不得含禁词');
  // 三问在纯函数里也是"是"——那是界面既定口径（界面上没有 Q0 复选框），
  // 但要在这里写清楚它是**页面既定填法**而不是"用户逐条答过"，免得下一个人当成用户表态。
  assert.ok(/Q0_1/.test(src), '须显式写出三问的填法出处');
});
