'use strict';
/**
 * 局鉴 · test/mcp.test.cjs —— MCP 层契约测试
 *
 * 三组：
 * ① 协议（新规范主路径 ＋ 旧版兼容层 ＋ 错误码 ＋ 通知不回）
 * ② 工具（8 条逐条，含越界路径）
 * ③ ★零写入（本 server 最不许破的那条：调遍三条写意图工具，账本一个字节都不能变）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tools = require('../src/mcp/tools.cjs');
const { handleMessage, INSTRUCTIONS } = require('../src/mcp/protocol.cjs');
const { readLines, parseLine, makeWriter } = require('../src/mcp/framing.cjs');

const BIN = path.join(__dirname, '..', 'bin', 'jujian-mcp.cjs');

let tmpDir;
function useTempDb(t) {
  if (!tmpDir || !fs.existsSync(tmpDir)) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jujian-mcp-'));
  const db = path.join(tmpDir, 'mcp-' + Math.random().toString(36).slice(2) + '.db');
  t.after(() => { try { fs.rmSync(db, { force: true }); } catch (_) { /* ignore */ } });
  const store = require('../src/db/store');
  store.init(db);
  t.after(() => store.closeCurrent());
  return { store, db };
}

// ══ ① 协议 ═════════════════════════════════════════════════════════════

test('① 新规范主路径：server/discover 自报版本、能力与读法', () => {
  const r = handleMessage({ jsonrpc: '2.0', id: 1, method: 'server/discover' });
  assert.equal(r.id, 1);
  assert.equal(r.result.supportedVersions.length, 1);
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.ok(r.result.instructions.length > 100, 'instructions 要写得足够长才有用');
});

test('★② 旧版握手兼容：initialize / ping / initialized 都能过', () => {
  // 大量现存客户端只发 initialize；只支持新规范的话它们拿到 -32601，
  // 症状是「明明装上了却连不上」—— 最难排查的一类装不上。
  const init = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal(init.result.protocolVersion, '2024-11-05', '要回它要的版本');
  assert.ok(init.result.serverInfo.name, '★serverInfo.name 不能少（老客户端靠它认人）');
  assert.deepEqual(init.result.supportedVersions, ['2026-07-28']);
  assert.equal(handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping' }).result.constructor, Object);
  // 通知一律不回
  assert.equal(handleMessage({ jsonrpc: '2.0', method: 'initialized' }), null);
  assert.equal(handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('③ 错误码：未知方法 -32601 ／ 坏请求 -32600 ／ 不存在的工具 -32602', () => {
  assert.equal(handleMessage({ jsonrpc: '2.0', id: 1, method: 'resources/list' }).error.code, -32601);
  assert.equal(handleMessage({ jsonrpc: '1.0', id: 1, method: 'tools/list' }).error.code, -32600);
  assert.equal(handleMessage({ id: 1, method: 'tools/list' }).error.code, -32600);
  assert.equal(handleMessage(null).error.code, -32600);
  const badTool = handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: '不存在的工具' } });
  assert.equal(badTool.error.code, -32602, '★-32602 只用于「工具不存在」这一种情况');
  assert.match(badTool.error.message, /可用：/, '要说清有哪些工具');
});

test('④ ★工具自己跑失败走 isError，不走协议错误（模型必须看得见才能自我纠正）', (t) => {
  useTempDb(t);
  const r = handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'jujian_game_state', arguments: { game_id: 999999 } } });
  assert.equal(r.error, undefined, '★不该是协议错误');
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /不存在/);
});

test('⑤ 分帧：坏行回 -32700 且不影响后续行；串行写不交错', async () => {
  assert.equal(parseLine('{坏 json').ok, false);
  assert.equal(parseLine('{"a":1}').value.a, 1);

  // 并发喂 30 条，writer 必须一行不交错
  const written = [];
  let fake = { write: (s) => { written.push(s); return true; }, once: () => {} };
  const w = makeWriter(fake);
  await Promise.all(Array.from({ length: 30 }, (_, i) => w({ i })));
  await w.idle();
  const lines = written.filter(Boolean);
  assert.equal(lines.length, 30, '30 次写必须得到 30 行');
  for (let i = 0; i < lines.length; i++) {
    assert.equal(JSON.parse(lines[i]).i, i, `★第 ${i} 行被交错污染了`);
  }
});

// ══ ② 工具 ═════════════════════════════════════════════════════════════

