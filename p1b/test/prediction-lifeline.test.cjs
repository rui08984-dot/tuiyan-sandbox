'use strict';
/**
 * p1b/test/prediction-lifeline.test.cjs —— GET /api/predictions/:id 单题完整一生（2026-09-28 T8）
 *
 * 病象：清单页给的是「行」，但一道题要被读懂，缺的是**因果链**：
 *   当时押了多少 → 引擎当时给的基率 → 真值是什么 → 判词留了几条 → **这个真值本身可不可信**。
 *   最后一条最要紧：真库里有 98 行的真值是「事件发生前的预报值」（结算时间戳早于事件日），
 *   不标出来就和事后观测长得一模一样。
 *
 * 本文件锁的口径（全部引用项目既有纪律，不新造）：
 *   ① 基率读序单一真源在 evidence/baseRate.js——本端点只调它，不另写解析器；
 *   ② n 缺失（「不知道分母」）与 n<30（「分母太小」）是**两套话**，措辞不得混；
 *   ③ 真值口径排除的布尔判定单一真源在 evidence/truthBasis.js，本端点只解释不判定；
 *      测试逐行断言「命中项非空」⟺「excluded」——两处口径一旦漂移立刻红。
 *   ④ 只读零写：新增块内不得出现任何写库语句（源码锁）。
 *   ⑤ 面向用户的说明句禁出现该词（披露纪律）。
 *
 * 铁律：不起真端口（app.inject）；DB=:memory:；LLM 全 mock（零网络）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const store = require('../src/db/predictionsStore');
const vstore = require('../src/db/verdictsStore');
const truthBasis = require('../src/evidence/truthBasis');

const ROUTE_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'predictions.js'), 'utf8');
const tmpProviders = path.join(os.tmpdir(), 'p1b-test-lifeline-providers-' + process.pid + '-' + Date.now() + '.json');
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
const get = async (id) => {
  const r = await app.inject({ method: 'GET', url: '/api/predictions/' + id });
  return { status: r.statusCode, body: j(r) };
};

let gameId = null;
const rows = {};   // id → 场景名

/** 直接用 store 造行：路由的落注口拒收非事件 id 证据，而真库里的证据是**结构化对象**（真值锚+基率）。 */
function makeRow(name, o) {
  const row = store.insertPrediction({
    gameId: gameId,
    day: 1,
    sourceType: o.sourceType || '预测卡',
    statement: o.statement,
    prob: o.prob === undefined ? 0.5 : o.prob,
    evidence: o.evidence || [],
    maturesAt: o.maturesAt === undefined ? null : o.maturesAt,
    layer: o.layer === undefined ? 'L3' : o.layer,
    engine: o.engine === undefined ? 'aci' : o.engine,
  });
  rows[name] = row.id;
  return row.id;
}

const OK_NOTE = 'Open-Meteo archive 2026-12-01 max=30.7C（阈值 35C，机检）';
const FORECAST_NOTE = 'Open-Meteo forecast 2026-12-01 max=30.6C（阈值 >27，机检）';

test('建局（造行的落点）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '一生局', type: 'werewolf', player_count: 6 } });
  assert.equal(r.statusCode, 201);
  gameId = j(r).game.id;
});

