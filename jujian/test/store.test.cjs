'use strict';
/**
 * 局鉴 · test/store.test.cjs —— 持久化层契约测试
 *
 * 口径：每条用例都对着 store.js 文件头声明的承诺写，不对着实现写。
 * 凡「文件头说了必须成立」的地方，这里必须有一条用例咬住它。
 */
const test = require('node:test');
const assert = require('node:assert');
const store = require('../src/db/store');

/** 每个用例一份独立内存库 —— 绝不共用，避免一条脏数据飘到别的用例。 */
function fresh(t) {
  store.init(':memory:');
  t.after(() => store.closeCurrent());
  return store.getConnection();
}

function newGame(pc = 4, type = 'werewolf') {
  return store.createGame({ name: '测试局', game_type: type, player_count: pc });
}
function speak(gameId, seat, text, day = 1, phase = 'day') {
  return store.addEvent({ game_id: gameId, day, phase, type: 'statement', actor_seat: seat, raw_text: text });
}

// ── 局与席 ────────────────────────────────────────────────────────────────

test('① 建局自动建席 1..N，默认名「N号」，整局一个事务', (t) => {
  fresh(t);
  const g = newGame(6);
  const seats = store.getPlayers(g.id);
  assert.equal(seats.length, 6);
  assert.deepEqual(seats.map((s) => s.seat), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(seats.map((s) => s.name), ['1号', '2号', '3号', '4号', '5号', '6号']);
  assert.equal(store.seatExists(g.id, 3), true);
  assert.equal(store.seatExists(g.id, 7), false);
});

test('② 建局判据：名字/类型非空、人数 ≥1 整数', (t) => {
  fresh(t);
  const bad = [
    [{ name: '', game_type: 'werewolf', player_count: 4 }, 'name 为空'],
    [{ name: 'x', game_type: '', player_count: 4 }, 'game_type 为空'],
    [{ name: 'x', game_type: 'werewolf', player_count: 0 }, 'player_count=0'],
    [{ name: 'x', game_type: 'werewolf', player_count: 2.5 }, 'player_count 非整数'],
  ];
  for (const [opts, why] of bad) {
    assert.throws(() => store.createGame(opts), /jujian-db/, '应拒绝：' + why);
  }
});

// ── 事件 ──────────────────────────────────────────────────────────────────

test('③ 事件 seq 在同局内单调递增，且事件必归某席（仅 system 例外）', (t) => {
  fresh(t);
  const g = newGame(3);
  const a = speak(g.id, 1, '我是预言家', 1, 'night');
  const b = speak(g.id, 2, '我不信', 1, 'day');
  const sys = store.addEvent({ game_id: g.id, day: 1, phase: 'night', type: 'system', raw_text: '天亮了' });
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(sys.seq, 3);
  assert.equal(sys.actor_seat, null, 'system 事件允许无发言者');
  assert.throws(
    () => store.addEvent({ game_id: g.id, day: 1, phase: 'day', type: 'statement', raw_text: '无主发言' }),
    /必须给 actor_seat/, '非 system 事件缺席位必须拒');
});

test('④ 事件判据：day≥1、phase/type 枚举、raw_text 非空、席位必须在名单内', (t) => {
  fresh(t);
  const g = newGame(3);
  const bad = [
    [{ day: 0, phase: 'day', type: 'statement', actor_seat: 1, raw_text: 'x' }, 'day=0'],
    [{ day: 1, phase: 'noon', type: 'statement', actor_seat: 1, raw_text: 'x' }, 'phase 非法'],
    [{ day: 1, phase: 'day', type: 'gossip', actor_seat: 1, raw_text: 'x' }, 'type 非法'],
    [{ day: 1, phase: 'day', type: 'statement', actor_seat: 1, raw_text: '   ' }, 'raw_text 空白'],
    [{ day: 1, phase: 'day', type: 'statement', actor_seat: 9, raw_text: 'x' }, '席位不在名单'],
  ];
  for (const [opts, why] of bad) {
    assert.throws(() => store.addEvent(Object.assign({ game_id: g.id }, opts)), /jujian-db/, '应拒绝：' + why);
  }
});

// ── 声称 ──────────────────────────────────────────────────────────────────

test('⑤ 批量落声称：整批原子，第 2 条不合法则整批不落', (t) => {
  fresh(t);
  const g = newGame(4);
  const ev = speak(g.id, 1, '1号查杀3号，2号是好人');
  assert.throws(() => store.addClaims(ev.id, [
    { seat: 1, subject_seat: 3, predicate: 'is_wolf', object: '3号' },
    { seat: 1, subject_seat: 2, predicate: 'is_good', object: '2号' },
    { seat: 1, subject_seat: 2, predicate: 'is_god', object: '2号' }, // 非法谓词
  ]), /predicate 非法/);
  assert.equal(store.getClaims(g.id).length, 0, '★整批必须回滚：一条不合法则一条都不落');

  const ok = store.addClaims(ev.id, [
    { seat: 1, subject_seat: 3, predicate: 'is_wolf', object: '3号' },
    { seat: 1, subject_seat: 2, predicate: 'is_good', object: '2号' },
  ]);
  assert.equal(ok.length, 2);
  assert.equal(store.getClaims(g.id).length, 2);
});

// ── ★RD1：本项目最不许放松的一条 ──────────────────────────────────────────

test('⑥ ★RD1：无辜解释为空的矛盾对不得入库', (t) => {
  fresh(t);
  const g = newGame(3);
  const ev = speak(g.id, 1, '3号是狼');
  const [claim] = store.addClaims(ev.id, [{ seat: 1, subject_seat: 3, predicate: 'is_wolf', object: '3号' }]);

  assert.throws(() => store.saveContradictions(g.id, [{
    claim_a: claim.id, claim_b: null, action_a: null, action_b: null,
    conflict_desc: '自相矛盾', underdetermination: 'mid',
    innocent_explanations: [],           // ← 空
    generated_by: 'llm',
  }]), /RD1 校验失败/, '空无辜解释必须被拒');

  assert.throws(() => store.saveContradictions(g.id, [{
    claim_a: claim.id, conflict_desc: 'x', underdetermination: 'mid', generated_by: 'llm',
  }]), /RD1 校验失败/, '缺 innocent_explanations 字段同样被拒');

  const ok = store.saveContradictions(g.id, [{
    claim_a: claim.id, conflict_desc: '与第2天发言冲突', underdetermination: 'high',
    innocent_explanations: ['可能是听错席位号', '可能引用了别人的话'],
    generated_by: 'llm',
  }]);
  assert.equal(ok.length, 1);
  assert.deepEqual(ok[0].innocent_explanations, ['可能是听错席位号', '可能引用了别人的话'],
    '读出来必须是数组，不是 JSON 字符串');
});

test('⑦ 矛盾对必须至少引用一个真实存在的 claim/action id', (t) => {
  fresh(t);
  const g = newGame(3);
  const mk = (extra) => Object.assign({
    conflict_desc: 'x', underdetermination: 'mid',
    innocent_explanations: ['可能听错'], generated_by: 'llm',
  }, extra);
  assert.throws(() => store.saveContradictions(g.id, [mk({})]), /至少引用一个/);
  assert.throws(() => store.saveContradictions(g.id, [mk({ claim_a: 9999 })]), /不存在/);
});

// ── 账本纪律：撤回不可改 ──────────────────────────────────────────────────

test('⑧ 账本纪律：撤回后不可再改，且撤回是从视图里消失而非物理删', (t) => {
  fresh(t);
  const g = newGame(3);
  const ev = speak(g.id, 1, '3号是狼');
  const [claim] = store.addClaims(ev.id, [{ seat: 1, subject_seat: 3, predicate: 'is_wolf', object: '3号' }]);

  assert.equal(store.getClaim(claim.id).confirmed_by_user, 0);
  store.updateClaimObject(claim.id, '三号');
  assert.equal(store.getClaim(claim.id).object, '三号');
  assert.equal(store.getClaim(claim.id).confirmed_by_user, 1, '人工改过的声称须标记确认');

  assert.equal(store.retractClaim(claim.id), true);
  // ★retractClaim 返回的是「该行存在且已被标记撤回」，不是「本次调用是否改变了什么」。
  //   所以重复调用同样返回 true —— 这**就是**幂等：终态不变，重复调用不报错。
  //   （第一版我断言第二次返回 false，被判据纠正；语义如上，写在这里免得再改回去。）
  assert.equal(store.retractClaim(claim.id), true, '重复撤回仍返回 true（终态幂等，不报错）');
  assert.equal(store.retractClaim(9999), false, '撤回不存在的行返回 false');
  assert.equal(store.getClaims(g.id).length, 0, '撤回后视图里看不见');
  assert.equal(store.getClaim(claim.id).retracted, 1, '★行仍在库里，只是被标记 —— 账本不可变');
  assert.throws(() => store.updateClaimObject(claim.id, 'x'), /已撤回，不能修改/, '撤回后改写必须被拒');
});

test('⑨ 行动改撤同理，且 patch 必须至少含一个字段', (t) => {
  fresh(t);
  const g = newGame(4);
  const ev = speak(g.id, 2, '我投3号');
  const act = store.addAction({ event_id: ev.id, seat: 2, action: 'vote', target_seat: 3, result: '放逐3号' });
  assert.equal(store.getAction(act.id).target_seat, 3);
  store.updateAction(act.id, { result: '改判：3号平票' });
  assert.equal(store.getAction(act.id).result, '改判：3号平票');
  assert.throws(() => store.updateAction(act.id, {}), /至少含/);
  assert.throws(() => store.updateAction(act.id, { target_seat: 9 }), /不存在/);
  store.retractAction(act.id);
  assert.equal(store.getActions(g.id).length, 0);
  assert.throws(() => store.updateAction(act.id, { result: 'x' }), /已撤回，不能修改/);
});

// ── 读取整局 ──────────────────────────────────────────────────────────────

test('⑩ loadGameState 的 uptoDay 是真闸：第 1 天时看不到第 2 天', (t) => {
  fresh(t);
  const g = newGame(3);
  const e1 = speak(g.id, 1, '第一天我说3号是狼', 1, 'day');
  store.addClaims(e1.id, [{ seat: 1, subject_seat: 3, predicate: 'is_wolf', object: '3号' }]);
  speak(g.id, 2, '第二天我改口', 2, 'day');

  assert.equal(store.loadGameState(g.id).events.length, 2, '不传 = 全部');
  assert.equal(store.loadGameState(g.id, 1).events.length, 1, 'uptoDay=1 只回放第一天');
  assert.equal(store.loadGameState(g.id, 1).claims.length, 1);
  assert.equal(store.loadGameState(g.id, 1).events[0].id, e1.id);
  assert.equal(store.loadGameState(9999), null, '不存在的局返回 null（不抛）');
});

test('⑪ 读侧排序：夜→昼→黄昏，同天内按 seq', (t) => {
  fresh(t);
  const g = newGame(3);
  speak(g.id, 1, '夜晚发言', 1, 'night');
  speak(g.id, 2, '黄昏发言', 1, 'dusk');
  speak(g.id, 3, '白昼发言', 1, 'day');
  const phases = store.listEvents(g.id).map((e) => e.phase);
  assert.deepEqual(phases, ['night', 'day', 'dusk'], '★夜昼黄昏是复盘的时间轴，不能乱序');
});

// ── 参谋卡 ────────────────────────────────────────────────────────────────

test('⑫ 参谋卡落库 = 矛盾 + 假设两组行；引用带前缀记号可解析、非法记号被拒', (t) => {
  fresh(t);
  const g = newGame(4);
  const ev = speak(g.id, 1, '3号是狼');
  const [claim] = store.addClaims(ev.id, [{ seat: 1, subject_seat: 3, predicate: 'is_wolf', object: '3号' }]);

  const written = store.saveAdvisorCard(g.id, 1, {
    // ★存储层的契约：引用从 claim_a/claim_b/action_a/action_b 四个直字段进来；
    //   pair_id → 直字段的映射是**路由层**的活（见 routes/advise.js 的 byPairId 回填）。
    //   （第一版我以为存储层认 pair_id，被判据纠正——写在这里免得再改回去。）
    contradictions: [{
      claim_a: 'c' + claim.id,          // 剥前缀记号必须能解析
      conflict_desc: '与首日查杀冲突', underdetermination: 'high',
      innocent_explanations: ['可能记错轮次'],
    }],
    hypotheses: [{ content: '3号是狼', stance: { 3: 'wolf_suspect' }, support_events: [ev.id], oppose_events: [], tendency: 'mid' }],
  });
  assert.equal(written, 2, '1 矛盾 + 1 假设');

  const cs = store.getContradictions(g.id);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].claim_a, claim.id, '★"c12" 这种带前缀记号必须剥前缀落库');
  assert.equal(cs[0].generated_by, 'llm');
  const hs = store.getHypotheses(g.id);
  assert.equal(hs.length, 1);
  assert.deepEqual(hs[0].stance, { 3: 'wolf_suspect' }, '立场须读回为对象');
  assert.deepEqual(hs[0].support_events, [ev.id]);

  assert.throws(() => store.saveAdvisorCard(g.id, 1, {
    contradictions: [{ claim_a: 'zzz', conflict_desc: 'x', underdetermination: 'mid', innocent_explanations: ['a'] }],
    hypotheses: [],
  }), /引用 id 非法/, '剥不动的记号必须拒，不许猜');
  assert.throws(() => store.saveAdvisorCard(g.id, 1, {
    contradictions: [{ conflict_desc: 'x', underdetermination: 'mid', innocent_explanations: ['a'] }],
    hypotheses: [],
  }), /至少引用一个/, '四个直字段全空也必须拒 —— 不许凭 pair_id 猜');
});

