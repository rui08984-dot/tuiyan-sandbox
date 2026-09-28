/**
 * 记一笔页等待态闸（2026-09-28 · 缺陷二：选题源时全程零反馈）
 *
 * 【病象：等待和「查不到数据」长得一模一样】
 *   选完「答案去哪里查」之后，页面要等一次 `/api/disclosure/compiler?kind=…`
 *   才出「这类题历史上怎么样」。那段路上界面上**一个字都没有**——
 *   而「这个题源查不到历史样本」在界面上**也是什么都没有**。
 *   ⇒ 空白既可能是"还在等"，也可能是"没有"，用户无从分辨，
 *     只能盯着页面猜（本产品的核心动作就是**算数**，那段等待是必然发生的）。
 *
 * 【上一轮留下的死调用】
 *   `const [, setPhase] = useState<'idle'|'freq'|'done'>('idle')` ——
 *   读取侧被摘掉，4 处 `setPhase` 调用（NotePage.tsx:104/107/122/124）照旧在跑，
 *   驱动不了任何东西；而 `<Wait state={err ? 'error' : busy ? 'pending' : 'idle'}>`
 *   里的 `busy` **只覆盖 submit**，不覆盖那次查历史的 fetch。
 *   ⇒ 缺陷不是"少了个转圈"，是**等待态在错误的地方失效**。
 *
 * 【本闸怎么验：禁新依赖（不许 jsdom / Testing Library）】
 *   判断逻辑抽成可导出的纯函数（lib/noteWait.ts），组件只负责渲染；
 *   前 6 条**真 import 纯函数**跑行为，第 7⑧ 条只证明它**插上了**（插线是插线，行为是行为，
 *   两者都要有——只测纯函数会漏掉"函数对但没接线"，只扫源码则全是代理判据）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitStateOf, waitWhatOf, waitViewOf } from './noteWait.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, '..', 'pages', 'NotePage.tsx'), 'utf8');

const IDLE = { err: '', busy: false, phase: 'idle' };

test('① 错优先：err 压过 busy 与 freq（失败态不能被"正在等"盖掉）', () => {
  assert.equal(waitStateOf({ ...IDLE, err: '读不到这类题的历史样本' }), 'error');
  assert.equal(waitStateOf({ err: 'x', busy: true, phase: 'freq' }), 'error');
  assert.equal(waitStateOf({ err: 'x', busy: false, phase: 'done' }), 'error');
});

test('② 提交段：busy ⇒ pending', () => {
  assert.equal(waitStateOf({ ...IDLE, busy: true }), 'pending');
  // ★busy 与 freq 同时为真时**仍算等**（提交盖住了取数），不算错
  assert.equal(waitStateOf({ ...IDLE, busy: true, phase: 'freq' }), 'pending');
});

test('★③ 选源段：busy=false 但 phase=freq ⇒ 必须是 pending（本次修的核心）', () => {
  // 改前 busy 只覆盖 submit ⇒ 这一段恒为 idle ⇒ 界面什么都不显示
  assert.equal(waitStateOf({ err: '', busy: false, phase: 'freq' }), 'pending',
    '查历史那段没有反馈：空白与"查不到数据"无法区分');
});

test('④ 常态：无事发生 ⇒ idle（Wait 在 idle 返回 null，接线不改变常态页面）', () => {
  assert.equal(waitStateOf(IDLE), 'idle');
  assert.equal(waitStateOf({ ...IDLE, phase: 'done' }), 'idle', '查完了就是 idle，不是"等完了还在等"');
});

test('★⑤ 两段话必须不同：查历史 vs 提交（同一句"在数…"会骗人）', () => {
  const freq = waitWhatOf({ busy: false, phase: 'freq' });
  const busy = waitWhatOf({ busy: true, phase: 'idle' });
  assert.ok(freq && String(freq).trim(), '查历史段不得空白（空白 + 孤圈 = 用户以为坏了）');
  assert.ok(busy && String(busy).trim(), '提交段不得空白');
  assert.notEqual(freq, busy, '两段等待说了同一句话＝没在解释这次在等什么');
  // 提交时（哪怕 phase 还没落回）也要说提交的话
  assert.equal(waitWhatOf({ busy: true, phase: 'freq' }), busy, 'busy 压住 freq：正在登记就别报在数数');
});

test('⑥ 穷举：凡 pending 必有非空文案（Wait 的纪律：what 必填）', () => {
  for (const err of ['', 'boom']) {
    for (const busy of [false, true]) {
      for (const phase of ['idle', 'freq', 'done']) {
        const v = waitViewOf({ err, busy, phase });
        assert.ok(v.state === 'idle' || v.state === 'pending' || v.state === 'error', '非法 state: ' + v.state);
        assert.equal(v.state, waitStateOf({ err, busy, phase }));
        assert.equal(v.what, waitWhatOf({ busy, phase }));
        if (v.state === 'pending') {
          assert.ok(v.what && String(v.what).trim().length > 0, JSON.stringify({ busy, phase }) + ' ⇒ pending 却没文案');
        }
      }
    }
  }
  // 组合视图必须是同一个真源（组件只准消费它，不准自己再拼一遍）
  assert.deepEqual(
    waitViewOf({ err: '', busy: false, phase: 'freq' }),
    { state: 'pending', what: waitWhatOf({ busy: false, phase: 'freq' }) },
  );
});

test('★⑦ 接线：NotePage 真的把 phase 喂了进去，并用它驱动 <Wait>', () => {
  // ★文本扫描只证明"插上了"，不证明行为——行为在 ①～⑥（真 import 纯函数）。
  assert.ok(/import\s*\{[^}]*waitViewOf[^}]*\}\s*from\s*'\.\.\/lib\/noteWait'/.test(page),
    'NotePage 未 import waitViewOf（纯函数对、页面不接＝白修）');
  assert.ok(/const\s*\[\s*phase\s*,\s*setPhase\s*\]/.test(page),
    'phase 必须有读取侧（`const [, setPhase]` 是上一轮留下的死调用）');
  // 接线处必须整段消费 waitViewOf 的两个字段，不能只取 state（那样文案还是同一句）
  assert.ok(/state=\{wait\.state\}/.test(page) && /what=\{wait\.what\}/.test(page),
    '<Wait> 的 state 与 what 都得来自同一个 waitViewOf 结果');
  assert.equal(/state=\{err \? 'error' : busy \? 'pending' : 'idle'\}/.test(page), false,
    '旧的 err/busy 三元还在：它看不见 phase ⇒ 选源段仍然零反馈');
  // busy 只覆盖 submit 这件事不许被"顺手扩权"糊过去：busy 的写入点应只有 submit 一处
  const busyWrites = (page.match(/setBusy\(true\)/g) || []).length;
  assert.equal(busyWrites, 1, 'setBusy(true) 应只在 submit 一处（取数段由 phase 表达，不许借 busy 表达）');
});

test('⑧ 文案不许夹带"预测"（全站禁词）', () => {
  const src = readFileSync(join(dir, 'noteWait.ts'), 'utf8');
  const all = src + waitWhatOf({ busy: false, phase: 'freq' }) + waitWhatOf({ busy: true, phase: 'idle' });
  assert.equal((all.match(/预测/g) || []).length, 0, '等待文案不得含禁词');
});
