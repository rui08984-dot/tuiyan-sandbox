'use strict';
/**
 * p1b/test/predictions-structured-evidence.test.cjs —— 落注端点接受**结构化证据**（带真值锚与基率）。
 *
 * 【病象：建库通路是断的】
 * 真库的 evidence_json 装的是结构化对象数组（`[{ resolve:{kind}, baseRate:{p,n,k,...} }]`），
 * 可落注端点只收**事件 id 数组** ⇒ 走 HTTP 建出来的行没有真值锚、没有基率，
 * 而 base_rate 读数与真值锚端点都用 `json_extract(evidence_json,'$[0].resolve.kind')` 检索
 * ⇒ 那类行**查不到历史频率**，等于落了一本没有索引的账。
 *
 * 【本文件的断言口径】
 *   ① 旧形状（事件 id 数组）**必须继续能用**——向后兼容是硬要求，不许为了新形状牺牲旧调用方。
 *   ② 新形状落库后，用**端点自己那条 SQL**（逐字复制，不另写一条"应该能查到"的近似查询）验证明真能查到。
 *   ③ 非法 resolve.kind 必须被拒，且拒得**像旧形状一样有清单**（沿用 util.js 的 requireEnum 口径，
 *      禁另立魔法字符串式报错）。
 *   ④ baseRate 非法结构不得静默丢字段——丢了就退化成"看起来落库了其实没基率"，那是最坏的失败形态。
 *
 * 铁律：不起真端口（app.inject）；DB=:memory:；零网络。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-struct-evidence-providers-' + process.pid + '-' + Date.now() + '.json');
let app = null;

test.before(async () => {
  app = await buildServer({ dbPath: ':memory:', llmMock: true, providersPath: tmpProviders });
});

test.after(async () => {
  try { if (app) await app.close(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(tmpProviders); } catch (e) { /* ignore */ }
  try { db.closeCurrent(); } catch (e) { /* ignore */ }
});

const j = (r) => r.json();
const gameUrl = (id, suffix) => '/api/games/' + id + (suffix || '');

let gameA = null, evIdA = null;

/**
 * 一个真库同形的结构化证据元素（字段照 1994 行的实际形状给，不臆造字段）。
 * ★slug 刻意**不**插值 kind：否则报错文案里会混进合法 kind，让"须列出支持表"的断言假绿。
 */
function structuredKind(kind) {
  return {
    kind: 'cutoff_snapshot',
    slug: 'corpus:test-fixture',
    ingested_at: '2026-09-12T15:02:08+08:00',
    note: '测试用结构化证据',
    resolve: { kind: kind, lat: 31.23, lon: 121.47, date: '2026-09-14', threshold_c: 35, cmp: '>' },
    baseRateNote: '历史占比：占 1.0%（测试夹具）',
    baseRate: { p: 0.01, n: 300, k: 3, kind: 'empirical', window: null, basis: null, cmp: null, threshold: null, schema: 'evidence.baseRate.v1' },
  };
}

test('建局 A + 一个事件（供旧形状引用）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '结构化证据局', type: 'werewolf', player_count: 6 } });
  assert.equal(r.statusCode, 201);
  gameA = j(r).game;
  // 事件是两步流程：先出候选，再确认落库（与既有 predictions 测试同款）
  const m = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/macro'), payload: { kind: 'claim_role', seat: 2, role: '预言家', day: 1 } });
  assert.equal(m.statusCode, 200, m.body);
  const c = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/events/confirm'), payload: j(m) });
  assert.equal(c.statusCode, 201, c.body);
  evIdA = j(c).event_id;
});

// ── ① 向后兼容：旧形状必须继续能用 ────────────────────────────────────────
test('旧形状（事件 id 数组）仍能落注并原样读回（向后兼容硬要求）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '旧形状：1号出局', prob: 0.6, evidence: [evIdA] } });
  assert.equal(r.statusCode, 201);
  assert.deepEqual(j(r).evidence, [evIdA]);
});

test('旧形状的悬空引用仍被拒（400，不留悬空引用）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '旧形状悬空', prob: 0.6, evidence: [99999999] } });
  assert.equal(r.statusCode, 400);
});

// ── ② 新形状：能落库 ──────────────────────────────────────────────────────
let structRow = null;
test('新形状（结构化对象数组）落注 → 201，真值锚与基率随行落库', async () => {
  const ev = structuredKind('openmeteo_daily_max');
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '新形状：明日最高温>35°C', prob: 0.08, evidence: [ev] } });
  assert.equal(r.statusCode, 201, '结构化证据应被接受，实际: ' + r.statusCode + ' ' + r.body);
  structRow = j(r);
  assert.equal(structRow.evidence.length, 1);
  assert.equal(structRow.evidence[0].resolve.kind, 'openmeteo_daily_max');
  assert.equal(structRow.evidence[0].baseRate.p, 0.01);
});

