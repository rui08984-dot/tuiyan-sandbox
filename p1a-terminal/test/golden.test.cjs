'use strict';
// p1a-terminal · test/golden.test.cjs —— golden 回归集（红队 RD1/YD1 核心）
// 素材：docs/sandbox/p0-replay/runs/lyingman-s02e01/day1-exp.md / day2-exp.md / day3-exp.md（P0 盲测，人类核验，语义有效率 100%）
// 口径：只取【纯结构类】矛盾（对跳类 / 声称vs行动类 / 死者活跃类）转成 claims/actions 灌内存库，
//       断言比对器重现率 ≥80%（RD1 gate）。欠定度类/语义类矛盾（如 6号遗言狼刀指令、10号退水再跳、
//       4/8 双弃票、4保8/8踩4）不在比对器职责内，不入分母，且作为负例断言不得被字面误报。
// E 编号 = P0 档案事件号；事件/声称/行动按档案时序灌入，seq 由 db 层自动分配。
const assert = require('assert');
const dbm = require('../src/db');
const { findContradictions } = require('../src/engine');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; failures.push(name); console.log('FAIL  ' + name); console.log('      ' + (e && e.message)); }
}

const db = dbm.openDb(':memory:');
const game = dbm.createGame(db, { name: 'lyingman-s02e01', game_type: 'werewolf', player_count: 12 });
for (let s = 1; s <= 12; s++) dbm.addPlayer(db, { game_id: game.id, seat: s, name: s + '号' });
const gid = game.id;
function ev(fields) { return dbm.addEvent(db, Object.assign({ game_id: gid }, fields)); }
function cl(eventId, arr) { return dbm.addClaims(db, eventId, arr); }

// ── 时序灌库（day1 → day3）────────────────────────────────────────
const E1 = ev({ day: 1, phase: 'night', type: 'death', actor_seat: 2, raw_text: '夜1：2号死亡' }); // day1 矛盾背景（死者2）
const E7 = ev({ day: 1, phase: 'day', type: 'claim', actor_seat: 6, raw_text: '6号：我是女巫' }); // E-7
const cE7 = cl(E7.id, [{ seat: 6, subject_seat: 6, predicate: 'claims_role', object: '女巫' }])[0];
const E8 = ev({ day: 1, phase: 'day', type: 'claim', actor_seat: 10, raw_text: '10号：我才是女巫，6号是挡刀' }); // E-8
const cE8 = cl(E8.id, [{ seat: 10, subject_seat: 10, predicate: 'claims_role', object: '女巫' }])[0];
const E10 = ev({ day: 1, phase: 'day', type: 'claim', actor_seat: 9, raw_text: '9号警徽流：下一轮验4号' }); // E-10（预告 → said 谓词）
const cE10 = cl(E10.id, [{ seat: 9, subject_seat: 9, predicate: 'said', object: 'check:4-next' }])[0];
const E12 = ev({ day: 1, phase: 'dusk', type: 'claim', actor_seat: 6, raw_text: '6号遗言：7号才是真女巫，10号只是挡刀' }); // E-12
const cE12 = cl(E12.id, [{ seat: 6, subject_seat: 7, predicate: 'is_role', object: '女巫' }])[0];
const E13 = ev({ day: 2, phase: 'night', type: 'death', actor_seat: 7, raw_text: '夜2：7号死亡' }); // E-13（死者7）
const E16 = ev({ day: 2, phase: 'day', type: 'statement', actor_seat: 2, raw_text: '民2（已死）昼2发言（档案错记）' }); // E-16
const cE16 = cl(E16.id, [{ seat: 2, subject_seat: 2, predicate: 'said', object: '昼2发言内容' }])[0];
const E17 = ev({ day: 2, phase: 'day', type: 'claim', actor_seat: 4, raw_text: '4号：警长昨晚验的肯定是我' }); // E-17
const cE17 = cl(E17.id, [{ seat: 4, subject_seat: 9, predicate: 'did_action', object: 'check:4' }])[0];
const E19 = ev({ day: 2, phase: 'day', type: 'claim', actor_seat: 9, raw_text: '9号：昨夜验的是8号，金水' }); // E-19
const c19 = cl(E19.id, [
  { seat: 9, subject_seat: 9, predicate: 'did_action', object: 'check:8' },
  { seat: 9, subject_seat: 8, predicate: 'is_good', object: 'true' },
]);
const cE19 = c19[0]; const cE19gold = c19[1];
const E20 = ev({ day: 2, phase: 'dusk', type: 'vote', actor_seat: 7, raw_text: '民7（已死）弃票（档案错记）' }); // E-20
const aE20 = dbm.addAction(db, { event_id: E20.id, seat: 7, action: 'abstain' });
const E27 = ev({ day: 3, phase: 'day', type: 'claim', actor_seat: 10, raw_text: '10号：我归票1号' }); // E-27
const cE27 = cl(E27.id, [{ seat: 10, subject_seat: 10, predicate: 'voted', object: '1' }])[0];
const E30 = ev({ day: 3, phase: 'dusk', type: 'vote', actor_seat: 10, raw_text: 'PK 票：10号改投11号' }); // E-30
const aE30 = dbm.addAction(db, { event_id: E30.id, seat: 10, action: 'vote', target_seat: 11 });

