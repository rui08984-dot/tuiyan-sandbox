'use strict';
/**
 * p1b/test/l1-proc.test.cjs —— L1 引擎（proc_calc 程序复算）回归（2026-09-14 新增）
 *
 * 锁四点：
 *   ① 六条规则族各自的计算语义（含 true/false 两侧），0/1 计算结论（不是概率）；
 *   ② 派生器：计票解析（ranked/sum）、存活者数（玩家数 − 计票前死亡数）、day1 身份声称计数；
 *   ③ 宁缺毋滥：未收录题面 / 缺计票事件 / 未载入 claims ⇒ 明确不收；
 *   ④ 输出契约：value ∈ {0,1} 且 p=value（供统一计分器；L1 的 Brier 语义＝计算错误率）。
 * 零网络、零 db、纯函数。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { procCalc, derive, RULES } = require(path.join(__dirname, '..', 'src', 'engines', 'l1_proc'));

// 合成记录：一夜狼 6 人局；4 号夜 1 死；计票 {"3":4,"5":1}（总 5 票 = 存活 5 ⇒ 无弃票）
const EV = [
  { seq: 1, day: 1, phase: 'night', type: 'system', raw_text: '夜幕降临' },
  { seq: 2, day: 1, phase: 'day', type: 'death', actor_seat: 66, raw_text: '天亮了。公布夜 1 死亡：4 号死亡' },
  { seq: 3, day: 1, phase: 'day', type: 'statement', raw_text: '1 号：我平民' },
  { seq: 8, day: 1, phase: 'day', type: 'system', raw_text: '发言结束，全体投票放逐。' },
  { seq: 9, day: 1, phase: 'dusk', type: 'death', actor_seat: 65, raw_text: '计票：{"3":4,"5":1}。3 号被放逐出局。' },
];
const CL = Array.from({ length: 10 }, () => ({ day: 1, predicate: 'claims_role' })).concat([{ day: 2, predicate: 'claims_role' }]);

test('① 六条规则族的计算语义（0/1 结论；不是概率）', () => {
  const cases = [
    ['本局首夜平安（无人死亡）', 0], // 有夜 1 死亡 ⇒ 不平安
    ['本局放逐计票中，最高票与次高票之差不超过 1 票', 0], // 4−1=3 > 1
    ['本局放逐投票无弃票（全部存活者均投出有效票）', 1], // 总票 5 == 存活 5
    ['本局放逐投票最高票数不少于 4 票', 1], // 首位 4 ≥ 4
    ['截至第 1 天发言结束，全场累计身份声称（is_wolf/is_good/claims_role）不少于 10 条', 1], // day1 恰 10 条
    ['本局放逐计票最高票唯一（未触发破平）', 1], // 4 > 1
  ];
  for (const [stmt, want] of cases) {
    const out = procCalc({ statement: stmt, events: EV, claims: CL, playerCount: 6 });
    assert.equal(out.ok, true, stmt);
    assert.equal(out.value, want, stmt + ' ⇒ ' + want);
    assert.equal(out.p, out.value, 'p 与 value 一致（统一计分器口径）');
    assert.ok(/计算结论/.test(out.note), 'note 明说"计算结论不是概率"');
  }
  // 反面：把死亡事件与计票改掉，结论应翻转
  const ev2 = EV.filter((e) => e.type !== 'death' || e.seq === 9); // 去掉夜 1 死亡
  assert.equal(procCalc({ statement: '本局首夜平安（无人死亡）', events: ev2, claims: [], playerCount: 6 }).value, 1);
  const ev3 = EV.map((e) => (e.seq === 9 ? { seq: 9, day: 1, phase: 'dusk', type: 'death', raw_text: '计票：{"3":3}。3 号出局。' } : e));
  assert.equal(procCalc({ statement: '本局放逐投票无弃票（全部存活者均投出有效票）', events: ev3, claims: [], playerCount: 6 }).value, 0);
  assert.equal(procCalc({ statement: '本局放逐投票最高票数不少于 4 票', events: ev3, claims: [], playerCount: 6 }).value, 0);
});

test('② 派生器：计票 ranked/sum、存活者数、day1 声称计数', () => {
  const d = derive({ events: EV, claims: CL, playerCount: 6 });
  assert.deepEqual(d.tally.ranked, [4, 1], '计票排名降序');
  assert.equal(d.tally.sum, 5, '总票数=各目标之和');
  assert.equal(d.tally.entries, 2, '条目数=不同目标数');
  assert.equal(d.alive, 5, '存活=6−1（计票前死亡）');
  assert.equal(d.day1Claims, 10, 'day1 身份声称计 10 条（day2 不计）');
  assert.equal(d.hasDeathDay1, true);
});

test('③ 宁缺毋滥：未收录题面 / 缺计票 / 未载入 claims ⇒ 明确不收', () => {
  const un = procCalc({ statement: '某公司会不会拍板 A 方案', events: EV, claims: CL, playerCount: 6 });
  assert.deepEqual({ ok: un.ok, status: un.status }, { ok: false, status: 'rule_unmatched' });
  const noTally = procCalc({ statement: '本局放逐投票最高票数不少于 4 票', events: EV.filter((e) => e.seq !== 9), claims: CL, playerCount: 6 });
  assert.deepEqual({ ok: noTally.ok, status: noTally.status }, { ok: false, status: 'missing_input' });
  const noClaims = procCalc({ statement: '截至第 1 天发言结束，全场累计身份声称（is_wolf/is_good/claims_role）不少于 10 条', events: EV, playerCount: 6 });
  assert.deepEqual({ ok: noClaims.ok, status: noClaims.status }, { ok: false, status: 'missing_input' }, 'claims 未载入 ≠ 0 条');
  assert.ok(RULES.length === 6, '规则族 6 条');
});