test('★⑥ 工具表：8 条 ＋ 注解诚实 ＋ 每条描述都写全三段', () => {
  const list = tools.listTools();
  assert.equal(list.length, 8);
  assert.equal(list.filter((t) => t.annotations.readOnlyHint === true).length, 5, '5 条读工具');
  assert.equal(list.filter((t) => t.annotations.readOnlyHint === false).length, 3, '3 条只起草工具');
  for (const t of list) {
    assert.ok(t.name.startsWith('jujian_'), '工具名须带项目前缀：' + t.name);
    assert.ok(t.title, t.name + ' 缺 title');
    // ★描述纪律：少写一句「不能做什么」，模型就会替你圆过去。
    assert.match(t.description, /怎么读|支持/, t.name + ' 描述缺「怎么读」段');
    assert.match(t.description, /不能做什么/, t.name + ' 描述缺「不能做什么」段');
    assert.match(t.description, /越界时返回什么|不会越界/, t.name + ' 描述缺「越界时返回什么」段');
    assert.ok(t.inputSchema, t.name + ' 缺 inputSchema');
    assert.ok(!/\b准确率\b|必胜|稳赢/.test(t.description), t.name + ' 描述含被禁措辞');
  }
  // 写意图工具必须自报 destructiveHint:false —— 它们结构上就写不了
  for (const t of list.filter((x) => !x.annotations.readOnlyHint)) {
    assert.equal(t.annotations.destructiveHint, false, t.name + ' 写不了任何东西，destructiveHint 必须是 false');
    assert.equal(t.annotations.idempotentHint, true, t.name + ' 调两次与调一次应当零差别');
  }
});

test('⑦ instructions 必须把「不能写账本」和「不给嫌疑排序」讲在最前面', () => {
  const head = INSTRUCTIONS.slice(0, 600);
  assert.match(head, /不能替你往对局账本里写/, 'instructions 开头就要说清不能写');
  assert.match(INSTRUCTIONS, /不要重试/, '必须说清「不要重试」，否则模型会重试到天荒地老');
  assert.match(INSTRUCTIONS, /不给你嫌疑排序|不给嫌疑排序/, '必须说清不给嫌疑排序');
});

test('⑧ 五条读工具真读到东西', (t) => {
  const { store } = useTempDb(t);
  const g = store.createGame({ name: '读侧局', game_type: 'werewolf', player_count: 8 });
  const ev = store.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: '我跳预言家' });
  store.addClaim({ event_id: ev.id, seat: 3, subject_seat: 3, predicate: 'claims_role', object: '预言家' });
  store.addClaim({ event_id: ev.id, seat: 3, subject_seat: 1, predicate: 'is_wolf', object: '查杀' });
  store.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'claim', actor_seat: 6, raw_text: '我也跳预言家' });
  store.addClaim({ event_id: ev.id, seat: 6, subject_seat: 6, predicate: 'claims_role', object: '预言家' });
  store.saveContradictions(g.id, [{
    claim_a: 1, claim_b: 2, conflict_desc: '[对跳] 唯一角色被两人同时声称',
    underdetermination: 'high', innocent_explanations: ['跟风起跳', '记错自己的位置'], generated_by: 'code',
  }]);
  store.saveHypotheses(g.id, [{
    day: 1, content: '3号或6号至少一人在说谎', stance: { 3: 'wolf_suspect' },
    support_events: [ev.id], oppose_events: [], tendency: 'mid',
  }]);

  const call = (name, args) => tools.callTool(name, args);

  const games = call('jujian_list_games', {});
  assert.match(games.content[0].text, /读侧局/);

  const st = call('jujian_game_state', { game_id: g.id });
  assert.match(st.content[0].text, /跳预言家/);
  assert.match(st.content[0].text, /声称 3 条/);

  const card = call('jujian_review_card', { game_id: g.id });
  assert.match(card.content[0].text, /对跳/);
  assert.match(card.content[0].text, /跟风起跳/, '★无辜解释必须出现在人读文本里');
  assert.match(card.content[0].text, /欠定度/);

  const cs = call('jujian_contradictions', { game_id: g.id });
  assert.match(cs.content[0].text, /对跳/);

  const types = call('jujian_game_types', {});
  assert.match(types.content[0].text, /avalon/);
  assert.match(types.content[0].text, /contract=/, '★要露出五方法契约，那是加新游戏的接口');
});

