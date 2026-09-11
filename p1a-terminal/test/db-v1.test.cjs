'use strict';
// p1a-terminal · test/db-v1.test.cjs —— 契约 v0→v1 数据层回归（对象式接口 + retracted 软删）
// 覆盖：cli.js B→A 期望的新方法逐个验证 + retract 后查询不可见 + update 生效 + v0 旧库迁移兼容。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const dbm = require('../src/db');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; failures.push(name); console.log('FAIL  ' + name); console.log('      ' + (e && e.message)); }
}
dbm.init(':memory:'); // 对象式接口走模块内连接

// ── T1 createGame 位置参数 + 自动建席 + getGame/getPlayers/seatExists ──
test('T1 createGame(位置参数) 自动建席 1..N；getGame/getPlayers/seatExists', () => {
  const g = dbm.createGame('测试局A', 'werewolf', 12);
  assert.ok(Number.isInteger(g.id) && g.id >= 1, '应返回含 id 的行');
  assert.strictEqual(dbm.getGame(g.id).player_count, 12);
  assert.strictEqual(dbm.getPlayers(g.id).length, 12, '应自动建 12 席');
  for (let s = 1; s <= 12; s++) assert.strictEqual(dbm.seatExists(g.id, s), true, '席位 ' + s + ' 应存在');
  assert.strictEqual(dbm.seatExists(g.id, 13), false, '席位 13 不应存在');
  assert.strictEqual(dbm.getGame(99999), null, '不存在的局应返回 null 而非抛错');
});

// ── T2 addEvent/addClaim/addAction 入账（seq 自动、返回 id、枚举校验）──
test('T2 addEvent→addClaim→addAction 入账；seq 自动；非法谓词抛错', () => {
  const g = dbm.createGame('测试局B', 'werewolf', 12);
  const ev = dbm.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'claim', actor_seat: 9, raw_text: '9号跳预言家' });
  assert.ok(Number.isInteger(ev.id) && Number.isInteger(ev.seq) && ev.seq >= 1, '应返回 {id,seq}');
  const c = dbm.addClaim({ event_id: ev.id, seat: 9, subject_seat: 9, predicate: 'claims_role', object: '预言家', extracted_by: 'llm', confirmed_by_user: 1 });
  assert.ok(Number.isInteger(c.id), 'addClaim 应返回含 id 的行');
  const a = dbm.addAction({ event_id: ev.id, seat: 9, action: 'check_target', target_seat: 4, result: '查杀' });
  assert.ok(Number.isInteger(a.id), 'addAction 应返回含 id 的行');
  assert.throws(() => dbm.addClaim({ event_id: ev.id, seat: 9, subject_seat: 4, predicate: 'is_tall', object: 'x' }), /predicate/, '非法谓词应抛错');
  assert.throws(() => dbm.addEvent({ game_id: g.id, day: 1, phase: 'noon', type: 'system', raw_text: 'x' }), /phase/, '非法 phase 应抛错');
});

// ── T3 updateClaimObject / updateAction 生效（YD5 修正）──
test('T3 update 生效：object 改写+confirmed=1；action target/result 双分支；retracted 拒改', () => {
  const g = dbm.createGame('测试局C', 'werewolf', 12);
  const ev = dbm.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'claim', actor_seat: 5, raw_text: 'x' });
  const c = dbm.addClaim({ event_id: ev.id, seat: 5, subject_seat: 5, predicate: 'claims_role', object: '女巫', confirmed_by_user: 0 });
  const u1 = dbm.updateClaimObject(c.id, '预言家');
  assert.strictEqual(u1.object, '预言家', 'object 应已改写');
  assert.strictEqual(u1.confirmed_by_user, 1, 'confirmed_by_user 应置 1');
  assert.strictEqual(u1.game_id, g.id, 'getClaim 行应带 game_id');
  const a = dbm.addAction({ event_id: ev.id, seat: 5, action: 'vote', target_seat: 3 });
  const u2 = dbm.updateAction(a.id, { target_seat: 6 });
  assert.strictEqual(u2.target_seat, 6, 'target_seat 应已改写');
  const u3 = dbm.updateAction(a.id, { result: 'PK 改票' });
  assert.strictEqual(u3.result, 'PK 改票', 'result 应已改写');
  assert.throws(() => dbm.updateAction(a.id, { target_seat: 99 }), /不存在/, '目标席位不存在应抛错');
  dbm.retractClaim(c.id);
  assert.throws(() => dbm.updateClaimObject(c.id, '再改'), /已撤回/, '已撤回 claim 应拒改');
  assert.throws(() => dbm.updateClaimObject(99999, 'x'), /不存在/, '不存在的 claim 应抛错');
});

