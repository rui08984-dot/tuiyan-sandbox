'use strict';
/**
 * 揭晓分流闸（2026-09-28 · T6 / 模块 M3 后端半）
 *
 * 病象：旧「待落定」页把到期未解的题列成一队、让人**全部手填**，
 *   但守护进程已在自动结算（实测一轮：到期 21 → 自动结 2 / pending 12 / fail 7）。
 *   ⇒ 那页是**倒退设计**。本件把「到期未解」按能不能自动揭晓分三类。
 *
 * 三条不可让步的纪律：
 *   ① 三类**互斥且完备**——每个到期未解的题必属其一，不许有"四不像"
 *   ② **stuck 不给可点按钮**——点了没反应比不给更糟，用户会以为是 bug
 *   ③ 只读：端点不改账本任何一列（揭晓仍由守护进程与 resolve 接口写）
 *
 * ★2026-09-28 补：前五条只是**扫源码**（证明不了返回体对不对）。
 *   真病象就藏在返回体里——端点把 openRows 分了 ok/human/stuck 三桶，
 *   却只回 need_human 与 stuck 两桶，**ok 桶算完就扔**：counts.ok 有数、明细没行。
 *   ⇒ 后五条用 app.inject 真打一次端点，验「互斥且完备」与「只读」。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RC = require(path.join(ROOT, 'src', 'evidence', 'revealClass.js'));
const route = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'disclosure.js'), 'utf8');

test('① 三类互斥且完备：每个 kind 恰属其一', () => {
  for (const [kind, spec] of Object.entries(RC.REVEAL_CLASS)) {
    assert.ok(['ok', 'human', 'stuck'].includes(spec.c),
      kind + ' 的类必须是 ok/human/stuck 之一，实得 ' + spec.c);
    assert.ok(spec.note && spec.note.length > 4, kind + ' 必须有**人话理由**（说清为什么）');
  }
});

test('①b 未登记的 kind 保守落到 human（宁可问一句，不给错按钮）', () => {
  const c = RC.classifyReveal('some_never_seen_kind');
  assert.equal(c.c, 'human', '未登记的须保守处理');
  assert.ok(c.note, '须有说明');
});

test('② stuck 类必须写明「代码无法解决」或「窗口已过」', () => {
  // 给了假按钮却不说为什么，是最伤的一种
  for (const [kind, spec] of Object.entries(RC.REVEAL_CLASS)) {
    if (spec.c !== 'stuck') continue;
    assert.ok(/无法解决|永久|过期|已过|封禁/.test(spec.note),
      kind + ' 的 stuck 理由须说清「不可解」而不是只说「没查到」：' + spec.note);
  }
});

test('★③ 端点只读：不得写账本', () => {
  const i = route.indexOf('/api/disclosure/resolve-queue');
  assert.ok(i > 0, '端点须存在');
  // ★2026-09-29 修：原来写死 slice(i, i+2200)，那是**量魔数不是量行为**——
  //   端点块现在长 3514 字符，窗口根本够不到下面的断言内容，测试只剩「没报错」的意义。
  //   改成按端点块的**真实边界**取（下一个路由注册为止），断言本身一字未动。
  const nxt = route.indexOf('app.get(', i + 10);
  const block = route.slice(i, nxt > 0 ? nxt : route.length);

  assert.equal(/INSERT|UPDATE|DELETE/i.test(block), false, '本端点只读，不得有写库语句');
  assert.ok(block.includes('resolved_at IS NULL') || block.includes('resolved_at IS NOT NULL'),
    '须按是否已结算分流');
});

test('④ 端点自带纪律声明（前端要据此写文案）', () => {
  const i = route.indexOf('/api/disclosure/resolve-queue');
  const nxt4 = route.indexOf('app.get(', i + 10);
  const block = route.slice(i, nxt4 > 0 ? nxt4 : route.length);
  assert.ok(block.includes('discipline'), '须返回 discipline 声明块');
  assert.ok(/不给可点按钮|不给.*按钮/.test(block), '须声明「stuck 不给假按钮」');
});

// ══════════════════════════════════════════════════════════════════
// ★ 以下真打端点（app.inject；DB=:memory:，零真端口、零外呼、零 LLM）
// ══════════════════════════════════════════════════════════════════
const { buildServer } = require(path.join(ROOT, 'src', 'server.js'));
const { db } = require(path.join(ROOT, 'src', 'deps.js'));

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-reveal-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;
let GID = 0;

/** 种子：三桶各 2 条，另加 4 条**不该进三桶**的对照行（完备性就靠它们把关） */
const SEEDS = [
  { s: '闸门·机器查·气象实测', k: 'openmeteo_daily_max',      m: '2020-01-01', done: null },
  { s: '闸门·机器查·汇率',     k: 'frankfurter_rate',         m: '2020-01-02', done: null },
  { s: '闸门·人答·等开奖',     k: 'cwl_ssq_red_contains',     m: '2020-01-03', done: null },
  { s: '闸门·人答·kind未登记', k: 'never_registered_kind_xyz', m: '2020-01-04', done: null },
  { s: '闸门·卡死·地域封禁',   k: 'cta_daily_total_rides',    m: '2020-01-05', done: null },
  { s: '闸门·卡死·窗口已过',   k: 'oddsapi_h2h',              m: '2020-01-06', done: null },
  // ↓ 三条「不该进三桶」：未到期 / 无到期日 / 已结算
  { s: '闸门·未到期',           k: 'openmeteo_daily_max',      m: '2099-01-01', done: null },
  { s: '闸门·无到期日',         k: 'openmeteo_daily_max',      m: null,         done: null },
  { s: '闸门·已结算真',         k: 'openmeteo_daily_max',      m: '2020-01-01', done: 'true' },
  { s: '闸门·已结算假',         k: 'cwl_ssq_red_contains',     m: '2020-01-02', done: 'false' },
];

