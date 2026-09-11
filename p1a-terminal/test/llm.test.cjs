'use strict';
/**
 * p1a-terminal/test/llm.test.cjs — C 路 LLM 适配层测试（≥6 用例，全走 MOCK_MODE，零网络零依赖）
 * 运行：node test/llm.test.cjs
 * 覆盖：T1 抽取结构合规（schema+枚举+复合句拆分）｜T2 名单外 seat 丢弃+警告｜
 *       T3 RD1 无辜解释非空强校验+悬空 pair_id 剔除｜T4 JSON 损坏附错重试成功/重试耗尽抛错｜
 *       T5 假设 stance 完整性+自洽校验（good_believe 禁入 Top 区）｜
 *       T6 双模式切换（无 key=MOCK；假 key+注入式 base URL+注入 fetchImpl=LIVE 全链路，不发真实请求）｜
 *       T7 checkpoint resolves 下标重映射+死链删除｜T8 prompt 红线（RD1/参谋非判官）｜T9 输出与输入一一对应
 * 注意：全程不依赖 DEEPSEEK_API_KEY（运行前清空、结束后还原），也不写任何 key 到文件（契约§5）。
 */
const assert = require('assert');
const path = require('path');
const llm = require(path.join(__dirname, '..', 'src', 'llm.js'));

const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// 通用天结算 fixture：3 号与 5 号对跳预言家 + 4 号投票放逐 5 号（事件/claims/actions/pairs 齐全）
function makeDayData() {
  return {
    day: 2,
    seats: [1, 2, 3, 4, 5, 6],
    events: [
      { id: 101, day: 2, phase: 'day', type: 'claim', actor_seat: 3, raw_text: '3号跳预言家查杀5号' },
      { id: 102, day: 2, phase: 'day', type: 'claim', actor_seat: 5, raw_text: '5号对跳预言家，金水2号' },
      { id: 103, day: 2, phase: 'day', type: 'vote', actor_seat: null, raw_text: '5号被投出局' }
    ],
    claims: [
      { id: 1, seat: 3, subject_seat: 5, predicate: 'is_wolf', object: '查杀', event_id: 101 },
      { id: 2, seat: 5, subject_seat: 3, predicate: 'is_wolf', object: '悍跳', event_id: 102 }
    ],
    actions: [
      { id: 7, seat: 4, action: 'vote', target_seat: 5, result: '放逐', event_id: 103 }
    ],
    pairs: [
      { pair_id: 'P1', claim_a: 1, claim_b: 2, conflict_desc: '3号与5号对跳预言家' },
      { pair_id: 'P2', claim_a: 1, action_a: 7, conflict_desc: '3号声称验5号，4号投票放逐5号' }
    ]
  };
}

/* T1：抽取结构合规（契约§3 schema + §1/§2 枚举 + 复合句拆分） */
test('T1 抽取结构合规: schema/枚举/复合句拆 2 条 claims', async function () {
  const r = await llm.extractEvent('3号跳预言家，说昨晚查了5号，查杀', { seats: [1, 2, 3, 4, 5, 6], day: 2, phase: 'day', speakerSeat: 3 });
  assert.strictEqual(r.meta.mode, 'MOCK');
  assert.strictEqual(r.meta.attempts, 1);
  assert.strictEqual(r.event.day, 2);
  assert.strictEqual(r.event.phase, 'day');
  assert.strictEqual(r.event.type, 'claim');
  assert.strictEqual(r.event.raw_text, '3号跳预言家，说昨晚查了5号，查杀', 'raw_text 必须原样保留');
  assert.ok(Array.isArray(r.warnings), 'warnings 字段必须存在');
  assert.strictEqual(r.claims.length, 2, '复合句应拆出 2 条 claims，实得 ' + JSON.stringify(r.claims));
  const c3 = r.claims.find(function (c) { return c.subject_seat === 3; });
  const c5 = r.claims.find(function (c) { return c.subject_seat === 5; });
  assert.ok(c3 && c3.predicate === 'claims_role' && c3.object.indexOf('预言家') !== -1, '3号应为 claims_role/预言家');
  assert.ok(c5 && c5.predicate === 'is_wolf', '5号应为 is_wolf（查杀）');
  assert.strictEqual(r.action, null);
  for (const c of r.claims) {
    assert.ok(llm.PREDICATES.indexOf(c.predicate) !== -1, 'predicate 必须在七枚举内: ' + c.predicate);
    assert.ok(typeof c.object === 'string' && c.object.length > 0);
  }
});