test('⑬ 参谋卡缺数组或假设引用不存在的事件 ⇒ 整卡不落', (t) => {
  fresh(t);
  const g = newGame(3);
  const ev = speak(g.id, 1, 'x');
  assert.throws(() => store.saveAdvisorCard(g.id, 1, { hypotheses: [] }), /须含 contradictions\/hypotheses/);
  assert.throws(() => store.saveAdvisorCard(g.id, 1, {
    contradictions: [],
    hypotheses: [{ content: 'x', stance: {}, support_events: [9999], oppose_events: [], tendency: 'mid' }],
  }), /不存在/);
  assert.equal(store.getHypotheses(g.id).length, 0, '★失败必须整卡不落');
});

// ── BOTC ──────────────────────────────────────────────────────────────────

test('⑭ BOTC 剧本可挂可改可读；非法剧本被拒', (t) => {
  fresh(t);
  const g = newGame(10, 'botc');
  assert.equal(store.getGameScript(g.id), null);
  assert.equal(store.setGameScript(g.id, 'tb'), 'tb');
  assert.equal(store.getGameScript(g.id), 'tb');
  store.setGameScript(g.id, 'snv');
  assert.equal(store.getGameScript(g.id), 'snv', '重复挂 = 改剧本（upsert）');
  assert.throws(() => store.setGameScript(g.id, 'xyz'), /script 非法/);
});