/** 账本全量快照：只读闸靠它证明「打完一行没动」 */
function snapshot(conn) {
  return conn.prepare('SELECT * FROM predictions ORDER BY id').all()
    .map((r) => JSON.stringify(r)).join('\n');
}

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
  const conn = db.getConnection();
  const g = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '闸门局', type: 'werewolf', player_count: 6 } });
  GID = g.json().game.id;
  const ins = conn.prepare(
    'INSERT INTO predictions (game_id, source_type, statement, assigned_prob, evidence_json, layer, matures_at, resolved_at, outcome)' +
    ' VALUES (?,?,?,?,?,?,?,?,?)'
  );
  for (const d of SEEDS) {
    ins.run(GID, '预测卡', d.s, 0.5,
      JSON.stringify([{ resolve: d.k ? { kind: d.k } : {} }]), 'L2', d.m,
      d.done ? '2020-02-01' : null, d.done);
  }
});

test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

test('★⑤ 真打端点：三类互斥且完备（每条必属且只属其一，合计＝到期未解总数）', async () => {
  const conn = db.getConnection();
  const before = snapshot(conn);

  const res = await app.inject({ method: 'GET', url: '/api/disclosure/resolve-queue' });
  assert.equal(res.statusCode, 200, '端点须 200（实得 ' + res.statusCode + '：' + res.body.slice(0, 200) + '）');
  const b = res.json();

  // ① 三个桶都必须是数组——ok 桶此前压根没返回，这里就是红点
  for (const k of ['ok', 'need_human', 'stuck']) {
    assert.ok(Array.isArray(b[k]), '返回体缺 ' + k + ' 桶（counts 有数、没明细 ⇒ 前端拿不到行）');
  }
  const ids = { ok: new Set(b.ok.map((r) => r.id)), need_human: new Set(b.need_human.map((r) => r.id)), stuck: new Set(b.stuck.map((r) => r.id)) };

  // ② 互斥：两两不得共有一条
  for (const [x, y] of [['ok', 'need_human'], ['ok', 'stuck'], ['need_human', 'stuck']]) {
    for (const id of ids[x]) {
      assert.equal(ids[y].has(id), false, '#' + id + ' 同时落在 ' + x + ' 与 ' + y + ' ⇒ 互斥破了');
    }
  }

  // ③ 完备：并集 ≡ 到期未解全量。
  //    期望集由本测试**独立重算**（不抄端点的 WHERE）——抄了就等于自己判自己及格。
  const today = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
  const expect = conn.prepare(
    "SELECT id FROM predictions WHERE resolved_at IS NULL AND matures_at IS NOT NULL" +
    ' AND substr(matures_at,1,10) <= ? ORDER BY id'
  ).all(today).map((r) => r.id);
  assert.equal(expect.length, 6, '种子应造出 6 条到期未解（实得 ' + expect.length + '）');

  const union = new Set([...ids.ok, ...ids.need_human, ...ids.stuck]);
  for (const id of expect) assert.ok(union.has(id), '到期未解的 #' + id + ' 没进任何一类 ⇒ 不完备');
  for (const id of union) assert.ok(expect.includes(id), '#' + id + ' 不在到期未解集里却进了三桶');
  assert.equal(union.size, b.ok.length + b.need_human.length + b.stuck.length, '三桶合计 ≠ 并集（有重复 ⇒ 互斥破了）');

  // ④ 每条必属：桶名与 cls 一致，且都带人话理由
  const CLS = { ok: 'ok', need_human: 'human', stuck: 'stuck' };
  for (const bucket of ['ok', 'need_human', 'stuck']) {
    for (const r of b[bucket]) {
      assert.equal(r.cls, CLS[bucket], bucket + ' 桶里混进了 cls=' + r.cls + ' 的行');
      assert.ok(r.why && String(r.why).length > 3, '#' + r.id + ' 缺人话理由');
    }
  }

  // ⑤ 计数与明细必须对得上（counts.ok 有数无行，正是本闸要治的病）
  assert.equal(b.counts.ok, b.ok.length, 'counts.ok 与 ok 桶行数对不上');
  assert.equal(b.counts.need_human, b.need_human.length, 'counts.need_human 与 need_human 桶对不上');
  assert.equal(b.counts.stuck, b.stuck.length, 'counts.stuck 与 stuck 桶对不上');
  assert.equal(b.counts.auto_revealed, b.auto_revealed.length, 'counts.auto_revealed 与明细对不上');
  assert.equal(b.counts.open_total, union.size, 'counts.open_total ≠ 三桶合计');
  // ★不许再有第二套指向别的集合的同名计数（此前 counts.human 与 need_human 各指一个集合）
  for (const k of ['human', 'unknown']) {
    assert.equal(b.counts[k], undefined, 'counts.' + k + ' 与返回体桶名不同源 ⇒ 界面会数错');
  }

  // ⑥ 已结算的不得混进未落定三桶（反之：无到期日/未到期的也不该混进来）
  for (const r of b.auto_revealed) assert.equal(union.has(r.id), false, '已结算 #' + r.id + ' 混进了未落定桶');
  assert.equal(b.auto_revealed.length, 2, '种子应造出 2 条已结算（实得 ' + b.auto_revealed.length + '）');

  // ⑦ 未登记 kind 保守落 need_human，并如实标出是哪几条（不是第四类，是它的子桶）
  const unreg = b.need_human.filter((r) => r.unregistered);
  assert.equal(unreg.length, 1, '未登记 kind 应落 need_human 且标 unregistered（实得 ' + unreg.length + '）');
  assert.equal(b.counts.unregistered, unreg.length, 'counts.unregistered 与明细对不上');

  // ⑧ ★只读：打完之后账本一字不差（只读不只是「源码里没写 INSERT」）
  assert.equal(snapshot(conn), before, '本端点只读，打完账本必须一字不差');
});