// ── T4 retractClaim/retractAction 软删 + 查询不可见（账本纪律）──
test('T4 retract 软删：幂等/不存在 false；retracted=1；recent/load 查询不可见', () => {
  const g = dbm.createGame('测试局D', 'werewolf', 12);
  const ev = dbm.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'claim', actor_seat: 3, raw_text: 'x' });
  const c1r = dbm.addClaim({ event_id: ev.id, seat: 3, subject_seat: 3, predicate: 'claims_role', object: '女巫' });
  const c2r = dbm.addClaim({ event_id: ev.id, seat: 3, subject_seat: 3, predicate: 'claims_role', object: '女巫' });
  const a = dbm.addAction({ event_id: ev.id, seat: 3, action: 'check_target', target_seat: 4 });
  assert.strictEqual(dbm.retractClaim(c1r.id), true, '存在即 true');
  assert.strictEqual(dbm.retractClaim(c1r.id), true, '重复 retract 幂等仍 true');
  assert.strictEqual(dbm.retractClaim(99999), false, '不存在返回 false');
  assert.strictEqual(dbm.getClaim(c1r.id).retracted, 1, '行仍在库且 retracted=1（不物理删）');
  const recent = dbm.recentClaimsBySeat(g.id, 3, 10);
  assert.ok(!recent.some(x => x.id === c1r.id), 'recentClaimsBySeat 不应含已撤回');
  assert.ok(recent.some(x => x.id === c2r.id), '未撤回的应可见');
  const st = dbm.loadGameState(g.id, Infinity);
  assert.ok(!st.claims.some(x => x.id === c1r.id), 'loadGameState.claims 不应含已撤回');
  dbm.retractAction(a.id);
  const st2 = dbm.loadGameState(g.id, Infinity);
  assert.ok(!st2.actions.some(x => x.id === a.id), 'loadGameState.actions 不应含已撤回');
  assert.strictEqual(dbm.getAction(a.id).retracted, 1, 'getAction 仍可见 retracted=1');
});
// ── T5 recentClaimsBySeat 排序（新→旧）+ limit + 字段形状 ──
test('T5 recentClaimsBySeat：新→旧排序、limit 截断、字段形状', () => {
  const g = dbm.createGame('测试局E', 'werewolf', 12);
  const ev1 = dbm.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'claim', actor_seat: 9, raw_text: 'd1' });
  const ev2 = dbm.addEvent({ game_id: g.id, day: 2, phase: 'day', type: 'claim', actor_seat: 9, raw_text: 'd2' });
  const ev3 = dbm.addEvent({ game_id: g.id, day: 3, phase: 'day', type: 'claim', actor_seat: 9, raw_text: 'd3' });
  dbm.addClaim({ event_id: ev1.id, seat: 9, subject_seat: 9, predicate: 'did_action', object: 'check:4' });
  dbm.addClaim({ event_id: ev2.id, seat: 9, subject_seat: 9, predicate: 'did_action', object: 'check:8' });
  const latest = dbm.addClaim({ event_id: ev3.id, seat: 9, subject_seat: 9, predicate: 'did_action', object: 'check:11' });
  const rows = dbm.recentClaimsBySeat(g.id, 9, 2);
  assert.strictEqual(rows.length, 2, 'limit=2 应只回 2 条');
  assert.strictEqual(rows[0].id, latest.id, '最新一条在前');
  const shape = rows[0];
  for (const k of ['id', 'day', 'phase', 'predicate', 'object', 'subject_seat']) {
    assert.ok(k in shape, '返回行应含字段 ' + k);
  }
  assert.strictEqual(rows[0].day, 3, 'day 字段应为事件日');
});

// ── T6 loadGameState uptoDay 过滤 + 不存在局 null + exportGame meta ──
test('T6 loadGameState 按 day 过滤；不存在局 null；exportGame 带 meta', () => {
  const g = dbm.createGame('测试局F', 'werewolf', 12);
  dbm.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'statement', actor_seat: 1, raw_text: 'd1' });
  dbm.addEvent({ game_id: g.id, day: 2, phase: 'day', type: 'statement', actor_seat: 2, raw_text: 'd2' });
  dbm.addEvent({ game_id: g.id, day: 3, phase: 'day', type: 'statement', actor_seat: 3, raw_text: 'd3' });
  const s2 = dbm.loadGameState(g.id, 2);
  assert.strictEqual(s2.events.length, 2, 'uptoDay=2 应只含 2 条事件');
  assert.ok(s2.events.every(e => e.day <= 2), '事件 day 应全部 ≤2');
  assert.strictEqual(s2.game.id, g.id, '应含 game 行');
  assert.ok(Array.isArray(s2.players) && s2.players.length === 12, '应含 players');
  const all = dbm.loadGameState(g.id, Infinity);
  assert.strictEqual(all.events.length, 3, 'Infinity 应含全部');
  assert.strictEqual(dbm.loadGameState(99999, Infinity), null, '不存在的局返回 null');
  const exp = dbm.exportGame(g.id);
  assert.ok(exp && exp.meta, 'exportGame 应带 meta');
  assert.strictEqual(exp.meta.game_id, g.id);
  assert.strictEqual(exp.meta.schema_contract, 'v1');
  assert.strictEqual(exp.meta.counts.events, 3);
  assert.ok(/\d{4}-\d{2}-\d{2}T/.test(exp.meta.exported_at), 'exported_at 应为 ISO 时间');
});