test('⑮ BOTC 阵营声称走私有表，与通用谓词互不串味', (t) => {
  fresh(t);
  const g = newGame(10, 'botc');
  store.setGameScript(g.id, 'tb');
  const ev = speak(g.id, 5, '我是恶魔，6号是爪牙');
  const botc = store.addBotcClaims(ev.id, [
    { seat: 5, subject_seat: 5, predicate: 'is_demon', object: '' },
    { seat: 5, subject_seat: 6, predicate: 'is_minion', object: '' },
  ]);
  assert.equal(botc.length, 2);
  assert.equal(store.listBotcClaims(g.id).length, 2);
  assert.equal(store.getClaims(g.id).length, 0, '★BOTC 谓词不得混进通用 claims 表');

  assert.throws(() => store.addBotcClaims(ev.id, [{ seat: 5, subject_seat: 6, predicate: 'is_wolf', object: '' }]),
    /predicate 非法/, '通用谓词在 BOTC 私有表里非法');

  store.retractBotcClaim(botc[0].id);
  assert.equal(store.listBotcClaims(g.id).length, 1, '撤回即从视图消失');
  assert.throws(() => store.updateBotcClaimObject(botc[0].id, 'x'), /已撤回，不能修改/);
});

// ── 导出与统计 ────────────────────────────────────────────────────────────