test('★⑥ ok 桶回归闸：counts.ok > 0 时必须同时给得出行（此前只有数没有行）', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/disclosure/resolve-queue' });
  const b = res.json();
  assert.ok(b.counts.ok > 0, '种子应造出 ok 类（否则本闸空转）');
  assert.ok(Array.isArray(b.ok), '★ok 桶明细缺失：counts.ok 有数、返回体没 ok ⇒ 前端只能写「既不列出来也不给键」');
  assert.equal(b.ok.length, b.counts.ok, 'ok 桶行数与 counts.ok 不符');
  for (const r of b.ok) {
    assert.equal(r.cls, 'ok', '#' + r.id + ' cls 应为 ok');
    assert.ok(r.matures_at, '#' + r.id + ' ok 行须带到期日（否则页面无从说「等它自己查」）');
    assert.ok(r.why && /自动|到期/.test(r.why), '#' + r.id + ' ok 行须说清「机器到期自己会查」：' + r.why);
  }
});

test('★别人的题只报数、不列行（不泄露别人的题面），且三桶仍守恒', async () => {
  // ★照 p1b/test/question-views.test.cjs:230 同一条红线，另加在 resolve-queue 上。
  //   那条红线此前只覆盖 /api/analytics 侧；本端点是后加的，给行打了 view_bucket 标签
  //   却照样把 statement 原样返回 ⇒ 题面随响应体进了浏览器。**前端不渲染 ≠ 没泄露。**
  const conn = db.getConnection();

  // ── 造一个真在 others 桶里的行，否则断言会空跑（这正是本测试第一版的毛病）──
  const a = (await app.inject({ method: 'POST', url: '/api/analytics/session/start', payload: {} })).json().visitor_id;
  const b = (await app.inject({ method: 'POST', url: '/api/analytics/session/start', payload: {} })).json().visitor_id;
  const secret = '这是别人的题面·不该出现在我的待落定列表里';
  const ins = conn.prepare(
    'INSERT INTO predictions (game_id, source_type, statement, assigned_prob, evidence_json, layer, matures_at)' +
    ' VALUES (?,?,?,?,?,?,?)'
  );
  ins.run(GID, '预测卡', secret, 0.5, JSON.stringify([{ resolve: { kind: 'cwl_ssq_red_contains' } }]), 'L2', '2020-01-07');
  const mine = conn.prepare("SELECT id FROM predictions WHERE statement = ?").get(secret).id;
  const claim = await app.inject({ method: 'POST', url: '/api/analytics/claim', payload: { prediction_id: mine, visitor_id: a } });
  assert.equal(claim.statusCode, 200, '认领须成功（实得 ' + claim.statusCode + '：' + claim.body.slice(0, 200) + '）');

  // ── 以 B 的身份取待落定列表 ──
  const res = await app.inject({ method: 'GET', url: '/api/disclosure/resolve-queue?visitor_id=' + encodeURIComponent(b) });
  assert.equal(res.statusCode, 200, '端点须 200');
  const body = res.json();

  // ① 前置条件：别人桶里**确实有行**——没有这条，本测试就是空跑绿灯
  assert.ok(body.open_buckets.others >= 1,
    '★本测试的前置条件：B 的视角下别人桶须至少 1 条（实得 ' + body.open_buckets.others + '）——否则断言空跑');

  // ② 红线本体：整个响应体里不得出现那道题面
  assert.ok(!res.body.includes(secret),
    '★别人的题面泄进了响应体（前端不渲染不等于没泄露）');

  // ③ 别人的行仍在（不隐藏存在），但 statement 已被服务端抹掉
  const others = [...body.ok, ...body.need_human, ...body.stuck].filter((r) => r.view_bucket === 'others');
  for (const r of others) {
    assert.equal(r.statement, null, '#' + r.id + ' 是别人的题，statement 必须为 null（只报数、不列行）');
  }

  // ④ 三桶仍守恒（脱敏不许把行藏起来）
  assert.equal(
    body.open_buckets.mine + body.open_buckets.corpus + body.open_buckets.others,
    body.counts.open_total,
    '★脱敏后三桶之和仍须 ≡ open_total'
  );

  // ⑤ 反向：换成 A 的身份，题面该回来（证明不是「一律抹掉」的假修复）
  const asA = await app.inject({ method: 'GET', url: '/api/disclosure/resolve-queue?visitor_id=' + encodeURIComponent(a) });
  assert.ok(asA.body.includes(secret), '★自己的题面必须照常返回——否则这条闸变成了「一律不给」');
});
