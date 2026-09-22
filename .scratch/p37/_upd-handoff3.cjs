'use strict';
// 一次性：交接件更新（默认关锁 + 测试偶发修 + §0 现状）
const fs = require('fs');
const P = '.scratch/handoff/推演沙盘-交接-20260921-终态.md';
const BQ = String.fromCharCode(96);
let t = fs.readFileSync(P, 'utf8');

// ① §1 待办③ 更新（默认产出评估已做且否决）
const old = '3. ~~把候选留痕旁路接入常规流程~~ ✅ **已完成覆盖**（见下）——**五个出题器全部就位**；剩余可选项＝「出题器**默认**产出留痕（当前仍需手动传 ' + BQ + '--record-candidates' + BQ + '）」';
if (t.indexOf(old) < 0) { console.log('★未找到待办③'); process.exit(1); }
const neu = '3. ~~把候选留痕旁路接入常规流程~~ ✅ **已完成**——五个出题器全部就位；**★「默认产出留痕」已评估并否决**（会重蹈「跑测试写仓库产物」缺陷）⇒ 保持调用方显式传参，已加 ⑨ 锁固化。';
t = t.replace(old, neu);

// ② 已完成清单加两条
const anchor = '- ~~五出题器留痕口径审计锁~~ ✅ 已完成（commit ' + BQ + '11399a6' + BQ + '；判据不机械要求 record-candidates；测试 **538/538**）';
if (t.indexOf(anchor) < 0) { console.log('★未找到清单锚'); process.exit(1); }
t = t.replace(anchor, anchor + '\n'
  + '- ~~「默认产出留痕」评估~~ ✅ **已评估并否决**（commit ' + BQ + 'b6cb733' + BQ + '；会重蹈缺陷 ⇒ 加 ⑨ 默认关全局锁）\n'
  + '- ~~修测试偶发红~~ ✅ 已完成（同 commit；' + BQ + 'dlt-referer.test.cjs' + BQ + ' 网络依赖加固 ⇒ 只在拿到预期值时断言）');

// ③ §0 测试数 + 完成行
t = t.replace('| 测试 | **538/538 pass / 0 fail** |', '| 测试 | **539/539 pass / 0 fail** |');
t = t.replace('④**候选留痕旁路覆盖全部 5 个出题器**（★含一处口径错先犯后修） | 本件头部刷新注 |', '④**候选留痕旁路覆盖全部 5 个出题器**（★含一处口径错先犯后修）⑤默认关锁＋修测试偶发红 | 本件头部刷新注 |');
fs.writeFileSync(P, t, 'utf8');
console.log('交接件已更新');