test('⑯ 导出自带元信息与计数，且不存在的局返回 null', (t) => {
  fresh(t);
  const g = newGame(3);
  speak(g.id, 1, 'x');
  const out = store.exportGame(g.id);
  assert.equal(out.meta.schema_contract, 'jujian-v1');
  assert.equal(out.meta.counts.events, 1);
  assert.ok(out.meta.exported_at, '导出必须带时间戳');
  assert.equal(store.exportGame(9999), null);
});

test('⑰ 统计口径：撤回的行不计入有效数，但单列', (t) => {
  fresh(t);
  const g = newGame(3);
  const ev = speak(g.id, 1, 'x');
  const [c] = store.addClaims(ev.id, [{ seat: 1, subject_seat: 3, predicate: 'is_wolf', object: '3号' }]);
  assert.deepEqual(store.stats(g.id), {
    events: 1, claims: 1, claims_retracted: 0, actions: 0,
    contradictions: 0, hypotheses: 0, botc_claims: 0,
  });
  store.retractClaim(c.id);
  const s = store.stats(g.id);
  assert.equal(s.claims, 0);
  assert.equal(s.claims_retracted, 1);
});

// ── 事务纪律 ──────────────────────────────────────────────────────────────

test('⑱ 事务嵌套被立即拒（宁可吵一架，不要「以为原子其实不原子」）', (t) => {
  fresh(t);
  const db = store.getConnection();
  assert.throws(() => store.tx(db, () => store.tx(db, () => 1)), /事务嵌套被拒/);
});

