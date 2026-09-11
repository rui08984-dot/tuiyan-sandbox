'use strict';
// P1a CLI 交互层（B 路）测试 —— 全 mock（_mock_db + mock llm），零真实 API、零网络
const { test } = require('node:test');
const assert = require('node:assert');
const { createCli } = require('../src/cli.js');
const { createMockDb } = require('../src/_mock_db.js');

function capture() {
  const buf = [];
  return { buf, out: { write: (s) => buf.push(s) }, get text() { return buf.join(''); } };
}

function makeLlm(overrides) {
  const o = overrides || {};
  const calls = { extract: 0, advisor: 0 };
  const llm = {
    calls,
    extract: o.extract || (async (input) => ({
      event: { day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: input.text },
      claims: [{ subject_seat: 5, predicate: 'is_wolf', object: '狼人' }],
      action: null,
    })),
    advisor: o.advisor,
  };
  return llm;
}

function baseDeps(opts) {
  const o = opts || {};
  const db = createMockDb();
  const cap = capture();
  const deps = {
    db, llm: o.llm || makeLlm(), cards: o.cards || null,
    inputs: o.inputs || [], output: cap.out, errput: cap.out,
  };
  return { db, cap, deps };
}

async function run(deps, argv) {
  const cli = createCli(deps);
  return await cli.run(argv);
}

function seedGame(db) {
  db.createGame('第一局', 'werewolf', 8);
  const e1 = db.addEvent({ game_id: 1, day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: '3号跳预言家验5号是狼' });
  const c1 = db.addClaim({ event_id: e1.id, seat: 3, subject_seat: 5, predicate: 'is_wolf', object: '狼人', confirmed_by_user: 1 });
  const e2 = db.addEvent({ game_id: 1, day: 1, phase: 'night', type: 'action_reveal', actor_seat: 5, raw_text: '5号自称守人' });
  const c2 = db.addClaim({ event_id: e2.id, seat: 5, subject_seat: 5, predicate: 'claims_role', object: '守人', confirmed_by_user: 1 });
  const a1 = db.addAction({ event_id: e1.id, seat: 3, action: 'check_target', target_seat: 5, result: null });
  return { e1, e2, c1, c2, a1 };
}

test('T1 new：创建局并播种席位，非法类型被拒', async () => {
  const { db, cap, deps } = baseDeps();
  const code = await run(deps, ['new', '第一局', 'werewolf', '8']);
  assert.strictEqual(code, 0);
  assert.match(cap.text, /局 1「第一局」已创建/);
  const g = db.getGame(1);
  assert.strictEqual(g.player_count, 8);
  assert.strictEqual(db.getPlayers(1).length, 8);
  const code2 = await run(deps, ['new', '坏局', 'mahjong', '8']);
  assert.strictEqual(code2, 1);
  assert.match(cap.text, /类型「mahjong」非法/);
});

test('T2 add 确认流全链：回显卡片+上下文摘要+逐字段键控+confirmed_by_user=1 入库+原文不可改写', async () => {
  const { db, cap, deps } = baseDeps({
    // 行为人↵ 声称对象↵ 行动人↵ 行动目标↵ 最终确认↵
    inputs: ['', '', '', '', ''],
    llm: makeLlm({ extract: async (input) => ({
      event: { day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: input.text },
      claims: [{ subject_seat: 5, predicate: 'is_wolf', object: '狼人' }],
      action: { seat: 3, action: 'check_target', target_seat: 5, result: null },
    }) }),
  });
  db.createGame('局A', 'werewolf', 8);
  const code = await run(deps, ['add', '1', '3号跳预言家，说验了5号是狼']);
  assert.strictEqual(code, 0);
  const t = cap.text;
  assert.match(t, /抽取确认卡/);
  assert.match(t, /事件原文: 3号跳预言家，说验了5号是狼/);
  assert.match(t, /上下文摘要/);
  assert.match(t, /涉及席位: 3，正确请回车，否则输入正确席位号/);
  assert.match(t, /涉及席位: 5，正确请回车，否则输入正确席位号/);
  const ev = db._debug.events[0];
  assert.strictEqual(ev.raw_text, '3号跳预言家，说验了5号是狼', 'raw_text=用户原话');
  assert.strictEqual(ev.actor_seat, 3);
  assert.strictEqual(ev.seq, 1);
  const c = db._debug.claims[0];
  assert.strictEqual(c.confirmed_by_user, 1, '全部确认后才置 1');
  assert.strictEqual(c.seat, 3);
  assert.strictEqual(c.subject_seat, 5);
  assert.strictEqual(c.extracted_by, 'llm');
  const a = db._debug.actions[0];
  assert.strictEqual(a.seat, 3);
  assert.strictEqual(a.target_seat, 5);
  assert.match(t, /confirmed_by_user=1/);
});