// ── T7 saveAdvisorCard：RD1 强校验 + 'cN' 记号 + 事务回滚 + checkpoints 忽略 ──
test('T7 saveAdvisorCard：写入计数；RD1 空无辜解释抛错且回滚；cN 记号规整', () => {
  const g = dbm.createGame('测试局G', 'werewolf', 12);
  const ev = dbm.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'claim', actor_seat: 6, raw_text: 'x' });
  const c = dbm.addClaim({ event_id: ev.id, seat: 6, subject_seat: 6, predicate: 'claims_role', object: '女巫' });
  const a = dbm.addAction({ event_id: ev.id, seat: 6, action: 'check_target', target_seat: 7 });
  const n = dbm.saveAdvisorCard(g.id, 1, {
    contradictions: [
      { claim_a: 'c' + c.id, underdetermination: 'low', innocent_explanations: ['合法对跳挡刀'], pair_id: 'c' + c.id },
      { action_a: a.id, underdetermination: 'mid', innocent_explanations: ['记错目标'], conflict_desc: '声称vs行动' },
    ],
    hypotheses: [
      { content: 'H1 6号为狼', stance: { '6': 'wolf_suspect' }, support_events: [ev.id], oppose_events: [], tendency: 'strong' },
      { content: 'H2 6号为真', stance: { '6': 'good_believe' }, tendency: 'weak' },
    ],
    checkpoints: [{ text: '看6号昼2发言', resolves: [0] }],
  });
  assert.strictEqual(n, 4, '应写 2 矛盾 + 2 假设 = 4 行');
  const rows = dbm.getContradictions(dbm.getConnection(), g.id);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0].innocent_explanations, ['合法对跳挡刀'], 'JSON 应已解析回数组');
  assert.strictEqual(rows[0].claim_a, c.id, "'cN' 记号应规整为数字 id");
  assert.strictEqual(rows[0].conflict_desc, '[LLM] c' + c.id, 'conflict_desc 缺省由 pair_id 兜底');
  assert.strictEqual(rows[1].conflict_desc, '声称vs行动', '显式 conflict_desc 优先');
  const hyps = dbm.getHypotheses(dbm.getConnection(), g.id);
  assert.strictEqual(hyps.length, 2);
  assert.deepStrictEqual(hyps[0].stance, { '6': 'wolf_suspect' });
  assert.deepStrictEqual(hyps[1].support_events, [], '缺省 support_events 存空数组');
  assert.throws(() => dbm.saveAdvisorCard(g.id, 1, {
    contradictions: [{ claim_a: c.id, underdetermination: 'low', innocent_explanations: [] }],
    hypotheses: [],
  }), /RD1/, 'RD1：空无辜解释必须抛错');
  assert.strictEqual(dbm.getContradictions(dbm.getConnection(), g.id).length, 2, '抛错后不得留下半写状态');
  assert.throws(() => dbm.saveAdvisorCard(g.id, 1, {
    contradictions: [{ claim_a: 99999, underdetermination: 'low', innocent_explanations: ['x'] }],
    hypotheses: [],
  }), /不存在/, '引用不存在的 claim 应抛错');
});

// ── T8 migrateDb：v0 旧库自动迁移（retracted 列补齐，旧行默认 0）──
test('T8 v0 旧库迁移：openDb 自动补 retracted 列，旧行默认 0，幂等', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1a-v0-'));
  const dbPath = path.join(dir, 'legacy.db');
  const legacy = new Database(dbPath);
  legacy.exec("CREATE TABLE claims (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, seat INTEGER NOT NULL,"
    + " subject_seat INTEGER NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL,"
    + " extracted_by TEXT NOT NULL DEFAULT 'llm', confirmed_by_user INTEGER NOT NULL DEFAULT 0);"
    + " CREATE TABLE actions (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, seat INTEGER NOT NULL,"
    + " action TEXT NOT NULL, target_seat INTEGER, result TEXT);"
    + " INSERT INTO claims (event_id, seat, subject_seat, predicate, object) VALUES (1, 6, 6, 'claims_role', '女巫');");
  legacy.close();
  const db = dbm.openDb(dbPath); // 打开旧库应自动迁移
  const cols = db.pragma('table_info(claims)').map(x => x.name);
  assert.ok(cols.includes('retracted'), 'claims 应补出 retracted 列');
  const acols = db.pragma('table_info(actions)').map(x => x.name);
  assert.ok(acols.includes('retracted'), 'actions 应补出 retracted 列');
  const oldRow = db.prepare('SELECT retracted FROM claims WHERE id=1').get();
  assert.strictEqual(oldRow.retracted, 0, '旧行 retracted 默认 0');
  dbm.migrateDb(db); // 幂等：再跑一次不得报错
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

dbm.closeCurrent();
console.log('──────────────────────────────');
console.log('db-v1.test: ' + passed + ' passed, ' + failed + ' failed (共 8 用例)');
if (failed > 0) { console.log('FAILED: ' + failures.join(' | ')); process.exit(1); }