test('造四种行：口径正常 / 口径缺陷(kind) / 口径缺陷(注记) / 无基率', () => {
  // ① 口径正常：结算发生在事件日之前？不——matures_at 早于今天 ⇒ 时序条件不成立
  makeRow('ok', {
    statement: '【观测口径】上海 12-01 日最高 >35°C',
    prob: 0.01,
    maturesAt: '2020-01-01',
    evidence: [{ resolve: { kind: 'openmeteo_daily_max', threshold_c: 35, cmp: '>' },
      baseRateNote: '气候基率：上海 2015-2024 共 300 个 9 月日，max>35°C 占 1.0%（archive 实抓）' }],
  });
  store.resolvePrediction(rows.ok, 'false', OK_NOTE);

  // ② 口径缺陷·kind 命中：到期日在未来（结算早于事件日）＋ 真值锚 kind 含 forecast
  // ★2026-09-28：`resolvePrediction` 已加到期设防（未到期一律拒写，见 predictionsStore.maturityState）。
  //   本夹具的存在意义**就是**造一条「结算早于事件日」的行供端点检出并标 excluded，
  //   所以这里必须显式开 `allowNotDue` 逃生口——这是该口的唯一合法用途。
  //   ⚠ HTTP 路由一律不得透传该口，透传即等于把设防拆掉。
  makeRow('defectKind', {
    statement: '【预报口径】上海 12-01 日最高 >27°C',
    prob: 0.56,
    maturesAt: '2027-01-01',
    evidence: [{ resolve: { kind: 'openmeteo_forecast_daily_max', threshold_c: 27, cmp: '>' },
      baseRateNote: '前瞻·上海：2015-2024 archive 同月 300 个日值中 max>27°C 占 56.3%' }],
  });
  store.resolvePrediction(rows.defectKind, 'true', FORECAST_NOTE, { allowNotDue: true });

  // ③ 口径缺陷·注记命中：kind 干净，但结算注记自己写了 forecast ⇒ 同样该被排除（同上，走逃生口）
  makeRow('defectNote', {
    statement: '【注记缺陷】某序列 12-01 落定值',
    prob: 0.4,
    maturesAt: '2027-06-01',
    evidence: [{ resolve: { kind: 'dbnomics_series_value', series: 'M.USD.EUR.SP00', cmp: '<' } }],
  });
  store.resolvePrediction(rows.defectNote, 'true', FORECAST_NOTE, { allowNotDue: true });

  // ④ 无基率：证据里既无结构化基率也无注记 ⇒ 基率只能是 null，不许拿别处的数来凑
  makeRow('noBase', {
    statement: '【无基率】纯人工题',
    prob: 0.5,
    maturesAt: null,
    evidence: [{ resolve: { kind: 'manual_judgement' } }],
  });

  // ⑤ 未结算 + 无概率（验证点自动落卡形态）：两个 null 都必须如实留空
  makeRow('open', {
    statement: '【未结算】到期后再看',
    prob: null,
    sourceType: '验证点',
    maturesAt: '2027-12-31',
    evidence: [],
  });
  for (const k of Object.keys(rows)) assert.ok(Number.isInteger(rows[k]) && rows[k] > 0, '行 ' + k + ' 未造出');
});

// ── 端点存在性与字段完整性 ──
test('① GET 单题：200 + 七个必答字段全部在场', async () => {
  const { status, body } = await get(rows.ok);
  assert.equal(status, 200);
  assert.equal(body.id, rows.ok);
  assert.equal(body.statement, '【观测口径】上海 12-01 日最高 >35°C');
  assert.equal(body.assigned_prob, 0.01);       // 你的数
  assert.ok(body.base_rate, '引擎基率须在场');
  assert.equal(body.outcome, 'false');          // 真值
  assert.ok(body.resolved_at, '结算时间须在场');
  assert.equal(typeof body.verdict_count, 'number');
  assert.equal(typeof body.truth_basis.excluded, 'boolean');
});

test('② 基率读数逐字来自 evidence.baseRate（结构化优先），不是本端点重算的', async () => {
  const { body } = await get(rows.ok);
  const raw = JSON.parse(db.getConnection().prepare('SELECT evidence_json FROM predictions WHERE id = ?').get(rows.ok).evidence_json);
  const structured = raw[0].baseRate;
  assert.ok(structured, '写端已把注记物化成结构化基率（attachBaseRate）');
  assert.equal(body.base_rate.via, 'structured');
  assert.equal(body.base_rate.p, structured.p);
  assert.equal(body.base_rate.n, structured.n);
  assert.equal(body.base_rate.k, structured.k);
  assert.equal(body.base_rate.kind, structured.kind);
});