test('T3 seat 键控：非整数/越界席位被拒并重问，原席位保留', async () => {
  const { db, cap, deps } = baseDeps({ inputs: ['abc', '99', '', '', ''] });
  db.createGame('局A', 'werewolf', 8);
  const code = await run(deps, ['add', '1', '3号说5号是狼']);
  assert.strictEqual(code, 0);
  const t = cap.text;
  assert.match(t, /无效席位「abc」/);
  assert.match(t, /无效席位「99」/);
  assert.strictEqual(db._debug.events[0].actor_seat, 3);
  assert.strictEqual(db._debug.claims[0].subject_seat, 5);
});

test('T4 add YD5：席位修改后自动重新回显一轮，修正值入库', async () => {
  const { db, cap, deps } = baseDeps({ inputs: ['', '6', '', '', ''] });
  db.createGame('局A', 'werewolf', 8);
  const code = await run(deps, ['add', '1', '3号说5号是狼']);
  assert.strictEqual(code, 0);
  const t = cap.text;
  assert.strictEqual((t.match(/抽取确认卡/g) || []).length, 2, '应回显两轮卡片');
  assert.match(t, /重新回显一轮/);
  assert.strictEqual(db._debug.claims[0].subject_seat, 6, '修正后的席位入库');
  assert.strictEqual(db._debug.claims[0].confirmed_by_user, 1);
});

test('T5 edit：claim object 修正生效置确认；action 目标/结果修正；未知 id 报错', async () => {
  const { db, cap, deps } = baseDeps();
  seedGame(db);
  let code = await run(deps, ['edit', 'c1', '金水，5号是好人']);
  assert.strictEqual(code, 0);
  assert.strictEqual(db.getClaim(1).object, '金水，5号是好人');
  assert.strictEqual(db.getClaim(1).confirmed_by_user, 1);
  code = await run(deps, ['edit', 'a1', '7']);
  assert.strictEqual(code, 0);
  assert.strictEqual(db.getAction(1).target_seat, 7);
  code = await run(deps, ['edit', 'a1', '99']);
  assert.strictEqual(code, 1, '越界目标席位被拒');
  assert.match(cap.text, /目标席位 99 不是已存在玩家/);
  code = await run(deps, ['edit', 'a1', '验人结果存疑']);
  assert.strictEqual(db.getAction(1).result, '验人结果存疑');
  code = await run(deps, ['edit', 'c99', 'x']);
  assert.strictEqual(code, 1);
  assert.match(cap.text, /c99 不存在/);
  code = await run(deps, ['edit', 'zz1', 'x']);
  assert.strictEqual(code, 1);
  assert.match(cap.text, /id「zz1」非法/);
});

test('T6 retract：软删保留原始行，list/export 不再纳入，未知 id 报错', async () => {
  const { db, cap, deps } = baseDeps();
  seedGame(db);
  let code = await run(deps, ['retract', 'c1']);
  assert.strictEqual(code, 0);
  const row = db.getClaim(1);
  assert.strictEqual(row.retracted, 1, '软删=标记非物理删除');
  assert.strictEqual(row.object, '狼人', '原值仍在');
  code = await run(deps, ['list', '1']);
  assert.strictEqual(code, 0);
  assert.ok(!cap.text.includes('狼人'), 'list 不再显示已撤回声称');
  cap.buf.length = 0;
  code = await run(deps, ['export', '1']);
  assert.strictEqual(code, 0);
  const exported = JSON.parse(cap.text);
  assert.strictEqual(exported.claims.length, 1, '导出只剩未撤回的 c2');
  assert.strictEqual(exported.meta.retracted_claims, 1);
  code = await run(deps, ['retract', 'c99']);
  assert.strictEqual(code, 1);
  assert.match(cap.text, /c99 不存在/);
});

test('T7 day：局不存在/无事件 → 明确报错退出码 1，不崩溃不调 LLM', async () => {
  const { db, cap, deps } = baseDeps();
  let advisorCalled = 0;
  deps.llm = makeLlm({ advisor: async () => { advisorCalled++; return { contradictions: [], hypotheses: [], checkpoints: [] }; } });
  let code = await run(deps, ['day', '999', '1']);
  assert.strictEqual(code, 1);
  assert.match(cap.text, /局 999 不存在/);
  db.createGame('空局', 'botc', 6);
  code = await run(deps, ['day', '1', '2']);
  assert.strictEqual(code, 1);
  assert.match(cap.text, /没有任何事件记录/);
  assert.strictEqual(advisorCalled, 0, '缺数据时不应调用 LLM');
});

