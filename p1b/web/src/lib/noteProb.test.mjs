/**
 * 记一笔页·「你的判断」入账闸（2026-09-28 · 步骤 B）
 *
 * 【病象：用户填的数哪儿也没去】
 *   `myProb` 有输入框（NotePage.tsx 的「你的判断」格）、有 state、有结论句参与，
 *   但**从不进入任何提交** ⇒ 记下来的每一道题都没有"当时押了多少"，
 *   账本里那一列恒为"当时没给数"。用户以为记下了自己的判断，其实只记了题面。
 *
 * 【两条纪律】
 *   ① **数只从用户来**：`assigned_prob` 必须是用户填的那个数（评审 P1-2 / 闭环第一环），
 *      不是引擎基率。两者混为一谈＝把"系统的读数"记成"人的判断"，那正是本项目
 *      最贵的一类错误（读数一旦被当成判断，校准就全废了）。
 *   ② **没填就拒，并说清为什么**：不许静默拿基率顶上。
 *      静默顶上时账本上那一条**看起来**有判断、有基率、还能量偏差——
 *      而实际上没有���人数，占的是系统的数。这是"界面在骗人"的最短路径。
 *
 * 【为什么抽成纯函数】组件级测试要 jsdom/Testing Library（本项目禁新依赖）；
 *   而"这个输入能不能落库、落成几"恰恰是最该被单测的东西。
 *
 * 【禁词】全文禁「预测」二字。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMyProb, submitGuard } from './noteProb.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, '..', 'pages', 'NotePage.tsx'), 'utf8');

/** 后端 predictions.js:50-56 requireProb 的复刻：prob 必须是 [0,1] 的有限数值。 */
function backendAccepts(prob) {
  return typeof prob === 'number' && Number.isFinite(prob) && prob >= 0 && prob <= 1;
}

test('① 百分数换算：62 ⇒ 0.62（后端只收 0-1，发 62 会被 requireProb 拒）', () => {
  assert.deepEqual(readMyProb('62'), { ok: true, prob: 0.62, why: '' });
  assert.equal(readMyProb('0').prob, 0, '0 是合法判断（"我押它不发生"），不许当空值');
  assert.equal(readMyProb('100').prob, 1, '100 是合法判断');
  assert.equal(readMyProb(' 7.5 ').prob, 0.075, '须容忍首尾空格与小数');
  assert.equal(readMyProb('50').prob, 0.5);
  // 换算后必须过得了后端那道门
  for (const v of ['0', '0.4', '62', '99.9', '100']) {
    assert.equal(backendAccepts(readMyProb(v).prob), true, v + ' 换算后被后端拒了');
  }
});

test('★② 没填数必须拒，且说清为什么——不许静默拿基率顶上', () => {
  const blank = readMyProb('');
  assert.equal(blank.ok, false);
  assert.ok(blank.prob === null, '拒收时不得顺手给一个数（0 也是数：null 才是"没给"）');
  assert.ok(blank.why && blank.why.trim().length > 0, '拒收必须给出人话理由');
  // ★理由里不许出现"用基率顶上"这类出路——那正是本闸要堵的
  assert.equal(/基率顶上|就用|默认用|自动填/.test(blank.why), false,
    '拒收理由不许给出"用别的数顶上"的出路：' + blank.why);
  assert.equal(/预测/.test(blank.why), false, '禁词');
  // 空白与非法输入都拒，但理由要分开：空是没答，非空写错是笔误
  const junk = readMyProb('大概吧');
  assert.equal(junk.ok, false);
  assert.notEqual(junk.why, blank.why, '「没填」与「填错了」不是同一句话');
});

test('③ 越界与垃圾输入一律拒（0-100 之外没有"修一下"的余地）', () => {
  for (const v of ['-1', '101', '1e400', 'abc', '0x10', '12,5', '50 50', 'Infinity', 'NaN']) {
    assert.equal(readMyProb(v).ok, false, '不该收下：' + JSON.stringify(v));
  }
  // 越界的理由要说清边界在哪，而不是笼统"格式错"
  const over = readMyProb('150');
  assert.ok(/0/.test(over.why) && /100/.test(over.why), '越界理由须点明区间 0-100：' + over.why);
});

test('★④ 提交闸：题面/真值锚没答 ⇒ 拒；没给数 ⇒ 拒；两者齐 ⇒ 放行且带数', () => {
  assert.equal(submitGuard({ statement: '  ', kind: 'x', myProb: '62' }).ok, false, '题面空 ⇒ 拒');
  assert.equal(submitGuard({ statement: '会下雨吗', kind: '', myProb: '62' }).ok, false, '没选真值锚 ⇒ 拒');
  const noProb = submitGuard({ statement: '会下雨吗', kind: 'x', myProb: '' });
  assert.equal(noProb.ok, false, '★没给数 ⇒ 必须拒绝提交');
  assert.ok(noProb.why && noProb.why.length > 0, '须说清为什么');
  const good = submitGuard({ statement: '会下雨吗', kind: 'x', myProb: '62' });
  assert.equal(good.ok, true);
  assert.equal(good.prob, 0.62, '放行时必须带着**用户那个数**换算后的值');
  // ★题面两侧空白照旧要清干净再比，否则"全空格"会被当有效题面
  assert.equal(submitGuard({ statement: '　', kind: 'x', myProb: '62' }).ok, false,
    '全角空格也当空题面');
});