const claims = dbm.getClaims(db, gid);
const actions = dbm.getActions(db, gid);
const events = dbm.listEvents(db, gid);
const pairs = findContradictions(claims, actions, events);
console.log('比对器输出（' + pairs.length + ' 条）：');
for (const p of pairs) {
  console.log('  - ' + p.conflict_desc + ' | claim_a=' + p.claim_a + ' claim_b=' + p.claim_b + ' action_a=' + p.action_a + ' action_b=' + p.action_b);
}

function hasClaimPair(a, b) {
  return pairs.some(p => (p.claim_a === a && p.claim_b === b) || (p.claim_a === b && p.claim_b === a));
}
function inAnyPair(claimId) {
  return pairs.some(p => p.claim_a === claimId || p.claim_b === claimId);
}

// ── 6 条结构矛盾（分母；来自 golden 清单的人工结构化翻译）──────────
const REQUIRED = [
  ['G1 day1-2｜对跳类：6vs10 对跳女巫 [E-7,E-8]', () => assert.ok(hasClaimPair(cE7.id, cE8.id), '缺少对跳对 claim#' + cE7.id + '×#' + cE8.id)],
  ['G2 day1-4｜对跳类：6指7是真女巫 vs 10跳女巫 [E-12,E-8]', () => assert.ok(hasClaimPair(cE12.id, cE8.id), '缺少对跳对 claim#' + cE12.id + '×#' + cE8.id)],
  ['G3 day2-3/day3-②｜声vs声：4号自称被验 vs 9号说验的是8号 [E-17,E-19]', () => assert.ok(hasClaimPair(cE17.id, cE19.id), '缺少同日验人冲突 claim#' + cE17.id + '×#' + cE19.id)],
  ['G4 day3-④｜声vs行：10号归票1号 vs PK实投11号 [E-27,E-30]', () => assert.ok(pairs.some(p => p.claim_a === cE27.id && p.action_a === aE30.id), '缺少声称vs行动对 claim#' + cE27.id + '×action#' + aE30.id)],
  ['G5 day2-5｜死者活跃：死者2号昼2发言 [E-16]', () => assert.ok(pairs.some(p => p.claim_a === cE16.id && /\[死者活跃\]/.test(p.conflict_desc)), '死者2号新声称未被照录')],
  ['G6 day2-5｜死者活跃：死者7号弃票 [E-20]', () => assert.ok(pairs.some(p => p.action_a === aE20.id && /\[死者活跃\]/.test(p.conflict_desc)), '死者7号弃票未被照录')],
];
let matched = 0;
for (const [name, fn] of REQUIRED) {
  try { fn(); matched++; console.log('PASS  ' + name); }
  catch (e) { failed++; failures.push(name); console.log('FAIL  ' + name); console.log('      ' + (e && e.message)); }
}

// ── RD1/YD1 golden gate：结构矛盾重现率 ≥80%
const ratio = matched / REQUIRED.length;
try {
  assert.ok(ratio >= 0.8, 'golden gate 失败: 重现率 ' + (ratio * 100).toFixed(1) + '% < 80%');
  console.log('PASS  RD1/YD1 gate：结构矛盾重现率 ' + matched + '/' + REQUIRED.length + ' = ' + (ratio * 100).toFixed(1) + '% (≥80%)');
  passed++;
} catch (e) { failed++; failures.push('RD1/YD1 gate'); console.log('FAIL  RD1/YD1 gate'); console.log('      ' + (e && e.message)); }

// ── 负例（防过报）：欠定/语义类矛盾不得被字面误报 ─────────────────
test('N1 跨日改口不报：E-10预告验4(said) → E-19实报验8(did_action) 无冲突（day2-1 不在结构分母）', () => {
  assert.ok(!inAnyPair(cE10.id), 'E-10 预告声称被误报: ' + JSON.stringify(pairs.filter(p => p.claim_a === cE10.id || p.claim_b === cE10.id)));
});
test('N2 金水声称不报：E-19 整排金水(is_good 8号) 无冲突对象', () => {
  assert.ok(!inAnyPair(cE19gold.id), '金水声称被误报');
});
test('N3 语义/欠定类不字面误报：6号遗言狼刀指令、10号退水再跳、4/8双弃票、4保8/8踩4（未灌库）', () => {
  for (const p of pairs) {
    assert.ok(/^\[(对跳|自相矛盾|自相矛盾·同日行动声称|声称vs行动|死者活跃)\]/.test(p.conflict_desc), '未知类型输出: ' + p.conflict_desc);
  }
  assert.ok(pairs.length >= 6 && pairs.length <= 12, '输出条数异常: ' + pairs.length + '（对跳簇应有 3 对 + 验人 1 + 声行 1 + 死者 2 = 7 左右）');
});
test('N4 附带真阳性：6号自称女巫(E-7) vs 6号称7号真女巫(E-12) 同跳一角色 → 也应报对跳', () => {
  assert.ok(hasClaimPair(cE7.id, cE12.id), '缺对跳对 claim#' + cE7.id + '×#' + cE12.id);
});

console.log('──────────────────────────────');
console.log('golden.test: ' + passed + ' passed, ' + failed + ' failed（结构矛盾重现 ' + matched + '/' + REQUIRED.length + ' = ' + (ratio * 100).toFixed(1) + '%，gate ≥80%）');
dbm.closeDb(db);
if (failed > 0) { console.log('FAILED: ' + failures.join(' | ')); process.exit(1); }