// ── ③ 核心：落库后必须能被端点自己那条 SQL 查到 ──────────────────────────
test('★落库后 base_rate 那条 SQL（$[0].resolve.kind）能查到这一行（建库通路真的通了）', () => {
  const conn = db.getConnection();
  // 逐字复制 disclosure.js 编译器基率查询里的 WHERE 条件——不另写"应该能查到"的近似查询
  const n = conn.prepare(
    "SELECT COUNT(*) n FROM predictions WHERE json_extract(evidence_json,'$[0].resolve.kind') = ?"
  ).get('openmeteo_daily_max').n;
  assert.equal(n, 1, '刚落库这一行必须能被 base_rate 检索命中');

  // 已结算口径的基率分母查询（disclosure.js 同款）也要能命中
  const hist = conn.prepare(
    "SELECT COUNT(*) n, SUM(CASE WHEN outcome = 'true' THEN 1 ELSE 0 END) hit FROM predictions"
    + " WHERE json_extract(evidence_json,'$[0].resolve.kind') = ? AND resolved_at IS NOT NULL AND outcome IN ('true','false')"
  ).get('openmeteo_daily_max');
  assert.equal(hist.n, 0, '未结算的行不进基率分母（分母口径不被结构化落库污染）');

  // 基率本体也要在库里可读（T8 端点的结构化读数依赖它）
  const br = conn.prepare("SELECT json_extract(evidence_json,'$[0].baseRate.p') p FROM predictions WHERE id = ?").get(structRow.id);
  assert.equal(br.p, 0.01);
});

test('★结算后同一行进入基率分母（端到端：建库→结算→可查）', async () => {
  // 造一个已到期行，否则落定闸会拒（到期日未到不许落定——见 predictions.js not_due 分支）
  const conn = db.getConnection();
  conn.prepare("UPDATE predictions SET matures_at = '2000-01-01' WHERE id = ?").run(structRow.id);
  const r = await app.inject({ method: 'POST', url: '/api/predictions/' + structRow.id + '/resolve', payload: { outcome: 'false', note: '实测 31.2°C' } });
  assert.equal(r.statusCode, 200, r.body);
  const hist = conn.prepare(
    "SELECT COUNT(*) n, SUM(CASE WHEN outcome = 'true' THEN 1 ELSE 0 END) hit FROM predictions"
    + " WHERE json_extract(evidence_json,'$[0].resolve.kind') = ? AND resolved_at IS NOT NULL AND outcome IN ('true','false')"
  ).get('openmeteo_daily_max');
  assert.equal(hist.n, 1);
  assert.equal(hist.hit, 0, 'outcome=false ⇒ 命中数 0，n=1');
});

// ── ④ 校验不许松：非法 kind 必须被拒，且拒得清楚 ──────────────────────────
test('非法 resolve.kind 被拒 400，报错须列出支持表（不许静默收下）', async () => {
  const ev = structuredKind('openmeteo_daily_max');
  ev.resolve.kind = 'not_a_real_kind_xyz';
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '非法锚', prob: 0.5, evidence: [ev] } });
  assert.equal(r.statusCode, 400);
  const msg = j(r).error || j(r).message || r.body;
  assert.ok(/resolve\.kind/.test(msg), '报错须点名被拒的字段（requireEnum 口径）: ' + msg);
  assert.ok(/not_a_real_kind_xyz/.test(msg), '报错须点名收到的坏值: ' + msg);
  assert.ok(/openmeteo_daily_max/.test(msg), '报错须给出支持表里的合法值（沿用 requireEnum 口径）: ' + msg);
});

test('结构化元素缺 resolve.kind 被拒 400（真值锚是必填，不是可选装饰）', async () => {
  const ev = structuredKind('openmeteo_daily_max');
  delete ev.resolve.kind;
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '缺锚', prob: 0.5, evidence: [ev] } });
  assert.equal(r.statusCode, 400);
  const msg = j(r).error || j(r).message || r.body;
  assert.ok(/resolve\.kind/.test(msg), '须指名缺的是 resolve.kind: ' + msg);
});

