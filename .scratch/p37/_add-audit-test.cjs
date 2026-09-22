'use strict';
// 一次性：给 role3-freeze.test.cjs 加「五出题器留痕口径审计」测试
const fs = require('fs');
const P = 'p1b/test/role3-freeze.test.cjs';
const lines = [
'',
"test('⑧ ★五出题器留痕口径审计（每器须可测严格分母）', () => {",
'  // 背景（2026-09-22）：候选留痕旁路覆盖全部出题器。',
'  //   ★判据**不机械要求** record-candidates 字样——允许两种等效设计：',
'  //     ① 支持 --record-candidates（落 drops 数组）',
'  //     ② 声明「不丢弃任何提议」（drops:[] ＋ 说明）⇒ 分母天然＝提议全集（**更严**）',
"  const GENS = ['corpus-sources-b4', 'corpus-thicken', 'role3-pilot', 'role3-utype', 'calendar-questions'];",
'  const bad = [];',
'  for (const g of GENS) {',
"    const p = path.join(ROOT, 'p1b/scripts/' + g + '.cjs');",
"    if (!fs.existsSync(p)) { bad.push(g + '（脚本不存在）'); continue; }",
"    const t = fs.readFileSync(p, 'utf8');",
"    const hasParam = /record-candidates/.test(t);",
"    const declaresNoDrop = /drops: \\[\\]/.test(t) && /不丢弃/.test(t);",
"    if (!hasParam && !declaresNoDrop) bad.push(g + '（既无 --record-candidates 也无「不丢弃」声明）');",
'  }',
"  assert.deepEqual(bad, [], '★以下出题器无法测严格分母：' + bad.join('；'));",
"  assert.equal(GENS.length, 5, '出题器清单应为 5 个（新增时须同步本测试）');",
'});',
];
fs.appendFileSync(P, lines.join('\n') + '\n', 'utf8');
console.log('审计测试已加');