/* T2：名单外 seat 丢弃 + 警告（契约§3「不存在即丢弃该条并提示用户」） */
test('T2 seat 9 不在名单: 该条丢弃且 warnings 留痕, seat 2 保留', async function () {
  const r = await llm.extractEvent('9号是好人，2号金水', { seats: [1, 2, 3, 4, 5, 6], day: 1, phase: 'day' });
  const seats = r.claims.map(function (c) { return c.subject_seat; });
  assert.ok(seats.indexOf(9) === -1, 'seat 9 必须被丢弃');
  assert.ok(seats.indexOf(2) !== -1, 'seat 2 应保留');
  assert.strictEqual(r.claims.length, 1, '只保留 1 条合法 claim');
  assert.ok(r.warnings.some(function (w) { return w.indexOf('9') !== -1; }), 'warnings 应提示丢弃 seat 9，实得: ' + JSON.stringify(r.warnings));
  assert.strictEqual(r.event.type, 'claim');
});

/* T3：RD1 无辜解释非空强校验 + 悬空 pair_id 剔除 */
test('T3 RD1: 无辜解释全 ≥1, 空解释对被删, GHOST-404 悬空对被删', async function () {
  const dayData = makeDayData();
  const r = await llm.generateCards(dayData);
  const inIds = dayData.pairs.map(function (p) { return p.pair_id; });
  assert.ok(r.contradictions.length >= 2, '两个真实矛盾对都应保留');
  for (const c of r.contradictions) {
    assert.ok(inIds.indexOf(c.pair_id) !== -1, '输出 pair_id 必须来自输入: ' + c.pair_id);
    assert.ok(c.innocent_explanations.length >= 1, 'RD1: 无辜解释必须 ≥1 条');
    assert.ok(llm.UNDERDETERMINATION_LEVELS.indexOf(c.underdetermination) !== -1, 'underdetermination 必须枚举');
  }
  assert.ok(!r.contradictions.some(function (c) { return c.innocent_explanations.length === 0; }), '空无辜解释矛盾对必须被删除');
  assert.ok(!r.contradictions.some(function (c) { return c.pair_id === 'GHOST-404'; }), '悬空 pair_id 必须被剔除');
  assert.ok(r.warnings.some(function (w) { return w.indexOf('RD1') !== -1; }), '应有 RD1 过滤警告: ' + JSON.stringify(r.warnings));
  assert.ok(r.warnings.some(function (w) { return w.indexOf('GHOST-404') !== -1; }), '应有悬空引用警告');
});

/* T4：JSON 损坏 → 附解析错误重试 ≤2 次后成功；始终损坏 → 明确抛错 */
test('T4 JSON 损坏: 首次坏重试成功(attempts=2), 始终坏则抛错', async function () {
  const r = await llm.extractEvent('4号金水', { seats: [1, 2, 3, 4, 5, 6], day: 1, phase: 'day', _mockCorrupt: 'first' });
  assert.strictEqual(r.meta.mode, 'MOCK');
  assert.strictEqual(r.meta.attempts, 2, '首次损坏应在第 2 次尝试成功');
  assert.ok(r.claims.some(function (c) { return c.subject_seat === 4; }));
  await assert.rejects(
    llm.extractEvent('4号金水', { seats: [1, 2, 3, 4, 5, 6], day: 1, phase: 'day', _mockCorrupt: 'always' }),
    /重试/,
    '重试耗尽必须抛出含「重试」的错误说明'
  );
});