test('③ ★n<30 必须降级为「只记方向」；n 未知必须说「不知道分母」——两者不是同一句话', async () => {
  // 12 天样本
  makeRow('thin', {
    statement: '【薄样本】某序列 12 天窗口',
    prob: 0.5, maturesAt: null,
    evidence: [{ resolve: { kind: 'openmeteo_daily_max' }, baseRateNote: '前瞻：过去 12 天里达标占 50.0%' }],
  });
  const thin = (await get(rows.thin)).body;
  assert.equal(thin.base_rate.n, 12);
  assert.equal(thin.base_rate.enough, false, 'n=12 必须 enough:false');
  assert.match(thin.base_rate.note, /<30/);
  assert.match(thin.base_rate.note, /只能记方向/);   // 与 compiler 门面同一句式（披露件口径统一）

  // 300 天样本
  makeRow('thick', {
    statement: '【厚样本】某序列 300 天窗口',
    prob: 0.02, maturesAt: null,
    evidence: [{ resolve: { kind: 'openmeteo_daily_max' }, baseRateNote: '历史：过去 300 天中达标占 1.0%' }],
  });
  const thick = (await get(rows.thick)).body;
  assert.equal(thick.base_rate.n, 300);
  assert.equal(thick.base_rate.enough, true);
  assert.equal(/只能记方向/.test(thick.base_rate.note), false, '样本够时不得再挂「只能记方向」');

  // 没有注记 ⇒ 基率整个是 null，不拿别处的数凑
  const nb = (await get(rows.noBase)).body;
  assert.equal(nb.base_rate, null, '无基率须如实 null（禁代填）');
});

test('④ ★真值口径排除标记：kind 命中 / 注记命中都为 true，观测口径为 false', async () => {
  assert.equal((await get(rows.ok)).body.truth_basis.excluded, false, '观测口径不得被误伤');
  assert.equal((await get(rows.defectKind)).body.truth_basis.excluded, true);
  assert.equal((await get(rows.defectNote)).body.truth_basis.excluded, true);
  // 未结算行谈不上海报口径
  assert.equal((await get(rows.open)).body.truth_basis.excluded, false);
});

test('⑤ ★判定与解释必须同源：命中项非空 ⟺ excluded（五种行逐行核）', async () => {
  for (const k of Object.keys(rows)) {
    const b = (await get(rows[k])).body;
    assert.equal(b.truth_basis.hits.length > 0, b.truth_basis.excluded,
      '行 ' + k + '：布尔判定（truthBasis）与命中项清单（路由）不一致 ⇒ 两处口径漂移了');
  }
  // 命中项须真的指出「结算早于事件日」这一条，而不是空话
  const hit = (await get(rows.defectKind)).body.truth_basis.hits.join(' | ');
  assert.match(hit, /预报口径/);
  assert.match(hit, /2027-01-01/);
});

test('⑥ 排除标记不隐藏题面：被排除的行照样完整返回（正因如此，标记才必须同屏）', async () => {
  const b = (await get(rows.defectKind)).body;
  assert.ok(b.statement && b.outcome === 'true' && b.resolved_at, '被排除的行不得缺胳膊少腿');
  assert.ok(b.truth_basis.fingerprint_sha256 && b.truth_basis.n_excluded_at_freeze > 0,
    '须附排除集的指纹与冻结计数（禁静默丢）');
});

test('⑦ 判词：条数与列表来自同一次读，逐条对得上', async () => {
  const before = (await get(rows.ok)).body.verdict_count;
  assert.equal(before, 0, '初始无判词');
  vstore.saveVerdict({ predictionId: rows.ok, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: '证据聚合：倾向不成立。\n\nRange: 1%-5%\nP=0.03', impliedProb: 0.03 });
  vstore.saveVerdict({ predictionId: rows.ok, promptVariant: 'v2_skeptical', temperature: 0.7, verdictText: '怀疑派：判据可能偏窄。\n\nRange: 5%-15%\nP=0.09', impliedProb: 0.09 });
  const b = (await get(rows.ok)).body;
  assert.equal(b.verdict_count, 2);
  assert.equal(b.verdicts.length, 2);
  assert.deepEqual(b.verdicts.map((v) => v.prompt_variant).sort(), ['v1_evidence', 'v2_skeptical']);
  assert.equal(b.verdicts[0].implied_prob, 0.03, 'implied_prob 须原样带出（路由层机械抽的，不是模型自由给的）');
  // 别的题不受影响
  assert.equal((await get(rows.noBase)).body.verdict_count, 0);
});

test('⑧ 未结算行：outcome/resolved_at 如实为 null，概率缺失也如实为 null（不代填）', async () => {
  const b = (await get(rows.open)).body;
  assert.equal(b.outcome, null);
  assert.equal(b.resolved_at, null);
  assert.equal(b.assigned_prob, null);
  assert.match(b.truth_basis.reason, /还没结算/);
});