test('★⑤ 提交闸不许拿基率顶替（穷举：任何非用户输入都不得产出 prob）', () => {
  // 穷举一串"看起来像数、其实不是用户判断"的东西
  for (const v of ['', '  ', 'n/a', 'N/A', 'null', 'undefined', '-', '?', '不知道', '一半一半']) {
    const g = submitGuard({ statement: '会下雨吗', kind: 'x', myProb: v });
    assert.equal(g.ok, false, '不该放行：' + JSON.stringify(v));
    assert.equal(g.prob === undefined || g.prob === null, true,
      '拒收时不得带出任何数（防止调用方兜底塞基率）：' + JSON.stringify(v));
  }
});

test('★⑥ 接线：NotePage 真用了 submitGuard，且数只来自用户填的那个输入框', () => {
  assert.ok(/import\s*\{[^}]*submitGuard[^}]*\}\s*from\s*'\.\.\/lib\/noteProb'/.test(page),
    'NotePage 未 import submitGuard（纯函数对、页面不接＝白修）');
  // 提交里必须有一道闸；且不许在闸之外另有把数塞进去的路
  const s = page.slice(page.indexOf('const submit'), page.indexOf('const submit') + 1400);
  assert.ok(/submitGuard\(/.test(s), 'submit 里须先过闸');
  const guardAt = s.indexOf('submitGuard(');
  const callAt = s.indexOf('api.classifyIntake');
  assert.ok(guardAt >= 0 && callAt > guardAt, '★闸必须拦在发请求之前（拦在后面＝只是摆设）');
  // 禁止的兜底：拿左边的历史频率当用户判断
  assert.equal(/prob:\s*base\??\.rate/.test(page), false, '不许把历史频率当用户的数');
  assert.equal(/prob:\s*myProb(?!Of)/.test(page), false, '不许把 0-100 的百分数当 0-1 直接发（后端 requireProb 会 400）');
});

test('★⑦ 输入框不能被"建议层"卡住：没有建议层时也得能填数', () => {
  /* 病象：输入框在 `{advice ? ...}` 里，而 advice 只在账本里有这类题时才有。
     一旦 lookup.known=false（账本里一道这种题都没有），输入框**整块不渲染**，
     提交闸却说"你还没填数" ⇒ 用户被指到一处他根本填不了的地方。
     闸若不可执行，比不闸更坏（它拦下一件用户做不了的事，却不告诉他去哪儿做）。 */
  const m = /\{advice \? \(/.exec(page);
  assert.ok(m, '面板仍以 advice 为条件渲染（本轮不推翻减负设计）');
  const inGate = page.slice(m.index, page.indexOf('note-answer-h', m.index + 1) + 400);
  assert.equal(/value=\{myProb\}/.test(inGate), false,
    '「你的判断」输入框被关在 advice 门里：账本里没有这类题时用户无处填数，闸会拦死他');
  // 输入框仍须在（只是不再被 advice 门关着）
  assert.ok(page.includes('value={myProb}'), '输入框不能删——它是 assigned_prob 的唯一来源');
});

test('★⑧-补 闭环锁：NotePage 真的把数**落进账本**了（不是只过了一道闸）', () => {
  /* 病象：这一页全程只读不写。用户在「你的判断」里填了数、按下"记下"、
     看到回执「收下了」——而 predictions 账本里一行都没有。
     闸（⑥）能证明"数被要求了"，证明不了"数被存下来了"；这一步补的是后半截。 */
  assert.ok(/api\.createPrediction\(/.test(page), 'NotePage 未调 createPrediction：填的数还是进不了账本');
  // 两步顺序：先 classify 拿层，再 create 落库（先建后判＝建一条没有层的行）
  const s = page.slice(page.indexOf('const submit'), page.indexOf('const submit') + 2200);
  assert.ok(s.indexOf('classifyIntake') < s.indexOf('createPrediction'),
    '必须先 classify 再 create：层是 classify 判出来的');
  // ★数必须是闸放行的那个 0-1 值，且不许出现百分数原样
  assert.ok(/prob:\s*v\.prob/.test(s), '落注的 prob 须用 submitGuard 放行的那个值（0-1）');
  // ★create 失败必须如实报错，且把已经显示的"收下了"撤掉
  assert.ok(/setRes\(null\)/.test(s) && /setErr\(/.test(s),
    '落注失败须撤掉回执并报错——停在半截状态就是骗人');
  // 被拒收的题不许建行
  assert.ok(/\.rejected\) return;/.test(s), '被拒收的题不许进 predictions 账本（它进的是拒收台账）');
});

test('⑨ 文案与注释不许夹带禁词', () => {
  const src = readFileSync(join(dir, 'noteProb.ts'), 'utf8');
  assert.equal((src.match(/预测/g) || []).length, 0, '本闸文件不得含禁词');
  for (const v of ['', 'abc', '150']) {
    assert.equal(/预测/.test(readMyProb(v).why), false, '拒收文案不得含禁词');
  }
});