/* T5：假设 stance 完整性 + 自洽校验（PD1/LY昼2 修复） */
test('T5 stance: 每座位必有且枚举合法, Top区自洽负例与缺座负例均废案', async function () {
  const r = await llm.generateCards(makeDayData());
  const seats = [1, 2, 3, 4, 5, 6];
  assert.ok(r.hypotheses.length >= 2, '竞争假设必须 ≥2 套，实得 ' + r.hypotheses.length);
  for (const h of r.hypotheses) {
    for (const s of seats) {
      assert.ok(h.stance[String(s)] !== undefined, 'stance 缺少 ' + s + ' 号（per-player 必须完整）');
    }
    for (const k of Object.keys(h.stance)) {
      if (k === 'suspect_ranking') continue;
      assert.ok(llm.STANCE_VALUES.indexOf(h.stance[k]) !== -1, 'stance 值必须枚举: ' + h.stance[k]);
    }
    assert.ok(llm.TENDENCY_LEVELS.indexOf(h.tendency) !== -1, 'tendency 必须枚举');
    assert.ok(Array.isArray(h.support_events) && Array.isArray(h.oppose_events));
  }
  assert.ok(!r.hypotheses.some(function (h) { return h.content.indexOf('自洽负例') !== -1; }), 'good_believe 进 Top 区的假设必须被废案');
  assert.ok(!r.hypotheses.some(function (h) { return h.content.indexOf('stance 不完整') !== -1; }), 'stance 缺座位的假设必须被废案');
  assert.ok(r.warnings.some(function (w) { return w.indexOf('Top 区') !== -1; }), '应有 Top 区自洽警告');
  assert.ok(r.warnings.some(function (w) { return w.indexOf('per-player') !== -1; }), '应有 stance 完整性警告');
});

