'use strict';
// meihua.test.cjs — 梅花易数确定层单元测试（node 直接跑，零依赖 assert）
// 锚点卦均经手工推演：贲(7,3)/剥(8,16)/噬嗑(3,3)，互变卦推导见各用例注释。
const assert = require('assert');
const m = require('./meihua.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS | ' + name); pass++; }
  catch (e) { console.log('FAIL | ' + name + ' | ' + e.message); fail++; }
}

// ---- 1. 常规起卦：qiGuaByNumbers(7,3) ----
// 上卦 7%8=7→艮，下卦 3%8=3→离 → 山火贲；动爻 (7+3)%6=4
const g = m.qiGuaByNumbers(7, 3);
t('T1 常规起卦：本卦=山火贲', () => {
  assert.strictEqual(g.benGua.name, '贲');
  assert.strictEqual(g.benGua.fullName, '山火贲');
  assert.strictEqual(g.benGua.upper, '艮');
  assert.strictEqual(g.benGua.lower, '离');
});
t('T2 贲卦爻画：[1,0,1,0,0,1]（自下而上）', () => {
  assert.deepStrictEqual(g.benGua.yao, [1, 0, 1, 0, 0, 1]);
});
t('T3 动爻=4', () => assert.strictEqual(g.dongYao, 4));
// 互卦：本卦 2,3,4 爻 [0,1,0]=坎 为下卦；3,4,5 爻 [1,0,0]=震 为上卦 → 雷水解
t('T4 互卦（手工推演）=雷水解', () => {
  assert.strictEqual(g.huGua.name, '解');
  assert.strictEqual(g.huGua.fullName, '雷水解');
});
// 变卦：第 4 爻（阴）变阳 → [1,0,1,1,0,1] → 下离上离 → 离为火
t('T5 变卦（手工推演）=离为火', () => {
  assert.strictEqual(g.bianGua.name, '离');
  assert.strictEqual(g.bianGua.fullName, '离为火');
});
// 体用：动爻 4 属上卦 → 用=艮(土)；体=离(火)；火生土 → 体生用
t('T6 体用：体=离火，用=艮土，体生用', () => {
  assert.strictEqual(g.tiYongRelation, '体生用');
  assert.ok(JSON.stringify(g.ti).includes('火'), '体应含火五行: ' + JSON.stringify(g.ti));
  assert.ok(JSON.stringify(g.yong).includes('土'), '用应含土五行: ' + JSON.stringify(g.yong));
});

// ---- 2. 余数 0 边界：%8=0 取 8 ----
t('T7 边界 %8=0：(8,16)→上坤下坤=坤为地，动爻 24%6=0→6', () => {
  const k = m.qiGuaByNumbers(8, 16);
  assert.strictEqual(k.benGua.name, '坤');
  assert.strictEqual(k.benGua.fullName, '坤为地');
  assert.strictEqual(k.dongYao, 6);
  // 变卦：上爻（阴）变阳 → [0,0,0,0,0,1] → 下坤上艮 = 山地剥
  assert.strictEqual(k.bianGua.name, '剥');
});

// ---- 3. 余数 0 边界：%6=0 取 6 ----
t('T8 边界 %6=0：(3,3)→离为火，上爻动，变卦=火雷噬嗑', () => {
  const l = m.qiGuaByNumbers(3, 3);
  assert.strictEqual(l.benGua.name, '离');
  assert.strictEqual(l.dongYao, 6);
  // 上爻（阳）变阴 → [1,0,1,1,0,0] → 下离(前三位)[1,0,1] 上震(后三位)[1,0,0] = 雷火丰
  assert.strictEqual(l.bianGua.name, '丰');
  assert.strictEqual(l.bianGua.fullName, '雷火丰');
});

// ---- 4. 五行生克（循环金水木火土金）----
t('T9 五行相生：水生木/木生火', () => {
  assert.strictEqual(m.wuXingRelation('水', '木'), '我生');
  assert.strictEqual(m.wuXingRelation('木', '水'), '生我');
});
t('T10 五行相克：火克金/金克火（克我）', () => {
  assert.strictEqual(m.wuXingRelation('火', '金'), '我克');
  assert.strictEqual(m.wuXingRelation('金', '火'), '克我');
});
t('T11 比和与体用五分类', () => {
  assert.strictEqual(m.wuXingRelation('土', '土'), '比和');
  assert.strictEqual(m.tiYongGuanxi('火', '金'), '体克用');
  assert.strictEqual(m.tiYongGuanxi('金', '火'), '用克体');
  assert.strictEqual(m.tiYongGuanxi('土', '土'), '体用比和');
});

// ---- 5. 64 卦名抽查 ----
t('T12 卦名抽查：上离下巽=鼎（规格例子）', () => {
  assert.strictEqual(m.makeGua('离', '巽').name, '鼎');
});
t('T13 卦名抽查：天地否/地天泰/水雷屯', () => {
  assert.strictEqual(m.makeGua('乾', '坤').name, '否');
  assert.strictEqual(m.makeGua('坤', '乾').name, '泰');
  assert.strictEqual(m.makeGua('坎', '震').name, '屯');
});
t('T14 64 卦名表完备性：8×8 全有卦名', () => {
  const uppers = ['乾','兑','离','震','巽','坎','艮','坤'];
  let count = 0;
  for (const u of uppers) for (const l of uppers) {
    const n = m.makeGua(u, l).name;
    assert.ok(n && n.length >= 1, u + '+' + l + ' 缺卦名');
    count++;
  }
  assert.strictEqual(count, 64);
});

// ---- 6. 总数起卦 ----
t('T15 qiGuaByTotal(10) 默认对半拆：(5,5)→巽为风', () => {
  const s = m.qiGuaByTotal(10);
  assert.strictEqual(s.benGua.name, '巽');
  assert.strictEqual(s.dongYao, 10 % 6 === 0 ? 6 : 10 % 6);
});
t('T16 qiGuaByTotal 自定义拆法：(10,[7,3]) 等价 (7,3)=贲', () => {
  const s = m.qiGuaByTotal(10, () => [7, 3]);
  assert.strictEqual(s.benGua.name, '贲');
});

// ---- 7. 非法输入 ----
t('T17 非法输入全部拒绝', () => {
  assert.throws(() => m.qiGuaByNumbers(0, 1), /正整数|Range|Error/);
  assert.throws(() => m.qiGuaByNumbers(-1, 1), /正整数|Range|Error/);
  assert.throws(() => m.qiGuaByTotal(1), /Range/);
  assert.throws(() => m.deriveGua('离', '巽', 7), /Range/);
  assert.throws(() => m.qiGuaByTotal(10, () => [1]), /TypeError/);
});

console.log('-----------------------------');
console.log('TOTAL: ' + (pass + fail) + ' | PASS: ' + pass + ' | FAIL: ' + fail);
process.exit(fail > 0 ? 1 : 0);