test('baseRate 结构非法被拒 400，且拒因**是**基率（不许静默丢基率字段）', async () => {
  const ev = structuredKind('openmeteo_daily_max');
  ev.baseRate.p = 7; // 越界
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '坏基率', prob: 0.5, evidence: [ev] } });
  assert.equal(r.statusCode, 400);
  const msg = j(r).error || j(r).message || r.body;
  // ★关键：必须**不是**"evidence[] 必须是 ≥1 的整数"那句——那说明形状分派还没走到基率校验，
  //   本测试就假绿了。拒因必须落在基率上。
  assert.ok(!/必须是 ≥1 的整数/.test(msg), '须先过形状分派再拒基率，当前拒因是形状: ' + msg);
  assert.ok(/baseRate/.test(msg), '须指名坏的是 baseRate（不得静默丢弃）: ' + msg);
});

test('baseRate 缺 p 被拒 400，且拒因**是**基率（无 p 的基率不是基率）', async () => {
  const ev = structuredKind('openmeteo_daily_max');
  delete ev.baseRate.p;
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '无 p 基率', prob: 0.5, evidence: [ev] } });
  assert.equal(r.statusCode, 400);
  const msg = j(r).error || j(r).message || r.body;
  assert.ok(!/必须是 ≥1 的整数/.test(msg), '须先过形状分派再拒基率: ' + msg);
  assert.ok(/baseRate/.test(msg), '须指名坏的是 baseRate: ' + msg);
});

test('baseRate 可选：不带 baseRate 的结构化元素仍可落库（真值锚独立成立）', async () => {
  const ev = structuredKind('openmeteo_daily_max');
  delete ev.baseRate;
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '只有锚没有基率', prob: 0.5, evidence: [ev] } });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(j(r).evidence[0].resolve.kind, 'openmeteo_daily_max');
});

// ── ⑤ 混形状不许混进一行：$[0] 是唯一被读的位置 ───────────────────────────
test('整数 id 与结构化对象混在同一行被拒 400，且拒因**是**混形状（$[0] 读不到锚＝通路没通）', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '混形状', prob: 0.5, evidence: [structuredKind('openmeteo_daily_max'), evIdA] } });
  assert.equal(r.statusCode, 400);
  const msg = j(r).error || j(r).message || r.body;
  // 同上：若拒因还是"evidence[] 必须是 ≥1 的整数"，说明是靠形状分派的副作用拒的，本测试假绿
  assert.ok(!/必须是 ≥1 的整数/.test(msg), '须由混形状判据拒绝，而不是整数校验的副作用: ' + msg);
  assert.ok(/混|两种形状/.test(msg), '须说清为什么混形状不行: ' + msg);
});

test('新形状不因 event 校验而误伤（结构化元素不该被当事件 id 查库）', async () => {
  const ev = structuredKind('openmeteo_daily_max');
  const r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '结构化不查 events 表', prob: 0.5, evidence: [ev] } });
  assert.equal(r.statusCode, 201, r.body);
});

// ── ⑥ 沿用 util.js 校验器口径，不另立魔法字符串 ───────────────────────────
test('结构化路径复用 util.js 的 requireEnum（枚举口径单一，禁另立）', () => {
  const util = require('../src/util');
  const kindGate = require('../src/evidence/resolveKind');
  // 支持表必须来自既有注册表（契约表 contracts∪aliases + revealClass），不是手抄的字面量
  const ks = kindGate.supportedKinds();
  assert.ok(ks.length >= 50, '支持表应覆盖真库在用 kind，实得 ' + ks.length);
  // requireEnum 口径：错误信息含字段名、收到的值、全部枚举值
  try { util.requireEnum('resolve.kind', 'nope_xyz', ks); assert.fail('应抛 400'); }
  catch (e) {
    assert.equal(e.statusCode, 400);
    assert.ok(/resolve\.kind/.test(e.message));
    assert.ok(/nope_xyz/.test(e.message));
  }
});

test('真库在用的 52 种 kind 全部在支持表内（支持表不得误拒已在用的锚）', () => {
  const kindGate = require('../src/evidence/resolveKind');
  const ks = kindGate.supportedKinds();
  // 抽样真库高频 kind（含只在 aliases 里、不在 contracts 里的那几个——支持表少算就会误拒）
  ['openmeteo_daily_max', 'dbnomics_series_value', 'binance_daily_close', 'cwl_ssq_red_contains',
   'openmeteo_air_daily_mean', 'openmeteo_wx_daily', 'noaa_tide_daily_high', 'noaa_tide_daily_max',
   'dbnomics_bis_monthly_mean', 'eurostat_demo_pjan_annual', 'delphi_fluview_ili', 'oddsapi_h2h',
  ].forEach((k) => assert.ok(ks.indexOf(k) !== -1, '已在真库使用的 kind 不得被支持表误拒: ' + k));
});