test('⑨ 空局不得说成「这局没矛盾」', (t) => {
  useTempDb(t);
  const r = tools.callTool('jujian_contradictions', { game_id: require('../src/db/store').createGame({ name: '空局', game_type: 'werewolf', player_count: 6 }).id });
  assert.match(r.content[0].text, /还没有任何已存档的矛盾/);
  assert.match(r.content[0].text, /不是「这局没人撒谎」/, '★必须自我纠正这个误读');
});

// ══ ③ ★零写入 ══════════════════════════════════════════════════════════

test('★⑩ 本 server 一个字节都不能写账本（调遍三条写意图工具后逐表核对）', (t) => {
  const { store } = useTempDb(t);
  const g = store.createGame({ name: '零写入局', game_type: 'botc', player_count: 10 });
  store.setGameScript(g.id, 'tb');
  // ★先手工录两条事件，走的是存储层（不是 MCP）——
  //   否则 jujian_review_day 会因「当天无事件」提前走错误分支，
  //   它的**写入路径压根没被测到**，这条用例就只剩形式。
  //   （第一版就是这个漏洞：它绿了，但绿得没有意义。）
  const ev1 = store.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: '3号跳预言家' });
  store.addClaim({ event_id: ev1.id, seat: 3, subject_seat: 3, predicate: 'claims_role', object: '预言家' });
  store.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'claim', actor_seat: 6, raw_text: '6号也跳预言家' });
  store.addClaim({ event_id: ev1.id, seat: 6, subject_seat: 6, predicate: 'claims_role', object: '预言家' });

  const before = store.stats(g.id);
  const tablesBefore = JSON.stringify(store.loadGameState(g.id));
  assert.ok(before.events > 0, '前置条件：这一局必须已经有事件');

  // 三条写意图工具，各调两次（验证幂等：调两次与调一次零差别）
  const calls = [
    ['jujian_record_claim', { game_id: g.id, kind: 'claim_role', seat: 3, argument: '预言家', day: 1 }],
    ['jujian_record_claim', { game_id: g.id, kind: 'check', seat: 3, argument: '1', day: 1 }],
    ['jujian_record_speech', { game_id: g.id, seat: 6, text: '我是预言家，昨晚验的4号', day: 1 }],
    ['jujian_review_day', { game_id: g.id, day: 1 }],
  ];
  for (const [name, args] of calls) {
    for (let i = 0; i < 2; i++) {
      const r = tools.callTool(name, args);
      assert.equal(r.structuredContent.recorded, false, name + ' 必须自报 recorded:false');
      assert.equal(r.structuredContent.gate_not_confirmed, true, name + ' 必须自报确认闸没开');
      assert.equal(r.structuredContent.verdict.gate, 'NOT_CONFIRMED');
      assert.equal(r.structuredContent.verdict.do_not_retry, true, name + ' 必须自报「不要重试」');
      assert.ok((r.structuredContent.how_to_record || []).length, name + ' 必须给出人怎么录的线索');
    }
  }

  // ★逐表核对：一条都不能多
  const after = store.stats(g.id);
  assert.deepEqual(after, before, '★调完写意图工具后各表计数必须完全不变：\n  前 ' + JSON.stringify(before) + '\n  后 ' + JSON.stringify(after));
  assert.equal(JSON.stringify(store.loadGameState(g.id)), tablesBefore, '★整局状态必须逐字节不变');
  assert.equal(store.getContradictions(g.id).length, 0, '★不允许凭空生成矛盾');
  assert.equal(store.getHypotheses(g.id).length, 0, '★不允许凭空生成假设');
});

test('⑪ 写意图工具的越界路径：说清错在哪、给出可执行的下一步', (t) => {
  const { store } = useTempDb(t);
  const g = store.createGame({ name: '越界局', game_type: 'botc', player_count: 10 });
  store.setGameScript(g.id, 'tb');

  const r1 = tools.callTool('jujian_record_claim', { game_id: g.id, kind: 'claim_role', seat: 99, argument: '预言家', day: 1 });
  assert.equal(r1.isError, true);
  assert.match(r1.content[0].text, /不在局/, '★席位越界要说清是席位问题');

  const r2 = tools.callTool('jujian_record_claim', { game_id: g.id, kind: '神秘操作', seat: 1, argument: 'x', day: 1 });
  assert.equal(r2.isError, true);
  assert.match(r2.content[0].text, /claim_role\s*\|\s*check\s*\|\s*good/, '★枚举非法要列出合法值');

  const r3 = tools.callTool('jujian_record_claim', { game_id: g.id, kind: 'check', seat: 3, argument: '3', day: 1 });
  assert.equal(r3.isError, true);
  assert.match(r3.content[0].text, /不能是自己/);

  // BOTC 越剧本：能解析但不属于本剧本 ⇒ 必须人确认，不静默修复
  const r4 = tools.callTool('jujian_record_claim', { game_id: g.id, kind: 'claim_role', seat: 3, argument: '教授', day: 1 });
  assert.equal(r4.isError, true);
  assert.match(r4.content[0].text, /不属于剧本 tb/);
  assert.match(r4.content[0].text, /bmr/, '★要说清它属于哪个剧本');

  const r5 = tools.callTool('jujian_record_speech', { game_id: g.id, seat: 3, text: '   ', day: 1 });
  assert.equal(r5.isError, true);
  assert.match(r5.content[0].text, /text/);

  const r6 = tools.callTool('jujian_review_day', { game_id: g.id, day: 1 });
  assert.equal(r6.isError, true);
  assert.match(r6.content[0].text, /没有任何事件/, '★空局不许产空卡');
});

