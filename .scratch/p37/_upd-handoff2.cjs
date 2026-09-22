'use strict';
// 一次性：交接件 §1 更新（候选留痕已全覆盖 ⇒ 新待办③标完成）＋ §0 现状
const fs = require('fs');
const P = '.scratch/handoff/推演沙盘-交接-20260921-终态.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');

// ① §1 把「新增待办③」标完成
const oldTodo = '3. **★09-22 新增待办（无阻塞，可选）**：把候选留痕旁路**接入常规流程**——即出题器默认产出 ' + BQ + '--record-candidates' + BQ + ' 或由结算批统一补跑（当前仍需手动传参）。';
if (t.indexOf(oldTodo) < 0) { console.log('★未找到待办③'); process.exit(1); }
const newTodo = [
'3. ~~把候选留痕旁路接入常规流程~~ ✅ **已完成覆盖**（见下）——**五个出题器全部就位**；'
  + '剩余可选项＝「出题器**默认**产出留痕（当前仍需手动传 ' + BQ + '--record-candidates' + BQ + '）」',
].join('\n');
t = t.replace(oldTodo, newTodo);

// ② §1 已完成清单加两条
const anchor = '- ~~修「跑测试写仓库产物」缺陷~~ ✅ 已完成（commit ' + BQ + 'd74bb81' + BQ + '；测试 533→**535**）';
if (t.indexOf(anchor) < 0) { console.log('★未找到已完成清单锚'); process.exit(1); }
const add = anchor + '\n'
  + '- ~~corpus-thicken 补候选留痕旁路~~ ✅ 已完成（commit ' + BQ + 'a92acae' + BQ + '；23 处丢弃点；**★含一处口径错先犯后修**：数据行过滤 ≠ 候选丢弃）\n'
  + '- ~~role3-pilot 补 drops 字段~~ ✅ 已完成（commit ' + BQ + 'c40588d' + BQ + '；其口径更严——不丢弃任何提议）\n'
  + '- ~~五出题器留痕口径审计锁~~ ✅ 已完成（commit ' + BQ + '11399a6' + BQ + '；判据不机械要求 record-candidates；测试 **538/538**）';
t = t.replace(anchor, add);

// ③ §0 测试数与新增行
t = t.replace('| 测试 | **534/534 pass / 0 fail** |', '| 测试 | **538/538 pass / 0 fail** |');
t = t.replace('③修「跑测试写仓库产物」缺陷 | 本件头部刷新注 |', '③修「跑测试写仓库产物」缺陷 ④**候选留痕旁路覆盖全部 5 个出题器**（★含一处口径错先犯后修） | 本件头部刷新注 |');
fs.writeFileSync(P, t, 'utf8');
console.log('交接件 §0／§1 已更新');