test('T8 day：参谋卡校验通过 → 降级渲染三件套 + 回存', async () => {
  const { db, cap, deps } = baseDeps();
  seedGame(db);
  deps.llm = makeLlm({ advisor: async () => ({
    contradictions: [{ pair_id: 'c1:a1', underdetermination: 'mid', innocent_explanations: ['3号可能记错席位'], claim_a: 1, action_a: 1 }],
    hypotheses: [{ content: '3号为狼踩5号', stance: { '3': 'wolf_suspect', '5': 'good_believe' }, support_events: [1], oppose_events: [2], tendency: 'mid' }],
    checkpoints: [{ text: '看5号夜晚是否倒牌', resolves: [0] }],
  }) });
  const code = await run(deps, ['day', '1', '1']);
  assert.strictEqual(code, 0);
  const t = cap.text;
  assert.match(t, /参谋卡（思路非答案）/);
  assert.match(t, /【矛盾点】1 条/);
  assert.match(t, /【竞争假设】1 套/);
  assert.match(t, /【验证点】1 条/);
  assert.match(t, /无辜解释1: 3号可能记错席位/);
  assert.strictEqual(db._debug.contradictions.length, 1, '参谋卡已回存');
  assert.strictEqual(db._debug.hypotheses.length, 1, '假设已回存');
});

test('T9 day 自洽校验：good_believe 玩家入嫌疑 Top → 拒绝渲染不回存退出码 1', async () => {
  const { db, cap, deps } = baseDeps();
  seedGame(db);
  deps.llm = makeLlm({ advisor: async () => ({
    contradictions: [],
    hypotheses: [{ content: '5号为好人', stance: { '5': 'good_believe', suspect_top: [5, 2] }, support_events: [], oppose_events: [], tendency: 'strong' }],
    checkpoints: [],
  }) });
  const code = await run(deps, ['day', '1', '1']);
  assert.strictEqual(code, 1);
  assert.match(cap.text, /机械自洽校验失败/);
  assert.match(cap.text, /good_believe 却进入嫌疑 Top/);
  assert.strictEqual(db._debug.contradictions.length, 0, '不回存');
  assert.strictEqual(db._debug.hypotheses.length, 0, '不回存');
});

test('T10 day 自洽校验：引用不存在的 c/a id、无辜解释为空 → 各自拦截', async () => {
  const { db, cap, deps } = baseDeps();
  seedGame(db);
  deps.llm = makeLlm({ advisor: async () => ({
    contradictions: [{ pair_id: 'c99:a1', underdetermination: 'high', innocent_explanations: ['口误'] }],
    hypotheses: [], checkpoints: [],
  }) });
  let code = await run(deps, ['day', '1', '1']);
  assert.strictEqual(code, 1);
  assert.match(cap.text, /claim#99 不存在于库/);
  deps.llm = makeLlm({ advisor: async () => ({
    contradictions: [{ pair_id: 'c1:a1', underdetermination: 'high', innocent_explanations: [] }],
    hypotheses: [], checkpoints: [],
  }) });
  code = await run(deps, ['day', '1', '1']);
  assert.strictEqual(code, 1);
  assert.match(cap.text, /innocent_explanations 为空/);
});

test('T11 路由：未知命令/空参数/help → 用法提示与正确退出码', async () => {
  const { cap, deps } = baseDeps();
  let code = await run(deps, ['bogus']);
  assert.strictEqual(code, 1);
  assert.match(cap.text, /未知命令「bogus」/);
  code = await run(deps, ['add', '1']);
  assert.strictEqual(code, 1);
  assert.match(cap.text, /用法: add/);
  code = await run(deps, []);
  assert.strictEqual(code, 1);
  cap.buf.length = 0;
  code = await run(deps, ['help']);
  assert.strictEqual(code, 0);
  assert.match(cap.text, /P1a 推演沙盘 CLI/);
});

test('T12 add 中止：q 放弃与输入流耗尽均不写库（退出码 2）', async () => {
  const { db, cap, deps } = baseDeps({ inputs: ['q'] });
  db.createGame('局A', 'werewolf', 8);
  let code = await run(deps, ['add', '1', '3号说5号是狼']);
  assert.strictEqual(code, 2);
  assert.match(cap.text, /已放弃本次录入/);
  assert.strictEqual(db._debug.events.length, 0, '未写库');
  const again = baseDeps({ inputs: [''] });
  again.db.createGame('局B', 'werewolf', 8);
  code = await run(again.deps, ['add', '1', '3号说5号是狼']);
  assert.strictEqual(code, 2);
  assert.match(again.cap.text, /输入流结束/);
  assert.strictEqual(again.db._debug.events.length, 0, '未写库');
});