test('⑨ 门禁与门径：404 不存在 / 400 非整数；静态端点不被 :id 遮蔽', async () => {
  assert.equal((await get(99999999)).status, 404);
  const bad = await app.inject({ method: 'GET', url: '/api/predictions/abc' });
  assert.equal(bad.statusCode, 400);
  const zero = await app.inject({ method: 'GET', url: '/api/predictions/0' });
  assert.equal(zero.statusCode, 400, 'id 必须 ≥1');

  // ★路由遮蔽回归：/unresolved 与 /calibration 是静态段，必须仍走静态处理器
  //   （若被 :id 吃掉，会变成 400「prediction id 必须是 ≥1 的整数」）
  const un = await app.inject({ method: 'GET', url: '/api/predictions/unresolved' });
  assert.equal(un.statusCode, 200);
  assert.ok(Array.isArray(j(un).items) && j(un).l0_gate, 'unresolved 仍返回分页 + 门禁');
  const cal = await app.inject({ method: 'GET', url: '/api/predictions/calibration' });
  assert.equal(cal.statusCode, 200);
  assert.ok(j(cal).l0_gate, 'calibration 仍返回读数');
});

test('⑩ ★零写锁：新增块内不得有任何写库语句或写侧函数', () => {
  const i = ROUTE_SRC.indexOf("app.get('/api/predictions/:id'");
  assert.ok(i > 0, '未找到新增端点源码');
  const block = ROUTE_SRC.slice(i).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const pat of [/\bINSERT\b/i, /\bUPDATE\b/i, /\bDELETE\b/i, /\bDROP\b/i, /\.exec\(/]) {
    assert.equal(pat.test(block), false, '单题端点内不得出现写库语句: ' + pat);
  }
  for (const fn of ['insertPrediction', 'resolvePrediction', 'updateAuditFields', 'updateTautology', 'saveVerdict', 'conn.exec']) {
    assert.equal(block.indexOf(fn) === -1, true, '单题端点不得调用写侧函数: ' + fn);
  }
  // 读侧三件套必须真在用（防「端点存在但其实没读」的假绿）
  assert.ok(block.includes('store.getPrediction(id)'));
  assert.ok(block.includes('vstore.listVerdictsByPrediction(id)'));
  assert.ok(block.includes('truthBasis.isTruthBasisDefect'));
  assert.ok(block.includes('baseRateMod.readBaseRate'));
});

test('⑪ ★禁词锁：端点自己产出的说明句不得出现该词', () => {
  // ★只查本端点**自己写的文案**（纪律条/理由句/基率措辞）——
  //   source_type、statement、resolve_note、truth_anchor 都是账本原文透传，不属本端点文案。
  assert.equal(/预测/.test(ROUTE_SRC.slice(ROUTE_SRC.indexOf("app.get('/api/predictions/:id'"))), false,
    '新增端点源码内不得出现该词（含注释与说明句）');
  return Promise.all(Object.keys(rows).map(async (k) => {
    const b = (await get(rows[k])).body;
    for (const s of [].concat(b.discipline, b.truth_basis.reason, b.truth_basis.rule, b.base_rate ? b.base_rate.note : '')) {
      assert.equal(/预测/.test(String(s)), false, '行 ' + k + ' 的端点文案出现该词: ' + s);
    }
  }));
});

test('⑫ ★基率读序没有在本端点被重写（单一真源锁）', () => {
  const i = ROUTE_SRC.indexOf("app.get('/api/predictions/:id'");
  const block = ROUTE_SRC.slice(i);
  // 端点里不得出现任何自写的百分号/分数解析——那会与 baseRate.js 的三条读序漂移
  assert.equal(/parsePercent|parseFraction|baseRateEq|toFixed\(1\)\s*\+\s*'%'/.test(block), false,
    '基率解析只能来自 evidence/baseRate.js');
  assert.ok(ROUTE_SRC.includes("const truthBasis = require('../evidence/truthBasis')"),
    '排除判定只能来自 evidence/truthBasis.js');
  assert.equal(/function isTruthBasisDefect|function NOT_TRUTH_BASIS_DEFECT_SQL/.test(ROUTE_SRC), false,
    '本路由不得自行实现排除谓词');
});
