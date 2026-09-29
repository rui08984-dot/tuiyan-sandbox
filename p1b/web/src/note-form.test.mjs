/* 记一笔页闸（八轮第七改）
 * 病象：旧接题页要人勾 **3 门 + 六层 22 问 = 25 个复选框**。
 *   而后端编译器注释写明「52 个 kind 全部单层 ⇒ kind→layer 可 100% 自动推断」，
 *   且 how_it_works 原文「这只是参考建议，不是判定」。
 *   ⇒ 判层可从「答案去哪里查」推出，那 22 个问号是**引擎的输入被摆在了人的作业面上**。
 *
 * 本闸锁三条：①判据默认已勾好（人只改异议）②判据只在系统给出建议后才出现
 *   ③**不删判据、不改契约**——六层问答个数固定，删了后端 400，且判据属 PREREG 冻结范围。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'pages', 'NotePage.tsx'), 'utf8');
const app = readFileSync(join(dir, 'App.tsx'), 'utf8');

test('① 人只答两件事：题面 + 答案去哪里查', () => {
  assert.ok(page.includes('note-stmt'), '缺题面输入');
  assert.ok(page.includes('note-kind'), '缺真值锚类型选择');
  // ★不得在选 kind 之前就渲染 25 个复选框
  assert.ok(/advice\s*\?\s*\(/.test(page) || page.includes('{advice ? ('), '判据区须以 advice 为条件渲染');
  assert.ok(page.includes('LAYER_Q[advice.layer'), '判据须按系统建议的那一层渲染，而不是一次列出六层');
});

test('② 判据默认按「是」预填，人只改异议', () => {
  assert.ok(page.includes('checked={!off}'), '复选框须默认勾上（=是）');
  assert.ok(page.includes('不同意就取消勾选'), '须明确告诉人「只改异议」');
  assert.ok(page.includes('参考建议不是判定'), '须声明这是建议不是判定（后端纪律）');
});

test('③ 不删判据、不改后端契约（六层问答个数固定，删了 400）', () => {
  // 六层判据一句不少（人话版）
  for (const [k, n] of [['L1', 4], ['L2', 4], ['L3', 4], ['L5', 3], ['L6', 4], ['L4', 3]]) {
    // ★必须用精确的 `Lx: [` 匹配：宽松正则会命中页面别处的片段（实测误配）。
    // 也不能用 indexOf(']') 截段——数组里若含 ']' 会提前截断（实测 L1 少算一条）。
    // 故：去注释后精确定位 + 括号配平取完整数组。
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const at = code.indexOf(k + ': [');
    assert.ok(at >= 0, '缺 ' + k + ' 判据');
    let depth = 0, end = at + k.length + 2;
    for (let j = end; j < code.length; j++) {
      if (code[j] === '[') depth++;
      else if (code[j] === ']') { depth--; if (depth === 0) { end = j; break; } }
    }
    const seg = code.slice(at, end + 1);
    const cnt = (seg.match(/'/g) || []).length / 2;
    assert.equal(cnt, n, k + ' 判据条数应为 ' + n + '（与后端 QUESTION_COUNT 一致），实得 ' + cnt + '：' + seg.slice(0, 90));
  }
});

test('④ 旧接题页路径仍在（书签不断），且重定向落在真渲染的记一笔页上', () => {
  assert.ok(app.includes('path="/intake"'), '/intake 旧路径消失（书签会断）');
  assert.ok(/path="\/intake" element=\{<Navigate to="\/note"/.test(app), '/intake 须重定向到 /note');
  /* ★T9（2026-09-28）：本条原来断言 `App.tsx` 里含字符串 'IntakePage'，那是**代理判据**——
     组件早已不渲染（/intake 是重定向），import 留着只会被 tsc 判 TS6133
     （实测 5 条：Overview/Audit/Intake/Calendar/Compiler），本轮已按要求删掉。
     当时改成了直接断言**源码文件在盘上**（禁词扫描以它为目标）。
     ★2026-09-30 口径修正：**死页源码已删**（pages/intake/ 下只剩 intakeUx.test.mjs），
     「源码在盘上＝禁词扫描有目标」这个前提随之作废，那条 existsSync 因此必红。
     书签真正依赖的从来不是那份死文件，而是**重定向链的终点有没有一个真在渲染的页**——
     终点落空，书签照样断。
     ⇒ 改为直接断言终点：/note 实挂 <NotePage />。断言强度只升不降：
       从「旧文件还在盘上」变成「旧链接能落到一个真渲染的页」。
     并把 T9 那条代理判据**翻成反向**：死页不得再被 App.tsx 引用（引用即 TS6133 复现）。 */
  assert.ok(/<Route path="\/note" element=\{<NotePage\s*\/>\}/.test(app),
    '/note 须实挂 NotePage：/intake 的重定向终点；终点落空＝书签还是断');
  assert.ok(!app.includes('IntakePage'),
    'App.tsx 不得再引用死页 IntakePage（/intake 已是重定向，import 只会被 tsc 判 TS6133）');
});

test('⑤ 拒收的回执把因果方向说清：是系统拒了你，不是你没通过考试', () => {
  assert.ok(page.includes('是系统拒了你') || page.includes('不是你没答对'), '须点明因果方向');
  assert.ok(page.includes('没有能事后核对的地方'), '须说清拒收的真实原因');
  assert.ok(page.includes('no_anchor') && page.includes('leak') && page.includes('tautology'),
    '四种拒收原因都要有人话文案');
});
