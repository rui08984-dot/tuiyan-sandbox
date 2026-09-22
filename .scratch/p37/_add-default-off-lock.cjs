'use strict';
// 一次性：加「留痕旁路默认关」全局锁
const fs = require('fs');
const P = 'p1b/test/role3-freeze.test.cjs';
const lines = [
'',
"test('⑨ ★留痕旁路「默认关」全局锁（防改成默认开）', () => {",
'  // 背景（2026-09-22）：评估过「让出题器**默认**产出留痕」——**否决**。理由：',
'  //   那会让**每次跑出题器**（含测试调用）都写仓库产物 ⇒ **正是本日刚修的缺陷模式**（d74bb81）。',
'  //   正确姿势＝由调用方显式传 --record-candidates（当前设计）。本锁防后人「好心」改成默认开。',
"  const GENS = ['corpus-sources-b4', 'corpus-thicken', 'role3-utype', 'calendar-questions'];",
'  const bad = [];',
'  for (const g of GENS) {',
"    const p = path.join(ROOT, 'p1b/scripts/' + g + '.cjs');",
"    if (!fs.existsSync(p)) { bad.push(g + ' 脚本不存在'); continue; }",
"    const t = fs.readFileSync(p, 'utf8');",
'    // ★须有「默认关」守卫：recDrop 首行 return（!REC_PATH）',
"    if (!/function recDrop\\(stage, reason, info\\) \\{ if \\(!REC_PATH\\) return;/.test(t)) {",
"      bad.push(g + ' 缺默认关守卫（recDrop 须在 !REC_PATH 时立即 return）');",
'    }',
'  }',
"  assert.deepEqual(bad, [], '★以下出题器的留痕旁路可能被改成默认开（会写仓库产物）：' + bad.join('；'));",
'});',
];
fs.appendFileSync(P, lines.join('\n') + '\n', 'utf8');
console.log('默认关全局锁已加');