test('⑲ tx() 失败必须回滚干净：批内已写的行不残留', (t) => {
  fresh(t);
  const g = newGame(3);
  const ev = speak(g.id, 1, '3号是狼');
  const db = store.getConnection();

  // ★用裸 SQL 直接验 tx() 本身：store 的公开函数各自自带事务，套进去就成了嵌套
  //   （第一版就是这么写的，被嵌套守卫当场拦下——守卫是对的，测法是错的）。
  const ins = db.prepare('INSERT INTO claims (event_id, seat, subject_seat, predicate, object, extracted_by, confirmed_by_user) VALUES (?,?,?,?,?,?,?)');
  assert.throws(() => store.tx(db, () => {
    ins.run(ev.id, 1, 3, 'is_wolf', '3号', 'code', 0);
    ins.run(ev.id, 1, 2, 'is_good', '2号', 'code', 0);
    throw new Error('中途失败');
  }), /中途失败/);
  assert.equal(store.getClaims(g.id).length, 0, '★已写的两行必须一并回滚');

  // 成功路径的对照：同样的写入，不抛错 ⇒ 都在。
  const kept = store.tx(db, () => {
    ins.run(ev.id, 1, 3, 'is_wolf', '3号', 'code', 0);
    return ins.run(ev.id, 1, 2, 'is_good', '2号', 'code', 0).changes;
  });
  assert.equal(kept, 1);
  assert.equal(store.getClaims(g.id).length, 2, '成功事务必须真的提交');

  // 失败后连接仍可用（回滚没有把句柄搞坏）—— 这是「可恢复」的最低要求。
  assert.equal(db.prepare('SELECT 1 AS ok').get().ok, 1);
});

test('⑳ schema 版本不符即拒开库（不做静默迁移）', (t) => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jujian-schema-'));
  const file = path.join(dir, 'v.db');
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ } store.closeCurrent(); });

  store.init(file);
  store.getConnection().prepare('UPDATE meta SET value=? WHERE key=?').run('999', 'schema_version');
  store.closeCurrent();

  // 重新开同一个文件 ⇒ 版本闸必须响亮地拒绝，而不是「默默按新 schema 跑」。
  assert.throws(() => store.init(file), /不做自动迁移/, '版本不符必须拒开');
  store.closeCurrent();
  // 对照：换个新文件，一切正常 —— 证明上面拒的不是「init 这个动作」。
  const okFile = path.join(dir, 'fresh.db');
  store.init(okFile);
  assert.ok(store.getConnection());
});