/* T6：双模式切换 + 注入式 base URL / fetchImpl（LIVE 全链路，零真实网络请求） */
test('T6 双模式: 无key=MOCK; 假key+注入base+注入fetch=LIVE且不发真实请求', async function () {
  delete process.env.DEEPSEEK_API_KEY;
  assert.strictEqual(llm.resolveMode({}), 'MOCK', '无 key 必须自动 MOCK');
  const r1 = await llm.extractEvent('2号发言', { seats: [1, 2, 3], day: 1, phase: 'day' });
  assert.strictEqual(r1.meta.mode, 'MOCK');
  const calls = [];
  const fakeFetch = async function (url, init) {
    calls.push({ url: url, auth: init.headers['Authorization'], body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async function () {
        const content = '{"event":{"day":1,"phase":"day","type":"claim","raw_text":"2号金水"},"claims":[{"subject_seat":2,"predicate":"is_good","object":"好人"}],"action":null}';
        return { choices: [{ message: { content: content } }] };
      }
    };
  };
  const r2 = await llm.extractEvent('2号金水', { seats: [1, 2, 3], day: 1, phase: 'day' }, {
    apiKey: 'sk-fake-test-only',
    baseUrl: 'http://127.0.0.1:9/unreachable',
    fetchImpl: fakeFetch
  });
  assert.strictEqual(r2.meta.mode, 'LIVE', '带 key 必须走 LIVE');
  assert.strictEqual(r2.meta.attempts, 1);
  assert.strictEqual(calls.length, 1, '必须且只走注入的 fetchImpl，不发真实网络请求');
  assert.ok(calls[0].url.indexOf('http://127.0.0.1:9/unreachable') === 0, '请求必须打到注入 base: ' + calls[0].url);
  assert.ok(calls[0].url.slice(-('/chat/completions'.length)) === '/chat/completions', '端点必须是 /chat/completions');
  assert.strictEqual(calls[0].auth, 'Bearer sk-fake-test-only');
  assert.strictEqual(calls[0].body.model, 'deepseek-chat');
  assert.strictEqual(r2.claims[0].subject_seat, 2);
  assert.strictEqual(r2.event.raw_text, '2号金水');
});

/* T7：checkpoint resolves 下标在假设过滤后重映射；指向被废假设的删除 */
test('T7 checkpoint: 死链删除, 存活 resolves 全部落在保留假设范围内', async function () {
  const r = await llm.generateCards(makeDayData());
  assert.ok(r.checkpoints.length >= 2, '存活 checkpoint 应 ≥2，实得 ' + JSON.stringify(r.checkpoints));
  for (const cp of r.checkpoints) {
    assert.ok(cp.resolves.length >= 1, 'resolves 不得为空');
    for (const idx of cp.resolves) {
      assert.ok(idx >= 0 && idx < r.hypotheses.length, 'resolves 下标必须落在保留假设内: ' + idx);
    }
  }
  assert.ok(!r.checkpoints.some(function (cp) { return cp.text.indexOf('废案') !== -1; }), '指向被废假设的 checkpoint 必须删除');
});

/* T8：prompt 红线自检——RD1 无辜解释层与「思路参谋不是判官」必须写死在 system prompt 里 */
test('T8 prompt 红线: RD1 五角度+非判官定位+seat名单+七枚举全部在 prompt 原文中', async function () {
  const ex = llm.EXTRACT_SYSTEM_PROMPT;
  const ca = llm.CARDS_SYSTEM_PROMPT;
  assert.ok(ex.indexOf('在册座位名单') !== -1 && ex.indexOf('不得编造') !== -1, '抽取 prompt 必须钉死 seat 名单约束');
  for (const p of llm.PREDICATES) assert.ok(ex.indexOf(p) !== -1, '抽取 prompt 必须列出 predicate 枚举: ' + p);
  assert.ok(ex.indexOf('0..n') !== -1, '抽取 prompt 必须写明一条输入可产出 0..n claims');
  assert.ok(ca.indexOf('不是判官') !== -1, '参谋卡 prompt 必须写明「思路参谋不是判官」定位');
  assert.ok(ca.indexOf('至少 1 条') !== -1 && ca.indexOf('innocent_explanations') !== -1, 'RD1: 每个矛盾对无辜解释 ≥1 条必须写进 prompt');
  for (const w of ['药剂类', '状态类', '信息差', '记忆类', '战术类']) {
    assert.ok(ca.indexOf(w) !== -1, 'RD1 无辜解释五角度缺失: ' + w);
  }
  assert.ok(ca.indexOf('wolf_suspect') !== -1 && ca.indexOf('good_believe') !== -1, 'stance 枚举必须写进 prompt');
  assert.ok(ca.indexOf('per-player') !== -1, 'per-player stance 要求必须写进 prompt');
  assert.ok(ca.indexOf('结论留给用户') !== -1, '「结论留给用户」必须写进 prompt（不下最终结论）');
});

/* T9：输出与输入一一对应（无编造 pair）+ warnings/meta 附加字段存在 */
test('T9 矛盾对恰好覆盖输入 P1/P2, 负例全过滤, 过滤动作全部留痕', async function () {
  const r = await llm.generateCards(makeDayData());
  const outIds = r.contradictions.map(function (c) { return c.pair_id; }).sort();
  assert.deepStrictEqual(outIds, ['P1', 'P2'], '输出必须恰好覆盖输入两个矛盾对（mock 注入的空解释/GHOST 负例全部被过滤）');
  assert.ok(Array.isArray(r.warnings) && r.warnings.length >= 4, '所有过滤/废案动作必须留痕: ' + JSON.stringify(r.warnings));
  assert.strictEqual(r.meta.mode, 'MOCK');
  assert.strictEqual(typeof r.meta.attempts, 'number');
});

/* ---------- 运行器：MOCK 全绿判据 = 9/9 pass & exit 0 ---------- */
(async function main() {
  const prevKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY; // 强制全走 MOCK（契约§5：绝不读 key 跑真网）
  let pass = 0;
  const failures = [];
  for (const t of tests) {
    try {
      await t.fn();
      pass += 1;
      console.log('PASS  ' + t.name);
    } catch (e) {
      failures.push(t.name + ' :: ' + (e && e.message));
      console.log('FAIL  ' + t.name + ' :: ' + (e && e.message));
    }
  }
  if (prevKey !== undefined) process.env.DEEPSEEK_API_KEY = prevKey;
  console.log('-----');
  console.log('total=' + tests.length + ' pass=' + pass + ' fail=' + (tests.length - pass));
  console.log('default_mode_without_key=' + llm.resolveMode({}));
  if (failures.length > 0) {
    console.log('FAILURES:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  process.exit(0);
})();