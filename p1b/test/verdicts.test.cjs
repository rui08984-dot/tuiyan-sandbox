'use strict';
/**
 * p1b/test/verdicts.test.cjs —— W2 多路判词+校准 API 测试（node:test + fastify inject）。
 * 铁律：不起真端口；DB=:memory:；LLM 全 mock（零网络）。
 * 覆盖：POST verdicts 3 路全量落库（variant×温度配对 + implied_prob 机械抽取）、
 * 幂等（OR IGNORE 保首条）、pid 跨局/不存在 404、extractImpliedProb 契约单元、
 * calibration（n<30 数据不足；ambiguous 与 NULL prob 剔除；ECE 数值强校验+10 桶+分层）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const { extractImpliedProb, ROUTES } = require('../src/routes/verdicts');
const predictions = require('../src/db/predictionsStore');

const tmpProviders = path.join(os.tmpdir(), 'p1b-test-verdicts-providers-' + process.pid + '-' + Date.now() + '.json');
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

let gameId = null, game2Id = null, pidA = null, pidB = null;

test('建局与落注 fixtures（pidA 主角；pidB 挂第二局供跨局 404）', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '判词局A', type: 'werewolf', player_count: 6 } });
  assert.equal(r.statusCode, 201);
  gameId = j(r).game.id;
  r = await app.inject({ method: 'POST', url: '/api/games', payload: { name: '判词局B', type: 'werewolf', player_count: 5 } });
  assert.equal(r.statusCode, 201);
  game2Id = j(r).game.id;
  r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions'), payload: { statement: 'A：明天有对跳', prob: 0.6 } });
  assert.equal(r.statusCode, 201);
  pidA = j(r).id;
  r = await app.inject({ method: 'POST', url: gameUrl(game2Id, '/predictions'), payload: { statement: 'B：3号是狼', prob: 0.4 } });
  assert.equal(r.statusCode, 201);
  pidB = j(r).id;
});

test('POST verdicts（MOCK）：3 路全量落库，variant×温度配对 + implied_prob 机械抽取', async () => {
  const r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/' + pidA + '/verdicts') });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.mode, 'mock');
  assert.equal(b.saved.length, 3);
  assert.equal(b.errors.length, 0);
  const byVariant = {};
  for (const s of b.saved) byVariant[s.prompt_variant] = s;
  for (const route of ROUTES) {
    assert.ok(byVariant[route.variant], '每路一行: ' + route.variant);
    assert.equal(byVariant[route.variant].temperature, route.temperature);
    assert.equal(byVariant[route.variant].extracted, true, 'mock 末行 P= 可机械抽取');
  }
  assert.equal(byVariant['v1_evidence'].implied_prob, 0.25);
  assert.equal(byVariant['v2_skeptical'].implied_prob, 0.5);
  assert.equal(byVariant['v3_baserate'].implied_prob, 0.75);
});

test('verdict_text 全量落库（不只存聚合值，C 方案 3 原文）+ 末行 P= 格式', async () => {
  const rows = db.getConnection().prepare('SELECT * FROM verdicts WHERE prediction_id = ? ORDER BY id').all(pidA);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok(typeof row.verdict_text === 'string' && row.verdict_text.length > 10);
    assert.match(row.verdict_text, /P=0\.\d\d\s*$/);
    assert.ok(row.created_at);
  }
});

test('POST verdicts 幂等：重复调用保首条（OR IGNORE），行 id 不变', async () => {
  const before = db.getConnection().prepare('SELECT id FROM verdicts WHERE prediction_id = ? ORDER BY id').all(pidA).map((x) => x.id);
  assert.equal(before.length, 3);
  const r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/' + pidA + '/verdicts') });
  assert.equal(r.statusCode, 200);
  assert.equal(j(r).saved.length, 3);
  const after = db.getConnection().prepare('SELECT id FROM verdicts WHERE prediction_id = ? ORDER BY id').all(pidA).map((x) => x.id);
  assert.deepEqual(after, before);
});

test('POST verdicts pid 跨局/不存在/局不存在 → 404', async () => {
  let r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/' + pidB + '/verdicts') });
  assert.equal(r.statusCode, 404, 'pidB 属 game2，跨局拒');
  r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/99999999/verdicts') });
  assert.equal(r.statusCode, 404);
  r = await app.inject({ method: 'POST', url: '/api/games/999999/predictions/' + pidA + '/verdicts' });
  assert.equal(r.statusCode, 404);
});

test('extractImpliedProb 契约单元：认末行 P=0.xx 小数；拒 %、越界、缺失', () => {
  assert.equal(extractImpliedProb('分析……\nP=0.65'), 0.65);
  assert.equal(extractImpliedProb('分析……\nP=1.0'), 1);
  assert.equal(extractImpliedProb('分析\nP=0'), 0);
  assert.equal(extractImpliedProb('分析\np = 0.42'), 0.42, '小写+空格容忍');
  assert.equal(extractImpliedProb('分析\nP=65%'), null, '百分比不认（契约外格式，宁 NULL 不误抓）');
  assert.equal(extractImpliedProb('分析\nP=1.5'), null, '越界拒');
  assert.equal(extractImpliedProb('没有任何数字'), null);
  assert.equal(extractImpliedProb(''), null);
  assert.equal(extractImpliedProb('P=0.3 不算\n尾行无P'), null, '行尾必须紧跟数值');
});

test('calibration n<30 → 「数据不足」（ambiguous 与 NULL prob 不计数）', async () => {
  for (let i = 0; i < 29; i++) {
    const p = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: 'C' + i, prob: 0.8, evidence: [] });
    predictions.resolvePrediction(p.id, i % 4 === 0 ? 'false' : 'true', '测试真值');
  }
  const amb = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: 'AMB', prob: 0.9, evidence: [] });
  predictions.resolvePrediction(amb.id, 'ambiguous', '歧义留痕不硬判');
  const cp = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '验证点', statement: 'CP-NULL', prob: null, evidence: [] });
  predictions.resolvePrediction(cp.id, 'true', '真值');
  const r = await app.inject({ method: 'GET', url: '/api/predictions/calibration' });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.status, '数据不足');
  assert.equal(b.n, 29, 'ambiguous 与验证点 NULL prob 剔除');
  assert.match(b.note, /只记不评/);
});

test('calibration n≥30 → ok：ECE 强校验（全 0.8）+ 10 桶 + source_type 分层', async () => {
  for (let i = 0; i < 2; i++) {
    const p = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: 'D' + i, prob: 0.8, evidence: [] });
    predictions.resolvePrediction(p.id, 'true', '真值');
  }
  const r = await app.inject({ method: 'GET', url: '/api/predictions/calibration' });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.status, 'ok');
  assert.equal(b.n, 31);
  assert.equal(b.buckets.length, 10);
  const bucket = b.buckets[8]; // prob=0.8 → floor(8)=8 桶 [0.8,0.9)
  assert.equal(bucket.n, 31);
  assert.ok(Math.abs(bucket.mean_prob - 0.8) < 1e-9);
  assert.ok(Math.abs(bucket.true_rate - 23 / 31) < 1e-9, '29 条中 8 false（i%4==0）+2 true = 23/31');
  assert.ok(Math.abs(b.ece - Math.abs(23 / 31 - 0.8)) < 1e-9);
  assert.equal(b.layers['预测卡'].status, 'ok');
  assert.equal(b.layers['预测卡'].n, 31);
  assert.equal(b.layers['验证点'].status, '数据不足', '验证点层 NULL prob 无样本 → 数据不足（宁缺毋滥）');
  assert.match(b.note, /参考/);
  assert.ok(b.l0_gate, 'l0_gate 恒挂');
});

// ── p13 批次0.5：verdicts 表 model/run_id 版本戳两列（additive 迁移）──────────

test('verdicts 版本戳（p13）：saveVerdict 传 model/runId 落库读回；省略时 NULL（旧调用方兼容）', async () => {
  const { saveVerdict, listVerdictsByPrediction } = require('../src/db/verdictsStore');
  // 非标准 3 路温度（0.5/0.6）避开 (prediction_id, prompt_variant, temperature) 唯一索引
  const s = saveVerdict({
    predictionId: pidA, promptVariant: 'v3_baserate', temperature: 0.5,
    verdictText: '版本戳测试行：模型与重跑批次要能从库上读回。\nP=0.40', impliedProb: 0.4,
    model: 'mock-model-x', runId: 'run-20260912-p13',
  });
  assert.equal(s.model, 'mock-model-x', '写端落 model');
  assert.equal(s.run_id, 'run-20260912-p13', '写端落 run_id');
  const hit = listVerdictsByPrediction(pidA).find((x) => x.temperature === 0.5);
  assert.ok(hit, '读模型带出新行');
  assert.equal(hit.model, 'mock-model-x');
  assert.equal(hit.run_id, 'run-20260912-p13');
  const bare = saveVerdict({
    predictionId: pidA, promptVariant: 'v2_skeptical', temperature: 0.6,
    verdictText: '旧调用方兼容行：不传版本戳时两列应如实 NULL。\nP=0.55', impliedProb: 0.55,
  });
  assert.equal(bare.model, null, '省略 model → NULL');
  assert.equal(bare.run_id, null, '省略 runId → NULL');
});

test('verdicts additive 迁移（p13）：旧 7 列表 ensure 后补 model/run_id，旧行两列 NULL', () => {
  const { ensureVerdictsTable } = require('../src/db/verdictsStore');
  const conn = db.getConnection();
  // 模拟旧库：drop 后重建迁移前的 7 列旧表（CHECK 照旧），插一行旧行
  conn.exec('DROP TABLE verdicts');
  conn.exec([
    'CREATE TABLE verdicts (',
    '  id INTEGER PRIMARY KEY,',
    '  prediction_id INTEGER NOT NULL REFERENCES predictions(id),',
    "  prompt_variant TEXT NOT NULL CHECK(prompt_variant IN ('v1_evidence','v2_skeptical','v3_baserate')),",
    '  temperature REAL NOT NULL CHECK(temperature BETWEEN 0 AND 1),',
    '  verdict_text TEXT NOT NULL,',
    '  implied_prob REAL CHECK(implied_prob IS NULL OR (implied_prob >= 0 AND implied_prob <= 1)),',
    "  created_at TEXT DEFAULT (datetime('now'))",
    ');',
  ].join('\n'));
  conn.prepare("INSERT INTO verdicts (prediction_id, prompt_variant, temperature, verdict_text, implied_prob) VALUES (?, 'v1_evidence', 0.2, '迁移前的旧判词行（无版本戳）。P=0.50', 0.5)").run(pidA);
  ensureVerdictsTable(conn); // 幂等 ensure 触发 additive 迁移
  const names = conn.prepare('PRAGMA table_info(verdicts)').all().map((c) => c.name);
  assert.ok(names.indexOf('model') !== -1, 'model 列已补');
  assert.ok(names.indexOf('run_id') !== -1, 'run_id 列已补');
  const oldRow = conn.prepare("SELECT * FROM verdicts WHERE prompt_variant = 'v1_evidence' AND temperature = 0.2").get();
  assert.ok(oldRow, '旧行还在');
  assert.equal(oldRow.model, null, '旧行 model NULL（如实留空不回填）');
  assert.equal(oldRow.run_id, null, '旧行 run_id NULL');
  // 迁移后表可用：saveVerdict 走新列写入不炸
  const { saveVerdict } = require('../src/db/verdictsStore');
  const s = saveVerdict({ predictionId: pidA, promptVariant: 'v1_evidence', temperature: 0.9, verdictText: '迁移后新写入行，验证表结构可用。\nP=0.60', impliedProb: 0.6, runId: 'run-post-migration' });
  assert.equal(s.run_id, 'run-post-migration');
});

// ── p15 批次1-M1：per-path 注入（B1(a) 信息差）──────────────────────────────

test('per-path 注入（p15）：loadEvidence 命中/悬空/空三态 + 200 字截断 + R-A 口径护栏', () => {
  const conn = db.getConnection();
  const { loadEvidence, NO_EVIDENCE_LINE } = require('../src/routes/verdicts');
  const longText = '夜刀事件：'.padEnd(230, 'x');
  const e1 = conn.prepare("INSERT INTO events (game_id, day, phase, seq, type, raw_text) VALUES (?, 1, 'day', 9001, 'death', ?)").run(gameId, longText).lastInsertRowid;
  const pred = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: '注入用例：命中+悬空混合', prob: 0.5, evidence: [Number(e1), 999999999] });
  const block = loadEvidence(pred);
  assert.ok(block.indexOf('账本证据引用') !== -1, '块头标注「账本证据引用」（批次2-R-C 2.0 口径）');
  assert.ok(block.indexOf('非结算信息') !== -1, '口径护栏：不声称结算信息');
  assert.ok(block.indexOf('事件 #' + e1 + '（day 1/death）：') !== -1, '事件行格式 id+day/type');
  assert.ok(block.indexOf(longText.slice(0, 120)) !== -1, 'raw_text 保留前 120 字');
  assert.ok(block.indexOf(longText) === -1, '超出 120 字被截断');
  assert.ok(block.indexOf('悬空') === -1, '悬空 id 静默跳过（不喂判词）');
  const empty = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: '注入用例：空引用', prob: 0.5, evidence: [] });
  assert.equal(loadEvidence(empty), NO_EVIDENCE_LINE, '空引用 → 固定兜底行');
  const allDangling = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: '注入用例：全悬空', prob: 0.5, evidence: [999999998] });
  assert.equal(loadEvidence(allDangling), NO_EVIDENCE_LINE, '全部悬空 → 固定兜底行');
});

test('per-path 注入（p15）：buildUserPrompt v1 证据/v2 纯题面/v3 基率行；禁更新指令措辞', () => {
  const { buildUserPrompt, buildSystemPrompt } = require('../src/routes/verdicts');
  const pred = { id: 1, game_id: gameId, day: 2, statement: '分流用例', layer: 'L6', evidence: [] };
  const game = { game_type: 'werewolf' };
  const p1 = buildUserPrompt(pred, game, { evidenceBlock: '账本事件引用（全量账本记录，非结算前信息）：\n事件 #1（day 1/death）：演示' });
  assert.ok(p1.indexOf('账本事件引用') !== -1, 'v1 含证据块');
  assert.ok(p1.indexOf('账本历史统计') === -1, 'v1 不带基率行');
  const p2 = buildUserPrompt(pred, game, {});
  assert.ok(p2.indexOf('账本事件引用') === -1 && p2.indexOf('账本历史统计') === -1, 'v2 纯题面（信息差对照）');
  const p3 = buildUserPrompt(pred, game, { baseline: { n: 20, rate: 0.7 } });
  assert.match(p3, /账本历史统计（同类局型 n=20，true 占比 70%），仅作背景参考/);
  assert.ok(p3.indexOf('请据此更新') === -1 && p3.indexOf('据此更新') === -1, '禁更新指令式措辞（Schoenegger）');
  const p3L1 = buildUserPrompt({ id: 1, game_id: gameId, day: 2, statement: 'L1 用例', layer: 'L1' }, game, { baseline: null });
  assert.ok(p3L1.indexOf('账本历史统计') === -1, 'L1 重言层不注入基率行');
  const legacy = buildUserPrompt(pred, game); // 兼容：不传 extras 与旧行为一致（题面 2 行+指令 1 行）
  assert.equal(legacy.split('\n').length, 3);
  assert.match(buildSystemPrompt('v1_evidence'), /Range: A%-B%/, '输出契约含区间行要求');
  assert.match(buildSystemPrompt('v1_evidence'), /最后一行必须严格是「P=0.xx」/, '末行 P= 契约保留');
});

test('per-path 注入（p15）：loadBaseline LOO 排除自身 + n<10 样本不足 + L1/未分类不注入', () => {
  const { loadBaseline } = require('../src/routes/verdicts');
  for (let i = 0; i < 10; i++) { // 10 条同型局（werewolf）L6 已 resolve：1 false + 9 true
    const r = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: 'LOO 种子 ' + i, prob: 0.5, layer: 'L6' });
    predictions.resolvePrediction(r.id, i === 0 ? 'false' : 'true', 'LOO 测试真值');
  }
  const probe = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: 'LOO 探针（未 resolve）', prob: 0.5, layer: 'L6' });
  let b = loadBaseline(probe);
  assert.equal(b.n, 10, '本条未 resolve → 全部 10 条入样本');
  assert.ok(Math.abs(b.rate - 0.9) < 1e-9, 'true 占比 9/10');
  predictions.resolvePrediction(probe.id, 'true', 'LOO 探针自 resolve');
  b = loadBaseline(predictions.getPrediction(probe.id));
  assert.equal(b.n, 10, 'LOO：本条自身被排除（n=11-1）');
  assert.ok(Math.abs(b.rate - 0.9) < 1e-9, '排除后占比仍 0.9（若含自身应为 10/11）');
  const probeL3 = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: '样本不足探针', prob: 0.5, layer: 'L3' });
  const b2 = loadBaseline(probeL3);
  assert.deepEqual(b2, { n: 0, rate: null }, '同 layer 无有效样本 → n=0，rate=null（如实不足）');
  const l1 = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: 'L1 探针', prob: 0.5, layer: 'L1' });
  assert.equal(loadBaseline(l1), null, 'L1 重言层一律不注入');
  const unclassified = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: '未分类探针', prob: 0.5 });
  assert.equal(loadBaseline(unclassified), null, '未分类层不注入（layer 绑定是基率语义前提）');
});

test('per-path 注入（p15）：buildMockVerdict 三路 Range 区间行 + v1 证据行 + P= 末行契约不破坏', () => {
  const { buildMockVerdict, extractImpliedProb } = require('../src/routes/verdicts');
  const evBlock = '账本事件引用（全量账本记录，非结算前信息）：\n事件 #1（day 1/death）：演示';
  const m1 = buildMockVerdict('v1_evidence', 0.2, 'mock 区间用例', { evidenceBlock: evBlock });
  assert.ok(m1.indexOf(evBlock) !== -1, 'v1 mock 含证据行引用');
  assert.match(m1, /Range: 15%-35%\nP=0\.25\s*$/, 'v1 区间行紧邻 P= 之上');
  assert.equal(extractImpliedProb(m1), 0.25, 'Range 行不破坏末行 P= 抽取');
  const m2 = buildMockVerdict('v2_skeptical', 0.7, 'mock 区间用例');
  assert.match(m2, /Range: 40%-60%\nP=0\.50\s*$/);
  assert.ok(m2.indexOf('账本事件引用') === -1, 'v2 mock 无证据块（信息差对照）');
  const m3 = buildMockVerdict('v3_baserate', 1.0, 'mock 区间用例', { baseline: { n: 10, rate: 0.9 } });
  assert.match(m3, /账本历史统计（同类局型 n=10，true 占比 90%），仅作背景参考/);
  assert.match(m3, /Range: 65%-85%\nP=0\.75\s*$/);
  const m3insuf = buildMockVerdict('v3_baserate', 1.0, 'mock 区间用例', { baseline: { n: 3, rate: null } });
  assert.match(m3insuf, /基率样本不足（同类局型有效样本 n=3<10），仅作背景参考/);
  assert.ok(m3insuf.indexOf('请据此更新') === -1, 'mock 基率行同样禁更新指令');
});

test('per-path 注入（p15）：POST verdicts（MOCK）v1 落库文本含证据块；三路 Range 行 + extracted 全真', async () => {
  const e5 = db.getConnection().prepare("INSERT INTO events (game_id, day, phase, seq, type, raw_text) VALUES (?, 1, 'dusk', 9002, 'death', '计票：{\"5\":4}')").run(gameId).lastInsertRowid;
  const pidE = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: '注入用例：API 链路', prob: 0.5, layer: 'L6', evidence: [Number(e5)] });
  const r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/' + pidE.id + '/verdicts') });
  assert.equal(r.statusCode, 200);
  const b = j(r);
  assert.equal(b.errors.length, 0);
  assert.equal(b.saved.length, 3);
  const rows = db.getConnection().prepare('SELECT * FROM verdicts WHERE prediction_id = ? ORDER BY id').all(pidE.id);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.match(row.verdict_text, /Range: \d+%-\d+%\nP=0.\d\d\s*$/, '区间行+末行 P= 契约');
    assert.ok(row.implied_prob !== null, 'mock 末行可抽取');
  }
  const v1row = rows.find((x) => x.prompt_variant === 'v1_evidence');
  assert.ok(v1row.verdict_text.indexOf('账本证据引用') !== -1, 'v1 落库文本含证据块');
  assert.ok(v1row.verdict_text.indexOf('事件 #' + e5 + '（day 1/death）：') !== -1, '证据行带事件 id');
  const v2row = rows.find((x) => x.prompt_variant === 'v2_skeptical');
  assert.ok(v2row.verdict_text.indexOf('账本证据引用') === -1, 'v2 落库文本不含证据块');
  const v3row = rows.find((x) => x.prompt_variant === 'v3_baserate');
  assert.ok(v3row.verdict_text.indexOf('账本历史统计') !== -1, 'v3 落库文本含基率背景行（L6 有效样本）');
});

// ── 批次2-R-C：loadEvidence 2.0 三段结构化注入（rb-attribution 诊断落地）────

test('loadEvidence 2.0（R-C）：三段注入——事件流+claims 按席位聚合+机械特征卡，零结算泄漏', () => {
  const conn = db.getConnection();
  // 构造 mini 局证据集：cutoff 前公开事件（夜公告/夜死公告/发言×2）+结算事件（不入 evidence）
  const g = gameId;
  const evA = conn.prepare("INSERT INTO events (game_id, day, phase, seq, type, raw_text) VALUES (?, 1, 'night', 9101, 'system', '夜幕降临，全体闭眼。')").run(g).lastInsertRowid;
  const evB = conn.prepare("INSERT INTO events (game_id, day, phase, seq, type, raw_text) VALUES (?, 1, 'day', 9102, 'death', '天亮了。公布夜 1 死亡：5 号死亡，无遗言。')").run(g).lastInsertRowid;
  const evC = conn.prepare("INSERT INTO events (game_id, day, phase, seq, type, raw_text) VALUES (?, 1, 'day', 9103, 'statement', '5 号：我是平民。')").run(g).lastInsertRowid;
  const evD = conn.prepare("INSERT INTO events (game_id, day, phase, seq, type, raw_text) VALUES (?, 1, 'day', 9104, 'statement', '3 号：我怀疑 5 号话里有话，2 号也发言很短。')").run(g).lastInsertRowid;
  const evDusk = conn.prepare("INSERT INTO events (game_id, day, phase, seq, type, raw_text) VALUES (?, 1, 'dusk', 9105, 'death', '计票：{\"2\":4}。2 号被放逐出局。')").run(g).lastInsertRowid; // 结算事件
  const evEnd = conn.prepare("INSERT INTO events (game_id, day, phase, seq, type, raw_text) VALUES (?, 1, 'night', 9106, 'system', '游戏结束：狼人阵营胜利。')").run(g).lastInsertRowid; // 结算事件
  // claims（seat/subject_seat=座位号口径）：2 号 is_wolf 指认 5 号；3 号自认平民×2（其一重复）
  conn.prepare("INSERT INTO claims (event_id, seat, subject_seat, predicate, object) VALUES (?, 2, 5, 'is_wolf', '狼人')").run(evD);
  conn.prepare("INSERT INTO claims (event_id, seat, subject_seat, predicate, object) VALUES (?, 2, 2, 'is_good', '好人')").run(evD);
  conn.prepare("INSERT INTO claims (event_id, seat, subject_seat, predicate, object) VALUES (?, 3, 5, 'is_good', '平民')").run(evC);
  const pred = predictions.insertPrediction({ gameId: g, day: 1, sourceType: '预测卡', statement: '2.0 用例：三段注入', prob: 0.5, layer: 'L6', evidence: [Number(evA), Number(evB), Number(evC), Number(evD)] });
  const { loadEvidence } = require('../src/routes/verdicts');
  const block = loadEvidence(pred);
  // a 段：事件流（只含 cutoff 前 4 条）
  for (const ev of [evA, evB, evC, evD]) assert.ok(block.indexOf('事件 #' + ev + '（day 1/') !== -1, 'a 段事件 #' + ev + ' 在块中');
  assert.ok(block.indexOf('计票：{"2":4}') === -1 && block.indexOf('游戏结束：狼人阵营胜利') === -1, '无泄漏：dusk 计票/system 终局原文不出现');
  assert.ok(block.indexOf('事件 #' + evDusk) === -1 && block.indexOf('事件 #' + evEnd) === -1, '结算事件 id 不进块');
  // b 段：claims 按席位聚合
  assert.ok(block.indexOf('账本声称记录') !== -1, 'b 段头');
  assert.ok(block.indexOf('席位 2 共声称 2 条：is_wolf→狼人；is_good→好人') !== -1, '席位 2 聚合（is_wolf 指认 5 号）');
  assert.ok(block.indexOf('席位 3 共声称 1 条：is_good→平民') !== -1, '席位 3 聚合（自认平民）');
  assert.ok(block.indexOf('席位 6') === -1, '无 claims 的席位（6 号）不出现');
  // c 段：机械特征卡
  assert.ok(block.indexOf('账本机械统计（截至 cutoff，纯代码计算零 LLM）') !== -1, 'c 段头');
  assert.ok(block.indexOf('发言条数：2；发言总字数：') !== -1, '发言条数/总字数（两条 statement）');
  assert.ok(block.indexOf('声称总数：3（其中身份声称 3）') !== -1, '声称总数/身份声称');
  assert.ok(block.indexOf('指认总数（is_wolf 指认他人）：1；被指认席位数：1；单席最高被指认：1') !== -1, '指认特征（自指认不算指认他人）');
  assert.ok(block.indexOf('夜死席位：5 号') !== -1, '夜死席位从公告文本正则取（p14 坑规避）');
});

// ── 批次2-M1（R-A 后解冻件）：verdicts runId/model API 透传 ─────────────────

test('runId/model 透传（批次2-M1）：POST body 带 runId/model 落库读回；缺省 NULL（旧调用方兼容）', async () => {
  const pidR = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: '透传用例：带批次指纹', prob: 0.5, layer: 'L6', evidence: [] });
  let r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/' + pidR.id + '/verdicts'), payload: { runId: 'f232e2a54689', model: 'tokenrhythm/glm-5.3-flash' } });
  assert.equal(r.statusCode, 200);
  let b = j(r);
  assert.equal(b.errors.length, 0);
  for (const s of b.saved) {
    assert.equal(s.run_id, 'f232e2a54689', '响应带 run_id');
    assert.equal(s.model, 'tokenrhythm/glm-5.3-flash', '响应带 model');
  }
  const rows = db.getConnection().prepare('SELECT * FROM verdicts WHERE prediction_id = ?').all(pidR.id);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.run_id, 'f232e2a54689', '库内 run_id 落行');
    assert.equal(row.model, 'tokenrhythm/glm-5.3-flash', '库内 model 落行');
  }
  // 缺省：不带 body 的旧调用方 → 两列 NULL（向后兼容）
  const pidN = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: '透传用例：缺省 NULL', prob: 0.5, layer: 'L6', evidence: [] });
  r = await app.inject({ method: 'POST', url: gameUrl(gameId, '/predictions/' + pidN.id + '/verdicts') });
  assert.equal(r.statusCode, 200);
  b = j(r);
  assert.equal(b.errors.length, 0);
  for (const s of b.saved) {
    assert.equal(s.run_id, null, '缺省 run_id=NULL');
    assert.equal(s.model, null, '缺省 model=NULL');
  }
});

// ── 批次2-RC：verdicts 三批 runId 隔离（索引升级 additive）────────────────

test('三批 runId 隔离（批次2-RC）：同 pid 同路不同 runId 并存；批内幂等保首条；NULL 组幂等（R-A 口径不变）', () => {
  const { saveVerdict, listVerdictsByPrediction } = require('../src/db/verdictsStore');
  const pidX = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: '三批隔离用例', prob: 0.5, layer: 'L6', evidence: [] });
  const sRb = saveVerdict({ predictionId: pidX.id, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: 'R-B 批行（1.0 注入时代）。\nRange: 30%-50%\nP=0.40', impliedProb: 0.4, runId: 'ca1b5cdbddfc' });
  const sRc = saveVerdict({ predictionId: pidX.id, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: 'R-C 批行（2.0 三段注入时代）。\nRange: 20%-40%\nP=0.55', impliedProb: 0.55, runId: 'f4f760aa50e1' });
  assert.notEqual(sRc.id, sRb.id, '跨 runId 并存：R-C 行是新行（三批隔离核心）');
  const rows = listVerdictsByPrediction(pidX.id);
  assert.equal(rows.length, 2, '同 pid 同路两批各行一行');
  // 批内幂等：同 runId 重发 → 保首条（OR IGNORE）
  const sRc2 = saveVerdict({ predictionId: pidX.id, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: 'R-C 重发行。\nP=0.55', impliedProb: 0.55, runId: 'f4f760aa50e1' });
  assert.equal(sRc2.id, sRc.id, '同 runId 批内幂等保首条');
  assert.equal(listVerdictsByPrediction(pidX.id).length, 2, '幂等后仍两行');
  // NULL 组（R-A 口径）：不带 runId 重复 → COALESCE 组内幂等保首条（旧行为不回归）
  const pidY = predictions.insertPrediction({ gameId: gameId, day: 1, sourceType: '预测卡', statement: 'NULL 组幂等用例', prob: 0.5, layer: 'L6', evidence: [] });
  const n1 = saveVerdict({ predictionId: pidY.id, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: 'NULL 批首条。\nP=0.50', impliedProb: 0.5 });
  const n2 = saveVerdict({ predictionId: pidY.id, promptVariant: 'v1_evidence', temperature: 0.2, verdictText: 'NULL 批重发行。\nP=0.50', impliedProb: 0.5 });
  assert.equal(n2.id, n1.id, 'NULL（R-A 口径）组内幂等保首条（旧语义不回归）');
});
