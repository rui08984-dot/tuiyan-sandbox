'use strict';
// p1a-terminal · test/engine.test.cjs —— 矛盾比对器单元测试（契约 §4；零依赖，node 直接跑）
const assert = require('assert');
const { findContradictions } = require('../src/engine');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; failures.push(name); console.log('FAIL  ' + name); console.log('      ' + (e && e.message)); }
}
// fixture 助手：id/event_id/day 直接内联（dayOf 引擎会回查 event）
function claim(id, seat, subject, predicate, object, day, event_id) {
  return { id, event_id: event_id === undefined ? id : event_id, seat, subject_seat: subject, predicate, object, day };
}
function action(id, seat, kind, target, day, event_id) {
  return { id, event_id: event_id === undefined ? id : event_id, seat, action: kind, target_seat: target === undefined ? null : target, day };
}
function event(id, day, phase, seq, type, actor) {
  return { id, day, phase, seq, type, actor_seat: actor === undefined ? null : actor };
}
function hasClaimPair(pairs, a, b) {
  return pairs.some(p => (p.claim_a === a && p.claim_b === b) || (p.claim_a === b && p.claim_b === a));
}

// ── T1 对跳：同 predicate 同唯一角色，不同 subject_seat（契约「对跳」）
test('T1 对跳：6号与10号同跳女巫 → 报冲突', () => {
  const cs = [claim(1, 6, 6, 'claims_role', '女巫', 1), claim(2, 10, 10, 'claims_role', '女巫', 1)];
  const es = [event(1, 1, 'day', 1, 'claim', 6), event(2, 1, 'day', 2, 'claim', 10)];
  const pairs = findContradictions(cs, [], es);
  assert.ok(hasClaimPair(pairs, 1, 2), '应含 claim#1×claim#2 对，实得: ' + JSON.stringify(pairs));
  assert.ok(pairs.every(p => p.conflict_desc.includes('[对跳]')), 'desc 应带 [对跳] 前缀');
});

// ── T2 非唯一角色不构成对跳（民可多人）
test('T2 非唯一角色：两人同称民 → 不报', () => {
  const cs = [claim(1, 6, 6, 'claims_role', '民', 1), claim(2, 10, 10, 'claims_role', '民', 1)];
  const es = [event(1, 1, 'day', 1, 'claim', 6), event(2, 1, 'day', 2, 'claim', 10)];
  assert.deepStrictEqual(findContradictions(cs, [], es), []);
});

// ── T3 身份自相矛盾不限日（改跳身份是真矛盾）
test('T3 同一人 day1 称女巫 day2 称预言家 → 报冲突', () => {
  const cs = [claim(1, 6, 6, 'claims_role', '女巫', 1), claim(2, 6, 6, 'claims_role', '预言家', 2)];
  const es = [event(1, 1, 'day', 1, 'claim', 6), event(2, 2, 'day', 2, 'claim', 6)];
  const pairs = findContradictions(cs, [], es);
  assert.ok(hasClaimPair(pairs, 1, 2), '应报身份改口: ' + JSON.stringify(pairs));
});

// ── T4 同日行动声称冲突（同 subject 同 predicate 不同 object）
test('T4 同日：9号自称验4 vs 验8 → 报冲突', () => {
  const cs = [claim(1, 9, 9, 'did_action', 'check:4', 2), claim(2, 9, 9, 'did_action', 'check:8', 2)];
  const es = [event(1, 2, 'day', 1, 'claim', 9), event(2, 2, 'day', 2, 'claim', 9)];
  const pairs = findContradictions(cs, [], es);
  assert.ok(hasClaimPair(pairs, 1, 2), '应报同日验人冲突: ' + JSON.stringify(pairs));
});

// ── T5 跨日改口不算字面冲突（不同夜槽位，预言家每晚验人属正常节奏）
test('T5 跨日：day1 验4 vs day2 验8 → 不报', () => {
  const cs = [claim(1, 9, 9, 'did_action', 'check:4', 1), claim(2, 9, 9, 'did_action', 'check:8', 2)];
  const es = [event(1, 1, 'day', 1, 'claim', 9), event(2, 2, 'day', 2, 'claim', 9)];
  assert.deepStrictEqual(findContradictions(cs, [], es), []);
});

// ── T6 重复声称不报冲突（同 object 去重）
test('T6 重复声称：验8说两遍/女巫跳两遍 → 不报', () => {
  const cs = [
    claim(1, 9, 9, 'did_action', 'check:8', 2),
    claim(2, 9, 9, 'did_action', 'check:8', 2),
    claim(3, 6, 6, 'claims_role', '女巫', 1),
    claim(4, 6, 6, 'claims_role', '女巫', 2),
  ];
  const es = [event(1, 2, 'day', 1, 'claim', 9), event(3, 1, 'day', 3, 'claim', 6), event(4, 2, 'day', 4, 'claim', 6)];
  assert.deepStrictEqual(findContradictions(cs, [], es), []);
});