// ── ⑦ 新行要能被读端真的读出来（写进去只是半程）─────────────────────────
test('新行能被真值锚/基率端点读出：truth_anchor 与 base_rate 都在（结构化写入的兑现）', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/predictions/' + structRow.id });
  assert.equal(r.statusCode, 200, r.body);
  const b = j(r);
  assert.equal(b.truth_anchor.kind, 'openmeteo_daily_max', '真值锚须原样读回');
  assert.ok(b.base_rate, '基率须读得出（结构化优先路径）');
  assert.equal(b.base_rate.via, 'structured');
  assert.equal(b.base_rate.p, 0.01);
  assert.equal(b.base_rate.n, 300);
  assert.equal(b.base_rate.enough, true, 'n=300 ≥30 ⇒ 够强；这条同时验 MIN_N 口径没被我改坏');
});

test('★只读端点零写：读一次详情后整表逐列不变（禁「只读端点写库」）', async () => {
  const conn = db.getConnection();
  const snap = () => conn.prepare('SELECT id, statement, assigned_prob, evidence_json, resolved_at, outcome, resolve_note, matures_at, created_at FROM predictions ORDER BY id').all();
  const before = JSON.stringify(snap());
  await app.inject({ method: 'GET', url: '/api/predictions/' + structRow.id });
  await app.inject({ method: 'GET', url: '/api/predictions/' + structRow.id });
  const after = JSON.stringify(snap());
  assert.equal(after, before, 'GET 详情后账本逐列必须逐字不变');
});

// ── ⑧ requireProb 口径不许被顺手动过 ─────────────────────────────────────
test('结构化证据在场时 prob 口径不变：越界仍 400、口语仍拒', async () => {
  const ev = structuredKind('openmeteo_daily_max');
  let r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '越界', prob: 1.5, evidence: [ev] } });
  assert.equal(r.statusCode, 400);
  assert.ok(/prob/.test(j(r).error || r.body), '须是 prob 拒的，不是别的: ' + r.body);
  r = await app.inject({ method: 'POST', url: gameUrl(gameA.id, '/predictions'), payload: { statement: '口语', prob: '大概率', evidence: [ev] } });
  assert.equal(r.statusCode, 400);
  assert.ok(/prob/.test(j(r).error || r.body), '口语 prob 仍须拒: ' + r.body);
});

// ── ⑨ 支持表读不到时不得静默放行（写不出来的锚进不可改的账＝永久错）─────
test('支持表不可读 ⇒ 显式抛错说缺件，不返回空表（空表＝任何 kind 都非法，会把整条通路锁死）', () => {
  const kindGate = require('../src/evidence/resolveKind');
  let err = null;
  try { kindGate.supportedKindsFrom(kindGate.CONTRACT_PATH + '.no-such-file'); } catch (e) { err = e; }
  assert.ok(err, '缺件时必须抛错');
  assert.ok(/不可读|缺件/.test(err.message), '须说清是缺件: ' + err.message);
  // 关键：不得被误读成"用户 kind 填错了"——不许出现 requireEnum 的枚举句式
  assert.ok(!/必须是/.test(err.message), '不得伪装成"kind 不在枚举里": ' + err.message);
  // 坏 JSON 同样必须显式失败，不得静默降级成空表
  const tmpBad = path.join(os.tmpdir(), 'p1b-bad-contract-' + process.pid + '.json');
  fs.writeFileSync(tmpBad, '{ not json', 'utf8');
  let err2 = null;
  try { kindGate.supportedKindsFrom(tmpBad); } catch (e) { err2 = e; }
  fs.unlinkSync(tmpBad);
  assert.ok(err2 && /不可解析/.test(err2.message), '坏 JSON 须显式报不可解析: ' + (err2 && err2.message));
});

test('真表读得出来且与 deriveSupportedKinds 纯函数口径一致（缓存路径与直读路径不许分叉）', () => {
  const kindGate = require('../src/evidence/resolveKind');
  const contract = kindGate.readContract(kindGate.CONTRACT_PATH);
  const fresh = kindGate.deriveSupportedKinds(contract, require('../src/evidence/revealClass').REVEAL_CLASS);
  assert.deepEqual(fresh, kindGate.supportedKinds(), '缓存派生与纯函数派生必须同表');
});