test('⑫ 未配 key 时抽取必须自报 MOCK（冒充是本层最严重的越界）', (t) => {
  const saved = { k: process.env.JUJIAN_LLM_API_KEY, l: process.env.LLM_API_KEY, d: process.env.DEEPSEEK_API_KEY };
  delete process.env.JUJIAN_LLM_API_KEY; delete process.env.LLM_API_KEY; delete process.env.DEEPSEEK_API_KEY;
  t.after(() => {
    if (saved.k !== undefined) process.env.JUJIAN_LLM_API_KEY = saved.k;
    if (saved.l !== undefined) process.env.LLM_API_KEY = saved.l;
    if (saved.d !== undefined) process.env.DEEPSEEK_API_KEY = saved.d;
  });
  const { store } = useTempDb(t);
  const g = store.createGame({ name: 'MOCK局', game_type: 'werewolf', player_count: 8 });
  const r = tools.callTool('jujian_record_speech', { game_id: g.id, seat: 3, text: '我是预言家', day: 1 });
  assert.equal(r.structuredContent.mode, 'MOCK');
  assert.match(r.content[0].text, /不是真模型抽的/, '★人读文本里也必须说清，不能只藏在结构化字段里');
  assert.equal(r.structuredContent.recorded, false);
});

// ══ 端到端：真起一个子进程 ═════════════════════════════════════════════

test('⑬ 端到端：子进程起得来、连得上、连完不写账本', (t) => {
  if (!tmpDir || !fs.existsSync(tmpDir)) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jujian-mcp-'));
  const db = path.join(tmpDir, 'e2e-' + Math.random().toString(36).slice(2) + '.db');
  t.after(() => { try { fs.rmSync(db, { force: true }); } catch (_) { /* ignore */ } });

  // 先用 CLI 建一局（走真实的落库通路）
  const mk = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'jujian.cjs'),
    'new', 'E2E局', '--players=8', '--json', '--db=' + db],
  { encoding: 'utf8', env: Object.assign({}, process.env, { JUJIAN_LLM_MOCK: '1' }) });
  assert.equal(mk.status, 0, mk.stderr);
  const gid = JSON.parse(mk.stdout).局号;

  const input = [
    '{"jsonrpc":"2.0","id":1,"method":"server/discover"}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"jujian_list_games"}}',
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"jujian_record_claim","arguments":{"game_id":' + gid + ',"kind":"claim_role","seat":3,"argument":"预言家","day":1}}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"jujian_game_state","arguments":{"game_id":' + gid + '}}}',
  ].join('\n') + '\n';

  const r = spawnSync(process.execPath, [BIN], { input, encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { JUJIAN_DB: db, JUJIAN_LLM_MOCK: '1' }) });
  assert.equal(r.status, 0, '子进程应正常退出：' + r.stderr);
  const lines = (r.stdout || '').trim().split('\n').filter(Boolean);
  const msgs = lines.map((l) => JSON.parse(l));
  assert.equal(msgs.length, 5, '★通知那条不该有回（6 条输入 5 条回）');
  assert.deepEqual(msgs.map((m) => m.id), [1, 2, 3, 4, 5], '★应答必须按 id 全部对上，一行都不能丢');
  assert.match(msgs[2].result.content[0].text, /E2E局/);
  assert.equal(msgs[3].result.structuredContent.recorded, false);
  // 第 5 条读到的声称必须是 0 —— 证明第 4 条真的什么都没写
  assert.match(msgs[4].result.content[0].text, /声称 0 条/);
  assert.match(r.stderr, /不写账本/, '★启动横幅里要自报不写账本');
});