// ── T7 谓词不同不算冲突（said 预告 vs did_action 实报；golden day2-1 的结构化负例）
test('T7 谓词不同：预告(said)验4 vs 实报(did_action)验8 → 不报', () => {
  const cs = [claim(1, 9, 9, 'said', 'check:4-next', 1), claim(2, 9, 9, 'did_action', 'check:8', 2)];
  const es = [event(1, 1, 'day', 1, 'claim', 9), event(2, 2, 'day', 2, 'claim', 9)];
  assert.deepStrictEqual(findContradictions(cs, [], es), []);
});
// ── T8 声称vs行动：投票声明与实投不符（golden day3-④ 同构）
test('T8 声称vs行动：声明投1 实投11 → 报冲突', () => {
  const cs = [claim(1, 10, 10, 'voted', '1', 3)];
  const as = [action(1, 10, 'vote', 11, 3)];
  const es = [event(1, 3, 'day', 1, 'claim', 10), event(2, 3, 'dusk', 2, 'vote', 10)];
  const pairs = findContradictions(cs, as, es);
  assert.strictEqual(pairs.length, 1, '应恰 1 对: ' + JSON.stringify(pairs));
  assert.strictEqual(pairs[0].claim_a, 1);
  assert.strictEqual(pairs[0].action_a, 1);
  assert.strictEqual(pairs[0].claim_b, null);
  assert.ok(pairs[0].conflict_desc.includes('[声称vs行动]'), 'desc 应带 [声称vs行动] 前缀');
});

// ── T9 声称vs行动：声称验8 而行动记录验11（契约 §4 原文例）
test('T9 声称vs行动：声称验8 行动记录验11 → 报冲突', () => {
  const cs = [claim(1, 9, 9, 'did_action', 'check:8', 2)];
  const as = [action(1, 9, 'check_target', 11, 2)];
  const es = [event(1, 2, 'day', 1, 'claim', 9), event(2, 2, 'night', 2, 'action_reveal', 9)];
  const pairs = findContradictions(cs, as, es);
  assert.strictEqual(pairs.length, 1, '应恰 1 对: ' + JSON.stringify(pairs));
  assert.strictEqual(pairs[0].claim_a, 1);
  assert.strictEqual(pairs[0].action_a, 1);
});

// ── T10 声称与行动一致 / 无行动记录 → 不报（缺席不算冲突）
test('T10 一致或缺席：验8+记录验8 / 声称验8无记录 → 不报', () => {
  const es = [event(1, 2, 'day', 1, 'claim', 9), event(2, 2, 'night', 2, 'action_reveal', 9)];
  const cs = [claim(1, 9, 9, 'did_action', 'check:8', 2)];
  assert.deepStrictEqual(findContradictions(cs, [action(1, 9, 'check_target', 8, 2, 2)], es), [], '一致时不报');
  assert.deepStrictEqual(findContradictions(cs, [], es), [], '无行动记录不报');
});

// ── T11 死者活跃：死亡后新 claim / 弃票行动 → 照录（golden day2-5 同构）
test('T11 死者活跃：死者2昼2发言 + 死者7弃票 → 报 2 条', () => {
  const es = [
    event(1, 1, 'night', 1, 'death', 2),
    event(2, 2, 'day', 2, 'statement', 2),
    event(3, 2, 'night', 3, 'death', 7),
    event(4, 2, 'dusk', 4, 'vote', 7),
  ];
  const cs = [claim(1, 2, 2, 'said', '昼2发言内容', 2, 2)];
  const as = [action(1, 7, 'abstain', null, 2, 4)];
  const pairs = findContradictions(cs, as, es);
  assert.strictEqual(pairs.length, 2, '应恰 2 条: ' + JSON.stringify(pairs));
  const deadClaim = pairs.find(p => p.claim_a === 1);
  const deadAction = pairs.find(p => p.action_a === 1);
  assert.ok(deadClaim && deadClaim.conflict_desc.includes('[死者活跃]'), '死者新声称应照录');
  assert.ok(deadAction && deadAction.conflict_desc.includes('[死者活跃]'), '死者投票行动应照录');
});

// ── T12 死前活动不报（死亡事件之前的发言/投票是正常的）
test('T12 死前活动：死亡事件之前的 claim → 不报', () => {
  const es = [event(1, 1, 'day', 1, 'statement', 3), event(2, 1, 'dusk', 2, 'death', 3)];
  const cs = [claim(1, 3, 3, 'said', '遗言前的正常发言', 1, 1)];
  assert.deepStrictEqual(findContradictions(cs, [], es), []);
});

// ── T13 无冲突返回空
test('T13 干净输入 → 返回空数组', () => {
  assert.deepStrictEqual(findContradictions([], [], []), []);
  const cs = [claim(1, 1, 1, 'claims_role', '民', 1)];
  const es = [event(1, 1, 'day', 1, 'claim', 1)];
  assert.deepStrictEqual(findContradictions(cs, [], es), []);
});

console.log('──────────────────────────────');
console.log('engine.test: ' + passed + ' passed, ' + failed + ' failed (共 13 用例)');
if (failed > 0) { console.log('FAILED: ' + failures.join(' | ')); process.exit(1); }

